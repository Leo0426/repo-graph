import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { create as createTar } from 'tar';

test('hosted Wiki admission, physical sends and confirmed purge preserve one accountable ledger', { timeout: 10_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'repograph-hosted-'));
    const token = randomBytes(24).toString('hex');
    const now = Date.now();
    let child, base;
    async function stop() {
        if (child?.exitCode === null && child.signalCode === null) {
            const stopped = once(child, 'exit');
            child.kill('SIGTERM');
            await stopped;
        }
    }
    t.after(async () => { await stop(); await rm(root, { recursive: true, force: true }); });
    async function start(licenseUntil) {
        child = spawn(process.execPath, ['dist/server.js'], { env: {
            ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined,
            REPOGRAPH_PORT: '0', REPOGRAPH_PROJECTS_ROOT: root, REPOGRAPH_DB_PATH: join(root, 'index.db'),
            REPOGRAPH_ASSETS_ROOT: join(root, 'assets'), REPOGRAPH_EMBEDDING_MODEL: undefined,
            REPOGRAPH_PROJECT_RETENTION_SECONDS: '0', REPOGRAPH_HOSTED_ENTITLEMENTS: '1',
            REPOGRAPH_HOSTED_LICENSE_UNTIL: new Date(licenseUntil).toISOString()
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
    await start(now + 3_600_000);
    async function api(path, method = 'GET', body, key) {
        const response = await fetch(base + '/api/v1' + path, { method, headers: {
            Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(key ? { 'Idempotency-Key': key } : {})
        }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
    }
    const org = (await api('/admin/organizations', 'POST', { name: 'Warehouse operations' })).body.id;
    const projects = [];
    for (const name of ['catalog', 'shipping', 'receiving']) {
        const directory = join(root, name);
        await mkdir(directory);
        const source = join(directory, 'warehouse.ts');
        await writeFile(source, 'export const cartons = 12;\n');
        assert.equal((await api('/index/file?' + new URLSearchParams({ projectRoot: directory, file: source }), 'POST')).status, 200);
        const project = (await api('/projects')).body.find(entry => entry.projectRoot.endsWith('/' + name)).projectId;
        assert.equal((await api('/admin/projects/' + project + '/owner', 'PUT', { ownerType: 'ORGANIZATION', ownerId: org })).status, 200);
        projects.push(project);
    }
    const policyPath = '/admin/entitlements/' + org;
    const submit = (project, key, mode = 'incremental') => api('/summaries/generate?projectId=' + project + '&mode=' + mode, 'POST', undefined, key);
    async function finished(id) {
        for (let poll = 0; poll < 100; poll++) {
            const result = await api('/agent-runs/' + id);
            assert.equal(result.status, 200);
            if (!['RUNNING', 'QUEUED', 'PAUSED'].includes(result.body.status)) return result.body;
            await delay(25);
        }
        assert.fail('Wiki run did not finish');
    }
    assert.equal((await submit(projects[0], 'before-policy')).body.error, 'HOSTED_ENTITLEMENT_UNKNOWN');
    const snapshot = { version: 1, issuedAt: now, validUntil: now + 600_000, tasksEnabled: true, modelsEnabled: true,
        modelBalance: 'AVAILABLE', allowPurgedTaskVoid: false, trials: [
            { id: 'later', startsAt: now - 1000, endsAt: now + 120_000, tasks: 1, modelCalls: 1 },
            { id: 'earliest', startsAt: now - 1000, endsAt: now + 60_000, tasks: 1, modelCalls: 1 }
        ] };
    assert.equal((await api(policyPath, 'PUT', snapshot)).status, 200);
    const [a, replay] = await Promise.all([submit(projects[0], 'first'), submit(projects[0], 'first')]);
    assert.equal(a.status, 202, JSON.stringify(a.body));
    assert.equal(replay.body.agentRunId, a.body.agentRunId);
    const b = await submit(projects[1], 'second');
    assert.equal(b.status, 202);
    const ledger = await api(policyPath);
    assert.deepEqual(ledger.body.records.map(({ taskId, batchId }) => [taskId, batchId]),
        [[b.body.agentRunId, 'later'], [a.body.agentRunId, 'earliest']]);
    const exhausted = await submit(projects[2], 'third');
    assert.equal(exhausted.status, 429, JSON.stringify(exhausted.body));
    assert.equal(exhausted.body.error, 'HOSTED_TASK_TRIAL_EXHAUSTED');
    await Promise.all([finished(a.body.agentRunId), finished(b.body.agentRunId)]);

    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    let calls = 0;
    const upstream = createServer(async (req, response) => {
        for await (const _ of req) { /* Drain the bounded fixture request. */ }
        calls++;
        started.resolve();
        await release.promise;
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ done_reason: 'stop',
            prompt_eval_count: 21, eval_count: 7, message: { content: JSON.stringify({ body: 'Warehouse evidence', citations: [] }) } }));
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    t.after(() => { release.resolve(); upstream.closeAllConnections(); return new Promise(resolve => upstream.close(resolve)); });
    assert.equal((await api('/admin/model-providers/legacy-ollama', 'PUT', { name: 'Hosted fixture', protocol: 'OLLAMA',
        baseUrl: 'http://127.0.0.1:' + upstream.address().port, enabled: true, model: 'fixture', timeoutMillis: 3000, maxOutputTokens: 1400 })).status, 200);
    const refreshed = { ...snapshot, version: 2, allowPurgedTaskVoid: true,
        trials: snapshot.trials.map(batch => ({ ...batch, tasks: 6, modelCalls: batch.id === 'earliest' ? 1 : 0 })) };
    assert.equal((await api(policyPath, 'PUT', refreshed)).status, 200);
    assert.equal((await api(policyPath, 'PUT', { ...refreshed, trials: [...refreshed.trials].reverse() })).status, 200);
    assert.equal((await api(policyPath, 'PUT', { ...refreshed, modelsEnabled: false })).body.error, 'HOSTED_SNAPSHOT_VERSION_CONFLICT');
    const modelRun = await submit(projects[2], 'policy-switch', 'full');
    assert.equal(modelRun.status, 202, JSON.stringify(modelRun.body));
    await Promise.race([started.promise, delay(2500, undefined, { ref: false }).then(() => assert.fail('No upstream send'))]);
    assert.equal((await api(policyPath, 'PUT', { ...refreshed, version: 3, modelsEnabled: false })).status, 200);
    release.resolve();
    const switched = await finished(modelRun.body.agentRunId);
    assert.ok(switched.steps.some(step => step.error === 'HOSTED_MODELS_DISABLED'));
    assert.equal(calls, 1);
    const usage = (await api('/admin/model-usage?organizationId=' + org)).body.records;
    assert.equal(usage.length, 1);
    assert.deepEqual([usage[0].status, usage[0].inputTokens, usage[0].outputTokens, usage[0].costUsd], ['COMPLETED', 21, 7, null]);
    const report = (await api(policyPath)).body;
    assert.deepEqual(report.records.filter(record => record.kind === 'MODEL').map(record => [record.taskId, record.batchId]),
        [[modelRun.body.agentRunId, 'earliest']]);
    const heldVoid = await api(policyPath + '/tasks/' + a.body.agentRunId + '/void', 'POST');
    assert.equal(heldVoid.body.error, 'HOSTED_TASK_PURGE_UNCONFIRMED');

    for (const [version, balance, expected] of [[4, 'UNKNOWN', 'HOSTED_MODEL_BALANCE_UNKNOWN'],
        [5, 'INSUFFICIENT', 'HOSTED_MODEL_BALANCE_INSUFFICIENT'], [6, 'AVAILABLE', 'HOSTED_MODEL_TRIAL_EXHAUSTED']]) {
        assert.equal((await api(policyPath, 'PUT', { ...refreshed, version, modelBalance: balance })).status, 200);
        const denied = await submit(projects[2], 'balance-' + version, 'full');
        assert.equal(denied.status, 202, JSON.stringify(denied.body));
        assert.ok((await finished(denied.body.agentRunId)).steps.some(step => step.error === expected));
    }
    assert.equal(calls, 1);
    assert.equal((await api('/admin/model-usage?organizationId=' + org)).body.records.length, 1);

    const history = await api(policyPath);
    const cap = history.body.records.filter(record => record.kind === 'TASK' && record.batchId === 'earliest').length;
    assert.equal(cap, 5);
    const archive = await createTar({ cwd: root, gzip: true }, ['receiving']).concat();
    const form = new FormData();
    form.append('file', new Blob([archive]), 'receiving-fixture.tar.gz');
    const incoming = await fetch(base + '/api/v1/assets/import', { method: 'POST', body: form, headers: { Authorization: 'Bearer ' + token } });
    assert.equal(incoming.status, 202);
    const { assetId } = await incoming.json();
    let managed;
    for (let i = 0; i < 100; i++) {
        managed = (await api('/assets/' + assetId)).body;
        if (managed.status !== 'INDEXING') break;
        await delay(25);
    }
    assert.equal(managed.status, 'READY');
    const managedProject = managed.projectId;
    assert.equal((await api('/admin/projects/' + managedProject + '/owner', 'PUT', { ownerType: 'ORGANIZATION', ownerId: org })).status, 200);
    const archiveRun = await submit(managedProject, 'archive');
    assert.equal(archiveRun.status, 202);
    await finished(archiveRun.body.agentRunId);
    const archiveVoid = policyPath + '/tasks/' + archiveRun.body.agentRunId + '/void';
    const lifecycle = '/projects/' + managedProject + '/lifecycle';
    const discarded = await api(lifecycle, 'POST', { action: 'trash', revision: 0 }, 'trash');
    assert.equal(discarded.body.state, 'TRASHED');
    assert.equal((await api(archiveVoid, 'POST')).body.error, 'HOSTED_TASK_PURGE_UNCONFIRMED');
    const purge = await api(lifecycle, 'POST', { action: 'purge', revision: discarded.body.revision }, 'purge');
    assert.equal(purge.body.state, 'PURGING', JSON.stringify(purge.body));
    let removed;
    for (let i = 0; i < 100; i++) {
        removed = (await api(lifecycle)).body;
        if (removed.state === 'PURGED') break;
        await delay(25);
    }
    assert.equal(removed.state, 'PURGED');
    const voided = await api(archiveVoid, 'POST');
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
    assert.ok(voided.body.voidedAt > 0);
    assert.deepEqual((await api(archiveVoid, 'POST')).body, voided.body);
    assert.equal((await api(policyPath)).body.records.find(record => record.taskId === archiveRun.body.agentRunId).voidedAt, voided.body.voidedAt);

    const expiry = { ...refreshed, version: 7, validUntil: now + 1 };
    assert.equal((await api(policyPath, 'PUT', expiry)).status, 200);
    assert.equal((await api(policyPath)).body.status, 'HOSTED_ENTITLEMENT_UNKNOWN');
    assert.equal((await submit(projects[2], 'expired-policy')).body.error, 'HOSTED_ENTITLEMENT_UNKNOWN');
    assert.equal((await submit(projects[0], 'first')).body.agentRunId, a.body.agentRunId);
    assert.equal((await api(policyPath, 'PUT', { ...refreshed, version: 8 })).status, 200);
    assert.equal((await api('/admin/organizations/' + org, 'PUT', { name: 'Warehouse operations', active: false })).status, 200);
    assert.equal((await submit(projects[2], 'disabled-org')).body.error, 'HOSTED_ORGANIZATION_DISABLED');
    assert.equal((await api('/agent-runs/' + a.body.agentRunId)).status, 200);
    assert.equal((await api('/admin/organizations/' + org, 'PUT', { name: 'Warehouse operations', active: true })).status, 200);
    const metered = { ...refreshed, version: 9, trials: [], metered: { id: 'fixture-metered', startsAt: now - 1000,
        endsAt: now + 60_000, tasks: 1, modelCalls: 1 } };
    assert.equal((await api(policyPath, 'PUT', metered)).status, 200);
    const paid = await submit(projects[0], 'metered-work', 'full');
    assert.equal(paid.status, 202, JSON.stringify(paid.body));
    const paidRun = await finished(paid.body.agentRunId);
    assert.ok(paidRun.steps.some(step => step.error === 'HOSTED_MODEL_QUOTA_EXHAUSTED'));
    assert.equal((await submit(projects[1], 'metered-limit')).body.error, 'HOSTED_TASK_QUOTA_EXHAUSTED');
    const paidLedger = (await api(policyPath)).body.records.filter(record => record.taskId === paid.body.agentRunId);
    assert.deepEqual(paidLedger.map(record => [record.kind, record.batchId, record.billingMode]), [
        ['MODEL', 'fixture-metered', 'METERED'], ['TASK', 'fixture-metered', 'METERED']
    ]);
    const evidencePath = policyPath + '/model-invocations/' + usage[0].id + '/evidence';
    const proof = { reference: 'fixture-usage-receipt', inputTokens: 21, costUsd: 0.0123 };
    const reconciled = await api(evidencePath, 'POST', proof);
    assert.equal(reconciled.status, 200, JSON.stringify(reconciled.body));
    assert.deepEqual((await api(evidencePath, 'POST', proof)).body, reconciled.body);
    assert.equal((await api(evidencePath, 'POST', { ...proof, costUsd: 0.022 })).body.error, 'HOSTED_USAGE_EVIDENCE_CONFLICT');
    assert.equal((await api(evidencePath, 'POST', { reference: 'other-receipt', inputTokens: 22 })).body.error, 'HOSTED_USAGE_EVIDENCE_CONFLICT');
    const finalUsage = (await api('/admin/model-usage?organizationId=' + org)).body.records;
    assert.deepEqual(finalUsage.filter(record => record.id === usage[0].id).map(record => [record.inputTokens, record.outputTokens,
        record.costUsd, record.reconciledAt]), [[21, 7, 0.0123, reconciled.body.recordedAt]]);
    await stop();
    await start(now - 1);
    const afterRestart = await api(policyPath);
    assert.equal(afterRestart.body.status, 'HOSTED_LICENSE_EXPIRED');
    assert.equal(afterRestart.body.snapshot.version, 9);
    assert.equal(afterRestart.body.records.find(record => record.taskId === archiveRun.body.agentRunId).voidedAt, voided.body.voidedAt);
    assert.deepEqual((await api('/admin/model-usage?organizationId=' + org)).body.records, finalUsage);
    assert.equal((await submit(projects[2], 'expired-license')).body.error, 'HOSTED_LICENSE_EXPIRED');
    assert.equal((await api('/agent-runs/' + a.body.agentRunId)).status, 200);
});
