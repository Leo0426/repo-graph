import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const image = process.env.REPOGRAPH_TEST_VERIFIER_IMAGE;
const docker = promisify(execFile);
test('isolated verifier tests frozen bytes, aborts containers and reclaims only after exit', {
    skip: !image && 'Set REPOGRAPH_TEST_VERIFIER_IMAGE to a locally available pinned Node image', timeout: 55_000
}, async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'repograph-verifier-fixture-')));
    const database = join(root, 'data.db');
    const spool = join(tmpdir(), 'repograph-verification-' + createHash('sha256').update(database).digest('hex').slice(0, 24));
    const directory = join(root, 'repository');
    const token = randomBytes(24).toString('hex');
    await mkdir(directory);
    const source = join(directory, 'isolation.test.mjs');
    await writeFile(source, `import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import test from 'node:test';
test('frozen isolation proof', () => {
    assert.equal(process.getuid(), 65534);
    assert.equal(process.env.REPOGRAPH_ACCESS_TOKEN, undefined);
    assert.deepEqual(Object.keys(networkInterfaces()), ['lo']);
    assert.throws(() => writeFileSync('/source/forbidden.txt', 'no'));
    assert.throws(() => writeFileSync('/tmp/forbidden.txt', 'no'));
    writeFileSync('/work/temporary.txt', 'scratch');
    assert.equal(readFileSync('/work/temporary.txt', 'utf8'), 'scratch');
});\n`);
    await writeFile(join(directory, 'slow.test.mjs'), "import test from 'node:test';\ntest('controlled wait', async () => { await new Promise(resolve => setTimeout(resolve, 6500)); });\n");
    const shipmentPath = 'shipment summary.mjs';
    const shipment = join(directory, shipmentPath);
    const publishedShipment = 'export const shipped = 3;\n';
    await writeFile(shipment, 'export const shipped = 2;\n');
    await writeFile(join(directory, 'shipment.test.mjs'), `import assert from 'node:assert/strict';
import test from 'node:test';
import { shipped } from './shipment summary.mjs';
test('candidate shipment result', () => assert.equal(shipped, 4));\n`);
    let child, base;
    async function start(runtime) {
        child = spawn(process.execPath, ['dist/server.js'], { env: {
            ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined,
            REPOGRAPH_PORT: '0', REPOGRAPH_PROJECTS_ROOT: root, REPOGRAPH_DB_PATH: database,
            REPOGRAPH_ASSETS_ROOT: join(root, 'assets'), REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_VERIFIER_IMAGE: runtime,
            REPOGRAPH_SNAPSHOT_RETENTION_SECONDS: '0'
        }, stdio: ['ignore', 'ignore', 'pipe'] });
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
    async function stop(signal = 'SIGTERM') {
        if (child?.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill(signal);
            await exited;
        }
    }
    t.after(async () => {
        await stop();
        await Promise.all([rm(root, { recursive: true, force: true }), rm(spool, { recursive: true, force: true })]);
    });
    async function api(path, method = 'GET', body, key) {
        const response = await fetch(base + '/api/v1' + path, { method, headers: {
            Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(key ? { 'Idempotency-Key': key } : {})
        }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json(), headers: response.headers };
    }
    async function poll(read, ready, limit = 500) {
        let observed;
        for (let attempt = 0; attempt < limit; attempt++) {
            observed = await read();
            if (ready(observed)) return observed;
            await delay(25);
        }
        assert.fail('Unexpected terminal state ' + JSON.stringify(observed));
    }
    const inspect = id => api('/verifications/' + id).then(result => result.body);
    const finished = id => poll(() => inspect(id), entry => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(entry.run?.status));
    const activeContainer = async (id, attempt = 1) => (await docker('docker', ['container', 'ls', '--quiet',
        '--filter', 'name=^/repograph-worker-' + id + '-' + attempt + '$'], { timeout: 2000 })).stdout.trim();
    await start(image);
    assert.equal((await api('/verifications/capability')).body.available, true);
    assert.equal((await api('/capabilities')).body.features.isolatedVerification, true);
    const query = new URLSearchParams({ projectRoot: directory });
    assert.equal((await api('/index/project?' + query, 'POST')).status, 202);
    await poll(() => api('/index/project/status?' + query), state => state.body.status === 'done');
    const projectId = (await api('/projects')).body[0].projectId;
    const wiki = await api('/summaries/generate?projectId=' + projectId, 'POST');
    await poll(() => api('/agent-runs/' + wiki.body.agentRunId), state => state.body.status === 'COMPLETED');
    const snapshotId = (await api('/knowledge-snapshots?projectId=' + projectId)).body[0].id;
    await writeFile(source, 'throw new Error("Mutable checkout must not be executed");\n');
    assert.equal((await api('/index/file?' + new URLSearchParams({ projectRoot: directory, file: source }), 'POST')).status, 200);
    const request = (files, timeoutMs) => ({ projectId, snapshotId, recipe: 'node-test-v1', files, timeoutMs });
    const submit = (key, requestBody) => api('/verifications', 'POST', requestBody, key);
    const normal = request(['isolation.test.mjs'], 5000);
    const [admitted, replay] = await Promise.all([submit('normal', normal), submit('normal', normal)]);
    assert.equal(admitted.status, 202, JSON.stringify(admitted.body));
    const reportId = admitted.body.agentRunId;
    assert.equal(admitted.headers.get('Location'), '/api/v1/verifications/' + reportId);
    assert.equal(replay.body.agentRunId, reportId);
    const completed = await finished(reportId);
    assert.equal(completed.result.status, 'PASSED', JSON.stringify(completed));
    assert.match(completed.result.output, /frozen isolation proof/);
    assert.doesNotMatch(JSON.stringify(completed.result), /Mutable checkout|repograph-verifier-fixture/);
    const attemptsRoute = id => '/agent-runs/' + id + '/execution/attempts';
    assert.equal((await api(attemptsRoute(reportId))).body[0].resultHash, completed.result.digest);
    assert.equal((await submit('normal', request(['slow.test.mjs'], 5000))).body.error, 'JOB_REQUEST_CONFLICT');
    assert.equal((await submit('missing', request(['nonexistent.test.mjs'], 5000))).body.error, 'VERIFIER_TEST_SOURCE_NOT_FOUND');

    const timed = (await submit('short', request(['slow.test.mjs'], 350))).body.agentRunId;
    assert.equal((await finished(timed)).result.status, 'TIMED_OUT');
    assert.equal(await activeContainer(timed), '');
    const cancelled = (await submit('stop', request(['slow.test.mjs'], 12000))).body.agentRunId;
    await poll(() => activeContainer(cancelled), Boolean);
    assert.equal((await api('/agent-runs/' + cancelled + '/cancel', 'POST')).status, 200);
    assert.equal((await finished(cancelled)).run.status, 'CANCELLED');
    assert.equal(await activeContainer(cancelled), '');

    const interrupted = (await submit('recover', request(['slow.test.mjs'], 12000))).body.agentRunId;
    await poll(() => activeContainer(interrupted), Boolean);
    await stop('SIGKILL');
    await start(image);
    const recovered = await finished(interrupted);
    assert.equal(recovered.result.status, 'PASSED', JSON.stringify(recovered));
    assert.deepEqual((await api(attemptsRoute(interrupted))).body.map(attempt => attempt.outcome), ['LEASE_EXPIRED', 'FINISHED']);
    assert.equal(await activeContainer(interrupted, 1), '');
    assert.equal(await activeContainer(interrupted, 2), '');
    assert.deepEqual(await readdir(spool), []);

    await writeFile(shipment, publishedShipment);
    assert.equal((await api('/index/file?' + new URLSearchParams({ projectRoot: directory, file: shipment }), 'POST')).status, 200);
    const secondWiki = await api('/summaries/generate?projectId=' + projectId, 'POST', undefined, 'patch-target');
    await poll(() => api('/agent-runs/' + secondWiki.body.agentRunId), state => state.body.status === 'COMPLETED');
    const targetSnapshotId = (await api('/knowledge-snapshots?projectId=' + projectId)).body[0].id;
    assert.notEqual(targetSnapshotId, snapshotId);
    const reviewed = await api('/change-reviews/compare', 'POST', { projectId, baseSnapshotId: snapshotId, targetSnapshotId }, 'patch-review');
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    const patchRoute = '/change-reviews/' + reviewed.body.id + '/patches?projectId=' + projectId;
    const baseDigest = createHash('sha256').update(publishedShipment).digest('hex');
    const proposal = { files: [{ path: shipmentPath, baseDigest, content: 'export const shipped = 4;\n' }] };
    assert.equal((await api(patchRoute, 'POST', {
        files: [{ ...proposal.files[0], path: 'slow.test.mjs' }]
    }, 'outside')).body.error, 'PATCH_PATH_OUTSIDE_REVIEW');
    const proposed = await api(patchRoute, 'POST', proposal, 'patch');
    assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
    assert.equal(proposed.body.status, 'DRAFT');
    assert.equal((await api(patchRoute, 'POST', proposal, 'patch')).body.id, proposed.body.id);
    assert.equal((await api(patchRoute, 'POST', {
        files: [{ ...proposal.files[0], content: 'export const shipped = 5;\n' }]
    }, 'patch')).body.error, 'PATCH_REQUEST_CONFLICT');
    const candidate = '/change-patches/' + proposed.body.id;
    const artifact = await fetch(base + '/api/v1' + candidate + '/artifact', { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(artifact.status, 200);
    const patchFile = join(root, 'candidate.patch');
    const patchBytes = Buffer.from(await artifact.arrayBuffer());
    assert.equal(createHash('sha256').update(patchBytes).digest('hex'), proposed.body.digest);
    await writeFile(patchFile, patchBytes);
    await docker('git', ['apply', '--check', patchFile], { cwd: directory, timeout: 4000 });
    const testTarget = { projectId, snapshotId: targetSnapshotId, recipe: 'node-test-v1', files: ['shipment.test.mjs'], timeoutMs: 5000 };
    const unpatched = (await submit('verify-target', testTarget)).body.agentRunId;
    assert.equal((await finished(unpatched)).result.status, 'FAILED');
    const patchRun = await submit('verify-patch', { ...testTarget, patchId: proposed.body.id });
    assert.equal(patchRun.status, 202, JSON.stringify(patchRun.body));
    const checked = await finished(patchRun.body.agentRunId);
    assert.equal(checked.result.status, 'PASSED', JSON.stringify(checked));
    assert.equal(checked.result.patchId, proposed.body.id);
    assert.match(checked.result.output, /candidate shipment result/);
    const accept = verificationRunId => ({ action: 'ACCEPT', revision: 0, verificationRunId });
    assert.equal((await api(candidate + '/decision', 'POST', accept(unpatched), 'mismatch')).body.error, 'PATCH_VERIFICATION_MISMATCH');
    const accepted = await api(candidate + '/decision', 'POST', accept(patchRun.body.agentRunId), 'accept-patch');
    assert.equal(accepted.body.status, 'ACCEPTED', JSON.stringify(accepted.body));
    assert.deepEqual((await api(candidate + '/decision', 'POST', accept(patchRun.body.agentRunId), 'accept-patch')).body, accepted.body);
    assert.equal(await readFile(shipment, 'utf8'), publishedShipment);
    const other = await api(patchRoute, 'POST', proposal, 'second-proposal');
    await writeFile(shipment, 'export const shipped = 6;\n');
    const otherRoute = '/change-patches/' + other.body.id;
    assert.equal((await api(otherRoute + '/decision', 'POST', { action: 'ACCEPT', revision: 0 }, 'drifted')).body.error, 'PATCH_TARGET_CHANGED');
    assert.equal((await api(otherRoute)).body.status, 'DRAFT');
    assert.equal((await api(otherRoute + '/decision', 'POST', { action: 'DISCARD', revision: 0 }, 'discard')).body.status, 'DISCARDED');
    assert.equal((await submit('discarded', { ...testTarget, patchId: other.body.id })).body.error, 'PATCH_SCOPE_CHANGED');
    const protectedRun = (await submit('freeze-for-pause', { ...testTarget, files: ['slow.test.mjs'], timeoutMs: 12000 })).body.agentRunId;
    await poll(() => activeContainer(protectedRun), Boolean);
    const controlPath = '/agent-runs/' + protectedRun + '/execution';
    const beforePause = (await api(controlPath)).body.revision;
    assert.equal((await api(controlPath, 'POST', { action: 'pause', revision: beforePause })).status, 200);
    const paused = await poll(() => inspect(protectedRun), state => state.execution?.state === 'PAUSED');
    assert.equal(await activeContainer(protectedRun), '');
    assert.equal(paused.run.status, 'PAUSED');
    const lifecycle = '/knowledge-snapshots/' + targetSnapshotId + '/lifecycle?projectId=' + projectId;
    assert.equal((await api(lifecycle, 'POST', { action: 'retire', revision: 0 }, 'pause-source-retire')).status, 200);
    assert.equal((await api(lifecycle, 'POST', { action: 'purge', revision: 1 }, 'pause-source-purge')).body.error, 'SNAPSHOT_REFERENCED');
    assert.equal((await api(lifecycle, 'POST', { action: 'restore', revision: 1 }, 'pause-source-restore')).status, 200);
    assert.equal((await api(controlPath, 'POST', { action: 'cancel', revision: paused.execution.revision })).body.state, 'CANCELLED');
    await stop();
    await start(undefined);
    assert.equal((await api('/verifications/capability')).body.available, false);
    assert.deepEqual((await inspect(interrupted)).result, recovered.result);
    assert.deepEqual((await api(candidate)).body, accepted.body);
    assert.equal((await submit('new-disabled', normal)).body.error, 'VERIFIER_UNAVAILABLE');
});
