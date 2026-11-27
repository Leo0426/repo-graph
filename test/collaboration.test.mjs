import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

test('collaboration deliveries use the active mapped subject and retain one Wiki receipt across restart', { timeout: 15_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'repograph-collaboration-'));
    const database = join(root, 'index.db');
    const token = randomBytes(24).toString('hex');
    let child, base;
    async function start() {
        child = spawn(process.execPath, ['dist/server.js'], { env: {
            ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined,
            REPOGRAPH_PORT: '0', REPOGRAPH_PROJECTS_ROOT: root, REPOGRAPH_DB_PATH: database,
            REPOGRAPH_ASSETS_ROOT: join(root, 'assets'), REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_COLLABORATION: '1'
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
    async function stop() {
        if (child?.exitCode === null && child.signalCode === null) {
            const stopped = once(child, 'exit');
            child.kill('SIGTERM');
            await stopped;
        }
    }
    t.after(async () => { await stop(); await rm(root, { recursive: true, force: true }); });
    async function api(path, method = 'GET', body, secret = token, extra = {}) {
        const response = await fetch(base + '/api/v1' + path, { method, headers: {
            ...(secret ? { Authorization: 'Bearer ' + secret } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra
        }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json(), headers: response.headers };
    }
    await start();
    assert.equal((await api('/capabilities')).body.features.collaborationIngress, true);
    const csrf = await api('/auth/csrf', 'GET', undefined, null);
    const Cookie = csrf.headers.getSetCookie()[0].split(';')[0];
    const password = randomBytes(24).toString('hex');
    const preflight = { Cookie, Origin: base, 'X-CSRF-Token': csrf.body.token };
    const account = await api('/auth/register', 'POST', { username: 'warehouse-operator', displayName: 'Warehouse operator',
        email: 'warehouse@example.test', password }, null, preflight);
    assert.equal(account.status, 201, JSON.stringify(account.body));
    const accountId = account.body.id;
    assert.equal((await api('/admin/accounts/' + accountId + '/review', 'POST', { status: 'ACTIVE', reason: 'Fixture' })).status, 200);
    const source = join(root, 'inventory.ts');
    await writeFile(source, 'export const cartons = 12;\n');
    const index = await api('/index/file?' + new URLSearchParams({ projectRoot: root, file: source }), 'POST');
    assert.equal(index.status, 200);
    const projectId = (await api('/projects')).body[0].projectId;
    assert.equal((await api('/admin/projects/' + projectId + '/owner', 'PUT', { ownerType: 'PERSONAL', ownerId: 'builtin-admin' })).status, 200);
    const access = '/projects/' + projectId + '/access';
    const revision = (await api(access)).body.revision;
    assert.equal((await api(access, 'PUT', { accountId, role: 'EDITOR', revision })).status, 200);
    const dashboard = '/admin/collaboration/connections';
    const mapped = await api(dashboard, 'POST', { name: 'Warehouse inbox', externalActor: 'operator-1', accountId,
        projects: [projectId], askSessions: [] });
    assert.equal(mapped.status, 201, JSON.stringify(mapped.body));
    const { id, credential } = mapped.body;
    assert.ok(!JSON.stringify((await api(dashboard)).body).includes(credential));
    const events = '/collaboration/connections/' + id + '/events';
    const event = { eventId: 'event-1', externalActor: 'operator-1', action: { type: 'wiki.generate', projectId } };
    assert.equal((await api(events, 'POST', event)).status, 401);
    assert.equal((await api('/projects', 'GET', undefined, credential)).status, 401);
    assert.equal((await api(events, 'POST', { ...event, externalActor: 'someone-else' }, credential)).status, 403);
    const [first, replay] = await Promise.all([api(events, 'POST', event, credential), api(events, 'POST', event, credential)]);
    assert.equal(first.status, 202, JSON.stringify(first.body));
    assert.equal(replay.body.runId, first.body.runId);
    assert.equal((await api(events, 'POST', { ...event, action: { ...event.action, mode: 'full' } }, credential)).status, 409);
    const eventPath = events + '/' + event.eventId;
    let receipt;
    for (let turn = 0; turn < 100; turn++) {
        receipt = await api(eventPath, 'GET', undefined, credential);
        if (receipt.body.jobStatus === 'COMPLETED') break;
        await delay(15);
    }
    assert.equal(receipt.body.jobStatus, 'COMPLETED', JSON.stringify(receipt.body));
    assert.equal(receipt.body.runId, first.body.runId);

    const login = await api('/auth/login', 'POST', { username: 'warehouse-operator', password }, null, preflight);
    assert.equal(login.status, 200);
    const userCookie = login.headers.getSetCookie().find(cookie => cookie.startsWith('repograph_session=')).split(';')[0];
    const userCsrf = (await api('/auth/csrf', 'GET', undefined, null, { Cookie: userCookie })).body.token;
    const session = await api('/ask/sessions', 'POST', { scopes: [{ projectId }] }, null,
        { Cookie: userCookie, Origin: base, 'X-CSRF-Token': userCsrf });
    assert.equal(session.status, 201, JSON.stringify(session.body));
    const userAsk = { eventId: 'message-1', externalActor: 'operator-1', action: {
        type: 'ask.turn', sessionId: session.body.id, turn: { question: 'Where are cartons defined?' }
    } };
    assert.equal((await api(events, 'POST', userAsk, credential)).body.error, 'COLLABORATION_SCOPE_DENIED');
    const second = await api(dashboard, 'POST', { name: 'Warehouse questions', externalActor: 'operator-1', accountId, askSessions: [session.body.id] });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    const askEvents = '/collaboration/connections/' + second.body.id + '/events';
    const answered = await api(askEvents, 'POST', userAsk, second.body.credential);
    assert.equal(answered.status, 202, JSON.stringify(answered.body));
    assert.equal((await api(askEvents, 'POST', userAsk, second.body.credential)).body.runId, answered.body.runId);
    const privateReceipt = await api(askEvents + '/message-1', 'GET', undefined, second.body.credential);
    assert.equal(privateReceipt.status, 200);
    assert.equal(privateReceipt.body.runId, answered.body.runId);
    assert.ok(!JSON.stringify(privateReceipt.body).includes('Where are cartons'));

    const scheduled = await api('/summaries/generate?' + new URLSearchParams({ projectId,
        notBefore: new Date(Date.now() + 600_000).toISOString() }), 'POST', undefined, token, { 'Idempotency-Key': 'scheduled' });
    assert.equal(scheduled.status, 202, JSON.stringify(scheduled.body));
    const busy = { ...event, eventId: 'busy' };
    for (const attempt of [1, 2, 3, 3]) {
        const failure = await api(events, 'POST', busy, credential);
        assert.equal(failure.status, 409);
        assert.equal(failure.body.attempts, attempt);
        assert.equal(failure.body.delivery, attempt < 3 ? 'RETRYABLE' : 'REJECTED');
    }
    assert.equal((await api('/agent-runs/' + scheduled.body.agentRunId + '/cancel', 'POST')).status, 200);
    assert.equal((await api(events, 'POST', busy, credential)).body.delivery, 'REJECTED');

    await stop();
    // Reproduce the boundary after a domain task was accepted but before its delivery receipt was acknowledged.
    const state = new DatabaseSync(database);
    state.prepare("UPDATE collaboration_event SET delivery = 'PROCESSING', run_id = NULL, lease_until = 0 WHERE event_id = ? AND connection_id = ?")
        .run(event.eventId, id);
    state.close();
    await start();
    const recovered = await api(events, 'POST', event, credential);
    assert.equal(recovered.body.runId, first.body.runId);
    assert.equal(recovered.body.attempts, 2);
    assert.deepEqual((await api(eventPath, 'GET', undefined, credential)).body, { ...receipt.body, attempts: 2 });
    const oldAccess = await api(access);
    assert.equal((await api(access, 'PUT', { accountId, role: null, revision: oldAccess.body.revision })).status, 200);
    assert.equal((await api(eventPath, 'GET', undefined, credential)).status, 403);
    assert.equal((await api(dashboard + '/' + id + '/revoke', 'POST')).status, 200);
    assert.equal((await api(events, 'POST', event, credential)).status, 401);
});
