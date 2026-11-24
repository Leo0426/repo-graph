import { z } from 'zod';
import { agentRunIdPattern } from './agent-runs.js';
import type { AgentRun, AgentStep } from './agent-runs.js';
import type { ChangeSnapshot } from './change-review.js';
import { findingPublicText } from './finding-import.js';
import type { ReportSnapshot } from './review-queue.js';

const uuid = z.string().regex(agentRunIdPattern);
const projectId = z.string().regex(/^[a-f0-9]{12}$/);
const stepId = z.string().regex(/^[a-zA-Z0-9:_-]{1,160}$/);
const date = z.iso.datetime({ offset: true });
const optionalDate = z.union([date, z.literal('')]).nullish().transform(value => value || null);
const text = z.string().nullish().transform(value => value ?? '');
const position = z.number().int().min(0).max(2_147_483_647);

export const legacyAgentRun = z.object({
    id: uuid, project_id: projectId, playbook: z.enum(['SAST_TRIAGE', 'WIKI_SUMMARY', 'CHANGE_REVIEW']),
    playbook_version: text, status: z.enum(['QUEUED', 'RUNNING', 'WAITING_FOR_REVIEW', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']),
    input_reference: text, output_reference: text, status_reason: text, created_at: date, updated_at: date, completed_at: optionalDate
});
export const legacyAgentStep = z.object({
    id: stepId, run_id: uuid, sequence_no: position.min(1), capability: z.string().regex(/^[A-Z0-9_]{1,100}$/),
    status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'SKIPPED', 'FAILED']),
    summary: text, error: text, started_at: date, finished_at: optionalDate
});
export const legacyAgentReference = z.object({
    step_id: stepId, kind: z.enum(['EVIDENCE', 'MISSING']), position, reference_value: text
});
export const legacyAgentResult = z.object({
    step_id: stepId, position, subject_reference: text, baseline: text, recommendation: text,
    uncertainty: z.number().min(0).max(1), advisory_only: z.literal([0, 1])
});

function interrupted(run: AgentRun) { return run.status === 'RUNNING' || run.status === 'QUEUED'; }

function reason(value: string) {
    if (!value.trim()) return null;
    return /^[A-Z][A-Z0-9_]*(?:[ ,]+[A-Z][A-Z0-9_]*)*$/.test(value.trim()) && value.length <= 200
        ? value.trim() : 'LEGACY_DETAIL_OMITTED';
}

function timeOrder(left: string, right: string) {
    const fraction = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0');
    return Date.parse(left) - Date.parse(right) || fraction(left).localeCompare(fraction(right));
}

function publicReference(value: string, sourceProject: string, targetProject: string) {
    const remapped = ['facts:graph:', 'summaries:project:'].find(prefix => value === prefix + sourceProject);
    return remapped ? remapped + targetProject : findingPublicText(value, 1000);
}

type RunRow = z.infer<typeof legacyAgentRun>;
type StepRow = z.infer<typeof legacyAgentStep>;
type ReferenceRow = z.infer<typeof legacyAgentReference>;
type ResultRow = z.infer<typeof legacyAgentResult>;

export function prepareLegacyAgentRuns(
    input: { runs: RunRow[]; steps: StepRow[]; references: ReferenceRow[]; results: ResultRow[] },
    projects: ReadonlyMap<string, string>, snapshots: ReportSnapshot[], changes: ChangeSnapshot[], wikiProjects: ReadonlySet<string>
) {
    const snapshotsById = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
    const changeOwners = new Map(changes.map(snapshot => [snapshot.id, snapshot.projectId]));
    const runs = new Map<string, { history: AgentRun; originalProject: string }>();
    const steps = new Map<string, { step: AgentStep; run: AgentRun }>();
    let referenceCount = 0;
    let resultCount = 0;
    for (const row of input.runs.slice().sort((a, b) => timeOrder(a.created_at, b.created_at) || a.id.localeCompare(b.id))) {
        const projectId = projects.get(row.project_id);
        if (!projectId) continue;
        const output = publicReference(row.output_reference, row.project_id, projectId);
        const snapshotId = /^report-snapshot:(.+)$/.exec(output)?.[1];
        const changeId = /^change-review:(.+)$/.exec(output)?.[1];
        const available = (row.playbook === 'SAST_TRIAGE' && snapshotId && snapshotsById.get(snapshotId)?.projectId === projectId)
            || (row.playbook === 'CHANGE_REVIEW' && changeId && changeOwners.get(changeId) === projectId)
            || (row.playbook === 'WIKI_SUMMARY' && output === 'summaries:project:' + projectId && wikiProjects.has(projectId));
        runs.set(row.id, { originalProject: row.project_id, history: { id: row.id, projectId, playbook: row.playbook,
            playbookVersion: findingPublicText(row.playbook_version, 100), status: row.status, legacyImported: true,
            inputReference: publicReference(row.input_reference, row.project_id, projectId), outputReference: output || null,
            ...(output && !available ? { outputUnavailable: true } : {}),
            statusReason: reason(row.status_reason), createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at, steps: [] } });
    }
    for (const row of input.steps.slice().sort((a, b) => a.sequence_no - b.sequence_no || a.id.localeCompare(b.id))) {
        const owner = runs.get(row.run_id);
        if (!owner) continue;
        const { history } = owner;
        const omitSummary = history.playbook === 'WIKI_SUMMARY' && row.status === 'FAILED' && !reason(row.summary)?.startsWith('WIKI_');
        const step: AgentStep = { id: row.id, runId: history.id, sequence: row.sequence_no, capability: row.capability,
            status: row.status, summary: omitSummary ? '' : findingPublicText(row.summary, 1500),
            error: reason(row.error) ?? (omitSummary && row.summary ? 'LEGACY_DETAIL_OMITTED' : null),
            startedAt: row.started_at, finishedAt: row.finished_at, evidenceReferences: [], missingInfo: [], results: [] };
        history.steps.push(step);
        steps.set(row.id, { step, run: history });
    }
    for (const row of input.references.slice().sort((a, b) => a.position - b.position)) {
        const owner = steps.get(row.step_id);
        if (!owner) continue;
        const { step, run } = owner;
        const original = runs.get(run.id)!.originalProject;
        const value = publicReference(row.reference_value, original, run.projectId);
        if (!value) continue;
        (row.kind === 'EVIDENCE' ? step.evidenceReferences : step.missingInfo).push(value);
        referenceCount++;
    }
    for (const row of input.results.slice().sort((a, b) => a.position - b.position)) {
        const owner = steps.get(row.step_id);
        if (!owner || row.advisory_only !== 1) continue;
        const { step, run } = owner;
        const subjectReference = findingPublicText(row.subject_reference, 1000);
        const prefix = subjectReference + '#';
        let citationIds = run.playbook === 'SAST_TRIAGE' && step.capability === 'LLM_ADVISORY' && /^finding:[a-f0-9]{16}$/.test(subjectReference)
            ? [...new Set(step.evidenceReferences.filter(ref => ref.startsWith(prefix)).map(ref => ref.slice(prefix.length))
                .filter(id => /^[a-zA-Z0-9_.:-]{1,80}$/.test(id)))] : [];
        if (citationIds.length && run.outputReference && !run.outputUnavailable) {
            const snapshot = snapshotsById.get(run.outputReference.slice('report-snapshot:'.length));
            const reports = snapshot?.reports.filter(report => 'finding:' + report.finding.fingerprint === subjectReference) ?? [];
            const allowed = new Set(reports.length === 1 ? reports[0].pack.evidence.map(item => item.citationId) : []);
            citationIds = citationIds.filter(id => allowed.has(id));
        }
        step.results.push({ subjectReference, baseline: findingPublicText(row.baseline, 200),
            recommendation: findingPublicText(row.recommendation, 1500), uncertainty: row.uncertainty, advisoryOnly: true, citationIds });
        resultCount++;
    }
    const histories = [...runs.values()].map(({ history }) => history);
    const migrationTime = Date.now();
    for (const run of histories) {
        if (!interrupted(run)) continue;
        const finishedAt = new Date(run.steps.reduce((time, step) => Math.max(time, Date.parse(step.startedAt)),
            Math.max(migrationTime, Date.parse(run.updatedAt)))).toISOString();
        run.status = run.steps.some(step => step.status === 'COMPLETED') ? 'PARTIAL' : 'FAILED';
        run.statusReason = 'PROCESS_INTERRUPTED';
        run.updatedAt = run.completedAt = finishedAt;
        for (const step of run.steps) {
            if (step.status !== 'RUNNING') continue;
            step.status = 'FAILED';
            step.error = 'PROCESS_INTERRUPTED';
            step.finishedAt = finishedAt;
        }
    }
    return { histories, steps: steps.size, references: referenceCount, results: resultCount };
}
