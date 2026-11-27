import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { readPayload } from './http-body.js';
import { HttpError, send } from './http-error.js';
import type { IdentityHttp } from './identity-http.js';
import type { IdentityDirectory } from './identity.js';
import { mcpServiceRequest, registerServiceTools } from './mcp-service-tools.js';
import { RepoGraphClient } from './service-client.js';
import { localHost, sameBrowserOrigin } from './web.js';

export const mcpHttpEnabled = process.env.REPOGRAPH_REMOTE_MCP === '1';
const message = z.object({ jsonrpc: z.literal('2.0') }).passthrough();
const bearer = /^Bearer ([A-Za-z0-9._~-]{24,256})$/;
let active = 0;

export async function handleMcpHttp(request: IncomingMessage, response: ServerResponse, pathname: string,
    auth: IdentityHttp, identity: IdentityDirectory) {
    if (pathname !== '/mcp') return false;
    if (!mcpHttpEnabled) throw new HttpError(404, 'MCP_HTTP_DISABLED');
    if (!localHost(request) || (request.headers.origin !== undefined && !sameBrowserOrigin(request))) throw new HttpError(403, 'ORIGIN_FORBIDDEN');
    const secret = bearer.exec(request.headers.authorization ?? '')?.[1];
    const principal = secret && auth.principal(request);
    if (!principal || principal.session) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        throw new HttpError(401, 'AUTHENTICATION_REQUIRED');
    }
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST, GET');
        send(response, 405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed' } });
        return true;
    }
    if (active >= 32) throw new HttpError(503, 'MCP_HTTP_CAPACITY');
    active++;
    try {
        const input = await readPayload(request, message, 128 * 1024);
        if (response.destroyed) return true;
        identity.requireCurrent(principal.account);
        const client = new RepoGraphClient({ REPOGRAPH_BASE_URL: 'http://127.0.0.1:' + request.socket.localPort, REPOGRAPH_ACCESS_TOKEN: secret });
        const server = new McpServer({ name: 'repograph', version: '0.1.0' });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        registerServiceTools(server, mcpServiceRequest(client, () => { identity.requireCurrent(principal.account); }), true);
        try {
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('X-Content-Type-Options', 'nosniff');
            await server.connect(transport);
            await transport.handleRequest(request, response, input);
        } finally { await server.close(); }
        return true;
    } finally { active--; }
}
