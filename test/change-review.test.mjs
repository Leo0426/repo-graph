import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
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
    async function stop(child, signal = 'SIGTERM') {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill(signal);
        await exited;
        children.delete(child);
    }
    t.after(async () => {
        await Promise.all([...children].map(child => stop(child)));
        await rm(tmp, { recursive: true, force: true });
    });
    let server = await start();
    async function api(path, params = {}, body, authorized = true, method, headers = {}) {
        const response = await fetch(server.base + '/api/v1' + path + '?' + new URLSearchParams(params), {
            method: method ?? (body !== undefined || path === '/index/file' ? 'POST' : 'GET'),
            headers: { ...(authorized ? { Authorization: 'Bearer ' + token } : {}),
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
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
    const wait = async (runId, limit = 100) => {
        for (let attempt = 0; attempt < limit; attempt++) {
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

    const prompts = [], askPrompts = [];
    let behavior = 'normal', held, transientSent = false;
    const fixture = createServer(async (request, response) => {
        const parts = [];
        for await (const part of request) parts.push(part);
        const prompt = JSON.parse(JSON.parse(Buffer.concat(parts).toString('utf8')).messages.at(-1).content);
        if (Array.isArray(prompt.evidence)) {
            askPrompts.push(prompt);
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
                message: { content: JSON.stringify({ answer: 'The frozen report records the selected location.', citations: ['E2'] }) }, done_reason: 'stop'
            }));
            return;
        }
        prompts.push(prompt);
        if (behavior === 'cancel' && prompt.round === 2) { held(); return; }
        if (behavior === 'interrupt' && prompt.file === 'stock.ts' && prompt.round === 1) { held(); return; }
        if (behavior === 'retry' && !transientSent) {
            transientSent = true;
            response.writeHead(429, { 'Retry-After': '0' }).end();
            return;
        }
        if (behavior === 'denied') { response.writeHead(403).end(); return; }
        const finding = { summary: 'Add a focused test for the new return value.', uncertainty: 0.4, citationIds: ['C1'] };
        const next = behavior === 'unread' ? { action: 'FINISH', findings: [finding] }
            : prompt.round === 1 ? { action: 'READ_CONTEXT', citationIds: ['C1'] }
                : prompt.round === 2 && behavior !== 'recover' && behavior !== 'retry'
                    ? { action: 'VERIFY', verification: { check: 'REGRESSION', citationIds: ['C1'] } }
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

    const stock = join(root, 'stock.ts');
    await writeFile(stock, 'export function stock() {\n    return 3;\n}\n');
    assert.equal((await api('/index/file', { projectRoot: root, file: stock })).status, 200);
    const durableReport = (await api('/change-reviews', {}, { ...input, diff: [
        '--- a/source.ts', '+++ b/source.ts', '@@ -3 +3 @@', '-    return 7;', '+    return 8;',
        '--- a/stock.ts', '+++ b/stock.ts', '@@ -2 +2 @@', '-    return 2;', '+    return 3;'
    ].join('\n') + '\n' })).body;
    behavior = 'interrupt';
    const secondUnitHeld = new Promise(resolve => { held = resolve; });
    const durableInput = { projectId: id, snapshotId: durableReport.id };
    const durableHeaders = { 'Idempotency-Key': 'recover-review' };
    const interrupted = await api(runPath, {}, durableInput, true, 'POST', durableHeaders);
    assert.equal(interrupted.status, 202, JSON.stringify(interrupted.body));
    await secondUnitHeld;
    const executionPath = '/agent-runs/' + interrupted.body.id + '/execution';
    const acknowledged = (await api('/agent-runs/' + interrupted.body.id)).body.steps.filter(step => step.capability === 'REVIEW_UNIT')[0];
    assert.ok(acknowledged.results.length > 0);
    const priorAttempts = (await api(executionPath + '/attempts')).body;
    assert.deepEqual(priorAttempts.map(attempt => attempt.number), [1]);
    await stop(server.child, 'SIGKILL');
    behavior = 'recover';
    server = await start();
    assert.equal((await api(runPath, {}, durableInput, true, 'POST', durableHeaders)).body.id, interrupted.body.id);
    assert.equal((await api(runPath, {}, { ...durableInput, snapshotId: snapshot.id }, true, 'POST', durableHeaders)).body.error, 'JOB_REQUEST_CONFLICT');
    const recovered = await wait(interrupted.body.id, 380);
    assert.equal(recovered.status, 'PARTIAL');
    const savedUnits = recovered.steps.filter(step => step.capability === 'REVIEW_UNIT');
    assert.deepEqual(savedUnits[0], acknowledged);
    assert.equal(savedUnits[1].results.length, 1);
    const ledger = (await api(executionPath + '/attempts')).body;
    assert.deepEqual(ledger.map(attempt => attempt.outcome), ['LEASE_EXPIRED', 'FINISHED']);
    assert.match(ledger[1].resultHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(prompts.filter(prompt => prompt.snapshotId === durableReport.id).map(prompt => [prompt.file, prompt.round]),
        [['source.ts', 1], ['source.ts', 2], ['source.ts', 3], ['stock.ts', 1], ['stock.ts', 1], ['stock.ts', 2]]);
    behavior = 'retry';
    const fromPrompt = prompts.length;
    const retryReview = await api(runPath, {}, { projectId: id, snapshotId: snapshot.id });
    const retryResult = await wait(retryReview.body.id);
    assert.equal(retryResult.steps.find(step => step.capability === 'REVIEW_UNIT').results.length, 1);
    assert.deepEqual(prompts.slice(fromPrompt).map(prompt => prompt.round), [1, 1, 2]);
    const usage = (await api('/admin/model-usage', { runId: retryReview.body.id })).body.records;
    assert.equal(usage.length, 3);
    assert.equal(usage.filter(item => item.reason === 'PROVIDER_HTTP_429').length, 1);
    assert.equal(usage.filter(item => item.status === 'COMPLETED').length, 2);
    behavior = 'denied';
    const deniedReview = await api(runPath, {}, { projectId: id, snapshotId: snapshot.id });
    const deniedResult = await wait(deniedReview.body.id);
    assert.equal(deniedResult.steps.find(step => step.capability === 'REVIEW_UNIT').error, 'PROVIDER_HTTP_403');
    assert.equal((await api('/admin/model-usage', { runId: deniedReview.body.id })).body.records.length, 1);

    assert.equal((await api('/admin/model-providers/legacy-ollama', {}, { ...config, enabled: false }, true, 'PUT')).status, 200);
    async function indexedRelease(directory, projectId) {
        assert.equal((await api('/index/project', { projectRoot: directory }, undefined, true, 'POST')).status, 202);
        let indexing;
        for (let turn = 0; turn < 120; turn++) {
            indexing = (await api('/index/project/status', { projectRoot: directory })).body;
            if (!['idle', 'running'].includes(indexing.status)) break;
            await delay(25);
        }
        assert.equal(indexing.status, 'done');
        const wiki = await api('/summaries/generate', { projectId }, undefined, true, 'POST');
        assert.equal(wiki.status, 202);
        assert.equal((await wait(wiki.body.agentRunId)).status, 'COMPLETED');
        return (await api('/knowledge-snapshots', { projectId })).body[0].id;
    }
    const former = join(root, '库 file.ts');
    const pom = join(root, 'pom.xml');
    const manifest = version => `<project><dependencies><dependency><groupId>org.apache.logging.log4j</groupId>`
        + `<artifactId>log4j-core</artifactId><version>${version}</version></dependency></dependencies></project>`;
    await writeFile(former, 'export const unchanged = 1;\n');
    await writeFile(sourceFile, 'export function shipment() {\n    return 10;\n}\n');
    await writeFile(pom, manifest('3.0.0'));
    const git = (...args) => promisify(execFile)('git', ['-c', 'user.name=Synthetic fixture', '-c', 'user.email=fixture@example.test', ...args], {
        cwd: root, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
    });
    await git('init', '--quiet');
    await git('add', '--', name, '库 file.ts', 'pom.xml');
    await git('commit', '--quiet', '-m', 'Fixture baseline');
    const baseCommit = (await git('rev-parse', 'HEAD')).stdout.trim();
    const baseRelease = await indexedRelease(root, id);
    await rename(former, join(root, 'changed name.ts'));
    await writeFile(sourceFile, 'export function shipment() {\n    return 20;\n}\n');
    await writeFile(pom, manifest('2.14.0'));
    const targetRelease = await indexedRelease(root, id);
    const elsewhere = await indexedRelease(other, foreign);
    await writeFile(pom, manifest('3.1.0'));
    assert.equal((await api('/index/file', { projectRoot: root, file: pom })).status, 200);
    await writeFile(sourceFile, 'export function shipment() {\n    return 30;\n}\n');
    assert.equal((await api('/index/file', { projectRoot: root, file: sourceFile })).status, 200);
    const overlay = (selection, key = randomUUID()) => api('/change-reviews/working-copy', {}, { projectId: id, ...selection }, true, 'POST',
        { 'Idempotency-Key': key });
    const working = { baseSnapshotId: baseRelease, paths: [name, '库 file.ts', 'changed name.ts'] };
    const fromWorktree = await overlay(working, 'worktree');
    assert.equal(fromWorktree.status, 200, JSON.stringify(fromWorktree.body));
    assert.equal(fromWorktree.body.provenance.scope, 'WORKING_COPY_OVERLAY');
    assert.equal(fromWorktree.body.provenance.targetSnapshotId, null);
    assert.equal(fromWorktree.body.provenance.baseCommit, baseCommit);
    assert.equal(fromWorktree.body.provenance.totalFiles, 2);
    assert.ok(fromWorktree.body.files.some(item => item.kind === 'RENAMED'));
    assert.match(fromWorktree.body.units[0].contextPack.evidence[0].excerpt, /return 30/);
    assert.equal((await overlay({ ...working, baseSnapshotId: targetRelease })).body.error, 'OVERLAY_BASE_SOURCE_MISMATCH');
    await symlink(join(other, name), join(root, 'indirect.ts'));
    assert.equal((await overlay({ ...working, paths: ['indirect.ts'] })).body.error, 'OVERLAY_SOURCE_PATH_CHANGED');
    await writeFile(sourceFile, 'export function shipment() {\n    return 31;\n}\n');
    const openedCapture = await api('/change-reviews/' + fromWorktree.body.id + '/overlay-source', { projectId: id, file: name });
    assert.match(openedCapture.body.text, /return 30/);
    assert.deepEqual((await overlay({ ...working, paths: [...working.paths].reverse() }, 'worktree')).body, fromWorktree.body);
    assert.match((await api('/change-reviews/' + fromWorktree.body.id + '/export', { projectId: id, format: 'markdown' })).body, /Overlay digest/);
    await git('add', '--', name);
    await git('commit', '--quiet', '-m', 'Fixture continued');
    assert.equal((await overlay({ baseSnapshotId: baseRelease, paths: [name] })).body.error, 'OVERLAY_BASE_SOURCE_MISMATCH');
    assert.match((await api('/change-reviews/' + fromWorktree.body.id + '/overlay-source', { projectId: id, file: name })).body.text, /return 30/);
    const compare = (input, authorized = true, key = randomUUID()) => api('/change-reviews/compare', {},
        { projectId: id, ...input }, authorized, 'POST', { 'Idempotency-Key': key });
    assert.equal((await compare({ baseSnapshotId: baseRelease, targetSnapshotId: targetRelease }, false)).status, 401);
    assert.equal((await compare({ baseSnapshotId: elsewhere, targetSnapshotId: targetRelease })).status, 404);
    assert.equal((await compare({ baseSnapshotId: baseRelease, targetSnapshotId: elsewhere })).status, 404);
    const explicitRequest = { baseSnapshotId: baseRelease, targetSnapshotId: targetRelease };
    const explicit = await compare(explicitRequest, true, 'explicit');
    assert.equal(explicit.status, 200, JSON.stringify(explicit.body));
    const compared = explicit.body;
    assert.equal(compared.provenance.baselineReason, 'EXPLICIT');
    assert.equal(compared.provenance.baseSnapshotId, baseRelease);
    assert.equal(compared.provenance.targetSnapshotId, targetRelease);
    assert.equal(compared.provenance.totalFiles, 2);
    assert.deepEqual(compared.checkCoverage.map(record => record.status), ['UNAVAILABLE']);
    assert.equal(compared.dependencyCheck.status, 'COMPLETED');
    assert.equal(compared.dependencyCheck.provenance, 'FROZEN_INDEX_INPUT');
    assert.equal(compared.dependencyCheck.comparableComponents, 1);
    assert.match(compared.dependencyCheck.catalogDigest, /^[a-f0-9]{64}$/);
    assert.ok(compared.dependencyCheck.preview.some(finding => finding.version === '2.14.0' && finding.manifests.includes('pom.xml')));
    const formerCheck = (await compare({ baseSnapshotId: null, targetSnapshotId: baseRelease })).body.dependencyCheck;
    assert.equal(formerCheck.status, 'COMPLETED');
    assert.equal(formerCheck.findingCount, 0);
    assert.notEqual(formerCheck.manifestDigest, compared.dependencyCheck.manifestDigest);
    assert.equal(formerCheck.catalogDigest, compared.dependencyCheck.catalogDigest);
    assert.deepEqual((await compare(explicitRequest)).body.dependencyCheck, compared.dependencyCheck);
    assert.deepEqual(compared.files.filter(file => file.kind === 'RENAMED').map(file => [file.oldPath, file.newPath]),
        [['库 file.ts', 'changed name.ts']]);
    assert.doesNotMatch(JSON.stringify(compared), /return 30|foreignProject|INDEX_VERSION_UNVERIFIED/);
    const exact = compared.units.find(item => item.unit.filePath === name);
    assert.deepEqual(exact.hunkMappings[0].changedRanges, [{ startLine: 2, endLine: 2 }]);
    assert.match(exact.contextPack.evidence[0].excerpt, /return 20/);
    const exactMarkdown = (await api('/change-reviews/' + compared.id + '/export', { projectId: id, format: 'markdown' })).body;
    assert.match(exactMarkdown, new RegExp(targetRelease));
    assert.match(exactMarkdown, new RegExp(compared.dependencyCheck.catalogDigest));
    const unchanged = (await compare({ targetSnapshotId: targetRelease })).body;
    assert.equal(unchanged.provenance.baselineReason, 'PREVIOUS_REVIEW');
    assert.equal(unchanged.status, 'COMPLETED');
    assert.deepEqual(unchanged.files, []);
    assert.deepEqual(unchanged.checkCoverage.map(record => record.status), ['NOT_APPLICABLE']);
    assert.deepEqual((await compare(explicitRequest, true, 'explicit')).body, compared);
    assert.equal((await compare({ targetSnapshotId: targetRelease }, true, 'explicit')).status, 409);
    const importCheck = (format, codeVersion, body) => api('/triage/findings/import', { projectId: id, format, codeVersion }, body);
    const sampleFinding = { results: [1, 2].map(line => ({ check_id: 'fixture.guard', path: name, start: { line }, end: { line },
        extra: { severity: 'INFO', message: 'Synthetic inspection record' } })) };
    assert.equal((await importCheck('semgrep', baseRelease, sampleFinding)).status, 200);
    assert.equal((await importCheck('semgrep', targetRelease, sampleFinding)).status, 200);
    const populated = (await compare(explicitRequest)).body;
    assert.deepEqual(populated.checkCoverage.map(check => [check.status, check.provenance, check.accepted]),
        [['COMPLETED', 'DECLARED_VERSION', 2]]);
    assert.equal(populated.units[0].externalFindingReferences[0].version, 'MATCHED_DECLARED_VERSION');
    const located = populated.structuredFindings.find(item => item.location.startLine === 2);
    const outside = populated.structuredFindings.find(item => item.location.startLine === 1);
    assert.equal(located.publishability, 'CHANGED_LINE');
    assert.equal(outside.publishability, 'REPORT_ONLY');
    assert.equal(located.snapshotId, targetRelease);
    assert.equal(located.evidence.length, 1);
    const findingPath = '/change-reviews/' + populated.id + '/findings/' + located.id;
    const decide = (input, key) => api(findingPath, { projectId: id }, input, true, 'POST', { 'Idempotency-Key': key });
    const initial = await api(findingPath, { projectId: id });
    assert.deepEqual([initial.body.current, initial.body.revision], ['UNREVIEWED', 0]);
    assert.equal((await decide({ revision: 0, action: 'APPEAL', reason: 'Review a prior decision.' }, 'premature')).body.error, 'CHANGE_REVIEW_APPEAL_UNAVAILABLE');
    const confirmed = { revision: 0, action: 'CONFIRM', reason: 'Reviewed the frozen target line.' };
    const [decision, sameDecision] = await Promise.all([decide(confirmed, 'confirm'), decide(confirmed, 'confirm')]);
    assert.deepEqual(decision.body, sameDecision.body);
    assert.equal(decision.body.entry.revision, 1);
    assert.equal((await decide({ ...confirmed, reason: 'another payload' }, 'confirm')).status, 409);
    assert.equal((await decide({ ...confirmed, action: 'DISMISS' }, 'stale-finding')).body.error, 'CHANGE_REVIEW_FINDING_CHANGED');
    const candidateEvidence = { reviewId: populated.id, findingId: located.id, revision: 1 };
    const rule = { ruleId: 'fixture.guard.refined', source: 'review-fixture', cwe: 'Unclassified', title: 'Fixture inventory tracking',
        severity: 'INFO', matcherKind: 'SUBSTRING', pattern: 'inventoryConfirmed(', languages: ['javascript'],
        positiveSamples: ['inventoryConfirmed(value)'], negativeSamples: ['inventoryPending(value)'], changeNotes: 'Use the confirmed marker.',
        reason: 'Reviewed a synthetic result.' };
    const propose = (body, key) => api('/change-rule-candidates', { projectId: id }, body, true, 'POST', { 'Idempotency-Key': key });
    const draftInput = { rule, evidence: [candidateEvidence] };
    const draft = await propose(draftInput, 'rule-draft');
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.equal(draft.body.rule.status, 'CANDIDATE');
    assert.deepEqual(draft.body.candidate.evidence[0], { ...candidateEvidence, action: 'CONFIRM', tool: 'semgrep', sourceRuleId: 'fixture.guard',
        snapshotId: targetRelease });
    assert.deepEqual((await propose(draftInput, 'rule-draft')).body, draft.body);
    assert.equal((await propose({ ...draftInput, rule: { ...rule, reason: 'Other intent' } }, 'rule-draft')).body.error, 'REVIEW_RULE_REQUEST_CONFLICT');
    const processRule = (number, action, reason = 'Reviewed fixture samples.') => api('/rules/' + rule.ruleId + '/versions/' + number + '/' + action,
        {}, { reason });
    assert.equal((await processRule(draft.body.rule.version, 'publish')).body.error, 'RULE_STATE_CONFLICT');
    assert.equal((await processRule(draft.body.rule.version, 'review')).body.status, 'IN_REVIEW');
    const appealed = await decide({ revision: 1, action: 'APPEAL', reason: 'Please check this reference again.' }, 'appeal');
    assert.equal(appealed.body.entry.revision, 2);
    assert.deepEqual((await api(findingPath, { projectId: id })).body.entries.map(entry => entry.action), ['APPEAL', 'CONFIRM']);
    assert.equal((await processRule(draft.body.rule.version, 'publish')).body.error, 'REVIEW_RULE_EVIDENCE_CHANGED');
    const reconfirmed = await decide({ ...confirmed, revision: 2 }, 'reconfirm');
    assert.equal(reconfirmed.body.entry.revision, 3);
    const updatedEvidence = [{ ...candidateEvidence, revision: 3 }];
    const flawed = await propose({ rule: { ...rule, negativeSamples: ['inventoryConfirmed(value)'] }, evidence: updatedEvidence }, 'rule-regression');
    assert.equal(flawed.body.rule.status, 'CANDIDATE');
    assert.equal((await processRule(flawed.body.rule.version, 'review')).body.status, 'IN_REVIEW');
    assert.equal((await processRule(flawed.body.rule.version, 'publish')).status, 409);
    const candidate = await propose({ rule, evidence: updatedEvidence }, 'rule-candidate');
    assert.equal((await processRule(candidate.body.rule.version, 'review')).body.status, 'IN_REVIEW');
    assert.equal((await processRule(candidate.body.rule.version, 'publish')).body.status, 'PUBLISHED');
    const candidatePath = '/change-rule-candidates/' + candidate.body.candidate.id;
    assert.equal((await api(candidatePath)).body.rule.status, 'PUBLISHED');
    const anchoredReview = { projectId: id, reviewId: populated.id, findingId: located.id };
    assert.equal((await api('/ask/sessions', {}, { review: { ...anchoredReview, projectId: foreign } })).status, 404);
    assert.equal((await api('/ask/sessions', {}, { review: anchoredReview, scopes: [{ projectId: id }] })).status, 400);
    const ask = await api('/ask/sessions', {}, { review: anchoredReview }, true, 'POST', { 'Idempotency-Key': 'ask-report' });
    assert.equal(ask.status, 201, JSON.stringify(ask.body));
    assert.deepEqual(ask.body.scope.review, anchoredReview);
    const sessionRoute = '/ask/sessions/' + ask.body.id;
    const askTurn = (question, key, context) => api(sessionRoute + '/turns', {}, { question, ...(context && { context }) }, true, 'POST', { 'Idempotency-Key': key });
    assert.equal((await askTurn('Read the unrelated current file', 'outside-report', [{ projectId: id, snapshotId: targetRelease, path: name }])).body.error,
        'ASK_CONTEXT_OUTSIDE_SCOPE');
    assert.equal((await api('/admin/model-providers/legacy-ollama', {}, config, true, 'PUT')).status, 200);
    const askTurns = [];
    for (const [question, key] of [['Explain this location', 'report-question'], ['What else supports it?', 'report-follow-up']]) {
        const submitted = await askTurn(question, key);
        assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
        const turnId = submitted.body.turn.id;
        askTurns.push(turnId);
        for (let attempt = 0; attempt < 100; attempt++) {
            const turn = await api(sessionRoute + '/turns/' + turnId);
            if (turn.body.status === 'COMPLETED') break;
            if (attempt === 99) assert.fail(JSON.stringify(turn.body));
            await delay(25);
        }
        const citation = await api(sessionRoute + '/turns/' + turnId + '/citations/E2');
        assert.equal(citation.body.kind, 'CHANGE_REVIEW');
        assert.equal(citation.body.reviewId, populated.id);
        assert.equal(citation.body.findingId, located.id);
    }
    const jump = await fetch(server.base + '/api/v1' + sessionRoute + '/turns/' + askTurns[1] + '/citations/E2?open=1',
        { headers: { Authorization: 'Bearer ' + token }, redirect: 'manual' });
    assert.equal(jump.status, 303);
    const destination = new URL(jump.headers.get('Location'), server.base);
    assert.equal(destination.searchParams.get('snapshot'), populated.id);
    assert.equal(destination.hash, '#change-finding-' + populated.id + '-' + located.id);
    assert.equal(askPrompts.length, 2);
    assert.ok(askPrompts.every(prompt => prompt.evidence.some(item => item.excerpt.includes('return 20'))));
    assert.doesNotMatch(JSON.stringify(askPrompts), /return 30|return 31/);
    assert.equal((await api('/admin/model-providers/legacy-ollama', {}, { ...config, enabled: false }, true, 'PUT')).status, 200);
    assert.equal((await importCheck('semgrep', targetRelease, { results: [] })).status, 200);
    const emptyCheck = (await compare(explicitRequest)).body;
    assert.deepEqual(emptyCheck.checkCoverage.map(check => [check.status, check.accepted]), [['ZERO_FINDINGS', 0]]);
    assert.deepEqual(emptyCheck.units[0].externalFindingReferences, []);
    assert.deepEqual(emptyCheck.structuredFindings, []);
    assert.equal((await api(findingPath, { projectId: id })).body.revision, 3);
    const failures = { version: '2.1.0', runs: [{ tool: { driver: { name: 'Synthetic check' } }, invocations: [{ executionSuccessful: false }], results: [] }] };
    assert.equal((await importCheck('sarif', targetRelease, failures)).status, 200);
    assert.equal((await importCheck('semgrep', targetRelease, { results: [], errors: [{ type: 'Sample warning' }] })).status, 200);
    const incompleteChecks = (await compare(explicitRequest)).body;
    assert.deepEqual(incompleteChecks.checkCoverage.map(check => [check.tool, check.status]), [['sarif', 'FAILED'], ['semgrep', 'PARTIAL']]);
    assert.ok(incompleteChecks.omittedReasons.includes('EXTERNAL_CHECKS_INCOMPLETE'));
    const compareScope = (scope, key = randomUUID()) => api('/change-reviews/compare-scope', {}, scope, true, 'POST', { 'Idempotency-Key': key });
    const targetPair = { projectId: id, ...explicitRequest };
    const twoTargets = await compareScope({ targets: [targetPair, { projectId: foreign, targetSnapshotId: elsewhere, baseSnapshotId: null }] });
    assert.equal(twoTargets.status, 200, JSON.stringify(twoTargets.body));
    assert.deepEqual(twoTargets.body.reports.map(item => item.projectId), [id, foreign]);
    assert.ok(twoTargets.body.reports.every(item => item.files.some(file => file.newPath === name)));
    const scopedRequest = { targets: [targetPair], background: [{ projectId: foreign, snapshotId: elsewhere,
        references: [{ path: name, line: 1 }, { path: 'uncaptured.ts', line: 1 }, { path: name, line: 900 }] }] };
    const scoped = await compareScope(scopedRequest, 'with-context');
    assert.equal(scoped.status, 200, JSON.stringify(scoped.body));
    assert.doesNotMatch(JSON.stringify(scoped.body.reports), /foreignProject/);
    assert.deepEqual(scoped.body.background[0].evidence.map(item => item.status), ['READABLE', 'SOURCE_UNAVAILABLE', 'LINE_OUT_OF_RANGE']);
    assert.match(scoped.body.background[0].evidence[0].excerpt, /foreignProject/);
    assert.deepEqual((await compareScope(scopedRequest, 'with-context')).body, scoped.body);
    assert.equal((await compareScope({ targets: [targetPair] }, 'with-context')).status, 409);
    assert.equal((await compareScope({ targets: [targetPair], background: [{ projectId: foreign, snapshotId: targetRelease }] })).status, 404);
    const protectedScope = '/change-reviews/scopes/' + scoped.body.id;
    assert.deepEqual((await api(protectedScope)).body, scoped.body);
    assert.equal((await api(protectedScope, {}, undefined, false)).status, 401);
    assert.equal((await api('/knowledge-snapshots/' + elsewhere + '/lifecycle', { projectId: foreign },
        { action: 'retire', revision: 0 }, true, 'POST', { 'Idempotency-Key': 'retire-context' })).status, 200);
    assert.equal((await api(protectedScope)).status, 404);
    assert.equal((await api('/change-reviews/' + scoped.body.reports[0].id, { projectId: id })).status, 200);
    const analyzed = await api(runPath, {}, { projectId: id, snapshotId: compared.id });
    assert.equal(analyzed.status, 202);
    await wait(analyzed.body.id);
    const retired = await api('/knowledge-snapshots/' + targetRelease + '/lifecycle', { projectId: id },
        { action: 'retire', revision: 0 }, true, 'POST', { 'Idempotency-Key': 'retire-target' });
    assert.equal(retired.status, 200, JSON.stringify(retired.body));
    assert.equal((await api('/change-reviews/' + compared.id, { projectId: id })).status, 404);
    assert.equal((await api(findingPath, { projectId: id })).status, 404);
    assert.equal((await api(candidatePath)).status, 404);
    assert.equal((await api(sessionRoute + '/turns/' + askTurns[1] + '/citations/E2')).status, 404);
    assert.equal((await api('/change-reviews/scopes/' + twoTargets.body.id)).status, 404);
    assert.equal((await compare(explicitRequest, true, 'explicit')).status, 404);
    assert.equal((await api('/agent-runs/' + analyzed.body.id, { projectId: id })).status, 404);
    assert.equal((await api('/agent-runs/' + analyzed.body.id + '/export', { projectId: id })).status, 404);
    const fallback = (await compare({ targetSnapshotId: baseRelease })).body;
    assert.equal(fallback.provenance.baselineReason, 'PREVIOUS_BASELINE_UNAVAILABLE');
    assert.equal(fallback.provenance.mode, 'FULL');
    assert.equal(fallback.provenance.baseSnapshotId, null);
    assert.match(JSON.stringify(fallback.files), /return 10/);
});
