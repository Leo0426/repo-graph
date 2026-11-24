import { z } from 'zod';
import { findingPublicText } from './finding-import.js';
import type { ExternalFinding } from './finding-import.js';
import { formatLegacyFinding, legacyFindingSchema } from './legacy-reviews.js';
import { scanHistoryId, scannerRunStatuses, scanTaskStatuses } from './scan-history.js';
import type { ArchivedScannerRun, ArchivedScanTask } from './scan-history.js';

const id = z.string().regex(scanHistoryId);
const projectId = z.string().regex(/^[a-f0-9]{12}$/);
const date = z.iso.datetime({ local: false });
const label = z.string().regex(/^[A-Za-z][A-Za-z0-9_.+#-]{0,63}$/);
const text = z.string().nullish().transform(value => value ?? '');
const optionalId = z.union([id, z.literal('')]);
const runStatus = z.enum(scannerRunStatuses);
const batchStatus = z.enum(['SUCCEEDED', 'PARTIAL', 'FAILED']);
const runRecord = z.object({
    scanId: id, projectId, scanner: label, status: runStatus, toolVersion: text, exitCode: z.int(), durationMs: z.int().nonnegative(),
    startedAt: date, finishedAt: date, error: text, findings: z.array(legacyFindingSchema).nullish()
});
const batchRecord = z.object({ batchId: id, projectId, status: batchStatus, runs: z.array(runRecord) });
const labels = z.array(label);

export const legacyScannerRun = z.object({
    scan_id: id, batch_id: id, project_id: projectId, scanner: label, status: runStatus, started_at: date, result_json: z.string()
});
export const legacyScanTask = z.object({
    id, project_id: projectId, asset_id: optionalId, scanners: z.string(), languages: z.string(), timeout_seconds: z.int().nonnegative(),
    status: z.enum(scanTaskStatuses), attempt: z.int().nonnegative(), batch_id: optionalId, error: text,
    batch_json: z.string().nullish(), created_at: date, updated_at: date
});

function archivedError(error: string) {
    if (!error || error === 'PROCESS_INTERRUPTED' || error === 'EXECUTOR_REJECTED'
        || /^version probe exited with code -?\d{1,10}$/.test(error)) return error;
    return 'LEGACY_SCAN_ERROR_OMITTED';
}

function normalizeRun(input: z.infer<typeof runRecord>, targetProject: string, batchId: string): ArchivedScannerRun {
    return {
        ...input, projectId: targetProject, batchId, toolVersion: findingPublicText(input.toolVersion, 120),
        error: archivedError(input.error), findingCount: input.findings?.length ?? 0,
        findings: (input.findings ?? []).map(finding => formatLegacyFinding(finding, '', ''))
    };
}

export function prepareLegacyScanHistory(
    runRows: z.infer<typeof legacyScannerRun>[], taskRows: z.infer<typeof legacyScanTask>[],
    projects: ReadonlyMap<string, string>, assets: ReadonlyMap<string, string>
) {
    const runs = new Map<string, ArchivedScannerRun>();
    for (const row of runRows) {
        const target = projects.get(row.project_id);
        if (!target) continue;
        const input = runRecord.parse(JSON.parse(row.result_json));
        if (input.scanId !== row.scan_id || input.projectId !== row.project_id || input.scanner !== row.scanner
            || input.status !== row.status || input.startedAt !== row.started_at || runs.has(input.scanId)) {
            throw new Error('Invalid legacy scan run identity');
        }
        runs.set(input.scanId, normalizeRun(input, target, row.batch_id));
    }
    const storedRuns = runs.size;
    const tasks: { task: ArchivedScanTask; findings: ExternalFinding[] }[] = [];
    for (const row of taskRows) {
        const target = projects.get(row.project_id);
        if (!target) continue;
        const captured = row.batch_json ? batchRecord.parse(JSON.parse(row.batch_json)) : undefined;
        if (captured && (captured.projectId !== row.project_id || captured.batchId !== row.batch_id)) {
            throw new Error('Invalid legacy scan batch identity');
        }
        const findings = new Map<string, ExternalFinding>();
        const scanners = (captured?.runs ?? []).map(input => {
            const existing = runs.get(input.scanId);
            if (input.projectId !== row.project_id || (existing && (existing.projectId !== target || existing.scanner !== input.scanner))) {
                throw new Error('Invalid legacy task run scope');
            }
            // Retries can carry an earlier result. The standalone row provides the run's original batch.
            const run = normalizeRun(input, target, existing?.batchId ?? '');
            if (!existing) runs.set(run.scanId, run);
            const { findings: observations, ...summary } = run;
            for (const finding of observations) if (!findings.has(finding.fingerprint)) findings.set(finding.fingerprint, finding);
            return summary;
        });
        const originalStatus = row.status === 'QUEUED' || row.status === 'RUNNING' ? row.status : undefined;
        const task: ArchivedScanTask = {
            id: row.id, projectId: target, assetId: row.asset_id, assetAvailable: assets.get(row.asset_id) === target,
            requestedScanners: labels.parse(JSON.parse(row.scanners)), languages: labels.parse(JSON.parse(row.languages)),
            timeoutSeconds: row.timeout_seconds, status: row.status === 'QUEUED' || row.status === 'RUNNING' ? 'FAILED' : row.status,
            ...(originalStatus ? { originalStatus } : {}), attempt: row.attempt, batchId: row.batch_id,
            ...(captured ? { batchStatus: captured.status } : {}), error: originalStatus ? 'PROCESS_INTERRUPTED' : archivedError(row.error),
            createdAt: row.created_at, updatedAt: row.updated_at, scanners, findingCount: findings.size
        };
        tasks.push({ task, findings: [...findings.values()] });
    }
    return { tasks, runs, storedRuns, embeddedRuns: runs.size - storedRuns };
}
