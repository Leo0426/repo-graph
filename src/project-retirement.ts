import { basename } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import { HttpError } from './http-error.js';
import type { Account, IdentityDirectory } from './identity.js';

export const projectLifecycleInput = z.object({ action: z.enum(['trash', 'restore', 'purge']), revision: z.int().nonnegative() }).strict();
type Action = z.infer<typeof projectLifecycleInput>['action'];
type State = 'ACTIVE' | 'TRASHED' | 'PURGING' | 'PURGED';
type Source = 'LOCAL' | 'ARCHIVE' | 'GIT';
type Lifecycle = { projectId: string; name: string; source: Source; state: State; revision: number;
    trashedAt: number | null; purgeAfter: number | null };
type Cleanup = { projectId: string; source: Source; sourceId: string | null };
const defaultRetention = 7 * 24 * 60 * 60;

export function ensureProjectRetirement(db: DatabaseSync) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS project_retirement (
            project_id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('LOCAL','ARCHIVE','GIT')),
            state TEXT NOT NULL CHECK (state IN ('ACTIVE','TRASHED','PURGING','PURGED')),
            revision INTEGER NOT NULL, trashed_at INTEGER, purge_after INTEGER, cleanup_id TEXT, purge_actor TEXT
        );
        CREATE INDEX IF NOT EXISTS project_retirement_state ON project_retirement(state, trashed_at);
        CREATE TABLE IF NOT EXISTS project_retirement_receipt (
            project_id TEXT NOT NULL, actor_id TEXT NOT NULL, key TEXT NOT NULL, action TEXT NOT NULL, revision INTEGER NOT NULL,
            result TEXT NOT NULL, PRIMARY KEY(project_id, actor_id, key)
        );
    `);
}

// Callers pass a trusted SQL column reference, never a request value.
export function availableProject(column: string) {
    return `NOT EXISTS (SELECT 1 FROM project_retirement pr WHERE pr.project_id = ${column} AND pr.state <> 'ACTIVE')`;
}

function retentionSeconds(value: string | undefined) {
    if (value === undefined) return defaultRetention;
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number > 365 * 24 * 60 * 60) {
        throw new Error('Invalid REPOGRAPH_PROJECT_RETENTION_SECONDS');
    }
    return number;
}

const columns = `project_id AS projectId, name, source, state, revision, trashed_at AS trashedAt, purge_after AS purgeAfter`;

export class ProjectRetirement {
    private readonly retention = retentionSeconds(process.env.REPOGRAPH_PROJECT_RETENTION_SECONDS) * 1000;
    private readonly pending = new Map<string, Promise<void>>();
    private timer?: NodeJS.Timeout;
    private closing = false;

    constructor(private readonly db: DatabaseSync, private readonly identity: IdentityDirectory,
        private readonly workPending: (project: string) => boolean, private readonly remove: (cleanup: Cleanup) => Promise<void>,
        private readonly visibilityChanged: (project: string, active: boolean) => void) {}

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

    private stored(id: string) {
        return this.db.prepare(`SELECT ${columns}, purge_actor AS purgeActor FROM project_retirement WHERE project_id = ?`)
            .get(id) as unknown as (Lifecycle & { purgeActor: string | null }) | undefined;
    }

    private active(id: string) {
        const row = this.db.prepare(`SELECT p.root, g.name AS gitName, g.id AS gitId, a.id AS assetId, coalesce(n.display_name, a.filename) AS archiveName
            FROM project p LEFT JOIN git_repository g ON g.project_id = p.id
            LEFT JOIN managed_asset a ON a.project_id = p.id LEFT JOIN managed_asset_name n ON n.asset_id = a.id
            WHERE p.id = ?`).get(id);
        if (!row) throw new HttpError(404, 'PROJECT_NOT_FOUND');
        const source: Source = row.gitId ? 'GIT' : row.assetId ? 'ARCHIVE' : 'LOCAL';
        const name = String(row.gitName ?? row.archiveName ?? (basename(String(row.root)) || id));
        const sourceId = row.gitId ?? row.assetId ?? null;
        return { name, source, sourceId: sourceId === null ? null : String(sourceId) };
    }

    isPurged(project: string) {
        return !!this.db.prepare("SELECT 1 FROM project_retirement WHERE project_id = ? AND state IN ('PURGING','PURGED')").get(project);
    }

    private authorize(actor: Account, id: string, record = this.stored(id)) {
        if (record?.state === 'PURGED' || record?.state === 'PURGING') {
            const current = this.identity.requireCurrent(actor);
            if (current.role !== 'ADMIN' && record.purgeActor !== current.id) throw new HttpError(404, 'PROJECT_NOT_FOUND');
        } else this.identity.requireProjectManager(actor, id, { includeRetired: true });
    }

    describe(actor: Account, id: string): Lifecycle {
        const record = this.stored(id);
        this.authorize(actor, id, record);
        if (record) {
            const { purgeActor: _, ...visible } = record;
            return visible;
        }
        const { name, source } = this.active(id);
        return { projectId: id, name, source, state: 'ACTIVE', revision: 0, trashedAt: null, purgeAfter: null };
    }

    list(actor: Account, limit: number, offset: number) {
        this.identity.requireCurrent(actor);
        const results: Lifecycle[] = [];
        let skipped = 0;
        const rows = this.db.prepare(`SELECT project_id AS id FROM project_retirement
            WHERE state IN ('TRASHED','PURGING') ORDER BY trashed_at DESC, project_id`).iterate();
        for (const row of rows) {
            try {
                const state = this.describe(actor, String(row.id));
                if (skipped < offset) { skipped++; continue; }
                results.push(state);
                if (results.length > limit) break;
            } catch (error) {
                if (!(error instanceof HttpError && [403, 404].includes(error.status))) throw error;
            }
        }
        return { projects: results.slice(0, limit), offset, hasMore: results.length > limit };
    }

    private requireIdle(id: string, purge: boolean) {
        const running = this.db.prepare(`SELECT 1 FROM index_status WHERE project_id = ?1 AND status = 'running'
            UNION ALL SELECT 1 FROM agent_run WHERE project_id = ?1 AND
                (status = 'RUNNING' OR (status = 'QUEUED' AND NOT EXISTS (SELECT 1 FROM durable_job WHERE id = agent_run.id)))
            UNION ALL SELECT 1 FROM durable_job WHERE project_id = ?1 AND (state = 'RUNNING' OR (?2 = 1 AND state IN ('QUEUED','PAUSED')))
            LIMIT 1`).get({ 1: id, 2: Number(purge) });
        if (running || this.workPending(id)) throw new HttpError(409, 'PROJECT_WORK_PENDING');
    }

    private requireUnreferenced(id: string, now: number) {
        const referenced = this.db.prepare(`
            SELECT 1 FROM project_space_repository WHERE project_id = ?1 AND active = 1
            UNION ALL SELECT 1 FROM knowledge_lineage l JOIN knowledge_snapshot parent ON parent.id = l.parent_id
                JOIN knowledge_snapshot child ON child.id = l.snapshot_id WHERE parent.project_id = ?1 AND child.project_id <> ?1
            UNION ALL SELECT 1 FROM wiki_page_draft d JOIN wiki_document w ON w.id = d.page_id WHERE w.project_id = ?1 AND d.state = 'PENDING'
            UNION ALL SELECT 1 FROM git_publication p JOIN git_sync s ON s.run_id = p.sync_run_id
                JOIN git_repository r ON r.id = s.binding_id WHERE r.project_id = ?1 AND p.state = 'PENDING'
            UNION ALL SELECT 1 FROM ask_session s
                WHERE (json_extract(s.scope, '$.review.projectId') = ?1 OR EXISTS (
                    SELECT 1 FROM json_each(s.scope, '$.repositories') r WHERE json_extract(r.value, '$.projectId') = ?1
                )) AND (s.expires_at > ?2 OR EXISTS (
                    SELECT 1 FROM ask_turn t WHERE t.session_id = s.id AND t.status IN ('QUEUED','RUNNING')
                )) LIMIT 1`).get({ 1: id, 2: now });
        if (referenced) throw new HttpError(409, 'PROJECT_STILL_REFERENCED');
    }

    change(actor: Account, id: string, action: Action, revision: number, key: string): Lifecycle {
        const { result, changed } = this.transaction(() => {
            const current = this.describe(actor, id);
            const prior = this.db.prepare(`SELECT action, revision, result FROM project_retirement_receipt
                WHERE project_id = ? AND actor_id = ? AND key = ?`).get(id, actor.id, key);
            if (prior) {
                if (prior.action !== action || prior.revision !== revision) throw new HttpError(409, 'PROJECT_LIFECYCLE_REQUEST_CONFLICT');
                return { changed: false, result: JSON.parse(String(prior.result)) as Lifecycle };
            }
            if (current.revision !== revision) throw new HttpError(409, 'PROJECT_LIFECYCLE_CHANGED');
            if (current.state !== (action === 'trash' ? 'ACTIVE' : 'TRASHED')) throw new HttpError(409, 'PROJECT_LIFECYCLE_STATE');
            const now = Date.now();
            const { name, source, sourceId } = this.active(id);
            let state: State, trashedAt = current.trashedAt, purgeAfter = current.purgeAfter, removeId: SQLInputValue = null;
            if (action === 'trash') {
                this.requireIdle(id, false);
                state = 'TRASHED';
                trashedAt = now;
                purgeAfter = now + this.retention;
            } else if (action === 'restore') {
                state = 'ACTIVE';
                trashedAt = purgeAfter = null;
            } else {
                if (purgeAfter === null || purgeAfter > now) throw new HttpError(409, 'PROJECT_RETENTION_ACTIVE');
                this.requireIdle(id, true);
                this.requireUnreferenced(id, now);
                if (source === 'ARCHIVE') this.db.prepare('UPDATE managed_asset SET deleting = 1 WHERE id = ?').run(sourceId);
                this.db.prepare('DELETE FROM project WHERE id = ?').run(id);
                this.db.prepare(`DELETE FROM knowledge_blob WHERE NOT EXISTS (SELECT 1 FROM knowledge_source s WHERE s.hash = knowledge_blob.hash)
                    AND NOT EXISTS (SELECT 1 FROM indexed_source s WHERE s.hash = knowledge_blob.hash)`).run();
                state = sourceId ? 'PURGING' : 'PURGED';
                removeId = sourceId;
            }
            this.db.prepare(`INSERT INTO project_retirement VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id) DO UPDATE SET name = excluded.name, source = excluded.source, state = excluded.state,
                    revision = excluded.revision, trashed_at = excluded.trashed_at, purge_after = excluded.purge_after,
                    cleanup_id = excluded.cleanup_id, purge_actor = excluded.purge_actor`)
                .run(id, name, source, state, revision + 1, trashedAt, purgeAfter, removeId, action === 'purge' ? actor.id : null);
            const result = { projectId: id, name, source, state, revision: revision + 1, trashedAt, purgeAfter };
            this.db.prepare('INSERT INTO project_retirement_receipt VALUES (?, ?, ?, ?, ?, ?)')
                .run(id, actor.id, key, action, revision, JSON.stringify(result));
            this.identity.record(actor.id, 'PROJECT_' + action.toUpperCase(), id, state);
            return { changed: true, result };
        });
        if (changed && action !== 'purge') this.visibilityChanged(id, action === 'restore');
        if (action === 'purge') this.collect();
        return result;
    }

    collect() {
        if (this.closing || this.pending.size >= 4) return;
        const rows = this.db.prepare(`SELECT project_id AS projectId, source, cleanup_id AS sourceId FROM project_retirement
            WHERE state = 'PURGING' ORDER BY trashed_at LIMIT 20`).all() as unknown as Cleanup[];
        for (const row of rows) {
            if (this.pending.has(row.projectId)) continue;
            const work = this.remove(row).then(() => {
                this.transaction(() => {
                    this.db.prepare(`UPDATE project_retirement SET state = 'PURGED', cleanup_id = NULL WHERE project_id = ? AND state = 'PURGING'`)
                        .run(row.projectId);
                    this.identity.record('system', 'PROJECT_STORAGE_COLLECTED', row.projectId, row.source);
                });
            }).catch(() => console.error('Unable to collect deleted project storage')).finally(() => this.pending.delete(row.projectId));
            this.pending.set(row.projectId, work);
            if (this.pending.size >= 4) break;
        }
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => this.collect(), 5_000).unref();
        this.collect();
    }

    async close() {
        this.closing = true;
        clearInterval(this.timer);
        await Promise.all(this.pending.values());
    }
}
