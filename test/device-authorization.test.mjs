import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('browser-approved device grants issue one site-bound credential and enforce read scope and revocation', { timeout: 20_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'repograph-device-auth-'));
    const database = join(root, 'data.db');
    const directory = join(root, 'cli-credentials');
    const adminToken = randomBytes(32).toString('hex');
    const digest = text => createHash('sha256').update(text).digest('hex');
    let server, base;
    async function start(enabled) {
        server = spawn(process.execPath, ['dist/server.js'], { env: {
            ...process.env, REPOGRAPH_ACCESS_TOKEN: adminToken, REPOGRAPH_ADMIN_PASSWORD: undefined, REPOGRAPH_DEVICE_AUTH: enabled ? '1' : '0',
            REPOGRAPH_REMOTE_MCP: enabled ? '1' : '0',
            REPOGRAPH_PORT: base ? new URL(base).port : '0', REPOGRAPH_PROJECTS_ROOT: root, REPOGRAPH_DB_PATH: database,
            REPOGRAPH_ASSETS_ROOT: join(root, 'assets'), REPOGRAPH_EMBEDDING_MODEL: undefined
        }, stdio: ['ignore', 'ignore', 'pipe'] });
        base = await new Promise((resolve, reject) => {
            let logs = '';
            server.once('error', reject);
            server.once('exit', code => reject(new Error('Server exited (' + code + '): ' + logs)));
            server.stderr.on('data', chunk => {
                logs += chunk;
                const address = logs.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
                if (address) resolve(address);
            });
        });
    }
    async function stop() {
        if (server?.exitCode === null && server.signalCode === null) {
            const exited = once(server, 'exit');
            server.kill('SIGTERM');
            await exited;
        }
    }
    t.after(async () => { await stop(); await rm(root, { recursive: true, force: true }); });
    const auth = secret => ({ Authorization: 'Bearer ' + secret });
    const request = (path, method = 'GET', body, headers = {}) => fetch(base + '/api/v1' + path, {
        method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: JSON.stringify(body)
    });
    async function json(...args) {
        const response = await request(...args);
        return { status: response.status, body: await response.json() };
    }
    async function browser() {
        const session = await request('/web/session', 'POST', undefined, { Origin: base, ...auth(adminToken) });
        assert.equal(session.status, 200);
        const Cookie = session.headers.getSetCookie().find(item => item.startsWith('repograph_session=')).split(';')[0];
        const csrf = (await json('/auth/csrf', 'GET', undefined, { Cookie })).body.token;
        return { Cookie, Origin: base, 'X-CSRF-Token': csrf };
    }
    const startInput = label => ({ client_id: 'repograph-cli', client_name: label });
    const exchange = device => json('/auth/device/token', 'POST', { client_id: 'repograph-cli', device_code: device,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    function editRequest(device, statement) {
        const db = new DatabaseSync(database);
        try { db.prepare(statement + ' WHERE device_hash = ?').run(digest(device)); }
        finally { db.close(); }
    }
    await start(true);
    const admin = await browser();
    assert.equal((await json('/capabilities', 'GET', undefined, admin)).body.features.deviceAuthorization, true);
    assert.equal((await json('/auth/device/start', 'POST', startInput('Foreign origin'), { Origin: 'https://foreign.example' })).status, 403);
    const pending = await json('/auth/device/start', 'POST', startInput('Local CLI'));
    assert.equal(pending.status, 200);
    const { user_code: code, device_code: device } = pending.body;
    assert.equal(pending.body.verification_uri, base + '/?authorizeDevice=1');
    assert.equal((await exchange(device)).body.error, 'slow_down');
    editRequest(device, 'UPDATE device_request SET next_at = 0');
    assert.equal((await exchange(device)).body.error, 'authorization_pending');
    assert.equal((await json('/auth/device/decision', 'POST', { code, approved: true }, auth(adminToken))).status, 403);
    assert.equal((await json('/auth/device/decision', 'POST', { code, approved: true }, { Cookie: admin.Cookie, Origin: base })).body.error,
        'INVALID_CSRF_TOKEN');
    const preview = await json('/auth/device/inspect', 'POST', { code: code.toLowerCase() }, admin);
    assert.equal(preview.body.clientName, 'Local CLI');
    assert.equal(preview.body.scope, 'knowledge.read');
    assert.ok(!JSON.stringify(preview.body).includes(device));
    assert.equal((await json('/auth/device/decision', 'POST', { code, approved: true }, admin)).body.status, 'approved');
    editRequest(device, 'UPDATE device_request SET next_at = 0');
    const simultaneous = await Promise.all([exchange(device), exchange(device)]);
    const granted = simultaneous.find(result => result.status === 200);
    assert.ok(granted);
    assert.equal(simultaneous.find(result => result !== granted).body.error, 'invalid_grant');
    const credential = auth(granted.body.access_token);
    assert.equal((await json('/projects', 'GET', undefined, credential)).status, 200);
    assert.equal((await json('/admin/accounts', 'GET', undefined, credential)).body.error, 'DEVICE_SCOPE_DENIED');
    assert.equal((await json('/spaces', 'POST', { name: 'Denied' }, credential)).body.error, 'DEVICE_SCOPE_DENIED');
    assert.equal((await json('/auth/device/credentials', 'GET', undefined, credential)).body.error, 'DEVICE_SCOPE_DENIED');
    assert.equal((await json('/web/session', 'POST', undefined, { ...credential, Origin: base })).status, 401);
    const mcpUrl = new URL('/mcp', base);
    const transportHeaders = { ...credential, Accept: 'text/event-stream' };
    assert.equal((await fetch(mcpUrl, { headers: { ...transportHeaders, Origin: 'https://foreign.example' } })).status, 403);
    assert.equal((await fetch(mcpUrl, { headers: { Cookie: admin.Cookie, ...transportHeaders, Authorization: 'Bearer ' + 'a'.repeat(32) } })).status, 401);
    assert.equal((await fetch(mcpUrl, { headers: transportHeaders })).status, 405);
    const mcp = new Client({ name: 'Device fixture', version: '1.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: credential } }));
    try {
        const discovered = (await mcp.listTools()).tools;
        assert.ok(discovered.some(tool => tool.name === 'search_knowledge'));
        assert.ok(discovered.some(tool => tool.name === 'list_projects'));
        assert.ok(discovered.every(tool => !['submit_wiki', 'generate_space_document', 'create_ask_session'].includes(tool.name)));
        const projects = await mcp.callTool({ name: 'list_projects', arguments: {} });
        assert.equal(projects.isError, false);
        assert.deepEqual(projects.structuredContent.body, (await json('/projects?summary=true', 'GET', undefined, credential)).body);
    } finally { await mcp.close(); }
    const list = await json('/auth/device/credentials', 'GET', undefined, admin);
    assert.equal(list.body[0].clientName, 'Local CLI');
    assert.doesNotMatch(JSON.stringify(list.body), /rgd_|device_code/);
    assert.deepEqual((await json('/auth/device/credentials/' + list.body[0].id, 'DELETE', undefined, admin)).body, { revoked: true });
    assert.equal((await json('/projects', 'GET', undefined, credential)).status, 401);
    assert.equal((await fetch(mcpUrl, { headers: transportHeaders })).status, 401);

    const denied = (await json('/auth/device/start', 'POST', startInput('Denied CLI'))).body;
    assert.equal((await json('/auth/device/decision', 'POST', { code: denied.user_code, approved: false }, admin)).body.status, 'denied');
    assert.equal((await exchange(denied.device_code)).body.error, 'access_denied');
    const expires = (await json('/auth/device/start', 'POST', startInput('Expiring CLI'))).body;
    editRequest(expires.device_code, 'UPDATE device_request SET expires_at = 0');
    assert.equal((await exchange(expires.device_code)).body.error, 'expired_token');
    const exhausted = (await json('/auth/device/start', 'POST', startInput('Retry budget fixture'))).body;
    editRequest(exhausted.device_code, 'UPDATE device_request SET polls = 72');
    assert.equal((await exchange(exhausted.device_code)).body.error, 'expired_token');

    const env = { ...process.env, REPOGRAPH_BASE_URL: base, REPOGRAPH_DEVICE_CREDENTIAL_DIR: directory,
        REPOGRAPH_ACCESS_TOKEN: undefined, REPOGRAPH_USERNAME: undefined, REPOGRAPH_PASSWORD: undefined };
    const cli = spawn(process.execPath, ['dist/cli.js', 'authorize_device', 'Saved CLI'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (cli.exitCode === null && cli.signalCode === null) cli.kill('SIGTERM'); });
    const cliDone = once(cli, 'exit');
    let stdout = '', stderr = '';
    cli.stderr.on('data', chunk => { stderr += chunk; });
    const prompted = new Promise((resolve, reject) => {
        cli.stdout.on('data', chunk => {
            stdout += chunk;
            const match = stdout.match(/Enter code ([A-Z0-9]{4}-[A-Z0-9]{4})/);
            if (match) resolve(match[1]);
        });
        cli.once('error', reject);
        cli.once('exit', code => { if (code) reject(new Error(stderr)); });
    });
    const cliCode = await prompted;
    assert.equal((await json('/auth/device/decision', 'POST', { code: cliCode, approved: true }, admin)).status, 200);
    assert.equal((await cliDone)[0], 0, stderr);
    assert.doesNotMatch(stdout, /rgd_/);
    const [saved] = (await readdir(directory)).map(file => join(directory, file));
    assert.equal((await stat(saved)).mode & 0o777, 0o600);
    const token = JSON.parse(await readFile(saved, 'utf8')).token;
    assert.equal((await json('/projects', 'GET', undefined, auth(token))).status, 200);
    const projects = await promisify(execFile)(process.execPath, ['dist/cli.js', 'projects'], { env });
    assert.deepEqual(JSON.parse(projects.stdout), []);
    await assert.rejects(promisify(execFile)(process.execPath, ['dist/cli.js', 'projects'], { env: { ...env, REPOGRAPH_BASE_URL: base.replace('127.0.0.1', 'localhost') } }),
        error => error.stderr.includes('CREDENTIALS_REQUIRED'));
    await stop();
    await start(true);
    assert.equal((await json('/projects', 'GET', undefined, auth(token))).status, 200);
    const checkpoint = new DatabaseSync(database);
    try { checkpoint.prepare("UPDATE enterprise_account SET credential_version = credential_version + 1 WHERE id = 'builtin-admin'").run(); }
    finally { checkpoint.close(); }
    assert.equal((await json('/projects', 'GET', undefined, auth(token))).status, 401);
    await stop();
    await start(false);
    assert.equal((await json('/capabilities', 'GET', undefined, auth(adminToken))).body.features.deviceAuthorization, false);
    assert.equal((await fetch(mcpUrl, { headers: auth(adminToken) })).status, 404);
    assert.equal((await json('/auth/device/start', 'POST', startInput('Device app disabled'))).status, 404);
});
