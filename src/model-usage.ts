import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { localTimeWindowOpen } from './calendar-schedule.js';
import type { LocalTimeWindow } from './calendar-schedule.js';
import { HttpError } from './http-error.js';
import type { HostedEntitlements } from './hosted-entitlements.js';
import type { IdentityDirectory } from './identity.js';
import { defaultModelPool } from './model-providers.js';
import type { ModelProvider } from './model-providers.js';

export type ModelUse = {
    capability: 'WIKI' | 'WIKI_DRAFT' | 'SPACE_DOCUMENT' | 'ASK' | 'ARCHITECTURE' | 'CHANGE_REVIEW' | 'FINDING_REVIEW' | 'PROVIDER_TEST';
    actorId?: string;
    projectId?: string;
    projectIds?: readonly string[];
    runId?: string;
    phase?: string;
};
export type ModelUsageSample = { inputTokens: number | null; outputTokens: number | null; costUsd: number | null };
const noUsage: ModelUsageSample = { inputTokens: null, outputTokens: null, costUsd: null };
export const modelUsageEvidence = z.strictObject({ reference: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
    inputTokens: z.int().nonnegative().optional(), outputTokens: z.int().nonnegative().optional(), costUsd: z.number().min(0).max(1_000_000).optional()
}).refine(input => input.inputTokens !== undefined || input.outputTokens !== undefined || input.costUsd !== undefined);
type UsageEvidence = z.infer<typeof modelUsageEvidence>;

export class ModelUsage {
    constructor(private readonly db: DatabaseSync, private readonly identity: IdentityDirectory, private readonly entitlements?: HostedEntitlements) {
        db.function('model_window_open', { deterministic: true }, (configuration, clock) => Number(
            configuration === null || localTimeWindowOpen(JSON.parse(String(configuration)) as LocalTimeWindow, Number(clock))));
        db.exec(`
            CREATE TABLE IF NOT EXISTS model_invocation (
                id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, provider_revision TEXT NOT NULL,
                capability TEXT, phase TEXT, actor_id TEXT, organization_id TEXT, project_id TEXT, run_id TEXT,
                sent_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL, completed_at INTEGER,
                status TEXT NOT NULL CHECK(status IN ('SENDING','COMPLETED','FAILED')), reason TEXT,
                input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL
            );
            CREATE INDEX IF NOT EXISTS model_invocation_run ON model_invocation(run_id, sent_at);
            CREATE INDEX IF NOT EXISTS model_invocation_organization ON model_invocation(organization_id, sent_at);
            CREATE INDEX IF NOT EXISTS model_invocation_active ON model_invocation(deadline_at, provider_id) WHERE status = 'SENDING';
            CREATE TABLE IF NOT EXISTS model_usage_evidence (
                organization_id TEXT NOT NULL, reference TEXT NOT NULL, invocation_id TEXT NOT NULL REFERENCES model_invocation(id),
                actor_id TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, recorded_at INTEGER NOT NULL,
                PRIMARY KEY(organization_id, reference)
            );
            CREATE INDEX IF NOT EXISTS model_usage_evidence_invocation ON model_usage_evidence(invocation_id);
        `);
    }

    closedBackgroundPools() {
        return this.db.prepare(`SELECT id FROM model_provider
            WHERE json_extract(payload, '$.enabled') = 1
                AND model_window_open(json_extract(payload, '$.pool.backgroundWindow'), ?) = 0`)
            .all(Date.now()).map(row => String(row.id));
    }

    send(provider: ModelProvider, encryptedKey: string, use: ModelUse | undefined) {
        const id = randomUUID();
        const projectIds = use?.projectIds ?? (use?.projectId ? [use.projectId] : []);
        if (this.entitlements?.enabled && use && projectIds.length) {
            try {
                return this.entitlements.model({ id, taskId: use.runId, projectIds, capability: use.capability },
                    organization => this.insert(id, provider, encryptedKey, use, organization ?? null));
            } catch (error) {
                if (error instanceof HttpError) return { reason: error.message };
                throw error;
            }
        }
        const owner = use?.projectId ? this.identity.owner(use.projectId) : undefined;
        return this.insert(id, provider, encryptedKey, use, owner?.ownerType === 'ORGANIZATION' ? owner.ownerId : null);
    }

    private insert(id: string, provider: ModelProvider, encryptedKey: string, use: ModelUse | undefined, organization: string | null) {
        const now = Date.now();
        const diagnostic = use?.capability === 'PROVIDER_TEST';
        const interactive = use?.capability === 'ASK';
        const background = use?.capability === 'WIKI' || use?.capability === 'CHANGE_REVIEW' || use?.capability === 'FINDING_REVIEW';
        const result = this.db.prepare(`INSERT INTO model_invocation(id, provider_id, provider_revision, capability, phase,
            actor_id, organization_id, project_id, run_id, sent_at, deadline_at, status)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SENDING' FROM model_provider p
            WHERE p.id = ? AND p.encrypted_key = ? AND (? OR json_extract(p.payload,'$.enabled') = 1)
                AND (? = 0 OR model_window_open(json_extract(p.payload, '$.pool.backgroundWindow'), ?) = 1)
                AND (SELECT count(*) FROM model_invocation WHERE status = 'SENDING' AND deadline_at > ?) < ?
                AND (SELECT count(*) FROM model_invocation WHERE status = 'SENDING' AND deadline_at > ? AND provider_id = p.id)
                    < coalesce(json_extract(p.payload,'$.pool.maxConcurrent'), ?)
                AND (? OR (SELECT count(*) FROM model_invocation WHERE status = 'SENDING' AND deadline_at > ? AND provider_id = p.id
                    AND capability IS NOT 'ASK') < coalesce(json_extract(p.payload,'$.pool.maxConcurrent'), ?)
                    - coalesce(json_extract(p.payload,'$.pool.reservedAsk'), 0))`)
            .run(id, provider.id, provider.updatedAt, use?.capability ?? null, use?.phase ?? null, use?.actorId ?? null,
                organization, use?.projectId ?? null, use?.runId ?? null, now, now + provider.timeoutMillis,
                provider.id, encryptedKey, Number(diagnostic), Number(background), now, now, defaultModelPool.maxConcurrent,
                now, defaultModelPool.maxConcurrent, Number(interactive), now, defaultModelPool.maxConcurrent);
        if (result.changes) return { id };
        const allowed = this.db.prepare(`SELECT model_window_open(json_extract(payload, '$.pool.backgroundWindow'), ?) AS open
            FROM model_provider WHERE id = ? AND encrypted_key = ? AND (? OR json_extract(payload,'$.enabled') = 1)`)
            .get(now, provider.id, encryptedKey, Number(diagnostic));
        if (!allowed) return { reason: 'PROVIDER_ACCESS_CHANGED' };
        return { reason: background && !allowed.open ? 'PROVIDER_POOL_WINDOW_CLOSED' : 'PROVIDER_POOL_BUSY' };
    }

    settle(id: string, reason: string | null, usage: ModelUsageSample = noUsage) {
        this.db.prepare(`UPDATE model_invocation SET status = ?, reason = ?, completed_at = ?,
            input_tokens = ?, output_tokens = ?, cost_usd = ? WHERE id = ? AND status = 'SENDING'`)
            .run(reason ? 'FAILED' : 'COMPLETED', reason, Date.now(), usage.inputTokens, usage.outputTokens, usage.costUsd, id);
    }

    reconcile(organizationId: string, invocationId: string, actorId: string, evidence: UsageEvidence) {
        const { inputTokens = null, outputTokens = null, costUsd = null } = evidence;
        const receipt = (recordedAt: number) => ({ invocationId, reference: evidence.reference, recordedAt, inputTokens, outputTokens, costUsd });
        const now = Date.now();
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const entry = this.db.prepare(`SELECT m.* FROM model_invocation m JOIN hosted_entitlement_charge c
                ON c.kind = 'MODEL' AND c.id = m.id AND c.organization_id = m.organization_id
                WHERE m.id = ? AND m.organization_id = ?`).get(invocationId, organizationId);
            if (!entry) throw new HttpError(404, 'HOSTED_MODEL_INVOCATION_NOT_FOUND');
            const prior = this.db.prepare(`SELECT * FROM model_usage_evidence WHERE organization_id = ? AND reference = ?`)
                .get(organizationId, evidence.reference);
            if (prior) {
                if (prior.invocation_id !== invocationId || prior.input_tokens !== inputTokens || prior.output_tokens !== outputTokens || prior.cost_usd !== costUsd) {
                    throw new HttpError(409, 'HOSTED_USAGE_EVIDENCE_CONFLICT');
                }
                this.db.exec('COMMIT');
                return receipt(Number(prior.recorded_at));
            }
            if (entry.status === 'SENDING' && Number(entry.deadline_at) > now) throw new HttpError(409, 'HOSTED_MODEL_INVOCATION_RUNNING');
            const observed = this.db.prepare(`SELECT max(input_tokens) AS input_tokens, max(output_tokens) AS output_tokens,
                max(cost_usd) AS cost_usd FROM model_usage_evidence WHERE invocation_id = ?`).get(invocationId)!;
            for (const [field, measured] of [['input_tokens', inputTokens], ['output_tokens', outputTokens], ['cost_usd', costUsd]] as const) {
                const value = entry[field] ?? observed[field];
                if (measured !== null && value !== null && measured !== value) throw new HttpError(409, 'HOSTED_USAGE_EVIDENCE_CONFLICT');
            }
            this.db.prepare('INSERT INTO model_usage_evidence VALUES (?,?,?,?,?,?,?,?)').run(organizationId, evidence.reference, invocationId,
                actorId, inputTokens, outputTokens, costUsd, now);
            this.db.exec('COMMIT');
            return receipt(now);
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }

    list(limit: number, offset: number, runId?: string, organizationId?: string) {
        const now = Date.now();
        const rows = this.db.prepare(`SELECT id, provider_id AS providerId, provider_revision AS providerRevision,
            capability, phase, organization_id AS organizationId,
            CASE WHEN capability IS NOT 'ASK' THEN actor_id END AS actorId,
            CASE WHEN capability IS NOT 'ASK' THEN project_id END AS projectId,
            CASE WHEN capability IS NOT 'ASK' THEN run_id END AS runId,
            sent_at AS sentAt, completed_at AS completedAt,
            CASE WHEN status = 'SENDING' AND deadline_at <= ? THEN 'UNKNOWN' ELSE status END AS status,
            CASE WHEN status = 'SENDING' AND deadline_at <= ? THEN 'MODEL_OUTCOME_UNKNOWN' ELSE reason END AS reason,
            coalesce(input_tokens, (SELECT max(input_tokens) FROM model_usage_evidence e WHERE e.invocation_id = model_invocation.id)) AS inputTokens,
            coalesce(output_tokens, (SELECT max(output_tokens) FROM model_usage_evidence e WHERE e.invocation_id = model_invocation.id)) AS outputTokens,
            coalesce(cost_usd, (SELECT max(cost_usd) FROM model_usage_evidence e WHERE e.invocation_id = model_invocation.id)) AS costUsd,
            (SELECT max(recorded_at) FROM model_usage_evidence e WHERE e.invocation_id = model_invocation.id) AS reconciledAt
            FROM model_invocation WHERE (? IS NULL OR (capability IS NOT 'ASK' AND run_id = ?))
                AND (? IS NULL OR organization_id = ?)
            ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(now, now, runId ?? null, runId ?? null,
                organizationId ?? null, organizationId ?? null, limit + 1, offset);
        return { records: rows.slice(0, limit), offset, hasMore: rows.length > limit };
    }
}
