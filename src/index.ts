import { mkdir, lstat, opendir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { AgentRuns } from './agent-runs.js';
import { Assets } from './assets.js';
import { springAuthorizationEvidence } from './authorization-evidence.js';
import { ChangeReviews } from './change-review.js';
import { ChangeReviewAgent } from './change-review-agent.js';
import { CodeGraph } from './graph.js';
import { checkCode } from './code-checks.js';
import type { CodeCheckMatch } from './code-checks.js';
import { CodeMetrics } from './code-metrics.js';
import { DependencyAdvisories } from './dependency-advisories.js';
import { DetectionRules } from './detection-rules.js';
import { GenerationGateway } from './generation.js';
import { ExternalFindings } from './external-findings.js';
import { analyzeFlow } from './flow-analysis.js';
import { traceParameterFlow } from './parameter-flow.js';
import { ReviewQueue } from './review-queue.js';
import { ScanHistory } from './scan-history.js';
import { ScanTasks } from './scan-tasks.js';
import { SastTriageAgent } from './sast-triage-agent.js';
import { requestParameters, taintMatches } from './taint-scan.js';
import type { TaintMatch } from './taint-scan.js';
import { TriagePolicy } from './triage-policy.js';
import { VulnerabilityInventory } from './vulnerability-inventory.js';
import { HttpError } from './http-error.js';
import { IdentityDirectory } from './identity.js';
import { IndexWatches } from './index-watch.js';
import { MAX_JAR_BYTES } from './java-bytecode.js';
import { readJsAliasTargets } from './js-path-aliases.js';
import { ModelProviders } from './model-providers.js';
import { readProjectFile } from './project-file.js';
import type { GraphQuery } from './graph.js';
import { digest, isJar, languageOf, readIndexedFile, sourceLanguages } from './source.js';
import type { CodeUnit, IndexedSource, IndexLanguage, IndexStrategy } from './source.js';
import { EmbeddingUnavailable, VectorIndex } from './vector.js';
import type { OllamaEmbedding, VectorEntry, VectorMode, VectorSearchOptions } from './vector.js';
import { findVulnerabilityVariants } from './vulnerability-variants.js';
import { WikiSummaries } from './wiki.js';

interface IndexResult {
    totalFiles: number;
    parsedFiles: number;
    skippedFiles: number;
    degradedFiles: number;
    totalUnits: number;
    totalEdges: number;
    durationMs: number;
    errors: string[];
}

interface IndexProgress {
    stage: 'scanning' | 'parsing' | 'embedding' | 'finalizing';
    done: number;
    total: number;
    processedFiles: number;
    totalFiles: number;
}

type IndexStatus = { status: 'idle' | 'running' | 'done' | 'partial' | 'error' }
    & Partial<IndexResult & IndexProgress> & { indexedAt?: string; message?: string; pct?: number };

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_INDEX_JOBS = 2;
const MAX_FILES = 20_000;
const MAX_CODE_CHECK_UNITS = 20_000;
const MAX_CODE_CHECK_BYTES = 32 * 1024 * 1024;
const MAX_CODE_CHECK_MATCHES = 1_000;
const MAX_TAINT_ENTRIES = 80;
const MAX_TAINT_MATCHES = 100;
const MAX_TAINT_BATCH_MS = 4_000;
const INDEX_FORMAT = 'graph-3';
const JS_INDEX_FORMAT = 'graph-3-js-5';
const sourceIndexFormats: Partial<Record<IndexLanguage, string>> = {
    java: 'graph-3-java-5', javascript: JS_INDEX_FORMAT, typescript: JS_INDEX_FORMAT
};
const HEURISTIC_FORMAT = 'heuristic-1';
const RECOVERY_FORMAT = 'recovered-1';
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor']);
const ERROR_MESSAGES = new Set(['FILE_TOO_LARGE', 'SYNTAX_ERROR', 'SYNTAX_LIMIT', 'PARSE_TIMEOUT', 'FILE_CHANGED', 'PATH_CHANGED',
    'INVALID_CLASS_FILE', 'DUPLICATE_JAVA_CLASS', 'BYTECODE_SYMBOL_LIMIT', 'INVALID_JAVA_ARCHIVE', 'JAVA_ARCHIVE_LIMIT']);
const MISSING_PATH = new Set(['ENOENT', 'ENOTDIR']);

function isMissing(error: unknown) {
    return error instanceof Error && MISSING_PATH.has(String((error as NodeJS.ErrnoException).code));
}

function readUnit(row: Record<string, unknown>) {
    return JSON.parse(String(row.payload)) as CodeUnit;
}

interface IndexScope {
    file?: string;
    signal?: AbortSignal;
    rememberBytecode?: boolean;
    rememberStrategy?: boolean;
    strategy?: IndexStrategy;
    register?: (projectId: string) => void;
}

export class RepositoryIndex {
    private readonly jobs = new Set<Promise<IndexStatus>>();
    private readonly indexProgress = new Map<string, IndexProgress>();
    private readonly graph: CodeGraph;
    private readonly vectors: VectorIndex;
    private readonly databaseFiles: Set<string>;
    readonly identity: IdentityDirectory;
    readonly assets: Assets;
    readonly watches: IndexWatches;
    readonly metrics: CodeMetrics;
    readonly changeReviews: ChangeReviews;
    readonly changeReviewAgent: ChangeReviewAgent;
    readonly sastTriageAgent: SastTriageAgent;
    readonly externalFindings: ExternalFindings;
    readonly triagePolicy: TriagePolicy;
    readonly reviewQueue: ReviewQueue;
    readonly scanHistory: ScanHistory;
    readonly scans: ScanTasks;
    readonly vulnerabilities: VulnerabilityInventory;
    readonly dependencyAdvisories: DependencyAdvisories;
    readonly detectionRules: DetectionRules;
    readonly agentRuns: AgentRuns;
    readonly wiki: WikiSummaries;
    readonly modelProviders: ModelProviders;
    readonly generation: GenerationGateway;

    private constructor(
        private readonly db: DatabaseSync, private readonly root: string, assetsRoot: string, database: string, embedding?: OllamaEmbedding
    ) {
        this.databaseFiles = new Set(database === ':memory:' ? [] : ['', '-wal', '-shm', '-journal', '-provider-key'].map(suffix => database + suffix));
        db.exec(`
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS project (
                id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, indexed_at TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS index_status (
                project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
                status TEXT NOT NULL, payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS index_bytecode (
                project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS index_strategy (
                project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
                strategy TEXT NOT NULL CHECK (strategy IN ('precise', 'heuristic'))
            );
            CREATE TABLE IF NOT EXISTS indexed_file (
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                path TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(project_id, path)
            );
            CREATE TABLE IF NOT EXISTS index_dirty (
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                path TEXT NOT NULL, PRIMARY KEY(project_id, path)
            );
            CREATE TABLE IF NOT EXISTS unit (
                id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL, file_path TEXT NOT NULL,
                qualified_name TEXT NOT NULL, kind TEXT NOT NULL, language TEXT NOT NULL,
                start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, is_test INTEGER NOT NULL,
                payload TEXT NOT NULL,
                FOREIGN KEY(project_id, file_path) REFERENCES indexed_file(project_id, path) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS unit_location ON unit(project_id, file_path, start_line, end_line);
            CREATE INDEX IF NOT EXISTS unit_name ON unit(qualified_name, project_id);
            CREATE INDEX IF NOT EXISTS unit_entry_point ON unit(project_id, file_path, start_line, id)
                WHERE json_extract(payload, '$.metadata.is_entry_point') = 'true';
            CREATE VIRTUAL TABLE IF NOT EXISTS unit_search USING fts5(
                name, signature, source, tokenize="unicode61 tokenchars '_'"
            );
            CREATE TRIGGER IF NOT EXISTS unit_search_delete AFTER DELETE ON unit BEGIN
                DELETE FROM unit_search WHERE rowid = old.rowid;
            END;
        `);
        this.graph = new CodeGraph(db);
        this.vulnerabilities = new VulnerabilityInventory(db);
        this.dependencyAdvisories = new DependencyAdvisories(db);
        this.detectionRules = new DetectionRules(db);
        this.metrics = new CodeMetrics(db, this.graph, this.vulnerabilities);
        this.externalFindings = new ExternalFindings(db);
        this.triagePolicy = new TriagePolicy(db);
        this.reviewQueue = new ReviewQueue(db, this.vulnerabilities);
        this.scanHistory = new ScanHistory(db);
        this.changeReviews = new ChangeReviews(db, this, this.externalFindings, this.vulnerabilities);
        this.agentRuns = new AgentRuns(db);
        this.vectors = new VectorIndex(db, embedding);
        this.identity = new IdentityDirectory(db);
        this.modelProviders = new ModelProviders(db, this.identity, database === ':memory:' ? null : database + '-provider-key');
        this.generation = new GenerationGateway(this.modelProviders);
        this.changeReviewAgent = new ChangeReviewAgent(this.agentRuns, this.generation);
        this.sastTriageAgent = new SastTriageAgent(this, this.agentRuns, this.generation);
        this.wiki = new WikiSummaries(db, this.agentRuns, this.graph, this.metrics, this.generation);
        this.assets = new Assets(db, assetsRoot, {
            start: (root, languages, incremental, strategy, register) =>
                this.startResolved(root, languages, incremental, { register, strategy, rememberStrategy: true }),
            remove: (id, mark) => this.deleteResolved(id, null, mark),
            frameworks: id => this.projectStats(id).frameworkDistribution,
            vulnerabilityCounts: id => this.vulnerabilities.activeCounts(id)
        });
        this.scans = new ScanTasks(this.scanHistory, this.externalFindings, this.assets);
        this.watches = new IndexWatches(db, async (id, root, signal) => {
            if (signal.aborted || this.projectRoot(id) !== root) return;
            const languages = new Set<IndexLanguage>(sourceLanguages);
            if (this.watchesBytecode(id)) languages.add('class');
            return this.startResolved(root, languages, true, { signal });
        }, (root, filename) => {
            const path = relative(root, resolve(root, filename));
            const absolute = join(root, path);
            return this.relativeSourceAllowed(path, this.watchesBytecode(digest(root).slice(0, 12)))
                && !this.assets.ownsPath(absolute) && !this.databaseFiles.has(absolute);
        });
        const interrupted: IndexStatus = { status: 'error', message: 'INTERRUPTED' };
        db.prepare("UPDATE index_status SET status = 'error', payload = ? WHERE status = 'running'")
            .run(JSON.stringify(interrupted));
    }

    static async open(database: string, permittedRoot: string, embedding?: OllamaEmbedding, storage = `${database}-assets`) {
        const root = await realpath(permittedRoot);
        if (!(await lstat(root)).isDirectory()) throw new Error('REPOGRAPH_PROJECTS_ROOT must be a directory');
        await mkdir(dirname(database), { recursive: true, mode: 0o700 });
        await mkdir(storage, { recursive: true, mode: 0o700 });
        const assetsRoot = await realpath(storage);
        let dbPath = database;
        if (database !== ':memory:') {
            dbPath = join(await realpath(dirname(database)), basename(database));
            try { dbPath = await realpath(dbPath); }
            catch (error) { if (!isMissing(error)) throw error; }
        }
        const repository = new RepositoryIndex(new DatabaseSync(dbPath), root, assetsRoot, dbPath, embedding);
        await repository.assets.recoverUploads();
        repository.watches.restore((id, path) => {
            try { return !repository.assets.ownsPath(path) && repository.projectRoot(id) === path; }
            catch (error) { if (!(error instanceof HttpError)) throw error; return false; }
        });
        return repository;
    }

    storageAvailable() {
        try {
            this.db.prepare('SELECT 1 FROM project LIMIT 1').get();
            return true;
        } catch { return false; }
    }

    async close() {
        await this.watches.close();
        await Promise.all(this.jobs);
        await Promise.all([this.wiki.close(), this.changeReviewAgent.close(), this.sastTriageAgent.close(), this.scans.close()]);
        this.db.close();
    }

    private transaction(action: () => void) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            action();
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    private async resolveProject(input: string, mustExist: boolean) {
        if (!isAbsolute(input) || input.includes('\0')) throw new HttpError(400, 'ABSOLUTE_PROJECT_ROOT_REQUIRED');
        let path = resolve(input);
        try {
            path = await realpath(path);
        } catch (error) {
            if (mustExist || !isMissing(error)) throw new HttpError(400, 'PROJECT_ROOT_UNAVAILABLE');
        }
        this.requirePermittedRoot(path);
        if (mustExist && !(await lstat(path)).isDirectory()) throw new HttpError(400, 'PROJECT_ROOT_NOT_DIRECTORY');
        return path;
    }

    private requirePermittedRoot(path: string) {
        const subpath = relative(this.root, path);
        if (subpath === '..' || subpath.startsWith(`..${sep}`) || isAbsolute(subpath)) {
            throw new HttpError(403, 'PROJECT_ROOT_OUTSIDE_ALLOWED_DIRECTORY');
        }
    }

    private saveStatus(id: string, status: IndexStatus) {
        this.db.prepare(`
            INSERT INTO index_status VALUES (?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET status = excluded.status, payload = excluded.payload
        `).run(id, status.status, JSON.stringify(status));
    }

    async start(input: string, languages: Set<IndexLanguage>, incremental: boolean, strategy: IndexStrategy = 'auto') {
        const root = await this.resolveProject(input, true);
        if (this.assets.ownsPath(root)) throw new HttpError(403, 'MANAGED_SOURCE_REQUIRES_ASSET_IMPORT');
        this.startResolved(root, languages, incremental, { rememberBytecode: true, rememberStrategy: true, strategy });
        return root;
    }

    async indexFile(input: string, file: string, incremental: boolean, authorize: () => void, strategy: IndexStrategy = 'auto') {
        const root = await this.resolveProject(input, true);
        if (this.assets.ownsPath(root)) throw new HttpError(403, 'MANAGED_SOURCE_REQUIRES_ASSET_IMPORT');
        if (!isAbsolute(file) || file.includes('\0')) throw new HttpError(400, 'ABSOLUTE_SOURCE_PATH_REQUIRED');
        const requested = resolve(file);
        let path = relative(root, requested);
        if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) path = relative(resolve(input), requested);
        const language = languageOf(path);
        if (!this.relativeSourceAllowed(path, language === 'class')) throw new HttpError(403, 'SOURCE_OUTSIDE_INDEX_SCOPE');
        const absolute = join(root, path);
        if (this.assets.ownsPath(absolute)) throw new HttpError(403, 'MANAGED_SOURCE_REQUIRES_ASSET_IMPORT');
        if (this.databaseFiles.has(absolute)) throw new HttpError(403, 'SOURCE_OUTSIDE_INDEX_SCOPE');
        if (!language && !['tsconfig.json', 'package.json'].includes(basename(path))) throw new HttpError(400, 'UNSUPPORTED_LANGUAGE');
        try {
            if (await realpath(absolute) !== absolute) throw new HttpError(403, 'SOURCE_OUTSIDE_INDEX_SCOPE');
            if (!(await lstat(absolute)).isFile()) throw new HttpError(400, 'SOURCE_NOT_REGULAR_FILE');
        } catch (error) {
            if (isMissing(error)) throw new HttpError(404, 'SOURCE_FILE_NOT_FOUND');
            if (error instanceof HttpError) throw error;
            throw new HttpError(400, 'SOURCE_UNAVAILABLE');
        }
        authorize();
        return this.startResolved(root, new Set(language ? [language] : []), incremental, { file: path.split(sep).join('/'), strategy });
    }

    private relativeSourceAllowed(path: string, bytecode = false) {
        return path.length > 0 && !isAbsolute(path) && !path.split(sep).some(part =>
            part.startsWith('.') || (IGNORED_DIRS.has(part) && !(bytecode && part === 'build')));
    }

    private watchesBytecode(projectId: string) {
        return this.db.prepare('SELECT 1 FROM index_bytecode WHERE project_id = ?').get(projectId) !== undefined;
    }

    async startWatch(id: string, input: string, authorize: () => void) {
        const root = await this.resolveProject(input, true);
        if (digest(root).slice(0, 12) !== id) throw new HttpError(400, 'PROJECT_ROOT_MISMATCH');
        if (this.assets.ownsPath(root)) throw new HttpError(403, 'MANAGED_SOURCE_REQUIRES_ASSET_IMPORT');
        authorize();
        this.transaction(() => {
            this.registerProject(id, root);
            this.watches.persist(id);
        });
        this.watches.attach(id, root);
    }

    private registerProject(id: string, root: string) {
        this.db.prepare('INSERT OR IGNORE INTO project(id, root) VALUES (?, ?)').run(id, root);
        if (this.db.prepare('SELECT root FROM project WHERE id = ?').get(id)?.root !== root) {
            throw new HttpError(409, 'PROJECT_ID_CONFLICT');
        }
    }

    private startResolved(root: string, languages: Set<IndexLanguage>, incremental: boolean, scope: IndexScope = {}) {
        const id = digest(root).slice(0, 12);
        const storedStrategy = this.db.prepare('SELECT strategy FROM index_strategy WHERE project_id = ?').get(id)?.strategy;
        const strategy = scope.strategy ?? (storedStrategy === 'heuristic' || storedStrategy === 'precise' ? storedStrategy : 'auto');
        this.transaction(() => {
            const previous = this.db.prepare('SELECT status FROM index_status WHERE project_id = ?').get(id);
            if (previous?.status === 'running') throw new HttpError(409, 'INDEX_ALREADY_RUNNING');
            if (this.jobs.size >= MAX_INDEX_JOBS) throw new HttpError(503, 'INDEX_CAPACITY_EXHAUSTED');
            this.registerProject(id, root);
            this.saveStatus(id, { status: 'running' });
            if (scope.rememberBytecode) {
                if (languages.has('class')) this.db.prepare('INSERT OR IGNORE INTO index_bytecode VALUES (?)').run(id);
                else this.db.prepare('DELETE FROM index_bytecode WHERE project_id = ?').run(id);
            }
            if (scope.rememberStrategy) {
                if (strategy === 'auto') this.db.prepare('DELETE FROM index_strategy WHERE project_id = ?').run(id);
                else this.db.prepare(`INSERT INTO index_strategy VALUES (?, ?)
                    ON CONFLICT(project_id) DO UPDATE SET strategy = excluded.strategy`).run(id, strategy);
            }
            scope.register?.(id);
        });
        const job = this.indexFiles(id, root, languages, incremental, { ...scope, strategy }).catch(() => {
            const failed: IndexStatus = { status: 'error', message: 'INDEX_PERSISTENCE_FAILED' };
            try {
                this.saveStatus(id, failed);
            } catch {
                console.error('Unable to persist indexing result');
            }
            return failed;
        });
        this.jobs.add(job);
        void job.then(() => {
            this.indexProgress.delete(id);
            this.jobs.delete(job);
        });
        return job;
    }

    async status(input: string, authorize?: (projectId: string) => void): Promise<IndexStatus> {
        const root = await this.resolveProject(input, false);
        const id = digest(root).slice(0, 12);
        authorize?.(id);
        const row = this.db.prepare(`
            SELECT s.payload FROM index_status s JOIN project p ON p.id = s.project_id WHERE p.root = ?
        `).get(root);
        const status: IndexStatus = row ? JSON.parse(String(row.payload)) as IndexStatus : { status: 'idle' };
        const progress = status.status === 'running' ? this.indexProgress.get(id) : undefined;
        return progress ? { ...status, ...progress, pct: progress.total ? Math.round(progress.done * 100 / progress.total) : 0 } : status;
    }

    async delete(id: string, input: string | null) {
        const managed = this.assets.forProject(id);
        if (managed) return this.assets.delete(managed, input);
        const root = input === null ? null : await this.resolveProject(input, false);
        this.deleteResolved(id, root);
    }

    private deleteResolved(id: string, root: string | null, mark?: () => void) {
        this.transaction(() => {
            const active = this.db.prepare(`
                SELECT s.status, p.root FROM project p LEFT JOIN index_status s ON p.id = s.project_id WHERE p.id = ?
            `).get(id);
            if (active?.status === 'running') throw new HttpError(409, 'INDEX_ALREADY_RUNNING');
            if (this.scans.active(id)) throw new HttpError(409, 'SCAN_ALREADY_RUNNING');
            if (active && root !== null && active.root !== root) throw new HttpError(400, 'PROJECT_ROOT_MISMATCH');
            mark?.();
            this.db.prepare('DELETE FROM project WHERE id = ?').run(id);
        });
        this.wiki.cancelProject(id);
        this.changeReviewAgent.cancelProject(id);
        this.sastTriageAgent.cancelProject(id);
        void this.watches.detach(id);
    }

    private async *walk(folder: string, includeBytecode: boolean, depth = 0, bytecodeOnly = false): AsyncGenerator<string> {
        if (depth > 64 || await realpath(folder) !== folder) throw new Error('UNSAFE_DIRECTORY');
        for await (const entry of await opendir(folder)) {
            if (entry.name.startsWith('.')) continue;
            const absolute = join(folder, entry.name);
            if (this.databaseFiles.has(absolute)) continue;
            if (entry.isDirectory() && absolute !== this.assets.root) {
                if (!IGNORED_DIRS.has(entry.name)) yield* this.walk(absolute, includeBytecode, depth + 1, bytecodeOnly);
                else if (includeBytecode && entry.name === 'build') yield* this.walk(absolute, true, depth + 1, true);
            }
            if (entry.isFile()) {
                const language = languageOf(entry.name);
                if (language && (language === 'class' ? includeBytecode : !bytecodeOnly)) yield absolute;
            }
        }
    }

    private async indexFiles(id: string, root: string, languages: Set<IndexLanguage>, incremental: boolean,
        scope: IndexScope & { strategy: IndexStrategy }) {
        const started = Date.now();
        const result: IndexResult = {
            totalFiles: 0, parsedFiles: 0, skippedFiles: 0, degradedFiles: 0,
            totalUnits: 0, totalEdges: 0, durationMs: 0, errors: []
        };
        const status: IndexStatus = { status: 'running' };
        const file = scope.file ?? null;
        const signal = scope.signal;
        const markDirty = this.db.prepare('INSERT OR IGNORE INTO index_dirty VALUES (?, ?)');
        const candidates: { absolute: string; path: string; language: IndexLanguage }[] = [];
        let processedFiles = 0;
        const progress = (stage: IndexProgress['stage'], done = 0, total = 0) => {
            this.indexProgress.set(id, { stage, done, total, processedFiles, totalFiles: candidates.length });
        };
        progress('scanning');
        try {
            const cached = new Map(this.db.prepare('SELECT path, hash FROM indexed_file WHERE project_id = ? AND (? IS NULL OR path = ?)')
                .all(id, file, file).map(row => [String(row.path), String(row.hash)]));
            const dirty = new Set(this.db.prepare('SELECT path FROM index_dirty WHERE project_id = ? AND (? IS NULL OR path = ?)')
                .all(id, file, file).map(row => String(row.path)));
            const remaining = new Set([...cached.keys(), ...dirty]);
            const embedded = this.vectors.completedFiles(id);
            let providerUnavailable = false;

            let scanFailure: Error | undefined;
            try {
                for await (const absolute of file ? [join(root, file)] : this.walk(root, languages.has('class'))) {
                    signal?.throwIfAborted();
                    const path = relative(root, absolute).split(sep).join('/');
                    const language = languageOf(path);
                    if (!language || !languages.has(language)) continue;
                    if (candidates.length === MAX_FILES) throw new Error('FILE_LIMIT_EXCEEDED');
                    candidates.push({ absolute, path, language });
                }
            } catch (error) {
                signal?.throwIfAborted();
                scanFailure = error instanceof Error ? error : new Error('PROJECT_INDEX_FAILED');
            }

            progress('parsing', 0, candidates.length);
            for (const { absolute, path, language } of candidates) {
                signal?.throwIfAborted();
                result.totalFiles++;
                const cachedHash = cached.get(path);
                remaining.delete(path);
                try {
                    const maxBytes = isJar(path) ? MAX_JAR_BYTES : MAX_FILE_BYTES;
                    const bytes = await readProjectFile(absolute, maxBytes);
                    signal?.throwIfAborted();
                    const explicitHeuristic = scope.strategy === 'heuristic' && language !== 'class' && language !== 'doc';
                    const format = explicitHeuristic ? HEURISTIC_FORMAT : (sourceIndexFormats[language] ?? INDEX_FORMAT);
                    const contentHash = digest(bytes);
                    const hash = `${format}:${contentHash}`;
                    if (incremental && !dirty.has(path) && cachedHash === hash && (!this.vectors.enabled || embedded.has(path))) {
                        result.skippedFiles++;
                        continue;
                    }
                    markDirty.run(id, path);
                    result.parsedFiles++;
                    const allowRecovery = !cachedHash || cachedHash.startsWith(HEURISTIC_FORMAT + ':') || cachedHash.startsWith(RECOVERY_FORMAT + ':');
                    const indexed = await readIndexedFile(id, path, language, bytes, scope.strategy, allowRecovery, signal);
                    let vectors: VectorEntry[] | undefined;
                    if (this.vectors.enabled && (!providerUnavailable || indexed.units.length === 0)) {
                        try {
                            vectors = await this.vectors.prepare(indexed, signal, (done, total) => progress('embedding', done, total));
                        } catch (error) {
                            signal?.throwIfAborted();
                            if (!(error instanceof EmbeddingUnavailable)) throw error;
                            providerUnavailable = true;
                        }
                    }
                    if (!bytes.equals(await readProjectFile(absolute, maxBytes))) throw new Error('FILE_CHANGED');
                    signal?.throwIfAborted();
                    if (this.vectors.enabled && !vectors) {
                        result.errors.push(`${path}: EMBEDDING_UNAVAILABLE`);
                        if (cachedHash === hash) continue;
                    }
                    this.replaceFile(id, path, indexed.degradedFrom ? RECOVERY_FORMAT + ':' + contentHash : hash, indexed, vectors);
                    if (indexed.degradedFrom) {
                        result.degradedFiles++;
                        result.errors.push(`${path}: ${indexed.degradedFrom}`);
                    }
                } catch (error) {
                    signal?.throwIfAborted();
                    markDirty.run(id, path);
                    const reason = error instanceof Error && ERROR_MESSAGES.has(error.message) ? error.message : 'INDEX_FILE_FAILED';
                    result.errors.push(`${path}: ${reason}`);
                } finally {
                    if (!signal?.aborted) progress('parsing', ++processedFiles, candidates.length);
                }
            }

            if (scanFailure) throw scanFailure;
            progress('finalizing', processedFiles, candidates.length);
            for (const path of file ? [] : remaining) {
                signal?.throwIfAborted();
                let removed: boolean;
                try {
                    removed = await this.confirmRemoved(root, join(root, path));
                } catch {
                    result.errors.push(`${path}: FILE_CHECK_FAILED`);
                    continue;
                }
                signal?.throwIfAborted();
                if (removed) this.transaction(() => {
                    this.db.prepare('DELETE FROM indexed_file WHERE project_id = ? AND path = ?').run(id, path);
                    this.db.prepare('DELETE FROM index_dirty WHERE project_id = ? AND path = ?').run(id, path);
                });
            }
            signal?.throwIfAborted();
            const { aliases, issues } = await readJsAliasTargets(root, this.graph.jsAliasReferences(id), signal,
                languages.size === 0 ? file ?? undefined : undefined);
            signal?.throwIfAborted();
            this.transaction(() => this.graph.syncJsAliases(id, aliases));
            result.errors.push(...issues);
            status.status = result.errors.length ? 'partial' : 'done';
            status.indexedAt = new Date().toISOString();
        } catch (error) {
            status.status = result.totalFiles ? 'partial' : 'error';
            result.errors.push(signal?.aborted ? 'INDEX_CANCELLED' : error instanceof Error && error.message === 'FILE_LIMIT_EXCEEDED'
                ? error.message : 'PROJECT_INDEX_FAILED');
        }
        result.totalUnits = Number(this.db.prepare('SELECT count(*) AS n FROM unit WHERE project_id = ? AND (? IS NULL OR file_path = ?)')
            .get(id, file, file)?.n ?? 0);
        result.totalEdges = this.graph.count(id, file);
        result.durationMs = Date.now() - started;
        this.transaction(() => {
            if (status.indexedAt) this.db.prepare('UPDATE project SET indexed_at = ? WHERE id = ?').run(status.indexedAt, id);
            this.saveStatus(id, { ...status, ...result });
        });
        return { ...status, ...result };
    }

    private async confirmRemoved(root: string, absolute: string) {
        try {
            if (!(await lstat(absolute)).isDirectory()) return false;
            if (await realpath(absolute) !== absolute) throw new Error('PATH_CHANGED');
            return true;
        } catch (error) {
            if (!isMissing(error)) throw error;
        }
        for (let ancestor = dirname(absolute); ; ancestor = dirname(ancestor)) {
            try {
                if ((await lstat(ancestor)).isSymbolicLink() || await realpath(ancestor) !== ancestor) throw new Error('PATH_CHANGED');
                return true;
            } catch (error) {
                if (!isMissing(error) || ancestor === root) throw error;
            }
        }
    }

    private replaceFile(projectId: string, path: string, hash: string, indexed: IndexedSource, vectors?: VectorEntry[]) {
        this.transaction(() => {
            this.db.prepare('DELETE FROM indexed_file WHERE project_id = ? AND path = ?').run(projectId, path);
            this.db.prepare('INSERT INTO indexed_file VALUES (?, ?, ?)').run(projectId, path, hash);
            const putUnit = this.db.prepare('INSERT INTO unit VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            const putSearch = this.db.prepare('INSERT INTO unit_search(rowid, name, signature, source) VALUES (?, ?, ?, ?)');
            for (const unit of indexed.units) {
                const { lastInsertRowid } = putUnit.run(unit.id, projectId, path, unit.qualifiedName, unit.kind,
                    unit.language, unit.startLine, unit.endLine, Number(unit.metadata.is_test === 'true'), JSON.stringify(unit));
                putSearch.run(lastInsertRowid, unit.qualifiedName, unit.signature, unit.rawSource);
            }
            this.graph.put(projectId, path, indexed);
            if (vectors) this.vectors.put(projectId, path, vectors);
            if (!indexed.degradedFrom && (!this.vectors.enabled || vectors)) {
                this.db.prepare('DELETE FROM index_dirty WHERE project_id = ? AND path = ?').run(projectId, path);
            }
        });
    }

    vectorSearch(mode: VectorMode, query: string, options: VectorSearchOptions, signal?: AbortSignal) {
        return this.vectors.search(mode, query, options, signal);
    }

    projects(allowed: readonly string[] | null = null, summary = false) {
        const scope = allowed === null ? null : JSON.stringify(allowed);
        const dashboard = summary ? `,
            a.filename AS archiveName,
            (SELECT count(*) FROM indexed_file WHERE project_id = p.id) AS fileCount,
            (SELECT language FROM unit WHERE project_id = p.id AND language <> 'doc'
                GROUP BY language ORDER BY count(*) DESC, language LIMIT 1) AS mainLanguage,
            (SELECT status FROM index_status WHERE project_id = p.id) AS indexStatus
        ` : '';
        const rows = this.db.prepare(`
            SELECT p.id AS projectId, p.root AS projectRoot, p.indexed_at AS indexedAt, count(u.id) AS nodeCount, a.id AS assetId
            ${dashboard}
            FROM project p LEFT JOIN unit u ON u.project_id = p.id
            LEFT JOIN managed_asset a ON a.project_id = p.id AND a.deleting = 0
            WHERE ? IS NULL OR p.id IN (SELECT value FROM json_each(?))
            GROUP BY p.id ORDER BY p.id
        `).all(scope, scope);
        return rows.map(row => ({
            projectId: String(row.projectId), projectName: basename(String(row.projectRoot)) || String(row.projectId),
            projectRoot: String(row.projectRoot), indexedAt: String(row.indexedAt), nodeCount: Number(row.nodeCount),
            ...(row.assetId ? { assetId: String(row.assetId) } : {}),
            ...(summary ? {
                fileCount: Number(row.fileCount),
                mainLanguage: row.mainLanguage ?? null,
                indexStatus: row.indexStatus ?? (row.indexedAt ? 'done' : 'idle'),
                ...(row.archiveName ? { archiveName: String(row.archiveName) } : {})
            } : {})
        }));
    }

    projectStats(projectId: string) {
        const project = this.db.prepare('SELECT root FROM project WHERE id = ?').get(projectId);
        const totalFiles = Number(this.db.prepare('SELECT count(*) AS n FROM indexed_file WHERE project_id = ?')
            .get(projectId)?.n ?? 0);
        const counts = this.db.prepare(`
            SELECT count(*) AS total, coalesce(sum(is_test), 0) AS tests,
                coalesce(sum(json_extract(payload, '$.metadata.is_entry_point') = 'true'), 0) AS entries
            FROM unit WHERE project_id = ?
        `).get(projectId);
        const distribution = (expression: 'kind' | 'language' | "json_extract(payload, '$.metadata.framework')") => {
            const rows = this.db.prepare(`
                SELECT ${expression} AS label, count(*) AS n FROM unit
                WHERE project_id = ? AND ${expression} IS NOT NULL GROUP BY label ORDER BY label
            `).all(projectId);
            return Object.fromEntries(rows.map(row => [String(row.label), Number(row.n)]));
        };
        const edgeKindDistribution = this.graph.edgeDistribution(projectId);
        return {
            projectId, projectRoot: String(project?.root ?? ''), totalFiles, totalUnits: Number(counts?.total ?? 0),
            totalEdges: Object.values(edgeKindDistribution).reduce((total, count) => total + count, 0),
            entryPointCount: Number(counts?.entries ?? 0), testCount: Number(counts?.tests ?? 0),
            kindDistribution: distribution('kind'), languageDistribution: distribution('language'),
            frameworkDistribution: distribution("json_extract(payload, '$.metadata.framework')"), edgeKindDistribution
        };
    }

    projectRoot(projectId: string) {
        const project = this.db.prepare('SELECT root FROM project WHERE id = ?').get(projectId);
        if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND');
        const path = String(project.root);
        const asset = this.assets.forProject(projectId);
        if (asset) this.assets.validateSource(asset, path);
        else this.requirePermittedRoot(path);
        return path;
    }

    private scanVersion(projectId: string, expectedVersion: string | null) {
        this.projectRoot(projectId);
        const status = this.db.prepare('SELECT status, payload FROM index_status WHERE project_id = ?').get(projectId);
        if (status?.status === 'running') throw new HttpError(409, 'INDEX_ALREADY_RUNNING');
        const indexVersion = digest(String(status?.payload ?? ''));
        if (expectedVersion !== null && expectedVersion !== indexVersion) throw new HttpError(409, 'CODE_SCAN_INDEX_CHANGED');
        return indexVersion;
    }

    scanCode(projectId: string, offset: number, expectedVersion: string | null, actor: string) {
        const indexVersion = this.scanVersion(projectId, expectedVersion);
        const targets = this.db.prepare(`
            SELECT id, qualified_name AS qualifiedName, file_path AS filePath, start_line AS startLine, end_line AS endLine,
                json_extract(payload, '$.rawSource') AS rawSource
            FROM unit WHERE project_id = ? AND kind IN ('METHOD', 'CONSTRUCTOR', 'FUNCTION')
                AND json_extract(payload, '$.metadata.bytecode') IS NOT 'true'
                AND length(trim(json_extract(payload, '$.rawSource'), char(9, 10, 13, 32))) > 0
            ORDER BY file_path, start_line, id LIMIT ? OFFSET ?
        `).iterate(projectId, MAX_CODE_CHECK_UNITS + 1, offset);
        const matches: CodeCheckMatch[] = [];
        let scannedUnits = 0, scannedBytes = 0;
        let nextOffset: number | null = null;
        for (const row of targets) {
            const target = row as unknown as Parameters<typeof checkCode>[0];
            const size = Buffer.byteLength(target.rawSource);
            if (scannedUnits >= MAX_CODE_CHECK_UNITS || scannedBytes + size > MAX_CODE_CHECK_BYTES) {
                nextOffset = offset + scannedUnits;
                break;
            }
            const found = checkCode(target);
            if (matches.length + found.length > MAX_CODE_CHECK_MATCHES) {
                nextOffset = offset + scannedUnits;
                break;
            }
            matches.push(...found);
            scannedUnits++;
            scannedBytes += size;
        }
        const newFindings = this.vulnerabilities.recordCodeMatches(projectId, matches, actor);
        return { projectId, scannedUnits, matchedFindings: matches.length, newFindings, nextOffset, indexVersion };
    }

    vulnerabilityVariants(projectId: string, limit: number) {
        if (!limit) return { candidates: [], truncated: false };
        const maxSeeds = 100;
        const seeds = this.vulnerabilities.variantSeeds(projectId, maxSeeds + 1);
        const result = findVulnerabilityVariants(this.db, projectId, seeds.slice(0, maxSeeds), limit,
            id => this.vulnerabilities.taintEvidence(id));
        return { ...result, truncated: result.truncated || seeds.length > maxSeeds };
    }

    scanTaint(projectId: string, offset: number, expectedVersion: string | null, actor: string) {
        const indexVersion = this.scanVersion(projectId, expectedVersion);
        const deadline = performance.now() + MAX_TAINT_BATCH_MS;
        const entries = this.db.prepare(`
            SELECT payload FROM unit
            WHERE project_id = ? AND language = 'java' AND kind = 'METHOD' AND is_test = 0
              AND json_extract(payload, '$.metadata.is_entry_point') = 'true'
              AND json_extract(payload, '$.metadata.bytecode') IS NOT 'true'
            ORDER BY file_path, start_line, id LIMIT ? OFFSET ?
        `).iterate(projectId, MAX_TAINT_ENTRIES + 1, offset);
        const load = this.projectUnits(projectId);
        const hits: TaintMatch[] = [];
        let inspected = 0, entryPoints = 0, pathsAnalyzed = 0, skippedSources = 0;
        let truncated = false;
        let nextOffset: number | null = null;
        for (const row of entries) {
            if (inspected >= MAX_TAINT_ENTRIES || (inspected > 0 && (hits.length >= MAX_TAINT_MATCHES || performance.now() > deadline))) {
                nextOffset = offset + inspected;
                break;
            }
            inspected++;
            const unit = readUnit(row);
            try {
                const parameters = requestParameters(unit);
                if (parameters === undefined) continue;
                entryPoints++;
                for (const [index, parameter] of parameters.entries()) {
                    if (index >= 21 || hits.length >= MAX_TAINT_MATCHES || performance.now() > deadline) {
                        truncated = true;
                        break;
                    }
                    const result = this.traceJavaUnit(unit, projectId, parameter, 6, load, deadline);
                    if (!result) { skippedSources++; continue; }
                    pathsAnalyzed += result.paths.length;
                    const matches = taintMatches(unit, result, load);
                    const remaining = MAX_TAINT_MATCHES - hits.length;
                    truncated ||= result.truncated || matches.length > remaining;
                    hits.push(...matches.slice(0, remaining));
                }
            } catch (error) {
                if (!(error instanceof HttpError) || (error.status !== 413 && error.message !== 'INVALID_PARAM_INDEX')) throw error;
                skippedSources++;
                truncated = true;
            }
        }
        const newFindings = this.vulnerabilities.recordTaintMatches(projectId, hits, actor);
        return { projectId, entryPoints, pathsAnalyzed, matchedFindings: hits.length, newFindings, skippedSources,
            truncated, nextOffset, indexVersion };
    }

    symbol(name: string, projectId: string | null) {
        return this.lookup(`
            SELECT payload FROM unit WHERE qualified_name = ? AND (? IS NULL OR project_id = ?)
            ORDER BY json_extract(payload, '$.metadata.is_declaration') IS 'true', project_id, file_path, start_line
        `, [name, projectId, projectId], projectId !== null);
    }

    private flowTarget(target: string, projectId: string | null, javaOnly = false) {
        const rows = this.db.prepare(`
            SELECT payload, project_id FROM unit
            WHERE (qualified_name = ? OR id = ?) AND (? IS NULL OR project_id = ?)
                AND kind IN ('METHOD','CONSTRUCTOR','FUNCTION')
                AND language IN ('java','c','python') AND (? = 0 OR language = 'java')
                AND json_extract(payload, '$.metadata.bytecode') IS NOT 'true'
                AND json_extract(payload, '$.metadata.is_declaration') IS NOT 'true'
            LIMIT 2
        `).all(target, target, projectId, projectId, Number(javaOnly));
        if (rows.length > 1) throw new HttpError(409, 'AMBIGUOUS_FLOW_TARGET');
        if (!rows[0]) return undefined;
        return { unit: readUnit(rows[0]), projectId: String(rows[0].project_id) };
    }

    private flowFields(unit: CodeUnit, projectId: string) {
        const fields = new Set<string>();
        if (unit.language === 'java' && unit.parentQualifiedName) {
            const declared = this.db.prepare(`
                SELECT json_extract(payload, '$.simpleName') AS name FROM unit
                WHERE project_id = ? AND file_path = ? AND kind = 'FIELD'
                    AND json_extract(payload, '$.parentQualifiedName') = ?
                    AND json_extract(payload, '$.metadata.is_static') IS NOT 'true'
            `).all(projectId, unit.filePath, unit.parentQualifiedName);
            for (const row of declared) fields.add(String(row.name));
        }
        return fields;
    }

    flow(target: string, projectId: string | null) {
        const source = this.flowTarget(target, projectId);
        return source && analyzeFlow(source.unit, this.flowFields(source.unit, source.projectId));
    }

    traceTaint(target: string, projectId: string | null, parameter: number, maxDepth: number) {
        const source = this.flowTarget(target, projectId, true);
        if (!source) return undefined;
        return this.traceJavaUnit(source.unit, source.projectId, parameter, maxDepth, this.projectUnits(source.projectId));
    }

    private projectUnits(projectId: string) {
        const find = this.db.prepare('SELECT payload FROM unit WHERE project_id = ? AND id = ?');
        return (id: string) => {
            const row = find.get(projectId, id);
            return row ? readUnit(row) : undefined;
        };
    }

    private traceJavaUnit(source: CodeUnit, projectId: string, parameter: number, maxDepth: number,
        load: (id: string) => CodeUnit | undefined, deadline?: number
    ) {
        return traceParameterFlow(source, parameter, maxDepth, (id, limit) => this.graph.callSites(projectId, id, limit),
            load, unit => this.flowFields(unit, projectId), deadline);
    }

    private graphTarget(target: string, projectId: string | null) {
        const rows = this.db.prepare(`
            SELECT candidate.id FROM unit candidate WHERE (candidate.qualified_name = ? OR candidate.id = ?)
                AND (? IS NULL OR candidate.project_id = ?)
                AND (candidate.id = ? OR json_extract(candidate.payload, '$.metadata.is_declaration') IS NOT 'true'
                    OR NOT EXISTS (
                        SELECT 1 FROM unit definition WHERE definition.project_id = candidate.project_id
                        AND definition.qualified_name = candidate.qualified_name
                        AND definition.language = candidate.language AND definition.kind = candidate.kind
                        AND json_extract(definition.payload, '$.metadata.is_declaration') IS NOT 'true'
                    ))
                LIMIT 2
        `).all(target, target, projectId, projectId, target);
        if (rows.length > 1) throw new HttpError(409, 'AMBIGUOUS_GRAPH_TARGET');
        return rows[0] ? String(rows[0].id) : undefined;
    }

    traverse(target: string, projectId: string | null, query: GraphQuery, depth: number) {
        const id = this.graphTarget(target, projectId);
        return id ? this.graph.traverse(id, query, depth) : [];
    }

    traverseView(target: string, projectId: string | null, query: GraphQuery, depth: number) {
        const id = this.graphTarget(target, projectId);
        return id ? this.graph.traverseView(id, query, depth) : null;
    }

    graphNeighbors(unitId: string, query: GraphQuery, depth: number, limit: number) {
        return this.graph.traverse(unitId, query, depth, limit);
    }

    authorizationEvidence(projectId: string, depth: number) {
        return springAuthorizationEvidence(this.db, this.graph, projectId, depth);
    }

    graphSymbols(query: string, projectId: string | null, limit: number) {
        return this.db.prepare(`
            SELECT payload FROM unit WHERE (? IS NULL OR project_id = ?)
                AND instr(lower(qualified_name), lower(?)) > 0
            ORDER BY instr(lower(qualified_name), lower(?)), length(qualified_name),
                qualified_name, project_id, file_path, start_line, id
            LIMIT ?
        `).all(projectId, projectId, query, query, limit).map(readUnit);
    }

    entryPoints(projectId: string | null, language: string | null, limit: number, offset: number) {
        return this.db.prepare(`
            SELECT payload FROM unit WHERE json_extract(payload, '$.metadata.is_entry_point') = 'true'
                AND (? IS NULL OR project_id = ?) AND (? IS NULL OR language = ?)
            ORDER BY project_id, file_path, start_line, id LIMIT ? OFFSET ?
        `).all(projectId, projectId, language, language, limit, offset).map(readUnit);
    }

    locate(path: string, line: number, projectId: string | null, archiveEntry: string | null = null) {
        return this.lookup(`
            SELECT payload FROM unit WHERE file_path = ? AND (? IS NULL OR project_id = ?)
                AND start_line <= ? AND end_line >= ?
                AND json_extract(payload, '$.metadata.archive_entry') IS ?
            ORDER BY end_line - start_line, length(json_extract(payload, '$.rawSource')), kind, id
        `, [path, projectId, projectId, line, line, archiveEntry], projectId !== null);
    }

    private lookup(sql: string, params: SQLInputValue[], scoped: boolean) {
        const rows = this.db.prepare(`${sql} LIMIT ?`).all(...params, scoped ? 1 : 2);
        if (rows.length > 1) throw new HttpError(409, 'AMBIGUOUS_RESULT_USE_PROJECT_ID');
        return rows[0] ? readUnit(rows[0]) : undefined;
    }

    search(
        query: string, projectId: string | null, language: string | null, kind: string | null, limit: number,
        noTest: boolean, allowed: readonly string[] | null = null
    ) {
        const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])].slice(0, 24);
        if (!terms.length) return [];
        const match = terms.map(term => `"${term}"`).join(' OR ');
        const scope = allowed === null ? null : JSON.stringify(allowed);
        const rows = this.db.prepare(`
            SELECT u.project_id, u.payload, bm25(unit_search, 8.0, 4.0, 1.0) AS rank
            FROM unit_search JOIN unit u ON unit_search.rowid = u.rowid
            WHERE unit_search MATCH ? AND (? IS NULL OR u.project_id = ?) AND (? IS NULL OR u.language = ?)
                AND (? IS NULL OR u.kind = ?) AND (? = 0 OR u.is_test = 0)
                AND (? IS NULL OR u.project_id IN (SELECT value FROM json_each(?)))
            ORDER BY rank, u.id LIMIT ?
        `).all(match, projectId, projectId, language, language, kind, kind, Number(noTest), scope, scope, limit);
        return rows.map(row => {
            const unit = readUnit(row);
            const tokens = new Set(`${unit.qualifiedName} ${unit.signature} ${unit.rawSource}`.toLowerCase().match(/[\p{L}\p{N}_]+/gu));
            const rank = Math.max(0, -Number(row.rank));
            return {
                projectId: String(row.project_id), unit, score: rank / (1 + rank),
                matchedTerms: terms.filter(term => tokens.has(term))
            };
        });
    }
}
