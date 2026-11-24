import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { redactReviewText } from '../dist/review-redaction.js';
import { parseDiff } from '../dist/unified-diff.js';

test('unified diff keeps quoted names, empty ranges and malformed hunk ordinals', () => {
    const quoted = String.raw`"b/\345\272\223 file.ts"`;
    const diff = ['diff --git ' + quoted.replace('b/', 'a/') + ' ' + quoted, 'new file mode 100644', '--- /dev/null',
        '+++ ' + quoted, '@@ -0,0 +1 @@', '+export const stock = 1;', '\\ No newline at end of file',
        '--- old.txt\t2026-01-01 00:00:00', '+++ new.txt\t2026-01-01 00:00:00', '@@ -1 +1 @@', '-old', '+new',
        '@@ -1 +1 @@', '-older', '+newer'].join('\r\n');
    const { files } = parseDiff(diff);
    assert.deepEqual(files.map(file => [file.oldPath, file.newPath]), [['', '库 file.ts'], ['old.txt', 'new.txt']]);
    assert.equal(files[0].kind, 'ADDED');
    assert.equal(files[0].hunks[0].newCount, 1);
    assert.equal(files[0].hunks[0].lines.at(-1), '\\ No newline at end of file');
    assert.deepEqual(files[1].hunkCandidates.map(item => [item.ordinal, item.hunkIndex]), [[1, 0], [2, null]]);
});

test('change review redacts multiline credential literals and preserves hunk markers', () => {
    const content = ['-const apiKey = "obsolete";', '+const apiKey = `first', '+second`;', ' const pass = 0;',
        '+password = """third', '+fourth"""', ' keep'].join('\n');
    assert.equal(redactReviewText(content, false, true), ['-const apiKey = "********";', '+const apiKey = `*****',
        '+******`;', ' const pass = 0;', '+password = """*****', '+******"""', ' keep'].join('\n'));
});

test('change review freezes scoped, redacted diff and source evidence for both export formats', { timeout: 20_000 }, async t => {
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'repograph-review-')));
    const root = join(tmp, 'repo');
    const other = join(tmp, 'other');
    const name = 'source.ts';
    const sourceFile = join(root, name);
    const marker = 'fixture-mask-value';
    await Promise.all([mkdir(root), mkdir(other)]);
    await writeFile(sourceFile, ['export function shipment() {', `    const apiKey = "${marker}";`, '    return 2;', '}'].join('\n'));
    await writeFile(join(other, name), 'export function foreignProject() {}');
    const token = randomBytes(32).toString('hex');
    const children = new Set();
    async function start() {
        const child = spawn(process.execPath, ['dist/server.js'], {
            env: { ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined, REPOGRAPH_PORT: '0',
                REPOGRAPH_PROJECTS_ROOT: tmp, REPOGRAPH_DB_PATH: join(tmp, 'index.db'), REPOGRAPH_ASSETS_ROOT: join(tmp, 'assets'),
                REPOGRAPH_EMBEDDING_MODEL: undefined }, stdio: ['ignore', 'ignore', 'pipe']
        });
        children.add(child);
        const base = await new Promise((resolve, reject) => {
            let logs = '';
            child.once('error', reject);
            child.once('exit', code => reject(new Error('Server exited (' + code + '): ' + logs)));
            child.stderr.on('data', bytes => {
                logs += bytes;
                const address = logs.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
                if (address) resolve(address);
            });
        });
        return { child, base };
    }
    async function stop(child) {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
        children.delete(child);
    }
    t.after(async () => {
        await Promise.all([...children].map(stop));
        await rm(tmp, { recursive: true, force: true });
    });
    let server = await start();
    async function api(path, params = {}, body, authorized = true, method) {
        const response = await fetch(server.base + '/api/v1' + path + '?' + new URLSearchParams(params), {
            method: method ?? (body !== undefined || path === '/index/file' ? 'POST' : 'GET'),
            headers: { ...(authorized ? { Authorization: 'Bearer ' + token } : {}),
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const mime = response.headers.get('content-type');
        return { status: response.status, body: mime?.startsWith('application/json') ? await response.json() : await response.text(),
            headers: response.headers };
    }
    assert.equal((await api('/index/file', { projectRoot: root, file: sourceFile })).status, 200);
    assert.equal((await api('/index/file', { projectRoot: other, file: join(other, name) })).status, 200);
    const projects = (await api('/projects')).body;
    const id = projects.find(project => project.projectRoot === root).projectId;
    const foreign = projects.find(project => project.projectRoot === other).projectId;
    const diff = [
        'diff --git a/source.ts b/source.ts', '--- a/source.ts', '+++ b/source.ts',
        '@@ -1,4 +1,4 @@ shipment', ' export function shipment() {',
        '-    const apiKey = "old-fixture";', `+    const apiKey = "${marker}";`,
        '-    return 1;', '+    return 2;', ' }',
        'diff --git a/removed.ts b/removed.ts', 'deleted file mode 100644', '--- a/removed.ts', '+++ /dev/null',
        '@@ -1 +0,0 @@', '-export function oldShipment() {}',
        'diff --git a/photo.bin b/photo.bin', 'Binary files a/photo.bin and b/photo.bin differ',
        'diff --git a/broken.ts b/broken.ts', '--- a/broken.ts', '+++ b/broken.ts', '@@ -1,3 +1,3 @@', '-old', '+new',
        'diff --git a/alias.ts b/copy.ts', 'similarity index 100%', 'rename from alias.ts', 'rename to copy.ts'
    ].join('\n') + '\n';
    const input = { projectId: id, baseVersion: 'base-fixture', targetVersion: 'target-fixture', diff };
    assert.equal((await api('/change-reviews', {}, input, false)).status, 401);
    const created = await api('/change-reviews', {}, input);
    assert.equal(created.status, 200);
    const snapshot = created.body;
    const address = '/change-reviews/' + snapshot.id;
    assert.equal(snapshot.status, 'PARTIAL');
    assert.equal(snapshot.totalHunkCount, 3);
    assert.equal(snapshot.plannedHunkCount, 2);
    assert.equal(snapshot.omittedHunkCount, 1);
    assert.equal(snapshot.untrustedEvidence, true);
    assert.ok(snapshot.omittedReasons.includes('INDEX_VERSION_UNVERIFIED'));
    assert.deepEqual(snapshot.files.map(file => file.kind), ['MODIFIED', 'DELETED', 'BINARY', 'MODIFIED', 'RENAMED']);
    assert.deepEqual(snapshot.hunkLedger.map(hunk => hunk.disposition), ['PLANNED', 'PLANNED', 'OMITTED']);
    assert.equal(snapshot.units[0].hunkMappings[0].status, 'MAPPED');
    const evidence = snapshot.units[0].contextPack.evidence[0];
    assert.equal(evidence.qualifiedName, 'shipment');
    assert.equal(evidence.filePath, name);
    assert.equal(evidence.projectId, id);
    assert.match(evidence.excerpt, /return 2/);
    assert.equal(snapshot.units[1].hunkMappings[0].status, 'UNMAPPED');
    assert.doesNotMatch(JSON.stringify(snapshot), /fixture-mask-value|old-fixture|foreignProject/);
    assert.equal((await api(address, { projectId: foreign })).status, 404);

    const before = await api(address + '/export', { projectId: id, format: 'markdown' });
    assert.match(before.body, /Hunk Ledger/);
    assert.match(before.body, /shipment/);
    assert.doesNotMatch(before.body, /fixture-mask-value|old-fixture/);
    assert.match(before.headers.get('content-disposition'), /attachment/);
    assert.deepEqual((await api(address + '/export', { projectId: id, format: 'json' })).body, snapshot);

    await writeFile(sourceFile, ['export function shipment() {', '    const note = "replacement";', '    return 8;', '}'].join('\n'));
    assert.equal((await api('/index/file', { projectRoot: root, file: sourceFile })).status, 200);
    await stop(server.child);
    server = await start();
    assert.deepEqual((await api(address, { projectId: id })).body, snapshot);
    assert.equal((await api(address + '/export', { projectId: id })).body, before.body);

    const stale = (await api('/change-reviews', {}, input)).body;
    assert.equal(stale.units[0].hunkMappings[0].status, 'UNMAPPED');
    assert.ok(stale.units[0].hunkMappings[0].omittedReasons.includes('INDEX_LINE_CONTENT_DIFFERS'));
    assert.deepEqual(stale.units[0].contextPack.evidence, []);

    const limited = (await api('/change-reviews', {}, { ...input, budgetChars: 1 })).body;
    assert.equal(limited.status, 'FAILED');
    assert.equal(limited.plannedHunkCount, 0);
    assert.equal(limited.omittedHunkCount, 3);

    const runPath = '/agent-runs/change-review';
    const disabled = await api(runPath, {}, { projectId: id, snapshotId: snapshot.id });
    assert.equal(disabled.status, 202);
    const wait = async runId => {
        for (let attempt = 0; attempt < 100; attempt++) {
            const result = (await api('/agent-runs/' + runId)).body;
            if (result.status !== 'QUEUED' && result.status !== 'RUNNING') return result;
            await delay(25);
        }
        assert.fail('Change review did not finish');
    };
    assert.equal((await wait(disabled.body.id)).steps[1].error, 'CHANGE_REVIEW_MODEL_UNAVAILABLE');
    assert.equal((await api(runPath, {}, { projectId: foreign, snapshotId: snapshot.id })).status, 404);
    const legacy = await api(runPath, {}, input);
    assert.equal(legacy.status, 202);
    assert.match(legacy.body.outputReference, /^change-review:[a-f0-9-]+$/);
    assert.notEqual(legacy.body.outputReference, disabled.body.outputReference);
    await wait(legacy.body.id);

    const prompts = [];
    let behavior = 'normal', held;
    const fixture = createServer(async (request, response) => {
        const parts = [];
        for await (const part of request) parts.push(part);
        const prompt = JSON.parse(JSON.parse(Buffer.concat(parts).toString('utf8')).messages.at(-1).content);
        prompts.push(prompt);
        if (behavior === 'cancel' && prompt.round === 2) { held(); return; }
        const finding = { summary: 'Add a focused test for the new return value.', uncertainty: 0.4, citationIds: ['C1'] };
        const next = behavior === 'unread' ? { action: 'FINISH', findings: [finding] }
            : prompt.round === 1 ? { action: 'READ_CONTEXT', citationIds: ['C1'] }
                : prompt.round === 2 ? { action: 'VERIFY', verification: { check: 'REGRESSION', citationIds: ['C1'] } }
                    : { action: 'FINISH', findings: [finding, { ...finding, citationIds: ['C99'] }] };
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            message: { content: JSON.stringify(next) }, done_reason: 'stop'
        }));
    });
    fixture.listen(0, '127.0.0.1');
    await once(fixture, 'listening');
    t.after(() => { fixture.closeAllConnections(); return new Promise(resolve => fixture.close(resolve)); });
    const config = { name: 'Review fixture', protocol: 'OLLAMA', baseUrl: 'http://127.0.0.1:' + fixture.address().port,
        model: 'fixture', timeoutMillis: 5_000, maxOutputTokens: 1024, enabled: true };
    assert.equal((await api('/admin/model-providers/legacy-ollama', {}, config, true, 'PUT')).status, 200);
    const accepted = await api(runPath, {}, { projectId: id, snapshotId: snapshot.id });
    const reviewRun = await wait(accepted.body.id);
    assert.equal(reviewRun.status, 'PARTIAL');
    assert.equal(reviewRun.outputReference, 'change-review:' + snapshot.id);
    assert.deepEqual(prompts.map(prompt => prompt.round), [1, 2, 3]);
    assert.deepEqual(prompts[0].readContext, []);
    assert.match(prompts[1].readContext[0].excerpt, /return 2/);
    assert.doesNotMatch(JSON.stringify(prompts), /return 8|fixture-mask-value|old-fixture|foreignProject/);
    const verified = reviewRun.steps.find(step => step.capability === 'VERIFY_CHANGE').verification;
    assert.deepEqual(verified, { projectId: id, snapshotId: snapshot.id, unitId: snapshot.units[0].unit.id,
        check: 'REGRESSION', status: 'UNAVAILABLE', citationIds: ['C1'] });
    assert.deepEqual(prompts[2].verification, [{ check: 'REGRESSION', status: 'UNAVAILABLE', citationIds: ['C1'] }]);
    assert.deepEqual(reviewRun.steps.flatMap(step => step.results).map(({ advisoryOnly, citationIds }) => [advisoryOnly, citationIds]),
        [[true, ['C1']]]);

    behavior = 'unread';
    const ungrounded = await api(runPath, {}, { projectId: id, snapshotId: snapshot.id });
    assert.deepEqual((await wait(ungrounded.body.id)).steps.flatMap(step => step.results), []);

    behavior = 'cancel';
    const modelHeld = new Promise(resolve => { held = resolve; });
    const toCancel = await api(runPath, {}, { projectId: id, snapshotId: snapshot.id });
    await modelHeld;
    assert.equal((await api(runPath, {}, { projectId: id, snapshotId: snapshot.id })).status, 409);
    const cancelPath = '/agent-runs/' + toCancel.body.id + '/cancel';
    assert.equal((await api(cancelPath, { projectId: foreign }, undefined, true, 'POST')).status, 404);
    const cancelled = await api(cancelPath, {}, undefined, true, 'POST');
    assert.equal(cancelled.body.status, 'CANCELLED');
    assert.equal(cancelled.body.outputReference, 'change-review:' + snapshot.id);
    assert.ok(cancelled.body.steps.some(step => step.capability === 'READ_REVIEW_CONTEXT' && step.status === 'COMPLETED'));
    await stop(server.child);
    server = await start();
    assert.deepEqual(await wait(toCancel.body.id), cancelled.body);
    assert.deepEqual(await wait(accepted.body.id), reviewRun);
    assert.deepEqual((await api(address, { projectId: id })).body, snapshot);
});
