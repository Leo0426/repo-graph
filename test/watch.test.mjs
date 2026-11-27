import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { RepositoryIndex } from '../dist/index.js';
import { OllamaEmbedding } from '../dist/vector.js';

test('single-file indexing and persisted watches share the index lifecycle', { timeout: 20_000 }, async t => {
    const temp = await realpath(await mkdtemp(join(tmpdir(), 'repograph-watch-')));
    const root = join(temp, 'library');
    const other = join(temp, 'unrelated');
    const file = join(root, 'a.ts');
    const sibling = join(root, 'b.py');
    await Promise.all([mkdir(root), mkdir(other)]);
    await writeFile(file, 'export function initialName() { return 1; }');
    await writeFile(sibling, 'def untouched_sibling():\n    return 1\n');
    await writeFile(join(other, 'private.ts'), 'export function unrelated() {}');
    await symlink(join(other, 'private.ts'), join(root, 'link.ts'));

    const token = randomBytes(32).toString('hex');
    const projectId = createHash('sha256').update(root).digest('hex').slice(0, 12);
    let child;
    let base;
    async function startServer() {
        child = spawn(process.execPath, ['dist/server.js'], {
            env: { ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined,
                REPOGRAPH_PROJECTS_ROOT: temp, REPOGRAPH_DB_PATH: join(temp, 'index.db'),
                REPOGRAPH_ASSETS_ROOT: join(temp, 'assets'), REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_PORT: '0' },
            stdio: ['ignore', 'ignore', 'pipe']
        });
        base = await new Promise((resolve, reject) => {
            let stderr = '';
            child.once('error', reject);
            child.once('exit', code => reject(new Error('Server exited (' + code + '): ' + stderr)));
            child.stderr.on('data', chunk => {
                stderr += chunk;
                const address = stderr.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
                if (address) resolve(address);
            });
        });
    }
    async function stopServer(signal = 'SIGTERM') {
        if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill(signal);
        await exited;
    }
    t.after(async () => {
        await stopServer();
        await rm(temp, { recursive: true, force: true });
    });
    await startServer();
    async function api(path, args = {}, method = 'GET', authorized = true) {
        const response = await fetch(base + '/api/v1' + path + '?' + new URLSearchParams(args), {
            method, headers: authorized ? { Authorization: 'Bearer ' + token } : {}, signal: AbortSignal.timeout(4000)
        });
        return { status: response.status, body: response.status === 204 ? null : await response.json() };
    }
    const symbol = name => api('/symbol/' + encodeURIComponent(name), { projectId });
    async function until(check) {
        for (let tries = 0; tries < 100; tries++) {
            if (await check()) return;
            await delay(35);
        }
        assert.fail('Expected index update did not arrive');
    }
    const single = await api('/index/file', { projectRoot: root, file }, 'POST');
    assert.equal(single.status, 200);
    assert.equal(single.body.totalFiles, 1);
    assert.equal(single.body.parsedFiles, 1);
    assert.equal((await symbol('initialName')).status, 200);
    assert.equal((await symbol('untouched_sibling')).status, 404);
    assert.equal((await api('/index/file', { projectRoot: root, file }, 'POST')).body.skippedFiles, 1);
    assert.equal((await api('/index/file', { projectRoot: root, file: join(other, 'private.ts') }, 'POST')).status, 403);
    assert.equal((await api('/index/file', { projectRoot: root, file: join(root, 'link.ts') }, 'POST')).status, 403);

    assert.equal((await api('/watch', { projectId, root: other }, 'POST')).status, 400);
    assert.equal((await api('/watch', { projectId, root }, 'POST', false)).status, 401);
    assert.equal((await api('/watch', { projectId, root }, 'POST')).body.status, 'watching');
    assert.deepEqual((await api('/watch')).body, [{ projectId, root }]);
    await until(async () => (await symbol('untouched_sibling')).status === 200);

    await writeFile(file, 'export function secondName() { return 2; }');
    await until(async () => (await symbol('secondName')).status === 200);
    assert.equal((await symbol('initialName')).status, 404);
    await writeFile(file, 'export function broken( {');
    await until(async () => (await api('/index/project/status', { projectRoot: root })).body.status === 'partial');
    assert.equal((await symbol('secondName')).status, 200);
    await rm(file);
    await until(async () => (await symbol('secondName')).status === 404);

    await stopServer('SIGKILL');
    await mkdir(join(root, 'src'));
    const offline = join(root, 'src', 'offline.ts');
    await writeFile(offline, 'export function addedOffline() { return 3; }');
    await startServer();
    assert.equal((await api('/watch/' + projectId)).body.watching, true);
    await until(async () => (await symbol('addedOffline')).status === 200);
    const renamed = join(root, 'src', 'returned.ts');
    await rename(offline, renamed);
    await until(async () => (await symbol('addedOffline')).body.filePath === 'src/returned.ts');

    assert.equal((await api('/watch/' + projectId, {}, 'DELETE')).status, 204);
    await writeFile(renamed, 'export function afterStop() {}');
    await stopServer();
    await startServer();
    assert.deepEqual((await api('/watch')).body, []);
    assert.equal((await api('/watch/' + projectId)).body.watching, false);
    assert.equal((await symbol('afterStop')).status, 404);
    assert.equal((await symbol('addedOffline')).status, 200);

    assert.equal((await api('/index/project', { projectRoot: root, strategy: 'heuristic' }, 'POST')).status, 202);
    await until(async () => (await api('/index/project/status', { projectRoot: root })).body.status === 'done');
    await api('/watch', { root, projectId }, 'POST');
    await stopServer();
    await writeFile(renamed, 'export function heuristicAfterRestart() {}');
    await startServer();
    await until(async () => (await symbol('src/returned.ts#heuristicAfterRestart@L1')).body.metadata?.heuristic === 'true');
    assert.equal((await symbol('heuristicAfterRestart')).status, 404);
    assert.equal((await api('/index/project', { projectRoot: root, projectId }, 'DELETE')).status, 200);
    await writeFile(renamed, 'export function afterDelete() {}');
    await delay(650);
    assert.equal((await api('/watch/' + projectId)).status, 404);
    assert.deepEqual((await api('/projects')).body, []);
});

test('stopping a watch cancels in-flight work and retains dirty files for the next restart', { timeout: 12_000 }, async t => {
    const temp = await realpath(await mkdtemp(join(tmpdir(), 'repograph-watch-stop-')));
    const root = join(temp, 'repo');
    const file = join(root, 'source.ts');
    const database = join(temp, 'index.db');
    await mkdir(root);
    const original = 'export function saved() { return 1; }';
    await writeFile(file, original);
    const projectId = createHash('sha256').update(root).digest('hex').slice(0, 12);
    const held = Promise.withResolvers();
    let completedRequests = 0;
    const upstream = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const { input } = JSON.parse(Buffer.concat(chunks));
        if (input.some(text => text.includes('pendingEdit'))) {
            held.resolve();
            return;
        }
        completedRequests++;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ model: 'fixture', embeddings: input.map(() => [1, 0]) }));
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const provider = OllamaEmbedding.fromEnvironment({
        REPOGRAPH_EMBEDDING_URL: `http://127.0.0.1:${upstream.address().port}`, REPOGRAPH_EMBEDDING_MODEL: 'fixture',
        REPOGRAPH_EMBEDDING_DIMENSIONS: '2'
    });
    let repository = await RepositoryIndex.open(database, temp, provider);
    await repository.identity.initializeAdmin();
    t.after(async () => {
        await repository?.close();
        upstream.closeAllConnections();
        await new Promise(resolve => upstream.close(resolve));
        await rm(temp, { recursive: true, force: true });
    });

    assert.equal((await repository.indexFile(root, file, true, () => {})).status, 'done');
    assert.equal(completedRequests, 1);
    await repository.startWatch(projectId, root, () => {});
    await writeFile(file, 'export function pendingEdit() { return 2; }');
    await held.promise;
    assert.equal((await repository.status(root)).status, 'running');
    await assert.rejects(repository.trashProject(repository.identity.account('builtin-admin'), projectId, root), { message: 'PROJECT_WORK_PENDING' });
    await repository.watches.stop(projectId);
    assert.equal(repository.watches.has(projectId), false);
    assert.ok((await repository.status(root)).errors.includes('INDEX_CANCELLED'));
    assert.ok(repository.symbol('saved', projectId));
    assert.equal(repository.symbol('pendingEdit', projectId), undefined);

    await writeFile(file, original);
    await repository.close();
    repository = undefined;
    repository = await RepositoryIndex.open(database, temp, provider);
    assert.equal(repository.watches.has(projectId), false);
    assert.equal((await repository.indexFile(root, file, true, () => {})).parsedFiles, 1);
    assert.equal(completedRequests, 2);
    assert.equal((await repository.indexFile(root, file, true, () => {})).skippedFiles, 1);
});
