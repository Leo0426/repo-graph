import { setImmediate as nextTurn } from 'node:timers/promises';
import { agentStep, finishAgentStep } from './agent-runs.js';
import type { AgentRun, AgentRuns, AgentStep } from './agent-runs.js';
import { findingContext, reviewFindingContext } from './external-findings.js';
import type { FindingReport } from './external-findings.js';
import { findingPublicText } from './finding-import.js';
import type { ExternalFinding, FindingFormat, normalizeFindings } from './finding-import.js';
import { GenerationError } from './generation.js';
import type { GenerationGateway } from './generation.js';
import { HttpError } from './http-error.js';
import type { RepositoryIndex } from './index.js';
import { relativeEvidencePath } from './project-file.js';
import { reviewFinding } from './triage-advisory.js';
import type { VulnerabilityFinding } from './vulnerability-inventory.js';

export const sastTriagePlaybook = 'SAST_TRIAGE';
export const maxTriageFindings = 50;
const MAX_JOBS = 4;
const DEADLINE_MS = 180_000;
const MAX_COST_USD = 0.05;
type SessionFor = GenerationGateway['session'];
type AgentIndex = Pick<RepositoryIndex, 'locate' | 'symbol' | 'graphNeighbors' | 'triagePolicy' | 'reviewQueue'>;
type Source =
    | { capability: 'IMPORT_FINDINGS'; format: FindingFormat; scan: ReturnType<typeof normalizeFindings> }
    | { capability: 'LOAD_FINDINGS'; findings: ExternalFinding[] }
    | { capability: 'LOAD_VULNERABILITY'; vulnerability: VulnerabilityFinding; codeVersion: string; ruleVersion: string };
type Input = { projectId: string; actor: string; budgetChars: number; source: Source };

function findingRef(fingerprint: string) { return 'finding:' + fingerprint; }
function inputRef(source: Source) {
    if (source.capability === 'IMPORT_FINDINGS') return 'upload:' + source.format;
    if (source.capability === 'LOAD_VULNERABILITY') return 'vulnerability:' + source.vulnerability.id;
    return source.findings.length === 1 ? findingRef(source.findings[0].fingerprint) : 'findings';
}

function load(source: Source) {
    const missingInfo: string[] = [];
    let findings: ExternalFinding[];
    if (source.capability === 'LOAD_VULNERABILITY') {
        const { vulnerability: finding, codeVersion, ruleVersion } = source;
        findings = [{ tool: 'repograph', fingerprint: finding.fingerprint, ruleId: finding.ruleId, cwe: finding.cwe,
            severity: finding.severity, filePath: relativeEvidencePath(finding.filePath), startLine: finding.startLine,
            endLine: finding.endLine, symbol: finding.dependency ? '' : finding.qualifiedName,
            message: findingPublicText([finding.title, finding.detail].filter(Boolean).join(' · '), 1500),
            trace: [], codeVersion, ruleVersion }];
    } else if (source.capability === 'IMPORT_FINDINGS') {
        findings = source.scan.findings;
        missingInfo.push(...new Set(source.scan.skipped.map(item => item.reason)));
        if (source.scan.truncated) missingInfo.push('SAST_FINDING_LIMIT');
    } else {
        findings = source.findings;
    }
    const distinct = new Map<string, ExternalFinding>();
    for (const finding of findings) if (!distinct.has(finding.fingerprint)) distinct.set(finding.fingerprint, finding);
    return { findings: [...distinct.values()], missingInfo };
}

export class SastTriageAgent {
    private readonly jobs = new Map<string, { projectId: string; cancel: AbortController; job: Promise<void> }>();

    constructor(private readonly index: AgentIndex, private readonly runs: AgentRuns, private readonly gateway: GenerationGateway) {}

    submit(input: Input, authorize: () => void) {
        if (this.runs.active(input.projectId, sastTriagePlaybook)) throw new HttpError(409, 'SAST_TRIAGE_ALREADY_RUNNING');
        if (this.jobs.size >= MAX_JOBS) throw new HttpError(503, 'SAST_TRIAGE_QUEUE_FULL');
        const run = this.runs.create(input.projectId, sastTriagePlaybook, inputRef(input.source));
        let session: ReturnType<SessionFor> | undefined;
        try { session = this.gateway.session(); } catch { /* The baseline remains available without a model connection. */ }
        const sessionFor = () => {
            if (!session) throw new GenerationError('ADVISORY_UNAVAILABLE');
            return session;
        };
        const cancel = new AbortController();
        const job = nextTurn().then(() => this.execute(run, input, authorize, sessionFor, cancel.signal)).catch(() => {
            console.error('Failed to persist SAST triage run state');
        }).finally(() => {
            this.jobs.delete(run.id);
        });
        this.jobs.set(run.id, { projectId: input.projectId, cancel, job });
        return run;
    }

    cancel(run: AgentRun, reason = 'CANCELLED') {
        if (run.status === 'QUEUED' || run.status === 'RUNNING') {
            this.runs.fail(run, reason, 'CANCELLED');
            this.jobs.get(run.id)?.cancel.abort();
        }
        return run;
    }

    cancelProject(projectId: string) {
        for (const item of this.jobs.values()) if (item.projectId === projectId) item.cancel.abort();
    }

    async close() {
        const active = [...this.jobs.entries()];
        for (const [id, handle] of active) {
            const run = this.runs.get(id);
            if (run) this.cancel(run, 'INTERRUPTED');
            handle.cancel.abort();
        }
        await Promise.all(active.map(([, handle]) => handle.job));
    }

    private begin(run: AgentRun, capability: string) {
        const step = agentStep(run, capability);
        this.runs.save(run);
        return step;
    }

    private async execute(run: AgentRun, input: Input, authorize: () => void, sessionFor: SessionFor, cancelled: AbortSignal) {
        if (cancelled.aborted || this.runs.get(run.id)?.status !== 'QUEUED') return;
        const { source, projectId, actor, budgetChars } = input;
        const deadline = AbortSignal.timeout(DEADLINE_MS);
        const signal = AbortSignal.any([cancelled, deadline]);
        run.status = 'RUNNING';
        try {
            const first = this.begin(run, source.capability);
            authorize();
            const { findings, missingInfo } = load(source);
            first.missingInfo = missingInfo;
            if (!findings.length) throw new HttpError(400, 'NO_REVIEWABLE_FINDINGS');
            first.evidenceReferences = findings.map(finding => findingRef(finding.fingerprint));
            if (source.capability === 'LOAD_VULNERABILITY') first.evidenceReferences.unshift(run.inputReference);
            finishAgentStep(first, missingInfo.length ? 'PARTIAL' : 'COMPLETED', `Loaded ${findings.length} finding(s).`);

            const collect = this.begin(run, 'BUILD_CONTEXT');
            const contexts = findings.map(finding => findingContext(this.index, projectId, finding, budgetChars));
            collect.evidenceReferences = contexts.flatMap(context => context.pack.evidence.map(item =>
                findingRef(context.finding.fingerprint) + '#' + item.citationId));
            collect.missingInfo = [...new Set(contexts.flatMap(context => context.pack.omittedReasons))]
                .slice(0, 30).map(item => findingPublicText(item, 300));
            finishAgentStep(collect, 'COMPLETED', `Prepared context for ${contexts.length} finding(s).`);

            const triage = this.begin(run, 'TRIAGE_FINDINGS');
            const reports = contexts.map(context => reviewFindingContext(this.index.triagePolicy, context));
            triage.evidenceReferences = reports.map(report => findingRef(report.finding.fingerprint));
            triage.missingInfo = [...new Set(reports.flatMap(report => report.missingInfo))]
                .slice(0, 30).map(item => findingPublicText(item, 300));
            finishAgentStep(triage, 'COMPLETED', `Built ${reports.length} baseline report(s).`);

            const model = this.begin(run, 'LLM_ADVISORY');
            await this.advise(run, model, reports, sessionFor, authorize, signal);
            if (cancelled.aborted) return;
            const submit = this.begin(run, 'SUBMIT_REVIEW');
            authorize();
            this.index.reviewQueue.submit(projectId, actor, reports, ({ snapshotId, entries }) => {
                run.outputReference = 'report-snapshot:' + snapshotId;
                submit.evidenceReferences = [run.outputReference];
                finishAgentStep(submit, 'COMPLETED', `Queued ${entries.length} report(s) for human review.`);
                const partial = first.status === 'PARTIAL' || model.status === 'FAILED' || model.status === 'PARTIAL';
                run.status = partial ? 'PARTIAL' : 'WAITING_FOR_REVIEW';
                run.statusReason = partial ? 'SAST_TRIAGE_PARTIAL' : null;
                run.completedAt = submit.finishedAt;
                this.runs.save(run);
            });
        } catch (error) {
            if (cancelled.aborted) return;
            const current = this.runs.get(run.id);
            if (!current || current.status !== 'RUNNING') return;
            const reason = error instanceof HttpError ? error.message : 'SAST_TRIAGE_FAILED';
            this.runs.fail(current, reason, current.steps.length === 1 ? 'FAILED' : 'PARTIAL');
        }
    }

    private async advise(run: AgentRun, step: AgentStep, reports: FindingReport[], sessionFor: SessionFor, authorize: () => void, signal: AbortSignal) {
        let disabled = 0;
        let failed = 0;
        const notes = new Set<string>();
        for (const report of reports) {
            if (signal.aborted) { notes.add('SAST_TRIAGE_DEADLINE'); failed++; break; }
            authorize();
            const advisory = await reviewFinding(sessionFor, report, signal, MAX_COST_USD / reports.length);
            if (signal.aborted) { notes.add('SAST_TRIAGE_DEADLINE'); failed++; break; }
            if (advisory.status === 'DISABLED') { disabled = reports.length; notes.add('GENERATION_DISABLED'); break; }
            for (const reason of advisory.missingInfo) {
                if (/^(?:ADVISORY|INVALID_ADVISORY|GENERATION|INVALID_PROVIDER|PROVIDER)_[A-Z0-9_]{1,60}$/.test(reason)) notes.add(reason);
            }
            if (advisory.status === 'COMPLETED') {
                const subjectReference = findingRef(report.finding.fingerprint);
                step.evidenceReferences.push(...advisory.citations.map(id => subjectReference + '#' + id));
                step.results.push({ subjectReference, baseline: report.verdict, recommendation: advisory.suggestedVerdict ?? '',
                    uncertainty: advisory.uncertainty, citationIds: advisory.citations, advisoryOnly: true, usage: advisory.usage });
            } else failed++;
            step.missingInfo = [...notes];
            this.runs.save(run);
        }
        step.missingInfo = [...notes];
        const status = disabled ? 'SKIPPED' : failed ? step.results.length ? 'PARTIAL' : 'FAILED' : 'COMPLETED';
        finishAgentStep(step, status, disabled ? 'The generation model is disabled.'
            : `Reviewed ${step.results.length} of ${reports.length} finding(s) with the model.`);
    }
}
