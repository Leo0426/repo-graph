import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CodeUnit } from './source.js';
import { digest, isJar } from './source.js';
import { HttpError } from './http-error.js';
import { availableProject } from './project-retirement.js';
import type { GitOrigin } from './git-sources.js';
import type { ArchiveOrigin } from './archive-objects.js';
import type { DependencyReviewCheck } from './dependency-advisories.js';
import type { SummaryCitation } from './wiki-facts.js';
import type { SummaryDocument } from './wiki.js';

export type SnapshotMode = 'full' | 'incremental';
type SnapshotSource = GitOrigin | ArchiveOrigin;
type Manifest = readonly { path: string; hash: string; indexHash: string }[];
export type SourceChange = { kind: 'ADDED' | 'MODIFIED' | 'DELETED' | 'MOVED' | 'REINDEXED'; path: string; previousPath?: string };
export type PublicationProfile = { version: 1; wikiTemplateVersion: number; inputFactsVersion: number; budgetMs: number;
    model: { id: string; revision: string; name: string } | null;
    modelPlan?: { maxOutputTokensPerCall: number; estimatedCostLimitUsd: number; publicationReserveMs: number;
        tracks: { perspective: 'technical' | 'business'; phases: string[] }[] } };

interface PublishedKnowledgeSnapshot {
    id: string;
    projectId: string;
    runId: string;
    sourceVersion: string;
    createdAt: string;
    publishedAt: string;
    parentSnapshotId: string | null;
    mode: SnapshotMode;
    source?: SnapshotSource;
}

function publishedSnapshot(row: Record<string, unknown>): PublishedKnowledgeSnapshot {
    return {
        id: String(row.id), projectId: String(row.project_id), runId: String(row.run_id),
        sourceVersion: String(row.source_version), createdAt: String(row.created_at), publishedAt: String(row.published_at),
        parentSnapshotId: row.parent_id === null ? null : String(row.parent_id), mode: row.parent_id === null ? 'full' : 'incremental',
        ...(row.origin ? { source: JSON.parse(String(row.origin)) as SnapshotSource } : {})
    };
}

export function sourceChanges(before: Manifest, after: Manifest) {
    const current = new Map(after.map(item => [item.path, item]));
    const previous = new Map(before.map(item => [item.path, item]));
    const added = after.filter(item => !previous.has(item.path));
    const removed = before.filter(item => !current.has(item.path));
    const changes: SourceChange[] = [];
    const filesByHash = (manifest: Manifest) => {
        const buckets = new Map<string, string[]>();
        for (const { hash, path } of manifest) {
            const bucket = buckets.get(hash);
            if (bucket) bucket.push(path);
            else buckets.set(hash, [path]);
        }
        return buckets;
    };
    const deletedByHash = filesByHash(removed);
    const addedByHash = filesByHash(added);
    const moved = new Set<string>();
    for (const item of added) {
        const from = deletedByHash.get(item.hash);
        if (from?.length === 1 && addedByHash.get(item.hash)?.length === 1) {
            changes.push({ kind: 'MOVED', path: item.path, previousPath: from[0] });
            moved.add(from[0]);
        } else changes.push({ kind: 'ADDED', path: item.path });
    }
    for (const { path } of removed) if (!moved.has(path)) changes.push({ kind: 'DELETED', path });
    for (const old of before) {
        const next = current.get(old.path);
        if (!next) continue;
        if (next.hash !== old.hash) changes.push({ kind: 'MODIFIED', path: next.path });
        else if (next.indexHash !== old.indexHash) changes.push({ kind: 'REINDEXED', path: next.path });
    }
    return changes;
}

export class KnowledgeSnapshots {
    constructor(private readonly db: DatabaseSync, private readonly freezeVectors: (projectId: string, snapshotId: string) => void,
        private readonly sourceOrigin: (projectId: string, snapshotId: string) => SnapshotSource | undefined) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS knowledge_blob (
                hash TEXT PRIMARY KEY, content BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS indexed_source (
                project_id TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL REFERENCES knowledge_blob(hash),
                PRIMARY KEY(project_id, path),
                FOREIGN KEY(project_id, path) REFERENCES indexed_file(project_id, path) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS indexed_source_hash ON indexed_source(hash);
            CREATE TABLE IF NOT EXISTS knowledge_snapshot (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                run_id TEXT NOT NULL UNIQUE REFERENCES agent_run(id) ON DELETE CASCADE,
                source_version TEXT NOT NULL, created_at TEXT NOT NULL, published_at TEXT
            );
            CREATE INDEX IF NOT EXISTS knowledge_snapshot_project ON knowledge_snapshot(project_id, published_at);
            CREATE TABLE IF NOT EXISTS knowledge_receipt (
                snapshot_id TEXT PRIMARY KEY REFERENCES knowledge_snapshot(id) ON DELETE CASCADE,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS knowledge_origin (
                snapshot_id TEXT PRIMARY KEY REFERENCES knowledge_snapshot(id) ON DELETE CASCADE, origin TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS indexed_dependency_check (
                project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE, payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS knowledge_dependency_check (
                snapshot_id TEXT PRIMARY KEY REFERENCES knowledge_snapshot(id) ON DELETE CASCADE, payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS knowledge_lineage (
                snapshot_id TEXT PRIMARY KEY REFERENCES knowledge_snapshot(id) ON DELETE CASCADE,
                parent_id TEXT REFERENCES knowledge_snapshot(id) DEFERRABLE INITIALLY DEFERRED
            );
            CREATE TABLE IF NOT EXISTS knowledge_change (
                snapshot_id TEXT NOT NULL REFERENCES knowledge_snapshot(id) ON DELETE CASCADE,
                path TEXT NOT NULL, kind TEXT NOT NULL, previous_path TEXT, PRIMARY KEY(snapshot_id, path)
            );
            CREATE TABLE IF NOT EXISTS knowledge_source (
                snapshot_id TEXT NOT NULL REFERENCES knowledge_snapshot(id) ON DELETE CASCADE,
                path TEXT NOT NULL, index_hash TEXT NOT NULL, hash TEXT NOT NULL REFERENCES knowledge_blob(hash),
                PRIMARY KEY(snapshot_id, path)
            );
            CREATE INDEX IF NOT EXISTS knowledge_source_hash ON knowledge_source(hash);
            CREATE TABLE IF NOT EXISTS knowledge_unit (
                snapshot_id TEXT NOT NULL, id TEXT NOT NULL, file_path TEXT NOT NULL, qualified_name TEXT NOT NULL,
                kind TEXT NOT NULL, language TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL,
                payload TEXT NOT NULL, PRIMARY KEY(snapshot_id, id),
                FOREIGN KEY(snapshot_id, file_path) REFERENCES knowledge_source(snapshot_id, path) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS knowledge_unit_location ON knowledge_unit(snapshot_id, file_path, start_line, end_line);
            CREATE INDEX IF NOT EXISTS knowledge_unit_name ON knowledge_unit(snapshot_id, qualified_name);
            CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_unit_search USING fts5(
                name, signature, source, tokenize="unicode61 tokenchars '_'"
            );
            CREATE TRIGGER IF NOT EXISTS knowledge_unit_index AFTER INSERT ON knowledge_unit BEGIN
                INSERT INTO knowledge_unit_search(rowid, name, signature, source)
                    VALUES (new.rowid, new.qualified_name, json_extract(new.payload, '$.signature'), json_extract(new.payload, '$.rawSource'));
            END;
            CREATE TRIGGER IF NOT EXISTS knowledge_unit_unindex AFTER DELETE ON knowledge_unit BEGIN
                DELETE FROM knowledge_unit_search WHERE rowid = old.rowid;
            END;
            CREATE TABLE IF NOT EXISTS knowledge_relation (
                snapshot_id TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL,
                PRIMARY KEY(snapshot_id, source_id, target_id, kind, line),
                FOREIGN KEY(snapshot_id, source_id) REFERENCES knowledge_unit(snapshot_id, id) ON DELETE CASCADE,
                FOREIGN KEY(snapshot_id, target_id) REFERENCES knowledge_unit(snapshot_id, id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS knowledge_relation_target ON knowledge_relation(snapshot_id, target_id, kind, source_id);
            CREATE TRIGGER IF NOT EXISTS indexed_source_gc AFTER DELETE ON indexed_source BEGIN
                DELETE FROM knowledge_blob WHERE hash = old.hash
                    AND NOT EXISTS(SELECT 1 FROM indexed_source WHERE hash = old.hash)
                    AND NOT EXISTS(SELECT 1 FROM knowledge_source WHERE hash = old.hash);
            END;
            CREATE TRIGGER IF NOT EXISTS knowledge_source_gc AFTER DELETE ON knowledge_source BEGIN
                DELETE FROM knowledge_blob WHERE hash = old.hash
                    AND NOT EXISTS(SELECT 1 FROM indexed_source WHERE hash = old.hash)
                    AND NOT EXISTS(SELECT 1 FROM knowledge_source WHERE hash = old.hash);
            END;
        `);
    }

    // Index mutations call this in the same transaction as the indexed file row.
    remember(projectId: string, path: string, hash: string, bytes: Uint8Array) {
        this.db.prepare('INSERT OR IGNORE INTO knowledge_blob VALUES (?, ?)').run(hash, bytes);
        this.db.prepare('INSERT INTO indexed_source VALUES (?, ?, ?)').run(projectId, path, hash);
    }

    // Capture the source manifest in the same transaction as the job and its facts.
    freeze(projectId: string, runId: string, requestedMode: SnapshotMode) {
        const rows = this.db.prepare(`
            SELECT f.path, f.hash AS index_hash, s.hash
            FROM indexed_file f LEFT JOIN indexed_source s USING (project_id, path)
            WHERE f.project_id = ? ORDER BY f.path
        `).all(projectId);
        // A legacy index may predate source retention. A verified reindex fills it in.
        if (rows.some(row => row.hash === null)) return null;
        const id = randomUUID();
        const parent = requestedMode === 'incremental' ? this.list(projectId, 1, 0)[0] : undefined;
        const manifest = rows.map(row => ({ path: String(row.path), hash: String(row.hash), indexHash: String(row.index_hash) }));
        const sourceVersion = digest(JSON.stringify(manifest.map(row => [row.path, row.hash])));
        this.db.prepare('INSERT INTO knowledge_snapshot VALUES (?, ?, ?, ?, ?, NULL)')
            .run(id, projectId, runId, sourceVersion, new Date().toISOString());
        const origin = this.sourceOrigin(projectId, id);
        if (origin) this.db.prepare('INSERT INTO knowledge_origin VALUES (?, ?)').run(id, JSON.stringify(origin));
        this.db.prepare('INSERT INTO knowledge_dependency_check SELECT ?, payload FROM indexed_dependency_check WHERE project_id = ?')
            .run(id, projectId);
        const file = this.db.prepare('INSERT INTO knowledge_source VALUES (?, ?, ?, ?)');
        for (const item of manifest) file.run(id, item.path, item.indexHash, item.hash);
        this.db.prepare('INSERT INTO knowledge_lineage VALUES (?, ?)').run(id, parent?.id ?? null);
        const baseline = parent ? this.db.prepare(`
            SELECT path, hash, index_hash FROM knowledge_source WHERE snapshot_id = ? ORDER BY path
        `).all(parent.id).map(row => ({ path: String(row.path), hash: String(row.hash), indexHash: String(row.index_hash) })) : [];
        const change = this.db.prepare('INSERT INTO knowledge_change VALUES (?, ?, ?, ?)');
        for (const item of sourceChanges(baseline, manifest)) change.run(id, item.path, item.kind, item.previousPath ?? null);
        if (parent) this.db.prepare(`
            INSERT INTO knowledge_unit
                SELECT ?, u.id, u.file_path, u.qualified_name, u.kind, u.language, u.start_line, u.end_line, u.payload
                FROM knowledge_unit u
                JOIN knowledge_source old ON old.snapshot_id = u.snapshot_id AND old.path = u.file_path
                JOIN knowledge_source fresh ON fresh.snapshot_id = ? AND fresh.path = old.path AND fresh.index_hash = old.index_hash
                WHERE u.snapshot_id = ?
        `).run(id, id, parent.id);
        this.db.prepare(`
            INSERT INTO knowledge_unit SELECT ?, id, file_path, qualified_name, kind, language, start_line, end_line, payload
            FROM unit u WHERE project_id = ? AND NOT EXISTS (
                SELECT 1 FROM knowledge_source fresh JOIN knowledge_source old
                    ON old.snapshot_id = ? AND old.path = fresh.path AND old.index_hash = fresh.index_hash
                WHERE fresh.snapshot_id = ? AND fresh.path = u.file_path
            )
        `).run(id, projectId, parent?.id ?? null, id);
        this.db.prepare(`
            INSERT OR IGNORE INTO knowledge_relation
            SELECT ?, r.source_id, r.target_id, r.kind, r.line FROM code_relation r
            JOIN unit s ON s.id = r.source_id AND s.project_id = ?
            JOIN unit t ON t.id = r.target_id AND t.project_id = ?
        `).run(id, projectId, projectId);
        this.freezeVectors(projectId, id);
        return { id, mode: parent ? 'incremental' as const : 'full' as const };
    }

    publish(id: string, at: string, pages: SummaryDocument[], profile?: PublicationProfile) {
        for (const page of pages) this.validateCitations(id, page.citations);
        if (profile) this.recordReceipt(id, profile, pages);
        const result = this.db.prepare('UPDATE knowledge_snapshot SET published_at = ? WHERE id = ? AND published_at IS NULL').run(at, id);
        if (!result.changes) throw new HttpError(409, 'WIKI_SNAPSHOT_NOT_PENDING');
    }

    private recordReceipt(id: string, profile: PublicationProfile, pages: SummaryDocument[]) {
        const projections = profile.modelPlan?.tracks ?? [];
        for (const track of projections) {
            const roots = pages.filter(page => page.level === 'PROJECT' && (page.perspective ?? 'technical') === track.perspective);
            const root = roots[0];
            if (!root || roots.length !== 1) throw new HttpError(409, 'WIKI_SNAPSHOT_PERSPECTIVE_INCOMPLETE');
            const accepted = root.sections.flatMap(section => section.source === 'llm' ? [section.phase] : []);
            const known = new Set(accepted);
            if (known.size !== accepted.length || accepted.some(phase => !phase || !track.phases.includes(phase))
                || track.phases.some(phase => !known.has(phase) && (root.status !== 'PARTIAL'
                    || !root.missingInfo.some(omission => omission.endsWith(':' + phase))))) {
                throw new HttpError(409, 'WIKI_SNAPSHOT_MODEL_COVERAGE_INCOMPLETE');
            }
        }
        const indexed = this.db.prepare(`SELECT 1 FROM wiki_page_search_entry entry JOIN wiki_page_terms terms ON terms.rowid = entry.rowid
            JOIN wiki_document w ON w.id = entry.page_id
            WHERE entry.id = ? AND entry.page_id = ? AND json_extract(w.payload, '$.knowledgeSnapshotId') = ?`);
        const pageManifest = pages.map(page => {
            if (!indexed.get(page.id, page.id, id)) throw new HttpError(409, 'WIKI_SNAPSHOT_PAGE_INDEX_INCOMPLETE');
            return { id: page.id, scopeId: page.scopeId, level: page.level, title: page.title, status: page.status,
                perspective: page.perspective ?? 'technical', sections: page.sections.length, citations: page.citations.length,
                ...(profile.wikiTemplateVersion >= 2 ? { modelPhases: page.sections.flatMap(section =>
                    section.source === 'llm' && section.phase ? [section.phase] : []) } : {}),
                omissions: page.missingInfo };
        });
        const technical = pageManifest.filter(page => page.perspective === 'technical');
        const business = pageManifest.filter(page => page.perspective === 'business');
        const scope = (page: typeof pageManifest[number]) => JSON.stringify([page.level, page.scopeId]);
        const technicalScopes = new Set(technical.map(scope));
        if (!technical.some(page => page.level === 'PROJECT') || technical.length !== technicalScopes.size
            || business.length !== technicalScopes.size || new Set(business.map(scope)).size !== technicalScopes.size
            || business.some(page => !technicalScopes.has(scope(page)))) {
            throw new HttpError(409, 'WIKI_SNAPSHOT_PERSPECTIVE_INCOMPLETE');
        }
        const coverage = this.db.prepare(`SELECT
            (SELECT count(*) FROM knowledge_source WHERE snapshot_id = ?) AS files,
            (SELECT count(*) FROM knowledge_unit WHERE snapshot_id = ?) AS symbols,
            (SELECT count(*) FROM knowledge_relation WHERE snapshot_id = ?) AS relations,
            (SELECT count(*) FROM knowledge_vector WHERE snapshot_id = ?) AS vectors,
            (SELECT retrieval_profile FROM knowledge_vector_profile WHERE snapshot_id = ?) AS vectorProfile
        `).get(id, id, id, id, id)!;
        if (coverage.vectorProfile !== null && coverage.vectors !== coverage.symbols) {
            throw new HttpError(409, 'WIKI_SNAPSHOT_VECTOR_INCOMPLETE');
        }
        this.db.prepare('INSERT INTO knowledge_receipt VALUES (?, ?)').run(id, JSON.stringify({
            status: 'VERIFIED', snapshotId: id, profile, coverage, pages: pageManifest
        }));
    }

    receipt(id: string) {
        const row = this.db.prepare('SELECT payload FROM knowledge_receipt WHERE snapshot_id = ?').get(id);
        return row ? JSON.parse(String(row.payload)) as unknown : { status: 'LEGACY_UNRECORDED', snapshotId: id };
    }

    validateCitations(id: string, citations: readonly SummaryCitation[]) {
        const hasCitation = this.db.prepare(`
            SELECT 1 FROM knowledge_unit WHERE snapshot_id = ? AND file_path = ?
                AND qualified_name = ? AND start_line = ? AND end_line = ? LIMIT 1
        `);
        for (const citation of citations) {
            if (!hasCitation.get(id, citation.filePath, citation.qualifiedName, citation.startLine, citation.endLine)) {
                throw new HttpError(409, 'WIKI_SNAPSHOT_CITATION_MISSING');
            }
        }
    }

    discardRun(runId: string) {
        this.db.prepare('DELETE FROM knowledge_snapshot WHERE run_id = ? AND published_at IS NULL').run(runId);
    }

    get(id: string) {
        const row = this.db.prepare(`
            SELECT ks.*, kl.parent_id, o.origin FROM knowledge_snapshot ks LEFT JOIN knowledge_lineage kl ON ks.id = kl.snapshot_id
            LEFT JOIN knowledge_origin o ON o.snapshot_id = ks.id
            WHERE ks.id = ? AND ks.published_at IS NOT NULL
                AND ${availableProject('ks.project_id')}
                AND NOT EXISTS (SELECT 1 FROM knowledge_retirement r WHERE r.snapshot_id = ks.id AND r.retired_at IS NOT NULL)
        `).get(id);
        return row && publishedSnapshot(row);
    }

    list(projectId: string, limit: number, offset: number) {
        return this.db.prepare(`
            SELECT ks.*, kl.parent_id, o.origin FROM knowledge_snapshot ks LEFT JOIN knowledge_lineage kl ON ks.id = kl.snapshot_id
            LEFT JOIN knowledge_origin o ON o.snapshot_id = ks.id
            WHERE ks.project_id = ? AND ks.published_at IS NOT NULL AND ${availableProject('ks.project_id')}
                AND NOT EXISTS (SELECT 1 FROM knowledge_retirement r WHERE r.snapshot_id = ks.id AND r.retired_at IS NOT NULL)
            ORDER BY ks.rowid DESC LIMIT ? OFFSET ?
        `).all(projectId, limit, offset).map(publishedSnapshot);
    }

    changes(id: string, limit: number, offset: number) {
        const total = Number(this.db.prepare('SELECT count(*) AS n FROM knowledge_change WHERE snapshot_id = ?').get(id)?.n ?? 0);
        const changes = this.db.prepare(`
            SELECT path, kind, previous_path FROM knowledge_change WHERE snapshot_id = ? ORDER BY path LIMIT ? OFFSET ?
        `).all(id, limit, offset).map(row => ({ path: String(row.path), kind: row.kind as SourceChange['kind'],
            ...(row.previous_path === null ? {} : { previousPath: String(row.previous_path) }) }));
        return { total, changes };
    }

    compareSources(baseId: string | null, targetId: string) {
        const read = this.db.prepare('SELECT path, hash, index_hash AS indexHash FROM knowledge_source WHERE snapshot_id = ? ORDER BY path');
        const manifest = (id: string) => read.all(id).map(row =>
            ({ path: String(row.path), hash: String(row.hash), indexHash: String(row.indexHash) }));
        return sourceChanges(baseId ? manifest(baseId) : [], manifest(targetId));
    }

    private sourceObject(id: string, path: string) {
        const row = this.db.prepare(`
            SELECT b.content, s.hash FROM knowledge_source s JOIN knowledge_blob b USING (hash)
            WHERE s.snapshot_id = ? AND s.path = ?
        `).get(id, path);
        if (!row) return undefined;
        return { bytes: row.content as Uint8Array, digest: String(row.hash) };
    }

    sourceBytes(id: string, path: string) { return this.sourceObject(id, path)?.bytes; }

    indexedDependencyCheck(projectId: string) {
        const row = this.db.prepare('SELECT payload FROM indexed_dependency_check WHERE project_id = ?').get(projectId);
        return row && JSON.parse(String(row.payload)) as DependencyReviewCheck;
    }

    saveDependencyCheck(projectId: string, result: DependencyReviewCheck | undefined) {
        if (!result) this.db.prepare('DELETE FROM indexed_dependency_check WHERE project_id = ?').run(projectId);
        else this.db.prepare(`INSERT INTO indexed_dependency_check VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET payload = excluded.payload`)
            .run(projectId, JSON.stringify(result));
    }

    dependencyCheck(snapshotId: string) {
        const row = this.db.prepare('SELECT payload FROM knowledge_dependency_check WHERE snapshot_id = ?').get(snapshotId);
        return row && JSON.parse(String(row.payload)) as DependencyReviewCheck;
    }

    source(id: string, path: string) {
        const object = this.sourceObject(id, path);
        if (!object) return undefined;
        const { bytes, digest } = object;
        const binary = isJar(path) || /\.class$/i.test(path);
        return { snapshotId: id, path, digest, size: bytes.byteLength,
            text: binary ? null : new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), binary };
    }

    evidenceFiles(id: string, paths: string[]) {
        return this.db.prepare(`SELECT path, hash, index_hash AS indexHash FROM knowledge_source
            WHERE snapshot_id = ? AND path IN (SELECT value FROM json_each(?)) ORDER BY path`).all(id, JSON.stringify(paths));
    }

    sourcePaths(id: string, directory: string, limit: number) {
        const prefix = directory ? directory + '/' : '';
        return this.db.prepare(`SELECT path FROM knowledge_source
            WHERE snapshot_id = ? AND substr(path, 1, length(?)) = ? ORDER BY path LIMIT ?`)
            .all(id, prefix, prefix, limit).map(row => String(row.path));
    }

    readUnit(snapshotId: string, unitId: string) {
        const row = this.db.prepare('SELECT payload FROM knowledge_unit WHERE snapshot_id = ? AND id = ?').get(snapshotId, unitId);
        return row && JSON.parse(String(row.payload)) as CodeUnit;
    }

    locate(id: string, path: string, line: number, entry: string | null, symbol: string | null) {
        const row = this.db.prepare(`
            SELECT payload FROM knowledge_unit WHERE snapshot_id = ? AND file_path = ? AND start_line <= ? AND end_line >= ?
                AND json_extract(payload, '$.metadata.archive_entry') IS ?
                AND (? IS NULL OR qualified_name = ?)
            ORDER BY end_line - start_line, length(json_extract(payload, '$.rawSource')), kind, id LIMIT 1
        `).get(id, path, line, line, entry, symbol, symbol);
        return row && JSON.parse(String(row.payload)) as CodeUnit;
    }
}
