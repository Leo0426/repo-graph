import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { csvEdits } from './csv-document.js';
import { readBody, readPayload } from './http-body.js';
import { HttpError, send } from './http-error.js';
import type { Account } from './identity.js';
import type { RepositoryIndex } from './index.js';
import { maxSpaceDocumentBytes, spaceDocumentGeneration, spaceItemName as name, spaceItemPlacement as placement,
    spaceLinkInput, spaceMemberInput, spaceRequestKey as key, spaceRevision as revision, spaceTransferInput,
    spaceUpdateInput, spaceUuid as uuid } from './project-space-input.js';

const prefix = '/api/v1/spaces';
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const projectPattern = /^[0-9a-f]{12}$/;
const markdown = z.string().max(maxSpaceDocumentBytes);
const createDocument = placement.extend({ markdown, key });
const editDocument = z.object({ baseVersionId: uuid, markdown, key }).strict();
const restoreDocument = z.object({ baseVersionId: uuid, restoreVersionId: uuid, key }).strict();
const replaceDocument = z.object({ baseVersionId: uuid }).strict();
const updateCells = replaceDocument.extend({ key, edits: csvEdits });

function queryNumber(url: URL, field: string, fallback?: number) {
    const raw = url.searchParams.get(field);
    if (raw === null && fallback !== undefined) return fallback;
    if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new HttpError(400, 'INVALID_INPUT');
    return Number(raw);
}

function searchText(url: URL) {
    const text = url.searchParams.get('q')?.trim();
    if (!text || text.length > 4096 || text.includes('\0')) throw new HttpError(400, 'INVALID_Q');
    return text;
}

export async function handleProjectSpaces(request: IncomingMessage, response: ServerResponse, url: URL,
    actor: Account, repository: RepositoryIndex, signal: () => AbortSignal) {
    if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return false;
    const spaces = repository.spaces;
    const method = request.method;
    const parts = url.pathname === prefix ? [] : url.pathname.slice(prefix.length + 1).split('/');
    if (parts.some(part => !part) || parts.length > 6) throw new HttpError(404, 'NOT_FOUND');
    const [spaceId, collection, id, action, version, operation] = parts;
    const body = <T>(schema: z.ZodType<T>) => readPayload(request, schema, 8192);
    const documentBody = <T>(schema: z.ZodType<T>) => readPayload(request, schema, maxSpaceDocumentBytes * 6 + 1024);
    if (!spaceId) {
        if (method === 'GET') send(response, 200, url.searchParams.get('deleted') === 'true' ? spaces.deleted(actor) : spaces.list(actor));
        else if (method === 'POST') send(response, 201, spaces.create(actor, (await body(z.object({ name }).strict())).name));
        else throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        return true;
    }
    if (!uuidPattern.test(spaceId)) throw new HttpError(404, 'SPACE_NOT_FOUND');
    if (!collection) {
        if (method === 'GET') send(response, 200, spaces.get(actor, spaceId));
        else if (method === 'PATCH') send(response, 200, spaces.update(actor, spaceId, await body(spaceUpdateInput)));
        else throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        return true;
    }
    if (collection === 'members' && !id) {
        if (method === 'GET') send(response, 200, spaces.members(actor, spaceId, url.searchParams.get('details') === 'true'));
        else if (method === 'PUT') {
            const { role, revision, ...target } = await body(spaceMemberInput);
            send(response, 200, spaces.setMember(actor, spaceId, target, role, revision));
        } else throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        return true;
    }
    if (collection === 'transfer' && !id && method === 'POST') {
        const input = await body(spaceTransferInput);
        send(response, 200, spaces.transfer(actor, spaceId, input.accountId, input.revision));
        return true;
    }
    if (collection === 'repositories') {
        if (!id && method === 'POST') {
            const input = await body(spaceLinkInput);
            send(response, 200, spaces.setRepository(actor, spaceId, input.projectId, input.revision, 'link', input.snapshotId));
            return true;
        }
        if (id === 'detached' && !action && method === 'GET') {
            send(response, 200, spaces.detachedRepositories(actor, spaceId));
            return true;
        }
        if (id && projectPattern.test(id)) {
            if (method === 'DELETE' && !action) {
                send(response, 200, spaces.setRepository(actor, spaceId, id, queryNumber(url, 'revision'), 'unlink'));
                return true;
            }
            if (method === 'POST' && action === 'restore' && !version) {
                const input = await body(z.object({ revision }).strict());
                send(response, 200, spaces.setRepository(actor, spaceId, id, input.revision, 'restore'));
                return true;
            }
            if (method === 'GET' && action === 'search' && !version) {
                const source = spaces.repository(actor, spaceId, id);
                send(response, 200, repository.search(searchText(url), source.projectId, null, null, 25, true, null, source.snapshotId ?? undefined));
                return true;
            }
        }
    }
    if (collection === 'items' && !id && method === 'GET') {
        const parent = url.searchParams.get('parentId');
        if (parent !== null && !uuidPattern.test(parent)) throw new HttpError(400, 'INVALID_INPUT');
        send(response, 200, spaces.items(actor, spaceId, parent));
        return true;
    }
    if (collection === 'folders' && !id && method === 'POST') {
        const input = await body(placement);
        send(response, 201, spaces.createFolder(actor, spaceId, input.parentId, input.name));
        return true;
    }
    if (collection === 'items' && id && uuidPattern.test(id) && !action) {
        if (method === 'DELETE') send(response, 200, spaces.deleteItem(actor, spaceId, id));
        else if (method === 'PATCH') {
            const input = await body(placement);
            send(response, 200, spaces.moveItem(actor, spaceId, id, input.parentId, input.name));
        } else throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        return true;
    }
    if (collection === 'trash') {
        if (!id && method === 'GET') {
            send(response, 200, spaces.trash(actor, spaceId));
            return true;
        }
        if (id && uuidPattern.test(id) && !version) {
            if (!action && method === 'DELETE') {
                send(response, 200, spaces.purge(actor, spaceId, id));
                return true;
            }
            if (action === 'restore' && method === 'POST') {
                const input = await body(z.object({ name: name.optional() }).strict());
                send(response, 200, spaces.restore(actor, spaceId, id, input.name));
                return true;
            }
        }
    }
    if (collection === 'documents') {
        const mediaType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
        const fileReplacement = id && uuidPattern.test(id) && !action && method === 'PUT' ? id : undefined;
        if ((mediaType === 'application/pdf' || mediaType === 'text/csv') && ((!id && method === 'POST') || fileReplacement)) {
            const requestKey = key.safeParse(request.headers['idempotency-key']);
            const parameters = Object.fromEntries(url.searchParams);
            const target = fileReplacement ? replaceDocument.transform(value => ({ itemId: fileReplacement, ...value })).safeParse(parameters)
                : placement.safeParse(parameters);
            if (!requestKey.success || !target.success) throw new HttpError(400, 'INVALID_INPUT');
            const bytes = await readBody(request, maxSpaceDocumentBytes);
            if (response.destroyed) return true;
            const result = mediaType === 'application/pdf' ? await spaces.savePdf(actor, spaceId, requestKey.data, target.data, bytes, signal())
                : spaces.saveCsv(actor, spaceId, requestKey.data, target.data, bytes);
            if (!response.destroyed) send(response, fileReplacement ? 200 : 201, result);
            return true;
        }
        if (id === 'generate' && !action && method === 'POST') {
            const input = await readPayload(request, spaceDocumentGeneration, 28_000);
            if (response.destroyed) return true;
            const result = await spaces.generateDocument(actor, spaceId, input.key, input.target, input.instruction, signal());
            if (!response.destroyed) send(response, 'name' in input.target ? 201 : 200, result);
            return true;
        }
        if (!id && method === 'POST') {
            const { key, ...input } = await documentBody(createDocument);
            send(response, 201, spaces.saveDocument(actor, spaceId, key, input));
            return true;
        }
        if (id === 'search' && !action && method === 'GET') {
            send(response, 200, spaces.search(actor, spaceId, searchText(url)));
            return true;
        }
        if (id && uuidPattern.test(id)) {
            if (action === 'cells' && !version && method === 'PATCH') {
                const input = await readPayload(request, updateCells, maxSpaceDocumentBytes * 6 + 1024);
                if (!response.destroyed) send(response, 200, spaces.saveCsvCells(actor, spaceId, input.key,
                    { itemId: id, baseVersionId: input.baseVersionId }, input.edits));
                return true;
            }
            if (!action && method === 'GET') {
                send(response, 200, spaces.readDocument(actor, spaceId, id));
                return true;
            }
            if (!action && method === 'PUT') {
                const { key, ...input } = await documentBody(editDocument);
                send(response, 200, spaces.saveDocument(actor, spaceId, key, { ...input, itemId: id }));
                return true;
            }
            if (action === 'restore' && !version && method === 'POST') {
                const { key, ...input } = await body(restoreDocument);
                send(response, 200, spaces.saveDocument(actor, spaceId, key, { ...input, itemId: id }));
                return true;
            }
            if (action === 'versions' && method === 'GET') {
                if (!version) {
                    send(response, 200, spaces.versions(actor, spaceId, id, queryNumber(url, 'offset', 0)));
                    return true;
                }
                if (uuidPattern.test(version) && (!operation || operation === 'export')) {
                    if (!operation) send(response, 200, spaces.readDocument(actor, spaceId, id, version));
                    else {
                        const result = spaces.downloadDocument(actor, spaceId, id, version);
                        response.writeHead(200, { 'Content-Type': result.contentType, 'Content-Length': result.bytes.byteLength,
                            'Content-Disposition': `attachment; filename="document-${version}.${result.extension}"`,
                            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(result.bytes);
                    }
                    return true;
                }
            }
        }
    }
    throw new HttpError(404, 'NOT_FOUND');
}
