import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { ArchiveFile } from './archive.js';
import { agentRunIdPattern } from './agent-runs.js';
import { archiveLanguage } from './asset-profile.js';
import type { Assets } from './assets.js';
import { DurableJobs } from './durable-jobs.js';
import type { JobAction } from './durable-jobs.js';
import { CodeQl } from './codeql.js';
import { maxFindingRows } from './finding-import.js';
import type { ExternalFinding } from './finding-import.js';
import { HttpError } from './http-error.js';
import type { Account } from './identity.js';
import type { RepositoryIndex } from './index.js';
import { DispatcherHealth } from './operability.js';
import type { ArchivedScannerRun, ArchivedScanTask } from './scan-history.js';
import { scanManifest, scannerProfiles, stageScan } from './scan-input.js';
import { scannerProcessExited, withScannerCustody } from './scanner-process.js';
import type { ScannerAdapter, ScannerResult } from './scanner-process.js';
import { Semgrep } from './semgrep.js';
import { Slither } from './slither.js';
import { digest } from './source.js';

const MAX_QUEUED_AND_RUNNING = 8;
const MAX_TIMEOUT_SECONDS = 120;
const scanKind = 'ARCHIVE_SCAN';
const leaseMs = 2500;
const terminal = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED']);
export const startScanInput = z.object({
    scanners: z.array(z.string().trim().max(24).transform(value => value.toUpperCase())).max(8).nullish(),
    timeoutSeconds: z.number().int().min(1).nullish()
}).nullable();

type Asset = ReturnType<Assets['find']>;
type Capability = Awaited<ReturnType<ScannerAdapter['capability']>>;
type Request = { version: 1; taskId: string; credentialVersion: number; profile: string; archiveDigest: string | null;
    files: Awaited<ReturnType<typeof scanManifest>> };
type Queue = DurableJobs<Request>;
type Lease = NonNullable<ReturnType<Queue['claim']>>;
type State = NonNullable<ReturnType<Queue['get']>>;
type Job = { task: ArchivedScanTask; root: string; cancel: AbortController; lease: Lease; job?: Promise<void> };

export class ScanTasks {
    private readonly adapters: Map<string, ScannerAdapter>;
    private readonly queue: Queue;
    private readonly dispatcher = new DispatcherHealth();
    private readonly running = new Map<string, Job>();
    private readonly workRoot: string;
    private probe?: Promise<Capability[]>;
    private timer?: ReturnType<typeof setInterval>;
    private dispatching?: Promise<void>;
    private closed = false;
    private awaiting = false;

    constructor(private readonly db: DatabaseSync, private readonly repo: RepositoryIndex) {
        this.workRoot = join(this.assets.root, '.scan-executions');
        this.adapters = new Map<string, ScannerAdapter>([
            ['SEMGREP', new Semgrep(this.assets.root)], ['CODEQL', new CodeQl(this.assets.root)], ['SLITHER', new Slither(this.assets.root)]
        ]);
        this.queue = new DurableJobs<Request>(db);
        db.exec(`
            CREATE TABLE IF NOT EXISTS scan_execution (
                run_id TEXT PRIMARY KEY REFERENCES durable_job(id) ON DELETE CASCADE,
                task_id TEXT NOT NULL REFERENCES scan_history_task(id) ON DELETE CASCADE,
                attempt INTEGER NOT NULL, UNIQUE(task_id,attempt)
            );
            CREATE TABLE IF NOT EXISTS scan_process (
                token TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES durable_job(id) ON DELETE CASCADE,
                attempt INTEGER NOT NULL, process_id INTEGER, process_group INTEGER
            );
            CREATE INDEX IF NOT EXISTS scan_process_run ON scan_process(run_id,attempt);
        `);
        this.history.recoverInterrupted();
    }

    private get assets() { return this.repo.assets; }
    private get history() { return this.repo.scanHistory; }

    private transaction<T>(operation: () => T) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = operation();
            this.db.exec('COMMIT');
            return result;
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }

    start() {
        if (!this.timer) this.timer = setInterval(() => this.dispatch(), 250).unref();
        this.dispatch();
    }

    workerHealth() { return { ...this.dispatcher.status(!!this.timer && !this.closed), awaitingReconciliation: this.awaiting }; }

    async capabilities() {
        this.probe ??= Promise.all([...this.adapters.values()].map(adapter => adapter.capability()))
            .finally(() => { this.probe = undefined; });
        return this.probe;
    }

    supports(scanner: string) { return this.adapters.has(scanner); }
    active(projectId: string) { return this.queue.hasActive(scanKind, projectId); }

    async submit(asset: Asset, scanners: string[], timeoutSeconds: number | null | undefined, actor: Account, key?: string, signal?: AbortSignal) {
        if (!scanners.length) throw new HttpError(400, 'NO_APPLICABLE_SCANNER');
        if (scanners.some(scanner => !this.supports(scanner))) throw new HttpError(400, 'UNSUPPORTED_SCANNER');
        if (asset.status !== 'READY') throw new HttpError(409, 'ASSET_NOT_READY');
        const now = new Date().toISOString();
        const task: ArchivedScanTask = {
            id: randomUUID(), projectId: asset.projectId, assetId: asset.assetId, assetAvailable: true,
            requestedScanners: [...new Set(scanners)], languages: [], timeoutSeconds: Math.min(timeoutSeconds ?? MAX_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS),
            status: 'QUEUED', execution: 'LOCAL', attempt: 1, batchId: randomUUID(),
            error: '', createdAt: now, updatedAt: now, scanners: [], findingCount: 0
        };
        return this.enqueue(asset, task, actor, key, signal);
    }

    async retry(task: ArchivedScanTask, actor: Account, key?: string, signal?: AbortSignal) {
        this.repo.identity.requireProjectEditor(actor, task.projectId);
        if (key) {
            const existing = this.queue.findRequest(scanKind, task.projectId, actor.id, key,
                digest(JSON.stringify([task.assetId, task.requestedScanners, task.timeoutSeconds, task.id])));
            const replay = existing && this.taskFor(existing);
            if (replay) return replay;
        }
        if (task.execution !== 'LOCAL' || !['FAILED', 'PARTIAL', 'CANCELLED'].includes(task.status)) throw new HttpError(409, 'SCAN_TASK_NOT_RETRYABLE');
        const asset = this.assets.find(task.assetId, id => this.repo.identity.requireProjectEditor(actor, id));
        if (asset.projectId !== task.projectId) throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
        const { batchStatus: _previous, ...previous } = task;
        return this.enqueue(asset, { ...previous, status: 'QUEUED', attempt: task.attempt + 1, batchId: randomUUID(),
            error: '', updatedAt: new Date().toISOString() }, actor, key, signal, task);
    }

    private async enqueue(asset: Asset, task: ArchivedScanTask, actor: Account, key: string | undefined, signal: AbortSignal | undefined,
        previous?: ArchivedScanTask) {
        this.repo.identity.requireProjectEditor(actor, task.projectId);
        if (asset.status !== 'READY') throw new HttpError(409, 'ASSET_NOT_READY');
        const fingerprint = digest(JSON.stringify([task.assetId, task.requestedScanners, task.timeoutSeconds, previous?.id ?? null]));
        const replay = () => {
            if (!key) return undefined;
            const existing = this.queue.findRequest(scanKind, task.projectId, actor.id, key, fingerprint);
            return existing ? this.taskFor(existing) : undefined;
        };
        const saved = replay();
        if (saved) return saved;
        const [files, profile] = await Promise.all([scanManifest(asset.projectRoot, this.assets.manifest(asset.assetId), signal),
            scannerProfiles(task.requestedScanners)]);
        signal?.throwIfAborted();
        const result = this.transaction(() => {
            this.repo.identity.requireProjectEditor(actor, task.projectId);
            const stored = replay();
            if (stored) return stored;
            if (this.active(task.projectId)) throw new HttpError(409, 'SCAN_ALREADY_RUNNING');
            if (this.closed || this.queue.pending(scanKind) >= MAX_QUEUED_AND_RUNNING) throw new HttpError(503, 'SCAN_QUEUE_FULL');
            if (previous && this.history.task(task.id)?.attempt !== previous.attempt) throw new HttpError(409, 'SCAN_CHANGED');
            const current = this.assets.find(asset.assetId);
            if (current.status !== 'READY' || current.projectId !== task.projectId || current.sourceObject?.sha256 !== asset.sourceObject?.sha256) {
                throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
            }
            task.languages = [...new Set(files.map(file => archiveLanguage(file.path)).filter(Boolean))].sort();
            this.history.saveTask(task);
            const former = previous ? this.runFor(previous.id)?.id : undefined;
            const run = this.repo.agentRuns.create(task.projectId, scanKind, 'scan-task:' + task.id, 'scan-task:' + task.id, former);
            this.queue.enqueue({ id: run.id, projectId: task.projectId, actorId: actor.id, kind: scanKind, key, fingerprint,
                input: { version: 1, taskId: task.id, credentialVersion: actor.credentialVersion, files, profile,
                    archiveDigest: current.sourceObject?.sha256 ?? null }, availableAt: Date.now(),
                budgetMs: task.timeoutSeconds * 1000 * task.requestedScanners.length + 20_000 });
            this.db.prepare('INSERT INTO scan_execution VALUES (?,?,?)').run(run.id, task.id, task.attempt);
            return task;
        });
        this.dispatch();
        return result;
    }

    private runFor(taskId: string) {
        const row = this.db.prepare('SELECT run_id AS id FROM scan_execution WHERE task_id = ? ORDER BY attempt DESC LIMIT 1').get(taskId);
        return row && this.repo.agentRuns.get(String(row.id));
    }

    private taskFor(runId: string) {
        const row = this.db.prepare('SELECT task_id FROM scan_execution WHERE run_id = ?').get(runId);
        return row && this.history.task(String(row.task_id));
    }

    execution(taskId: string) {
        const run = this.runFor(taskId);
        return run ? { execution: this.queue.get(run.id), attempts: this.queue.history(run.id), awaitingReconciliation: this.running.has(run.id)
            ? this.running.get(run.id)?.task.error === 'SCAN_PROCESS_EXIT_UNCONFIRMED' : this.taskFor(run.id)?.error === 'SCAN_PROCESS_EXIT_UNCONFIRMED' } : undefined;
    }

    control(task: ArchivedScanTask, actor: Account, action: JobAction, revision?: number, priority?: number) {
        const state = this.transaction(() => {
            this.repo.identity.requireProjectEditor(actor, task.projectId);
            const run = this.runFor(task.id);
            const current = run && this.queue.get(run.id);
            if (!current) throw new HttpError(404, 'SCAN_EXECUTION_NOT_FOUND');
            if (current.actorId !== actor.id || action === 'prioritize' || priority !== undefined) {
                this.repo.identity.requireProjectManager(actor, task.projectId);
            }
            const next = this.queue.change(current.id, revision ?? current.revision, action, priority);
            this.sync(next);
            return next;
        });
        if (state.stopRequested) this.running.get(state.id)?.cancel.abort();
        if (action === 'resume') this.dispatch();
        return state;
    }

    async cancel(task: ArchivedScanTask, actor: Account) {
        if (terminal.has(task.status)) return task;
        const state = this.control(task, actor, 'cancel');
        await this.running.get(state.id)?.job;
        return this.history.task(task.id) ?? task;
    }

    async wait(task: ArchivedScanTask, signal: AbortSignal) {
        let current = task;
        while (!terminal.has(current.status) && current.status !== 'PAUSED' && current.error !== 'SCAN_PROCESS_EXIT_UNCONFIRMED') {
            await delay(150, undefined, { signal });
            current = this.history.task(task.id) ?? current;
        }
        return current;
    }

    async close() {
        this.closed = true;
        clearInterval(this.timer);
        await this.dispatching;
        const active = [...this.running.values()];
        for (const item of active) item.cancel.abort();
        await Promise.all(active.map(item => item.job));
    }

    private setStatus(task: ArchivedScanTask, status: ArchivedScanTask['status'], error = '') {
        const updated = { ...task, status, error, updatedAt: new Date().toISOString() };
        this.history.saveTask(updated);
        return updated;
    }

    private sync(state: State, reason?: string) {
        const task = this.taskFor(state.id), run = this.repo.agentRuns.get(state.id);
        if (!task || !run || state.state === 'RUNNING' || state.state === 'FINISHED') return;
        if (state.state === 'FAILED' || state.state === 'CANCELLED') {
            const error = state.state === 'CANCELLED' ? 'SCAN_CANCELLED' : reason ?? 'SCAN_TASK_BUDGET_EXHAUSTED';
            this.repo.agentRuns.fail(run, error, state.state);
            this.setStatus(task, state.state, error);
            this.queue.clearInput(run.id);
        } else {
            run.status = state.state;
            run.statusReason = reason ?? null;
            this.repo.agentRuns.save(run);
            this.setStatus(task, state.state, reason);
        }
    }

    private dispatch() {
        if (this.closed || this.dispatching) return;
        this.dispatching = this.advance().then(() => this.dispatcher.observe(true)).catch(() => {
            if (this.dispatcher.observe(false)) console.error('Failed to dispatch archive scans');
        }).then(() => { this.dispatching = undefined; });
    }

    private async advance() {
        if (this.running.size) return;
        this.awaiting = false;
        for (;;) {
            const expired = this.queue.expired(scanKind);
            if (!expired) break;
            if (!this.processesExited(expired.id, expired.attempt) || !await this.clean(expired.id, expired.attempt)) {
                this.awaiting = true;
                this.transaction(() => {
                    const state = this.queue.get(expired.id);
                    const task = this.taskFor(expired.id);
                    if (task && state?.state === 'RUNNING' && state.attempt === expired.attempt && task.error !== 'SCAN_PROCESS_EXIT_UNCONFIRMED') {
                        this.setStatus(task, 'RUNNING', 'SCAN_PROCESS_EXIT_UNCONFIRMED');
                    }
                });
                return;
            }
            this.transaction(() => {
                const state = this.queue.recoverAfterExit(expired);
                if (state) this.sync(state);
            });
        }
        if (this.closed) return;
        this.transaction(() => {
            for (const state of this.queue.reconcile(scanKind, false)) this.sync(state);
        });
        const lease = this.queue.claim(scanKind, 1, leaseMs, [], false);
        if (!lease) return;
        const task = this.history.task(lease.input.taskId)!;
        const job: Job = { task, root: join(this.attemptPath(lease.id, lease.attempt), 'source'), cancel: new AbortController(), lease };
        this.running.set(lease.id, job);
        const heartbeat = setInterval(() => {
            try {
                const owner = this.queue.renew(lease, leaseMs);
                if (!owner || owner.stopRequested) job.cancel.abort();
                else this.authorize(job);
            } catch (error) { job.cancel.abort(error); }
        }, leaseMs / 4).unref();
        job.job = this.execute(job).catch(() => console.error('Failed to store archive scan result')).finally(() => {
            clearInterval(heartbeat);
            this.running.delete(lease.id);
            this.dispatch();
        });
    }

    private attemptPath(id: string, attempt: number) { return join(this.workRoot, id + '-' + attempt); }

    private async clean(id: string, attempt: number) {
        if (!agentRunIdPattern.test(id) || !Number.isSafeInteger(attempt) || attempt < 1) return false;
        const path = this.attemptPath(id, attempt);
        try {
            if (await realpath(path) !== path || !(await lstat(path)).isDirectory()) return false;
            await rm(path, { recursive: true, force: true });
            return true;
        } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
    }

    private processesExited(id: string, attempt: number) {
        const records = this.db.prepare('SELECT token, process_id, process_group FROM scan_process WHERE run_id = ? AND attempt = ?').all(id, attempt);
        for (const row of records) {
            if (row.process_id === null || !scannerProcessExited(Number(row.process_id), Boolean(row.process_group))) return false;
        }
        this.db.prepare('DELETE FROM scan_process WHERE run_id = ? AND attempt = ?').run(id, attempt);
        return true;
    }

    private authorize(job: Job) {
        const { lease } = job;
        this.repo.identity.requireProjectEditor({ id: lease.actorId, credentialVersion: lease.input.credentialVersion }, lease.projectId);
    }

    private assertRunnable(job: Job) {
        job.cancel.signal.throwIfAborted();
        this.queue.assertRunnable(job.lease);
        this.authorize(job);
    }

    private track(job: Job) {
        const { id, attempt } = job.lease;
        const token = randomUUID();
        this.transaction(() => {
            this.assertRunnable(job);
            this.db.prepare('INSERT INTO scan_process VALUES (?,?,?,NULL,NULL)').run(token, id, attempt);
        });
        return {
            spawned: (pid: number, group: boolean) => this.db.prepare('UPDATE scan_process SET process_id = ?, process_group = ? WHERE token = ?')
                .run(pid, Number(group), token),
            closed: () => this.db.prepare('DELETE FROM scan_process WHERE token = ?').run(token)
        };
    }

    private async execute(job: Job) {
        const { lease } = job;
        const run = this.repo.agentRuns.get(lease.id)!;
        const attemptPath = this.attemptPath(lease.id, lease.attempt);
        let final: ArchivedScanTask['batchStatus'];
        let error: string | undefined;
        try {
            this.assertRunnable(job);
            if (lease.input.version !== 1 || await scannerProfiles(job.task.requestedScanners) !== lease.input.profile) {
                throw new HttpError(409, 'SCAN_CONFIGURATION_CHANGED');
            }
            const asset = this.assets.find(job.task.assetId);
            this.assets.validateSource(job.task.assetId, asset.projectRoot);
            if (asset.projectId !== job.task.projectId || (asset.sourceObject?.sha256 ?? null) !== lease.input.archiveDigest) {
                throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
            }
            this.transaction(() => {
                this.assertRunnable(job);
                this.queue.begin(lease);
                run.status = 'RUNNING';
                run.statusReason = null;
                this.repo.agentRuns.save(run);
                job.task = this.setStatus(job.task, 'RUNNING');
            });
            await mkdir(this.workRoot, { mode: 0o700, recursive: true });
            if (await realpath(this.workRoot) !== this.workRoot) throw new HttpError(409, 'SCAN_STORAGE_CHANGED');
            await mkdir(attemptPath, { mode: 0o700 });
            const remaining = lease.deadline - Date.now();
            if (remaining < 1000) throw new HttpError(409, 'SCAN_TASK_BUDGET_EXHAUSTED');
            const signal = AbortSignal.any([job.cancel.signal, AbortSignal.timeout(remaining)]);
            await stageScan(asset.projectRoot, job.root, lease.input.files, signal);
            const errors = new Set<string>();
            const results = new Map(job.task.scanners.map(report => [report.scanner, report.status]));
            await withScannerCustody({ workRoot: attemptPath, track: () => this.track(job) }, async () => {
                for (const scanner of job.task.requestedScanners) {
                    this.assertRunnable(job);
                    if (results.get(scanner) === 'SUCCEEDED') continue;
                    const prior = job.task.scanners.findLast(item => item.scanner === scanner && item.batchId === job.task.batchId);
                    if (prior) { if (prior.status !== 'SUCCEEDED') errors.add(prior.error || 'SCANNER_INCOMPLETE_REPORT'); continue; }
                    const adapter = this.adapters.get(scanner);
                    if (!adapter) throw new HttpError(409, 'SCANNER_UNAVAILABLE');
                    const reason = await this.executeScanner(job, scanner, adapter, lease.input.files);
                    if (reason) errors.add(reason);
                }
            });
            this.assertRunnable(job);
            const outcomes = new Map(job.task.scanners.map(report => [report.scanner, report.status]));
            const statuses = job.task.requestedScanners.map(scanner => outcomes.get(scanner));
            final = !errors.size && statuses.every(status => status === 'SUCCEEDED') ? 'SUCCEEDED'
                : statuses.some(status => status === 'SUCCEEDED' || status === 'PARTIAL') || job.task.findingCount ? 'PARTIAL' : 'FAILED';
            error = [...errors].join(', ');
        } catch (failure) {
            error = failure instanceof HttpError ? failure.message : 'SCAN_EXECUTION_FAILED';
        }
        if (!this.processesExited(lease.id, lease.attempt)) await delay(100);
        if (!this.processesExited(lease.id, lease.attempt) || !await this.clean(lease.id, lease.attempt)) {
            this.awaiting = true;
            try {
                this.transaction(() => {
                    this.queue.assertLease(lease);
                    job.task = this.setStatus(job.task, 'RUNNING', 'SCAN_PROCESS_EXIT_UNCONFIRMED');
                });
            } catch (stale) { if (!(stale instanceof HttpError && stale.message === 'JOB_LEASE_LOST')) throw stale; }
            return;
        }
        try {
            this.transaction(() => {
                if (!final || this.queue.assertLease(lease) || this.closed) {
                    const state = this.queue.finish(lease, this.closed ? 'QUEUED' : 'FAILED');
                    this.sync(state, error);
                    return;
                }
                this.assertRunnable(job);
                job.task = this.setStatus({ ...job.task, batchStatus: final }, final, error);
                run.status = final === 'SUCCEEDED' ? 'COMPLETED' : final;
                run.statusReason = error || null;
                run.completedAt = job.task.updatedAt;
                this.repo.agentRuns.save(run);
                this.queue.finish(lease, 'FINISHED', digest(JSON.stringify(job.task)));
                this.queue.clearInput(run.id);
            });
        } catch (stale) { if (!(stale instanceof HttpError && stale.message === 'JOB_LEASE_LOST')) throw stale; }
    }

    private async executeScanner(job: Job, scanner: string, adapter: ScannerAdapter, files: ArchiveFile[]) {
        const task = job.task;
        const startedAt = new Date().toISOString();
        const started = performance.now();
        const limit = Math.min(task.timeoutSeconds * 1000, job.lease.deadline - Date.now() - 500);
        if (limit < 100) throw new HttpError(409, 'SCAN_TASK_BUDGET_EXHAUSTED');
        const deadline = AbortSignal.timeout(limit);
        const signal = AbortSignal.any([job.cancel.signal, deadline]);
        let result: ScannerResult;
        try {
            result = await adapter.scan(job.root, files, signal);
        } catch {
            result = { status: 'FAILED', exitCode: -1, toolVersion: '', error: 'SCAN_EXECUTION_FAILED' };
        }
        this.assertRunnable(job);
        if (!this.processesExited(job.lease.id, job.lease.attempt)) throw new HttpError(409, 'SCAN_PROCESS_EXIT_UNCONFIRMED');
        if (await scannerProfiles(task.requestedScanners) !== job.lease.input.profile) throw new HttpError(409, 'SCAN_CONFIGURATION_CHANGED');
        if (deadline.aborted && !result.report) result = { ...result, status: 'TIMED_OUT', error: 'SCANNER_TIMED_OUT' };
        const { archiveDigest, profile } = job.lease.input;
        const ruleVersion = digest(JSON.stringify([profile, scanner, result.toolVersion]));
        const allowedPaths = new Set(files.map(file => file.path));
        if (result.report) {
            const scoped = result.report.findings.filter(finding => allowedPaths.has(finding.filePath));
            const outsideScope = scoped.length !== result.report.findings.length;
            result.report = { ...result.report, findings: archiveDigest ? scoped.map(finding => ({ ...finding, codeVersion: archiveDigest,
                ruleVersion })) : scoped, truncated: result.report.truncated || outsideScope };
            if (outsideScope && result.status === 'SUCCEEDED') {
                result.status = 'PARTIAL';
                result.error = 'SCANNER_INCOMPLETE_REPORT';
            }
        }
        const observations = new Map<string, ExternalFinding>();
        for (const finding of result.report?.findings ?? []) {
            if (!observations.has(finding.fingerprint)) observations.set(finding.fingerprint, finding);
        }
        const { report, ...outcome } = result;
        const summary = { ...outcome, scanId: randomUUID(), projectId: task.projectId, batchId: task.batchId, scanner,
            startedAt, finishedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started),
            findingCount: observations.size };
        const run: ArchivedScannerRun = { ...summary, findings: [...observations.values()] };
        const prior = task.findingCount ? this.history.findings(task, 0, maxFindingRows).findings : [];
        const aggregate = new Map(prior.map(finding => [finding.fingerprint, finding]));
        for (const finding of run.findings) {
            if (!aggregate.has(finding.fingerprint)) aggregate.set(finding.fingerprint, finding);
        }
        const findings = [...aggregate.values()].slice(0, maxFindingRows);
        const recent = [...task.scanners, summary];
        const latest = new Map(recent.map(item => [item.scanner, item]));
        const retained = recent.filter((item, index) => index >= recent.length - 10 || latest.get(item.scanner) === item);
        const updated: ArchivedScanTask = {
            ...task, updatedAt: run.finishedAt, scanners: retained, findingCount: findings.length
        };
        let error = aggregate.size > maxFindingRows ? 'SCAN_FINDING_LIMIT' : run.error;
        if (aggregate.size > maxFindingRows && run.status === 'SUCCEEDED') {
            run.status = summary.status = 'PARTIAL';
            run.error = summary.error = error;
        }
        this.history.recordRun(updated, run, findings, () => {
            this.assertRunnable(job);
            if (report) {
                const { omitted, conflicts } = this.repo.externalFindings.importInTransaction(task.projectId, report);
                if (omitted || conflicts) {
                    error = 'SCAN_INVENTORY_INCOMPLETE';
                    if (run.status === 'SUCCEEDED') run.status = summary.status = 'PARTIAL';
                    run.error = summary.error = error;
                }
            }
            if (archiveDigest) this.repo.externalFindings.recordCheckInTransaction(task.projectId,
                report ?? { findings: [], skipped: [], truncated: false, reported: 0 }, {
                    format: scanner.toLowerCase(), codeVersion: archiveDigest, ruleVersion, source: 'VERIFIED_ARCHIVE_SOURCE',
                    execution: run.status === 'SUCCEEDED' ? undefined : run.status === 'TIMED_OUT' ? 'FAILED' : run.status
                });
        });
        job.task = updated;
        return error || (run.status === 'SUCCEEDED' ? '' : 'SCANNER_INCOMPLETE_REPORT');
    }
}
