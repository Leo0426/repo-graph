import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from './http-error.js';
import { docxMediaType, wikiDocx } from './wiki-docx.js';
import { wikiArtifactFormats, wikiExportText } from './wiki-export.js';
import { wikiPdf } from './wiki-pdf.js';
import type { SummaryDocument } from './wiki.js';

export type WikiArtifactFormat = typeof wikiArtifactFormats[number];
export const wikiArtifactContentTypes: Record<WikiArtifactFormat, string> = {
    markdown: 'text/markdown; charset=utf-8', pdf: 'application/pdf', docx: docxMediaType
};
type Artifact = { id: string; pageId: string; revisionId: string; format: WikiArtifactFormat;
    section: number | null; sha256: string; size: number; createdAt: string; filename: string; downloadPath: string };
type StoredArtifact = Omit<Artifact, 'filename' | 'downloadPath'> & { section: number };
const fields = `a.id, a.page_id AS pageId, a.revision_id AS revisionId, a.section, a.sha256, a.size, a.created_at AS createdAt,
    CASE WHEN a.cache_format = 'markdown' THEN 'markdown' WHEN a.cache_format LIKE 'docx:%' THEN 'docx' ELSE 'pdf' END AS format`;

function publicArtifact(record: StoredArtifact): Artifact {
    const { id, pageId, format, section } = record;
    const extension = format === 'markdown' ? 'md' : format;
    return { ...record, section: section < 0 ? null : section,
        filename: 'wiki-' + record.revisionId + (section < 0 ? '' : '-section-' + (section + 1)) + '.' + extension,
        downloadPath: '/api/v1/summaries/' + pageId + '/exports/' + id + '/download' };
}

export class WikiArtifacts {
    private rendering = 0;

    constructor(private readonly db: DatabaseSync) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS wiki_artifact (
                id TEXT PRIMARY KEY, page_id TEXT NOT NULL, revision_id TEXT NOT NULL, cache_format TEXT NOT NULL, section INTEGER NOT NULL,
                sha256 TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL,
                UNIQUE(page_id, revision_id, cache_format, section),
                FOREIGN KEY(page_id, revision_id, cache_format, section)
                    REFERENCES wiki_page_export(page_id, revision_id, format, section) ON DELETE CASCADE
            );
        `);
    }

    list(pageId: string, revisionId: string, offset: number) {
        const rows = this.db.prepare(`SELECT ${fields} FROM wiki_artifact a
            WHERE a.page_id = ? AND a.revision_id = ? ORDER BY a.rowid DESC LIMIT 51 OFFSET ?`).all(pageId, revisionId, offset) as StoredArtifact[];
        return { records: rows.slice(0, 50).map(publicArtifact), offset, hasMore: rows.length > 50 };
    }

    private existing(pageId: string, revisionId: string, cacheFormat: string, section: number) {
        const row = this.db.prepare(`SELECT ${fields} FROM wiki_artifact a
            WHERE a.page_id = ? AND a.revision_id = ? AND a.cache_format = ? AND a.section = ?`)
            .get(pageId, revisionId, cacheFormat, section) as StoredArtifact | undefined;
        return row && publicArtifact(row);
    }

    async prepare(page: SummaryDocument, format: WikiArtifactFormat, section: number | undefined,
        reauthorize: () => void, signal: AbortSignal) {
        const revisionId = page.revision?.id ?? page.id;
        if (!page.knowledgeSnapshotId) throw new HttpError(409, 'WIKI_EXPORT_SNAPSHOT_REQUIRED');
        if (section !== undefined && !page.sections[section]) throw new HttpError(404, 'WIKI_SECTION_NOT_FOUND');
        const cacheFormat = format === 'markdown' ? 'markdown' : format + ':1';
        const index = section ?? -1;
        const cached = this.existing(page.id, revisionId, cacheFormat, index);
        if (cached) return cached;
        const prior = this.db.prepare('SELECT bytes FROM wiki_page_export WHERE page_id = ? AND revision_id = ? AND format = ? AND section = ?')
            .get(page.id, revisionId, cacheFormat, index);
        let payload: Uint8Array;
        if (prior) payload = prior.bytes as Uint8Array;
        else if (format === 'markdown') payload = Buffer.from(wikiExportText(page, section), 'utf8');
        else {
            if (this.rendering >= 2) throw new HttpError(503, 'WIKI_EXPORT_BUSY');
            this.rendering++;
            const render = format === 'docx' ? wikiDocx : wikiPdf;
            try { payload = await render(page, section, AbortSignal.any([signal, AbortSignal.timeout(30_000)])); }
            catch (error) {
                if (error instanceof DOMException && error.name === 'TimeoutError') throw new HttpError(503, 'WIKI_EXPORT_TIMEOUT');
                throw error;
            } finally { this.rendering--; }
        }
        signal.throwIfAborted();
        reauthorize();
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const raced = this.existing(page.id, revisionId, cacheFormat, index);
            if (!raced) {
                this.db.prepare('INSERT INTO wiki_page_export VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
                    .run(page.id, revisionId, cacheFormat, index, payload);
                this.db.prepare('INSERT INTO wiki_artifact VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                    .run(randomUUID(), page.id, revisionId, cacheFormat, index, createHash('sha256').update(payload).digest('hex'),
                        payload.byteLength, new Date().toISOString());
            }
            const result = raced ?? this.existing(page.id, revisionId, cacheFormat, index)!;
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    artifact(pageId: string, id: string) {
        const stored = this.db.prepare(`SELECT ${fields} FROM wiki_artifact a WHERE a.page_id = ? AND a.id = ?`)
            .get(pageId, id) as StoredArtifact | undefined;
        if (!stored) throw new HttpError(404, 'WIKI_ARTIFACT_NOT_FOUND');
        return publicArtifact(stored);
    }

    download(item: Artifact) {
        const row = this.db.prepare(`SELECT e.bytes FROM wiki_artifact a JOIN wiki_page_export e
            ON a.page_id = e.page_id AND a.revision_id = e.revision_id AND a.cache_format = e.format AND a.section = e.section
            WHERE a.id = ?`).get(item.id);
        if (!row) throw new HttpError(404, 'WIKI_ARTIFACT_NOT_FOUND');
        const bytes = row.bytes as Uint8Array;
        if (bytes.byteLength !== item.size || createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
            throw new HttpError(409, 'WIKI_ARTIFACT_DATA_CHANGED');
        }
        return bytes;
    }
}
