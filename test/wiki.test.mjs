import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

test('Wiki generation versions indexed module facts and retains old source citations', { timeout: 20_000 }, async t => {
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'repograph-wiki-')));
    const root = join(tmp, 'stockroom');
    await mkdir(join(root, 'stock'), { recursive: true });
    await mkdir(join(root, 'orders'));
    await writeFile(join(root, 'orders', 'order.ts'), 'import { count } from "../stock/item.js";\nexport function ship() { return count(); }\n');
    await writeFile(join(root, 'stock', 'item.ts'), 'export function count() { return 3; }\n');
    const token = randomBytes(32).toString('hex');
    let child, base;
    async function start() {
        child = spawn(process.execPath, ['dist/server.js'], {
            env: { ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined, REPOGRAPH_PORT: '0',
                REPOGRAPH_PROJECTS_ROOT: tmp, REPOGRAPH_DB_PATH: join(tmp, 'index.db'), REPOGRAPH_ASSETS_ROOT: join(tmp, 'assets'),
                REPOGRAPH_EMBEDDING_MODEL: undefined }, stdio: ['ignore', 'ignore', 'pipe']
        });
        base = await new Promise((resolve, reject) => {
            let logs = '';
            child.once('error', reject);
            child.once('exit', code => reject(new Error('Server exited (' + code + '): ' + logs)));
            child.stderr.on('data', chunk => {
                logs += chunk;
                const address = logs.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
                if (address) resolve(address);
            });
        });
    }
    async function stop() {
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        const stopped = once(child, 'exit');
        child.kill('SIGTERM');
        await stopped;
    }
    t.after(async () => { await stop(); await rm(tmp, { recursive: true, force: true }); });

    async function request(path, query = {}, method = 'GET', authenticated = true, input) {
        const response = await fetch(base + '/api/v1' + path + '?' + new URLSearchParams(query), {
            method, headers: { ...(authenticated ? { Authorization: 'Bearer ' + token } : {}),
                ...(input ? { 'Content-Type': 'application/json' } : {}) }, body: input ? JSON.stringify(input) : undefined
        });
        return { status: response.status, body: await response.json() };
    }
    async function until(path, query, terminal) {
        for (let attempt = 0; attempt < 100; attempt++) {
            const result = await request(path, query);
            assert.equal(result.status, 200);
            if (!terminal.includes(result.body.status)) return result.body;
            await delay(30);
        }
        assert.fail('Job did not reach a terminal status');
    }
    async function index() {
        assert.equal((await request('/index/project', { projectRoot: root }, 'POST')).status, 202);
        assert.equal((await until('/index/project/status', { projectRoot: root }, ['idle', 'running'])).status, 'done');
    }

    await start();
    await index();
    const [{ projectId }] = (await request('/projects')).body;
    async function generate() {
        const accepted = await request('/summaries/generate', { projectId }, 'POST');
        assert.equal(accepted.status, 202);
        assert.equal(accepted.body.pollVia, '/api/v1/agent-runs/' + accepted.body.agentRunId);
        return until(accepted.body.pollVia.slice('/api/v1'.length), {}, ['QUEUED', 'RUNNING']);
    }
    assert.deepEqual((await request('/summaries', { projectId })).body, []);
    const run = await generate();
    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.playbook, 'WIKI_SUMMARY');
    assert.deepEqual(run.steps.map(step => [step.capability, step.status]), [['FACTS', 'COMPLETED'], ['LLM_ARCH', 'SKIPPED'], ['PERSIST', 'COMPLETED']]);
    assert.equal((await request('/agent-runs/' + run.id, {}, 'GET', false)).status, 401);
    const tree = (await request('/summaries/tree', { projectId })).body;
    assert.deepEqual(tree.map(node => [node.path, node.level, node.docVersion]), [['project', 'project', 1], ['package/orders', 'package', 1], ['package/stock', 'package', 1]]);
    const [, orders, stock] = (await request('/summaries', { projectId })).body;
    assert.ok(orders.sections.every(section => section.source === 'facts'));
    assert.ok(orders.sections.some(section => section.body.includes('stock')));
    assert.deepEqual(stock.citations[0], { qualifiedName: 'count', filePath: 'stock/item.ts', startLine: 1, endLine: 1 });
    assert.deepEqual((await request('/summaries/' + stock.id)).body, stock);
    assert.equal((await request('/summaries/' + stock.id, { projectId: '000000000000' })).status, 404);

    await rm(join(root, 'stock', 'item.ts'));
    await writeFile(join(root, 'orders', 'order.ts'), 'export function ship() { return 5; }\n');
    await index();
    await generate();
    await stop();
    const originalDatabase = new DatabaseSync(join(tmp, 'index.db'));
    try {
        originalDatabase.exec(`
            BEGIN IMMEDIATE;
            CREATE TABLE wiki_document_previous (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                run_id TEXT NOT NULL REFERENCES wiki_generation(run_id) ON DELETE CASCADE, level TEXT NOT NULL,
                scope_id TEXT NOT NULL, doc_version INTEGER NOT NULL, payload TEXT NOT NULL,
                UNIQUE(project_id, level, scope_id, doc_version)
            );
            INSERT INTO wiki_document_previous SELECT * FROM wiki_document;
            DROP TABLE wiki_document;
            ALTER TABLE wiki_document_previous RENAME TO wiki_document;
            COMMIT;
        `);
    } finally { originalDatabase.close(); }
    await start();
    assert.deepEqual((await request('/summaries/tree', { projectId })).body.map(node => [node.path, node.docVersion]),
        [['project', 2], ['package/orders', 2]]);
    assert.deepEqual((await request('/summaries/' + stock.id)).body, stock);
    assert.deepEqual((await request('/agent-runs/' + run.id)).body, run);

    const phases = [];
    let malformed = true;
    let beforeInterruption;
    const fixture = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const prompt = JSON.parse(body.messages.at(-1).content);
        phases.push({ phase: prompt.phase, model: body.model, prompt: JSON.stringify(prompt) });
        if (prompt.phase === 'modules' && beforeInterruption) { beforeInterruption(); return; }
        const text = prompt.phase === 'build' && malformed ? 'malformed' : JSON.stringify({
            body: 'Verified section for ' + prompt.phase, citations: prompt.phase === 'overview' ? ['W1', 'fabricated'] : ['W1']
        });
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: { content: text }, done_reason: 'stop' }));
    });
    fixture.listen(0, '127.0.0.1');
    await once(fixture, 'listening');
    t.after(() => { fixture.closeAllConnections(); return new Promise(resolve => fixture.close(resolve)); });
    const providerPath = '/admin/model-providers/legacy-ollama';
    const config = { name: 'Fixture', protocol: 'OLLAMA', model: 'fixture-a', enabled: true,
        baseUrl: 'http://127.0.0.1:' + fixture.address().port, timeoutMillis: 1500, maxOutputTokens: 1400 };
    assert.equal((await request(providerPath, {}, 'PUT', true, config)).status, 200);
    const partial = await generate();
    assert.equal(partial.status, 'PARTIAL');
    assert.equal(partial.steps.find(step => step.capability === 'LLM_ARCH:build').status, 'FAILED');
    const [earlier] = (await request('/summaries', { projectId })).body;
    assert.equal(earlier.status, 'PARTIAL');
    assert.equal(earlier.sections.filter(section => section.source === 'llm').length, 4);
    assert.equal(earlier.sections.filter(section => section.source === 'facts').length, 4);
    assert.deepEqual(earlier.citations.map(item => [item.qualifiedName, item.filePath, item.startLine]), [['ship', 'orders/order.ts', 1]]);
    assert.ok(!JSON.stringify(earlier).includes('fabricated'));
    assert.ok(phases.every(call => !call.prompt.includes(root) && !call.prompt.includes('return 5')));
    assert.deepEqual(phases.map(call => call.phase), ['overview', 'modules', 'entrypoints', 'build', 'security']);

    await stop();
    await start();
    malformed = false;
    const resumed = await generate();
    assert.equal(resumed.status, 'COMPLETED');
    assert.deepEqual(phases.slice(5).map(call => call.phase), ['build']);
    const [full] = (await request('/summaries', { projectId })).body;
    assert.equal(full.docVersion, earlier.docVersion + 1);
    assert.equal(full.sections.filter(section => section.source === 'llm').length, 5);
    assert.equal(full.factsHash, earlier.factsHash);
    assert.deepEqual((await request('/summaries/' + earlier.id)).body, earlier);

    assert.equal((await request(providerPath, {}, 'PUT', true, { ...config, model: 'fixture-b' })).status, 200);
    await generate();
    assert.equal(phases.slice(6).length, 5);
    assert.ok(phases.slice(6).every(call => call.model === 'fixture-b'));
    await writeFile(join(root, 'orders', 'order.ts'), 'export function updatedShip() { return 6; }\n');
    await index();
    await generate();
    const [updated] = (await request('/summaries', { projectId })).body;
    assert.notEqual(updated.factsHash, full.factsHash);
    assert.equal(phases.slice(11).length, 5);
    assert.ok(updated.citations.some(citation => citation.qualifiedName === 'updatedShip'));

    assert.equal((await request(providerPath, {}, 'PUT', true, { ...config, model: 'fixture-interrupted' })).status, 200);
    const submitting = new Promise(resolve => { beforeInterruption = resolve; });
    const accepted = await request('/summaries/generate', { projectId }, 'POST');
    assert.equal(accepted.status, 202);
    await submitting;
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    beforeInterruption = undefined;
    const pastCalls = phases.length;
    await start();
    const interrupted = (await request('/agent-runs/' + accepted.body.agentRunId)).body;
    assert.equal(interrupted.status, 'FAILED');
    assert.equal(interrupted.statusReason, 'INTERRUPTED');
    assert.ok(interrupted.steps.some(step => step.capability === 'LLM_ARCH:overview' && step.status === 'COMPLETED'));
    await generate();
    assert.deepEqual(phases.slice(pastCalls).map(call => call.phase), ['modules', 'entrypoints', 'build', 'security']);

    assert.equal((await request('/index/project', { projectId }, 'DELETE')).status, 200);
    assert.equal((await request('/summaries/' + stock.id)).status, 404);
    assert.equal((await request('/agent-runs/' + run.id)).status, 404);
});
