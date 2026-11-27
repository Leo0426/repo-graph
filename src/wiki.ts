import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { agentStep } from './agent-runs.js';
import type { AgentRun, AgentRuns, AgentStep } from './agent-runs.js';
import type { CodeMetrics } from './code-metrics.js';
import type { CodeGraph } from './graph.js';
import type { DurableJobs, JobAction } from './durable-jobs.js';
import { GenerationError } from './generation.js';
import type { GenerationGateway } from './generation.js';
import { HttpError } from './http-error.js';
import type { Account, IdentityDirectory } from './identity.js';
import type { KnowledgeSnapshots, PublicationProfile, SnapshotMode } from './knowledge-snapshots.js';
import type { FrozenModelProvider } from './model-providers.js';
import { DispatcherHealth } from './operability.js';
import { digest } from './source.js';
import { wikiFacts } from './wiki-facts.js';
import type { SummaryDraft, WikiPerspective } from './wiki-facts.js';
import { wikiModel, wikiTemplate, wikiTemplateVersion } from './wiki-model.js';
import type { WikiChapter } from './wiki-model.js';
import { WikiPages } from './wiki-pages.js';

const PLAYBOOK = 'WIKI_SUMMARY';
const MAX_JOBS = 4;
const MAX_PENDING = 128;
const LEASE_MS = 5_000;
const MAX_JOB_MS = 180_000;
const MAX_PHASE_VERSIONS = 16;
const MODEL_UNAVAILABLE = 'WIKI_MODEL_UNAVAILABLE';
const MODEL_WINDOW_CLOSED = 'PROVIDER_POOL_WINDOW_CLOSED';

export interface WikiJobInput {
    version: 1;
    snapshotId: string | null;
    body: SummaryDraft[];
    omissions: string[];
    model: FrozenModelProvider;
    credentialVersion: number;
    mode?: SnapshotMode;
    publication?: PublicationProfile;
}

type WikiLease = NonNullable<ReturnType<DurableJobs<WikiJobInput>['claim']>>;
type WikiTrack = NonNullable<ReturnType<typeof wikiTemplate>>['tracks'][number];
type ModelCoverage = { model: string | null; omissions: string[]; incomplete: boolean };

export interface SummaryDocument extends SummaryDraft {
    id: string;
    projectId: string;
    docVersion: number;
    generatedAt: string;
    status: 'COMPLETED' | 'PARTIAL';
    model: string | null;
    missingInfo: string[];
    factsHash: string | null;
    knowledgeSnapshotId?: string;
    legacyImported?: true;
    markdown?: string;
    revision?: { id: string; number: number; origin: 'GENERATED' | 'EDIT' | 'RESTORE' | 'DRAFT'; authorId: string | null; createdAt: string; baseRevisionId: string | null };
}

function documentTable(name: 'wiki_document' | 'wiki_document_next') {
    return `CREATE TABLE IF NOT EXISTS ${name} (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES wiki_generation(run_id) ON DELETE CASCADE, level TEXT NOT NULL,
        scope_id TEXT NOT NULL, doc_version INTEGER NOT NULL, payload TEXT NOT NULL
    );`;
}

function documentWriter(db: DatabaseSync) {
    const insert = db.prepare('INSERT INTO wiki_document VALUES (?, ?, ?, ?, ?, ?, ?)');
    return (document: SummaryDocument, runId: string | null) => insert.run(document.id, document.projectId,
        runId, document.level, document.scopeId, document.docVersion, JSON.stringify(document));
}

export function restoreWikiDocuments(db: DatabaseSync, documents: SummaryDocument[]) {
    const save = documentWriter(db);
    for (const document of documents) save(document, null);
}

function finish(step: AgentStep, status: Exclude<AgentStep['status'], 'RUNNING'>, summary: string) {
    step.status = status;
    step.summary = summary;
    step.finishedAt = new Date().toISOString();
}

function wikiStep(run: AgentRun, capability: string) {
    const step = run.steps.find(item => item.capability === capability);
    if (!step) return agentStep(run, capability);
    if (step.status !== 'COMPLETED') {
        step.status = 'RUNNING';
        step.finishedAt = null;
    }
    return step;
}

export class WikiSummaries {
    readonly pages: WikiPages;
    private timer: NodeJS.Timeout | undefined;
    private readonly dispatcher = new DispatcherHealth();
    private closing = false;
    private readonly jobs = new Map<string, { projectId: string; cancel: AbortController; job: Promise<void> }>();

    constructor(private readonly db: DatabaseSync, private readonly runs: AgentRuns,
        private readonly graph: CodeGraph, private readonly metrics: CodeMetrics, private readonly generation: GenerationGateway,
        private readonly snapshots: KnowledgeSnapshots, private readonly queue: DurableJobs<WikiJobInput>,
        private readonly identity: IdentityDirectory) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS wiki_generation (
                run_id TEXT PRIMARY KEY REFERENCES agent_run(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS wiki_generation_project ON wiki_generation(project_id);
            ${documentTable('wiki_document')}
            CREATE TABLE IF NOT EXISTS wiki_job_phase (
                run_id TEXT NOT NULL REFERENCES durable_job(id) ON DELETE CASCADE,
                phase TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id, phase)
            );
            CREATE TABLE IF NOT EXISTS wiki_phase (
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE, phase TEXT NOT NULL,
                fingerprint TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project_id, phase, fingerprint)
            );
        `);
        const required = db.prepare("SELECT [notnull] AS required FROM pragma_table_info('wiki_document') WHERE name = 'run_id'").get()?.required;
        if (required === 1) this.transaction(() => db.exec(`
            ${documentTable('wiki_document_next')}
            INSERT INTO wiki_document_next SELECT id, project_id, run_id, level, scope_id, doc_version, payload FROM wiki_document;
            DROP TABLE wiki_document;
            ALTER TABLE wiki_document_next RENAME TO wiki_document;
        `));
        db.exec(`
            CREATE INDEX IF NOT EXISTS wiki_document_run ON wiki_document(run_id);
            CREATE INDEX IF NOT EXISTS wiki_document_version ON wiki_document(project_id, level, scope_id, doc_version DESC);
            DROP INDEX IF EXISTS wiki_document_generated_version;
            CREATE UNIQUE INDEX IF NOT EXISTS wiki_document_perspective_version ON wiki_document(project_id, level, scope_id,
                coalesce(json_extract(payload, '$.perspective'), 'technical'), doc_version)
                WHERE run_id IS NOT NULL;
        `);
        this.pages = new WikiPages(db, this.identity, this.snapshots, this.generation);
    }

    private checkIndex(projectId: string) {
        if (!this.db.prepare('SELECT 1 FROM project WHERE id = ?').get(projectId)) {
            throw new HttpError(404, 'PROJECT_NOT_FOUND');
        }
        const status = this.db.prepare('SELECT status FROM index_status WHERE project_id = ?').get(projectId)?.status;
        if (status === 'running') throw new HttpError(409, 'WIKI_INDEX_RUNNING');
    }

    submit(projectId: string, projectName: string, actor: Account, key?: string, availableAt?: number, mode: SnapshotMode = 'incremental',
        authorizeSource?: () => void) {
        const fingerprint = digest(JSON.stringify([projectId, availableAt ?? null, mode]));
        const id = this.transaction(() => {
            this.identity.requireProjectEditor(actor, projectId);
            authorizeSource?.();
            if (key !== undefined) {
                const previous = this.queue.findRequest(PLAYBOOK, projectId, actor.id, key, fingerprint);
                if (previous) return previous;
            }
            this.checkIndex(projectId);
            if (this.queue.hasActive(PLAYBOOK, projectId) || this.runs.active(projectId, PLAYBOOK)) {
                throw new HttpError(409, 'WIKI_ALREADY_RUNNING');
            }
            if (this.queue.pending(PLAYBOOK) >= MAX_PENDING) throw new HttpError(503, 'WIKI_QUEUE_FULL');
            const run = this.runs.create(projectId, PLAYBOOK, 'facts:graph:' + projectId);
            const snapshot = this.snapshots.freeze(projectId, run.id, mode);
            const snapshotId = snapshot?.id ?? null;
            const { body, omissions } = wikiFacts(this.db, this.graph, this.metrics, projectId, projectName);
            if (snapshotId) {
                run.inputReference = 'knowledge-snapshot:' + snapshotId;
                this.runs.save(run);
            }
            const model = this.generation.freeze();
            if (model.config.enabled && this.generation.closedBackgroundPools().includes(model.config.id)) {
                run.statusReason = MODEL_WINDOW_CLOSED;
                this.runs.save(run);
            }
            const template = wikiTemplate(wikiTemplateVersion)!;
            const publication: PublicationProfile = { version: 1, wikiTemplateVersion, inputFactsVersion: 1, budgetMs: MAX_JOB_MS,
                model: model.config.enabled ? { id: model.config.id, revision: model.config.updatedAt, name: model.config.model } : null,
                ...(model.config.enabled ? { modelPlan: { maxOutputTokensPerCall: Math.min(model.config.maxOutputTokens, template.maxOutputTokens),
                    estimatedCostLimitUsd: template.estimatedCostUsd, publicationReserveMs: template.publicationReserveMs,
                    tracks: template.tracks.map(track => ({ perspective: track.perspective, phases: track.phases.map(phase => phase.id) })) } } : {}) };
            this.queue.enqueue({ id: run.id, projectId, kind: PLAYBOOK, actorId: actor.id, key, fingerprint,
                input: { version: 1, snapshotId, body, omissions, model, credentialVersion: actor.credentialVersion,
                    mode: snapshot?.mode ?? mode, publication },
                availableAt: availableAt ?? Date.now(), budgetMs: MAX_JOB_MS });
            return run.id;
        });
        this.dispatch();
        return { agentRunId: id, projectId, pollVia: '/api/v1/agent-runs/' + id };
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => this.dispatch(), 250).unref();
        this.dispatch();
    }

    workerHealth() { return this.dispatcher.status(!!this.timer && !this.closing); }

    execution(id: string) { return this.queue.get(id); }
    attempts(id: string) { return this.queue.history(id); }

    control(run: AgentRun, actor: Account, action: JobAction, expectedRevision?: number, priority?: number) {
        const changed = this.transaction(() => {
            const job = this.queue.get(run.id);
            if (!job) throw new HttpError(404, 'JOB_NOT_FOUND');
            this.identity.requireProjectEditor(actor, job.projectId);
            if (actor.id !== job.actorId || priority !== undefined || action === 'prioritize') {
                this.identity.requireProjectManager(actor, job.projectId);
            }
            const current = this.queue.change(job.id, expectedRevision ?? job.revision, action, priority);
            this.syncQueueState(current);
            return current;
        });
        if (changed.stopRequested) this.jobs.get(changed.id)?.cancel.abort();
        if (action === 'resume') this.dispatch();
        return changed;
    }

    private dispatch() {
        if (this.closing) return;
        try {
            this.transaction(() => {
                for (const state of this.queue.reconcile(PLAYBOOK)) this.syncQueueState(state);
            });
            const excluded = [...this.jobs.keys()];
            const closedPools = this.generation.closedBackgroundPools();
            if (closedPools.length) {
                const waiting = this.db.prepare(`SELECT id FROM durable_job WHERE kind = ? AND state = 'QUEUED'
                    AND json_extract(input, '$.model.config.enabled') = 1
                    AND json_extract(input, '$.model.config.id') IN (SELECT value FROM json_each(?))`)
                    .all(PLAYBOOK, JSON.stringify(closedPools));
                excluded.push(...waiting.map(row => String(row.id)));
            }
            while (this.jobs.size < MAX_JOBS) {
                const lease = this.queue.claim(PLAYBOOK, MAX_JOBS, LEASE_MS, excluded);
                if (!lease) break;
                this.launch(lease);
                excluded.push(lease.id);
            }
            this.dispatcher.observe(true);
        } catch {
            if (this.dispatcher.observe(false)) console.error('Failed to dispatch Wiki jobs');
        }
    }

    private launch(lease: WikiLease) {
        const cancel = new AbortController();
        const heartbeat = setInterval(() => {
            try {
                const owner = this.queue.renew(lease, LEASE_MS);
                if (!owner || owner.stopRequested) cancel.abort();
            } catch { cancel.abort(); }
        }, LEASE_MS / 4).unref();
        const job = nextTurn().then(() => this.generate(lease, cancel.signal)).catch(() => {
            console.error('Failed to persist a Wiki run state');
        }).finally(() => {
            clearInterval(heartbeat);
            this.jobs.delete(lease.id);
            this.dispatch();
        });
        this.jobs.set(lease.id, { projectId: lease.projectId, cancel, job });
    }

    private syncQueueState(state: NonNullable<ReturnType<DurableJobs<WikiJobInput>['get']>>, reason?: string) {
        if (state.state === 'RUNNING' || state.state === 'FINISHED') return;
        const run = this.runs.get(state.id);
        if (!run) return;
        if (state.state === 'FAILED' || state.state === 'CANCELLED') {
            this.queue.clearInput(state.id);
            this.snapshots.discardRun(state.id);
            this.db.prepare('DELETE FROM wiki_job_phase WHERE run_id = ?').run(state.id);
            this.runs.fail(run, state.state === 'CANCELLED' ? 'CANCELLED' : reason ?? 'WIKI_JOB_BUDGET_EXHAUSTED', state.state);
        } else {
            run.status = state.state;
            run.statusReason = state.state === 'QUEUED' && reason === MODEL_WINDOW_CLOSED ? reason : null;
            for (const step of run.steps) if (step.status === 'RUNNING') step.status = 'PENDING';
            this.runs.save(run);
        }
    }

    activeProject(projectId: string) {
        return Array.from(this.jobs.values()).some(entry => entry.projectId === projectId);
    }

    async close() {
        this.closing = true;
        clearInterval(this.timer);
        const active = [...this.jobs.values()];
        for (const entry of active) entry.cancel.abort();
        await Promise.all(active.map(entry => entry.job));
    }

    private transaction<T>(operation: () => T) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = operation();
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    private authorize(lease: WikiLease) {
        this.identity.requireProjectEditor({ id: lease.actorId, credentialVersion: lease.input.credentialVersion }, lease.projectId);
    }

    private checkpoint<T>(lease: WikiLease, operation: () => T) {
        return this.transaction(() => {
            this.queue.assertRunnable(lease);
            this.authorize(lease);
            return operation();
        });
    }

    private async generate(lease: WikiLease, cancelled: AbortSignal) {
        const run = this.runs.get(lease.id);
        if (!run) return;
        try {
            const input = lease.input;
            if (input.version !== 1) throw new HttpError(409, 'WIKI_INPUT_VERSION_UNSUPPORTED');
            const version = input.publication?.wikiTemplateVersion ?? 1;
            const template = wikiTemplate(version);
            if (!template) throw new HttpError(409, 'WIKI_TEMPLATE_VERSION_UNSUPPORTED');
            const { body, omissions, snapshotId } = input;
            const factsHash = digest(JSON.stringify({ body, omissions }));
            this.checkpoint(lease, () => {
                this.queue.begin(lease);
                run.status = 'RUNNING';
                run.statusReason = null;
                const facts = wikiStep(run, 'FACTS');
                finish(facts, 'COMPLETED', 'Collected indexed structure and citation locations.');
                facts.evidenceReferences = ['facts:sha256:' + factsHash];
                facts.missingInfo = omissions;
                this.runs.save(run);
            });
            const session = this.generation.resume(input.model);
            const phaseCount = template.tracks.reduce((count, track) => count + track.phases.length, 0);
            const coverage = new Map<WikiPerspective, ModelCoverage>();
            const modelTime = lease.deadline - Date.now() - template.publicationReserveMs;
            const deadline = AbortSignal.any([cancelled, modelTime > 0 ? AbortSignal.timeout(modelTime) : AbortSignal.abort()]);
            for (const track of template.tracks) {
                const drafts = body.filter(document => (document.perspective ?? 'technical') === track.perspective);
                const modelWork = wikiModel(session, drafts, { capability: 'WIKI', actorId: lease.actorId, projectId: run.projectId, runId: run.id }, {
                    version, perspective: track.perspective, factsHash, maxOutputTokens: template.maxOutputTokens,
                    estimatedCostUsd: template.estimatedCostUsd / phaseCount,
                    evidence: paths => snapshotId ? this.snapshots.evidenceFiles(snapshotId, paths) : lease.id,
                    beforeRetry: () => version >= 2 && this.checkpoint(lease, () => !deadline.aborted)
                });
                const status = await this.generateTrack(lease, run, track, modelWork, drafts, session.configuration, deadline, cancelled);
                coverage.set(track.perspective, status);
            }
            const incomplete = Array.from(coverage.values()).some(item => item.incomplete);
            cancelled.throwIfAborted();
            this.checkpoint(lease, () => {
                const persist = wikiStep(run, 'PERSIST');
                const resultHash = this.persist(run, body, omissions, factsHash, coverage, snapshotId, input.publication);
                finish(persist, 'COMPLETED', `Saved ${body.length} versioned summaries.`);
                persist.evidenceReferences.push('summaries:project:' + run.projectId);
                run.status = incomplete || omissions.length ? 'PARTIAL' : 'COMPLETED';
                run.statusReason = omissions[0] ?? (incomplete ? 'WIKI_MODEL_SECTIONS_INCOMPLETE' : null);
                run.completedAt = new Date().toISOString();
                run.outputReference = 'summaries:project:' + run.projectId;
                this.queue.finish(lease, 'FINISHED', resultHash);
                this.queue.clearInput(run.id);
                this.db.prepare('DELETE FROM wiki_job_phase WHERE run_id = ?').run(run.id);
                this.runs.save(run);
            });
        } catch (error) {
            try {
                this.transaction(() => {
                    const reason = error instanceof HttpError || error instanceof GenerationError ? error.message : undefined;
                    const terminal = this.queue.finish(lease, this.closing || reason === MODEL_WINDOW_CLOSED ? 'QUEUED' : 'FAILED');
                    this.syncQueueState(terminal, reason);
                });
            } catch (settleError) {
                if (!(settleError instanceof HttpError) || settleError.message !== 'JOB_LEASE_LOST') throw settleError;
            }
        }
    }

    private async generateTrack(lease: WikiLease, run: AgentRun, track: WikiTrack, model: ReturnType<typeof wikiModel>, drafts: SummaryDraft[],
        configuration: { enabled: boolean; model: string }, signal: AbortSignal, cancelled: AbortSignal): Promise<ModelCoverage> {
        const step = wikiStep(run, track.capability);
        if (!configuration.enabled) {
            finish(step, 'SKIPPED', 'Generation model unavailable.');
            step.missingInfo = [MODEL_UNAVAILABLE];
            return { model: null, omissions: step.missingInfo, incomplete: false };
        }
        const project = drafts.find(draft => draft.level === 'PROJECT');
        if (!project) throw new HttpError(409, 'WIKI_SNAPSHOT_PERSPECTIVE_INCOMPLETE');
        this.checkpoint(lease, () => this.runs.save(run));
        const { chapters, notes } = await this.enhance(lease, run, track, model, signal, cancelled);
        const incomplete = chapters.length < track.phases.length;
        finish(step, incomplete ? 'PARTIAL' : 'COMPLETED', `${chapters.length}/${track.phases.length} model sections available.`);
        step.missingInfo = notes;
        project.sections.push(...chapters.map(chapter => chapter.section));
        const references = new Map(project.citations.map(reference => [JSON.stringify(reference), reference]));
        for (const chapter of chapters) for (const reference of chapter.citations) references.set(JSON.stringify(reference), reference);
        project.citations = [...references.values()];
        return { model: chapters.length ? configuration.model : null, omissions: notes, incomplete };
    }

    private async enhance(lease: WikiLease, run: AgentRun, track: WikiTrack, model: ReturnType<typeof wikiModel>, signal: AbortSignal, cancelled: AbortSignal) {
        const chapters: WikiChapter[] = [];
        const notes: string[] = [];
        const acceptedPhase = this.db.prepare('SELECT payload FROM wiki_job_phase WHERE run_id = ? AND phase = ?');
        const saveAccepted = this.db.prepare('INSERT INTO wiki_job_phase VALUES (?, ?, ?)');
        const cachedPhase = this.db.prepare('SELECT payload FROM wiki_phase WHERE project_id = ? AND phase = ? AND fingerprint = ?');
        const savePhase = this.db.prepare('INSERT INTO wiki_phase VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING');
        const prune = this.db.prepare(`DELETE FROM wiki_phase WHERE rowid IN (SELECT rowid FROM wiki_phase
            WHERE project_id = ? AND phase = ? ORDER BY rowid DESC LIMIT -1 OFFSET ?)`);
        for (const phase of track.phases) {
            cancelled.throwIfAborted();
            const step = wikiStep(run, track.capability + ':' + phase.id);
            const runtime = model(phase);
            const { fingerprint } = runtime;
            step.evidenceReferences = ['wiki-phase:' + phase.id + ':' + fingerprint];
            this.checkpoint(lease, () => this.runs.save(run));
            const accepted = acceptedPhase.get(run.id, phase.id);
            const cached = accepted ?? (lease.input.mode !== 'full' ? cachedPhase.get(run.projectId, phase.id, fingerprint) : undefined);
            let chapter: WikiChapter | undefined;
            try {
                if (cached) chapter = JSON.parse(String(cached.payload)) as WikiChapter;
                else if (signal.aborted) throw new GenerationError('WIKI_MODEL_DEADLINE');
                else chapter = await runtime.chapter(signal);
                if (!accepted) {
                    finish(step, 'COMPLETED', cached ? 'Reused the saved model section.' : 'Generated the model section.');
                    step.error = null;
                    step.missingInfo = chapter.unknownCitations ? ['WIKI_UNKNOWN_CITATIONS'] : [];
                }
                chapters.push(chapter);
            } catch (error) {
                if (!(error instanceof GenerationError)) throw error;
                if (error.message === 'PROVIDER_ACCESS_CHANGED' || error.message === MODEL_WINDOW_CLOSED) throw error;
                step.error = error.message;
                step.missingInfo = [error.message];
                finish(step, signal.aborted ? 'SKIPPED' : 'FAILED', 'Section unavailable.');
            }
            for (const omission of step.missingInfo) notes.push(`${omission}:${phase.id}`);
            cancelled.throwIfAborted();
            this.checkpoint(lease, () => {
                if (chapter && !accepted) {
                    const payload = JSON.stringify(chapter);
                    saveAccepted.run(run.id, phase.id, payload);
                    if (!cached) {
                        savePhase.run(run.projectId, phase.id, fingerprint, payload);
                        prune.run(run.projectId, phase.id, MAX_PHASE_VERSIONS);
                    }
                }
                this.runs.save(run);
            });
        }
        return { chapters, notes };
    }

    private persist(run: AgentRun, drafts: SummaryDraft[], omissions: string[], factsHash: string,
        coverage: Map<WikiPerspective, ModelCoverage>, snapshotId: string | null, profile?: PublicationProfile) {
        const { projectId } = run;
        const now = new Date().toISOString();
        this.db.prepare('INSERT INTO wiki_generation VALUES (?, ?)').run(run.id, projectId);
        const version = this.db.prepare(`SELECT max(doc_version) AS current FROM wiki_document
            WHERE project_id = ? AND level = ? AND scope_id = ? AND coalesce(json_extract(payload, '$.perspective'), 'technical') = ?`);
        const save = documentWriter(this.db);
        const pages = drafts.map(draft => {
            const perspective = draft.perspective ?? 'technical';
            const docVersion = Number(version.get(projectId, draft.level, draft.scopeId, perspective)?.current ?? 0) + 1;
            const model = draft.level === 'PROJECT' ? coverage.get(perspective) : undefined;
            const missingInfo = model ? [...omissions, ...model.omissions] : omissions;
            const document: SummaryDocument = { ...draft, perspective, id: randomUUID(), projectId, generatedAt: now, docVersion,
                status: omissions.length || model?.incomplete ? 'PARTIAL' : 'COMPLETED',
                model: model?.model ?? null, missingInfo, factsHash, ...(snapshotId ? { knowledgeSnapshotId: snapshotId } : {}) };
            save(document, run.id);
            this.pages.index(document);
            return document;
        });
        if (snapshotId) this.snapshots.publish(snapshotId, now, pages, profile);
        return digest(JSON.stringify(pages));
    }

    getBase(id: string): SummaryDocument | undefined {
        const row = this.db.prepare('SELECT payload FROM wiki_document WHERE id = ?').get(id);
        return row ? JSON.parse(String(row.payload)) as SummaryDocument : undefined;
    }

    get(id: string, revisionId?: string) {
        const page = this.getBase(id);
        return page && this.pages.resolve(page, revisionId);
    }

    latest(projectId: string, runId?: string, perspective: WikiPerspective = 'technical'): SummaryDocument[] {
        const generation = runId ?? this.db.prepare(`SELECT g.run_id FROM wiki_generation g WHERE g.project_id = ?
            AND NOT EXISTS (SELECT 1 FROM knowledge_snapshot ks JOIN knowledge_retirement r ON r.snapshot_id = ks.id
                WHERE ks.run_id = g.run_id AND r.retired_at IS NOT NULL) ORDER BY g.rowid DESC LIMIT 1`)
            .get(projectId)?.run_id;
        const rows = generation
            ? this.db.prepare(`SELECT payload FROM wiki_document WHERE run_id = ? AND project_id = ?
                AND coalesce(json_extract(payload, '$.perspective'), 'technical') = ? ORDER BY level = 'PROJECT' DESC, scope_id`)
                .all(generation, projectId, perspective)
            : this.db.prepare(`SELECT payload FROM (
                SELECT payload, level, scope_id, row_number() OVER (
                    PARTITION BY level, scope_id ORDER BY doc_version DESC, julianday(json_extract(payload, '$.generatedAt')) DESC, rowid DESC
                ) AS position FROM wiki_document WHERE project_id = ? AND run_id IS NULL
                    AND coalesce(json_extract(payload, '$.perspective'), 'technical') = ?
            ) WHERE position = 1 ORDER BY level = 'PROJECT' DESC, scope_id`).all(projectId, perspective);
        return rows.map(row => this.pages.resolve(JSON.parse(String(row.payload)) as SummaryDocument));
    }

    tree(projectId: string, runId?: string, perspective?: WikiPerspective) {
        return this.latest(projectId, runId, perspective).map(document => {
            const level = document.level === 'PROJECT' ? 'project' : 'package';
            const path = level === 'project' ? level : level + '/' + document.scopeId;
            return { id: document.id, name: document.legacyImported && level === 'package' ? document.scopeId : document.title,
                path, level, docVersion: document.docVersion,
                keywords: document.citations.slice(0, 5).map(item => item.qualifiedName) };
        });
    }
}
