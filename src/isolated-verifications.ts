import type { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { agentRunIdPattern, agentStep, finishAgentStep } from './agent-runs.js';
import type { AgentRun } from './agent-runs.js';
import { DockerVerifier, verifierFile, verifierFileLimit, verifierSourceLimit } from './docker-verifier.js';
import { DurableJobs } from './durable-jobs.js';
import type { JobAction, JobLease } from './durable-jobs.js';
import { HttpError } from './http-error.js';
import type { Account } from './identity.js';
import type { RepositoryIndex } from './index.js';
import { DispatcherHealth } from './operability.js';
import { digest } from './source.js';

export const isolatedVerificationPlaybook = 'ISOLATED_VERIFICATION';
export const isolatedVerificationReference = 'isolated-verification:';
const recipe = 'node-test-v1';
const leaseMillis = 4000;
const pendingLimit = 30;
export const verificationInput = z.strictObject({ projectId: z.string().regex(/^[a-f0-9]{12}$/),
    snapshotId: z.string().regex(agentRunIdPattern), patchId: z.string().regex(agentRunIdPattern).optional(), recipe: z.literal(recipe),
    files: z.array(verifierFile).min(1).max(20).refine(files => new Set(files).size === files.length),
    timeoutMs: z.int().min(250).max(40_000).default(10_000) });
type Request = z.infer<typeof verificationInput>;
type Input = Request & { version: 1; workerImage: string; credentialVersion: number };
type Lease = NonNullable<ReturnType<DurableJobs<Input>['claim']>>;
type WorkerResult = Awaited<ReturnType<DockerVerifier['test']>>;

const attemptName = (lease: JobLease) => `repograph-worker-${lease.id}-${lease.attempt}`;

export class IsolatedVerifications {
    private readonly worker: DockerVerifier | undefined;
    private readonly queue: DurableJobs<Input>;
    private readonly health = new DispatcherHealth();
    private timer: NodeJS.Timeout | undefined;
    private polling: Promise<void> | undefined;
    private active: { id: string; cancelled: AbortController; work: Promise<void> } | undefined;
    private closing = false;

    constructor(private readonly db: DatabaseSync, private readonly repo: RepositoryIndex, env: NodeJS.ProcessEnv, storage: string) {
        this.worker = DockerVerifier.fromEnvironment(env, join(tmpdir(), 'repograph-verification-' + digest(storage).slice(0, 24)));
        this.queue = new DurableJobs(db);
        db.exec(`CREATE TABLE IF NOT EXISTS isolated_verification_report (
            run_id TEXT PRIMARY KEY REFERENCES agent_run(id) ON DELETE CASCADE, payload TEXT NOT NULL, digest TEXT NOT NULL
        )`);
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

    async capability() {
        return { available: !this.closing && !!this.worker && await this.worker.available(), configured: !!this.worker, recipe, inputVersion: 1 };
    }

    diagnostics() {
        return { ...this.health.status(!!this.timer), configured: !!this.worker, pending: this.queue.pending(isolatedVerificationPlaybook),
            awaitingReconciliation: this.queue.expired(isolatedVerificationPlaybook)?.id ?? null };
    }

    private authorize(actor: Account, request: Pick<Request, 'projectId' | 'snapshotId'>, write: boolean) {
        if (write) this.repo.identity.requireProjectEditor(actor, request.projectId);
        else this.repo.identity.requireProjectReader(actor, request.projectId);
        if (this.repo.knowledgeSnapshots.get(request.snapshotId)?.projectId !== request.projectId) throw new HttpError(404, 'SNAPSHOT_NOT_FOUND');
    }

    async submit(actor: Account, key: string, request: Request, signal?: AbortSignal) {
        this.authorize(actor, request, true);
        const fingerprint = digest(JSON.stringify(request));
        const find = () => this.queue.findRequest(isolatedVerificationPlaybook, request.projectId, actor.id, key, fingerprint);
        const previous = find();
        const receipt = (id: string) => ({ agentRunId: id, projectId: request.projectId, pollVia: `/api/v1/verifications/${id}` });
        if (previous) return receipt(previous);
        if (!(await this.capability()).available || !this.worker) throw new HttpError(503, 'VERIFIER_UNAVAILABLE');
        signal?.throwIfAborted();
        const workerImage = this.worker.image;
        const id = this.transaction(() => {
            this.authorize(actor, request, true);
            const old = find();
            if (old) return old;
            if (request.patchId) this.repo.changePatches.requireScope(actor, request.projectId, request.snapshotId, request.patchId);
            if (this.queue.hasActive(isolatedVerificationPlaybook, request.projectId)) throw new HttpError(409, 'VERIFICATION_ALREADY_RUNNING');
            if (this.queue.pending(isolatedVerificationPlaybook) >= pendingLimit) throw new HttpError(503, 'VERIFICATION_QUEUE_FULL');
            if (this.repo.knowledgeSnapshots.evidenceFiles(request.snapshotId, request.files).length !== request.files.length) {
                throw new HttpError(400, 'VERIFIER_TEST_SOURCE_NOT_FOUND');
            }
            const run = this.repo.agentRuns.create(request.projectId, isolatedVerificationPlaybook, isolatedVerificationReference + request.snapshotId);
            this.queue.enqueue({ id: run.id, projectId: request.projectId, actorId: actor.id, kind: isolatedVerificationPlaybook, key, fingerprint,
                input: { ...request, workerImage, version: 1, credentialVersion: actor.credentialVersion }, availableAt: Date.now(),
                budgetMs: request.timeoutMs + 18_000 });
            return run.id;
        });
        this.dispatch();
        return receipt(id);
    }

    private run(id: string, actor: Account, write: boolean) {
        const run = this.repo.agentRuns.get(id);
        if (!run || run.playbook !== isolatedVerificationPlaybook) throw new HttpError(404, 'VERIFICATION_NOT_FOUND');
        this.authorize(actor, { projectId: run.projectId, snapshotId: run.inputReference.slice(isolatedVerificationReference.length) }, write);
        return run;
    }

    inspect(actor: Account, id: string) {
        const run = this.run(id, actor, false);
        const result = this.db.prepare('SELECT payload, digest FROM isolated_verification_report WHERE run_id = ?').get(id);
        return { run, execution: this.queue.get(id), result: result ? { ...JSON.parse(String(result.payload)), digest: result.digest } : null };
    }

    attempts(id: string) { return this.queue.history(id); }
    execution(id: string) { return this.queue.get(id); }

    control(actor: Account, id: string, action: JobAction, revision: number, priority?: number) {
        const state = this.transaction(() => {
            const run = this.run(id, actor, true);
            const next = this.queue.change(id, revision, action, priority);
            if (next.state !== 'RUNNING') this.updateRun(run, next.state);
            return next;
        });
        if (this.active?.id === id && state.stopRequested) this.active.cancelled.abort();
        this.dispatch();
        return state;
    }

    start() {
        if (this.timer || !this.worker) return;
        this.timer = setInterval(() => this.dispatch(), 250).unref();
        this.dispatch();
    }

    async close() {
        this.closing = true;
        clearInterval(this.timer);
        this.active?.cancelled.abort();
        await this.polling;
        await this.active?.work;
    }

    private dispatch() {
        if (this.closing || !this.worker || this.active || this.polling) return;
        const worker = this.worker;
        this.polling = (async () => {
            if (!this.queue.pending(isolatedVerificationPlaybook)) return;
            const old = this.queue.expired(isolatedVerificationPlaybook);
            if (old) {
                if (!await worker.reconcile(attemptName(old))) return this.markAwaiting(old.id);
                this.transaction(() => {
                    const state = this.queue.recoverAfterExit(old);
                    const run = state && this.repo.agentRuns.get(state.id);
                    if (run) this.updateRun(run, state.state);
                });
                if (this.queue.expired(isolatedVerificationPlaybook)) return;
            }
            this.transaction(() => {
                for (const state of this.queue.reconcile(isolatedVerificationPlaybook, false)) {
                    const run = this.repo.agentRuns.get(state.id);
                    if (run) this.updateRun(run, state.state);
                }
            });
            if (this.closing || !this.queue.pending(isolatedVerificationPlaybook)) return;
            if (!await worker.available()) return;
            if (this.closing) return;
            const lease = this.queue.claim(isolatedVerificationPlaybook, 1, leaseMillis, [], false);
            if (!lease) return;
            const cancelled = new AbortController();
            const work = this.execute(worker, lease, cancelled).catch(() => { this.health.observe(false); })
                .finally(() => { this.active = undefined; });
            this.active = { id: lease.id, cancelled, work };
        })().then(() => { this.health.observe(true); }, () => { this.health.observe(false); })
            .finally(() => { this.polling = undefined; });
    }

    private updateRun(run: AgentRun, state: string) {
        if (state === 'CANCELLED' || state === 'FAILED') {
            this.repo.agentRuns.fail(run, state === 'CANCELLED' ? 'CANCELLED' : 'VERIFIER_ATTEMPTS_EXHAUSTED', state);
            return;
        }
        if (state !== 'QUEUED' && state !== 'PAUSED') return;
        for (const step of run.steps) if (step.status === 'RUNNING') finishAgentStep(step, 'SKIPPED', 'Attempt ended without a report.');
        run.status = state;
        run.statusReason = state === 'PAUSED' ? 'PAUSED' : null;
        this.repo.agentRuns.save(run);
    }

    private markAwaiting(id: string) {
        const run = this.repo.agentRuns.get(id);
        if (run?.status === 'RUNNING' && run.statusReason !== 'VERIFIER_RECONCILIATION_REQUIRED') {
            run.statusReason = 'VERIFIER_RECONCILIATION_REQUIRED';
            this.repo.agentRuns.save(run);
        }
    }

    private async execute(worker: DockerVerifier, lease: Lease, cancelled: AbortController) {
        const run = this.repo.agentRuns.get(lease.id)!;
        const actor = () => this.repo.identity.requireCurrent({ id: lease.actorId, credentialVersion: lease.input.credentialVersion });
        const authorize = () => {
            const current = actor();
            this.authorize(current, lease.input, true);
            if (lease.input.patchId) this.repo.changePatches.requireScope(current, lease.projectId, lease.input.snapshotId, lease.input.patchId);
        };
        const ensureLease = () => { this.queue.assertRunnable(lease); authorize(); };
        const heartbeat = setInterval(() => {
            try {
                const next = this.queue.renew(lease, leaseMillis);
                if (!next || next.stopRequested) cancelled.abort();
                else authorize();
            } catch (error) { cancelled.abort(error); }
        }, 500).unref();
        try {
            ensureLease();
            if (lease.input.version !== 1 || lease.input.workerImage !== worker.image || lease.input.recipe !== recipe) {
                throw new HttpError(409, 'VERIFIER_PROFILE_CHANGED');
            }
            this.transaction(() => {
                ensureLease();
                this.queue.begin(lease);
                run.status = 'RUNNING';
                run.statusReason = null;
                agentStep(run, 'NODE_TEST');
                this.repo.agentRuns.save(run);
            });
            const files = this.repo.knowledgeSnapshots.sourcePaths(lease.input.snapshotId, '', verifierFileLimit + 1);
            if (files.length > verifierFileLimit) throw new HttpError(413, 'VERIFIER_SOURCE_TOO_LARGE');
            const replacements = lease.input.patchId ? new Map(this.repo.changePatches.sources(actor(), lease.projectId, lease.input.snapshotId,
                lease.input.patchId).map(file => [file.path, file.content])) : undefined;
            let bytes = 0;
            const source = files.map(path => {
                const content = replacements?.get(path) ?? this.repo.knowledgeSnapshots.sourceBytes(lease.input.snapshotId, path);
                if (!content) throw new HttpError(409, 'VERIFIER_SOURCE_UNAVAILABLE');
                bytes += content.byteLength;
                if (bytes > verifierSourceLimit) throw new HttpError(413, 'VERIFIER_SOURCE_TOO_LARGE');
                return { path, content };
            });
            const allowance = Math.min(lease.input.timeoutMs, lease.deadline - Date.now() - 12_000);
            if (allowance < 250) throw new HttpError(409, 'VERIFIER_TASK_BUDGET_EXPIRED');
            const result = await worker.test(attemptName(lease), source, lease.input.files, allowance, cancelled.signal, ensureLease);
            if (result.status === 'RECONCILIATION_REQUIRED') {
                this.queue.assertLease(lease);
                this.markAwaiting(lease.id);
                return;
            }
            if (cancelled.signal.aborted) {
                throw cancelled.signal.reason instanceof HttpError ? cancelled.signal.reason : new HttpError(409, 'VERIFIER_STOPPED');
            }
            ensureLease();
            this.publish(lease, run, result, ensureLease);
        } catch (error) {
            try {
                this.transaction(() => {
                    const stopped = this.queue.finish(lease, this.closing ? 'QUEUED' : 'FAILED');
                    if (stopped.state !== 'FAILED') this.updateRun(run, stopped.state);
                    else this.repo.agentRuns.fail(run, error instanceof HttpError ? error.message : 'VERIFIER_UNAVAILABLE');
                });
            } catch (failure) {
                if (!(failure instanceof HttpError) || failure.message !== 'JOB_LEASE_LOST') throw failure;
            }
        } finally { clearInterval(heartbeat); }
    }

    private publish(lease: Lease, run: AgentRun, result: WorkerResult, ensureLease: () => void) {
        this.transaction(() => {
            ensureLease();
            const receipt = { snapshotId: lease.input.snapshotId, recipe, image: lease.input.workerImage, files: lease.input.files,
                ...(lease.input.patchId ? { patchId: lease.input.patchId } : {}), ...result };
            const payload = JSON.stringify(receipt);
            const fingerprint = digest(payload);
            this.queue.finish(lease, 'FINISHED', fingerprint);
            this.db.prepare('INSERT INTO isolated_verification_report VALUES (?, ?, ?)').run(lease.id, payload, fingerprint);
            const realTest = result.status === 'PASSED' || result.status === 'FAILED';
            finishAgentStep(run.steps.at(-1)!, realTest && result.status === 'PASSED' ? 'COMPLETED' : 'FAILED', 'Isolated test execution.',
                result.status === 'PASSED' ? undefined : 'VERIFIER_' + result.status);
            run.status = realTest ? 'COMPLETED' : 'FAILED';
            run.statusReason = result.status === 'PASSED' ? null : 'VERIFIER_' + result.status;
            run.outputReference = isolatedVerificationReference + lease.id;
            run.completedAt = new Date().toISOString();
            this.repo.agentRuns.save(run);
            this.queue.clearInput(lease.id);
        });
    }
}
