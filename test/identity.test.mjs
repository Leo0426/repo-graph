import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function start(t, embeddingUrl) {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'repograph-identity-')));
    const token = randomBytes(32).toString('hex');
    const administratorPassword = randomBytes(24).toString('hex');
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: {
            ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: administratorPassword,
            REPOGRAPH_PROJECTS_ROOT: directory, REPOGRAPH_DB_PATH: join(directory, '.repograph', 'index.db'),
            REPOGRAPH_EMBEDDING_MODEL: embeddingUrl ? 'fixture' : undefined,
            REPOGRAPH_EMBEDDING_URL: embeddingUrl, REPOGRAPH_EMBEDDING_DIMENSIONS: embeddingUrl ? '2' : undefined,
            REPOGRAPH_PORT: '0'
        },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const ended = once(child, 'exit');
            child.kill('SIGTERM');
            await ended;
        }
        await rm(directory, { recursive: true, force: true });
    });
    const base = await new Promise((resolve, reject) => {
        let stderr = '';
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Server exited (${code}): ${stderr}`)));
        child.stderr.on('data', chunk => {
            stderr += chunk;
            const address = stderr.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
            if (address) resolve(address);
        });
    });

    function client(authorization) {
        const cookies = new Map();
        return async (path, method = 'GET', input, csrf, extraHeaders = {}) => {
            const headers = {
                Origin: base, ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
                ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders
            };
            if (csrf) headers['X-CSRF-Token'] = csrf;
            if (cookies.size) headers.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
            const response = await fetch(`${base}/api/v1${path}`, { method, headers, body: JSON.stringify(input) });
            for (const cookie of response.headers.getSetCookie()) {
                const [name, value] = cookie.split(';', 1)[0].split('=', 2);
                if (value) cookies.set(name, value);
                else cookies.delete(name);
            }
            return { status: response.status, body: await response.json() };
        };
    }
    return { base, directory, token, administratorPassword, client };
}

test('spaces scope repository access and retain exact Markdown revisions across conflicts and recovery', { timeout: 20_000 }, async t => {
    const app = await start(t);
    const admin = app.client(app.token);
    const user = app.client();
    const password = randomBytes(24).toString('hex');
    const credentials = { username: 'collaborator', password };
    const preflight = (await user('/auth/csrf')).body.token;
    const registered = await user('/auth/register', 'POST', {
        ...credentials, displayName: 'Collaborator', email: 'collaborator@example.test'
    }, preflight);
    const accountId = registered.body.id;
    assert.equal((await admin(`/admin/accounts/${accountId}/review`, 'POST', { status: 'ACTIVE', reason: 'Reviewed' })).status, 200);
    assert.equal((await user('/auth/login', 'POST', credentials, preflight)).status, 200);
    const csrf = (await user('/auth/csrf')).body.token;
    const secretFile = await fetch(app.base + '/api/v1/ask/sessions', { method: 'POST',
        headers: { Authorization: 'Bearer ' + app.token, 'Content-Type': 'application/json', 'Idempotency-Key': 'private-attachment-fixture' },
        body: JSON.stringify({ attachments: [{ name: 'Owner only.md', text: 'PrivateOwnerMarker' }] }) });
    assert.equal(secretFile.status, 201);
    const secretSession = await secretFile.json();
    const [attachment] = secretSession.scope.attachments;
    const privateAttachments = '/ask/sessions/' + secretSession.id + '/attachments';
    assert.equal((await user(privateAttachments)).status, 404);
    assert.equal((await user(privateAttachments + '/' + attachment.attachmentId + '?versionId=' + attachment.versionId)).status, 404);
    assert.deepEqual((await user('/ask/sessions')).body, []);
    const root = join(app.directory, 'shared');
    await mkdir(root);
    await writeFile(join(root, 'record.ts'), 'export function lookupLedger() { return 42; }');
    const args = `?projectRoot=${encodeURIComponent(root)}`;
    assert.equal((await admin(`/index/project${args}`, 'POST')).status, 202);
    let status;
    for (let attempt = 0; attempt < 75; attempt++) {
        status = (await admin(`/index/project/status${args}`)).body.status;
        if (status !== 'running') break;
        await delay(20);
    }
    assert.equal(status, 'done');
    const [{ projectId }] = (await admin('/projects')).body;
    const access = `/projects/${projectId}/access`;
    assert.equal((await admin(`/admin/projects/${projectId}/owner`, 'PUT', { ownerType: 'PERSONAL', ownerId: 'builtin-admin' })).status, 200);

    const created = await admin('/spaces', 'POST', { name: 'Release notes' });
    assert.equal(created.status, 201);
    const space = `/spaces/${created.body.id}`;
    const second = `/spaces/${(await admin('/spaces', 'POST', { name: 'Engineering' })).body.id}`;
    assert.deepEqual((await user('/spaces')).body, []);
    assert.equal((await user(space)).status, 404);
    const viewer = await admin(`${space}/members`, 'PUT', { accountId, role: 'VIEWER', revision: created.body.revision });
    const generate = { target: { name: 'Denied.md' }, instruction: 'Draft a note', key: 'viewer-generation' };
    assert.equal((await user(`${space}/documents/generate`, 'POST', generate, csrf)).status, 403);
    assert.equal((await user(`${second}/documents/generate`, 'POST', generate, csrf)).status, 404);
    const shared = await admin(`${space}/members`, 'PUT', { accountId, role: 'EDITOR', revision: viewer.body.revision });
    assert.equal(shared.status, 200);
    assert.equal((await user(`${space}/repositories`, 'POST', { projectId, revision: shared.body.revision }, csrf)).status, 403);
    await admin(access, 'PUT', { accountId, role: 'VIEWER', revision: (await admin(access)).body.revision });
    const link = await user(`${space}/repositories`, 'POST', { projectId, revision: shared.body.revision }, csrf);
    assert.equal(link.status, 200);
    assert.equal((await admin(`${second}/repositories`, 'POST', { projectId, revision: 0 })).status, 200);
    assert.equal((await user(`${space}/repositories/${projectId}/search?q=lookupLedger`)).body.length, 1);
    const detachedLink = await user(`${space}/repositories/${projectId}?revision=${link.body.revision}`, 'DELETE', undefined, csrf);
    assert.equal(detachedLink.status, 200);
    assert.equal((await user(`${space}/repositories/${projectId}/search?q=lookupLedger`)).status, 404);
    assert.equal((await user(`/search/keyword?projectId=${projectId}&q=lookupLedger`)).body.length, 1);
    assert.equal((await admin(`${second}/repositories/${projectId}/search?q=lookupLedger`)).body.length, 1);
    const lostAccess = await admin(access, 'PUT', { accountId, role: null, revision: (await admin(access)).body.revision });
    assert.equal(lostAccess.status, 200);
    assert.deepEqual((await user(`${space}/repositories/detached`)).body, []);
    assert.equal((await user(`${space}/repositories/${projectId}/restore`, 'POST', { revision: detachedLink.body.revision }, csrf)).status, 403);
    assert.equal((await admin(access, 'PUT', { accountId, role: 'VIEWER', revision: lostAccess.body.revision })).status, 200);

    const folder = await user(`${space}/folders`, 'POST', { name: 'Guide' }, csrf);
    assert.equal(folder.status, 201);
    const contents = '\ufeff# handbook\r\n\r\n' + 'Long line '.repeat(10000) + '\r\n';
    const create = { parentId: folder.body.id, name: 'Guide.md', markdown: contents, key: 'create-guide' };
    const document = await user(`${space}/documents`, 'POST', create, csrf);
    assert.equal(document.status, 201);
    let beginGeneration, releaseGeneration;
    const generationStarted = new Promise(resolve => { beginGeneration = resolve; });
    const generationReleased = new Promise(resolve => { releaseGeneration = resolve; });
    const provider = createServer(async (req, res) => {
        for await (const _ of req) { /* Wait for the entire model request. */ }
        beginGeneration();
        await generationReleased;
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            message: { content: 'This generated text must stay hidden.' }, done_reason: 'stop'
        }));
    });
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    t.after(() => { releaseGeneration(); provider.closeAllConnections(); return new Promise(resolve => provider.close(resolve)); });
    assert.equal((await admin('/admin/model-providers/legacy-ollama', 'PUT', { name: 'Revocation fixture', protocol: 'OLLAMA', model: 'mock',
        baseUrl: 'http://127.0.0.1:' + provider.address().port, enabled: true, timeoutMillis: 2000, maxOutputTokens: 512 })).status, 200);
    const inFlightGeneration = user(`${space}/documents/generate`, 'POST', {
        target: { name: 'Revoked.md' }, instruction: 'Write an instruction sheet', key: 'revoked-generation'
    }, csrf);
    await generationStarted;
    const downgrade = await admin(`${space}/members`, 'PUT', { accountId, role: 'VIEWER', revision: (await admin(space)).body.revision });
    assert.equal(downgrade.status, 200);
    releaseGeneration();
    const refusedGeneration = await inFlightGeneration;
    assert.equal(refusedGeneration.status, 403);
    assert.equal(refusedGeneration.body.markdown, undefined);
    assert.deepEqual((await admin(`${space}/documents/search?q=hidden`)).body, []);
    assert.equal((await admin(`${space}/members`, 'PUT', { accountId, role: 'EDITOR', revision: downgrade.body.revision })).status, 200);
    const privateSession = await user('/ask/sessions', 'POST', { scopes: [{ spaceId: created.body.id, documentId: document.body.id }] }, csrf);
    assert.equal(privateSession.status, 201);
    assert.equal(privateSession.body.ownerId, accountId);
    assert.equal((await admin('/ask/sessions/' + privateSession.body.id)).status, 404);
    assert.equal((await admin('/ask/sessions/' + privateSession.body.id + '/events')).status, 404);
    assert.equal((await user(`${space}/documents/search?q=handbook`)).body[0].id, document.body.id);
    assert.deepEqual((await user(`${space}/documents`, 'POST', create, csrf)).body, document.body);
    assert.equal((await user(`${space}/documents`, 'POST', { ...create, key: 'new-doc' }, csrf)).status, 409);
    const item = `${space}/documents/${document.body.id}`;
    const original = document.body.version.id;
    const edits = await Promise.all(['', '# replacement'].map((markdown, idx) => user(item, 'PUT', {
        baseVersionId: original, key: 'edit-guide-' + idx, markdown
    }, csrf)));
    assert.deepEqual(edits.map(edit => edit.status).sort(), [200, 409]);
    const winner = edits.findIndex(edit => edit.status === 200);
    let latest = edits[winner].body;
    assert.deepEqual((await user(item, 'PUT', { baseVersionId: original, key: 'edit-guide-' + winner,
        markdown: ['', '# replacement'][winner] }, csrf)).body, latest);
    if (winner) latest = (await user(item, 'PUT', { baseVersionId: latest.version.id, key: 'empty-guide', markdown: '' }, csrf)).body;
    assert.equal((await user(item)).body.markdown, '');
    const old = await user(`${item}/versions/${original}`);
    assert.equal(old.body.markdown, contents);
    assert.equal(old.body.version.bytes, Buffer.byteLength(contents));
    assert.deepEqual((await user(`${space}/documents/search?q=handbook`)).body, []);
    const download = await fetch(`${app.base}/api/v1${item}/versions/${original}/export`, { headers: { Authorization: 'Bearer ' + app.token } });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from(contents));

    const deletedFolder = await user(`${space}/items/${folder.body.id}`, 'DELETE', undefined, csrf);
    assert.equal(deletedFolder.status, 200);
    assert.equal((await user(item)).status, 404);
    const secondFolder = await user(`${space}/folders`, 'POST', { name: 'Guide' }, csrf);
    assert.equal(secondFolder.status, 201);
    const restore = `${space}/trash/${deletedFolder.body.id}/restore`;
    assert.equal((await user(restore, 'POST', {}, csrf)).status, 409);
    assert.equal((await user(restore, 'POST', { name: 'Recovered guide' }, csrf)).status, 200);
    assert.equal((await user(`${item}/versions/${original}`)).body.markdown, contents);
    assert.equal((await user(item)).body.version.id, latest.version.id);
    const move = `${space}/items/${document.body.id}`;
    const child = (await user(`${space}/folders`, 'POST', { name: 'Subfolder', parentId: folder.body.id }, csrf)).body;
    assert.equal((await user(`${space}/items/${folder.body.id}`, 'PATCH', { name: 'Cycle', parentId: child.id }, csrf)).body.error, 'SPACE_FOLDER_CYCLE');
    const placed = await user(move, 'PATCH', { name: 'Moved guide.md', parentId: secondFolder.body.id }, csrf);
    assert.equal(placed.status, 200);
    assert.equal(placed.body.parentId, secondFolder.body.id);
    assert.equal(placed.body.versionId, latest.version.id);
    assert.equal((await user(`${item}/versions/${original}`)).body.markdown, contents);
    const active = (await admin(space)).body;
    assert.ok(active.usedBytes >= Buffer.byteLength(contents));
    const lowered = await admin(space, 'PATCH', { maxBytes: 0, revision: active.revision });
    assert.equal(lowered.status, 200);
    assert.equal((await user(item, 'PUT', { baseVersionId: latest.version.id, key: 'quota-guide', markdown: 'blocked' }, csrf)).status, 409);
    assert.equal((await admin(space, 'PATCH', { status: 'ARCHIVED', revision: lowered.body.revision })).status, 200);
    assert.equal((await user(item)).status, 200);
    assert.equal((await user(item, 'PUT', { baseVersionId: latest.version.id, key: 'archived-guide', markdown: 'blocked' }, csrf)).status, 409);
    const archived = (await admin(space)).body;
    assert.equal((await admin(space, 'PATCH', { name: 'No archived edit', revision: archived.revision })).body.error, 'SPACE_READ_ONLY');
    const reactivated = await admin(space, 'PATCH', { status: 'ACTIVE', revision: archived.revision });
    assert.equal(reactivated.status, 200);
    const trash = await user(`${space}/items/${document.body.id}`, 'DELETE', undefined, csrf);
    assert.equal(trash.status, 200);
    assert.equal((await admin(space)).body.usedBytes, active.usedBytes);
    assert.equal((await user(`${space}/trash/${trash.body.id}`, 'DELETE', undefined, csrf)).status, 403);
    const purge = await admin(`${space}/trash/${trash.body.id}`, 'DELETE');
    assert.equal(purge.status, 200);
    assert.equal(purge.body.usedBytes, 0);
    assert.equal((await user(`${space}/documents`, 'POST', create, csrf)).status, 410);
    const deleted = await admin(space, 'PATCH', { status: 'DELETED', revision: reactivated.body.revision });
    assert.equal(deleted.status, 200);
    assert.equal((await user(space)).status, 404);
    assert.deepEqual((await user('/spaces')).body, []);
    assert.deepEqual((await user('/spaces?deleted=true')).body, []);
    assert.deepEqual((await admin('/spaces?deleted=true')).body.map(entry => entry.id), [created.body.id]);
    assert.equal((await admin(space, 'PATCH', { status: 'ACTIVE', revision: deleted.body.revision })).status, 200);
    assert.equal((await user(space)).status, 200);
    assert.deepEqual((await admin('/spaces?deleted=true')).body, []);

    const team = (await admin(second)).body;
    const named = await admin(`${second}/members`, 'PUT', { username: credentials.username.toUpperCase(), role: 'ADMIN', revision: team.revision });
    assert.equal(named.status, 200);
    assert.equal((await admin(`${second}/members`, 'PUT', { username: 'unknown-username', role: 'EDITOR', revision: named.body.revision })).status, 400);
    const members = (await user(`${second}/members?details=true`)).body;
    assert.ok(members.some(entry => entry.accountId === accountId && entry.username === credentials.username && entry.role === 'ADMIN'));
    assert.ok(members.every(entry => !('email' in entry) && !('credentialVersion' in entry)));
    assert.equal((await user(`${second}/transfer`, 'POST', { accountId, revision: named.body.revision }, csrf)).status, 403);
    assert.equal((await admin(`${second}/transfer`, 'POST', { accountId, revision: named.body.revision })).status, 200);
    assert.equal((await user(second)).body.role, 'OWNER');
    assert.equal((await user(`${second}/members?details=true`)).body.find(entry => entry.accountId === 'builtin-admin').role, 'ADMIN');
    const lifecycle = '/projects/' + projectId + '/lifecycle';
    assert.equal((await user(lifecycle)).status, 403);
    assert.equal((await admin(`/admin/projects/${projectId}/owner`, 'PUT', { ownerType: 'PERSONAL', ownerId: accountId })).status, 200);
    async function changeRepository(action, revision) {
        const response = await user(lifecycle, 'POST', { action, revision }, csrf, { 'Idempotency-Key': 'owner-' + action });
        assert.equal(response.status, 200);
        return response.body;
    }
    assert.equal((await changeRepository('trash', 0)).state, 'TRASHED');
    assert.equal((await user('/projects/trash')).body.projects[0].projectId, projectId);
    assert.equal((await user(`/projects/${projectId}/stats`)).status, 404);
    assert.equal((await changeRepository('restore', 1)).state, 'ACTIVE');
    assert.equal((await user(`/projects/${projectId}/stats`)).status, 200);
});

test('registration requires approval and account changes invalidate existing browser sessions', { timeout: 20_000 }, async t => {
    const app = await start(t);
    const user = app.client();
    const admin = app.client(app.token);
    const password = randomBytes(24).toString('hex');
    const registration = { username: 'analyst', displayName: 'Analyst', email: 'analyst@example.test', password, role: 'ADMIN' };
    const credentials = { username: 'analyst', password };
    const initialCsrf = await user('/auth/csrf');
    assert.equal(initialCsrf.status, 200);
    assert.equal((await user('/auth/register', 'POST', registration)).status, 403);
    const registered = await user('/auth/register', 'POST', registration, initialCsrf.body.token);
    assert.equal(registered.status, 201);
    assert.equal(registered.body.role, 'USER');
    assert.equal(registered.body.status, 'PENDING');
    assert.ok(!JSON.stringify(registered.body).includes(password));

    assert.equal((await user('/auth/login', 'POST', credentials, initialCsrf.body.token)).status, 401);
    const review = `/admin/accounts/${registered.body.id}/review`;
    assert.equal((await admin(review, 'POST', { status: 'ACTIVE', reason: 'Reviewed' })).status, 200);
    assert.equal((await user('/auth/login', 'POST', credentials, initialCsrf.body.token)).status, 200);
    assert.equal((await user('/auth/me')).body.username, 'analyst');
    assert.equal((await user('/admin/accounts')).status, 403);
    assert.equal((await user('/admin/model-providers')).status, 403);
    assert.equal((await user('/agent-settings/llm')).status, 403);
    const parallel = app.client();
    const parallelCsrf = (await parallel('/auth/csrf')).body.token;
    assert.equal((await parallel('/auth/login', 'POST', credentials, parallelCsrf)).status, 200);
    const newPassword = randomBytes(24).toString('hex');
    const userCsrf = (await user('/auth/csrf')).body.token;
    assert.equal((await user('/auth/password', 'POST', { oldPassword: password, newPassword }, userCsrf)).status, 200);
    assert.equal((await parallel('/auth/me')).status, 401);
    const passwordCsrf = (await user('/auth/csrf')).body.token;
    assert.equal((await user('/auth/login', 'POST', credentials, passwordCsrf)).status, 401);
    assert.equal((await user('/auth/login', 'POST', { ...credentials, password: newPassword }, passwordCsrf)).status, 200);
    assert.equal((await admin(review, 'POST', { status: 'DISABLED', reason: 'Access ended' })).status, 200);
    assert.equal((await user('/auth/me')).status, 401);
    const audit = await admin('/admin/audit');
    assert.deepEqual(audit.body.slice(0, 3).map(event => event.action), ['ACCOUNT_DISABLED', 'PASSWORD_CHANGED', 'ACCOUNT_ACTIVE']);
});

test('project ownership limits REST and account-authenticated MCP immediately', { timeout: 25_000 }, async t => {
    let started;
    let startedUnified;
    let release;
    const queryStarted = new Promise(resolve => { started = resolve; });
    const unifiedStarted = new Promise(resolve => { startedUnified = resolve; });
    const resumeQuery = new Promise(resolve => { release = resolve; });
    const embedding = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        if (body.input.includes('held-search')) {
            started();
            await resumeQuery;
        }
        if (body.input.includes('held-unified')) {
            startedUnified();
            await resumeQuery;
        }
        const embeddings = body.input.map(input => input.includes('allowed') ? [0, 1] : [1, 0]);
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ model: 'fixture', embeddings }));
    });
    embedding.listen(0, '127.0.0.1');
    await once(embedding, 'listening');
    t.after(() => new Promise(resolve => { release(); embedding.close(resolve); }));
    const app = await start(t, `http://127.0.0.1:${embedding.address().port}`);
    const admin = app.client();
    const administrator = await admin('/auth/csrf');
    assert.equal((await admin('/auth/login', 'POST', {
        username: 'admin', password: app.administratorPassword
    }, administrator.body.token)).status, 200);
    const adminCsrf = (await admin('/auth/csrf')).body.token;
    const reviewer = app.client();
    const password = randomBytes(24).toString('hex');
    const credentials = { username: 'reviewer', password };
    const preflight = (await reviewer('/auth/csrf')).body.token;
    const registered = await reviewer('/auth/register', 'POST', {
        ...credentials, displayName: 'Reviewer', email: 'reviewer@example.test'
    }, preflight);
    const accountId = registered.body.id;
    assert.equal((await admin(`/admin/accounts/${accountId}/review`, 'POST', {
        status: 'ACTIVE', reason: 'Reviewed'
    }, adminCsrf)).status, 200);
    assert.equal((await reviewer('/auth/login', 'POST', credentials, preflight)).status, 200);

    const [allowed, hidden] = await Promise.all(['allowed', 'hidden'].map(async name => {
        const root = join(app.directory, name);
        await mkdir(root);
        await writeFile(join(root, 'shared.ts'), `function lookup() { return "needle ${name}" + "MD5"; }`);
        const args = `?projectRoot=${encodeURIComponent(root)}`;
        assert.equal((await admin(`/index/project${args}`, 'POST', undefined, adminCsrf)).status, 202);
        let status;
        for (let attempt = 0; attempt < 75; attempt++) {
            status = (await admin(`/index/project/status${args}`)).body.status;
            if (status !== 'running') break;
            await delay(20);
        }
        assert.equal(status, 'done');
        return { id: createHash('sha256').update(root).digest('hex').slice(0, 12), args };
    }));
    assert.deepEqual((await reviewer('/projects')).body, []);
    assert.equal((await reviewer(`/projects/${hidden.id}/stats`)).status, 403);
    assert.equal((await reviewer('/search/keyword?q=needle')).status, 403);
    assert.equal((await reviewer('/admin/diagnostics')).status, 403);
    assert.equal((await reviewer('/admin/model-usage')).status, 403);

    assert.equal((await admin(`/admin/projects/${hidden.id}/owner`, 'PUT', {
        ownerType: 'PERSONAL', ownerId: 'builtin-admin'
    }, adminCsrf)).status, 200);
    const access = `/projects/${hidden.id}/access`;
    const initialAccess = await admin(access);
    assert.equal(initialAccess.status, 200);
    const grant = { accountId, role: 'VIEWER', revision: initialAccess.body.revision };
    const granted = await admin(access, 'PUT', grant, adminCsrf);
    assert.equal(granted.status, 200);
    assert.equal((await reviewer(`/projects/${hidden.id}/stats`)).status, 200);
    assert.equal((await reviewer(access)).status, 403);
    const grantCsrf = (await reviewer('/auth/csrf')).body.token;
    assert.equal((await reviewer(`/summaries/generate?projectId=${hidden.id}`, 'POST', undefined, grantCsrf)).status, 403);
    assert.equal((await reviewer(`/vulns/scan/code?projectId=${hidden.id}`, 'POST', undefined, grantCsrf)).status, 403);
    assert.equal((await admin(access, 'PUT', { ...grant, role: null }, adminCsrf)).status, 409);
    const revoked = await admin(access, 'PUT', { ...grant, role: null, revision: granted.body.revision }, adminCsrf);
    assert.equal(revoked.status, 200);
    assert.equal((await reviewer(`/projects/${hidden.id}/stats`)).status, 403);
    const handoff = await admin(access + '/transfer', 'POST', { accountId, revision: revoked.body.revision }, adminCsrf);
    assert.equal(handoff.status, 200);
    assert.equal(handoff.body.owner.ownerId, accountId);
    const handback = await reviewer(access + '/transfer', 'POST',
        { accountId: 'builtin-admin', revision: handoff.body.revision }, grantCsrf);
    assert.equal(handback.status, 200);
    assert.deepEqual(handback.body.grants, [{ accountId, role: 'ADMIN' }]);
    assert.equal((await reviewer(access + '/transfer', 'POST', { accountId, revision: handback.body.revision }, grantCsrf)).status, 403);
    assert.equal((await reviewer(access, 'PUT', { accountId, role: null, revision: handback.body.revision }, grantCsrf)).status, 200);
    assert.equal((await reviewer(access)).status, 403);

    const organization = await admin('/admin/organizations', 'POST', { name: 'Review team' }, adminCsrf);
    assert.equal(organization.status, 201);
    const orgId = organization.body.id;
    const member = `/admin/organizations/${orgId}/members/${accountId}`;
    assert.equal((await admin(member, 'PUT', { member: true }, adminCsrf)).status, 200);
    assert.equal((await admin(`/admin/projects/${allowed.id}/owner`, 'PUT', {
        ownerType: 'ORGANIZATION', ownerId: orgId
    }, adminCsrf)).status, 200);
    assert.deepEqual((await reviewer('/projects')).body.map(project => project.projectId), [allowed.id]);
    assert.deepEqual((await reviewer('/search/authorized/keyword?q=needle&limit=1')).body
        .map(hit => hit.projectId), [allowed.id]);
    const semantic = await reviewer('/search/authorized/semantic?q=needle&limit=1');
    assert.deepEqual(semantic.body.results.map(hit => hit.projectId), [allowed.id]);
    assert.equal(semantic.body.hasMore, false);
    assert.equal((await reviewer(`/symbol/lookup?projectId=${hidden.id}`)).status, 403);
    assert.equal((await reviewer(`/index/project/status${hidden.args}`)).status, 403);
    assert.equal((await reviewer(`/index/project/status${allowed.args}`)).status, 200);
    const reviewerCsrf = (await reviewer('/auth/csrf')).body.token;
    assert.equal((await reviewer(`/triage/report/pr?projectId=${allowed.id}&format=semgrep&owner=fixture&repo=labels&prNumber=42`,
        'POST', { results: [] }, reviewerCsrf)).status, 403);
    const check = id => '/vulns/scan/code?projectId=' + id;
    assert.equal((await reviewer(check(hidden.id), 'POST', undefined, reviewerCsrf)).status, 403);
    assert.equal((await reviewer(check(allowed.id), 'POST')).status, 403);
    const scanned = await reviewer(check(allowed.id), 'POST', undefined, reviewerCsrf);
    assert.equal(scanned.status, 200);
    assert.deepEqual([scanned.body.projectId, scanned.body.scannedUnits, scanned.body.newFindings, scanned.body.nextOffset],
        [allowed.id, 1, 1, null]);
    const mismatched = await reviewer(check(allowed.id) + '&offset=1&indexVersion=' + '0'.repeat(64), 'POST', undefined, reviewerCsrf);
    assert.deepEqual(mismatched, { status: 409, body: { error: 'CODE_SCAN_INDEX_CHANGED' } });
    const replay = await reviewer(check(allowed.id) + '&offset=1&indexVersion=' + scanned.body.indexVersion,
        'POST', undefined, reviewerCsrf);
    assert.deepEqual([replay.body.scannedUnits, replay.body.matchedFindings, replay.body.newFindings], [0, 0, 0]);
    const [finding] = (await reviewer('/vulns?projectId=' + allowed.id)).body;
    const unit = (await reviewer('/symbol/lookup?projectId=' + allowed.id)).body;
    const expected = createHash('sha256').update(allowed.id + ':WEAK_CRYPTO:' + unit.id).digest('hex').slice(0, 16);
    assert.deepEqual([finding.id, finding.status, finding.sourceCheck, finding.filePath, finding.startLine],
        [expected, 'SUSPECTED', true, 'shared.ts', 1]);
    assert.equal((await admin('/vulns?projectId=' + hidden.id)).body.length, 0);
    assert.equal((await reviewer('/vulns/' + finding.id + '/status', 'PUT',
        { status: 'DISMISSED', reason: 'Only a demonstration string' }, reviewerCsrf)).status, 200);
    assert.equal((await reviewer(`/index/project?projectId=${allowed.id}`, 'DELETE', undefined, reviewerCsrf)).status, 403);
    assert.equal((await reviewer(`/summaries/generate?projectId=${hidden.id}`, 'POST', undefined, reviewerCsrf)).status, 403);
    const wiki = await reviewer(`/summaries/generate?projectId=${allowed.id}`, 'POST', undefined, reviewerCsrf);
    assert.equal(wiki.status, 202);
    let wikiRun;
    const wikiRunPath = `/agent-runs/${wiki.body.agentRunId}`;
    for (let attempt = 0; attempt < 80; attempt++) {
        wikiRun = (await reviewer(wikiRunPath)).body;
        if (wikiRun.status !== 'QUEUED' && wikiRun.status !== 'RUNNING') break;
        await delay(20);
    }
    assert.equal(wikiRun.status, 'COMPLETED');
    const wikiTree = await reviewer(`/summaries/tree?projectId=${allowed.id}`);
    const wikiDocumentPath = `/summaries/${wikiTree.body[0].id}`;
    const wikiDocument = await reviewer(wikiDocumentPath);
    assert.equal(wikiDocument.status, 200);
    const canManage = await reviewer(`/projects/${allowed.id}/capabilities`);
    assert.equal(canManage.body.canManage, false);
    assert.equal((await reviewer(`/knowledge-snapshots/${wikiDocument.body.knowledgeSnapshotId}/lifecycle?projectId=${allowed.id}`)).status, 403);
    const ownExport = await reviewer(wikiDocumentPath + '/exports', 'POST',
        { revisionId: wikiDocument.body.revision.id, format: 'markdown' }, reviewerCsrf);
    assert.equal(ownExport.status, 201);
    assert.equal((await admin(`/admin/organizations/${orgId}`, 'PUT', { name: 'Review team', active: false },
        adminCsrf)).status, 200);
    assert.deepEqual((await reviewer('/projects')).body, []);
    assert.equal((await admin(`/admin/organizations/${orgId}`, 'PUT', { name: 'Review team', active: true },
        adminCsrf)).status, 200);
    assert.deepEqual((await reviewer('/projects')).body.map(project => project.projectId), [allowed.id]);

    const transport = new StdioClientTransport({
        command: process.execPath, args: ['dist/mcp.js'], stderr: 'pipe',
        env: { REPOGRAPH_BASE_URL: app.base, REPOGRAPH_USERNAME: credentials.username, REPOGRAPH_PASSWORD: password }
    });
    const client = new Client({ name: 'identity-check', version: '1.0.0' });
    try {
        await client.connect(transport);
        const list = await client.callTool({ name: 'list_projects' });
        assert.deepEqual(JSON.parse(list.content[0].text).map(project => project.projectId), [allowed.id]);
        const wikiArgs = { projectId: allowed.id, snapshotId: wikiDocument.body.knowledgeSnapshotId, pageId: wikiDocument.body.id };
        const historical = await client.callTool({ name: 'read_wiki_page', arguments: wikiArgs });
        assert.deepEqual(historical.structuredContent.body, wikiDocument.body);
        const code = await client.callTool({ name: 'scan_vuln_code', arguments: { projectId: allowed.id } });
        assert.equal(code.isError, false);
        assert.equal(JSON.parse(code.content[0].text).newFindings, 0);
        const retained = (await reviewer('/vulns/' + finding.id)).body;
        assert.equal(retained.finding.status, 'DISMISSED');
        assert.deepEqual(retained.audit.map(event => [event.actor, event.toStatus]), [
            ['reviewer', 'SUSPECTED'], ['reviewer', 'DISMISSED']
        ]);
        const inFlight = reviewer(`/search/semantic?projectId=${allowed.id}&q=held-search`);
        const unifiedInFlight = reviewer('/search/knowledge', 'POST', { query: 'held-unified',
            scopes: [{ kind: 'repository', projectId: allowed.id, snapshotId: wikiArgs.snapshotId }] }, reviewerCsrf);
        await Promise.all([queryStarted, unifiedStarted]);
        assert.equal((await admin(member, 'PUT', { member: false }, adminCsrf)).status, 200);
        release();
        assert.equal((await inFlight).status, 403);
        const revokedResult = await unifiedInFlight;
        assert.equal(revokedResult.status, 403);
        assert.equal(revokedResult.body.results, undefined);
        assert.equal((await reviewer(`/projects/${allowed.id}/stats`)).status, 403);
        assert.equal((await reviewer(wikiRunPath)).status, 404);
        assert.equal((await reviewer(wikiDocumentPath)).status, 404);
        assert.equal((await reviewer('/search/knowledge', 'POST', { query: 'held-search',
            scopes: [{ kind: 'repository', projectId: allowed.id }] }, reviewerCsrf)).status, 403);
        assert.equal((await reviewer(ownExport.body.downloadPath.slice('/api/v1'.length))).status, 404);
        const revokedPage = await client.callTool({ name: 'read_wiki_page', arguments: wikiArgs });
        assert.equal(revokedPage.isError, true);
        assert.equal(revokedPage.structuredContent.status, 404);
        const revoked = await client.callTool({ name: 'list_projects' });
        assert.deepEqual(JSON.parse(revoked.content[0].text), []);
    } finally {
        await client.close();
    }
});
