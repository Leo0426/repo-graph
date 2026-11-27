import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { strToU8, zipSync } from 'fflate';
import { RepositoryIndex } from '../dist/index.js';

const execute = promisify(execFile);

test('a verified offline backup restores historical knowledge, managed bytes, keys, usage and queue custody', { timeout: 25_000 }, async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'repograph-recovery-')));
    const projects = join(root, 'projects');
    const originalAssets = join(root, 'live-assets');
    const database = join(root, 'live.sqlite');
    const bundle = join(root, 'backup');
    const restored = join(root, 'restored');
    const token = randomBytes(24).toString('hex');
    const providerSecret = randomBytes(24).toString('hex');
    const key = randomBytes(32).toString('base64');
    const env = { ...process.env, REPOGRAPH_PORT: '0', REPOGRAPH_PROJECTS_ROOT: projects, REPOGRAPH_DB_PATH: database,
        REPOGRAPH_ASSETS_ROOT: originalAssets, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_PROVIDER_ENCRYPTION_KEY: key,
        REPOGRAPH_GIT_ENCRYPTION_KEY: undefined, REPOGRAPH_ADMIN_PASSWORD: undefined, REPOGRAPH_EMBEDDING_MODEL: undefined };
    await mkdir(projects);
    let child, base;
    async function start(overrides = {}) {
        child = spawn(process.execPath, ['dist/server.js'], { env: { ...env, ...overrides }, stdio: ['ignore', 'ignore', 'pipe'] });
        base = await new Promise((resolve, reject) => {
            let log = '';
            child.once('error', reject);
            child.once('exit', code => reject(new Error('Server exited (' + code + '): ' + log)));
            child.stderr.on('data', chunk => {
                log += chunk;
                const address = log.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
                if (address) resolve(address);
            });
        });
    }
    async function stop() {
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
    }
    const calls = [];
    const provider = createServer(async (request, response) => {
        calls.push(request.headers.authorization === 'Bearer ' + providerSecret);
        for await (const _ of request) { /* Drain the fixture request. */ }
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            message: { content: 'OK' }, prompt_eval_count: 71, eval_count: 8, done_reason: 'stop'
        }));
    }).listen(0, '127.0.0.1');
    await once(provider, 'listening');
    t.after(async () => {
        await stop();
        provider.closeAllConnections();
        await new Promise(resolve => provider.close(resolve));
        await rm(root, { force: true, recursive: true });
    });
    function recovery(...args) {
        return execute(process.execPath, ['dist/recovery-cli.js', ...args], { env }).then(result => JSON.parse(result.stdout));
    }
    async function request(path, method = 'GET', data, idempotencyKey) {
        const headers = { Authorization: 'Bearer ' + token };
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
        if (data !== undefined && !(data instanceof FormData)) headers['Content-Type'] = 'application/json';
        const response = await fetch(base + '/api/v1' + path, { method, headers,
            body: data instanceof FormData ? data : JSON.stringify(data) });
        return { status: response.status, body: await response.json() };
    }
    async function wait(path, pending) {
        for (let attempt = 0; attempt < 200; attempt++) {
            const current = await request(path);
            assert.equal(current.status, 200);
            if (!pending.includes(current.body.status)) return current.body;
            await delay(25);
        }
        assert.fail('Operation did not reach a terminal status');
    }

    await start();
    await assert.rejects(recovery('backup', bundle), error => error.stderr.includes('RECOVERY_DATABASE_IN_USE'));
    await assert.rejects(stat(bundle), { code: 'ENOENT' });
    const content = 'export function inventoryCount() { return 31; }\n';
    const archive = new FormData();
    archive.append('file', new Blob([zipSync({ 'inventory.ts': strToU8(content) })]), 'inventory.zip');
    const imported = await request('/assets/import', 'POST', archive, 'backup-import');
    assert.equal(imported.status, 202);
    const asset = await wait(imported.body.pollUrl.slice('/api/v1'.length), ['INDEXING']);
    assert.equal(asset.status, 'READY');
    const project = '?projectId=' + asset.projectId;
    const scheduled = await request('/summaries/generate' + project, 'POST');
    assert.equal((await wait(scheduled.body.pollVia.slice(7), ['QUEUED', 'RUNNING'])).status, 'COMPLETED');
    const [release] = (await request('/knowledge-snapshots' + project)).body;
    const source = '/knowledge-snapshots/' + release.id + '/source?file=inventory.ts';
    const receipt = '/knowledge-snapshots/' + release.id + '/manifest';
    const originalReceipt = (await request(receipt)).body;
    const [wiki] = (await request('/summaries' + project)).body;
    const markdown = '\ufeff# Inventory\r\n\r\nStable revision.\r\n';
    const edited = await request('/summaries/' + wiki.id + '/revisions', 'POST',
        { baseRevisionId: wiki.revision.id, markdown }, 'backup-edit');
    assert.equal(edited.status, 201);
    const exportUrl = '/api/v1/summaries/' + wiki.id + '/export?revisionId=' + edited.body.revision.id;
    async function readExport() {
        const result = await fetch(base + exportUrl, { headers: { Authorization: 'Bearer ' + token } });
        assert.equal(result.status, 200);
        return Buffer.from(await result.arrayBuffer());
    }
    assert.deepEqual(await readExport(), Buffer.from(markdown));
    const attachment = await request('/summaries/' + wiki.id + '/exports', 'POST', { revisionId: edited.body.revision.id, format: 'pdf' });
    const word = await request('/summaries/' + wiki.id + '/exports', 'POST', { revisionId: edited.body.revision.id, format: 'docx' });
    assert.equal(attachment.status, 201);
    assert.equal(word.status, 201);
    async function readArtifact(metadata, mime) {
        const result = await fetch(base + metadata.downloadPath, { headers: { Authorization: 'Bearer ' + token } });
        assert.equal(result.headers.get('Content-Type'), mime);
        return Buffer.from(await result.arrayBuffer());
    }
    const docxMedia = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const originalPdf = await readArtifact(attachment.body, 'application/pdf');
    const originalDocx = await readArtifact(word.body, docxMedia);
    const privateSession = await request('/ask/sessions', 'POST', { attachments: [{ name: 'recovery.txt', text: markdown }] }, 'backup-attachment');
    assert.equal(privateSession.status, 201);
    const [file] = privateSession.body.scope.attachments;
    const attachmentUrl = '/ask/sessions/' + privateSession.body.id + '/attachments/' + file.attachmentId + '?versionId=' + file.versionId;

    const model = { name: 'Backup fixture', protocol: 'OLLAMA', model: 'fixture', timeoutMillis: 1000,
        maxOutputTokens: 1000, baseUrl: 'http://127.0.0.1:' + provider.address().port, enabled: true, apiKey: providerSecret };
    assert.equal((await request('/admin/model-providers/legacy-ollama', 'PUT', model)).status, 200);
    assert.equal((await request('/admin/model-providers/legacy-ollama/test', 'POST')).status, 200);
    assert.deepEqual(calls, [true]);
    assert.equal((await request('/admin/model-providers/legacy-ollama', 'PUT', { ...model, apiKey: '', enabled: false })).status, 200);
    const usage = (await request('/admin/model-usage')).body;
    assert.equal(usage.records[0].inputTokens, 71);

    const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const futurePath = '/summaries/generate' + project + '&notBefore=' + encodeURIComponent(later);
    const queued = await request(futurePath, 'POST', undefined, 'backup-future');
    assert.equal(queued.status, 202);
    await stop();
    const metricStore = new DatabaseSync(database, { readOnly: true });
    const earliestTotals = metricStore.prepare('SELECT sum(accepted) AS accepted FROM request_metric_minute').get();
    metricStore.close();
    assert.ok(earliestTotals.accepted >= 3);
    const sealed = await recovery('backup', bundle);
    assert.deepEqual(await recovery('verify', bundle), sealed);
    assert.equal((await stat(join(bundle, 'index.db-provider-key'))).mode & 0o777, 0o600);
    const archivedBytes = join(bundle, 'assets', '.archive-objects', asset.sourceObject.sha256);
    const recoveryResult = await recovery('restore', bundle, restored);
    assert.deepEqual(recoveryResult, { version: 1, files: sealed.files, database: join(restored, 'index.db'), assets: join(restored, 'assets') });
    await assert.rejects(recovery('restore', bundle, restored), error => error.stderr.includes('RECOVERY_DESTINATION_EXISTS'));
    await rename(originalAssets, originalAssets + '-offline');
    await start({ REPOGRAPH_DB_PATH: recoveryResult.database, REPOGRAPH_ASSETS_ROOT: recoveryResult.assets, REPOGRAPH_PROVIDER_ENCRYPTION_KEY: undefined });
    const recoveredMetrics = await request('/admin/metrics?hours=24');
    assert.equal(recoveredMetrics.status, 200);
    assert.equal(recoveredMetrics.body.series.reduce((total, hour) => total + hour.accepted, 0), earliestTotals.accepted);
    assert.doesNotMatch(JSON.stringify(recoveredMetrics.body), /inventory|runId|requestId|credential/i);
    assert.equal((await fetch(base + '/api/v1/admin/metrics')).status, 401);
    const rebound = (await request('/assets/' + asset.assetId)).body;
    assert.equal(rebound.projectId, asset.projectId);
    assert.ok(rebound.projectRoot.startsWith(recoveryResult.assets + '/'));
    assert.equal(await readFile(join(rebound.projectRoot, 'inventory.ts'), 'utf8'), content);
    assert.equal((await request(source)).body.text, content);
    const matched = await request('/search/keyword' + project + '&snapshotId=' + release.id + '&q=inventoryCount');
    assert.ok(matched.body.some(hit => hit.unit.qualifiedName === 'inventoryCount'));
    const wikiMatches = await request('/summaries/search' + project + '&snapshotId=' + release.id + '&q=Stable');
    assert.equal(wikiMatches.body[0].revision.id, edited.body.revision.id);
    assert.deepEqual((await request(receipt)).body, originalReceipt);
    assert.deepEqual(await readExport(), Buffer.from(markdown));
    assert.deepEqual(await readArtifact(attachment.body, 'application/pdf'), originalPdf);
    assert.deepEqual(await readArtifact(word.body, docxMedia), originalDocx);
    assert.equal((await request(attachmentUrl)).body.text, markdown);
    assert.deepEqual((await request('/admin/model-usage')).body, usage);
    assert.equal((await request('/admin/model-providers')).body.find(value => value.id === 'legacy-ollama').apiKeyConfigured, true);
    assert.deepEqual((await request(futurePath, 'POST', undefined, 'backup-future')).body, queued.body);
    const execution = queued.body.pollVia.slice(7) + '/execution';
    assert.equal((await request(execution)).body.state, 'QUEUED');
    const selected = (await request(execution)).body;
    assert.equal((await request(execution, 'POST', { action: 'cancel', revision: selected.revision })).body.state, 'CANCELLED');
    assert.equal((await request('/assets/' + asset.assetId + '/reindex', 'POST')).status, 202);
    assert.equal((await wait('/assets/' + asset.assetId, ['INDEXING'])).projectId, asset.projectId);
    const lifecycle = '/knowledge-snapshots/' + release.id + '/lifecycle' + project;
    assert.equal((await request(lifecycle, 'POST', { action: 'retire', revision: 0 }, 'retired-after-restore')).status, 200);
    await stop();
    const clock = new DatabaseSync(recoveryResult.database);
    try { clock.prepare('UPDATE knowledge_retirement SET collect_after = ? WHERE snapshot_id = ?').run(Date.now() - 1, release.id); }
    finally { clock.close(); }
    const maintenance = await RepositoryIndex.open(recoveryResult.database, projects, undefined, recoveryResult.assets);
    try {
        maintenance.snapshotRetirement.collect();
        maintenance.snapshotRetirement.collect();
        assert.equal(maintenance.knowledgeSnapshots.get(release.id), undefined);
        const collected = maintenance.identity.audit(20).filter(row => row.action === 'KNOWLEDGE_SNAPSHOT_PURGE' && row.targetId === release.id);
        assert.equal(collected.length, 1);
        assert.equal(collected[0].actorId, 'system');
        assert.equal(maintenance.assets.find(asset.assetId).sourceObject.sha256, asset.sourceObject.sha256);
    } finally { await maintenance.close(); }

    const rejected = join(root, 'should-not-exist');
    await writeFile(archivedBytes, 'damaged');
    await assert.rejects(recovery('verify', bundle), error => error.stderr.includes('RECOVERY_CHECKSUM_MISMATCH'));
    await assert.rejects(recovery('restore', bundle, rejected), error => error.stderr.includes('RECOVERY_CHECKSUM_MISMATCH'));
    await assert.rejects(stat(rejected), { code: 'ENOENT' });
});
