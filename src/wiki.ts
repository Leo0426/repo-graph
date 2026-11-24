import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { agentStep } from './agent-runs.js';
import type { AgentRun, AgentRuns, AgentStep } from './agent-runs.js';
import type { CodeMetrics } from './code-metrics.js';
import type { CodeGraph } from './graph.js';
import { GenerationError } from './generation.js';
import type { GenerationGateway } from './generation.js';
import { HttpError } from './http-error.js';
import { digest } from './source.js';
import { wikiFacts } from './wiki-facts.js';
import type { SummaryDraft } from './wiki-facts.js';
import { wikiModel, wikiPhases } from './wiki-model.js';
import type { WikiChapter } from './wiki-model.js';

const PLAYBOOK = 'WIKI_SUMMARY';
const MAX_JOBS = 4;
const MAX_JOB_MS = 180_000;
const MAX_PHASE_VERSIONS = 16;
const MODEL_UNAVAILABLE = 'WIKI_MODEL_UNAVAILABLE';

export interface SummaryDocument extends SummaryDraft {
    id: string;
    projectId: string;
    docVersion: number;
    generatedAt: string;
    status: 'COMPLETED' | 'PARTIAL';
    model: string | null;
    missingInfo: string[];
    factsHash: string | null;
    legacyImported?: true;
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

export class WikiSummaries {
    private readonly jobs = new Map<string, { projectId: string; cancel: AbortController; job: Promise<void> }>();

    constructor(private readonly db: DatabaseSync, private readonly runs: AgentRuns,
        private readonly graph: CodeGraph, private readonly metrics: CodeMetrics, private readonly generation: GenerationGateway) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS wiki_generation (
                run_id TEXT PRIMARY KEY REFERENCES agent_run(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS wiki_generation_project ON wiki_generation(project_id);
            ${documentTable('wiki_document')}
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
            CREATE UNIQUE INDEX IF NOT EXISTS wiki_document_generated_version ON wiki_document(project_id, level, scope_id, doc_version)
                WHERE run_id IS NOT NULL;
        `);
    }

    private checkIndex(projectId: string) {
        if (!this.db.prepare('SELECT 1 FROM project WHERE id = ?').get(projectId)) {
            throw new HttpError(404, 'PROJECT_NOT_FOUND');
        }
        const status = this.db.prepare('SELECT status FROM index_status WHERE project_id = ?').get(projectId)?.status;
        if (status === 'running') throw new HttpError(409, 'WIKI_INDEX_RUNNING');
    }

    submit(projectId: string, projectName: string) {
        this.checkIndex(projectId);
        if (this.runs.active(projectId, PLAYBOOK)) throw new HttpError(409, 'WIKI_ALREADY_RUNNING');
        if (this.jobs.size >= MAX_JOBS) throw new HttpError(503, 'WIKI_QUEUE_FULL');
        const session = this.generation.session();
        const run = this.runs.create(projectId, PLAYBOOK, 'facts:graph:' + projectId);
        const cancel = new AbortController();
        const job = nextTurn().then(() => this.generate(run, projectName, session, cancel.signal)).catch(() => {
            console.error('Failed to persist a Wiki run state');
        });
        this.jobs.set(run.id, { projectId, cancel, job });
        void job.then(() => this.jobs.delete(run.id));
        return { agentRunId: run.id, projectId, pollVia: '/api/v1/agent-runs/' + run.id };
    }

    cancelProject(projectId: string) {
        for (const entry of this.jobs.values()) if (entry.projectId === projectId) entry.cancel.abort();
    }

    async close() {
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

    private async generate(run: AgentRun, projectName: string, session: ReturnType<GenerationGateway['session']>, cancelled: AbortSignal) {
        if (!this.runs.get(run.id)) return;
        run.status = 'RUNNING';
        const facts = agentStep(run, 'FACTS');
        this.runs.save(run);
        try {
            const { body, omissions, factsHash } = this.transaction(() => {
                this.checkIndex(run.projectId);
                const { body, omissions } = wikiFacts(this.db, this.graph, this.metrics, run.projectId, projectName);
                const factsHash = digest(JSON.stringify({ body, omissions }));
                finish(facts, 'COMPLETED', 'Collected indexed structure and citation locations.');
                facts.evidenceReferences.push('facts:sha256:' + factsHash);
                facts.missingInfo = omissions;
                this.runs.save(run);
                return { body, omissions, factsHash };
            });
            const model = agentStep(run, 'LLM_ARCH');
            const modelOmissions: string[] = [];
            let modelName: string | null = null;
            let incomplete = false;
            if (!session.configuration.enabled) {
                finish(model, 'SKIPPED', 'Generation model unavailable.');
                model.missingInfo.push(MODEL_UNAVAILABLE);
                modelOmissions.push(MODEL_UNAVAILABLE);
            } else {
                const deadline = AbortSignal.any([cancelled, AbortSignal.timeout(MAX_JOB_MS)]);
                this.runs.save(run);
                const enhancement = await this.enhance(run, wikiModel(session, body, factsHash), deadline);
                if (!enhancement) return;
                const { chapters, notes } = enhancement;
                incomplete = chapters.length < wikiPhases.length;
                finish(model, incomplete ? 'PARTIAL' : 'COMPLETED', `${chapters.length}/${wikiPhases.length} model sections available.`);
                model.missingInfo.push(...notes);
                modelOmissions.push(...notes);
                if (chapters.length) {
                    modelName = session.configuration.model;
                    const project = body[0];
                    project.sections.push(...chapters.map(chapter => chapter.section));
                    const references = new Map(project.citations.map(reference => [JSON.stringify(reference), reference]));
                    for (const chapter of chapters) for (const reference of chapter.citations) references.set(JSON.stringify(reference), reference);
                    project.citations = [...references.values()];
                }
            }
            if (!this.runs.get(run.id)) return;
            const persist = agentStep(run, 'PERSIST');
            this.runs.save(run);
            this.transaction(() => {
                this.persist(run, body, omissions, factsHash, modelName, modelOmissions, incomplete);
                finish(persist, 'COMPLETED', `Saved ${body.length} versioned summaries.`);
                persist.evidenceReferences.push('summaries:project:' + run.projectId);
                run.status = incomplete || omissions.length ? 'PARTIAL' : 'COMPLETED';
                run.statusReason = omissions[0] ?? (incomplete ? 'WIKI_MODEL_SECTIONS_INCOMPLETE' : null);
                run.completedAt = new Date().toISOString();
                run.outputReference = 'summaries:project:' + run.projectId;
                this.runs.save(run);
            });
        } catch (error) {
            const saved = this.runs.get(run.id);
            if (saved) this.runs.fail(saved, error instanceof HttpError ? error.message : 'WIKI_GENERATION_FAILED');
        }
    }

    private async enhance(run: AgentRun, model: ReturnType<typeof wikiModel>, signal: AbortSignal) {
        const { fingerprint } = model;
        const chapters: WikiChapter[] = [];
        const notes: string[] = [];
        const cachedPhase = this.db.prepare('SELECT payload FROM wiki_phase WHERE project_id = ? AND phase = ? AND fingerprint = ?');
        const savePhase = this.db.prepare('INSERT INTO wiki_phase VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING');
        const prune = this.db.prepare(`DELETE FROM wiki_phase WHERE rowid IN (SELECT rowid FROM wiki_phase
            WHERE project_id = ? AND phase = ? ORDER BY rowid DESC LIMIT -1 OFFSET ?)`);
        for (const phase of wikiPhases) {
            if (!this.runs.get(run.id)) return undefined;
            const step = agentStep(run, 'LLM_ARCH:' + phase.id);
            this.runs.save(run);
            const cached = cachedPhase.get(run.projectId, phase.id, fingerprint);
            let chapter: WikiChapter | undefined;
            try {
                if (cached) chapter = JSON.parse(String(cached.payload)) as WikiChapter;
                else if (signal.aborted) throw new GenerationError('WIKI_MODEL_DEADLINE');
                else chapter = await model.chapter(phase, signal);
                finish(step, 'COMPLETED', cached ? 'Reused the saved model section.' : 'Generated the model section.');
                if (chapter.unknownCitations) step.missingInfo.push('WIKI_UNKNOWN_CITATIONS');
                step.evidenceReferences.push('wiki-phase:' + phase.id + ':' + fingerprint);
                chapters.push(chapter);
            } catch (error) {
                if (!(error instanceof GenerationError)) throw error;
                step.error = error.message;
                step.missingInfo.push(error.message);
                finish(step, signal.aborted ? 'SKIPPED' : 'FAILED', 'Section unavailable.');
            }
            for (const omission of step.missingInfo) notes.push(`${omission}:${phase.id}`);
            if (!this.runs.get(run.id)) return undefined;
            this.transaction(() => {
                if (chapter && !cached) {
                    savePhase.run(run.projectId, phase.id, fingerprint, JSON.stringify(chapter));
                    prune.run(run.projectId, phase.id, MAX_PHASE_VERSIONS);
                }
                this.runs.save(run);
            });
        }
        return { chapters, notes };
    }

    private persist(run: AgentRun, drafts: SummaryDraft[], omissions: string[], factsHash: string,
        model: string | null, modelOmissions: string[], modelIncomplete: boolean) {
        const { projectId } = run;
        const now = new Date().toISOString();
        this.db.prepare('INSERT INTO wiki_generation VALUES (?, ?)').run(run.id, projectId);
        const version = this.db.prepare(`SELECT max(doc_version) AS current FROM wiki_document
            WHERE project_id = ? AND level = ? AND scope_id = ?`);
        const save = documentWriter(this.db);
        for (const draft of drafts) {
            const docVersion = Number(version.get(projectId, draft.level, draft.scopeId)?.current ?? 0) + 1;
            const project = draft.level === 'PROJECT';
            const missingInfo = project ? [...omissions, ...modelOmissions] : omissions;
            const document: SummaryDocument = { ...draft, id: randomUUID(), projectId, generatedAt: now, docVersion,
                status: omissions.length || (project && modelIncomplete) ? 'PARTIAL' : 'COMPLETED',
                model: project ? model : null, missingInfo, factsHash };
            save(document, run.id);
        }
    }

    get(id: string): SummaryDocument | undefined {
        const row = this.db.prepare('SELECT payload FROM wiki_document WHERE id = ?').get(id);
        return row ? JSON.parse(String(row.payload)) as SummaryDocument : undefined;
    }

    latest(projectId: string): SummaryDocument[] {
        const generation = this.db.prepare('SELECT run_id FROM wiki_generation WHERE project_id = ? ORDER BY rowid DESC LIMIT 1').get(projectId);
        const rows = generation
            ? this.db.prepare("SELECT payload FROM wiki_document WHERE run_id = ? ORDER BY level = 'PROJECT' DESC, scope_id").all(generation.run_id)
            : this.db.prepare(`SELECT payload FROM (
                SELECT payload, level, scope_id, row_number() OVER (
                    PARTITION BY level, scope_id ORDER BY doc_version DESC, julianday(json_extract(payload, '$.generatedAt')) DESC, rowid DESC
                ) AS position FROM wiki_document WHERE project_id = ? AND run_id IS NULL
            ) WHERE position = 1 ORDER BY level = 'PROJECT' DESC, scope_id`).all(projectId);
        return rows.map(row => JSON.parse(String(row.payload)) as SummaryDocument);
    }

    tree(projectId: string) {
        return this.latest(projectId).map(document => {
            const level = document.level === 'PROJECT' ? 'project' : 'package';
            const path = level === 'project' ? level : level + '/' + document.scopeId;
            return { id: document.id, name: document.legacyImported && level === 'package' ? document.scopeId : document.title,
                path, level, docVersion: document.docVersion,
                keywords: document.citations.slice(0, 5).map(item => item.qualifiedName) };
        });
    }
}
