import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { calendarScheduleInput } from './calendar-schedule.js';
import { hostedGitAdapter } from './git-hosted.js';
import { parsePayload, readBody, readPayload } from './http-body.js';
import { HttpError, send } from './http-error.js';
import type { Account } from './identity.js';
import type { GitSources } from './git-sources.js';

const prefix = '/api/v1/git';
const identifier = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const project = /^[a-f0-9]{12}$/;
const name = z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/u);
const branch = z.string().min(1).max(200);
const token = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/u);
const username = z.string().min(1).max(256).regex(/^[\x21-\x39\x3b-\x7e]+$/u);
const credential = z.object({ username: username.optional(), token }).strict();
const urlInput = z.string().min(1).max(500);
const connectionInput = z.object({ name, url: urlInput, adapter: hostedGitAdapter.optional(),
    username: username.optional(), token: token.optional() }).strict()
    .refine(input => !input.username || Boolean(input.token));
const connectionUpdate = z.object({ revision: z.int().nonnegative(), enabled: z.boolean().optional(),
    credential: credential.nullable().optional(), eventSecret: token.min(32).nullable().optional() }).strict()
    .refine(input => input.enabled !== undefined || input.credential !== undefined || input.eventSecret !== undefined);
const connectionReconnect = z.object({ revision: z.int().nonnegative(), url: urlInput, adapter: hostedGitAdapter.optional(),
    enabled: z.boolean().optional(), credential: credential.nullable().optional() }).strict();
const repositoryInput = z.object({ connectionId: z.string().regex(identifier), branch, name: name.optional() }).strict();
const syncInput = z.object({ retryRunId: z.string().regex(identifier).optional() }).strict();
const automationInput = z.object({ revision: z.int().nonnegative(), intervalMinutes: z.int().min(1).max(7 * 24 * 60).nullable(),
    calendar: calendarScheduleInput.nullable().optional(), eventEnabled: z.boolean(), publishAfterSync: z.boolean().optional() }).strict()
    .refine(input => !input.calendar || input.intervalMinutes === null);
const eventInput = z.object({ url: z.string().min(1).max(500), ref: z.string().min(1).max(211),
    commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), timestamp: z.iso.datetime({ offset: true }) }).strict();

export async function handleGitEvent(request: IncomingMessage, response: ServerResponse, url: URL, sources: GitSources, signal: () => AbortSignal) {
    const match = /^\/api\/v1\/git\/events\/([^/]+)$/.exec(url.pathname);
    if (!match || !identifier.test(match[1]) || request.method !== 'POST') return false;
    if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        throw new HttpError(415, 'UNSUPPORTED_CONTENT_TYPE');
    }
    const body = await readBody(request, 8192);
    if (response.destroyed) return true;
    const signature = request.headers['x-git-event-signature'];
    const revision = sources.verifyEvent(match[1], typeof signature === 'string' ? signature : undefined, body);
    const event = parsePayload(body, eventInput);
    const result = await sources.event(match[1], revision, event, signal());
    if (!response.destroyed) send(response, 202, result);
    return true;
}

export async function handleGitSources(request: IncomingMessage, response: ServerResponse, url: URL,
    actor: Account, sources: GitSources, signal: () => AbortSignal) {
    if (!url.pathname.startsWith(prefix + '/')) return false;
    const body = <T>(schema: z.ZodType<T>) => readPayload(request, schema, 8192);
    const method = request.method;
    const parts = url.pathname.slice(prefix.length + 1).split('/');
    if (parts.some(part => !part) || parts.length > 3) throw new HttpError(404, 'NOT_FOUND');
    const [collection, id, action] = parts;
    if (collection === 'connections') {
        if (!id && method === 'GET') send(response, 200, sources.listConnections(actor));
        else if (!id && method === 'POST') {
            const input = await body(connectionInput);
            const result = await sources.createConnection(actor, { name: input.name, url: input.url, adapter: input.adapter,
                credential: input.token ? { username: input.username, token: input.token } : undefined }, signal());
            if (!response.destroyed) send(response, 201, result);
        } else if (id && identifier.test(id) && !action && method === 'GET') {
            send(response, 200, sources.getConnection(actor, id));
        } else if (id && identifier.test(id) && !action && method === 'PATCH') {
            const input = await body(connectionUpdate);
            const result = await sources.updateConnection(actor, id, input, signal());
            if (!response.destroyed) send(response, 200, result);
        } else if (id && identifier.test(id) && !action && method === 'DELETE') {
            const revision = url.searchParams.get('revision');
            if (!revision || !/^\d+$/.test(revision) || !Number.isSafeInteger(Number(revision))) throw new HttpError(400, 'INVALID_INPUT');
            send(response, 200, sources.disconnect(actor, id, Number(revision)));
        } else if (id && identifier.test(id) && action === 'reconnect' && method === 'POST') {
            const input = await body(connectionReconnect);
            const result = await sources.reconnect(actor, id, input, signal());
            if (!response.destroyed) send(response, 200, result);
        } else if (id && identifier.test(id) && action === 'test' && method === 'POST') {
            const input = await body(z.object({ branch }).strict());
            const result = await sources.testConnection(actor, id, input.branch, signal());
            if (!response.destroyed) send(response, 200, result);
        } else return false;
        return true;
    }
    if (collection === 'repositories') {
        if (!id && method === 'POST') {
            const input = await body(repositoryInput);
            send(response, 201, sources.createBinding(actor, input.connectionId, input.name, input.branch));
        } else if (id && project.test(id) && !action && method === 'GET') {
            send(response, 200, sources.details(actor, id));
        } else if (id && project.test(id) && action === 'automation' && method === 'PUT') {
            send(response, 200, sources.configureAutomation(actor, id, await body(automationInput)));
        } else if (id && project.test(id) && action === 'sync' && method === 'POST') {
            const input = await body(syncInput);
            if (response.destroyed) return true;
            const result = input.retryRunId ? sources.retry(actor, id, input.retryRunId) : await sources.sync(actor, id, signal());
            if (!response.destroyed) send(response, 202, result);
        } else return false;
        return true;
    }
    return false;
}
