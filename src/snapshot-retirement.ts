import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from './http-error.js';
import type { Account, IdentityDirectory } from './identity.js';
import { availableProject } from './project-retirement.js';

const batchSize = 25;
const interval = 60_000;
const defaultRetention = 7 * 24 * 60 * 60;
type Change = 'retire' | 'restore' | 'purge';
type SnapshotLifecycle = { id: string; projectId: string; runId: string; publishedAt: string;
    revision: number; retiredAt: number | null; collectAfter: number | null };
const references = `SELECT 1 FROM knowledge_lineage WHERE parent_id = ks.id
    UNION ALL SELECT 1 FROM project_space_repository WHERE snapshot_id = ks.id AND active = 1
    UNION ALL SELECT 1 FROM wiki_document w JOIN wiki_page_draft d ON d.page_id = w.id
        WHERE w.run_id = ks.run_id AND d.state = 'PENDING'
    UNION ALL SELECT 1 FROM durable_job j WHERE j.project_id = ks.project_id AND j.state IN ('QUEUED','RUNNING','PAUSED') AND (
        (j.kind = 'ISOLATED_VERIFICATION' AND json_extract(j.input, '$.snapshotId') = ks.id)
        OR (j.kind = 'CHANGE_REVIEW' AND EXISTS (SELECT 1 FROM change_review cr
            WHERE cr.id = json_extract(j.input, '$.reviewId') AND cr.project_id = j.project_id
            AND (json_extract(cr.payload, '$.provenance.targetSnapshotId') = ks.id OR json_extract(cr.payload, '$.provenance.baseSnapshotId') = ks.id)))
    )
    UNION ALL SELECT 1 FROM ask_session s WHERE (s.expires_at > ? OR EXISTS (
        SELECT 1 FROM ask_turn t WHERE t.session_id = s.id AND t.status IN ('QUEUED','RUNNING')
    )) AND (EXISTS (SELECT 1 FROM json_each(s.scope, '$.repositories') r WHERE json_extract(r.value, '$.snapshotId') = ks.id)
        OR EXISTS (SELECT 1 FROM change_review cr WHERE cr.id = json_extract(s.scope, '$.review.reviewId') AND cr.project_id = ks.project_id
            AND (json_extract(cr.payload, '$.provenance.targetSnapshotId') = ks.id OR json_extract(cr.payload, '$.provenance.baseSnapshotId') = ks.id)))
    LIMIT 1`;

function retentionSeconds(value: string | undefined) {
    if (value === undefined) return defaultRetention;
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number > 365 * 24 * 60 * 60) {
        throw new Error('Invalid REPOGRAPH_SNAPSHOT_RETENTION_SECONDS');
    }
    return number;
}

export class SnapshotRetirement {
    private readonly retention = retentionSeconds(process.env.REPOGRAPH_SNAPSHOT_RETENTION_SECONDS) * 1000;
    private timer?: NodeJS.Timeout;

    constructor(private readonly db: DatabaseSync, private readonly identity: IdentityDirectory) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS knowledge_retirement (
                snapshot_id TEXT PRIMARY KEY REFERENCES knowledge_snapshot(id) ON DELETE CASCADE,
                revision INTEGER NOT NULL, retired_at INTEGER, collect_after INTEGER
            );
            CREATE INDEX IF NOT EXISTS knowledge_retirement_due ON knowledge_retirement(collect_after) WHERE retired_at IS NOT NULL;
            CREATE INDEX IF NOT EXISTS knowledge_lineage_parent ON knowledge_lineage(parent_id);
            CREATE TABLE IF NOT EXISTS knowledge_retirement_receipt (
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE, actor_id TEXT NOT NULL,
                request_key TEXT NOT NULL, snapshot_id TEXT NOT NULL, action TEXT NOT NULL, base_revision INTEGER NOT NULL,
                result TEXT NOT NULL, PRIMARY KEY(project_id, actor_id, request_key)
            );
        `);
    }

    private transaction<T>(operation: () => T) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = operation();
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    private read(projectId: string, id: string) {
        const snapshot = this.db.prepare(`SELECT ks.id, ks.project_id AS projectId, ks.run_id AS runId,
            ks.published_at AS publishedAt, coalesce(r.revision, 0) AS revision, r.retired_at AS retiredAt,
            r.collect_after AS collectAfter FROM knowledge_snapshot ks LEFT JOIN knowledge_retirement r ON r.snapshot_id = ks.id
            WHERE ks.id = ? AND ks.project_id = ? AND ks.published_at IS NOT NULL`).get(id, projectId) as SnapshotLifecycle | undefined;
        if (!snapshot) throw new HttpError(404, 'SNAPSHOT_NOT_FOUND');
        return snapshot;
    }

    describe(actor: Account, projectId: string, id: string) {
        this.identity.requireProjectManager(actor, projectId);
        return this.read(projectId, id);
    }

    retired(actor: Account, projectId: string, limit: number, offset: number) {
        this.identity.requireProjectManager(actor, projectId);
        const results = this.db.prepare(`SELECT ks.id, ks.project_id AS projectId, ks.run_id AS runId, ks.published_at AS publishedAt,
            r.revision, r.retired_at AS retiredAt, r.collect_after AS collectAfter
            FROM knowledge_retirement r JOIN knowledge_snapshot ks ON ks.id = r.snapshot_id
            WHERE ks.project_id = ? AND r.retired_at IS NOT NULL ORDER BY r.retired_at DESC, ks.rowid DESC LIMIT ? OFFSET ?`)
            .all(projectId, limit + 1, offset) as SnapshotLifecycle[];
        return { snapshots: results.slice(0, limit), offset, hasMore: results.length > limit };
    }

    change(actor: Account, projectId: string, id: string, action: Change, revision: number, key: string) {
        return this.transaction(() => {
            this.identity.requireProjectManager(actor, projectId);
            const prior = this.db.prepare(`SELECT snapshot_id, action, base_revision, result FROM knowledge_retirement_receipt
                WHERE project_id = ? AND actor_id = ? AND request_key = ?`).get(projectId, actor.id, key);
            if (prior) {
                if (prior.snapshot_id !== id || prior.action !== action || prior.base_revision !== revision) {
                    throw new HttpError(409, 'SNAPSHOT_REQUEST_CONFLICT');
                }
                return JSON.parse(String(prior.result)) as unknown;
            }
            const snapshot = this.read(projectId, id);
            if (snapshot.revision !== revision) throw new HttpError(409, 'SNAPSHOT_REVISION_CHANGED');
            const now = Date.now();
            let result: unknown;
            if (action === 'purge') {
                this.purge(snapshot, now);
                result = { id, projectId, purged: true };
            } else {
                const retiring = action === 'retire';
                if (retiring === (snapshot.retiredAt !== null)) throw new HttpError(409, 'SNAPSHOT_STATE_CHANGED');
                this.db.prepare(`INSERT INTO knowledge_retirement VALUES (?, ?, ?, ?)
                    ON CONFLICT(snapshot_id) DO UPDATE SET revision = excluded.revision, retired_at = excluded.retired_at,
                    collect_after = excluded.collect_after`).run(id, revision + 1, retiring ? now : null, retiring ? now + this.retention : null);
                result = this.read(projectId, id);
            }
            this.db.prepare('INSERT INTO knowledge_retirement_receipt VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(projectId, actor.id, key, id, action, revision, JSON.stringify(result));
            this.identity.record(actor.id, 'KNOWLEDGE_SNAPSHOT_' + action.toUpperCase(), id, projectId);
            return result;
        });
    }

    private purge(snapshot: SnapshotLifecycle, now: number) {
        if (typeof snapshot.collectAfter !== 'number' || snapshot.collectAfter > now) {
            throw new HttpError(409, 'SNAPSHOT_RETENTION_ACTIVE');
        }
        const id = snapshot.id;
        if (this.db.prepare(`SELECT 1 FROM knowledge_snapshot ks WHERE ks.id = ? AND EXISTS (${references})`).get(id, now)) {
            throw new HttpError(409, 'SNAPSHOT_REFERENCED');
        }
        this.db.prepare('DELETE FROM wiki_generation WHERE run_id = ? AND project_id = ?').run(snapshot.runId, snapshot.projectId);
        this.db.prepare('DELETE FROM knowledge_snapshot WHERE id = ?').run(id);
    }

    collect() {
        const now = Date.now();
        this.transaction(() => {
            const abandoned = this.db.prepare(`SELECT ks.id FROM knowledge_snapshot ks JOIN agent_run ar ON ar.id = ks.run_id
                WHERE ks.published_at IS NULL AND ks.created_at <= ? AND ar.status IN ('FAILED','CANCELLED','PARTIAL','COMPLETED')
                    AND NOT EXISTS (SELECT 1 FROM durable_job job WHERE job.id = ks.run_id AND job.state IN ('QUEUED','RUNNING','PAUSED'))
                    AND NOT EXISTS (${references}) ORDER BY ks.created_at, ks.id LIMIT ?`)
                .all(new Date(now - this.retention).toISOString(), now, batchSize);
            const remove = this.db.prepare('DELETE FROM knowledge_snapshot WHERE id = ? AND published_at IS NULL');
            for (const candidate of abandoned) remove.run(candidate.id);
        });
        const candidates = this.db.prepare(`SELECT ks.id, ks.project_id AS projectId
            FROM knowledge_retirement r JOIN knowledge_snapshot ks ON ks.id = r.snapshot_id
            WHERE r.collect_after <= ? AND NOT EXISTS (${references})
                AND ${availableProject('ks.project_id')}
            ORDER BY r.collect_after LIMIT ?`).all(now, now, batchSize);
        for (const entry of candidates) {
            try {
                this.transaction(() => {
                    const snapshot = this.read(String(entry.projectId), String(entry.id));
                    this.identity.requireAvailableProject(snapshot.projectId);
                    this.purge(snapshot, now);
                    this.identity.record('system', 'KNOWLEDGE_SNAPSHOT_PURGE', snapshot.id, snapshot.projectId);
                });
            } catch (error) {
                if (!(error instanceof HttpError && [404, 409].includes(error.status))) throw error;
            }
        }
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => {
            try { this.collect(); }
            catch { console.error('Failed to collect retired knowledge snapshots'); }
        }, interval).unref();
    }

    close() { clearInterval(this.timer); }
}
