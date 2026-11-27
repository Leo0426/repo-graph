import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parse, readIndexedFile } from '../dist/source.js';

const projectId = root => createHash('sha256').update(root).digest('hex').slice(0, 12);

test('stdio clients negotiate new scope operations with older services before submitting them', { timeout: 10_000 }, async t => {
    const requests = [];
    const service = createServer((request, response) => {
        const path = new URL(request.url, 'http://localhost').pathname;
        requests.push(path);
        response.setHeader('Content-Type', 'application/json');
        if (path === '/api/v1/search/keyword') response.end('[]');
        else response.writeHead(404).end('{"error":"NOT_FOUND"}');
    }).listen(0, '127.0.0.1');
    await once(service, 'listening');
    t.after(() => new Promise(resolve => service.close(resolve)));
    const client = new Client({ name: 'old-service', version: '1.0.0' });
    try {
        await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/mcp.js'], stderr: 'pipe',
            env: { REPOGRAPH_BASE_URL: 'http://127.0.0.1:' + service.address().port, REPOGRAPH_ACCESS_TOKEN: randomBytes(24).toString('hex') } }));
        const unsupported = await client.callTool({ name: 'search_scoped', arguments: {
            query: 'symbol', scopes: [{ projectId: 'a'.repeat(12) }, { projectId: 'b'.repeat(12) }]
        } });
        assert.equal(unsupported.isError, true);
        assert.deepEqual(unsupported.structuredContent.body, { error: 'SERVICE_CAPABILITY_UNAVAILABLE', feature: 'scopedSearch' });
        const unsupportedWrite = await client.callTool({ name: 'update_project_space', arguments: {
            spaceId: '01234567-89ab-4def-8123-456789abcdef', revision: 0, maxRepositories: 4
        } });
        assert.deepEqual(unsupportedWrite.structuredContent.body, { error: 'SERVICE_CAPABILITY_UNAVAILABLE', feature: 'spaceAdministration' });
        const existing = await client.callTool({ name: 'search_keyword', arguments: { query: 'symbol' } });
        assert.equal(existing.isError, false);
        assert.deepEqual(requests, ['/api/v1/capabilities', '/api/v1/capabilities', '/api/v1/search/keyword']);
    } finally { await client.close(); }
});

test('source parsing preserves stable IDs, line locations and Markdown sections', () => {
    const units = parse('example', 'source.ts', 'typescript',
        'export class Greeter {\n  greet() { return "hello"; }\n}\n');
    assert.deepEqual(units.map(unit => [unit.kind, unit.qualifiedName, unit.startLine, unit.endLine]), [
        ['CLASS', 'Greeter', 1, 3], ['METHOD', 'Greeter.greet', 2, 2]
    ]);
    assert.equal(units[1].parentQualifiedName, 'Greeter');
    assert.equal(units[1].id, createHash('sha256').update('examplesource.tsMETHODGreeter.greet').digest('hex'));
    assert.deepEqual(parse('example', 'empty.ts', 'typescript', '  \n'), []);
    const [javascript] = parse('example', 'format.js', 'javascript', 'export const format = value => String(value);');
    assert.equal(javascript.qualifiedName, 'format');
    assert.equal(javascript.language, 'javascript');
    assert.throws(() => parse('example', 'bad.ts', 'typescript', 'function broken( {'), /SYNTAX_ERROR/);

    const docs = parse('example', 'Guide.md', 'doc', [
        '# Guide', 'Opening', '```sh', '# sample', '```', '## Install', 'Setup', '## Install', 'Update'
    ].join('\n'));
    assert.deepEqual(docs.map(unit => [unit.qualifiedName, unit.startLine, unit.endLine]), [
        ['Guide.md#Guide', 1, 5], ['Guide.md#Install', 6, 7], ['Guide.md#Install-L8', 8, 9]
    ]);
});

test('explicit heuristic mode retains line-based declarations across supported source families', async () => {
    const samples = [
        ['Sample.java', 'java', 'public class Sample {\n    public void render() { }\n}', ['Sample', 'render']],
        ['record.c', 'c', 'struct Pair { int first; };\nint make(void) { return 1; }', ['Pair', 'make']],
        ['record.cpp', 'cpp', 'class Pair {};\nint Pair::count() const { return 2; }', ['Pair', 'count']],
        ['report.py', 'python', 'def describe():\n    """Description\n    is retained"""\nclass Report:\n    pass\n', ['describe', 'Report']],
        ['format.js', 'javascript', 'export const format = (value) => { return value; };', ['format']]
    ];
    for (const [file, language, source, names] of samples) {
        const result = await readIndexedFile('fixture', file, language, Buffer.from(source), 'heuristic', false);
        assert.deepEqual(result.units.map(unit => unit.simpleName), names, file);
        assert.ok(result.units.every(unit => unit.metadata.heuristic === 'true' && unit.rawSource.includes(unit.simpleName)));
        assert.deepEqual(result.edges, []);
        if (language === 'python') {
            assert.equal(result.units[0].endLine, 3);
            assert.match(result.units[0].rawSource, /is retained"""/);
        }
    }
});

test('REST and stdio MCP share an isolated and persistent repository index', { timeout: 30_000 }, async t => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'repograph-test-')));
    const workspace = join(directory, 'workspace');
    const alpha = join(workspace, 'alpha');
    const beta = join(workspace, 'beta');
    const outside = join(directory, 'outside');
    const env = {
        ...process.env,
        REPOGRAPH_EMBEDDING_MODEL: undefined,
        REPOGRAPH_ACCESS_TOKEN: randomBytes(32).toString('hex'),
        REPOGRAPH_PROJECTS_ROOT: workspace,
        REPOGRAPH_DB_PATH: join(directory, 'database', 'index.db'),
        REPOGRAPH_PORT: '0'
    };
    const processes = new Set();
    t.after(async () => {
        for (const child of processes) {
            if (child.exitCode === null && child.signalCode === null) {
                const exited = once(child, 'exit');
                child.kill('SIGTERM');
                await exited;
            }
        }
        await rm(directory, { recursive: true, force: true });
    });
    await Promise.all([alpha, beta, outside].map(path => mkdir(path, { recursive: true })));
    await Promise.all([
        writeFile(join(alpha, 'shared.ts'), [
            'import { format as formatMessage } from "./message.js";',
            'export function greet() { return formatMessage(answer()); }',
            'function answer() { return "alphaMessage"; }',
            ''
        ].join('\n')),
        writeFile(join(alpha, 'message.ts'), [
            'export function format(value: string) { return value; }',
            'export interface Repository {}',
            ''
        ].join('\n')),
        writeFile(join(alpha, 'hierarchy.ts'), [
            'import type { Repository } from "./message.js";',
            'class Base implements Repository {}',
            'class Concrete extends Base {}',
            ''
        ].join('\n')),
        writeFile(join(beta, 'shared.ts'), 'export function greet() { return "betaMessage"; }\n'),
        writeFile(join(beta, 'message.ts'), 'export function format() { return "otherProject"; }\n'),
        writeFile(join(alpha, 'test.spec.ts'), 'function greetTest() { return "testMessage"; }\n'),
        writeFile(join(alpha, 'guide.md'), `# Setup\nIndex instructions.\n${'x'.repeat(1800)}\n`),
        writeFile(join(outside, 'private.ts'), 'function outsideFile() {}\n')
    ]);
    await symlink(outside, join(alpha, 'escape'));

    async function startServer() {
        const child = spawn(process.execPath, ['dist/server.js'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
        processes.add(child);
        const base = await new Promise((resolve, reject) => {
            let stderr = '';
            child.once('error', reject);
            child.once('exit', code => reject(new Error(`Server exited (${code}): ${stderr}`)));
            child.stderr.on('data', chunk => {
                stderr += chunk.toString();
                const address = stderr.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
                if (address) resolve(address);
            });
        });
        return {
            base,
            async stop() {
                const exited = once(child, 'exit');
                child.kill('SIGTERM');
                assert.deepEqual(await exited, [0, null]);
                processes.delete(child);
            }
        };
    }

    let server = await startServer();
    async function api(path, parameters = {}, method = 'GET', authorized = true, input) {
        const response = await fetch(`${server.base}/api/v1${path}?${new URLSearchParams(parameters)}`, {
            method,
            headers: { ...(authorized ? { Authorization: `Bearer ${env.REPOGRAPH_ACCESS_TOKEN}` } : {}),
                ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: JSON.stringify(input)
        });
        return { status: response.status, body: await response.json() };
    }

    async function finish(root) {
        for (let attempt = 0; attempt < 100; attempt++) {
            const { body, status } = await api('/index/project/status', { projectRoot: root });
            assert.equal(status, 200);
            if (body.status !== 'running') return body;
            await delay(20);
        }
        assert.fail('Index did not reach a terminal state');
    }

    assert.equal((await api('/projects', {}, 'GET', false)).status, 401);
    const homepage = await fetch(server.base);
    assert.equal(homepage.status, 200);
    assert.match(homepage.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const markup = await homepage.text();
    assert.match(markup, /id="repositories-title"[^>]*>Repositories/);
    assert.match(markup, /data-document-reader id="wiki-content"/);
    assert.match(markup, /id="login"[\s\S]*?data-language\s+aria-label="Switch to Chinese"[\s\S]*?<\/header>/);
    assert.match((await fetch(`${server.base}/workbench.js`)).headers.get('content-type'), /javascript/);
    assert.match((await fetch(`${server.base}/web-locale.js`)).headers.get('content-type'), /javascript/);
    assert.match((await fetch(`${server.base}/document-reader.js`)).headers.get('content-type'), /javascript/);
    assert.match((await fetch(`${server.base}/document-reader.css`)).headers.get('content-type'), /text\/css/);
    assert.match((await fetch(`${server.base}/workbench.css`)).headers.get('content-type'), /text\/css/);
    assert.equal((await fetch(`${server.base}/workbench-assets/brand.svg`)).headers.get('content-type'), 'image/svg+xml');
    assert.ok(!markup.includes(env.REPOGRAPH_ACCESS_TOKEN));
    const signIn = await fetch(`${server.base}/api/v1/web/session`, {
        method: 'POST',
        headers: { Origin: server.base, Authorization: `Bearer ${env.REPOGRAPH_ACCESS_TOKEN}` }
    });
    assert.equal(signIn.status, 200);
    const sessionCookie = signIn.headers.get('set-cookie');
    assert.match(sessionCookie, /HttpOnly.*SameSite=Strict/);
    const cookie = sessionCookie.split(';')[0];
    const projectList = await fetch(`${server.base}/api/v1/projects`, { headers: { Cookie: cookie } });
    assert.equal(projectList.status, 200);
    const sessionCsrf = await fetch(`${server.base}/api/v1/auth/csrf`, { headers: { Cookie: cookie } }).then(response => response.json());
    const crossOrigin = await fetch(`${server.base}/api/v1/index/project?projectRoot=${encodeURIComponent(alpha)}`, {
        method: 'POST', headers: { Cookie: cookie, Origin: 'https://example.invalid' }
    });
    assert.equal(crossOrigin.status, 403);
    const signOut = await fetch(`${server.base}/api/v1/web/session`, {
        method: 'DELETE', headers: { Origin: server.base, Cookie: cookie, 'X-CSRF-Token': sessionCsrf.token }
    });
    assert.equal(signOut.status, 200);
    assert.equal((await fetch(`${server.base}/api/v1/projects`, { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await api('/index/project', { projectRoot: outside }, 'POST')).status, 403);
    assert.equal((await api('/index/project', { projectRoot: join(alpha, 'escape') }, 'POST')).status, 403);
    assert.equal((await api('/index/project', { projectRoot: alpha, lang: 'unsupported-fixture-language' }, 'POST')).status, 400);
    for (const root of [alpha, beta]) {
        assert.equal((await api('/index/project', { projectRoot: root }, 'POST')).status, 202);
        const indexed = await finish(root);
        assert.equal(indexed.status, 'done');
        assert.equal(indexed.totalEdges, root === alpha ? 4 : 0);
    }
    const alphaId = projectId(alpha);
    const betaId = projectId(beta);
    const contract = await api('/capabilities');
    assert.equal(contract.status, 200);
    assert.equal(contract.body.apiVersion, 1);
    assert.equal(contract.body.features.scopedSearch, true);
    assert.ok(contract.body.scopes.includes('publishedSnapshot'));
    const overview = await api(`/projects/${alphaId}/stats`);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.totalFiles, 5);
    assert.equal(overview.body.totalUnits, 8);
    assert.deepEqual(overview.body.languageDistribution, { doc: 1, typescript: 7 });
    assert.deepEqual(overview.body.edgeKindDistribution, { CALLS: 2, EXTENDS: 1, IMPLEMENTS: 1 });
    const callees = await api('/graph/callees', { target: 'greet', projectId: alphaId, depth: 1 });
    assert.equal(callees.status, 200);
    assert.deepEqual(callees.body.map(unit => unit.qualifiedName), ['answer', 'format']);
    const diagram = await api('/graph/callees', { target: 'greet', projectId: alphaId, depth: 1, diagram: true });
    assert.equal(diagram.body.root.qualifiedName, 'greet');
    assert.deepEqual(diagram.body.connections, callees.body.map(unit => ({
        source: diagram.body.root.id, target: unit.id, depth: 1
    })));
    const implementations = await api('/graph/subtypes', { target: 'Repository', projectId: alphaId });
    assert.equal(implementations.status, 200);
    assert.deepEqual(implementations.body.map(unit => unit.qualifiedName), ['Base']);
    const impact = await api('/graph/impact', { target: 'Repository', projectId: alphaId });
    assert.equal(impact.status, 200);
    assert.deepEqual(impact.body.map(unit => unit.qualifiedName), ['Base', 'Concrete']);
    assert.equal((await api('/graph/callees', { target: 'greet' })).status, 409);
    assert.deepEqual((await api('/graph/callees', { target: 'greet', projectId: betaId })).body, []);
    const candidates = await api('/graph/symbols', { q: 'FORMA', projectId: alphaId });
    assert.equal(candidates.status, 200);
    assert.deepEqual(candidates.body.map(unit => unit.qualifiedName), ['format']);
    const exactTarget = await api('/graph/callers', { target: candidates.body[0].id });
    assert.deepEqual(exactTarget.body.map(unit => unit.qualifiedName), ['greet']);
    const pack = await api('/context/pack', { q: 'formatMessage', projectId: alphaId, budgetChars: 1000 });
    assert.equal(pack.status, 200);
    assert.deepEqual(pack.body.omittedReasons, ['EMBEDDING_DISABLED']);
    const calleeEvidence = pack.body.evidence.find(item => item.qualifiedName === 'format');
    assert.equal(calleeEvidence.source, 'CALL_GRAPH');
    assert.equal(calleeEvidence.relation, 'CALLEE');
    assert.equal(calleeEvidence.projectId, alphaId);
    assert.match(calleeEvidence.excerpt, /return value/);
    assert.ok(pack.body.usedBudgetChars <= 1000);
    const budgeted = await api('/context/pack', { q: 'instructions', projectId: alphaId, budgetChars: 1000 });
    assert.equal(budgeted.body.evidence[0].citationId, 'C1');
    assert.equal(budgeted.body.evidence[0].truncated, true);
    assert.equal(budgeted.body.evidence[0].excerpt.length, 1000);
    assert.equal(budgeted.body.usedBudgetChars, 1000);
    assert.deepEqual((await api('/projects')).body.map(project => project.projectId), [alphaId, betaId].sort());
    const summarized = (await api('/projects', { summary: true })).body.find(project => project.projectId === alphaId);
    assert.deepEqual([summarized.fileCount, summarized.mainLanguage, summarized.indexStatus], [5, 'typescript', 'done']);
    assert.equal((await api('/symbol/greet')).status, 409);
    assert.match((await api('/symbol/greet', { projectId: alphaId })).body.rawSource, /answer\(\)/);
    assert.match((await api('/locate', { projectId: betaId, file: 'shared.ts', line: 1 })).body.rawSource, /betaMessage/);
    assert.equal((await api('/search/keyword', { projectId: betaId, q: 'alphaMessage' })).body.length, 0);
    assert.equal((await api('/search/keyword', { projectId: alphaId, q: 'outsideFile' })).body.length, 0);
    assert.equal((await api('/search/keyword', { projectId: alphaId, q: 'testMessage' })).body.length, 0);
    assert.equal((await api('/search/keyword', { projectId: alphaId, q: 'testMessage', noTest: 'false' })).body.length, 1);

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['dist/mcp.js'],
        env: { REPOGRAPH_BASE_URL: server.base, REPOGRAPH_ACCESS_TOKEN: env.REPOGRAPH_ACCESS_TOKEN },
        stderr: 'pipe'
    });
    const client = new Client({ name: 'repograph-test', version: '1.0.0' });
    try {
        await client.connect(transport);
        const catalog = await client.listTools();
        for (const name of ['find_callers', 'find_callees', 'find_subtypes', 'get_impact']) {
            assert.ok(catalog.tools.some(tool => tool.name === name), name);
        }
        const discovery = await client.callTool({ name: 'get_service_capabilities' });
        assert.deepEqual(discovery.structuredContent.body, contract.body);
        const wiki = await client.callTool({ name: 'submit_wiki', arguments: { projectId: alphaId, key: 'stdio-wiki' } });
        assert.equal(wiki.structuredContent.status, 202);
        const { agentRunId } = wiki.structuredContent.body;
        const replay = await client.callTool({ name: 'submit_wiki', arguments: { projectId: alphaId, key: 'stdio-wiki' } });
        assert.equal(replay.structuredContent.body.agentRunId, agentRunId);
        let complete;
        for (let attempt = 0; attempt < 100; attempt++) {
            complete = (await api('/agent-runs/' + agentRunId, { projectId: alphaId })).body;
            if (!['RUNNING', 'QUEUED'].includes(complete.status)) break;
            await delay(20);
        }
        assert.equal(complete.status, 'COMPLETED');
        const [snapshot] = (await api('/knowledge-snapshots', { projectId: alphaId })).body;
        const scope = { projectId: alphaId, snapshotId: snapshot.id };
        const source = await client.callTool({ name: 'read_snapshot_source', arguments: { ...scope, file: 'shared.ts' } });
        assert.deepEqual(source.structuredContent.body, (await api('/knowledge-snapshots/' + snapshot.id + '/source',
            { projectId: alphaId, file: 'shared.ts' })).body);
        const scoped = await client.callTool({ name: 'search_scoped', arguments: { query: 'greet', method: 'keyword', scopes: [scope] } });
        assert.equal(scoped.structuredContent.status, 200);
        assert.ok(scoped.structuredContent.body.results.some(hit => hit.snapshotId === snapshot.id));
        const knowledgeArgs = { query: 'greet', method: 'keyword', scopes: [{ kind: 'repository', ...scope }] };
        const knowledge = await client.callTool({ name: 'search_knowledge', arguments: knowledgeArgs });
        assert.equal(knowledge.structuredContent.status, 200);
        assert.ok(knowledge.structuredContent.body.results.some(hit => hit.snapshotId === snapshot.id && hit.kind === 'SOURCE'));
        const cliKnowledge = await promisify(execFile)(process.execPath, ['dist/cli.js', 'search_knowledge', JSON.stringify(knowledgeArgs)],
            { env: { ...env, REPOGRAPH_BASE_URL: server.base } });
        assert.deepEqual(JSON.parse(cliKnowledge.stdout), knowledge.structuredContent.body);
        const space = await api('/spaces', {}, 'POST', true, { name: 'CLI space' });
        assert.equal(space.status, 201);
        const generated = await client.callTool({ name: 'generate_space_document', arguments: { spaceId: space.body.id,
            target: { name: 'Notes.md' }, instruction: 'Write notes', key: 'disabled-space-generation' } });
        assert.equal(generated.structuredContent.status, 409);
        assert.equal(generated.structuredContent.body.error, 'GENERATION_DISABLED');
        const spaceId = space.body.id;
        const settings = await client.callTool({ name: 'update_project_space', arguments: { spaceId, revision: 0, maxRepositories: 3 } });
        assert.equal(settings.structuredContent.status, 200);
        assert.equal(settings.structuredContent.body.maxRepositories, 3);
        const linked = await client.callTool({ name: 'link_space_repository', arguments: { spaceId, ...scope,
            revision: settings.structuredContent.body.revision } });
        assert.equal(linked.structuredContent.status, 200);
        const removeArgs = { spaceId, projectId: alphaId, revision: linked.structuredContent.body.revision };
        const cliDetach = await promisify(execFile)(process.execPath, ['dist/cli.js', 'unlink_space_repository', JSON.stringify(removeArgs)],
            { env: { ...env, REPOGRAPH_BASE_URL: server.base } });
        const detach = JSON.parse(cliDetach.stdout);
        const memberships = await client.callTool({ name: 'list_detached_space_repositories', arguments: { spaceId } });
        assert.deepEqual(memberships.structuredContent.body, [scope]);
        const relinked = await client.callTool({ name: 'restore_space_repository', arguments: { ...removeArgs, revision: detach.revision } });
        assert.equal(relinked.structuredContent.status, 200);
        assert.deepEqual((await api('/spaces/' + spaceId)).body.repositories, [scope]);
        const dropped = await client.callTool({ name: 'unlink_space_repository', arguments: { ...removeArgs, revision: relinked.structuredContent.body.revision } });
        assert.equal(dropped.structuredContent.status, 200);
        const cli = await promisify(execFile)(process.execPath, ['dist/cli.js', 'read_snapshot_source', JSON.stringify({ ...scope, file: 'shared.ts' })],
            { env: { ...env, REPOGRAPH_BASE_URL: server.base } });
        assert.deepEqual(JSON.parse(cli.stdout), source.structuredContent.body);
        const result = await client.callTool({ name: 'search_keyword', arguments: { query: 'greet', projectId: betaId } });
        assert.equal(result.isError, false);
        assert.deepEqual(JSON.parse(result.content[0].text).map(hit => hit.projectId), [betaId]);
        const callers = await client.callTool({
            name: 'find_callers', arguments: { target: 'format', projectId: alphaId }
        });
        assert.equal(callers.isError, false);
        assert.deepEqual(JSON.parse(callers.content[0].text).map(unit => unit.qualifiedName), ['greet']);
        const context = await client.callTool({
            name: 'build_context_pack', arguments: { query: 'formatMessage', projectId: alphaId, budgetChars: 1000 }
        });
        assert.equal(context.isError, false);
        assert.deepEqual(JSON.parse(context.content[0].text).evidence, pack.body.evidence);
        const triggered = await client.callTool({ name: 'trigger_index', arguments: { projectRoot: beta, strategy: 'heuristic' } });
        assert.equal(triggered.isError, false);
        assert.equal((await finish(beta)).totalEdges, 0);
        const fromMcp = await api('/symbol/' + encodeURIComponent('shared.ts#greet@L1'), { projectId: betaId });
        assert.equal(fromMcp.body.metadata.heuristic, 'true');
        assert.equal((await api('/index/project', { projectRoot: beta, strategy: 'precise' }, 'POST')).status, 202);
        assert.equal((await finish(beta)).status, 'done');
    } finally {
        await client.close();
    }

    await server.stop();
    server = await startServer();
    assert.equal((await finish(alpha)).status, 'done');
    assert.equal((await api('/index/project', { projectRoot: alpha }, 'POST')).status, 202);
    assert.equal((await finish(alpha)).skippedFiles, 5);
    await rm(join(alpha, 'message.ts'));
    assert.equal((await api('/index/project', { projectRoot: alpha }, 'POST')).status, 202);
    const afterRemoval = await finish(alpha);
    assert.equal(afterRemoval.skippedFiles, 4);
    assert.equal(afterRemoval.totalEdges, 2);
    assert.deepEqual((await api('/graph/callees', { target: 'greet', projectId: alphaId })).body
        .map(unit => unit.qualifiedName), ['answer']);
    await writeFile(join(alpha, 'shared.ts'), 'export function broken( {\n');
    assert.equal((await api('/index/project', { projectRoot: alpha }, 'POST')).status, 202);
    const failedFile = await finish(alpha);
    assert.equal(failedFile.status, 'partial');
    assert.deepEqual(failedFile.errors, ['shared.ts: SYNTAX_ERROR']);
    assert.match((await api('/symbol/greet', { projectId: alphaId })).body.rawSource, /answer\(\)/);

    await writeFile(join(alpha, 'shared.ts'), 'export function replacement() {}\n');
    assert.equal((await api('/index/project', { projectRoot: alpha, lang: 'typescript' }, 'POST')).status, 202);
    const updated = await finish(alpha);
    assert.equal((await api('/search/keyword', { projectId: alphaId, q: 'instructions' })).body.length, 1);
    await rm(join(alpha, 'guide.md'));
    assert.equal((await api('/index/project', { projectRoot: alpha, lang: 'typescript' }, 'POST')).status, 202);
    assert.equal((await finish(alpha)).status, 'done');
    assert.equal(updated.status, 'done');
    assert.equal(updated.parsedFiles, 1);
    assert.equal((await api('/symbol/greet', { projectId: alphaId })).status, 404);
    assert.equal((await api('/search/keyword', { projectId: alphaId, q: 'instructions' })).body.length, 0);
    assert.equal((await api('/search/keyword', { projectId: alphaId, q: 'replacement' })).body.length, 1);
    assert.equal((await api('/index/project', { projectId: alphaId }, 'DELETE')).status, 200);
    assert.equal((await api('/search/keyword', { projectId: alphaId, q: 'replacement' })).status, 404);
    assert.deepEqual((await api('/search/keyword', { q: 'replacement' })).body, []);
    assert.equal((await api('/index/project/status', { projectRoot: alpha })).status, 404);
    const retirement = '/projects/' + alphaId + '/lifecycle';
    const rejectedPurge = await fetch(server.base + '/api/v1' + retirement, { method: 'POST',
        headers: { Authorization: 'Bearer ' + env.REPOGRAPH_ACCESS_TOKEN, 'Content-Type': 'application/json', 'Idempotency-Key': 'purge-too-soon' },
        body: JSON.stringify({ action: 'purge', revision: 1 }) });
    assert.equal((await rejectedPurge.json()).error, 'PROJECT_RETENTION_ACTIVE');
    assert.equal((await api('/symbol/greet', { projectId: betaId })).status, 200);
    const betaFile = { projectRoot: beta, file: join(beta, 'shared.ts') };
    const heuristic = await api('/index/file', { ...betaFile, strategy: 'HEURISTIC' }, 'POST');
    assert.equal(heuristic.status, 200);
    assert.equal(heuristic.body.status, 'done');
    assert.equal(heuristic.body.totalEdges, 0);
    const recovered = await api('/symbol/' + encodeURIComponent('shared.ts#greet@L1'), { projectId: betaId });
    assert.equal(recovered.body.metadata.heuristic, 'true');
    assert.equal((await api('/symbol/greet', { projectId: betaId })).status, 404);
    assert.equal((await api('/index/file', { ...betaFile, strategy: 'heuristic' }, 'POST')).body.skippedFiles, 1);
    assert.equal((await api('/index/file', { ...betaFile, strategy: 'precise' }, 'POST')).body.parsedFiles, 1);
    assert.equal((await api('/symbol/greet', { projectId: betaId })).body.metadata.heuristic, undefined);
    const recoveryFile = join(beta, 'partial.ts');
    const recoveryArgs = { projectRoot: beta, file: recoveryFile };
    const recoverable = '/* function ghost() {} */\r\nexport function present() { return "}"; }\r\nexport function broken( {';
    await writeFile(recoveryFile, recoverable);
    const partialIndex = await api('/index/file', recoveryArgs, 'POST');
    assert.deepEqual([partialIndex.body.status, partialIndex.body.degradedFiles, partialIndex.body.totalUnits, partialIndex.body.totalEdges],
        ['partial', 1, 1, 0]);
    const fallbackPath = '/symbol/' + encodeURIComponent('partial.ts#present@L2');
    const fallback = await api(fallbackPath, { projectId: betaId });
    assert.equal(fallback.body.rawSource, 'export function present() { return "}"; }');
    assert.equal(fallback.body.metadata.heuristic, 'true');
    assert.equal((await api('/index/file', { ...recoveryArgs, strategy: 'precise' }, 'POST')).body.degradedFiles, 0);
    assert.equal((await api('/index/file', recoveryArgs, 'POST')).body.parsedFiles, 1);
    await writeFile(recoveryFile, 'export function present() { return "upgraded"; }');
    assert.equal((await api('/index/file', recoveryArgs, 'POST')).body.status, 'done');
    assert.equal((await api(fallbackPath, { projectId: betaId })).status, 404);
    await writeFile(recoveryFile, recoverable);
    assert.equal((await api('/index/file', recoveryArgs, 'POST')).body.degradedFiles, 0);
    assert.match((await api('/symbol/present', { projectId: betaId })).body.rawSource, /upgraded/);
    const entriesPath = join(beta, 'entries.ts');
    const legacyEntriesPath = join(beta, 'entries.js');
    await writeFile(entriesPath, [
        'export function main(count: number) { return count; }',
        'export const startApp = () => {};',
        'export function prepare() {}',
        'export class Widget { messageListener() {} }',
        'export interface ExpectedIntegration { run(): void; }'
    ].join('\n'));
    await writeFile(legacyEntriesPath, 'export function servePage() {}\nexport const onDoneCallback = () => {};');
    for (const entryFile of [entriesPath, legacyEntriesPath]) {
        assert.equal((await api('/index/file', { projectRoot: beta, file: entryFile }, 'POST')).body.status, 'done');
    }
    const tsEntries = await api('/graph/entrypoints', { projectId: betaId, lang: 'typescript' });
    const jsEntries = await api('/graph/entrypoints', { projectId: betaId, lang: 'javascript' });
    assert.deepEqual(tsEntries.body.map(unit => unit.qualifiedName), ['main', 'startApp', 'Widget.messageListener']);
    assert.deepEqual(jsEntries.body.map(unit => unit.qualifiedName), ['servePage', 'onDoneCallback']);
    assert.equal(tsEntries.body.find(unit => unit.qualifiedName === 'main').metadata.param_types, 'number');

    async function indexBetaFile(name, content) {
        const file = join(beta, name);
        await writeFile(file, content);
        const indexed = await api('/index/file', { projectRoot: beta, file }, 'POST');
        assert.equal(indexed.body.status, 'done');
    }
    async function navigation(kind, target) {
        const result = await api('/graph/' + kind, { target, projectId: betaId, depth: 1 });
        assert.equal(result.status, 200);
        return result.body.map(unit => [unit.qualifiedName, unit.filePath]);
    }
    await indexBetaFile('reexport-client.ts', 'import { launch } from "./reexport-api"; export function invokeLaunch() { return launch(); }');
    await indexBetaFile('reexport-api.ts', 'export { publicLaunch as launch } from "./reexport-mid.js";');
    await indexBetaFile('reexport-mid.ts', 'export { executeLaunch as publicLaunch } from "./reexport-core";');
    assert.deepEqual(await navigation('callees', 'invokeLaunch'), []);
    await indexBetaFile('reexport-core.ts', 'export function executeLaunch() {}');
    assert.deepEqual(await navigation('callees', 'invokeLaunch'), [['executeLaunch', 'reexport-core.ts']]);
    assert.deepEqual(await navigation('callers', 'executeLaunch'), [['invokeLaunch', 'reexport-client.ts']]);

    await indexBetaFile('reexport-mid.ts', 'import { replacementLaunch as next } from "./reexport-replacement.js"; export { next as publicLaunch };');
    assert.deepEqual(await navigation('callees', 'invokeLaunch'), []);
    assert.deepEqual(await navigation('callers', 'executeLaunch'), []);
    await indexBetaFile('reexport-replacement.ts', 'export function replacementLaunch() {}');
    assert.deepEqual(await navigation('callees', 'invokeLaunch'), [['replacementLaunch', 'reexport-replacement.ts']]);

    await indexBetaFile('reexport-mid.ts', 'export { executeLaunch as launch } from "./reexport-core";');
    await indexBetaFile('reexport-cycle.ts', 'export * from "./reexport-api"; export * from "./reexport-mid";');
    const throughStar = 'export * from "./reexport-mid"; export * from "./reexport-cycle";';
    await indexBetaFile('reexport-api.ts', throughStar);
    assert.deepEqual(await navigation('callees', 'invokeLaunch'), [['executeLaunch', 'reexport-core.ts']]);
    await indexBetaFile('reexport-other.ts', 'export { replacementLaunch as launch } from "./reexport-replacement";');
    const withConflict = throughStar + ' export * from "./reexport-other";';
    await indexBetaFile('reexport-api.ts', withConflict);
    assert.deepEqual(await navigation('callees', 'invokeLaunch'), []);
    await indexBetaFile('reexport-other.ts', 'export const launch = 7;');
    assert.deepEqual(await navigation('callees', 'invokeLaunch'), []);
    await indexBetaFile('reexport-api.ts', withConflict + ' export { executeLaunch as launch } from "./reexport-core";');
    assert.deepEqual(await navigation('callees', 'invokeLaunch'), [['executeLaunch', 'reexport-core.ts']]);

    await indexBetaFile('reexport-core.ts', 'export function executeLaunch() {} export interface LaunchContract {}');
    await indexBetaFile('reexport-api.ts', 'export type { executeLaunch as launch, LaunchContract } from "./reexport-core";');
    assert.deepEqual(await navigation('callees', 'invokeLaunch'), []);
    await indexBetaFile('reexport-type.ts', 'import type { LaunchContract } from "./reexport-api"; export interface ClientContract extends LaunchContract {}');
    assert.deepEqual(await navigation('subtypes', 'LaunchContract'), [['ClientContract', 'reexport-type.ts']]);

    await indexBetaFile('reexport-default.ts', 'export default function defaultLaunch() {}');
    await indexBetaFile('reexport-api.ts', 'export * from "./reexport-default"; export { default as launch } from "./reexport-default";');
    assert.deepEqual(await navigation('callees', 'invokeLaunch'), [['defaultLaunch', 'reexport-default.ts']]);
    await indexBetaFile('reexport-default-client.ts', 'import launch from "./reexport-api"; export function invokeDefault() { return launch(); }');
    assert.deepEqual(await navigation('callees', 'invokeDefault'), []);
    await server.stop();
    server = await startServer();
    assert.deepEqual(await navigation('callees', 'invokeLaunch'), [['defaultLaunch', 'reexport-default.ts']]);
    await rm(join(beta, 'reexport-api.ts'));
    assert.equal((await api('/index/project', { projectRoot: beta }, 'POST')).status, 202);
    await finish(beta);
    assert.deepEqual(await navigation('callees', 'invokeLaunch'), []);

    await indexBetaFile('namespace-client.ts', 'import { toolbox as tools } from "./namespace-api"; export function useTools() { return tools.launch(); }');
    await indexBetaFile('namespace-api.ts', 'export * as toolbox from "./namespace-inner";');
    await indexBetaFile('namespace-inner.ts', 'export { namespaceLaunch as launch } from "./namespace-core";');
    assert.deepEqual(await navigation('callees', 'useTools'), []);
    await indexBetaFile('namespace-core.ts', 'export function namespaceLaunch() {}');
    assert.deepEqual(await navigation('callees', 'useTools'), [['namespaceLaunch', 'namespace-core.ts']]);
    assert.deepEqual(await navigation('callers', 'namespaceLaunch'), [['useTools', 'namespace-client.ts']]);

    await indexBetaFile('namespace-layer.ts', 'import * as toolkit from "./namespace-inner"; export { toolkit as inner };');
    await indexBetaFile('namespace-api.ts', 'export * as toolbox from "./namespace-layer";');
    await indexBetaFile('namespace-core.ts', 'export function namespaceLaunch() {} export function namespaceFinish() {} export interface NamespaceShape {}');
    await indexBetaFile('namespace-inner.ts', 'export { namespaceLaunch as launch, namespaceFinish as finish, NamespaceShape as Shape } from "./namespace-core";');
    await indexBetaFile('namespace-client.ts', [
        'import * as publicApi from "./namespace-api";',
        'export function invokeNested() { publicApi.toolbox.inner["launch"](); publicApi.toolbox.inner.finish(); }',
        'export function invokeDynamic(name: string) { return publicApi.toolbox.inner[name](); }',
        'export interface ThroughNamespace extends publicApi.toolbox.inner.Shape {}',
        'export class HoldsNamespaceType { declare value: publicApi.toolbox.inner.Shape; }'
    ].join('\n'));
    const namespaceMethods = [['namespaceFinish', 'namespace-core.ts'], ['namespaceLaunch', 'namespace-core.ts']];
    assert.deepEqual(await navigation('callees', 'invokeNested'), namespaceMethods);
    assert.deepEqual(await navigation('callees', 'invokeDynamic'), []);
    assert.deepEqual(await navigation('subtypes', 'NamespaceShape'), [['ThroughNamespace', 'namespace-client.ts']]);
    assert.ok((await navigation('impact', 'NamespaceShape')).some(([name]) => name === 'HoldsNamespaceType.value'));

    await indexBetaFile('namespace-left.ts', 'export * as toolbox from "./namespace-layer";');
    await indexBetaFile('namespace-right.ts', 'export * as toolbox from "./namespace-empty";');
    await indexBetaFile('namespace-empty.ts', 'export const notAMember = 1;');
    const namespaceStars = 'export * from "./namespace-left"; export * from "./namespace-right";';
    await indexBetaFile('namespace-api.ts', namespaceStars);
    assert.deepEqual(await navigation('callees', 'invokeNested'), []);
    await indexBetaFile('namespace-right.ts', 'export * as toolbox from "./namespace-layer.js";');
    assert.deepEqual(await navigation('callees', 'invokeNested'), namespaceMethods);
    await indexBetaFile('namespace-api.ts', 'export type * as toolbox from "./namespace-layer";');
    assert.deepEqual(await navigation('callees', 'invokeNested'), []);
    assert.deepEqual(await navigation('subtypes', 'NamespaceShape'), [['ThroughNamespace', 'namespace-client.ts']]);
    await indexBetaFile('namespace-layer.ts', 'export const inner = { launch() {} };');
    assert.deepEqual(await navigation('subtypes', 'NamespaceShape'), []);

    const configPath = join(beta, 'tsconfig.json');
    await writeFile(configPath, '{ "compilerOptions": { "paths": { "@tool/*": ["./alias-primary-*", "./alias-fallback-*"] } } }');
    await indexBetaFile('alias-client.ts', 'import { run } from "@tool/run"; export function invokeAlias() { return run(); }');
    assert.deepEqual(await navigation('callees', 'invokeAlias'), []);
    await indexBetaFile('alias-fallback-run.ts', 'export { aliasTarget as run } from "./alias-core";');
    await indexBetaFile('alias-core.ts', 'export function aliasTarget() {}');
    assert.deepEqual(await navigation('callees', 'invokeAlias'), [['aliasTarget', 'alias-core.ts']]);
    await indexBetaFile('alias-primary-run.ts', 'export const otherName = 7;');
    assert.deepEqual(await navigation('callees', 'invokeAlias'), []);
    await indexBetaFile('alias-primary-run.ts', 'export function run() {}');
    assert.deepEqual(await navigation('callees', 'invokeAlias'), [['run', 'alias-primary-run.ts']]);

    const reindexConfig = () => api('/index/file', { projectRoot: beta, file: configPath }, 'POST');
    await writeFile(configPath, [
        '{ // Configuration comments and trailing commas are valid.',
        '  "compilerOptions": { "paths": { "@tool/*": ["./alias-primary-*"], "@tool/run": ["./alias-fallback-run"], }, },',
        '}'
    ].join('\n'));
    const configUpdate = await reindexConfig();
    assert.equal(configUpdate.status, 200);
    assert.deepEqual([configUpdate.body.status, configUpdate.body.parsedFiles], ['done', 0]);
    assert.deepEqual(await navigation('callees', 'invokeAlias'), [['aliasTarget', 'alias-core.ts']]);
    await writeFile(configPath, '{"compilerOptions": {');
    const brokenConfig = (await reindexConfig()).body;
    assert.equal(brokenConfig.status, 'partial');
    assert.ok(brokenConfig.errors.includes('tsconfig.json: TSCONFIG_INVALID'));
    assert.deepEqual(await navigation('callees', 'invokeAlias'), [['aliasTarget', 'alias-core.ts']]);
    await writeFile(configPath, '{"extends":"../outside-config.json"}');
    assert.ok((await reindexConfig()).body.errors.includes('tsconfig.json: TSCONFIG_EXTENDS_OUTSIDE_ROOT'));
    assert.deepEqual(await navigation('callees', 'invokeAlias'), [['aliasTarget', 'alias-core.ts']]);
    await writeFile(configPath, '{"compilerOptions":{"paths":{"@tool/*":["./alias-primary-*"]}}}');
    assert.equal((await reindexConfig()).body.status, 'done');

    await Promise.all(['nested', 'config'].map(path => mkdir(join(beta, path))));
    await writeFile(join(beta, 'config', 'alias-base.json'), JSON.stringify({ compilerOptions: {
        baseUrl: '..', paths: { '@tool/*': ['./alias-fallback-*'], '@tool/special/*': ['./nested/inner-*'] }
    } }));
    await writeFile(join(beta, 'nested', 'tsconfig.json'), '{"extends":"../config/alias-base"}');
    await indexBetaFile('nested/inner-demo.ts', 'export function nestedTask() {}');
    await indexBetaFile('nested/local-barrel.ts', 'export { nestedTask as work } from "@tool/special/demo";');
    await indexBetaFile('nested/client.ts', [
        'import { work } from "./local-barrel";',
        'import { nestedTask as directTask } from "nested/inner-demo";',
        'export function invokeNestedAlias() { return work(); }',
        'export function invokeWithBaseUrl() { return directTask(); }'
    ].join('\n'));
    await indexBetaFile('alias-root-client.ts', 'import { nestedTask } from "@tool/special/demo"; export function invokeRootAlias() { return nestedTask(); }');
    assert.deepEqual(await navigation('callees', 'invokeNestedAlias'), [['nestedTask', 'nested/inner-demo.ts']]);
    assert.deepEqual(await navigation('callees', 'invokeWithBaseUrl'), [['nestedTask', 'nested/inner-demo.ts']]);
    assert.deepEqual(await navigation('callees', 'invokeRootAlias'), []);
    await server.stop();
    server = await startServer();
    assert.deepEqual(await navigation('callees', 'invokeNestedAlias'), [['nestedTask', 'nested/inner-demo.ts']]);
    await rm(configPath);
    assert.equal((await api('/index/project', { projectRoot: beta, lang: 'typescript' }, 'POST')).status, 202);
    await finish(beta);
    assert.deepEqual(await navigation('callees', 'invokeAlias'), []);
    assert.deepEqual(await navigation('callees', 'invokeNestedAlias'), [['nestedTask', 'nested/inner-demo.ts']]);

    const packagePath = join(beta, 'package.json');
    await writeFile(packagePath, JSON.stringify({
        name: '@fixture/repo', imports: { '#internal': './package-target.js' },
        exports: { './service': './package-target.js' }
    }));
    await indexBetaFile('package-target.ts', 'export function packageTask() {}');
    await indexBetaFile('package-client.ts', [
        'import { packageTask as internal } from "#internal";',
        'import { packageTask as exported } from "@fixture/repo/service";',
        'export function useInternal() { return internal(); }',
        'export function useSelfReference() { return exported(); }'
    ].join('\n'));
    assert.deepEqual(await navigation('callees', 'useInternal'), [['packageTask', 'package-target.ts']]);
    assert.deepEqual(await navigation('callees', 'useSelfReference'), [['packageTask', 'package-target.ts']]);

    await indexBetaFile('package-next.ts', 'export function packageTask() {}');
    await indexBetaFile('package-private.ts', 'export function packageTask() {}');
    const packageConfig = {
        name: '@fixture/repo',
        imports: {
            '#internal': { node: { browser: './missing.js', import: './package-next.js' }, default: './package-target.js' },
            '#feature/*': './package-*.js', '#feature/private': null,
            '#array': ['../outside.js', './package-target.js'],
            '#first-target': ['./missing.js', './package-target.js']
        },
        exports: { './service': { require: './package-next.js', default: './package-target.js' } }
    };
    await writeFile(packagePath, JSON.stringify(packageConfig));
    const packageUpdate = () => api('/index/file', { projectRoot: beta, file: packagePath }, 'POST');
    const packageIndex = await packageUpdate();
    assert.equal(packageIndex.status, 200);
    assert.deepEqual([packageIndex.body.status, packageIndex.body.parsedFiles], ['done', 0]);
    assert.deepEqual(await navigation('callees', 'useInternal'), [['packageTask', 'package-next.ts']]);
    assert.deepEqual(await navigation('callees', 'useSelfReference'), [['packageTask', 'package-target.ts']]);
    await indexBetaFile('package-patterns.ts', [
        'import { packageTask as open } from "#feature/target";',
        'import { packageTask as blocked } from "#feature/private";',
        'import { packageTask as alternative } from "#array";',
        'import { packageTask as missing } from "#first-target";',
        'export function useOpenPattern() { return open(); }',
        'export function useBlockedPattern() { return blocked(); }',
        'export function useArrayAlternative() { return alternative(); }',
        'export function useMissingFirstTarget() { return missing(); }'
    ].join('\n'));
    assert.deepEqual(await navigation('callees', 'useOpenPattern'), [['packageTask', 'package-target.ts']]);
    assert.deepEqual(await navigation('callees', 'useBlockedPattern'), []);
    assert.deepEqual(await navigation('callees', 'useArrayAlternative'), [['packageTask', 'package-target.ts']]);
    assert.deepEqual(await navigation('callees', 'useMissingFirstTarget'), []);

    await mkdir(join(beta, 'package-scope'));
    await writeFile(join(beta, 'package-scope', 'package.json'), JSON.stringify({
        name: '@fixture/child', imports: { '#internal': './task.js' }
    }));
    await indexBetaFile('package-scope/task.ts', 'export function packageTask() {}');
    await indexBetaFile('package-scope/client.ts', [
        'import { packageTask as local } from "#internal";',
        'import { packageTask as parent } from "@fixture/repo/service";',
        'export function useChildInternal() { return local(); }',
        'export function useForeignSelfReference() { return parent(); }'
    ].join('\n'));
    assert.deepEqual(await navigation('callees', 'useChildInternal'), [['packageTask', 'package-scope/task.ts']]);
    assert.deepEqual(await navigation('callees', 'useForeignSelfReference'), []);
    await writeFile(packagePath, '{invalid manifest');
    assert.ok((await packageUpdate()).body.errors.includes('package.json: PACKAGE_JSON_INVALID'));
    assert.deepEqual(await navigation('callees', 'useInternal'), [['packageTask', 'package-next.ts']]);
    await rm(packagePath);
    assert.equal((await api('/index/project', { projectRoot: beta, lang: 'typescript' }, 'POST')).status, 202);
    await finish(beta);
    assert.deepEqual(await navigation('callees', 'useInternal'), []);
    assert.deepEqual(await navigation('callees', 'useChildInternal'), [['packageTask', 'package-scope/task.ts']]);
    await server.stop();
});
