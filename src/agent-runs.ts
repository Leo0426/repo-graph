import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { HostedEntitlements } from './hosted-entitlements.js';

export const agentRunIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
type RunStatus = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED' | 'WAITING_FOR_REVIEW';

export interface AgentStepResult {
    subjectReference: string;
    baseline: string;
    recommendation: string;
    uncertainty: number;
    advisoryOnly: true;
    citationIds: string[];
    usage?: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null };
}

export interface AgentStep {
    id: string;
    runId: string;
    sequence: number;
    capability: string;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
    summary: string;
    evidenceReferences: string[];
    missingInfo: string[];
    results: AgentStepResult[];
    verification?: { projectId: string; snapshotId: string; unitId: string; check: 'SECURITY_GUARD' | 'REGRESSION';
        status: 'UNAVAILABLE'; citationIds: string[] };
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
}

export interface AgentRun {
    id: string;
    projectId: string;
    playbook: string;
    playbookVersion: string;
    status: RunStatus;
    inputReference: string;
    outputReference: string | null;
    statusReason: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    steps: AgentStep[];
    legacyImported?: true;
    outputUnavailable?: true;
}

export class AgentRuns {
    constructor(private readonly db: DatabaseSync, durableJobsRegistered = false, private readonly entitlements?: HostedEntitlements) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS agent_run (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                playbook TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS agent_run_project ON agent_run(project_id);
            CREATE UNIQUE INDEX IF NOT EXISTS agent_run_active ON agent_run(project_id, playbook)
                WHERE status IN ('QUEUED', 'RUNNING');
        `);
        const unmanaged = durableJobsRegistered ? 'AND NOT EXISTS (SELECT 1 FROM durable_job j WHERE j.id = agent_run.id)' : '';
        for (const row of db.prepare(`SELECT payload FROM agent_run WHERE status IN ('QUEUED', 'RUNNING') ${unmanaged}`).all()) {
            const run = JSON.parse(String(row.payload)) as AgentRun;
            this.fail(run, 'INTERRUPTED');
        }
    }

    create(projectId: string, playbook: string, inputReference: string, outputReference: string | null = null, retryFrom?: string): AgentRun {
        const now = new Date().toISOString();
        const run: AgentRun = { id: randomUUID(), projectId, playbook, playbookVersion: '1', status: 'QUEUED',
            inputReference, outputReference, statusReason: null, createdAt: now, updatedAt: now, completedAt: null, steps: [] };
        if (!this.entitlements?.enabled) {
            this.insert(run);
            return run;
        }
        const ownTransaction = !this.db.isTransaction;
        if (ownTransaction) this.db.exec('BEGIN IMMEDIATE');
        try {
            this.entitlements.task(run.id, [projectId], playbook, retryFrom);
            this.insert(run);
            if (ownTransaction) this.db.exec('COMMIT');
        } catch (error) {
            if (ownTransaction) this.db.exec('ROLLBACK');
            throw error;
        }
        return run;
    }

    private insert(run: AgentRun) {
        this.db.prepare('INSERT INTO agent_run VALUES (?, ?, ?, ?, ?)')
            .run(run.id, run.projectId, run.playbook, run.status, JSON.stringify(run));
    }

    restoreInMigrationTransaction(runs: AgentRun[]) {
        for (const run of runs) this.insert(run);
    }

    get(id: string): AgentRun | undefined {
        const row = this.db.prepare('SELECT payload FROM agent_run WHERE id = ?').get(id);
        return row ? JSON.parse(String(row.payload)) as AgentRun : undefined;
    }

    list(projectId: string, limit: number, playbook: string | null = null): AgentRun[] {
        return this.db.prepare('SELECT payload FROM agent_run WHERE project_id = ? AND (? IS NULL OR playbook = ?) ORDER BY rowid DESC LIMIT ?')
            .all(projectId, playbook, playbook, limit).map(row => JSON.parse(String(row.payload)) as AgentRun);
    }

    active(projectId: string, playbook: string) {
        return !!this.db.prepare("SELECT 1 FROM agent_run WHERE project_id = ? AND playbook = ? AND status IN ('QUEUED', 'RUNNING')")
            .get(projectId, playbook);
    }

    save(run: AgentRun) {
        run.updatedAt = new Date().toISOString();
        this.db.prepare('UPDATE agent_run SET status = ?, payload = ? WHERE id = ? AND project_id = ?')
            .run(run.status, JSON.stringify(run), run.id, run.projectId);
    }

    fail(run: AgentRun, reason: string, status: 'FAILED' | 'PARTIAL' | 'CANCELLED' = 'FAILED') {
        run.status = status;
        run.statusReason = reason;
        run.completedAt = new Date().toISOString();
        for (const step of run.steps) {
            if (step.status !== 'RUNNING') continue;
            step.status = 'FAILED';
            step.error = reason;
            step.finishedAt = run.completedAt;
        }
        this.save(run);
    }
}

export function agentStep(run: AgentRun, capability: string): AgentStep {
    const step: AgentStep = { id: randomUUID(), runId: run.id, sequence: run.steps.length + 1, capability,
        status: 'RUNNING', summary: '', evidenceReferences: [], missingInfo: [], results: [], error: null,
        startedAt: new Date().toISOString(), finishedAt: null };
    run.steps.push(step);
    return step;
}

export function finishAgentStep(step: AgentStep, status: Exclude<AgentStep['status'], 'RUNNING'>, summary: string, reason?: string) {
    step.status = status;
    step.summary = summary;
    step.finishedAt = new Date().toISOString();
    if (reason) {
        step.error = reason;
        step.missingInfo.push(reason);
    }
}
