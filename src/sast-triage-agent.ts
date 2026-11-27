import { setImmediate as nextTurn } from 'node:timers/promises';
import type { DatabaseSync } from 'node:sqlite';
import { agentStep, finishAgentStep } from './agent-runs.js';
import type { AgentRun, AgentStep } from './agent-runs.js';
import { DurableJobs } from './durable-jobs.js';
import type { JobAction } from './durable-jobs.js';
import { findingContext, reviewFindingContext } from './external-findings.js';
import type { FindingReport } from './external-findings.js';
import { findingPublicText } from './finding-import.js';
import type { ExternalFinding, FindingFormat, normalizeFindings } from './finding-import.js';
import { GenerationError } from './generation.js';
import type { GenerationGateway } from './generation.js';
import { HttpError } from './http-error.js';
import type { Account } from './identity.js';
import type { RepositoryIndex } from './index.js';
import { DispatcherHealth } from './operability.js';
import { relativeEvidencePath } from './project-file.js';
import { digest } from './source.js';
import { reviewFinding } from './triage-advisory.js';
import type { VulnerabilityFinding } from './vulnerability-inventory.js';

export const sastTriagePlaybook = 'SAST_TRIAGE';
export const maxTriageFindings = 50;
const MAX_JOBS = 4;
const MAX_PENDING = 100;
const LEASE_MS = 2500;
const DEADLINE_MS = 180_000;
const MAX_COST_USD = 0.05;
type SessionFor = GenerationGateway['session'];
type Source =
    | { capability: 'IMPORT_FINDINGS'; format: FindingFormat; scan: ReturnType<typeof normalizeFindings> }
    | { capability: 'LOAD_FINDINGS'; findings: ExternalFinding[] }
    | { capability: 'LOAD_VULNERABILITY'; vulnerability: VulnerabilityFinding; codeVersion: string; ruleVersion: string };
type Input = { projectId: string; budgetChars: number; source: Source };
type Frozen = ReturnType<SastTriageAgent['capture']>;
type JobInput = { version: 1; credentialVersion: number; username: string; frozen: Frozen; model: ReturnType<GenerationGateway['freeze']> | null };
type Queue = DurableJobs<JobInput>;
type Lease = NonNullable<ReturnType<Queue['claim']>>;
type State = NonNullable<ReturnType<Queue['get']>>;
type Progress = { position: number; failed: number; disabled: number };

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
    private readonly queue: Queue;
    private readonly dispatcher = new DispatcherHealth();
    private timer?: ReturnType<typeof setInterval>;
    private closing = false;

    constructor(private readonly db: DatabaseSync, private readonly repo: RepositoryIndex) {
        this.queue = new DurableJobs<JobInput>(db);
        db.exec(`CREATE TABLE IF NOT EXISTS sast_triage_progress (
            run_id TEXT PRIMARY KEY REFERENCES durable_job(id) ON DELETE CASCADE,
            position INTEGER NOT NULL, failed INTEGER NOT NULL, disabled INTEGER NOT NULL
        )`);
    }

    private get runs() { return this.repo.agentRuns; }

    private transaction<T>(operation: () => T) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = operation();
            this.db.exec('COMMIT');
            return result;
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }

    private capture({ projectId, source, budgetChars }: Input) {
        const { findings, missingInfo } = load(source);
        const contexts = findings.map(finding => findingContext(this.repo, projectId, finding, budgetChars));
        return { capability: source.capability, references: findings.map(finding => findingRef(finding.fingerprint)), missingInfo,
            contextReferences: contexts.flatMap(context => context.pack.evidence.map(item => findingRef(context.finding.fingerprint) + '#' + item.citationId)),
            contextOmissions: [...new Set(contexts.flatMap(context => context.pack.omittedReasons))].slice(0, 30).map(item => findingPublicText(item, 300)),
            reports: contexts.map(context => reviewFindingContext(this.repo.triagePolicy, context)) };
    }

    submit(input: Input, actor: Account, key?: string) {
        const { projectId, source, budgetChars } = input;
        const requested = source.capability === 'IMPORT_FINDINGS' ? source.scan : source.capability === 'LOAD_FINDINGS'
            ? source.findings.map(finding => finding.fingerprint) : [source.vulnerability.id, source.codeVersion, source.ruleVersion];
        const fingerprint = digest(JSON.stringify([budgetChars, source.capability, inputRef(source), requested]));
        const run = this.transaction(() => {
            this.repo.identity.requireProjectEditor(actor, projectId);
            if (key) {
                const previous = this.queue.findRequest(sastTriagePlaybook, projectId, actor.id, key, fingerprint);
                if (previous) return this.runs.get(previous)!;
            }
            if (this.queue.hasActive(sastTriagePlaybook, projectId) || this.runs.active(projectId, sastTriagePlaybook)) {
                throw new HttpError(409, 'SAST_TRIAGE_ALREADY_RUNNING');
            }
            if (this.queue.pending(sastTriagePlaybook) >= MAX_PENDING) throw new HttpError(503, 'SAST_TRIAGE_QUEUE_FULL');
            const created = this.runs.create(projectId, sastTriagePlaybook, inputRef(source));
            const frozen = this.capture(input);
            let model: JobInput['model'] = null;
            try { model = this.repo.generation.freeze(); } catch { /* The baseline remains available without a model. */ }
            this.queue.enqueue({ id: created.id, projectId, actorId: actor.id, kind: sastTriagePlaybook, key, fingerprint,
                input: { version: 1, frozen, model, credentialVersion: actor.credentialVersion, username: actor.username },
                availableAt: Date.now(), budgetMs: DEADLINE_MS });
            this.db.prepare('INSERT INTO sast_triage_progress VALUES (?,0,0,0)').run(created.id);
            created.playbookVersion = '2';
            this.runs.save(created);
            return created;
        });
        this.dispatch();
        return run;
    }

    start() {
        if (!this.timer) this.timer = setInterval(() => this.dispatch(), 250).unref();
        this.dispatch();
    }

    execution(id: string) { return this.queue.get(id); }
    attempts(id: string) { return this.queue.history(id); }
    workerHealth() { return this.dispatcher.status(!!this.timer && !this.closing); }

    control(run: AgentRun, actor: Account, action: JobAction, revision?: number, priority?: number) {
        const changed = this.transaction(() => {
            const job = this.queue.get(run.id);
            if (!job || run.playbook !== sastTriagePlaybook) throw new HttpError(404, 'JOB_NOT_FOUND');
            this.repo.identity.requireProjectEditor(actor, job.projectId);
            if (job.actorId !== actor.id || action === 'prioritize' || priority !== undefined) this.repo.identity.requireProjectManager(actor, job.projectId);
            const state = this.queue.change(run.id, revision ?? job.revision, action, priority);
            this.sync(state);
            return state;
        });
        if (changed.stopRequested) this.jobs.get(run.id)?.cancel.abort();
        if (action === 'resume') this.dispatch();
        return changed;
    }

    private sync(state: State, reason?: string) {
        const run = this.runs.get(state.id);
        if (!run || state.state === 'RUNNING' || state.state === 'FINISHED') return;
        if (state.state === 'FAILED' || state.state === 'CANCELLED') {
            this.queue.clearInput(state.id);
            const status = state.state === 'FAILED' && run.steps.length > 1 ? 'PARTIAL' : state.state;
            this.runs.fail(run, state.state === 'CANCELLED' ? 'CANCELLED' : reason ?? 'SAST_TRIAGE_DEADLINE', status);
        } else {
            run.status = state.state;
            run.statusReason = reason ?? null;
            this.runs.save(run);
        }
    }

    private dispatch() {
        if (this.closing) return;
        try {
            this.transaction(() => {
                for (const state of this.queue.reconcile(sastTriagePlaybook)) this.sync(state);
            });
            const excluded = [...this.jobs.keys()];
            const waiting = this.db.prepare(`SELECT id FROM durable_job WHERE kind = ? AND state IN ('QUEUED','RUNNING') AND (
                (json_extract(input, '$.model.config.enabled') = 1
                    AND json_extract(input, '$.model.config.id') IN (SELECT value FROM json_each(?)))
                OR EXISTS (SELECT 1 FROM model_invocation m WHERE m.run_id = durable_job.id AND m.status = 'SENDING' AND m.deadline_at > ?)
            )`).all(sastTriagePlaybook, JSON.stringify(this.repo.generation.closedBackgroundPools()), Date.now());
            excluded.push(...waiting.map(row => String(row.id)));
            while (this.jobs.size < MAX_JOBS) {
                const lease = this.queue.claim(sastTriagePlaybook, MAX_JOBS, LEASE_MS, excluded);
                if (!lease) break;
                this.launch(lease);
                excluded.push(lease.id);
            }
            this.dispatcher.observe(true);
        } catch { if (this.dispatcher.observe(false)) console.error('Failed to dispatch SAST triage jobs'); }
    }

    private authorize(lease: Lease) {
        this.repo.identity.requireProjectEditor({ id: lease.actorId, credentialVersion: lease.input.credentialVersion }, lease.projectId);
    }

    private launch(lease: Lease) {
        const cancel = new AbortController();
        const heartbeat = setInterval(() => {
            try {
                const owner = this.queue.renew(lease, LEASE_MS);
                if (!owner || owner.stopRequested) cancel.abort();
                else this.authorize(lease);
            } catch (error) { cancel.abort(error); }
        }, LEASE_MS / 4).unref();
        const job = nextTurn().then(() => this.execute(lease, cancel.signal)).catch(() => {
            console.error('Failed to persist SAST triage run state');
        }).finally(() => {
            clearInterval(heartbeat);
            this.jobs.delete(lease.id);
            this.dispatch();
        });
        this.jobs.set(lease.id, { projectId: lease.projectId, cancel, job });
    }

    async cancel(run: AgentRun, actor: Account) {
        if (['QUEUED', 'RUNNING', 'PAUSED'].includes(run.status)) {
            this.control(run, actor, 'cancel');
            await this.jobs.get(run.id)?.job;
        }
        return this.runs.get(run.id) ?? run;
    }

    activeProject(projectId: string) {
        return Array.from(this.jobs.values()).some(item => item.projectId === projectId);
    }

    async close() {
        this.closing = true;
        clearInterval(this.timer);
        const active = [...this.jobs.values()];
        for (const handle of active) handle.cancel.abort();
        await Promise.all(active.map(handle => handle.job));
    }

    private initialize(run: AgentRun, input: Frozen) {
        const first = agentStep(run, input.capability);
        first.missingInfo = input.missingInfo;
        first.evidenceReferences = input.references;
        if (input.capability === 'LOAD_VULNERABILITY') first.evidenceReferences = [run.inputReference, ...first.evidenceReferences];
        if (!input.reports.length) return;
        finishAgentStep(first, input.missingInfo.length ? 'PARTIAL' : 'COMPLETED', `Loaded ${input.reports.length} finding(s).`);

        const collect = agentStep(run, 'BUILD_CONTEXT');
        collect.evidenceReferences = input.contextReferences;
        collect.missingInfo = input.contextOmissions;
        finishAgentStep(collect, 'COMPLETED', `Prepared context for ${input.reports.length} finding(s).`);

        const triage = agentStep(run, 'TRIAGE_FINDINGS');
        triage.evidenceReferences = input.references;
        triage.missingInfo = [...new Set(input.reports.flatMap(report => report.missingInfo))].slice(0, 30).map(item => findingPublicText(item, 300));
        finishAgentStep(triage, 'COMPLETED', `Built ${input.reports.length} baseline report(s).`);
        agentStep(run, 'LLM_ADVISORY');
    }

    private async execute(lease: Lease, cancelled: AbortSignal) {
        const run = this.runs.get(lease.id);
        if (!run) return;
        const authorize = () => {
            cancelled.throwIfAborted();
            this.queue.assertRunnable(lease);
            this.authorize(lease);
        };
        const checkpoint = <T>(write: () => T) => this.transaction(() => {
            authorize();
            return write();
        });
        try {
            if (lease.input.version !== 1) throw new HttpError(409, 'SAST_TRIAGE_JOB_VERSION_CHANGED');
            const { frozen, model, username } = lease.input;
            const progress = this.db.prepare('SELECT position, failed, disabled FROM sast_triage_progress WHERE run_id = ?').get(run.id) as Progress;
            const save = () => checkpoint(() => {
                this.db.prepare('UPDATE sast_triage_progress SET position = ?, failed = ?, disabled = ? WHERE run_id = ?')
                    .run(progress.position, progress.failed, progress.disabled, run.id);
                this.runs.save(run);
            });
            checkpoint(() => {
                this.queue.begin(lease);
                run.status = 'RUNNING';
                run.statusReason = null;
                if (!run.steps.length) this.initialize(run, frozen);
                this.runs.save(run);
            });
            if (!frozen.reports.length) throw new HttpError(400, 'NO_REVIEWABLE_FINDINGS');
            const advisory = run.steps.find(step => step.capability === 'LLM_ADVISORY')!;
            const sessionFor = () => {
                if (!model) throw new GenerationError('ADVISORY_UNAVAILABLE');
                return this.repo.generation.resume(model);
            };
            const signal = AbortSignal.any([cancelled, AbortSignal.timeout(Math.max(0, lease.deadline - Date.now()))]);
            if (!advisory.finishedAt) await this.advise(run, advisory, frozen.reports, sessionFor, authorize, signal, lease.actorId, progress, save);
            authorize();
            const submit = agentStep(run, 'SUBMIT_REVIEW');
            this.repo.reviewQueue.submit(run.projectId, username, frozen.reports, ({ snapshotId, entries }) => {
                authorize();
                run.outputReference = 'report-snapshot:' + snapshotId;
                submit.evidenceReferences = [run.outputReference];
                finishAgentStep(submit, 'COMPLETED', `Queued ${entries.length} report(s) for human review.`);
                const partial = run.steps[0].status === 'PARTIAL' || advisory.status === 'FAILED' || advisory.status === 'PARTIAL';
                run.status = partial ? 'PARTIAL' : 'WAITING_FOR_REVIEW';
                run.statusReason = partial ? 'SAST_TRIAGE_PARTIAL' : null;
                run.completedAt = submit.finishedAt;
                this.runs.save(run);
                this.queue.finish(lease, 'FINISHED', digest(JSON.stringify(run)));
                this.queue.clearInput(run.id);
            });
        } catch (error) {
            try {
                this.transaction(() => {
                    const windowClosed = error instanceof GenerationError && error.message === 'PROVIDER_POOL_WINDOW_CLOSED';
                    const state = this.queue.finish(lease, this.closing || windowClosed ? 'QUEUED' : 'FAILED');
                    this.sync(state, windowClosed ? 'PROVIDER_POOL_WINDOW_CLOSED' : Date.now() >= lease.deadline
                        ? 'SAST_TRIAGE_DEADLINE' : error instanceof HttpError ? error.message : 'SAST_TRIAGE_FAILED');
                });
            } catch (stale) {
                if (!(stale instanceof HttpError) || stale.message !== 'JOB_LEASE_LOST') throw stale;
            }
        }
    }

    private async advise(run: AgentRun, step: AgentStep, reports: FindingReport[], sessionFor: SessionFor, authorize: () => void, signal: AbortSignal,
        actorId: string, progress: Progress, save: () => void) {
        const notes = new Set(step.missingInfo);
        for (let position = progress.position; position < reports.length; position++) {
            signal.throwIfAborted();
            authorize();
            const report = reports[position];
            const phase = 'TRIAGE_FINDING_' + (position + 1);
            // A send without an accepted checkpoint is uncertain after restart.
            const previousSend = this.db.prepare('SELECT 1 FROM model_invocation WHERE run_id = ? AND phase = ? LIMIT 1').get(run.id, phase);
            if (previousSend) {
                notes.add('ADVISORY_RESPONSE_UNCONFIRMED');
                progress.failed++;
            } else {
                const result = await reviewFinding(sessionFor, report, signal, MAX_COST_USD / reports.length,
                    { projectId: run.projectId, runId: run.id, actorId, phase }, () => { authorize(); return !signal.aborted; });
                signal.throwIfAborted();
                if (result.missingInfo.includes('PROVIDER_POOL_WINDOW_CLOSED')) throw new GenerationError('PROVIDER_POOL_WINDOW_CLOSED');
                if (result.status === 'DISABLED') {
                    progress.disabled = 1;
                    notes.add('GENERATION_DISABLED');
                }
                for (const reason of result.missingInfo) {
                    if (/^(?:ADVISORY|INVALID_ADVISORY|GENERATION|INVALID_PROVIDER|PROVIDER)_[A-Z0-9_]{1,60}$/.test(reason)) notes.add(reason);
                }
                if (result.status === 'COMPLETED') {
                    const subjectReference = findingRef(report.finding.fingerprint);
                    step.evidenceReferences.push(...result.citations.map(id => subjectReference + '#' + id));
                    step.results.push({ subjectReference, baseline: report.verdict, recommendation: result.suggestedVerdict ?? '',
                        uncertainty: result.uncertainty, citationIds: result.citations, advisoryOnly: true, usage: result.usage });
                } else if (!progress.disabled) progress.failed++;
            }
            progress.position = progress.disabled ? reports.length : position + 1;
            step.missingInfo = [...notes];
            save();
            if (progress.disabled) break;
        }
        const status = progress.disabled ? 'SKIPPED' : progress.failed ? step.results.length ? 'PARTIAL' : 'FAILED' : 'COMPLETED';
        finishAgentStep(step, status, progress.disabled ? 'The generation model is disabled.'
            : `Reviewed ${step.results.length} of ${reports.length} finding(s) with the model.`);
        save();
    }
}
