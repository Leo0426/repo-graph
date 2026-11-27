import { constants } from 'node:fs';
import { access, lstat } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from './http-error.js';
import type { RepositoryIndex } from './index.js';
import { RequestMetrics } from './request-metrics.js';
import type { OllamaEmbedding } from './vector.js';

export class DispatcherHealth {
    private lastPoll?: { time: number; ok: boolean };

    observe(ok: boolean) {
        const changed = this.lastPoll?.ok !== ok;
        this.lastPoll = { time: Date.now(), ok };
        return changed;
    }

    status(running: boolean) {
        const poll = this.lastPoll;
        const status = !running ? 'stopped' : !poll ? 'starting' : !poll.ok ? 'unavailable'
            : Date.now() - poll.time > 5000 ? 'stale' : 'available';
        return { status, lastPollAt: poll ? new Date(poll.time).toISOString() : null };
    }
}

export async function directoryAvailability(path: string) {
    try {
        if (!(await lstat(path)).isDirectory()) return 'unavailable';
        await access(path, constants.R_OK | constants.X_OK);
        try {
            await access(path, constants.W_OK);
            return 'available';
        } catch { return 'read-only'; }
    } catch { return 'unavailable'; }
}

type RequestObservation = { id: string; status: number; durationMs: number; completedAt: string; runId?: string };
const diagnosticsLimit = 500;

export class Operability {
    private readonly requests = new Map<string, RequestObservation>();
    private readonly responseCounts = { success: 0, accepted: 0, clientError: 0, serverError: 0, disconnected: 0 };

    readonly metrics: RequestMetrics;

    constructor(private readonly db: DatabaseSync) {
        this.metrics = new RequestMetrics(db);
    }

    finishRequest(id: string, status: number, milliseconds: number, location?: unknown) {
        this.metrics.record(status, milliseconds);
        const counts = this.responseCounts;
        if (!status) counts.disconnected++;
        else if (status >= 500) counts.serverError++;
        else if (status >= 400) counts.clientError++;
        else {
            counts.success++;
            if (status === 202) counts.accepted++;
        }
        const runId = status === 202 && typeof location === 'string'
            ? /^\/api\/v1\/(?:agent-runs|verifications)\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.exec(location)?.[1] : undefined;
        this.requests.set(id, { id, status, durationMs: Math.round(milliseconds), completedAt: new Date().toISOString(),
            ...(runId ? { runId } : {}) });
        if (this.requests.size > diagnosticsLimit) this.requests.delete(this.requests.keys().next().value!);
    }

    request(id: string) {
        const entry = this.requests.get(id);
        if (!entry) throw new HttpError(404, 'DIAGNOSTIC_REQUEST_NOT_FOUND');
        return entry;
    }

    activity() {
        const now = Date.now();
        const unavailableQueues: string[] = [];
        const queue = (['durable_job', 'ask_job'] as const).flatMap(table => {
            try {
                return this.db.prepare(`SELECT kind, state, count(*) AS count,
                    sum(state = 'RUNNING' AND coalesce(lease_expires <= ?, 0)) AS expiredLeases,
                    min(CASE WHEN state = 'QUEUED' AND available_at <= ? THEN available_at END) AS oldestReadyAt
                    FROM ${table} GROUP BY kind, state ORDER BY kind, state`).all(now, now).map(row => ({
                    kind: String(row.kind), state: String(row.state), count: Number(row.count), expiredLeases: Number(row.expiredLeases),
                    oldestReadyAgeMs: typeof row.oldestReadyAt === 'number' ? now - row.oldestReadyAt : null
                }));
            } catch {
                unavailableQueues.push(table === 'ask_job' ? 'ask' : 'repository');
                return [];
            }
        });
        return { requests: { ...this.responseCounts, retained: this.requests.size }, queue, unavailableQueues };
    }

    indexAvailable() {
        try {
            this.db.prepare("SELECT rowid FROM unit_search WHERE unit_search MATCH 'repographoperabilityprobe' LIMIT 1").get();
            this.db.prepare("SELECT rowid FROM knowledge_unit_search WHERE knowledge_unit_search MATCH 'repographoperabilityprobe' LIMIT 1").get();
            this.db.prepare("SELECT rowid FROM wiki_page_terms WHERE wiki_page_terms MATCH 'repographoperabilityprobe' LIMIT 1").get();
            return true;
        } catch { return false; }
    }

    run(id: string) {
        const row = this.db.prepare(`SELECT a.id, a.playbook, a.status, a.payload,
            d.state AS queueState, d.attempt, d.available_at AS availableAt, d.stop_requested AS stopRequested
            FROM agent_run a LEFT JOIN durable_job d ON d.id = a.id WHERE a.id = ?`).get(id);
        if (!row) throw new HttpError(404, 'DIAGNOSTIC_RUN_NOT_FOUND');
        const { payload, ...run } = row;
        const details = JSON.parse(String(payload)) as import('./agent-runs.js').AgentRun;
        const steps = details.steps.map(({ sequence, status }) => ({ sequence, status }));
        return { ...run, createdAt: details.createdAt, updatedAt: details.updatedAt, completedAt: details.completedAt,
            progress: { completed: steps.filter(step => ['COMPLETED', 'PARTIAL', 'FAILED', 'SKIPPED'].includes(step.status)).length,
                total: steps.length, failed: steps.filter(step => step.status === 'FAILED').map(step => step.sequence) },
            steps };
    }
}

export async function diagnosticReport(repository: RepositoryIndex, embedding: OllamaEmbedding | undefined, signal: AbortSignal) {
    const [managedFiles, vectorSearch] = await Promise.all([
        directoryAvailability(repository.assets.root),
        embedding ? embedding.available(signal).then(ok => ok ? 'available' : 'unavailable') : 'disabled'
    ]);
    signal.throwIfAborted();
    const database = repository.storageAvailable() ? 'available' : 'unavailable';
    const fullText = repository.operations.indexAvailable() ? 'available' : 'unavailable';
    const verifier = database === 'available' ? repository.verifications.diagnostics() : undefined;
    const workers = { wiki: repository.wiki.workerHealth(), gitSync: repository.gitSources.workerHealth(),
        ask: repository.ask.workerHealth(), changeReview: repository.changeReviewAgent.workerHealth(), sastTriage: repository.sastTriageAgent.workerHealth(),
        archiveScan: repository.scans.workerHealth(),
        localIndex: repository.localIndexes.workerHealth(),
        ...(verifier?.configured && { isolatedVerification: verifier }) };
    const generation = database === 'available' ? repository.generation.availability() : { status: 'unavailable', checkedAt: null, reason: null };
    const activity = database === 'available' ? repository.operations.activity() : null;
    const metrics = repository.operations.metrics.status();
    const degraded = !metrics.available || [managedFiles, fullText, vectorSearch, generation.status].some(state => ['read-only', 'unavailable'].includes(state))
        || Object.values(workers).some(worker => worker.status !== 'available') || Boolean(verifier?.awaitingReconciliation)
        || workers.archiveScan.awaitingReconciliation || Boolean(workers.localIndex.awaitingReconciliation)
        || Boolean(activity?.unavailableQueues.length);
    return { status: database === 'unavailable' ? 'unavailable' : degraded ? 'degraded' : 'ok',
        observedAt: new Date().toISOString(), components: { database, managedFiles, fullText, vectorSearch, generation, workers, metrics },
        activity };
}
