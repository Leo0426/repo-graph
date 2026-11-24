import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { findingFormats, maxFindingBody } from './finding-import.js';
import { feedbackStatus } from './triage-policy.js';

const token = process.env.REPOGRAPH_ACCESS_TOKEN;
const username = process.env.REPOGRAPH_USERNAME;
const password = process.env.REPOGRAPH_PASSWORD;
if (!!username !== !!password || (!token && !username)) {
    throw new Error('Configure REPOGRAPH_USERNAME and REPOGRAPH_PASSWORD, or REPOGRAPH_ACCESS_TOKEN');
}
const app = new URL(process.env.REPOGRAPH_BASE_URL ?? 'http://127.0.0.1:8080');
if (!['http:', 'https:'].includes(app.protocol) || app.username || app.password || app.search || app.hash) {
    throw new Error('REPOGRAPH_BASE_URL must be an HTTP(S) URL without credentials, query or fragment');
}

const server = new McpServer({ name: 'repograph', version: '0.1.0' });
const projectId = z.string().regex(/^[0-9a-f]{12}$/).optional();
const requiredProject = projectId.unwrap();
const fingerprint = z.string().regex(/^[a-f0-9]{16}$/);
const triageVersion = z.string().trim().max(256).optional();
const text = z.string().trim().min(1).max(4096);
const apiPath = (path: string) => new URL(`${app.pathname.replace(/\/$/, '')}/api/v1${path}`, app);
interface Session { cookie: string; csrf: string }
let session: Session | undefined;
let signingIn: Promise<Session> | undefined;

function readCookie(response: Response, name: string) {
    const pair = response.headers.getSetCookie().map(value => value.split(';', 1)[0])
        .find(value => value.startsWith(`${name}=`));
    if (!pair) throw new Error('Account sign-in failed');
    return pair;
}

async function signIn() {
    const deadline = AbortSignal.timeout(8_000);
    const options = { redirect: 'error', signal: deadline } as const;
    const preflight = await fetch(apiPath('/auth/csrf'), options);
    if (!preflight.ok) throw new Error('Account sign-in failed');
    const nonce = readCookie(preflight, 'repograph_csrf');
    const { token: csrf } = await preflight.json();
    const login = await fetch(apiPath('/auth/login'), {
        ...options, method: 'POST', body: JSON.stringify({ username, password }),
        headers: { Cookie: nonce, Origin: app.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }
    });
    if (!login.ok) {
        await login.body?.cancel();
        throw new Error('Account sign-in failed');
    }
    const cookie = readCookie(login, 'repograph_session');
    await login.body?.cancel();
    const current = await fetch(apiPath('/auth/csrf'), { ...options, headers: { Cookie: cookie } });
    if (!current.ok) throw new Error('Account sign-in failed');
    const ready = await current.json();
    if (typeof ready.token !== 'string') throw new Error('Account sign-in failed');
    return { cookie, csrf: ready.token };
}

function getSession() {
    if (session) return session;
    signingIn ??= signIn().then(result => { session = result; return result; })
        .finally(() => { signingIn = undefined; });
    return signingIn;
}

async function request(
    path: string, parameters: Record<string, string | number | boolean | undefined> = {},
    signal?: AbortSignal, method = 'GET', payload?: string
) {
    const url = apiPath(path);
    for (const [key, value] of Object.entries(parameters)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const deadline = AbortSignal.timeout(15_000);
    try {
        const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
        const send = (active: Session | undefined) => fetch(url, {
            method, signal: requestSignal, redirect: 'error', body: payload,
            headers: {
                ...(active ? { Cookie: active.cookie, Origin: app.origin, 'X-CSRF-Token': active.csrf } : { Authorization: `Bearer ${token}` }),
                ...(payload === undefined ? {} : { 'Content-Type': 'application/json' })
            }
        });
        const active = username ? await getSession() : undefined;
        let response = await send(active);
        if (response.status === 401 && active) {
            await response.body?.cancel();
            if (session === active) session = undefined;
            response = await send(await getSession());
        }
        const body: unknown = await response.json();
        return {
            content: [{ type: 'text' as const, text: JSON.stringify(body) }],
            isError: !response.ok
        };
    } catch {
        return {
            content: [{ type: 'text' as const, text: 'RepoGraph application request failed or timed out.' }],
            isError: true
        };
    }
}

server.registerTool('triage_finding', {
    description: 'Review an imported finding by fingerprint or preview supplied Semgrep, SARIF, CodeQL, or Slither JSON with available evidence.',
    inputSchema: z.object({ projectId: requiredProject, fingerprint: fingerprint.optional(),
        format: z.enum(findingFormats).optional(), json: z.string().max(maxFindingBody).optional(),
        codeVersion: triageVersion, ruleVersion: triageVersion, budgetChars: z.number().int().min(1000).max(60_000).optional(),
        maxFindings: z.number().int().min(1).max(50).optional() }).refine(args =>
        args.fingerprint ? args.format === undefined && args.json === undefined : !!args.format && !!args.json,
    'Provide a fingerprint or provide both format and JSON.')
}, ({ fingerprint, json, ...args }, { signal }) => fingerprint
    ? request('/triage/findings/' + fingerprint, { projectId: args.projectId, budgetChars: args.budgetChars }, signal)
    : request('/triage/report', args, signal, 'POST', json));

server.registerTool('record_triage_feedback', {
    description: 'Store a human-provided review decision under your signed-in identity. Supply both versions for future automatic reuse.',
    inputSchema: { projectId: requiredProject, fingerprint, status: feedbackStatus, reason: z.string().max(500).optional(),
        codeVersion: triageVersion, ruleVersion: triageVersion, reviewer: z.string().max(128).optional().describe('Legacy field. The signed-in identity is used.') }
}, (args, { signal }) => request('/triage/feedback', {}, signal, 'POST', JSON.stringify(args)));

server.registerTool('list_triage_feedback', {
    description: 'List human review decisions in an authorized project. Filter optionally by status.',
    inputSchema: { projectId: requiredProject, status: feedbackStatus.optional() }
}, (args, { signal }) => request('/triage/feedback', args, signal));

server.registerTool('list_projects', {
    description: 'List indexed projects and their project IDs.',
    inputSchema: {}
}, (_, { signal }) => request('/projects', {}, signal));

server.registerTool('trigger_index', {
    description: 'Start indexing an approved local directory. Poll index_status for the outcome.',
    inputSchema: { projectRoot: text, lang: text.optional(), includeBytecode: z.boolean().optional(),
        strategy: z.enum(['auto', 'precise', 'heuristic']).optional() }
}, (args, { signal }) => request('/index/project', args, signal, 'POST'));

server.registerTool('index_status', {
    description: 'Read the latest indexing status for a local project root.',
    inputSchema: { projectRoot: text }
}, (args, { signal }) => request('/index/project/status', args, signal));

server.registerTool('search_keyword', {
    description: 'Search indexed symbols, signatures and source by keyword.',
    inputSchema: { query: text, projectId, lang: text.optional(), kind: text.optional(),
        limit: z.number().int().min(1).max(50).optional() }
}, ({ query, ...filters }, { signal }) => request('/search/keyword', { q: query, ...filters }, signal));

const vectorFilters = {
    projectId, lang: text.optional(), kind: text.optional(),
    limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).max(10_000).optional(),
    noTest: z.boolean().optional(), entryOnly: z.boolean().optional()
};

server.registerTool('search_semantic', {
    description: 'Find indexed code units by the semantic similarity of their descriptions.',
    inputSchema: { ...vectorFilters, query: text }
}, ({ query, ...filters }, { signal }) => request('/search/semantic', { q: query, ...filters }, signal));

server.registerTool('search_code', {
    description: 'Find indexed code units similar to a source snippet.',
    inputSchema: { ...vectorFilters, snippet: text }
}, (args, { signal }) => request('/search/code', args, signal));

const retrievalFilters = {
    query: text, projectId, lang: text.optional(),
    limit: z.number().int().min(1).max(20).optional(), depth: z.number().int().min(1).max(3).optional(),
    callGraph: z.boolean().optional(), impactExpansion: z.boolean().optional(),
    rerank: z.boolean().optional(), noTest: z.boolean().optional()
};

server.registerTool('search_graphrag', {
    description: 'Find code using hybrid retrieval and expand its static call graph.',
    inputSchema: retrievalFilters
}, ({ query, ...filters }, { signal }) => request('/search/graphrag', { q: query, ...filters }, signal));

server.registerTool('build_context_pack', {
    description: 'Collect source excerpts with citations under a character budget.',
    inputSchema: {
        ...retrievalFilters, taskType: text.optional(), budgetChars: z.number().int().min(1000).max(60_000).optional()
    }
}, ({ query, ...filters }, { signal }) => request('/context/pack', { q: query, ...filters }, signal));

server.registerTool('lookup_symbol', {
    description: 'Read the source and location of an exact qualified name.',
    inputSchema: { qualified_name: text, projectId }
}, ({ qualified_name, ...filters }, { signal }) =>
    request(`/symbol/${encodeURIComponent(qualified_name)}`, filters, signal));

server.registerTool('locate_at', {
    description: 'Locate the most specific indexed symbol containing a line in a project-relative file.',
    inputSchema: { file: text, line: z.number().int().positive(), projectId, archiveEntry: text.optional() }
}, (args, { signal }) => request('/locate', args, signal));

const graphTarget = { target: text, projectId };
const callTraversal = { ...graphTarget, depth: z.number().int().min(1).max(12).default(1) };

server.registerTool('find_callers', {
    description: 'Find the callers of a symbol, starting with the nearest callers.',
    inputSchema: callTraversal
}, (args, { signal }) => request('/graph/callers', args, signal));

server.registerTool('find_callees', {
    description: 'Find the functions and methods called by a symbol.',
    inputSchema: callTraversal
}, (args, { signal }) => request('/graph/callees', args, signal));

server.registerTool('find_subtypes', {
    description: 'Find direct subclasses and implementations of a type.',
    inputSchema: graphTarget
}, (args, { signal }) => request('/graph/subtypes', args, signal));

server.registerTool('find_entrypoints', {
    description: 'List indexed framework and program entry points, optionally filtered by language.',
    inputSchema: { projectId, lang: text.optional(), limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).max(20_000).optional() }
}, (args, { signal }) => request('/graph/entrypoints', args, signal));

server.registerTool('get_health_report', {
    description: 'Read the indexed code-quality report and unavailable data sources for one project.',
    inputSchema: { projectId: projectId.unwrap() }
}, (args, { signal }) => request('/metrics/report', args, signal));

server.registerTool('list_vulns', {
    description: 'List recorded vulnerability findings for an authorized project, optionally filtered by severity or status.',
    inputSchema: { projectId: projectId.unwrap(), severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN']).optional(),
        status: z.enum(['SUSPECTED', 'CONFIRMED', 'FIXED', 'DISMISSED']).optional(), limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).max(50_000).optional() }
}, (args, { signal }) => request('/vulns', args, signal));

server.registerTool('scan_vuln_code', {
    description: 'Run built-in defensive checks on indexed source in an authorized project and register suspected findings for human review.',
    inputSchema: { projectId: requiredProject, offset: z.number().int().min(0).optional(),
        indexVersion: z.string().regex(/^[a-f0-9]{64}$/).optional() }
}, (args, { signal }) => request('/vulns/scan/code', args, signal, 'POST'));

server.registerTool('scan_dependency_advisories', {
    description: 'Check one authorized project’s Maven and Gradle dependency versions against the local advisory catalog and record suspected matches.',
    inputSchema: { projectId: projectId.unwrap() }
}, (args, { signal }) => request('/vulns/scan/deps', args, signal, 'POST'));

server.registerTool('get_impact', {
    description: 'Find indexed code that depends on a symbol or its members.',
    inputSchema: graphTarget
}, (args, { signal }) => request('/graph/impact', args, signal));

server.registerTool('analyze_flow', {
    description: 'Read the control flow and local data-flow summary of one indexed Java, C, or Python procedure. Java also includes a program dependence graph.',
    inputSchema: graphTarget
}, (args, { signal }) => request('/flow/analyze', args, signal));

server.registerTool('trace_taint', {
    description: 'Trace a parameter through indexed Java calls in an authorized project. Results are static review evidence for data-flow candidates.',
    inputSchema: { source: text, projectId, paramIndex: z.number().int().min(0).max(20).optional(),
        maxDepth: z.number().int().min(1).max(15).optional() }
}, (args, { signal }) => request('/flow/taint', args, signal));

await server.connect(new StdioServerTransport());
