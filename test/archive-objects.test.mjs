import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';

test('archive content can be replayed and reused independently of repository names and lifetimes', { timeout: 20_000 }, async t => {
    const temp = await realpath(await mkdtemp(join(tmpdir(), 'repograph-archive-objects-')));
    const projects = join(temp, 'projects');
    const assets = join(temp, 'assets');
    await mkdir(projects);
    const token = randomBytes(24).toString('hex');
    let child;
    let base;
    async function start() {
        child = spawn(process.execPath, ['dist/server.js'], {
            env: { ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined, REPOGRAPH_PROJECTS_ROOT: projects,
                REPOGRAPH_ASSETS_ROOT: assets, REPOGRAPH_DB_PATH: join(temp, 'index.db'), REPOGRAPH_EMBEDDING_MODEL: undefined,
                REPOGRAPH_ARCHIVE_RETENTION_SECONDS: '0', REPOGRAPH_PROJECT_RETENTION_SECONDS: '0', REPOGRAPH_PORT: '0' },
            stdio: ['ignore', 'ignore', 'pipe']
        });
        base = await new Promise((resolve, reject) => {
            let logs = '';
            child.once('error', reject);
            child.once('exit', code => reject(new Error('API process exited (' + code + '): ' + logs)));
            child.stderr.on('data', chunk => {
                logs += chunk;
                const address = logs.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
                if (address) resolve(address);
            });
        });
    }
    async function stop() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const stopped = once(child, 'exit');
        child.kill('SIGTERM');
        await stopped;
    }
    t.after(async () => { await stop(); await rm(temp, { force: true, recursive: true }); });
    await start();
    async function request(path, method = 'GET', body, key) {
        const json = body && !(body instanceof FormData);
        const response = await fetch(base + '/api/v1' + path, { method,
            headers: { Authorization: 'Bearer ' + token, ...(json ? { 'Content-Type': 'application/json' } : {}),
                ...(key ? { 'Idempotency-Key': key } : {}) }, body: json ? JSON.stringify(body) : body });
        return { status: response.status, body: await response.json() };
    }
    const content = 'export function listed() { return 23; }\n';
    const bytes = zipSync({ 'src/main.ts': strToU8(content), 'README.md': strToU8('# Workspace\n') });
    const digest = createHash('sha256').update(bytes).digest('hex');
    function upload(data, name, key) {
        const form = new FormData();
        form.append('file', new Blob([data]), name);
        return request('/assets/import', 'POST', form, key);
    }
    async function wait(path, pending) {
        for (let attempts = 0; attempts < 200; attempts++) {
            const response = await request(path);
            assert.equal(response.status, 200);
            if (!pending.includes(response.body.status)) return response.body;
            await delay(25);
        }
        assert.fail('Operation did not reach a terminal status');
    }
    const [first, replay] = await Promise.all([upload(bytes, 'incoming.zip', 'archive-upload-a'),
        upload(bytes, 'incoming.zip', 'archive-upload-a')]);
    assert.equal(first.status, 202);
    assert.equal(replay.status, 202);
    assert.equal(replay.body.assetId, first.body.assetId);
    const initial = await wait('/assets/' + first.body.assetId, ['INDEXING']);
    assert.equal(initial.sourceObject.sha256, digest);
    assert.equal(initial.sourceObject.sizeBytes, bytes.length);
    assert.equal(initial.displayName, 'incoming.zip');
    assert.equal(initial.revision, 0);

    const otherBytes = zipSync({ 'src/main.ts': strToU8(content + '// another package\n') });
    assert.equal((await upload(otherBytes, 'incoming.zip', 'archive-upload-a')).status, 409);
    const rename = await request('/assets/' + initial.assetId, 'PATCH', { displayName: 'Release archive', revision: 0 });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.sourceObject.id, initial.sourceObject.id);
    assert.equal(rename.body.originalFileName, initial.originalFileName);
    assert.equal(rename.body.displayName, 'Release archive');
    assert.equal((await request('/assets/' + initial.assetId, 'PATCH', { displayName: 'Out of date', revision: 0 })).status, 409);
    assert.equal((await request('/projects?summary=true')).body[0].archiveName, 'Release archive');

    await stop();
    await start();
    const reuseUrl = '/assets/' + initial.assetId + '/reuse';
    const reused = await request(reuseUrl, 'POST', { displayName: 'Independent copy' }, 'archive-reuse-a');
    assert.equal(reused.status, 202);
    assert.notEqual(reused.body.assetId, initial.assetId);
    assert.notEqual(reused.body.projectId, initial.projectId);
    assert.equal(reused.body.sourceObject.id, initial.sourceObject.id);
    assert.equal((await request(reuseUrl, 'POST', { displayName: 'Independent copy' }, 'archive-reuse-a')).body.assetId, reused.body.assetId);
    assert.equal((await wait(reused.body.pollUrl.slice('/api/v1'.length), ['INDEXING'])).status, 'READY');
    assert.deepEqual(await readdir(join(assets, '.archive-objects')), [digest]);

    const fileInCopy = join(reused.body.projectRoot, 'src', 'main.ts');
    await writeFile(fileInCopy, 'export function unsourced() { return 24; }\n');
    const reindex = '/assets/' + reused.body.assetId + '/reindex';
    assert.equal((await request(reindex, 'POST')).status, 202);
    await wait('/assets/' + reused.body.assetId, ['INDEXING']);
    assert.deepEqual(await request('/summaries/generate?projectId=' + reused.body.projectId, 'POST'),
        { status: 409, body: { error: 'ARCHIVE_INDEX_SOURCE_MISMATCH' } });
    await writeFile(fileInCopy, content);
    assert.equal((await request(reindex, 'POST')).status, 202);
    await wait('/assets/' + reused.body.assetId, ['INDEXING']);

    const published = await request('/summaries/generate?projectId=' + reused.body.projectId, 'POST');
    assert.equal(published.status, 202);
    const run = await wait(published.body.pollVia.slice('/api/v1'.length), ['QUEUED', 'RUNNING']);
    assert.equal(run.status, 'COMPLETED');
    const [snapshot] = (await request('/knowledge-snapshots?projectId=' + reused.body.projectId)).body;
    assert.equal(snapshot.source.type, 'ARCHIVE');
    assert.equal(snapshot.source.objectId, initial.sourceObject.id);
    assert.equal(snapshot.source.sha256, digest);

    async function purge(projectId, revision = 1) {
        const path = '/projects/' + projectId + '/lifecycle';
        const accepted = await request(path, 'POST', { action: 'purge', revision }, 'purge-managed-' + revision);
        assert.equal(accepted.status, 202);
        for (let attempts = 0; attempts < 120; attempts++) {
            if ((await request(path)).body.state === 'PURGED') return;
            await delay(25);
        }
        assert.fail('Managed source cleanup did not finish');
    }

    assert.equal((await request('/assets/' + initial.assetId, 'DELETE')).status, 200);
    assert.ok((await stat(initial.projectRoot)).isDirectory());
    assert.equal((await upload(bytes, 'incoming.zip', 'archive-upload-a')).status, 404);
    await purge(initial.projectId);
    assert.equal((await upload(bytes, 'incoming.zip', 'archive-upload-a')).status, 410);
    assert.deepEqual(await readdir(join(assets, '.archive-objects')), [digest]);
    const original = await request('/knowledge-snapshots/' + snapshot.id + '/source?file=src%2Fmain.ts');
    assert.equal(original.body.text, content);
    const space = (await request('/spaces', 'POST', { name: 'Archive reference' })).body;
    assert.equal((await request(`/spaces/${space.id}/repositories`, 'POST', { projectId: reused.body.projectId, snapshotId: snapshot.id, revision: 0 })).status, 200);
    assert.equal((await request('/assets/' + reused.body.assetId, 'DELETE')).status, 200);
    const lifecycle = '/projects/' + reused.body.projectId + '/lifecycle';
    assert.equal((await request(lifecycle, 'POST', { action: 'purge', revision: 1 }, 'protected-archive')).body.error, 'PROJECT_STILL_REFERENCED');
    assert.equal((await request(lifecycle, 'POST', { action: 'restore', revision: 1 }, 'restore-archive')).status, 200);
    assert.deepEqual(await readdir(join(assets, '.archive-objects')), [digest]);

    const disposable = await upload(otherBytes, 'disposable.zip', 'archive-upload-b');
    assert.equal(disposable.status, 202);
    await wait('/assets/' + disposable.body.assetId, ['INDEXING']);
    assert.equal((await request('/assets/' + disposable.body.assetId, 'DELETE')).status, 200);
    await purge(disposable.body.projectId);
    assert.deepEqual(await readdir(join(assets, '.archive-objects')), [digest]);

    await stop();
    const staging = [randomUUID(), randomUUID()];
    await Promise.all(staging.map(id => mkdir(join(assets, id, 'source'), { recursive: true })));
    const orphan = createHash('sha256').update(otherBytes).digest('hex');
    await writeFile(join(assets, '.archive-objects', orphan), otherBytes);
    const fixture = new DatabaseSync(join(temp, 'index.db'));
    try {
        for (const [index, id] of staging.entries()) {
            fixture.prepare('INSERT INTO managed_asset(id, source_root, created_at) VALUES (?, ?, ?)')
                .run(id, join(assets, id, 'source'), new Date().toISOString());
            fixture.prepare('INSERT INTO managed_asset_upload VALUES (?, ?, ?)')
                .run(id, randomUUID(), Date.now() + (index ? 120_000 : -1000));
        }
    } finally { fixture.close(); }
    await start();
    await assert.rejects(stat(join(assets, staging[0])), { code: 'ENOENT' });
    assert.ok((await stat(join(assets, staging[1]))).isDirectory());
    assert.deepEqual(await readdir(join(assets, '.archive-objects')), [digest]);
    assert.equal((await request('/knowledge-snapshots/' + snapshot.id + '/source?file=src%2Fmain.ts')).body.text, content);
});
