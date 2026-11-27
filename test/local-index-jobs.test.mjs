import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

test('ordinary whole-repository indexing resumes from frozen bytes and keeps accepted files after process loss', { timeout: 35_000 }, async t => {
    const scratch = await realpath(await mkdtemp(join(tmpdir(), 'repograph-local-index-')));
    const root = join(scratch, 'repository');
    const assets = join(scratch, 'assets');
    await mkdir(root);
    const a = join(root, 'a.ts'), b = join(root, 'b.ts');
    await writeFile(a, 'export function confirmedItem() { return 11; }\n');
    await writeFile(b, 'export function pendingItem() { return 12; }\n');
    const key = randomBytes(32).toString('hex');
    const started = Promise.withResolvers();
    const requests = [];
    let hold = true;
    const embedding = createServer(async (request, response) => {
        if (request.method === 'GET') { response.writeHead(200).end('{}'); return; }
        const chunks = [];
        for await (const data of request) chunks.push(data);
        const { input } = JSON.parse(Buffer.concat(chunks));
        const kind = input.some(item => item.includes('pendingItem')) ? 'pending' : 'confirmed';
        requests.push(kind);
        if (hold && kind === 'pending') { started.resolve(); return; }
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            model: 'fixture', embeddings: input.map(() => [1, 0])
        }));
    });
    embedding.listen(0, '127.0.0.1');
    await once(embedding, 'listening');
    let child, base;
    async function start() {
        child = spawn(process.execPath, ['dist/server.js'], {
            env: { ...process.env, REPOGRAPH_PORT: '0', REPOGRAPH_PROJECTS_ROOT: scratch, REPOGRAPH_DB_PATH: join(scratch, 'data.db'),
                REPOGRAPH_ASSETS_ROOT: assets, REPOGRAPH_ACCESS_TOKEN: key, REPOGRAPH_ADMIN_PASSWORD: undefined,
                REPOGRAPH_EMBEDDING_URL: `http://127.0.0.1:${embedding.address().port}`, REPOGRAPH_EMBEDDING_MODEL: 'fixture',
                REPOGRAPH_EMBEDDING_DIMENSIONS: '2' }, stdio: ['ignore', 'ignore', 'pipe']
        });
        base = await new Promise((resolve, reject) => {
            let logs = '';
            child.once('error', reject);
            child.once('exit', code => reject(new Error('Server exited (' + code + '): ' + logs)));
            child.stderr.on('data', data => {
                logs += data;
                const address = logs.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
                if (address) resolve(address);
            });
        });
    }
    async function stop(signal = 'SIGTERM') {
        if (child?.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill(signal);
            await exited;
        }
    }
    t.after(async () => {
        await stop();
        embedding.closeAllConnections();
        await new Promise(resolve => embedding.close(resolve));
        await rm(scratch, { recursive: true, force: true });
    });
    async function api(path, method = 'GET', stamped) {
        const response = await fetch(base + '/api/v1' + path, { method, headers: {
            Authorization: 'Bearer ' + key, ...(stamped && { 'Idempotency-Key': stamped })
        } });
        return { status: response.status, body: await response.json() };
    }
    async function until(read, predicate) {
        let current;
        for (let attempt = 0; attempt < 850; attempt++) {
            current = await read();
            if (predicate(current)) return current;
            await delay(20);
        }
        assert.fail(JSON.stringify(current));
    }
    await start();
    const paths = new URLSearchParams({ projectRoot: root });
    const startPath = '/index/project?' + paths;
    const statusPath = '/index/project/status?' + paths;
    const admitted = await api(startPath, 'POST', 'frozen-index');
    assert.equal(admitted.status, 202, JSON.stringify(admitted.body));
    const { agentRunId, projectId } = admitted.body;
    await started.promise;
    assert.equal((await api('/symbol/confirmedItem?projectId=' + projectId)).status, 200);
    const run = '/agent-runs/' + agentRunId;
    assert.equal((await api(run + '/execution')).body.state, 'RUNNING');
    await stop('SIGKILL');
    await writeFile(b, 'export function liveReplacement() { return 13; }\n');
    hold = false;
    await start();
    assert.equal((await api(statusPath)).body.status, 'running');
    assert.equal((await api(startPath, 'POST', 'frozen-index')).body.agentRunId, agentRunId);
    assert.equal((await api(startPath + '&lang=java', 'POST', 'frozen-index')).body.error, 'JOB_REQUEST_CONFLICT');
    const waiting = await until(() => api('/admin/diagnostics'), item => item.body.components?.workers?.localIndex?.awaitingReconciliation === 1);
    assert.equal(waiting.body.status, 'degraded');
    assert.equal((await api(run + '/execution')).body.attempt, 1);
    assert.equal(requests.filter(kind => kind === 'pending').length, 1);
    const terminal = await until(() => api(statusPath), item => ['done', 'error', 'partial'].includes(item.body.status));
    assert.equal(terminal.body.status, 'done', JSON.stringify(terminal.body));
    assert.equal(terminal.body.skippedFiles, 1);
    assert.equal((await api(run)).body.status, 'COMPLETED');
    assert.deepEqual((await api(run + '/execution/attempts')).body.map(item => item.outcome), ['LEASE_EXPIRED', 'FINISHED']);
    assert.equal(requests.filter(kind => kind === 'confirmed').length, 1);
    assert.equal((await api('/symbol/pendingItem?projectId=' + projectId)).status, 200);
    assert.equal((await api('/symbol/liveReplacement?projectId=' + projectId)).status, 404);
    await until(() => readdir(join(assets, '.index-inputs')), items => items.length === 0);
    const wiki = await api('/summaries/generate?projectId=' + projectId, 'POST', 'publish-frozen-index');
    assert.equal(wiki.status, 202);
    const generated = await until(() => api('/agent-runs/' + wiki.body.agentRunId), item => !['QUEUED', 'RUNNING'].includes(item.body.status));
    assert.equal(generated.body.status, 'COMPLETED');
    const [snapshot] = (await api('/knowledge-snapshots?projectId=' + projectId)).body;
    assert.match((await api('/knowledge-snapshots/' + snapshot.id + '/source?file=b.ts')).body.text, /return 12/);
    assert.equal((await api(startPath, 'POST', 'new-index')).status, 202);
    await until(() => api(statusPath), item => item.body.status === 'done');
    assert.equal((await api('/symbol/liveReplacement?projectId=' + projectId)).status, 200);
});
