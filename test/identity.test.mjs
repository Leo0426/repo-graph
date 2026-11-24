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
        return async (path, method = 'GET', input, csrf) => {
            const headers = {
                Origin: base, ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
                ...(input === undefined ? {} : { 'Content-Type': 'application/json' })
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
    let release;
    const queryStarted = new Promise(resolve => { started = resolve; });
    const resumeQuery = new Promise(resolve => { release = resolve; });
    const embedding = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        if (body.input.includes('held-search')) {
            started();
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
    assert.equal((await reviewer(wikiDocumentPath)).status, 200);
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
        const code = await client.callTool({ name: 'scan_vuln_code', arguments: { projectId: allowed.id } });
        assert.equal(code.isError, false);
        assert.equal(JSON.parse(code.content[0].text).newFindings, 0);
        const retained = (await reviewer('/vulns/' + finding.id)).body;
        assert.equal(retained.finding.status, 'DISMISSED');
        assert.deepEqual(retained.audit.map(event => [event.actor, event.toStatus]), [
            ['reviewer', 'SUSPECTED'], ['reviewer', 'DISMISSED']
        ]);
        const inFlight = reviewer(`/search/semantic?projectId=${allowed.id}&q=held-search`);
        await queryStarted;
        assert.equal((await admin(member, 'PUT', { member: false }, adminCsrf)).status, 200);
        release();
        assert.equal((await inFlight).status, 403);
        assert.equal((await reviewer(`/projects/${allowed.id}/stats`)).status, 403);
        assert.equal((await reviewer(wikiRunPath)).status, 404);
        assert.equal((await reviewer(wikiDocumentPath)).status, 404);
        const revoked = await client.callTool({ name: 'list_projects' });
        assert.deepEqual(JSON.parse(revoked.content[0].text), []);
    } finally {
        await client.close();
    }
});
