import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTimeout as wait } from 'node:timers/promises';
import { z } from 'zod';
import { askSessionPayloadBytes } from './ask-attachments.js';
import type { AskConversations } from './ask-conversations.js';
import { askSessionInput, askTurnInput } from './ask-evidence.js';
import { readPayload } from './http-body.js';
import { HttpError, send } from './http-error.js';
import type { Account } from './identity.js';

const prefix = '/api/v1/ask/sessions';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const keyPattern = /^[A-Za-z0-9._~-]{1,128}$/;
const attachmentChange = z.object({ action: z.enum(['remove', 'restore']), revision: z.int().nonnegative() }).strict();

function requestKey(request: IncomingMessage, required = true) {
    const key = request.headers['idempotency-key'];
    if (key === undefined && !required) return undefined;
    if (typeof key !== 'string' || !keyPattern.test(key)) throw new HttpError(400, 'ASK_IDEMPOTENCY_KEY_REQUIRED');
    return key;
}

function deliverAttachment(response: ServerResponse, file: ReturnType<AskConversations['downloadAttachment']>) {
    const filename = encodeURIComponent(file.name).replace(/['()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
    response.writeHead(200, {
        'Content-Type': file.contentType, 'Content-Length': file.bytes.byteLength,
        'Content-Disposition': 'attachment; filename="attachment.' + file.extension + '"; filename*=UTF-8\'\'' + filename,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
    }).end(file.bytes);
}

function cursor(value: string | null | undefined, fallback: number) {
    if (value === null || value === undefined) return fallback;
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number)) throw new HttpError(400, 'ASK_INVALID_CURSOR');
    return number;
}

async function stream(response: ServerResponse, ask: AskConversations, actor: Account, sessionId: string, startAt: number) {
    let after = startAt;
    let page = ask.events(actor, sessionId, after, 10);
    let lastHeartbeat = Date.now();
    const disconnected = new AbortController();
    response.once('close', () => disconnected.abort());
    const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(20_000)]);
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' });
    response.flushHeaders();
    try {
        while (!signal.aborted) {
            const bytes = page.events.map(event => 'id: ' + event.sequence + '\nevent: ' + event.type
                + '\ndata: ' + JSON.stringify(event) + '\n\n').join('');
            if (bytes && !response.write(bytes)) await once(response, 'drain', { signal });
            after = page.next;
            if (!page.hasMore && !page.active) break;
            if (!page.hasMore) await wait(240, undefined, { signal });
            page = ask.events(actor, sessionId, after, 10);
            if (Date.now() - lastHeartbeat > 5000) {
                if (!response.write(': keep-alive\n\n')) await once(response, 'drain', { signal });
                lastHeartbeat = Date.now();
            }
        }
    } catch (error) {
        if (!signal.aborted && !response.destroyed) {
            response.write('event: stream-error\ndata: ' + JSON.stringify({
                code: error instanceof HttpError && [401, 403, 404, 409].includes(error.status) ? 'ASK_SCOPE_ACCESS_CHANGED' : 'ASK_STREAM_FAILED'
            }) + '\n\n');
        }
    } finally {
        if (!response.destroyed) response.end();
    }
}

export async function handleAsk(request: IncomingMessage, response: ServerResponse, url: URL, actor: Account, ask: AskConversations,
    signal: () => AbortSignal) {
    if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return false;
    const method = request.method;
    if (url.pathname === prefix) {
        if (method === 'GET') send(response, 200, ask.list(actor));
        else if (method === 'POST') {
            const input = await readPayload(request, askSessionInput, askSessionPayloadBytes);
            if (response.destroyed) return true;
            const result = await ask.create(actor, input, requestKey(request, Boolean(input.attachments?.length)), signal());
            if (!response.destroyed) send(response, 201, result);
        } else throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        return true;
    }
    const parts = url.pathname.slice(prefix.length + 1).split('/');
    const [id, action, turnId, control, citationId] = parts;
    if (!uuid.test(id) || parts.length > 5 || parts.some(part => !part)) throw new HttpError(404, 'NOT_FOUND');
    if (action === 'attachments' && !citationId) {
        if (!turnId && method === 'GET') send(response, 200, ask.listAttachments(actor, id));
        else if (turnId && uuid.test(turnId) && (!control || control === 'download') && method === 'GET') {
            const version = url.searchParams.get('versionId');
            if (!version || !uuid.test(version)) throw new HttpError(400, 'ASK_ATTACHMENT_VERSION_REQUIRED');
            if (control === 'download') deliverAttachment(response, ask.downloadAttachment(actor, id, turnId, version));
            else send(response, 200, ask.readAttachment(actor, id, turnId, version));
        } else if (turnId && uuid.test(turnId) && !control && method === 'POST') {
            const key = requestKey(request)!;
            const input = await readPayload(request, attachmentChange, 2048);
            if (!response.destroyed) send(response, 200, ask.changeAttachment(actor, id, turnId, input.action, input.revision, key));
        } else throw new HttpError(404, 'NOT_FOUND');
        return true;
    }
    if (!action && method === 'GET') send(response, 200, ask.describe(actor, id));
    else if (action === 'context' && !turnId && method === 'GET') send(response, 200, ask.context(actor, id));
    else if (action === 'turns' && !turnId && method === 'POST') {
        const key = requestKey(request)!;
        const input = await readPayload(request, askTurnInput, 128 * 1024);
        if (!response.destroyed) send(response, 202, ask.submit(actor, id, key, input));
    } else if (action === 'turns' && turnId && uuid.test(turnId) && !control && method === 'GET') {
        send(response, 200, ask.inspect(actor, id, turnId));
    } else if (action === 'turns' && turnId && uuid.test(turnId) && control === 'attempts' && !citationId && method === 'GET') {
        send(response, 200, ask.attempts(actor, id, turnId));
    } else if (action === 'turns' && turnId && uuid.test(turnId) && control === 'cancel' && !citationId && method === 'POST') {
        send(response, 200, ask.cancel(actor, id, turnId));
    } else if (action === 'turns' && turnId && uuid.test(turnId) && control === 'citations' && /^E[1-9][0-9]?$/.test(citationId ?? '') && method === 'GET') {
        const citation = ask.citation(actor, id, turnId, citationId);
        if (url.searchParams.get('open') !== '1') send(response, 200, citation);
        else {
            const params = citation.kind === 'ATTACHMENT' ? new URLSearchParams({ view: 'ask', session: id,
                attachment: citation.attachmentId, revision: citation.versionId, line: String(citation.startLine),
                ...(citation.page === undefined ? {} : { page: String(citation.page) }) })
                : citation.kind === 'DOCUMENT' ? new URLSearchParams({ view: 'spaces', space: citation.spaceId,
                item: citation.documentId, revision: citation.versionId, line: String(citation.startLine),
                    ...(citation.page === undefined ? {} : { page: String(citation.page) }),
                    ...(citation.cell ? { row: String(citation.cell.row), column: String(citation.cell.column) } : {}) }) : citation.kind === 'WIKI'
                ? new URLSearchParams({ view: 'wiki', project: citation.projectId, snapshotId: citation.snapshotId, document: citation.wikiId,
                    ...(citation.revisionId ? { revisionId: citation.revisionId } : {}) })
                : citation.kind === 'CHANGE_REVIEW'
                ? new URLSearchParams({ view: 'change-review', project: citation.projectId, snapshot: citation.reviewId })
                : new URLSearchParams({ view: 'graph', project: citation.projectId, snapshotId: citation.snapshotId, file: citation.path,
                    line: String(citation.startLine), ...(citation.archiveEntry ? { archiveEntry: citation.archiveEntry } : {}),
                    ...(citation.symbol ? { symbol: citation.symbol } : {}) });
            const finding = citation.kind === 'CHANGE_REVIEW' && citation.findingId ? `#change-finding-${citation.reviewId}-${citation.findingId}` : '';
            response.writeHead(303, { Location: '/?' + params + finding, 'Cache-Control': 'no-store' }).end();
        }
    } else if (action === 'events' && !turnId && method === 'GET') {
        const after = cursor(url.searchParams.get('after'), 0);
        if (request.headers.accept?.includes('text/event-stream')) {
            const last = request.headers['last-event-id'];
            await stream(response, ask, actor, id, Math.max(after, cursor(typeof last === 'string' ? last : undefined, 0)));
        } else {
            const limit = Math.max(1, Math.min(cursor(url.searchParams.get('limit'), 50), 100));
            send(response, 200, ask.events(actor, id, after, limit));
        }
    } else throw new HttpError(404, 'NOT_FOUND');
    return true;
}
