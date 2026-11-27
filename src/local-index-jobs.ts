import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { agentRunIdPattern } from './agent-runs.js';
import { DurableJobs } from './durable-jobs.js';
import type { JobAction } from './durable-jobs.js';
import { HttpError } from './http-error.js';
import type { Account } from './identity.js';
import type { IndexStatus, RepositoryIndex } from './index.js';
import { DispatcherHealth } from './operability.js';
import { digest } from './source.js';
import type { IndexLanguage, IndexStrategy } from './source.js';

export const localIndexPlaybook = 'LOCAL_INDEX';
const leaseMs = 4000;
const capacity = 2;
const maxPending = 12;
const jobBudget = 30 * 60_000;
const captureBudget = 10 * 60_000;
type Options = { languages: IndexLanguage[]; strategy: IndexStrategy; incremental: boolean };
export type FrozenIndexInput = { stage: string; files: [path: string, digest: string][]; retainedPaths: string[];
    errors: string[]; sourceVersion: string };
type Input = Options & FrozenIndexInput & { version: 1; builder: string; credentialVersion: number };
type Queue = DurableJobs<Input>;
type Lease = NonNullable<ReturnType<Queue['claim']>>;
type State = NonNullable<ReturnType<Queue['get']>>;
type Stage = { id: string; path: string };
type IndexHost = {
    builder: string;
    capacity: () => number;
    capture: (projectId: string, root: string, stage: Stage, options: Options, signal: AbortSignal) => Promise<FrozenIndexInput>;
    register: (projectId: string, root: string, input: Input) => void;
    execute: (projectId: string, root: string, input: Input, signal: AbortSignal, guard: () => void, complete: (result: IndexStatus) => void,
        beforeEmbedding: (timeoutMs: number) => () => void) => Promise<IndexStatus>;
    status: (id: string, status: IndexStatus) => void;
};

export class LocalIndexJobs {
    private readonly queue: Queue;
    private readonly runner = new DispatcherHealth();
    private readonly jobs = new Map<string, { cancel: AbortController; promise: Promise<void> }>();
    private readonly staging = new Set<string>();
    private readonly stagingRoot: string;
    private closing = false;
    private timer?: ReturnType<typeof setInterval>;
    private cleaning?: Promise<void>;

    constructor(private readonly db: DatabaseSync, private readonly repo: RepositoryIndex, private readonly host: IndexHost) {
        this.queue = new DurableJobs<Input>(db);
        this.stagingRoot = join(repo.assets.root, '.index-inputs');
        db.exec(`CREATE TABLE IF NOT EXISTS local_index_embedding_send (
            run_id TEXT PRIMARY KEY REFERENCES durable_job(id) ON DELETE CASCADE, attempt INTEGER NOT NULL, deadline_at INTEGER NOT NULL
        )`);
    }

    private transaction<T>(operation: () => T) {
        this.db.exec('BEGIN IMMEDIATE');
        try { const result = operation(); this.db.exec('COMMIT'); return result; }
        catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }

    private authorize(actor: Pick<Account, 'id' | 'credentialVersion'>) {
        if (this.repo.identity.requireCurrent(actor).role !== 'ADMIN') throw new HttpError(403, 'ADMIN_REQUIRED');
    }

    async submit(actor: Account, projectId: string, root: string, options: Options, key: string | undefined, requestSignal: AbortSignal) {
        const fingerprint = digest(JSON.stringify(options));
        const replay = () => key && this.queue.findRequest(localIndexPlaybook, projectId, actor.id, key, fingerprint);
        this.authorize(actor);
        const past = replay();
        if (past) return past;
        if (this.closing || this.staging.size >= capacity || this.queue.pending(localIndexPlaybook) >= maxPending) {
            throw new HttpError(503, 'INDEX_CAPACITY_EXHAUSTED');
        }
        if (this.staging.has(projectId) || this.queue.hasActive(localIndexPlaybook, projectId)) throw new HttpError(409, 'INDEX_ALREADY_RUNNING');
        this.staging.add(projectId);
        const stage = { id: randomUUID(), path: '' };
        stage.path = join(this.stagingRoot, stage.id);
        let accepted: string | undefined;
        const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(captureBudget)]);
        try {
            await mkdir(this.stagingRoot, { mode: 0o700, recursive: true });
            if (await realpath(this.stagingRoot) !== this.stagingRoot) throw new HttpError(409, 'INDEX_INPUT_STORAGE_CHANGED');
            await mkdir(stage.path, { mode: 0o700 });
            const captured = await this.host.capture(projectId, root, stage, options, signal);
            signal.throwIfAborted();
            const result = this.transaction(() => {
                this.authorize(actor);
                const old = replay();
                if (old) return old;
                if (this.queue.hasActive(localIndexPlaybook, projectId)) throw new HttpError(409, 'INDEX_ALREADY_RUNNING');
                if (this.closing || this.queue.pending(localIndexPlaybook) >= maxPending) throw new HttpError(503, 'INDEX_CAPACITY_EXHAUSTED');
                const input: Input = { ...options, ...captured, version: 1, builder: this.host.builder, credentialVersion: actor.credentialVersion };
                this.host.register(projectId, root, input);
                const run = this.repo.agentRuns.create(projectId, localIndexPlaybook, 'frozen-index:' + captured.sourceVersion);
                this.queue.enqueue({ id: run.id, actorId: actor.id, projectId, kind: localIndexPlaybook, key, fingerprint, input,
                    availableAt: Date.now(), budgetMs: jobBudget });
                return run.id;
            });
            const record = this.db.prepare("SELECT 1 FROM durable_job WHERE id = ? AND json_extract(input,'$.stage') = ?").get(result, stage.id);
            if (record) accepted = result;
            this.dispatch();
            return result;
        } finally {
            this.staging.delete(projectId);
            if (!accepted) await this.remove(stage.id);
        }
    }

    start() {
        if (!this.timer) this.timer = setInterval(() => this.dispatch(), 250).unref();
        this.cleaning = this.collect().catch(() => { console.error('Unable to recover pending index inputs'); });
        this.dispatch();
    }

    private async remove(stage: string) {
        if (!agentRunIdPattern.test(stage)) return;
        const path = join(this.stagingRoot, stage);
        try {
            if (await realpath(path) === path && (await lstat(path)).isDirectory()) await rm(path, { recursive: true, force: true });
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Unable to remove owned index input'); }
    }

    private async collect() {
        let entries;
        try {
            if (await realpath(this.stagingRoot) !== this.stagingRoot) return;
            entries = await readdir(this.stagingRoot);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
        }
        const cutoff = Date.now() - captureBudget - 60_000;
        const inUse = this.db.prepare("SELECT 1 FROM durable_job WHERE kind = ? AND json_extract(input,'$.stage') = ? AND state IN ('QUEUED','RUNNING','PAUSED')");
        for (const stage of entries) if (agentRunIdPattern.test(stage) && !inUse.get(localIndexPlaybook, stage)) {
            const entry = await lstat(join(this.stagingRoot, stage)).catch(() => undefined);
            if (entry?.isDirectory() && entry.mtimeMs <= cutoff) await this.remove(stage);
        }
    }

    execution(id: string) { return this.queue.get(id); }
    attempts(id: string) { return this.queue.history(id); }
    workerHealth() {
        const health = this.runner.status(!!this.timer && !this.closing);
        try {
            const waiting = this.db.prepare(`SELECT count(*) AS value FROM local_index_embedding_send e JOIN durable_job j ON j.id = e.run_id
                WHERE j.state = 'RUNNING' AND j.lease_expires <= ? AND e.deadline_at > ?`).get(Date.now(), Date.now());
            return { ...health, awaitingReconciliation: Number(waiting?.value ?? 0) };
        } catch { return { ...health, awaitingReconciliation: 0 }; }
    }

    control(actor: Account, id: string, action: JobAction, revision: number, priority?: number) {
        const state = this.transaction(() => {
            this.authorize(actor);
            const job = this.queue.get(id);
            if (!job || this.repo.agentRuns.get(id)?.playbook !== localIndexPlaybook) throw new HttpError(404, 'JOB_NOT_FOUND');
            this.repo.identity.requireAvailableProject(job.projectId);
            const next = this.queue.change(id, revision, action, priority);
            this.sync(next);
            return next;
        });
        if (state.stopRequested) this.jobs.get(id)?.cancel.abort();
        if (action === 'resume') this.dispatch();
        return state;
    }

    private sync(state: State, reason?: string) {
        if (state.state === 'RUNNING' || state.state === 'FINISHED') return;
        const run = this.repo.agentRuns.get(state.id);
        if (!run) return;
        if (state.state === 'FAILED' || state.state === 'CANCELLED') {
            const error = state.state === 'CANCELLED' ? 'INDEX_CANCELLED' : reason ?? 'INDEX_TASK_BUDGET_EXHAUSTED';
            this.repo.agentRuns.fail(run, error, state.state);
            this.host.status(state.projectId, { status: 'error', message: error });
            const stage = this.db.prepare("SELECT json_extract(input,'$.stage') AS name FROM durable_job WHERE id = ?").get(state.id)?.name;
            this.queue.clearInput(state.id);
            if (typeof stage === 'string') void this.remove(stage);
        } else {
            run.status = state.state;
            run.statusReason = null;
            this.repo.agentRuns.save(run);
            this.host.status(state.projectId, { status: 'running', ...(state.state === 'PAUSED' && { message: 'INDEX_PAUSED' }) });
        }
    }

    private dispatch() {
        if (this.closing) return;
        try {
            const slots = this.host.capacity();
            const leases = this.transaction(() => {
                const now = Date.now();
                const waiting = this.db.prepare(`SELECT e.run_id AS id FROM local_index_embedding_send e JOIN durable_job j ON j.id = e.run_id
                    WHERE j.state = 'RUNNING' AND e.deadline_at > ?`).all(now).map(row => String(row.id));
                for (const state of this.queue.reconcile(localIndexPlaybook, !waiting.length)) this.sync(state);
                this.db.prepare('DELETE FROM local_index_embedding_send WHERE deadline_at <= ?').run(now);
                const staged: Lease[] = [];
                for (let claimed = 0; claimed < slots; claimed++) {
                    const lease = this.queue.claim(localIndexPlaybook, capacity, leaseMs, [...this.jobs.keys(), ...waiting]);
                    if (!lease) break;
                    staged.push(lease);
                }
                return staged;
            });
            for (const lease of leases) this.launch(lease);
            this.runner.observe(true);
        } catch { if (this.runner.observe(false)) console.error('Failed to dispatch local index tasks'); }
    }

    private launch(lease: Lease) {
        const cancel = new AbortController();
        const heartbeat = setInterval(() => {
            try {
                const owner = this.queue.renew(lease, leaseMs);
                if (!owner || owner.stopRequested) cancel.abort();
                else this.authorize({ id: lease.actorId, credentialVersion: lease.input.credentialVersion });
            } catch (error) { cancel.abort(error); }
        }, leaseMs / 4).unref();
        const entry = { cancel, promise: this.execute(lease, cancel.signal).catch(() => console.error('Failed to store local index outcome')).finally(() => {
            clearInterval(heartbeat);
            this.jobs.delete(lease.id);
            this.dispatch();
        }) };
        this.jobs.set(lease.id, entry);
    }

    private async execute(lease: Lease, cancelled: AbortSignal) {
        const run = this.repo.agentRuns.get(lease.id)!;
        const { input, projectId } = lease;
        const guard = () => {
            cancelled.throwIfAborted();
            this.queue.assertRunnable(lease);
            this.authorize({ id: lease.actorId, credentialVersion: input.credentialVersion });
            this.repo.identity.requireAvailableProject(projectId);
        };
        const beforeEmbedding = (timeoutMs: number) => {
            this.transaction(() => {
                guard();
                this.db.prepare('INSERT INTO local_index_embedding_send VALUES (?,?,?)').run(lease.id, lease.attempt, Date.now() + timeoutMs);
            });
            return () => this.db.prepare('DELETE FROM local_index_embedding_send WHERE run_id = ? AND attempt = ?').run(lease.id, lease.attempt);
        };
        try {
            const path = join(this.stagingRoot, input.stage);
            if (!agentRunIdPattern.test(input.stage) || input.version !== 1 || input.builder !== this.host.builder) {
                throw new HttpError(409, 'INDEX_INPUT_PROFILE_CHANGED');
            }
            if (await realpath(path) !== path || !(await lstat(path)).isDirectory()) throw new HttpError(409, 'INDEX_INPUT_STORAGE_CHANGED');
            this.transaction(() => {
                guard();
                this.queue.begin(lease);
                run.status = 'RUNNING';
                this.repo.agentRuns.save(run);
            });
            const remaining = lease.deadline - Date.now();
            if (remaining <= 0) throw new HttpError(409, 'INDEX_TASK_BUDGET_EXHAUSTED');
            await this.host.execute(projectId, path, input, AbortSignal.any([cancelled, AbortSignal.timeout(remaining)]), guard, result => {
                guard();
                run.status = result.status === 'done' ? 'COMPLETED' : result.status === 'partial' ? 'PARTIAL' : 'FAILED';
                run.statusReason = run.status === 'FAILED' ? 'PROJECT_INDEX_FAILED' : null;
                run.completedAt = new Date().toISOString();
                run.outputReference = 'indexed-input:' + input.sourceVersion;
                this.repo.agentRuns.save(run);
                this.queue.finish(lease, 'FINISHED', digest(JSON.stringify(result)));
                this.queue.clearInput(run.id);
            }, beforeEmbedding);
            await this.remove(input.stage);
        } catch (error) {
            try {
                this.transaction(() => this.sync(this.queue.finish(lease, this.closing ? 'QUEUED' : 'FAILED'),
                    error instanceof HttpError ? error.message : 'INDEX_INPUT_UNAVAILABLE'));
            } catch (stale) { if (!(stale instanceof HttpError && stale.message === 'JOB_LEASE_LOST')) throw stale; }
        }
    }

    async close() {
        this.closing = true;
        clearInterval(this.timer);
        const current = [...this.jobs.values()];
        for (const item of current) item.cancel.abort();
        await Promise.all([...current.map(job => job.promise), this.cleaning]);
    }
}
