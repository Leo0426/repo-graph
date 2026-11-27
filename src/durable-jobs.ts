import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from './http-error.js';
import { availableProject, ensureProjectRetirement } from './project-retirement.js';

type JobState = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'CANCELLED' | 'FINISHED' | 'FAILED';
type StopState = 'PAUSED' | 'CANCELLED';
export type JobAction = 'pause' | 'resume' | 'cancel' | 'prioritize';
export type JobLease = { id: string; leaseId: string; attempt: number; deadline: number };
const MAX_ATTEMPTS = 5;

interface JobRequest<T> {
    id: string;
    projectId: string;
    actorId: string;
    kind: string;
    key?: string;
    fingerprint: string;
    input: T;
    availableAt: number;
    budgetMs: number;
    priority?: number;
}

function jobStatus(row: Record<string, unknown>) {
    return {
        id: String(row.id), projectId: String(row.project_id), actorId: String(row.actor_id),
        state: row.state as JobState, stopRequested: row.stop_requested as StopState | null,
        availableAt: Number(row.available_at), priority: Number(row.priority), revision: Number(row.revision),
        attempt: Number(row.attempt)
    };
}

export class DurableJobs<T> {
    private readonly table: 'durable_job' | 'ask_job';
    private readonly attempts: 'durable_job_attempt' | 'ask_job_attempt';

    constructor(private readonly db: DatabaseSync, private readonly now = Date.now, namespace: 'repository' | 'conversation' = 'repository') {
        this.table = namespace === 'conversation' ? 'ask_job' : 'durable_job';
        if (namespace === 'repository') ensureProjectRetirement(db);
        this.attempts = namespace === 'conversation' ? 'ask_job_attempt' : 'durable_job_attempt';
        const run = namespace === 'conversation' ? 'ask_turn' : 'agent_run';
        const scope = namespace === 'conversation' ? 'ask_session' : 'project';
        db.exec(`
            CREATE TABLE IF NOT EXISTS ${this.table} (
                id TEXT PRIMARY KEY REFERENCES ${run}(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL REFERENCES ${scope}(id) ON DELETE CASCADE,
                actor_id TEXT NOT NULL, kind TEXT NOT NULL,
                request_key TEXT, fingerprint TEXT NOT NULL, input TEXT NOT NULL,
                state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','PAUSED','CANCELLED','FINISHED','FAILED')),
                stop_requested TEXT CHECK(stop_requested IN ('PAUSED','CANCELLED')),
                available_at INTEGER NOT NULL, priority INTEGER NOT NULL, budget_ms INTEGER NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0,
                lease_id TEXT, lease_expires INTEGER, deadline_at INTEGER,
                UNIQUE(kind, project_id, actor_id, request_key)
            );
            CREATE INDEX IF NOT EXISTS ${this.table}_dispatch ON ${this.table}(kind, state, priority DESC, available_at);
            CREATE INDEX IF NOT EXISTS ${this.table}_project ON ${this.table}(project_id, kind, state);
            CREATE TABLE IF NOT EXISTS ${this.attempts} (
                job_id TEXT NOT NULL REFERENCES ${this.table}(id) ON DELETE CASCADE,
                number INTEGER NOT NULL, lease_id TEXT NOT NULL,
                claimed_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
                outcome TEXT CHECK(outcome IN ('QUEUED','PAUSED','CANCELLED','FINISHED','FAILED','LEASE_EXPIRED')),
                result_hash TEXT, PRIMARY KEY(job_id, number)
            );
        `);
    }

    private atomic<R>(operation: () => R) {
        this.db.exec('SAVEPOINT job_attempt_transition');
        try {
            const result = operation();
            this.db.exec('RELEASE job_attempt_transition');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK TO job_attempt_transition; RELEASE job_attempt_transition');
            throw error;
        }
    }

    history(id: string) {
        return this.db.prepare(`SELECT number, claimed_at AS claimedAt, started_at AS startedAt, finished_at AS finishedAt,
            outcome, result_hash AS resultHash FROM ${this.attempts} WHERE job_id = ? ORDER BY number`).all(id);
    }

    private end(id: string, number: number, now: number, outcome: JobState | 'LEASE_EXPIRED', resultHash?: string) {
        this.db.prepare(`UPDATE ${this.attempts} SET finished_at = ?, outcome = ?, result_hash = ?
            WHERE job_id = ? AND number = ? AND finished_at IS NULL`).run(now, outcome, resultHash ?? null, id, number);
    }

    enqueue(request: JobRequest<T>) {
        this.db.prepare(`
            INSERT INTO ${this.table}(id, project_id, actor_id, kind, request_key, fingerprint, input, state, available_at, priority, budget_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)
        `).run(request.id, request.projectId, request.actorId, request.kind, request.key ?? null, request.fingerprint,
            JSON.stringify(request.input), request.availableAt, request.priority ?? 0, request.budgetMs);
    }

    findRequest(kind: string, projectId: string, actorId: string, key: string, fingerprint: string) {
        const row = this.db.prepare(`
            SELECT id, fingerprint FROM ${this.table} WHERE kind = ? AND project_id = ? AND actor_id = ? AND request_key = ?
        `).get(kind, projectId, actorId, key);
        if (row && row.fingerprint !== fingerprint) throw new HttpError(409, 'JOB_REQUEST_CONFLICT');
        return row ? String(row.id) : undefined;
    }

    get(id: string) {
        const row = this.db.prepare(`SELECT * FROM ${this.table} WHERE id = ?`).get(id);
        return row && jobStatus(row);
    }

    hasActive(kind: string, projectId: string) {
        return !!this.db.prepare(`
            SELECT 1 FROM ${this.table} WHERE kind = ? AND project_id = ? AND state IN ('QUEUED','RUNNING','PAUSED') LIMIT 1
        `).get(kind, projectId);
    }

    pending(kind: string) {
        return Number(this.db.prepare(`SELECT count(*) AS n FROM ${this.table}
            WHERE kind = ? AND state IN ('QUEUED','RUNNING','PAUSED')`).get(kind)?.n ?? 0);
    }

    clearInput(id: string) {
        this.db.prepare(`UPDATE ${this.table} SET input = 'null' WHERE id = ? AND state IN ('CANCELLED','FINISHED','FAILED')`).run(id);
    }

    claim(kind: string, capacity: number, leaseMs: number, active: readonly string[] = [], reclaim = true) {
        const now = this.now();
        return this.atomic(() => {
            const row = this.db.prepare(`
            UPDATE ${this.table} SET state = 'RUNNING', attempt = attempt + 1, revision = revision + 1,
                lease_id = ?, lease_expires = ?, deadline_at = coalesce(deadline_at, ? + budget_ms)
            WHERE id = (
                SELECT id FROM ${this.table} WHERE kind = ? AND available_at <= ? AND stop_requested IS NULL
                    AND attempt < ? AND (deadline_at IS NULL OR deadline_at > ?)
                    AND (state = 'QUEUED' OR (? AND state = 'RUNNING' AND lease_expires <= ?))
                    AND id NOT IN (SELECT value FROM json_each(?))
                    ${this.table === 'durable_job' ? `AND ${availableProject('durable_job.project_id')}` : ''}
                ORDER BY priority DESC, available_at, rowid LIMIT 1
            ) AND (SELECT count(*) FROM ${this.table} WHERE kind = ? AND state = 'RUNNING' AND lease_expires > ?) < ?
            RETURNING *
        `).get(randomUUID(), now + leaseMs, now, kind, now, MAX_ATTEMPTS, now, Number(reclaim), now, JSON.stringify(active), kind, now, capacity);
            if (!row) return undefined;
            const job = jobStatus(row);
            const leaseId = String(row.lease_id);
            this.end(job.id, job.attempt - 1, now, 'LEASE_EXPIRED');
            this.db.prepare(`INSERT INTO ${this.attempts}(job_id, number, lease_id, claimed_at) VALUES (?, ?, ?, ?)`)
                .run(job.id, job.attempt, leaseId, now);
            return { ...job, leaseId, deadline: Number(row.deadline_at), input: JSON.parse(String(row.input)) as T };
        });
    }

    expired(kind: string): JobLease | undefined {
        const row = this.db.prepare(`SELECT id, lease_id AS leaseId, attempt, deadline_at AS deadline FROM ${this.table}
            WHERE kind = ? AND state = 'RUNNING' AND lease_expires <= ? ORDER BY lease_expires LIMIT 1`).get(kind, this.now());
        return row as unknown as JobLease | undefined;
    }

    recoverAfterExit(lease: JobLease) {
        const now = this.now();
        return this.atomic(() => {
            const row = this.db.prepare(`UPDATE ${this.table} SET state = coalesce(stop_requested,
                CASE WHEN attempt >= ? OR deadline_at <= ? THEN 'FAILED' ELSE 'QUEUED' END), stop_requested = NULL,
                budget_ms = max(0, deadline_at - ?), deadline_at = NULL, lease_id = NULL, lease_expires = NULL, revision = revision + 1
                WHERE id = ? AND state = 'RUNNING' AND lease_id = ? AND attempt = ? AND lease_expires <= ? RETURNING *`)
                .get(MAX_ATTEMPTS, now, now, lease.id, lease.leaseId, lease.attempt, now);
            if (!row) return undefined;
            const job = jobStatus(row);
            this.end(job.id, job.attempt, now, 'LEASE_EXPIRED');
            return job;
        });
    }

    begin(lease: JobLease) {
        const now = this.now();
        return this.atomic(() => {
            this.assertRunnable(lease);
            this.db.prepare(`UPDATE ${this.attempts} SET started_at = coalesce(started_at, ?)
                WHERE job_id = ? AND number = ? AND lease_id = ? AND finished_at IS NULL`)
                .run(now, lease.id, lease.attempt, lease.leaseId);
        });
    }

    renew(lease: JobLease, leaseMs: number) {
        const now = this.now();
        const row = this.db.prepare(`
            UPDATE ${this.table} SET lease_expires = ? WHERE id = ? AND state = 'RUNNING' AND lease_id = ? AND attempt = ?
                AND lease_expires > ? AND deadline_at > ? RETURNING stop_requested
        `).get(now + leaseMs, lease.id, lease.leaseId, lease.attempt, now, now);
        return row ? { stopRequested: row.stop_requested as StopState | null } : undefined;
    }

    assertLease(lease: JobLease) {
        const row = this.db.prepare(`
            SELECT stop_requested FROM ${this.table} WHERE id = ? AND state = 'RUNNING' AND lease_id = ?
                AND attempt = ? AND lease_expires > ?
        `).get(lease.id, lease.leaseId, lease.attempt, this.now());
        if (!row) throw new HttpError(409, 'JOB_LEASE_LOST');
        return row.stop_requested as StopState | null;
    }

    assertRunnable(lease: JobLease) {
        if (this.assertLease(lease)) throw new HttpError(409, 'JOB_STOP_REQUESTED');
        if (this.now() >= lease.deadline) throw new HttpError(409, 'JOB_DEADLINE_EXPIRED');
    }

    leaseActive(leaseId: string) {
        return !!this.db.prepare(`SELECT 1 FROM ${this.table} WHERE state = 'RUNNING' AND lease_id = ? AND lease_expires > ?`)
            .get(leaseId, this.now());
    }

    finish(lease: JobLease, outcome: 'FINISHED' | 'FAILED' | 'QUEUED', resultHash?: string) {
        if (resultHash !== undefined && (outcome !== 'FINISHED' || !/^[a-f0-9]{64}$/.test(resultHash))) {
            throw new HttpError(400, 'JOB_INVALID_RESULT_HASH');
        }
        const now = this.now();
        return this.atomic(() => {
            const row = this.db.prepare(`
            UPDATE ${this.table} SET state = coalesce(stop_requested, ?), stop_requested = NULL,
                budget_ms = max(0, deadline_at - ?), deadline_at = NULL, lease_id = NULL, lease_expires = NULL,
                revision = revision + 1
            WHERE id = ? AND state = 'RUNNING' AND lease_id = ? AND attempt = ? AND lease_expires > ?
                AND (? <> 'FINISHED' OR (stop_requested IS NULL AND deadline_at > ?))
            RETURNING *
        `).get(outcome, now, lease.id, lease.leaseId, lease.attempt, now, outcome, now);
            if (row) {
                const job = jobStatus(row);
                this.end(job.id, job.attempt, now, job.state, resultHash);
                return job;
            }
            if (resultHash) {
                const receipt = this.db.prepare(`SELECT result_hash FROM ${this.attempts}
                    WHERE job_id = ? AND number = ? AND lease_id = ? AND outcome = 'FINISHED'`)
                    .get(lease.id, lease.attempt, lease.leaseId);
                if (receipt) {
                    if (receipt.result_hash !== resultHash) throw new HttpError(409, 'JOB_RESULT_CONFLICT');
                    return this.get(lease.id)!;
                }
            }
            if (outcome === 'FINISHED') this.assertRunnable(lease);
            throw new HttpError(409, 'JOB_LEASE_LOST');
        });
    }

    change(id: string, revision: number, action: JobAction, priority?: number) {
        if (action === 'prioritize') {
            if (priority === undefined) throw new HttpError(400, 'JOB_PRIORITY_REQUIRED');
            const row = this.db.prepare(`
                UPDATE ${this.table} SET priority = ?, revision = revision + 1
                WHERE id = ? AND revision = ? AND state IN ('QUEUED','PAUSED') RETURNING *
            `).get(priority, id, revision);
            if (!row) throw new HttpError(409, 'JOB_CHANGED_OR_ACTION_UNAVAILABLE');
            return jobStatus(row);
        }
        const target: JobState = action === 'resume' ? 'QUEUED' : action === 'pause' ? 'PAUSED' : 'CANCELLED';
        const eligible = action === 'resume' ? "state = 'PAUSED'" : action === 'pause'
            ? "state IN ('QUEUED','RUNNING') AND stop_requested IS NULL"
            : "state IN ('QUEUED','RUNNING','PAUSED') AND stop_requested IS NOT 'CANCELLED'";
        const row = this.db.prepare(`
            UPDATE ${this.table} SET state = CASE WHEN state = 'RUNNING' THEN state ELSE ? END,
                stop_requested = CASE WHEN state = 'RUNNING' THEN ? ELSE NULL END,
                priority = coalesce(?, priority),
                available_at = CASE WHEN state = 'PAUSED' AND ? = 'QUEUED' THEN max(available_at, ?) ELSE available_at END,
                revision = revision + 1
            WHERE id = ? AND revision = ? AND ${eligible} RETURNING *
        `).get(target, target, priority ?? null, target, this.now(), id, revision);
        if (!row) throw new HttpError(409, 'JOB_CHANGED_OR_ACTION_UNAVAILABLE');
        return jobStatus(row);
    }

    reconcile(kind: string, includeRunning = true) {
        const now = this.now();
        return this.atomic(() => this.db.prepare(`
            UPDATE ${this.table} SET state = coalesce(stop_requested, 'FAILED'), stop_requested = NULL,
                budget_ms = max(0, min(budget_ms, coalesce(deadline_at - ?, budget_ms))),
                deadline_at = NULL, lease_id = NULL, lease_expires = NULL, revision = revision + 1
            WHERE kind = ? AND ((? AND state = 'RUNNING' AND lease_expires <= ? AND
                (stop_requested IS NOT NULL OR attempt >= ? OR deadline_at <= ?)) OR
                (state = 'QUEUED' AND (attempt >= ? OR budget_ms <= 0)))
            RETURNING *
        `).all(now, kind, Number(includeRunning), now, MAX_ATTEMPTS, now, MAX_ATTEMPTS).map(row => {
            const job = jobStatus(row);
            this.end(job.id, job.attempt, now, job.state === 'FAILED' ? 'LEASE_EXPIRED' : job.state);
            return { ...job, exhausted: Number(row.budget_ms) <= 0 };
        }));
    }
}
