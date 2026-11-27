import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { HttpError } from './http-error.js';
import type { IdentityDirectory } from './identity.js';

const timestamp = z.int().min(0).max(8_640_000_000_000_000);
const batch = z.strictObject({ id: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/), startsAt: timestamp, endsAt: timestamp,
    tasks: z.int().min(0).max(1_000_000), modelCalls: z.int().min(0).max(1_000_000) })
    .refine(trial => trial.startsAt < trial.endsAt);
export const entitlementSnapshot = z.strictObject({ version: z.int().positive(), issuedAt: timestamp, validUntil: timestamp,
    tasksEnabled: z.boolean(), modelsEnabled: z.boolean(), modelBalance: z.enum(['AVAILABLE', 'INSUFFICIENT', 'UNKNOWN']),
    allowPurgedTaskVoid: z.boolean(), trials: z.array(batch).max(64), metered: batch.optional() })
    .refine(snapshot => snapshot.issuedAt < snapshot.validUntil && new Set(snapshot.trials.map(trial => trial.id)).size === snapshot.trials.length
        && !snapshot.trials.some(trial => trial.id === snapshot.metered?.id));
type EntitlementSnapshot = z.infer<typeof entitlementSnapshot>;
type ChargeKind = 'TASK' | 'MODEL';
type Status = 'ACTIVE' | 'HOSTED_LICENSE_UNKNOWN' | 'HOSTED_LICENSE_EXPIRED' | 'HOSTED_ORGANIZATION_DISABLED' | 'HOSTED_ENTITLEMENT_UNKNOWN';
type Charge = { id: string; organizationId: string; kind: ChargeKind; projectId?: string; taskId: string; capability: string };
type ModelAttempt = { id: string; taskId?: string; projectIds: readonly string[]; capability: string };

export class HostedEntitlements {
    readonly enabled: boolean;
    private readonly licenseUntil: number;
    private readonly maxAge: number;

    constructor(private readonly db: DatabaseSync, private readonly identity: IdentityDirectory, env: NodeJS.ProcessEnv, private readonly now = Date.now) {
        this.enabled = env.REPOGRAPH_HOSTED_ENTITLEMENTS === '1';
        this.licenseUntil = Date.parse(env.REPOGRAPH_HOSTED_LICENSE_UNTIL ?? '');
        this.maxAge = Number(env.REPOGRAPH_HOSTED_ENTITLEMENT_MAX_AGE_MS ?? 86_400_000);
        if (this.enabled && (!Number.isSafeInteger(this.maxAge) || this.maxAge < 1000 || this.maxAge > 604_800_000)) {
            throw new Error('Invalid REPOGRAPH_HOSTED_ENTITLEMENT_MAX_AGE_MS');
        }
        db.exec(`
            CREATE TABLE IF NOT EXISTS hosted_entitlement_snapshot (
                organization_id TEXT NOT NULL REFERENCES enterprise_organization(id), version INTEGER NOT NULL,
                payload TEXT NOT NULL, actor_id TEXT NOT NULL, received_at INTEGER NOT NULL,
                PRIMARY KEY(organization_id, version)
            );
            CREATE TABLE IF NOT EXISTS hosted_entitlement_charge (
                id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('TASK', 'MODEL')),
                organization_id TEXT NOT NULL, version INTEGER NOT NULL, batch_id TEXT NOT NULL, capability TEXT NOT NULL,
                project_id TEXT, task_id TEXT NOT NULL, charged_at INTEGER NOT NULL, voided_at INTEGER, voided_by TEXT,
                billing_mode TEXT NOT NULL DEFAULT 'TRIAL',
                PRIMARY KEY(kind, id), FOREIGN KEY(organization_id, version) REFERENCES hosted_entitlement_snapshot(organization_id, version)
            );
            CREATE INDEX IF NOT EXISTS hosted_entitlement_charge_ledger ON hosted_entitlement_charge(organization_id, charged_at DESC);
            CREATE INDEX IF NOT EXISTS hosted_entitlement_charge_trial
                ON hosted_entitlement_charge(organization_id, batch_id, kind) WHERE voided_at IS NULL;
            CREATE TABLE IF NOT EXISTS hosted_entitlement_task_retry (
                task_id TEXT PRIMARY KEY, original_id TEXT NOT NULL
            );
        `);
        if (!db.prepare("SELECT 1 FROM pragma_table_info('hosted_entitlement_charge') WHERE name = 'billing_mode'").get()) {
            db.exec("ALTER TABLE hosted_entitlement_charge ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'TRIAL'");
        }
    }

    private organization(id: string) {
        const row = this.db.prepare('SELECT active FROM enterprise_organization WHERE id = ?').get(id);
        if (!row) throw new HttpError(404, 'ORGANIZATION_NOT_FOUND');
        return Boolean(row.active) && this.identity.external.organizationActive(id);
    }

    private latest(id: string): EntitlementSnapshot | null {
        const row = this.db.prepare(`SELECT payload FROM hosted_entitlement_snapshot WHERE organization_id = ?
            ORDER BY version DESC LIMIT 1`).get(id);
        return row ? JSON.parse(String(row.payload)) as EntitlementSnapshot : null;
    }

    private status(active: boolean, snapshot: EntitlementSnapshot | null, now: number): Status {
        if (!Number.isFinite(this.licenseUntil)) return 'HOSTED_LICENSE_UNKNOWN';
        if (now >= this.licenseUntil) return 'HOSTED_LICENSE_EXPIRED';
        if (!active) return 'HOSTED_ORGANIZATION_DISABLED';
        if (!snapshot || now >= snapshot.validUntil || now - snapshot.issuedAt >= this.maxAge) return 'HOSTED_ENTITLEMENT_UNKNOWN';
        return 'ACTIVE';
    }

    private current(organizationId: string, now: number) {
        const active = this.organization(organizationId);
        const snapshot = this.latest(organizationId);
        const status = this.status(active, snapshot, now);
        if (status !== 'ACTIVE') throw new HttpError(status === 'HOSTED_ORGANIZATION_DISABLED' ? 403 : 503, status);
        return snapshot!;
    }

    publish(organizationId: string, actorId: string, incoming: EntitlementSnapshot) {
        const now = this.now();
        if (incoming.issuedAt > now) throw new HttpError(400, 'HOSTED_SNAPSHOT_FROM_FUTURE');
        const snapshot = { ...incoming, trials: [...incoming.trials].sort((a, b) => a.endsAt - b.endsAt || (a.id < b.id ? -1 : 1)) };
        const payload = JSON.stringify(snapshot);
        return this.transaction(() => {
            this.organization(organizationId);
            const prior = this.db.prepare('SELECT payload FROM hosted_entitlement_snapshot WHERE organization_id = ? AND version = ?')
                .get(organizationId, snapshot.version);
            if (prior) {
                if (prior.payload !== payload) throw new HttpError(409, 'HOSTED_SNAPSHOT_VERSION_CONFLICT');
            } else {
                const latest = this.latest(organizationId);
                if (latest && (snapshot.version <= latest.version || snapshot.issuedAt < latest.issuedAt)) {
                    throw new HttpError(409, 'HOSTED_SNAPSHOT_OUT_OF_ORDER');
                }
                this.db.prepare('INSERT INTO hosted_entitlement_snapshot VALUES (?, ?, ?, ?, ?)')
                    .run(organizationId, snapshot.version, payload, actorId, now);
            }
            return { organizationId, version: snapshot.version };
        });
    }

    private selectBatch(organizationId: string, kind: ChargeKind, snapshot: EntitlementSnapshot, now: number) {
        const used = this.db.prepare(`SELECT count(*) AS used FROM hosted_entitlement_charge
            WHERE organization_id = ? AND batch_id = ? AND kind = ? AND billing_mode = ? AND voided_at IS NULL`);
        const fits = (item: z.infer<typeof batch>, mode: 'TRIAL' | 'METERED') => item.startsAt <= now && now < item.endsAt
            && Number(used.get(organizationId, item.id, kind, mode)?.used) < (kind === 'TASK' ? item.tasks : item.modelCalls);
        const trial = snapshot.trials.find(item => fits(item, 'TRIAL'));
        if (trial) return { id: trial.id, mode: 'TRIAL' };
        if (snapshot.metered && fits(snapshot.metered, 'METERED')) return { id: snapshot.metered.id, mode: 'METERED' };
        const suffix = snapshot.metered ? 'QUOTA_EXHAUSTED' : 'TRIAL_EXHAUSTED';
        throw new HttpError(429, 'HOSTED_' + kind + '_' + suffix);
    }

    private charge(entry: Charge) {
        if (!this.db.isTransaction) throw new Error('Hosted admission requires the task or model transaction');
        const { id, organizationId, kind, projectId, taskId, capability } = entry;
        const now = this.now();
        const snapshot = this.current(organizationId, now);
        if (kind === 'TASK' && !snapshot.tasksEnabled) throw new HttpError(403, 'HOSTED_TASKS_DISABLED');
        if (kind === 'MODEL') {
            if (!snapshot.modelsEnabled) throw new HttpError(403, 'HOSTED_MODELS_DISABLED');
            if (snapshot.modelBalance === 'UNKNOWN') throw new HttpError(503, 'HOSTED_MODEL_BALANCE_UNKNOWN');
            if (snapshot.modelBalance === 'INSUFFICIENT') throw new HttpError(402, 'HOSTED_MODEL_BALANCE_INSUFFICIENT');
        }
        const batch = this.selectBatch(organizationId, kind, snapshot, now);
        this.db.prepare(`INSERT INTO hosted_entitlement_charge(id, kind, organization_id, version, batch_id, capability, project_id, task_id, charged_at, billing_mode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, kind, organizationId, snapshot.version, batch.id, capability, projectId ?? null, taskId, now, batch.mode);
    }

    private chargedTask(id: string | undefined) {
        if (!id) return undefined;
        const row = this.db.prepare(`SELECT id, organization_id AS organizationId FROM hosted_entitlement_charge WHERE kind = 'TASK'
            AND id = coalesce((SELECT original_id FROM hosted_entitlement_task_retry WHERE task_id = ?), ?) AND voided_at IS NULL`).get(id, id);
        return row ? { id: String(row.id), organizationId: String(row.organizationId) } : undefined;
    }

    task(taskId: string, projectIds: readonly string[], capability: string, retryFrom?: string) {
        if (!this.enabled) return;
        const organizationId = this.organizationFor(projectIds);
        const original = this.chargedTask(retryFrom);
        if (original) {
            if (organizationId !== original.organizationId) throw new HttpError(409, 'HOSTED_BILLING_SCOPE_CHANGED');
            this.db.prepare('INSERT INTO hosted_entitlement_task_retry VALUES (?, ?)').run(taskId, original.id);
        } else if (organizationId) {
            this.charge({ id: taskId, taskId, organizationId, projectId: projectIds.length === 1 ? projectIds[0] : undefined,
                kind: 'TASK', capability });
        }
    }

    private organizationFor(projectIds: readonly string[]) {
        const query = this.db.prepare("SELECT owner_id FROM enterprise_project_owner WHERE project_id = ? AND owner_type = 'ORGANIZATION'");
        const organizations = new Set(projectIds.map(id => query.get(id)?.owner_id).filter(Boolean));
        if (organizations.size > 1) throw new HttpError(409, 'HOSTED_MULTIPLE_BILLING_SCOPES');
        const org = organizations.values().next().value;
        return org ? String(org) : undefined;
    }

    model<T extends { id?: string }>(attempt: ModelAttempt, insert: (organizationId: string | undefined) => T) {
        return this.transaction(() => {
            const organizationId = this.organizationFor(attempt.projectIds);
            const original = this.chargedTask(attempt.taskId);
            if (original && organizationId !== original.organizationId) throw new HttpError(409, 'HOSTED_BILLING_SCOPE_CHANGED');
            const receipt = insert(organizationId);
            if (receipt.id && organizationId) this.charge({ id: attempt.id, taskId: original?.id ?? attempt.taskId ?? attempt.id,
                organizationId, projectId: attempt.projectIds.length === 1 ? attempt.projectIds[0] : undefined,
                kind: 'MODEL', capability: attempt.capability });
            return receipt;
        });
    }

    voidPurgedTask(organizationId: string, taskId: string, actorId: string) {
        return this.transaction(() => {
            const charge = this.db.prepare(`SELECT project_id AS projectId, voided_at AS voidedAt FROM hosted_entitlement_charge
                WHERE organization_id = ? AND kind = 'TASK' AND id = ?`).get(organizationId, taskId);
            if (!charge) throw new HttpError(404, 'HOSTED_TASK_CHARGE_NOT_FOUND');
            if (charge.voidedAt !== null) return { taskId, voidedAt: Number(charge.voidedAt) };
            const now = this.now();
            if (!this.current(organizationId, now).allowPurgedTaskVoid) throw new HttpError(403, 'HOSTED_TASK_VOID_DISABLED');
            const verified = typeof charge.projectId === 'string' && this.db.prepare(`SELECT 1 FROM project_retirement
                WHERE project_id = ?1 AND state = 'PURGED' AND source IN ('GIT','ARCHIVE')
                    AND NOT EXISTS (SELECT 1 FROM project WHERE id = ?1)`).get({ 1: charge.projectId });
            if (!verified) throw new HttpError(409, 'HOSTED_TASK_PURGE_UNCONFIRMED');
            this.db.prepare(`UPDATE hosted_entitlement_charge SET voided_at = ?, voided_by = ? WHERE kind = 'TASK' AND id = ?`)
                .run(now, actorId, taskId);
            return { taskId, voidedAt: now };
        });
    }

    private transaction<T>(action: () => T) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = action();
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    report(organizationId: string, limit: number, offset: number) {
        const active = this.organization(organizationId);
        const snapshot = this.latest(organizationId);
        const rows = this.db.prepare(`SELECT CASE WHEN capability <> 'ASK' THEN id END AS id, kind, capability, version, batch_id AS batchId, billing_mode AS billingMode,
            CASE WHEN capability <> 'ASK' THEN project_id END AS projectId,
            CASE WHEN capability <> 'ASK' THEN task_id END AS taskId,
            charged_at AS chargedAt, voided_at AS voidedAt FROM hosted_entitlement_charge WHERE organization_id = ?
            ORDER BY charged_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(organizationId, limit + 1, offset);
        return { organizationId, status: this.status(active, snapshot, this.now()), snapshot,
            records: rows.slice(0, limit), offset, hasMore: rows.length > limit };
    }
}
