import type { IncomingMessage, ServerResponse } from 'node:http';
import { agentRunIdPattern } from './agent-runs.js';
import { collaborationConnection, collaborationEvent, collaborationIdPattern } from './collaboration.js';
import type { CollaborationIngress } from './collaboration.js';
import { readPayload } from './http-body.js';
import { HttpError, send } from './http-error.js';
import type { Account } from './identity.js';

const eventPath = /^\/api\/v1\/collaboration\/connections\/([^/]+)\/events(?:\/([^/]+))?$/;
const administrationPath = /^\/api\/v1\/admin\/collaboration\/connections(?:\/([^/]+)\/revoke)?$/;

export async function handleCollaboration(request: IncomingMessage, response: ServerResponse, url: URL, ingress?: CollaborationIngress) {
    const match = eventPath.exec(url.pathname);
    if (!ingress || !match) return false;
    const [, id, eventId] = match;
    if (!agentRunIdPattern.test(id) || (eventId && !collaborationIdPattern.test(eventId))) throw new HttpError(404, 'NOT_FOUND');
    const authenticate = () => ingress.authenticate(id, request.headers.authorization);
    const connection = authenticate();
    if (request.method === 'GET' && eventId) send(response, 200, ingress.inspect(connection, eventId));
    else if (request.method === 'POST' && !eventId) {
        const event = await readPayload(request, collaborationEvent, 128 * 1024);
        if (response.destroyed) return true;
        const { status, body } = ingress.submit(authenticate(), event);
        send(response, status, body);
    } else throw new HttpError(405, 'METHOD_NOT_ALLOWED');
    return true;
}

export async function handleCollaborationAdmin(request: IncomingMessage, response: ServerResponse, url: URL,
    account: Account, authorize: () => void, ingress?: CollaborationIngress) {
    const match = administrationPath.exec(url.pathname);
    if (!ingress || !match) return false;
    const id = match[1];
    authorize();
    if (id) {
        if (!agentRunIdPattern.test(id)) throw new HttpError(404, 'NOT_FOUND');
        if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        send(response, 200, ingress.revoke(account, id));
    } else if (request.method === 'GET') {
        const limit = cursor(url, 'limit', 50);
        if (limit < 1 || limit > 200) throw new HttpError(400, 'INVALID_LIMIT');
        send(response, 200, ingress.list(limit, cursor(url, 'offset', 0)));
    } else if (request.method === 'POST') {
        const input = await readPayload(request, collaborationConnection, 12_288);
        if (response.destroyed) return true;
        authorize();
        send(response, 201, ingress.create(account, input));
    } else throw new HttpError(405, 'METHOD_NOT_ALLOWED');
    return true;
}

function cursor(url: URL, name: 'limit' | 'offset', fallback: number) {
    const raw = url.searchParams.get(name);
    if (raw === null) return fallback;
    const number = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number)) throw new HttpError(400, 'INVALID_' + name.toUpperCase());
    return number;
}
