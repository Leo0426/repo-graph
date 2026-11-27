import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { HttpError } from './http-error.js';
import { decodePdfPages, encodePdfPages, extractPdfText } from './pdf-text.js';
import { digest } from './source.js';

export const askAttachmentLimits = { files: 8, fileBytes: 256 * 1024, totalBytes: 1024 * 1024 };
export const askSessionPayloadBytes = 6 * askAttachmentLimits.totalBytes + 32 * 1024;
const textAttachment = z.object({
    name: z.string().trim().min(1).max(255).regex(/^[^/\\\u0000-\u001f\u007f]+\.(?:md|markdown|txt)$/i),
    text: z.string().max(askAttachmentLimits.fileBytes)
}).strict();
const pdfAttachment = z.object({
    name: z.string().trim().min(1).max(255).regex(/^[^/\\\u0000-\u001f\u007f]+\.pdf$/i),
    pdfBase64: z.string().max(4 * Math.ceil(askAttachmentLimits.fileBytes / 3)).pipe(z.base64())
}).strict();
export const askAttachmentInput = z.union([textAttachment, pdfAttachment]);
type AttachmentInput = z.infer<typeof askAttachmentInput>;
export type FrozenAttachment = { attachmentId: string; versionId: string; name: string; bytes: number };
type Status = FrozenAttachment & { revision: number; removedAt: number | null; pageCount: number | null };
type Attachment = Status & { text: string; digest: string; pdfPageIndex: string | null };
type PreparedAttachment = FrozenAttachment & { text: string; digest: string; pdfPageIndex: string | null; pdfOriginal: Buffer | null };
const metadata = `id AS attachmentId, version_id AS versionId, name, bytes, revision, removed_at AS removedAt,
    json_array_length(pdf_page_index) AS pageCount`;

export class AskAttachments {
    constructor(private readonly db: DatabaseSync) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS ask_attachment (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES ask_session(id) ON DELETE CASCADE,
                version_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, bytes INTEGER NOT NULL,
                digest TEXT NOT NULL, text TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, removed_at INTEGER,
                pdf_original BLOB, pdf_page_index TEXT
            );
            CREATE INDEX IF NOT EXISTS ask_attachment_session ON ask_attachment(session_id);
            CREATE VIRTUAL TABLE IF NOT EXISTS ask_attachment_search USING fts5(name, text, content='', contentless_delete=1);
            CREATE TRIGGER IF NOT EXISTS ask_attachment_index_delete AFTER DELETE ON ask_attachment BEGIN
                DELETE FROM ask_attachment_search WHERE rowid = old.rowid;
            END;
            CREATE TABLE IF NOT EXISTS ask_attachment_request (
                session_id TEXT NOT NULL REFERENCES ask_session(id) ON DELETE CASCADE, request_key TEXT NOT NULL,
                fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(session_id, request_key)
            );
        `);
        const columns = new Set(db.prepare("SELECT name FROM pragma_table_info('ask_attachment')").all().map(row => row.name));
        if (!columns.has('pdf_original')) db.exec('ALTER TABLE ask_attachment ADD COLUMN pdf_original BLOB');
        if (!columns.has('pdf_page_index')) db.exec('ALTER TABLE ask_attachment ADD COLUMN pdf_page_index TEXT');
    }

    async prepare(input: readonly AttachmentInput[], signal: AbortSignal) {
        const names = new Set<string>();
        let total = 0;
        const validated = input.map(item => {
            const name = item.name.normalize('NFC');
            if (Buffer.from(name, 'utf8').toString('utf8') !== name) throw new HttpError(400, 'ASK_ATTACHMENT_INVALID_TEXT');
            const nameKey = name.toLowerCase();
            if (names.has(nameKey)) throw new HttpError(409, 'ASK_ATTACHMENT_NAME_CONFLICT');
            names.add(nameKey);
            const text = 'text' in item ? item.text : null;
            const content = 'text' in item ? Buffer.from(item.text, 'utf8') : Buffer.from(item.pdfBase64, 'base64');
            if (text !== null && (text.includes('\0') || content.toString('utf8') !== text)) throw new HttpError(400, 'ASK_ATTACHMENT_INVALID_TEXT');
            total += content.length;
            if (content.length > askAttachmentLimits.fileBytes || total > askAttachmentLimits.totalBytes) {
                throw new HttpError(413, 'ASK_ATTACHMENT_CAPACITY_EXCEEDED');
            }
            return { name, content, text };
        });
        const files: PreparedAttachment[] = [];
        const deadline = AbortSignal.timeout(25_000);
        const active = AbortSignal.any([signal, deadline]);
        try {
            for (const { name, content, text } of validated) {
                const file = { attachmentId: randomUUID(), versionId: randomUUID(), name, bytes: content.length, digest: digest(content) };
                if (text === null) {
                    const pages = encodePdfPages(await extractPdfText(content, active));
                    files.push({ ...file, text: pages.text, pdfPageIndex: pages.pageIndex, pdfOriginal: content });
                } else files.push({ ...file, text, pdfPageIndex: null, pdfOriginal: null });
            }
            return files;
        } catch (error) {
            signal.throwIfAborted();
            if (deadline.aborted) throw new HttpError(504, 'PDF_PARSE_TIMEOUT');
            throw error;
        }
    }

    save(sessionId: string, files: PreparedAttachment[]) {
        const insert = this.db.prepare(`INSERT INTO ask_attachment(id, session_id, version_id, name, bytes, digest, text, pdf_original, pdf_page_index)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const index = this.db.prepare('INSERT INTO ask_attachment_search(rowid, name, text) VALUES (?, ?, ?)');
        for (const file of files) {
            const added = insert.run(file.attachmentId, sessionId, file.versionId, file.name, file.bytes, file.digest, file.text,
                file.pdfOriginal, file.pdfPageIndex);
            index.run(added.lastInsertRowid, file.name, file.text);
        }
    }

    list(sessionId: string) {
        return this.db.prepare(`SELECT ${metadata} FROM ask_attachment WHERE session_id = ? ORDER BY rowid`).all(sessionId) as Status[];
    }

    requireFrozen(sessionId: string, refs: readonly FrozenAttachment[]) {
        if (!refs.length) return;
        const readable = this.db.prepare('SELECT 1 FROM ask_attachment WHERE session_id = ? AND id = ? AND version_id = ? AND removed_at IS NULL');
        if (refs.some(ref => !readable.get(sessionId, ref.attachmentId, ref.versionId))) throw new HttpError(404, 'ASK_ATTACHMENT_REMOVED');
    }

    read(sessionId: string, id: string, versionId: string) {
        const row = this.db.prepare(`SELECT ${metadata}, text, digest, pdf_page_index AS pdfPageIndex FROM ask_attachment
            WHERE session_id = ? AND id = ? AND version_id = ? AND removed_at IS NULL`).get(sessionId, id, versionId) as Attachment | undefined;
        if (!row) throw new HttpError(404, 'ASK_ATTACHMENT_NOT_FOUND');
        const { pdfPageIndex, text, ...file } = row;
        return { ...file, text: pdfPageIndex ? '' : text, ...(pdfPageIndex ? { pdfPages: decodePdfPages(text, pdfPageIndex) } : {}) };
    }

    download(sessionId: string, id: string, versionId: string) {
        const row = this.db.prepare(`SELECT name, text, pdf_original AS original, pdf_page_index AS pageIndex FROM ask_attachment
            WHERE session_id = ? AND id = ? AND version_id = ? AND removed_at IS NULL`).get(sessionId, id, versionId);
        if (!row) throw new HttpError(404, 'ASK_ATTACHMENT_NOT_FOUND');
        if (row.pageIndex && !(row.original instanceof Uint8Array)) throw new HttpError(500, 'PDF_ORIGINAL_UNAVAILABLE');
        const name = String(row.name);
        const extension = row.pageIndex ? 'pdf' : /\.(md|markdown)$/i.test(name) ? 'md' : 'txt';
        const contentType = extension === 'pdf' ? 'application/pdf' : (extension === 'md' ? 'text/markdown' : 'text/plain') + '; charset=utf-8';
        return { name, extension, contentType, bytes: row.original instanceof Uint8Array ? row.original : Buffer.from(String(row.text)) };
    }

    matching(sessionId: string, query: string, limit: number) {
        const words = [...new Set(query.match(/[\p{L}\p{N}_]+/gu) ?? [])].slice(0, 24);
        if (!words.length) return [];
        const rows = this.db.prepare(`SELECT a.id AS attachmentId, a.version_id AS versionId, a.name, a.text, a.pdf_page_index AS pdfPageIndex
            FROM ask_attachment_search f JOIN ask_attachment a ON a.rowid = f.rowid
            WHERE ask_attachment_search MATCH ? AND a.session_id = ? AND a.removed_at IS NULL ORDER BY f.rank, a.rowid LIMIT ?`)
            .all(words.map(word => '"' + word + '"').join(' OR '), sessionId, limit) as Pick<Attachment, 'attachmentId' | 'versionId' | 'name' | 'text' | 'pdfPageIndex'>[];
        return rows.map(({ pdfPageIndex, text, ...file }) =>
            ({ ...file, text: pdfPageIndex ? '' : text, ...(pdfPageIndex ? { pdfPages: decodePdfPages(text, pdfPageIndex) } : {}) }));
    }

    change(sessionId: string, id: string, action: 'remove' | 'restore', expected: number, key: string) {
        const fingerprint = digest(JSON.stringify([id, action, expected]));
        const existing = this.db.prepare('SELECT fingerprint, result FROM ask_attachment_request WHERE session_id = ? AND request_key = ?')
            .get(sessionId, key);
        if (existing) {
            if (existing.fingerprint !== fingerprint) throw new HttpError(409, 'ASK_ATTACHMENT_REQUEST_CONFLICT');
            return { changed: false, result: JSON.parse(String(existing.result)) as Status };
        }
        const current = this.db.prepare(`SELECT ${metadata} FROM ask_attachment WHERE session_id = ? AND id = ?`)
            .get(sessionId, id) as Status | undefined;
        if (!current) throw new HttpError(404, 'ASK_ATTACHMENT_NOT_FOUND');
        const remove = action === 'remove';
        if (current.revision !== expected || remove === (current.removedAt !== null)) {
            throw new HttpError(409, 'ASK_ATTACHMENT_REVISION_CHANGED');
        }
        const result = this.db.prepare(`UPDATE ask_attachment SET revision = revision + 1, removed_at = ?
            WHERE session_id = ? AND id = ? RETURNING ${metadata}`).get(remove ? Date.now() : null, sessionId, id) as Status;
        this.db.prepare('INSERT INTO ask_attachment_request VALUES (?, ?, ?, ?)').run(sessionId, key, fingerprint, JSON.stringify(result));
        return { changed: true, result };
    }
}
