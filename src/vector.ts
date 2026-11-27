import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path/posix';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from './http-error.js';
import type { CodeUnit, IndexedSource } from './source.js';

const BATCH_SIZE = 16;
const MAX_INPUT_CHARS = 16_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const PROFILE_FORMAT = 'described-declarations-source-passages-v3';
const SEMANTIC_SOURCE_WEIGHT = 0.2;
const PASSAGE_CHARS = 480;
const PASSAGE_COUNT = 3;

export type VectorMode = 'semantic' | 'code';

export interface VectorSearchOptions {
    projectId: string | null;
    snapshotId?: string;
    allowedProjects?: () => readonly string[] | null;
    language: string | null;
    kind: string | null;
    noTest: boolean;
    entryOnly: boolean;
    limit: number;
    offset: number;
}

export interface VectorEntry {
    id: string;
    semantic: Buffer;
    code: Buffer;
    passages: Buffer[];
}

export class EmbeddingUnavailable extends Error {
    constructor(readonly code: 'EMBEDDING_DISABLED' | 'EMBEDDING_UNAVAILABLE') {
        super(code);
    }
}

function unavailable() {
    return new EmbeddingUnavailable('EMBEDDING_UNAVAILABLE');
}

function modelTag(name: string) {
    return name.slice(name.lastIndexOf('/') + 1).includes(':') ? name : `${name}:latest`;
}

function words(identifier: string) {
    return identifier.replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/[_.-]+/g, ' ').trim();
}

function semanticText(unit: CodeUnit, parent: CodeUnit | undefined, documentation?: ReadonlyMap<string, string>) {
    if (unit.kind === 'DOCUMENT') return unit.rawSource;
    const file = basename(unit.filePath, extname(unit.filePath));
    const subject = `${unit.language} ${unit.kind.toLowerCase().replaceAll('_', ' ')} ${words(unit.simpleName)} in ${words(file)}.`;
    const parentText = parent ? [`Declared in ${words(parent.simpleName)}.`, documentation?.get(parent.id),
        ...parent.annotations, parent.signature] : [];
    return [documentation?.get(unit.id), subject, ...unit.annotations, unit.signature, ...parentText].filter(Boolean).join('\n');
}

function codePassages(unit: CodeUnit) {
    if (unit.kind === 'DOCUMENT') return [];
    const source = unit.rawSource.slice(0, MAX_INPUT_CHARS);
    if (source.length <= PASSAGE_CHARS) return [];
    const passages = new Set<string>();
    if (['METHOD', 'CONSTRUCTOR', 'FUNCTION'].includes(unit.kind)) {
        const signature = unit.signature.trim();
        if (signature.length && signature.length <= PASSAGE_CHARS) passages.add(signature);
    }
    const count = Math.min(PASSAGE_COUNT, Math.ceil(source.length / PASSAGE_CHARS));
    for (let index = 0; index < count; index++) {
        const offset = Math.floor((source.length - PASSAGE_CHARS) * index / (count - 1));
        const nextLine = offset ? source.indexOf('\n', offset) : -1;
        const start = nextLine >= offset && nextLine - offset < 80 && source.length - nextLine > 80 ? nextLine + 1 : offset;
        const end = Math.min(source.length, start + PASSAGE_CHARS);
        const lineEnd = source.lastIndexOf('\n', end - 1);
        const passage = source.slice(start, end < source.length && lineEnd > end - 80 ? lineEnd : end)
            .replace(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/g, '').trim();
        if (passage) passages.add(passage);
    }
    return [...passages];
}

function normalizedVector(value: unknown, dimensions: number) {
    if (!Array.isArray(value) || value.length !== dimensions
        || !value.every(component => typeof component === 'number' && Number.isFinite(component))) {
        throw unavailable();
    }
    const norm = Math.hypot(...value);
    if (!Number.isFinite(norm) || norm === 0) throw unavailable();
    const result = Buffer.allocUnsafe(dimensions * 4);
    for (let i = 0; i < dimensions; i++) result.writeFloatLE(value[i] / norm, i * 4);
    return result;
}

async function readResponse(response: Response): Promise<unknown> {
    if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw unavailable();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw unavailable();
            }
            chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
    } finally {
        reader.releaseLock();
    }
}

export class OllamaEmbedding {
    readonly profile: string;
    readonly retrievalProfile: { model: string; dimensions: number; profile: string };

    private constructor(private readonly url: URL, private readonly model: string, private readonly dimensions: number,
        private readonly queryPrefix: string) {
        this.profile = createHash('sha256')
            .update(JSON.stringify([PROFILE_FORMAT, url.href, modelTag(model), dimensions])).digest('hex');
        this.retrievalProfile = { model: modelTag(model), dimensions,
            profile: createHash('sha256').update(JSON.stringify([this.profile, queryPrefix, SEMANTIC_SOURCE_WEIGHT])).digest('hex') };
    }

    static fromEnvironment(env: NodeJS.ProcessEnv) {
        if (env.REPOGRAPH_EMBEDDING_MODEL === undefined) return undefined;
        const model = env.REPOGRAPH_EMBEDDING_MODEL.trim();
        const url = new URL(env.REPOGRAPH_EMBEDDING_URL ?? 'http://127.0.0.1:11434');
        const dimensions = Number(env.REPOGRAPH_EMBEDDING_DIMENSIONS);
        const queryPrefix = env.REPOGRAPH_EMBEDDING_QUERY_PREFIX?.trim() ?? '';
        if (!model || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
            || !Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 8192 || queryPrefix.length > 1024
            || queryPrefix.includes('\0')) {
            throw new Error('Invalid Ollama embedding configuration');
        }
        url.pathname = `${url.pathname.replace(/\/$/, '')}/api/embed`;
        return new OllamaEmbedding(url, model, dimensions, queryPrefix);
    }

    async embedQuery(mode: VectorMode, query: string, signal?: AbortSignal) {
        const input = mode === 'semantic' && this.queryPrefix ? `${this.queryPrefix} ${query}` : query;
        const [vector] = await this.embed([input], signal);
        return vector;
    }

    async available(signal: AbortSignal) {
        try {
            const response = await fetch(new URL('tags', this.url), {
                redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(3000)])
            });
            await response.body?.cancel();
            return response.ok;
        } catch { return false; }
    }

    async embed(inputs: string[], signal?: AbortSignal, onBatch?: (completedInputs: number) => void,
        beforeSend?: (timeoutMs: number) => () => void) {
        const vectors: Buffer[] = [];
        for (let offset = 0; offset < inputs.length; offset += BATCH_SIZE) {
            const input = inputs.slice(offset, offset + BATCH_SIZE);
            const timeoutMs = 10_000;
            signal?.throwIfAborted();
            const settle = beforeSend?.(timeoutMs);
            const deadline = AbortSignal.timeout(timeoutMs);
            try {
                const response = await fetch(this.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: this.model, input, dimensions: this.dimensions, truncate: true }),
                    redirect: 'error',
                    signal: signal ? AbortSignal.any([signal, deadline]) : deadline
                });
                const body = await readResponse(response) as { model?: unknown; embeddings?: unknown };
                if (typeof body?.model !== 'string' || modelTag(body.model) !== modelTag(this.model)
                    || !Array.isArray(body.embeddings) || body.embeddings.length !== input.length) {
                    throw unavailable();
                }
                for (const vector of body.embeddings) vectors.push(normalizedVector(vector, this.dimensions));
            } catch {
                throw unavailable();
            } finally { settle?.(); }
            onBatch?.(vectors.length);
        }
        return vectors;
    }
}

export class VectorIndex {
    constructor(private readonly db: DatabaseSync, private readonly embedding?: OllamaEmbedding) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS embedded_file (
                project_id TEXT NOT NULL, file_path TEXT NOT NULL, profile TEXT NOT NULL,
                PRIMARY KEY(project_id, file_path),
                FOREIGN KEY(project_id, file_path) REFERENCES indexed_file(project_id, path) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS embedded_file_profile ON embedded_file(profile, project_id, file_path);
            CREATE TABLE IF NOT EXISTS unit_vector (
                unit_id TEXT PRIMARY KEY REFERENCES unit(id) ON DELETE CASCADE,
                semantic BLOB NOT NULL, code BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS unit_code_passage (
                unit_id TEXT NOT NULL REFERENCES unit_vector(unit_id) ON DELETE CASCADE,
                position INTEGER NOT NULL, vector BLOB NOT NULL,
                PRIMARY KEY(unit_id, position)
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS knowledge_vector_profile (
                snapshot_id TEXT PRIMARY KEY REFERENCES knowledge_snapshot(id) ON DELETE CASCADE,
                retrieval_profile TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS knowledge_vector (
                snapshot_id TEXT NOT NULL, unit_id TEXT NOT NULL, semantic BLOB NOT NULL, code BLOB NOT NULL,
                PRIMARY KEY(snapshot_id, unit_id),
                FOREIGN KEY(snapshot_id, unit_id) REFERENCES knowledge_unit(snapshot_id, id) ON DELETE CASCADE
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS knowledge_code_passage (
                snapshot_id TEXT NOT NULL, unit_id TEXT NOT NULL, position INTEGER NOT NULL, vector BLOB NOT NULL,
                PRIMARY KEY(snapshot_id, unit_id, position),
                FOREIGN KEY(snapshot_id, unit_id) REFERENCES knowledge_vector(snapshot_id, unit_id) ON DELETE CASCADE
            ) WITHOUT ROWID;
        `);
        db.function('vector_similarity', { deterministic: true }, (left, right) => {
            if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) {
                throw new Error('Invalid stored embedding shape');
            }
            const a = new DataView(left.buffer, left.byteOffset, left.length);
            const b = new DataView(right.buffer, right.byteOffset, right.length);
            let similarity = 0;
            for (let i = 0; i < left.length; i += 4) similarity += a.getFloat32(i, true) * b.getFloat32(i, true);
            return similarity;
        });
    }

    get enabled() { return this.embedding !== undefined; }

    completedFiles(projectId: string) {
        if (!this.embedding) return new Set<string>();
        return new Set(this.db.prepare('SELECT file_path FROM embedded_file WHERE project_id = ? AND profile = ?')
            .all(projectId, this.embedding.profile).map(row => String(row.file_path)));
    }

    async prepare(indexed: IndexedSource, signal?: AbortSignal, progress?: (done: number, total: number) => void,
        beforeSend?: (timeoutMs: number) => () => void): Promise<VectorEntry[]> {
        if (!this.embedding) throw new EmbeddingUnavailable('EMBEDDING_DISABLED');
        const { units, documentation } = indexed;
        const byName = new Map(units.map(unit => [unit.qualifiedName, unit]));
        const inputs = new Map<string, number>();
        const inputIndex = (text: string) => {
            const source = text.slice(0, MAX_INPUT_CHARS);
            const existing = inputs.get(source);
            if (existing !== undefined) return existing;
            const index = inputs.size;
            inputs.set(source, index);
            return index;
        };
        const unitsWithInputs = units.map(unit => {
            const parent = unit.parentQualifiedName ? byName.get(unit.parentQualifiedName) : undefined;
            const semantic = semanticText(unit, parent, documentation);
            return { id: unit.id, semantic: inputIndex(semantic), code: inputIndex(unit.rawSource),
                passages: codePassages(unit).map(inputIndex) };
        });
        const readyAt = new Uint32Array(inputs.size);
        for (const { semantic, code, passages } of unitsWithInputs) readyAt[Math.max(semantic, code, ...passages)]++;
        let completedInputs = 0;
        let completedUnits = 0;
        if (units.length) progress?.(0, units.length);
        const vectors = await this.embedding.embed([...inputs.keys()], signal, done => {
            while (completedInputs < done) completedUnits += readyAt[completedInputs++];
            progress?.(completedUnits, units.length);
        }, beforeSend);
        return unitsWithInputs.map(unit => ({ id: unit.id, semantic: vectors[unit.semantic], code: vectors[unit.code],
            passages: unit.passages.map(index => vectors[index]) }));
    }

    put(projectId: string, file: string, entries: VectorEntry[]) {
        if (!this.embedding) throw new EmbeddingUnavailable('EMBEDDING_DISABLED');
        const statement = this.db.prepare('INSERT INTO unit_vector VALUES (?, ?, ?)');
        const passage = this.db.prepare('INSERT INTO unit_code_passage VALUES (?, ?, ?)');
        for (const entry of entries) {
            statement.run(entry.id, entry.semantic, entry.code);
            for (const [position, vector] of entry.passages.entries()) passage.run(entry.id, position, vector);
        }
        this.db.prepare('INSERT INTO embedded_file VALUES (?, ?, ?)').run(projectId, file, this.embedding.profile);
    }

    freezeSnapshot(projectId: string, snapshotId: string) {
        if (!this.embedding) return;
        const { profile, dimensions } = this.embedding.retrievalProfile;
        const bytes = dimensions * 4;
        const missing = this.db.prepare(`
            SELECT 1 FROM knowledge_unit u
            LEFT JOIN embedded_file f ON f.project_id = ? AND f.file_path = u.file_path AND f.profile = ?
            LEFT JOIN unit_vector v ON v.unit_id = u.id AND length(v.semantic) = ? AND length(v.code) = ?
            WHERE u.snapshot_id = ? AND (f.project_id IS NULL OR v.unit_id IS NULL OR EXISTS (
                SELECT 1 FROM unit_code_passage p WHERE p.unit_id = u.id AND length(p.vector) <> ?
            )) LIMIT 1
        `).get(projectId, this.embedding.profile, bytes, bytes, snapshotId, bytes);
        if (missing) throw new HttpError(409, 'WIKI_SNAPSHOT_VECTOR_INCOMPLETE');
        this.db.prepare(`
            INSERT INTO knowledge_vector SELECT u.snapshot_id, v.unit_id, v.semantic, v.code
            FROM knowledge_unit u JOIN unit_vector v ON v.unit_id = u.id WHERE u.snapshot_id = ?
        `).run(snapshotId);
        this.db.prepare(`
            INSERT INTO knowledge_code_passage SELECT v.snapshot_id, p.unit_id, p.position, p.vector
            FROM knowledge_vector v JOIN unit_code_passage p ON p.unit_id = v.unit_id WHERE v.snapshot_id = ?
        `).run(snapshotId);
        this.db.prepare('INSERT INTO knowledge_vector_profile VALUES (?, ?)').run(snapshotId, profile);
    }

    async search(mode: VectorMode, query: string, options: VectorSearchOptions, signal?: AbortSignal) {
        const { projectId, snapshotId, language, kind, noTest, entryOnly, limit, offset } = options;
        if (options.allowedProjects?.()?.length === 0) return { results: [], offset, limit, hasMore: false };
        if (snapshotId) {
            const profile = this.db.prepare('SELECT retrieval_profile FROM knowledge_vector_profile WHERE snapshot_id = ?').get(snapshotId);
            if (!profile || profile.retrieval_profile !== this.embedding?.retrievalProfile.profile) {
                throw new HttpError(409, 'SNAPSHOT_VECTOR_INDEX_UNAVAILABLE');
            }
        }
        if (!this.embedding) throw new EmbeddingUnavailable('EMBEDDING_DISABLED');
        const embedding = await this.embedding.embedQuery(mode, query, signal);
        const allowed = options.allowedProjects?.() ?? null;
        const scope = allowed === null ? null : JSON.stringify(allowed);
        const passages = snapshotId ? 'knowledge_code_passage p WHERE p.unit_id = v.unit_id AND p.snapshot_id = v.snapshot_id'
            : 'unit_code_passage p WHERE p.unit_id = v.unit_id';
        const similarity = mode === 'semantic' ? `
            ${1 - SEMANTIC_SOURCE_WEIGHT} * vector_similarity(v.semantic, query.vector)
                + ${SEMANTIC_SOURCE_WEIGHT} * vector_similarity(v.code, query.vector)
        ` : `
            max(vector_similarity(v.code, query.vector), coalesce(
                (SELECT max(vector_similarity(p.vector, query.vector)) FROM ${passages}), -1
            ))
        `;
        const subject = snapshotId ? 'knowledge_unit' : 'unit';
        const source = snapshotId ? `
                FROM knowledge_snapshot f
                JOIN knowledge_unit u ON u.snapshot_id = f.id
                JOIN knowledge_vector v ON v.snapshot_id = u.snapshot_id AND v.unit_id = u.id
                CROSS JOIN query WHERE f.id = ? AND f.published_at IS NOT NULL
        ` : `
                FROM embedded_file f
                JOIN unit u ON u.project_id = f.project_id AND u.file_path = f.file_path
                JOIN unit_vector v ON v.unit_id = u.id
                CROSS JOIN query WHERE f.profile = ?
        `;
        const rows = this.db.prepare(`
            WITH query(vector) AS (VALUES (?))
            SELECT u.payload, ranked.project_id, ranked.score
            FROM (
                SELECT u.rowid AS rowId, u.id, f.project_id, ${similarity} AS score ${source}
                    AND (? IS NULL OR f.project_id = ?) AND (? IS NULL OR u.language = ?)
                    AND (? IS NULL OR u.kind = ?) AND (? = 0 OR ${snapshotId ? "json_extract(u.payload, '$.metadata.is_test') IS NOT 'true'" : 'u.is_test = 0'})
                    AND (? = 0 OR json_extract(u.payload, '$.metadata.is_entry_point') = 'true')
                    AND (? IS NULL OR f.project_id IN (SELECT value FROM json_each(?)))
                ORDER BY score DESC, u.id LIMIT ? OFFSET ?
            ) ranked JOIN ${subject} u ON u.rowid = ranked.rowId
            ORDER BY ranked.score DESC, ranked.id
        `).all(embedding, snapshotId ?? this.embedding.profile, projectId, projectId, language, language, kind, kind,
            Number(noTest), Number(entryOnly), scope, scope, limit + 1, offset);
        const results = rows.slice(0, limit).map(row => ({
            unit: JSON.parse(String(row.payload)) as CodeUnit,
            score: Math.max(0, Math.min(1, Number(row.score))),
            projectId: String(row.project_id), ...(snapshotId ? { snapshotId } : {})
        }));
        return { results, offset, limit, hasMore: rows.length > limit };
    }
}
