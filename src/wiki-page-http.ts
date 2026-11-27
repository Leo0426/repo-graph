import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { agentRunIdPattern } from './agent-runs.js';
import { GenerationError } from './generation.js';
import { readPayload } from './http-body.js';
import { HttpError, send } from './http-error.js';
import type { Account } from './identity.js';
import type { SummaryDocument } from './wiki.js';
import { wikiArtifactContentTypes } from './wiki-artifacts.js';
import { wikiArtifactFormats } from './wiki-export.js';
import { maxWikiMarkdownBytes } from './wiki-pages.js';
import type { WikiPages } from './wiki-pages.js';

const uuid = z.string().regex(agentRunIdPattern);
const baseInput = z.object({ baseRevisionId: uuid }).strict();
const markdown = z.string().max(maxWikiMarkdownBytes);
const citation = z.object({
    qualifiedName: z.string().min(1).max(4096), filePath: z.string().min(1).max(4096),
    startLine: z.int().min(1), endLine: z.int().min(1)
}).strict();
const sectionEdit = baseInput.extend({ markdown, citations: z.array(citation).max(200).optional() });
const proposal = baseInput.extend({ markdown });
const generate = baseInput.extend({ instruction: z.string().trim().min(1).max(4000) });
const exportInput = z.object({ revisionId: uuid, format: z.enum(wikiArtifactFormats), section: z.int().nonnegative().optional() }).strict();
const resource = /^\/api\/v1\/summaries\/([a-f0-9-]{36})\/(revisions|drafts)(?:\/([a-z0-9-]+))?(?:\/(apply|discard|restore))?$/;
const artifactResource = /^\/api\/v1\/summaries\/([a-f0-9-]{36})\/exports(?:\/([a-f0-9-]{36})(\/download)?)?$/;

export async function handleWikiPage(request: IncomingMessage, response: ServerResponse, url: URL, actor: Account, pages: WikiPages,
    load: (id: string) => SummaryDocument, key: () => string | undefined, signal: () => AbortSignal) {
    const artifact = artifactResource.exec(url.pathname);
    if (artifact) {
        const [, id, item, download] = artifact;
        if (!agentRunIdPattern.test(id) || (item && !agentRunIdPattern.test(item))) throw new HttpError(404, 'NOT_FOUND');
        if (!item && request.method === 'POST') {
            const input = await readPayload(request, exportInput, 2048);
            if (response.destroyed) return true;
            const authorize = () => pages.resolve(load(id), input.revisionId);
            const generated = await pages.artifacts.prepare(authorize(), input.format, input.section, authorize, signal());
            if (!response.destroyed) send(response, 201, generated);
        } else if (!item && request.method === 'GET') {
            const revision = url.searchParams.get('revisionId');
            const offset = url.searchParams.get('offset') ?? '0';
            if (!revision || !agentRunIdPattern.test(revision) || !/^\d{1,8}$/.test(offset)) throw new HttpError(400, 'INVALID_INPUT');
            pages.resolve(load(id), revision);
            send(response, 200, pages.artifacts.list(id, revision, Number(offset)));
        } else if (item && request.method === 'GET') {
            const page = load(id);
            const stored = pages.artifacts.artifact(id, item);
            pages.resolve(page, stored.revisionId);
            if (download) {
                const payload = pages.artifacts.download(stored);
                response.writeHead(200, {
                    'Content-Type': wikiArtifactContentTypes[stored.format],
                    'Content-Disposition': 'attachment; filename="' + stored.filename + '"',
                    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
                }).end(payload);
            } else send(response, 200, stored);
        } else throw new HttpError(404, 'NOT_FOUND');
        return true;
    }
    const match = resource.exec(url.pathname);
    if (!match || !agentRunIdPattern.test(match[1])) return false;
    const [, id, kind, item, action] = match;
    const method = request.method;
    const page = load(id);
    const requireKey = () => {
        const result = key();
        if (!result) throw new HttpError(400, 'WIKI_IDEMPOTENCY_KEY_REQUIRED');
        return result;
    };
    if (kind === 'revisions' && !item && method === 'GET') {
        const raw = url.searchParams.get('offset') ?? '0';
        if (!/^\d{1,8}$/.test(raw)) throw new HttpError(400, 'INVALID_OFFSET');
        send(response, 200, pages.revisions(page, Number(raw)));
    } else if (kind === 'revisions' && !item && method === 'POST') {
        const requestKey = requireKey();
        const { baseRevisionId, ...change } = await readPayload(request, sectionEdit, maxWikiMarkdownBytes * 6 + 2_000_000);
        if (!response.destroyed) send(response, 201, pages.save(actor, load(id), requestKey, baseRevisionId, change));
    } else if (kind === 'revisions' && item && agentRunIdPattern.test(item) && !action && method === 'GET') {
        send(response, 200, pages.resolve(page, item));
    } else if (kind === 'revisions' && item && agentRunIdPattern.test(item) && action === 'restore' && method === 'POST') {
        const requestKey = requireKey();
        const { baseRevisionId } = await readPayload(request, baseInput, 1024);
        if (!response.destroyed) send(response, 201, pages.restore(actor, load(id), requestKey, baseRevisionId, item));
    } else if (kind === 'drafts' && !item && method === 'GET') {
        send(response, 200, pages.drafts(actor, page));
    } else if (kind === 'drafts' && !item && method === 'POST') {
        const requestKey = requireKey();
        const input = await readPayload(request, proposal, maxWikiMarkdownBytes * 6 + 1024);
        if (!response.destroyed) send(response, 201, pages.propose(actor, load(id), requestKey, input.baseRevisionId, input.markdown));
    } else if (kind === 'drafts' && item === 'generate' && !action && method === 'POST') {
        const requestKey = requireKey();
        const input = await readPayload(request, generate, 25_000);
        if (response.destroyed) return true;
        try {
            const draft = await pages.generateDraft(actor, load(id), requestKey, input.baseRevisionId, input.instruction, signal());
            if (!response.destroyed) send(response, 201, draft);
        } catch (error) {
            if (error instanceof GenerationError) throw new HttpError(503, error.message);
            throw error;
        }
    } else if (kind === 'drafts' && item && agentRunIdPattern.test(item) && !action && method === 'GET') {
        send(response, 200, pages.compareDraft(actor, page, item));
    } else if (kind === 'drafts' && item && agentRunIdPattern.test(item) && (action === 'apply' || action === 'discard') && method === 'POST') {
        send(response, 200, pages.review(actor, page, item, requireKey(), action));
    } else throw new HttpError(404, 'NOT_FOUND');
    return true;
}
