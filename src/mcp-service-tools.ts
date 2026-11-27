import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HttpError } from './http-error.js';
import type { RepoGraphClient } from './service-client.js';
import { serviceOperations } from './service-contract.js';
import type { ServiceQuery } from './service-contract.js';

export function mcpServiceRequest(client: RepoGraphClient, reauthorize?: () => void) {
    return async (path: string, parameters: ServiceQuery = {}, signal?: AbortSignal, method = 'GET', payload?: string,
        options?: { feature?: string; key?: string; structured?: boolean }) => {
        try {
            const unavailable = options?.feature ? await client.checkFeature(options.feature, signal) : undefined;
            const result = unavailable ?? await client.request(path, parameters, signal, method, payload, options?.key);
            reauthorize?.();
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(result.body) }],
                isError: !result.ok,
                ...(options?.structured ? { structuredContent: { status: result.status, body: result.body,
                    ...(result.requestId ? { requestId: result.requestId } : {}) } } : {})
            };
        } catch (error) {
            const known = error instanceof HttpError ? { status: error.status, body: { error: error.message } } : undefined;
            return { content: [{ type: 'text' as const, text: known ? JSON.stringify(known.body) : 'RepoGraph application request failed or timed out.' }],
                isError: true, ...(known && options?.structured ? { structuredContent: known } : {}) };
        }
    };
}

const knowledgeTools = new Set<keyof typeof serviceOperations>([
    'list_knowledge_snapshots', 'read_snapshot_source', 'read_snapshot_manifest', 'list_wiki_pages', 'read_wiki_page',
    'search_scoped', 'search_knowledge'
]);

export function registerServiceTools(server: McpServer, request: ReturnType<typeof mcpServiceRequest>, knowledgeOnly = false) {
    server.registerTool('get_service_capabilities', {
        description: 'Read the connected service’s protocol version, scope support and supported operations.',
        inputSchema: {}
    }, (_, { signal }) => request('/capabilities', {}, signal, 'GET', undefined, { structured: true }));

    if (knowledgeOnly) server.registerTool('list_projects', {
        description: 'List the repositories readable with the current credential.', inputSchema: {}
    }, (_, { signal }) => request('/projects', { summary: true }, signal, 'GET', undefined, { structured: true }));

    for (const [name, spec] of Object.entries(serviceOperations)) {
        if (knowledgeOnly && !knowledgeTools.has(name as keyof typeof serviceOperations)) continue;
        server.registerTool(name, { description: spec.description, inputSchema: spec.input }, (args, { signal }) => {
            const call = spec.request(args);
            return request(call.path, call.query, signal, call.method, JSON.stringify(call.body),
                { feature: call.feature ?? spec.feature, key: call.idempotencyKey, structured: true });
        });
    }
}
