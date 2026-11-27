import type { DatabaseSync } from 'node:sqlite';
import type { ExternalFinding } from './finding-import.js';

export const scanHistoryId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const scannerRunStatuses = ['SUCCEEDED', 'PARTIAL', 'FAILED', 'TIMED_OUT', 'UNAVAILABLE'] as const;
export const scanTaskStatuses = ['QUEUED', 'RUNNING', 'PAUSED', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'] as const;

export interface ArchivedScannerSummary {
    scanId: string;
    projectId: string;
    batchId: string;
    scanner: string;
    status: typeof scannerRunStatuses[number];
    toolVersion: string;
    exitCode: number;
    durationMs: number;
    startedAt: string;
    finishedAt: string;
    error: string;
    findingCount: number;
}

export interface ArchivedScannerRun extends ArchivedScannerSummary {
    findings: ExternalFinding[];
}

export interface ArchivedScanTask {
    id: string;
    projectId: string;
    assetId: string;
    assetAvailable: boolean;
    requestedScanners: string[];
    languages: string[];
    timeoutSeconds: number;
    status: typeof scanTaskStatuses[number];
    execution?: 'LOCAL';
    originalStatus?: 'QUEUED' | 'RUNNING';
    attempt: number;
    batchId: string;
    batchStatus?: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
    error: string;
    createdAt: string;
    updatedAt: string;
    scanners: ArchivedScannerSummary[];
    findingCount: number;
}

export interface ScanHistoryPage<T> { entries: T[]; page: number; size: number; total: number }
export interface ScanFindingsPage { findings: ExternalFinding[]; page: number; size: number; total: number }

function timeKey(value: string) {
    const [whole, fraction = ''] = value.slice(0, -1).split('.');
    return whole + '.' + fraction.padEnd(9, '0');
}

function readPayload<T>(row: { payload?: unknown }) { return JSON.parse(String(row.payload)) as T; }

export class ScanHistory {
    constructor(private readonly db: DatabaseSync) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS scan_history_task (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS scan_history_task_project ON scan_history_task(project_id, updated_at DESC, id DESC);
            CREATE TABLE IF NOT EXISTS scan_history_run (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                started_at TEXT NOT NULL,
                payload TEXT NOT NULL,
                findings TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS scan_history_run_project ON scan_history_run(project_id, started_at DESC, id DESC);
            CREATE TABLE IF NOT EXISTS scan_history_task_finding (
                task_id TEXT NOT NULL REFERENCES scan_history_task(id) ON DELETE CASCADE,
                ordinal INTEGER NOT NULL,
                payload TEXT NOT NULL,
                PRIMARY KEY(task_id, ordinal)
            );
        `);
    }

    restoreInMigrationTransaction(tasks: { task: ArchivedScanTask; findings: ExternalFinding[] }[], runs: ArchivedScannerRun[]) {
        for (const { task, findings } of tasks) {
            this.saveTask(task);
            this.saveFindings(task.id, findings);
        }
        for (const run of runs) this.saveRun(run);
    }

    saveTask(task: ArchivedScanTask) {
        this.db.prepare(`INSERT INTO scan_history_task VALUES (?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload`)
            .run(task.id, task.projectId, timeKey(task.updatedAt), JSON.stringify(task));
    }

    private saveFindings(taskId: string, findings: ExternalFinding[]) {
        const saveFinding = this.db.prepare('INSERT INTO scan_history_task_finding VALUES (?,?,?)');
        this.db.prepare('DELETE FROM scan_history_task_finding WHERE task_id = ?').run(taskId);
        findings.forEach((finding, ordinal) => saveFinding.run(taskId, ordinal, JSON.stringify(finding)));
    }

    private saveRun({ findings, ...run }: ArchivedScannerRun) {
        this.db.prepare('INSERT INTO scan_history_run VALUES (?,?,?,?,?)')
            .run(run.scanId, run.projectId, timeKey(run.startedAt), JSON.stringify(run), JSON.stringify(findings));
    }

    recordRun(task: ArchivedScanTask, run: ArchivedScannerRun, observations: ExternalFinding[], publish: () => void) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            publish();
            this.saveTask(task);
            this.saveRun(run);
            this.saveFindings(task.id, observations);
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    recoverInterrupted() {
        const rows = this.db.prepare(`SELECT payload FROM scan_history_task
            WHERE json_extract(payload, '$.status') IN ('QUEUED', 'RUNNING')
            AND NOT EXISTS (SELECT 1 FROM scan_execution WHERE task_id = scan_history_task.id)`).all();
        for (const row of rows) {
            const task = readPayload<ArchivedScanTask>(row);
            this.saveTask({ ...task, status: 'FAILED', error: 'PROCESS_INTERRUPTED', updatedAt: new Date().toISOString() });
        }
    }

    listTasks(projectId: string, page: number, size: number): ScanHistoryPage<ArchivedScanTask> {
        return this.list('scan_history_task', 'updated_at', projectId, page, size);
    }

    listRuns(projectId: string, page: number, size: number): ScanHistoryPage<ArchivedScannerSummary> {
        return this.list('scan_history_run', 'started_at', projectId, page, size);
    }

    private list<T>(table: 'scan_history_task' | 'scan_history_run', order: 'updated_at' | 'started_at',
        projectId: string, page: number, size: number): ScanHistoryPage<T> {
        const total = Number(this.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE project_id = ?`).get(projectId)?.n);
        const entries = this.db.prepare(`SELECT payload FROM ${table} WHERE project_id = ?
            ORDER BY ${order} DESC, id DESC LIMIT ? OFFSET ?`).all(projectId, size, page * size).map(readPayload<T>);
        return { entries, page, size, total };
    }

    task(id: string) {
        const row = this.db.prepare('SELECT payload FROM scan_history_task WHERE id = ?').get(id);
        return row && readPayload<ArchivedScanTask>(row);
    }

    runSummary(id: string) {
        const row = this.db.prepare('SELECT payload FROM scan_history_run WHERE id = ?').get(id);
        return row && readPayload<ArchivedScannerSummary>(row);
    }

    runFindings(id: string): ExternalFinding[] {
        const row = this.db.prepare('SELECT findings FROM scan_history_run WHERE id = ?').get(id);
        return row ? JSON.parse(String(row.findings)) as ExternalFinding[] : [];
    }

    allRuns(projectId: string): ArchivedScannerRun[] {
        return this.db.prepare(`SELECT payload, findings FROM scan_history_run WHERE project_id = ?
            ORDER BY started_at DESC, id DESC`).all(projectId).map(row => ({
            ...readPayload<ArchivedScannerSummary>(row), findings: JSON.parse(String(row.findings)) as ExternalFinding[]
        }));
    }

    findings(task: ArchivedScanTask, page: number, size: number): ScanFindingsPage {
        const findings = this.db.prepare(`SELECT payload FROM scan_history_task_finding WHERE task_id = ?
            AND ordinal >= ? ORDER BY ordinal LIMIT ?`).all(task.id, page * size, size).map(readPayload<ExternalFinding>);
        return { findings, page, size, total: task.findingCount };
    }
}
