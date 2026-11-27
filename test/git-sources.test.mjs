import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { calendarScheduleInput, nextCalendarOccurrence } from '../dist/calendar-schedule.js';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);

async function localGit(root, ...args) {
    const { stdout } = await execute('git', ['-C', root, ...args]);
    return stdout.trim();
}

async function forge(directory, credential, metadata) {
    const headers = [];
    let rejectFetch = false;
    let heldFetch;
    const remote = createServer(async (incoming, response) => {
        const url = new URL(incoming.url, 'http://fixture');
        if (metadata && url.pathname.startsWith('/api/')) {
            await metadata(url.pathname, incoming, response);
            return;
        }
        headers.push(incoming.headers.authorization);
        if (incoming.headers.authorization !== credential) {
            response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fixture"' }).end();
            return;
        }
        const body = [];
        for await (const chunk of incoming) body.push(chunk);
        const payload = Buffer.concat(body);
        const fetching = /command=fetch|\bwant [a-f0-9]/.test(payload.toString());
        if (heldFetch && fetching) {
            const hold = heldFetch;
            heldFetch = undefined;
            hold.entered.resolve();
            await hold.release.promise;
        }
        if (rejectFetch && fetching) {
            rejectFetch = false;
            response.writeHead(503).end();
            return;
        }
        const child = spawn('git', ['http-backend'], {
            env: { ...process.env, GIT_PROJECT_ROOT: directory, GIT_HTTP_EXPORT_ALL: '1',
                PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1), REQUEST_METHOD: incoming.method,
                CONTENT_TYPE: incoming.headers['content-type'] ?? '', CONTENT_LENGTH: String(payload.length),
                HTTP_GIT_PROTOCOL: incoming.headers['git-protocol'] ?? '' },
            stdio: ['pipe', 'pipe', 'ignore']
        });
        child.stdin.end(payload);
        const chunks = [];
        for await (const chunk of child.stdout) chunks.push(chunk);
        const output = Buffer.concat(chunks);
        const separator = output.indexOf('\r\n\r\n');
        if (separator < 0) { response.writeHead(502).end(); return; }
        let status = 200;
        for (const field of output.subarray(0, separator).toString().split('\r\n')) {
            const index = field.indexOf(':');
            const name = field.slice(0, index);
            const value = field.slice(index + 1).trim();
            if (name.toLowerCase() === 'status') status = Number(value.split(' ', 1)[0]);
            else response.setHeader(name, value);
        }
        response.writeHead(status).end(output.subarray(separator + 4));
    }).listen(0, '127.0.0.1');
    await once(remote, 'listening');
    return { origin: 'http://127.0.0.1:' + remote.address().port, headers,
        rejectNextFetch: () => { rejectFetch = true; },
        holdNextFetch() {
            const hold = { entered: Promise.withResolvers(), release: Promise.withResolvers() };
            heldFetch = hold;
            return { entered: hold.entered.promise, release: hold.release.resolve };
        },
        close: () => new Promise(resolve => remote.close(resolve)) };
}

test('hosted Git reconnects only the verified repository in the same instance and preserves its history', { timeout: 35_000 }, async t => {
    const temp = await realpath(await mkdtemp(join(tmpdir(), 'repograph-hosted-git-')));
    t.after(() => rm(temp, { recursive: true, force: true }));
    const [work, storage, remoteRoot] = ['work', 'app', 'remote'].map(name => join(temp, name));
    await Promise.all([mkdir(work), mkdir(storage), mkdir(join(remoteRoot, 'team'), { recursive: true })]);
    const original = '/team/original.git';
    const moved = '/team/moved.git';
    await localGit(remoteRoot, 'init', '--bare', 'team/original.git');
    await localGit(work, 'init', '-b', 'main');
    async function push(target, version) {
        await writeFile(join(work, 'proof.ts'), 'export const proof = ' + version + ';\n');
        await localGit(work, 'add', 'proof.ts');
        await localGit(work, '-c', 'user.email=dev@example.test', '-c', 'user.name=Fixture', 'commit', '-m', 'Version ' + version);
        await localGit(work, 'push', remoteRoot + target, 'main');
        return localGit(work, 'rev-parse', 'HEAD');
    }
    const first = await push(original, 1);
    const token = randomBytes(24).toString('hex');
    const basic = username => 'Basic ' + Buffer.from(username + ':' + token).toString('base64');
    const githubPrefix = '/api/v3/repos';
    const gitlabPrefix = '/api/v4/projects/';
    const requests = [];
    const records = new Map([['/team/original', 42], ['/team/different', 24]]);
    let heldMetadata;
    const github = await forge(remoteRoot, basic('x-access-token'), async (path, request, response) => {
        requests.push(path);
        if (request.headers.authorization !== 'Bearer ' + token || request.headers['private-token']) {
            response.writeHead(401).end();
            return;
        }
        const relative = path.slice(githubPrefix.length);
        if (relative === '/team/redirect') {
            response.writeHead(301, { Location: gitlab.origin + gitlabPrefix + 'team%2Foriginal' }).end();
            return;
        }
        if (relative === '/team/canonical') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ id: 42, clone_url: gitlab.origin + original }));
            return;
        }
        const id = records.get(relative);
        if (!id) { response.writeHead(404).end(); return; }
        if (heldMetadata) {
            const { entered, release } = heldMetadata;
            heldMetadata = undefined;
            entered.resolve();
            await release.promise;
        }
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ id, clone_url: github.origin + relative + '.git' }));
    });
    t.after(github.close);
    const gitlabRequests = [];
    const gitlab = await forge(remoteRoot, basic('oauth2'), (path, request, response) => {
        gitlabRequests.push(path);
        if (request.headers['private-token'] !== token || request.headers.authorization) {
            response.writeHead(401).end();
            return;
        }
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ id: 42, http_url_to_repo: gitlab.origin + '/' + decodeURIComponent(path.slice(gitlabPrefix.length)) + '.git' }));
    });
    t.after(gitlab.close);
    let app = await startApp(storage, [github.origin, gitlab.origin], randomBytes(24).toString('hex'));
    t.after(() => app.stop());
    const call = (...args) => app.request(...args);
    const error = async (request, status, code) => {
        const result = await request;
        assert.equal(result.status, status, JSON.stringify(result.body));
        assert.equal(result.body.error, code);
    };
    const connections = '/git/connections';
    const created = await call(connections, 'POST', { name: 'Hosted source', url: github.origin + '/Team/Original', adapter: 'GITHUB', token });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.url, github.origin + original);
    assert.deepEqual(created.body.hostedIdentity, { adapter: 'GITHUB', instance: github.origin, upstreamId: '42' });
    assert.ok(!JSON.stringify(created.body).includes(token));
    const connectionId = created.body.id;
    const connection = connections + '/' + connectionId;
    const reconnect = connection + '/reconnect';
    const binding = await call('/git/repositories', 'POST', { connectionId, branch: 'main' });
    assert.equal(binding.status, 201);
    const { id: bindingId, projectId } = binding.body;
    const repo = '/git/repositories/' + projectId;
    async function waitRun(id, status) {
        for (let attempt = 0; attempt < 300; attempt++) {
            const state = (await call('/agent-runs/' + id)).body;
            if (['COMPLETED', 'FAILED'].includes(state.status)) {
                assert.equal(state.status, status, JSON.stringify(state));
                return state;
            }
            await delay(25);
        }
        assert.fail('Run did not reach a terminal status');
    }
    const initial = await call(repo + '/sync', 'POST', {});
    assert.equal(initial.status, 202, JSON.stringify(initial.body));
    await waitRun(initial.body.runId, 'COMPLETED');
    const published = await call('/summaries/generate?projectId=' + projectId, 'POST');
    assert.equal(published.status, 202);
    await waitRun(published.body.agentRunId, 'COMPLETED');
    const [snapshot] = (await call('/knowledge-snapshots?projectId=' + projectId)).body;
    assert.equal(snapshot.source.gitCommit, first);

    const secret = randomBytes(32).toString('hex');
    const disabled = await call(connection, 'PATCH', { revision: 0, enabled: false, eventSecret: secret });
    assert.equal(disabled.status, 200);
    const { revision } = disabled.body;
    await error(call(reconnect, 'POST', { revision, url: gitlab.origin + original }), 409, 'GIT_HOSTED_INSTANCE_CHANGED');
    await error(call(reconnect, 'POST', { revision, url: github.origin + '/team/redirect' }), 409, 'GIT_IDENTITY_REDIRECT');
    await error(call(reconnect, 'POST', { revision, url: github.origin + '/team/canonical' }), 502, 'GIT_IDENTITY_RESPONSE_INVALID');
    await error(call(reconnect, 'POST', { revision, url: github.origin + '/team/different.git' }), 409, 'GIT_REPOSITORY_IDENTITY_CHANGED');
    assert.deepEqual(gitlabRequests, []);
    assert.deepEqual((await call(connection)).body, disabled.body);

    await rename(remoteRoot + original, remoteRoot + moved);
    records.delete('/team/original');
    records.set('/team/moved', 42);
    await error(call(connections, 'POST', { name: 'Duplicate', url: github.origin + moved, adapter: 'GITHUB', token }),
        409, 'GIT_HOSTED_REPOSITORY_EXISTS');
    const hold = { entered: Promise.withResolvers(), release: Promise.withResolvers() };
    heldMetadata = hold;
    const stale = call(reconnect, 'POST', { revision, url: github.origin + moved });
    await hold.entered.promise;
    const rotated = await call(connection, 'PATCH', { revision, credential: { token } });
    hold.release.resolve();
    assert.equal(rotated.status, 200);
    await error(stale, 409, 'GIT_CONNECTION_CHANGED');
    const restored = await call(reconnect, 'POST', { revision: rotated.body.revision, url: github.origin + moved, enabled: true });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    for (const key of ['id', 'repositoryId', 'hostedIdentity']) assert.deepEqual(restored.body[key], created.body[key]);
    assert.equal(restored.body.url, github.origin + moved);
    assert.equal(restored.body.eventSecretConfigured, true);
    assert.equal((await call(repo)).body.id, bindingId);
    assert.equal((await call(repo)).body.indexedCommit, first);
    assert.equal((await call(connection + '/test', 'POST', { branch: 'main' })).body.commit, first);

    const automation = await call(repo + '/automation', 'PUT', { revision: 0, intervalMinutes: null, eventEnabled: true });
    assert.equal(automation.status, 200);
    const second = await push(moved, 2);
    async function event(path) {
        const raw = JSON.stringify({ url: github.origin + path, ref: 'refs/heads/main', commit: second, timestamp: new Date().toISOString() });
        const result = await fetch(app.base + '/api/v1/git/events/' + connectionId, { method: 'POST', body: raw, headers: {
            'Content-Type': 'application/json', 'X-Git-Event-Signature': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')
        } });
        return { status: result.status, body: await result.json() };
    }
    await error(event(original), 403, 'GIT_EVENT_REPOSITORY_MISMATCH');
    const holdFetch = github.holdNextFetch();
    const accepted = await event('/Team/Moved');
    assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
    await holdFetch.entered;
    records.set('/team/moved', 91);
    holdFetch.release();
    const failed = await waitRun(accepted.body.runId, 'FAILED');
    assert.equal(failed.statusReason, 'GIT_REPOSITORY_IDENTITY_CHANGED');
    assert.equal((await call(repo)).body.indexedCommit, first);
    await error(call(repo + '/sync', 'POST', {}), 409, 'GIT_REPOSITORY_IDENTITY_CHANGED');
    records.set('/team/moved', 42);
    const retry = await call(repo + '/sync', 'POST', { retryRunId: accepted.body.runId });
    assert.equal(retry.status, 202, JSON.stringify(retry.body));
    await waitRun(retry.body.runId, 'COMPLETED');

    const legacy = await call(connections, 'POST', { name: 'Legacy source', url: gitlab.origin + moved, username: 'oauth2', token });
    assert.equal(legacy.status, 201);
    assert.equal(legacy.body.hostedIdentity, null);
    const adopt = connections + '/' + legacy.body.id + '/reconnect';
    await error(call(adopt, 'POST', { revision: 0, url: gitlab.origin + '/different/repository.git', adapter: 'GITLAB' }),
        409, 'GIT_HOSTED_VERIFICATION_REQUIRED');
    assert.deepEqual(gitlabRequests, []);
    const adopted = await call(adopt, 'POST', { revision: 0, url: gitlab.origin + moved, adapter: 'GITLAB' });
    assert.equal(adopted.status, 200, JSON.stringify(adopted.body));
    assert.deepEqual(adopted.body.hostedIdentity, { adapter: 'GITLAB', instance: gitlab.origin, upstreamId: '42' });
    assert.equal(adopted.body.repositoryId, legacy.body.repositoryId);
    assert.notEqual(adopted.body.repositoryId, restored.body.repositoryId);
    assert.equal((await call(connections + '/' + legacy.body.id + '/test', 'POST', { branch: 'main' })).body.commit, second);
    assert.ok(gitlabRequests.every(path => path === gitlabPrefix + 'team%2Fmoved'));
    assert.ok(requests.every(path => path.startsWith(githubPrefix + '/team/')));
    assert.ok(github.headers.length >= 5 && github.headers.every(header => header === basic('x-access-token')));
    const reopened = (await call('/knowledge-snapshots/' + snapshot.id + '/source?file=proof.ts')).body;
    assert.equal(reopened.text, 'export const proof = 1;\n');

    const disconnected = await call(connection + '?revision=' + restored.body.revision, 'DELETE');
    assert.equal(disconnected.status, 200, JSON.stringify(disconnected.body));
    assert.equal(disconnected.body.enabled, false);
    assert.equal(disconnected.body.credentialConfigured, false);
    assert.equal(disconnected.body.eventSecretConfigured, false);
    assert.deepEqual(disconnected.body.hostedIdentity, restored.body.hostedIdentity);
    assert.deepEqual((await call(connection + '?revision=' + disconnected.body.revision, 'DELETE')).body, disconnected.body);
    await error(event(moved), 401, 'INVALID_GIT_EVENT_SIGNATURE');
    await error(call(repo + '/sync', 'POST', {}), 409, 'GIT_CONNECTION_DISABLED');
    assert.equal((await call('/knowledge-snapshots/' + snapshot.id + '/source?file=proof.ts')).body.text, reopened.text);
    records.set('/team/moved', 93);
    await error(call(connection, 'PATCH', { revision: disconnected.body.revision, enabled: true, credential: { token } }),
        409, 'GIT_REPOSITORY_IDENTITY_CHANGED');
    assert.deepEqual((await call(connection)).body, disconnected.body);
    records.set('/team/moved', 42);
    const reenabled = await call(reconnect, 'POST', { revision: disconnected.body.revision, url: github.origin + moved,
        enabled: true, credential: { token } });
    assert.equal(reenabled.body.enabled, true);
    assert.equal(reenabled.body.repositoryId, created.body.repositoryId);
    assert.equal((await call(repo)).body.id, bindingId);
});

async function startApp(root, origins, token) {
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: { ...process.env, REPOGRAPH_PROJECTS_ROOT: root, REPOGRAPH_PORT: '0',
            REPOGRAPH_DB_PATH: join(root, 'index.db'), REPOGRAPH_ASSETS_ROOT: join(root, 'assets'),
            REPOGRAPH_GIT_ORIGINS: origins.join(','), REPOGRAPH_ACCESS_TOKEN: token,
            REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_ADMIN_PASSWORD: undefined, REPOGRAPH_PROJECT_RETENTION_SECONDS: '0' },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    const base = await new Promise((resolve, reject) => {
        let stderr = '';
        child.once('error', reject);
        child.once('exit', code => reject(new Error('Server exited (' + code + '): ' + stderr)));
        child.stderr.on('data', chunk => {
            stderr += chunk;
            const address = stderr.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
            if (address) resolve(address);
        });
    });
    return {
        base,
        async request(path, method = 'GET', input, secret = token) {
            const response = await fetch(base + '/api/v1' + path, { method, headers: {
                Authorization: 'Bearer ' + secret, ...(input === undefined ? {} : { 'Content-Type': 'application/json' })
            }, body: input === undefined ? undefined : JSON.stringify(input) });
            return { status: response.status, body: await response.json() };
        },
        async stop(signal = 'SIGTERM') {
            if (child.exitCode !== null || child.signalCode !== null) return;
            const exited = once(child, 'exit');
            child.kill(signal);
            await exited;
        }
    };
}

test('remote Git synchronization indexes the resolved commit and published knowledge retains its Git provenance', { timeout: 30_000 }, async t => {
    const temp = await realpath(await mkdtemp(join(tmpdir(), 'repograph-remote-git-')));
    t.after(() => rm(temp, { recursive: true, force: true }));
    const [work, storage, remoteRoot] = ['work', 'app', 'remote'].map(name => join(temp, name));
    await Promise.all([work, storage, remoteRoot].map(path => mkdir(path)));
    await localGit(remoteRoot, 'init', '--bare', 'sample.git');
    await localGit(join(remoteRoot, 'sample.git'), 'config', 'uploadpack.allowReachableSHA1InWant', 'true');
    await localGit(work, 'init', '-b', 'main');
    const push = async number => {
        await writeFile(join(work, 'proof.ts'), 'export function proof() { return ' + number + '; }\n');
        await localGit(work, 'add', 'proof.ts');
        await localGit(work, '-c', 'user.email=dev@example.test', '-c', 'user.name=Fixture', 'commit', '-m', 'Version ' + number);
        await localGit(work, 'push', join(remoteRoot, 'sample.git'), 'main');
        return localGit(work, 'rev-parse', 'HEAD');
    };
    const first = await push(3);
    const password = randomBytes(24).toString('hex');
    const service = await forge(remoteRoot, 'Basic ' + Buffer.from('git:' + password).toString('base64'));
    t.after(service.close);
    const otherPassword = randomBytes(24).toString('hex');
    const other = await forge(remoteRoot, 'Basic ' + Buffer.from('git:' + otherPassword).toString('base64'));
    t.after(other.close);
    const accessToken = randomBytes(24).toString('hex');
    let app = await startApp(storage, [service.origin, other.origin], accessToken);
    t.after(() => app.stop());
    const call = (...args) => app.request(...args);
    const created = await call('/git/connections', 'POST', { name: 'Inventory', url: service.origin + '/sample.git',
        username: 'git', token: password });
    assert.equal(created.status, 201);
    const connectionId = created.body.id;
    assert.ok(!JSON.stringify(created.body).includes(password));
    const tested = await call('/git/connections/' + connectionId + '/test', 'POST', { branch: 'main' });
    assert.deepEqual(tested, { status: 200, body: { commit: first } });
    assert.deepEqual((await call('/projects')).body, []);
    const binding = await call('/git/repositories', 'POST', { connectionId, branch: 'main' });
    assert.equal(binding.status, 201);
    const projectId = binding.body.projectId;
    async function until(url, pending) {
        for (let attempt = 0; attempt < 560; attempt++) {
            const result = await call(url);
            assert.equal(result.status, 200);
            if (!pending.includes(result.body.status)) return result.body;
            await delay(25);
        }
        assert.fail('Run did not reach a terminal status');
    }
    async function sync(commit) {
        const accepted = await call('/git/repositories/' + projectId + '/sync', 'POST', {});
        assert.equal(accepted.status, 202);
        assert.equal(accepted.body.commit, commit);
        const job = await until('/agent-runs/' + accepted.body.runId, ['QUEUED', 'RUNNING']);
        assert.equal(job.status, 'COMPLETED', JSON.stringify(job));
        assert.equal((await call('/git/repositories/' + projectId)).body.indexedCommit, commit);
        return accepted.body.runId;
    }
    async function publish() {
        const building = await call('/summaries/generate?projectId=' + projectId, 'POST');
        assert.equal(building.status, 202);
        assert.equal((await until(building.body.pollVia.slice('/api/v1'.length), ['QUEUED', 'RUNNING'])).status, 'COMPLETED');
        return (await call('/knowledge-snapshots?projectId=' + projectId)).body[0];
    }
    const initialRun = await sync(first);
    const old = await publish();
    const second = await push(9);
    const updatedRun = await sync(second);
    assert.notEqual(updatedRun, initialRun);
    const recent = await publish();
    assert.equal(recent.source.gitCommit, second);
    assert.equal(old.source.gitCommit, first);
    assert.equal(recent.source.branch, 'main');
    assert.equal(old.source.repositoryId, recent.source.repositoryId);
    const savedSource = await call('/knowledge-snapshots/' + old.id + '/source?file=proof.ts');
    assert.equal(savedSource.body.text, 'export function proof() { return 3; }\n');
    assert.match((await call('/locate?projectId=' + projectId + '&file=proof.ts&line=1')).body.rawSource, /return 9/);
    assert.ok(service.headers.length >= 5);
    assert.ok(service.headers.every(header => header === service.headers[0]));

    const remote2 = await call('/git/connections', 'POST', { name: 'Inventory', url: other.origin + '/sample.git',
        username: 'git', token: otherPassword });
    assert.equal(remote2.status, 201);
    assert.notEqual(remote2.body.repositoryId, binding.body.repositoryId);
    const binding2 = await call('/git/repositories', 'POST', { connectionId: remote2.body.id, branch: 'main' });
    assert.equal(binding2.status, 201);
    assert.notEqual(binding2.body.projectId, projectId);
    assert.equal((await call('/git/connections/' + remote2.body.id + '/test', 'POST', { branch: 'main' })).body.commit, second);
    assert.ok(other.headers.every(header => header === 'Basic ' + Buffer.from('git:' + otherPassword).toString('base64')));
    assert.equal((await call('/git/connections', 'POST', { name: 'Other origin', url: 'http://127.0.0.1:1/sample.git' })).status, 403);

    const third = await push(11);
    const syncUrl = '/git/repositories/' + projectId + '/sync';
    service.rejectNextFetch();
    const failed = await call(syncUrl, 'POST', {});
    assert.equal(failed.body.commit, third);
    assert.equal((await until('/agent-runs/' + failed.body.runId, ['QUEUED', 'RUNNING'])).status, 'FAILED');
    assert.equal((await call('/summaries/generate?projectId=' + projectId, 'POST')).status, 409);
    assert.equal((await call('/knowledge-snapshots?projectId=' + projectId)).body[0].id, recent.id);
    const fourth = await push(15);
    const retry = await call(syncUrl, 'POST', { retryRunId: failed.body.runId });
    assert.equal(retry.status, 202);
    assert.equal(retry.body.commit, third);
    assert.notEqual(retry.body.runId, failed.body.runId);
    assert.equal((await until('/agent-runs/' + retry.body.runId, ['QUEUED', 'RUNNING'])).status, 'COMPLETED');
    assert.equal((await call('/git/repositories/' + projectId)).body.indexedCommit, third);

    const eventSecret = randomBytes(32).toString('hex');
    const connection = '/git/connections/' + connectionId;
    const configured = await call(connection, 'PATCH', { revision: 0, eventSecret });
    assert.equal(configured.status, 200);
    assert.equal(configured.body.eventSecretConfigured, true);
    assert.ok(!JSON.stringify(configured.body).includes(eventSecret));
    assert.equal((await call(connection, 'PATCH', { revision: 0, enabled: false })).status, 409);
    const automation = await call('/git/repositories/' + projectId + '/automation', 'PUT', {
        revision: 0, eventEnabled: true, intervalMinutes: 1, publishAfterSync: true
    });
    assert.equal(automation.status, 200);
    assert.equal(automation.body.publishAfterSync, true);
    const eventUrl = app.base + '/api/v1/git/events/' + connectionId;
    const payload = { url: service.origin + '/sample.git', ref: 'refs/heads/main', commit: fourth, timestamp: new Date().toISOString() };
    const event = async (input, key = eventSecret) => {
        const raw = JSON.stringify(input);
        const response = await fetch(eventUrl, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json',
            'X-Git-Event-Signature': 'sha256=' + createHmac('sha256', key).update(raw).digest('hex') } });
        return { status: response.status, body: await response.json() };
    };
    assert.equal((await event(payload, otherPassword)).status, 401);
    assert.equal((await event({ ...payload, url: other.origin + '/sample.git' })).status, 403);
    assert.equal((await event({ ...payload, ref: 'refs/heads/untracked' })).status, 404);
    assert.equal((await event({ ...payload, commit: third })).status, 409);
    const [manual, webhook] = await Promise.all([call(syncUrl, 'POST', {}), event(payload)]);
    assert.equal(manual.status, 202);
    assert.equal(webhook.status, 202);
    assert.equal(manual.body.runId, webhook.body.runId);
    assert.equal((await until('/agent-runs/' + webhook.body.runId, ['QUEUED', 'RUNNING'])).status, 'COMPLETED');
    async function autoPublication(gitRun, commit) {
        for (let attempt = 0; attempt < 140; attempt++) {
            const details = (await call('/git/repositories/' + projectId)).body;
            if (details.latestSync.runId === gitRun && details.latestSync.wikiRunId) {
                const wiki = await until('/agent-runs/' + details.latestSync.wikiRunId, ['QUEUED', 'RUNNING']);
                assert.equal(wiki.status, 'COMPLETED');
                const [latest] = (await call('/knowledge-snapshots?projectId=' + projectId)).body;
                assert.equal(latest.source.gitCommit, commit);
                assert.equal(latest.source.syncRunId, gitRun);
                assert.equal(latest.runId, wiki.id);
                return wiki.id;
            }
            await delay(25);
        }
        assert.fail('Git synchronization did not start its Wiki publication');
    }
    await autoPublication(webhook.body.runId, fourth);
    for (let attempt = 0; attempt < 150; attempt++) {
        const ready = await call('/git/repositories/' + projectId);
        if (ready.body.automation.nextAt > automation.body.nextAt) break;
        if (attempt === 149) assert.fail('Periodic Git check was not dispatched');
        await delay(20);
    }
    const gitRuns = await call('/agent-runs?projectId=' + projectId + '&playbook=GIT_SYNC');
    assert.equal(gitRuns.body.filter(run => run.inputReference.endsWith(fourth)).length, 1);
    const calendar = { timeZone: 'Asia/Shanghai', localTime: '08:10', weekdays: [3, 1] };
    const calendarEndpoint = '/git/repositories/' + binding2.body.projectId + '/automation';
    const calendarConfig = { revision: 0, intervalMinutes: null, eventEnabled: false, calendar };
    assert.equal((await call(calendarEndpoint, 'PUT', { ...calendarConfig, intervalMinutes: 30 })).status, 400);
    assert.equal((await call(calendarEndpoint, 'PUT', { ...calendarConfig, calendar: { ...calendar, timeZone: 'Wrong/Zone' } })).status, 400);
    const calendarSet = await call(calendarEndpoint, 'PUT', calendarConfig);
    assert.equal(calendarSet.status, 200);
    assert.deepEqual(calendarSet.body.calendar, { ...calendar, weekdays: [1, 3] });
    assert.ok(calendarSet.body.nextAt > Date.now());
    const oldClientUpdate = await call(calendarEndpoint, 'PUT', { revision: calendarSet.body.revision, intervalMinutes: null, eventEnabled: false });
    assert.deepEqual(oldClientUpdate.body.calendar, calendarSet.body.calendar);
    assert.equal(oldClientUpdate.body.nextAt, calendarSet.body.nextAt);
    const clockFixture = new DatabaseSync(join(storage, 'index.db'));
    try {
        clockFixture.exec('PRAGMA busy_timeout = 5000');
        clockFixture.prepare('UPDATE git_automation SET next_at = ? WHERE project_id = ?').run(Date.now() - 1000, binding2.body.projectId);
    } finally { clockFixture.close(); }
    let scheduled;
    for (let attempt = 0; attempt < 100; attempt++) {
        scheduled = (await call('/git/repositories/' + binding2.body.projectId)).body;
        if (scheduled.indexedCommit === fourth) break;
        await delay(25);
    }
    assert.equal(scheduled.indexedCommit, fourth);
    assert.equal(scheduled.automation.nextAt, calendarSet.body.nextAt);
    assert.equal((await call(connection, 'PATCH', { revision: configured.body.revision, enabled: false })).status, 200);
    assert.equal((await call(syncUrl, 'POST', {})).status, 409);
    assert.equal((await event(payload)).status, 409);
    assert.equal((await call('/knowledge-snapshots/' + old.id + '/source?file=proof.ts')).body.text, savedSource.body.text);
    const audit = (await call('/admin/audit')).body;
    assert.ok(audit.some(row => row.action === 'GIT_CONNECTION_DISABLED' && row.targetId === connectionId));
    assert.ok(!JSON.stringify(audit).includes(eventSecret));

    assert.equal((await call(connection, 'PATCH', { revision: configured.body.revision + 1, enabled: true })).status, 200);
    const fifth = await push(19);
    const hold = service.holdNextFetch();
    const interrupted = await call(syncUrl, 'POST', {});
    assert.equal(interrupted.body.commit, fifth);
    try {
        await Promise.race([hold.entered, delay(2000).then(() => assert.fail('Git fetch never started'))]);
        assert.equal((await call('/agent-runs/' + interrupted.body.runId)).body.status, 'RUNNING');
        await app.stop('SIGKILL');
    } finally { hold.release(); }
    const newest = await push(21);
    assert.notEqual(newest, fifth);
    app = await startApp(storage, [service.origin, other.origin], accessToken);
    assert.equal((await until('/agent-runs/' + interrupted.body.runId, ['RUNNING', 'QUEUED'])).status, 'COMPLETED');
    assert.equal((await call('/git/repositories/' + projectId)).body.indexedCommit, fifth);
    assert.equal((await call('/agent-runs/' + interrupted.body.runId + '/execution')).body.attempt, 2);
    assert.match((await call('/locate?projectId=' + projectId + '&file=proof.ts&line=1')).body.rawSource, /return 19/);
    const release = await autoPublication(interrupted.body.runId, fifth);
    const countBeforeResume = (await call('/agent-runs?projectId=' + projectId + '&playbook=WIKI_SUMMARY')).body.length;
    await app.stop();
    const checkpoint = new DatabaseSync(join(storage, 'index.db'));
    try {
        checkpoint.prepare("UPDATE git_publication SET state = 'PENDING', wiki_run_id = NULL WHERE sync_run_id = ?").run(interrupted.body.runId);
    } finally { checkpoint.close(); }
    app = await startApp(storage, [service.origin, other.origin], accessToken);
    assert.equal(await autoPublication(interrupted.body.runId, fifth), release);
    assert.equal((await call('/agent-runs?projectId=' + projectId + '&playbook=WIKI_SUMMARY')).body.length, countBeforeResume);

    await app.stop();
    const bundle = join(temp, 'backup');
    const restored = join(temp, 'restored');
    const recoveryEnv = { ...process.env, REPOGRAPH_PROJECTS_ROOT: storage, REPOGRAPH_DB_PATH: join(storage, 'index.db'),
        REPOGRAPH_ASSETS_ROOT: join(storage, 'assets') };
    await execute(process.execPath, ['dist/recovery-cli.js', 'backup', bundle], { env: recoveryEnv });
    await execute(process.execPath, ['dist/recovery-cli.js', 'restore', bundle, restored], { env: recoveryEnv });
    app = await startApp(restored, [service.origin, other.origin], accessToken);
    assert.equal((await call('/git/repositories/' + projectId)).body.indexedCommit, fifth);
    assert.equal((await call('/knowledge-snapshots/' + old.id + '/source?file=proof.ts')).body.text, savedSource.body.text);
    const afterRestore = await call(syncUrl, 'POST', {});
    assert.equal(afterRestore.body.commit, newest);
    assert.equal((await until('/agent-runs/' + afterRestore.body.runId, ['RUNNING', 'QUEUED'])).status, 'COMPLETED');
    assert.equal((await call('/git/repositories/' + projectId)).body.indexedCommit, newest);
    assert.match((await call('/locate?projectId=' + projectId + '&file=proof.ts&line=1')).body.rawSource, /return 21/);

    const otherId = binding2.body.projectId;
    const lifecycle = '/projects/' + otherId + '/lifecycle';
    const changeLifecycle = async (action, revision, key) => {
        const response = await fetch(app.base + '/api/v1' + lifecycle, { method: 'POST',
            headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body: JSON.stringify({ action, revision }) });
        return { status: response.status, body: await response.json() };
    };
    assert.equal((await changeLifecycle('trash', 0, 'trash-git')).body.state, 'TRASHED');
    assert.equal((await call('/git/repositories/' + otherId)).status, 404);
    assert.equal((await call('/git/repositories/' + otherId + '/sync', 'POST', {})).status, 404);
    assert.equal((await changeLifecycle('restore', 1, 'restore-git')).body.state, 'ACTIVE');
    assert.equal((await call('/git/repositories/' + otherId)).body.indexedCommit, fourth);
    assert.equal((await changeLifecycle('trash', 2, 'trash-git-again')).body.state, 'TRASHED');
    const bindingDirectory = join(restored, 'assets', '.git-sources', binding2.body.id);
    const parked = join(restored, 'parked-source');
    await rename(bindingDirectory, parked);
    await symlink(parked, bindingDirectory, 'dir');
    const cleanup = await changeLifecycle('purge', 3, 'purge-git');
    assert.equal(cleanup.status, 202);
    await delay(75);
    assert.equal((await call(lifecycle)).body.state, 'PURGING');
    assert.equal((await stat(parked)).isDirectory(), true);
    await app.stop();
    await unlink(bindingDirectory);
    await rename(parked, bindingDirectory);
    app = await startApp(restored, [service.origin, other.origin], accessToken);
    for (let attempt = 0; attempt < 120 && (await call(lifecycle)).body.state !== 'PURGED'; attempt++) await delay(25);
    assert.equal((await call(lifecycle)).body.state, 'PURGED');
    assert.deepEqual(await changeLifecycle('purge', 3, 'purge-git'), cleanup);
    await assert.rejects(stat(bindingDirectory), { code: 'ENOENT' });
    assert.equal((await call('/git/connections/' + remote2.body.id)).status, 200);
    assert.equal((await call('/git/repositories/' + projectId)).body.indexedCommit, newest);
});

test('calendar schedules honor weekdays, non-hour offsets, and repeated or skipped local times', () => {
    const next = (input, from) => new Date(nextCalendarOccurrence(calendarScheduleInput.parse(input), Date.parse(from))).toISOString();
    assert.equal(next({ timeZone: 'Asia/Kathmandu', localTime: '09:00', weekdays: [1] }, '2026-11-29T23:00:00Z'), '2026-11-30T03:15:00.000Z');
    assert.equal(next({ timeZone: 'America/New_York', localTime: '01:30' }, '2026-11-01T04:00:00Z'), '2026-11-01T05:30:00.000Z');
    assert.equal(next({ timeZone: 'America/New_York', localTime: '01:30' }, '2026-11-01T05:50:00Z'), '2026-11-02T06:30:00.000Z');
    assert.equal(next({ timeZone: 'America/New_York', localTime: '02:30', weekdays: [0] }, '2026-03-08T04:00:00Z'), '2026-03-15T06:30:00.000Z');
    assert.equal(calendarScheduleInput.safeParse({ timeZone: 'Europe/Paris', localTime: '11:11', weekdays: [1, 1] }).success, false);
});
