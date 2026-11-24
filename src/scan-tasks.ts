import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { z } from 'zod';
import type { ArchiveFile } from './archive.js';
import { archiveLanguage } from './asset-profile.js';
import type { Assets } from './assets.js';
import { CodeQl } from './codeql.js';
import type { ExternalFindings } from './external-findings.js';
import { maxFindingRows } from './finding-import.js';
import type { ExternalFinding } from './finding-import.js';
import { HttpError } from './http-error.js';
import type { ArchivedScannerRun, ArchivedScanTask, ScanHistory } from './scan-history.js';
import type { ScannerAdapter, ScannerResult } from './scanner-process.js';
import { Semgrep } from './semgrep.js';
import { Slither } from './slither.js';

const MAX_QUEUED_AND_RUNNING = 8;
const MAX_TIMEOUT_SECONDS = 120;
export const startScanInput = z.object({
    scanners: z.array(z.string().trim().max(24).transform(value => value.toUpperCase())).max(8).nullish(),
    timeoutSeconds: z.number().int().min(1).nullish()
}).nullable();

type Asset = ReturnType<Assets['find']>;
type Capability = Awaited<ReturnType<ScannerAdapter['capability']>>;
type Job = {
    task: ArchivedScanTask; root: string; cancel: AbortController;
    complete: (result: ArchivedScanTask) => void;
};

export class ScanTasks {
    private readonly adapters: Map<string, ScannerAdapter>;
    private readonly jobs = new Map<string, Job>();
    private running?: Job;
    private runningCompletion?: Promise<void>;
    private probe?: Promise<Capability[]>;
    private closed = false;

    constructor(private readonly history: ScanHistory, private readonly findings: ExternalFindings,
        private readonly assets: Assets) {
        this.adapters = new Map<string, ScannerAdapter>([
            ['SEMGREP', new Semgrep(assets.root)], ['CODEQL', new CodeQl(assets.root)], ['SLITHER', new Slither(assets.root)]
        ]);
        history.recoverInterrupted();
    }

    async capabilities() {
        this.probe ??= Promise.all([...this.adapters.values()].map(adapter => adapter.capability()))
            .finally(() => { this.probe = undefined; });
        return this.probe;
    }

    supports(scanner: string) { return this.adapters.has(scanner); }

    active(projectId: string) {
        return [...this.jobs.values()].some(job => job.task.projectId === projectId);
    }

    submit(asset: Asset, scanners: string[], timeoutSeconds: number | null | undefined) {
        if (!scanners.length) throw new HttpError(400, 'NO_APPLICABLE_SCANNER');
        if (scanners.some(scanner => !this.supports(scanner))) throw new HttpError(400, 'UNSUPPORTED_SCANNER');
        if (asset.status !== 'READY') throw new HttpError(409, 'ASSET_NOT_READY');
        const now = new Date().toISOString();
        const languages = [...new Set(this.assets.manifest(asset.assetId).map(file => archiveLanguage(file.path)).filter(Boolean))].sort();
        const task: ArchivedScanTask = {
            id: randomUUID(), projectId: asset.projectId, assetId: asset.assetId, assetAvailable: true,
            requestedScanners: [...new Set(scanners)], languages, timeoutSeconds: Math.min(
                timeoutSeconds ?? MAX_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS),
            status: 'QUEUED', execution: 'LOCAL', attempt: 1, batchId: randomUUID(),
            error: '', createdAt: now, updatedAt: now, scanners: [], findingCount: 0
        };
        return this.enqueue(asset, task);
    }

    retry(task: ArchivedScanTask, authorize: (projectId: string) => void) {
        if (task.execution !== 'LOCAL' || !['FAILED', 'PARTIAL', 'CANCELLED'].includes(task.status)) {
            throw new HttpError(409, 'SCAN_TASK_NOT_RETRYABLE');
        }
        const asset = this.assets.find(task.assetId, authorize);
        if (asset.projectId !== task.projectId) throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
        const { batchStatus: _previous, ...previous } = task;
        return this.enqueue(asset, { ...previous, status: 'QUEUED', attempt: task.attempt + 1,
            batchId: randomUUID(), error: '', updatedAt: new Date().toISOString() });
    }

    private enqueue(asset: Asset, task: ArchivedScanTask) {
        if (asset.status !== 'READY') throw new HttpError(409, 'ASSET_NOT_READY');
        if (this.active(asset.projectId)) throw new HttpError(409, 'SCAN_ALREADY_RUNNING');
        if (this.closed || this.jobs.size >= MAX_QUEUED_AND_RUNNING) throw new HttpError(503, 'SCAN_QUEUE_FULL');
        let complete!: Job['complete'];
        const completion = new Promise<ArchivedScanTask>(resolve => { complete = resolve; });
        const job: Job = { root: asset.projectRoot, task, cancel: new AbortController(), complete };
        this.history.saveTask(task);
        this.jobs.set(task.id, job);
        setImmediate(() => this.advance());
        return { task, completion };
    }

    async cancel(task: ArchivedScanTask) {
        const job = this.jobs.get(task.id);
        if (!job) return task;
        if (job.task.status !== 'CANCELLED') job.task = this.setStatus(job.task, 'CANCELLED', 'SCAN_CANCELLED');
        if (this.running === job) {
            job.cancel.abort();
            await this.runningCompletion;
        } else {
            this.jobs.delete(task.id);
            job.complete(job.task);
        }
        return job.task;
    }

    async close() {
        this.closed = true;
        await Promise.all([...this.jobs.values()].map(job => this.cancel(job.task)));
    }

    private setStatus(task: ArchivedScanTask, status: ArchivedScanTask['status'], error = '') {
        const updated = { ...task, status, error, updatedAt: new Date().toISOString() };
        this.history.saveTask(updated);
        return updated;
    }

    private advance() {
        if (this.closed || this.running) return;
        const job = this.jobs.values().next().value;
        if (!job) return;
        this.running = job;
        this.runningCompletion = this.execute(job).catch(() => {
            try { job.task = this.setStatus(job.task, 'FAILED', 'SCAN_PERSISTENCE_FAILED'); }
            catch { console.error('Unable to persist scan task result'); }
        }).finally(() => {
            this.running = undefined;
            this.jobs.delete(job.task.id);
            job.complete(job.task);
            this.advance();
        });
    }

    private async execute(job: Job) {
        job.task = this.setStatus(job.task, 'RUNNING');
        const { projectId, assetId } = job.task;
        let files: ArchiveFile[];
        try {
            const asset = this.assets.find(assetId);
            this.assets.validateSource(assetId, job.root);
            if (asset.projectId !== projectId || asset.projectRoot !== job.root
                || await realpath(job.root) !== job.root || !(await lstat(job.root)).isDirectory()) {
                throw new HttpError(409, 'ASSET_SOURCE_UNAVAILABLE');
            }
            files = this.assets.manifest(assetId);
        } catch {
            if (!job.cancel.signal.aborted) job.task = this.setStatus(job.task, 'FAILED', 'ASSET_SOURCE_UNAVAILABLE');
            return;
        }
        const completed = new Set(job.task.scanners.filter(run => run.status === 'SUCCEEDED').map(run => run.scanner));
        const errors = new Set<string>();
        for (const scanner of job.task.requestedScanners) {
            if (job.cancel.signal.aborted) return;
            if (completed.has(scanner)) continue;
            const adapter = this.adapters.get(scanner);
            if (!adapter) throw new HttpError(400, 'UNSUPPORTED_SCANNER');
            const runError = await this.executeScanner(job, scanner, adapter, files);
            if (runError) errors.add(runError);
        }
        if (job.cancel.signal.aborted) return;
        const persisted = job.task;
        const outcomes = new Map(persisted.scanners.map(run => [run.scanner, run.status]));
        const statuses = persisted.requestedScanners.map(scanner => outcomes.get(scanner));
        const status = !errors.size && statuses.every(status => status === 'SUCCEEDED') ? 'SUCCEEDED'
            : statuses.some(status => status === 'SUCCEEDED' || status === 'PARTIAL') || persisted.findingCount ? 'PARTIAL' : 'FAILED';
        job.task = this.setStatus({ ...persisted, batchStatus: status }, status, [...errors].join(', '));
    }

    private async executeScanner(job: Job, scanner: string, adapter: ScannerAdapter, files: ArchiveFile[]) {
        const task = job.task;
        const startedAt = new Date().toISOString();
        const started = performance.now();
        const deadline = AbortSignal.timeout(task.timeoutSeconds * 1000);
        const signal = AbortSignal.any([job.cancel.signal, deadline]);
        let result: ScannerResult;
        try {
            result = await adapter.scan(job.root, files, signal);
        } catch {
            result = { status: 'FAILED', exitCode: -1, toolVersion: '', error: 'SCAN_EXECUTION_FAILED' };
        }
        if (job.cancel.signal.aborted) return '';
        if (deadline.aborted && !result.report) result = { ...result, status: 'TIMED_OUT', error: 'SCANNER_TIMED_OUT' };
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
            if (!report) return;
            const { omitted, conflicts } = this.findings.importInTransaction(task.projectId, report);
            if (omitted || conflicts) {
                error = 'SCAN_INVENTORY_INCOMPLETE';
                if (run.status === 'SUCCEEDED') run.status = summary.status = 'PARTIAL';
                run.error = summary.error = error;
            }
        });
        job.task = updated;
        return error || (run.status === 'SUCCEEDED' ? '' : 'SCANNER_INCOMPLETE_REPORT');
    }
}
