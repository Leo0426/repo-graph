import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('external directory updates revoke sessions atomically and isolate tenants with matching names', { timeout: 15_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'repograph-external-identity-'));
    const token = randomBytes(24).toString('hex');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const verificationKey = join(root, 'authority.pem');
    const issuer = 'https://identity.example.test';
    const audience = 'repograph-fixture';
    await writeFile(verificationKey, publicKey.export({ format: 'pem', type: 'spki' }));
    const child = spawn(process.execPath, ['dist/server.js'], { env: {
        ...process.env, REPOGRAPH_PORT: '0', REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined,
        REPOGRAPH_PROJECTS_ROOT: root, REPOGRAPH_DB_PATH: join(root, 'index.db'), REPOGRAPH_ASSETS_ROOT: join(root, 'assets'),
        REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_EXTERNAL_ISSUER: issuer, REPOGRAPH_EXTERNAL_AUDIENCE: audience,
        REPOGRAPH_EXTERNAL_PUBLIC_KEY_FILE: verificationKey
    }, stdio: ['ignore', 'ignore', 'pipe'] });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            await exited;
        }
        await rm(root, { recursive: true, force: true });
    });
    const base = await new Promise((resolve, reject) => {
        let logs = '';
        child.once('error', reject);
        child.once('exit', code => reject(new Error('Server exited (' + code + '): ' + logs)));
        child.stderr.on('data', chunk => {
            logs += chunk;
            const address = logs.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
            if (address) resolve(address);
        });
    });
    const admin = { Authorization: 'Bearer ' + token };
    async function api(path, method = 'GET', body, headers = admin) {
        const response = await fetch(base + '/api/v1' + path, { method, headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers
        }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json(), headers: response.headers };
    }
    const now = Date.now();
    const directoryPath = tenant => '/admin/external-directory/' + tenant;
    const group = { id: 'operations', name: 'Warehouse', members: ['operator'] };
    const snapshot = { version: 1, issuedAt: now, validUntil: now + 60_000,
        accounts: [{ subject: 'operator', displayName: 'Warehouse operator', email: 'operator@example.test' }], organizations: [group] };
    const north = await api(directoryPath('north'), 'PUT', snapshot);
    assert.equal(north.status, 200, JSON.stringify(north.body));
    const south = await api(directoryPath('south'), 'PUT', snapshot);
    assert.equal(south.status, 200, JSON.stringify(south.body));
    assert.notEqual(north.body.accounts[0].id, south.body.accounts[0].id);
    assert.notEqual(north.body.organizations[0].id, south.body.organizations[0].id);
    assert.deepEqual((await api('/admin/organizations')).body.map(org => org.name), ['Warehouse', 'Warehouse']);

    const projects = [];
    for (const [index, tenant] of [north, south].entries()) {
        const project = join(root, 'repository-' + index);
        await mkdir(project);
        const source = join(project, 'store.ts');
        await writeFile(source, `export const stock${index} = ${index + 12};\n`);
        assert.equal((await api('/index/file?' + new URLSearchParams({ projectRoot: project, file: source }), 'POST')).status, 200);
        const projectId = (await api('/projects')).body.find(item => item.projectRoot.endsWith('/repository-' + index)).projectId;
        assert.equal((await api('/admin/projects/' + projectId + '/owner', 'PUT', { ownerType: 'ORGANIZATION', ownerId: tenant.body.organizations[0].id })).status, 200);
        projects.push(projectId);
    }
    const base64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    async function signIn(tenant, override = {}) {
        const challenge = await api('/auth/csrf', 'GET', undefined, {});
        const preflight = { Origin: base, Cookie: challenge.headers.getSetCookie()[0].split(';')[0], 'X-CSRF-Token': challenge.body.token };
        const issued = Math.floor(Date.now() / 1000);
        const payload = { iss: issuer, aud: audience, tenant, sub: 'operator', iat: issued, exp: issued + 60, jti: randomUUID(),
            nonce: challenge.body.token, ...override };
        const message = base64({ alg: 'Ed25519', typ: 'repograph-session+jwt' }) + '.' + base64(payload);
        const assertion = message + '.' + sign(null, Buffer.from(message), privateKey).toString('base64url');
        const result = await api('/auth/external-session', 'POST', { assertion }, preflight);
        return { result, preflight, assertion,
            cookie: result.headers.getSetCookie().find(cookie => cookie.startsWith('repograph_session='))?.split(';')[0] };
    }
    assert.equal((await signIn('north', { aud: 'other-audience' })).result.status, 401);
    const northern = await signIn('north');
    assert.equal(northern.result.status, 200, JSON.stringify(northern.result.body));
    assert.equal(northern.result.body.id, north.body.accounts[0].id);
    assert.equal((await api('/auth/external-session', 'POST', { assertion: northern.assertion }, northern.preflight)).status, 401);
    const user = { Cookie: northern.cookie };
    assert.deepEqual((await api('/projects', 'GET', undefined, user)).body.map(item => item.projectId), [projects[0]]);
    assert.equal((await api('/projects/' + projects[1] + '/stats', 'GET', undefined, user)).status, 403);
    assert.equal((await api('/admin/projects/' + projects[0] + '/owner', 'PUT', { ownerType: 'ORGANIZATION',
        ownerId: south.body.organizations[0].id })).body.error, 'PROJECT_TENANT_MISMATCH');
    const csrf = (await api('/auth/csrf', 'GET', undefined, user)).body.token;
    const writeAsNorth = { ...user, Origin: base, 'X-CSRF-Token': csrf };
    assert.equal((await api('/summaries/generate?projectId=' + projects[0], 'POST', undefined, writeAsNorth)).status, 403);
    const access = '/projects/' + projects[0] + '/access';
    const currentAccess = (await api(access)).body;
    assert.equal((await api(access, 'PUT', { accountId: south.body.accounts[0].id, role: 'EDITOR', revision: currentAccess.revision })).status, 400);
    assert.equal((await api(access, 'PUT', { accountId: north.body.accounts[0].id, role: 'EDITOR', revision: currentAccess.revision })).status, 200);
    assert.equal((await api('/summaries/generate?projectId=' + projects[0], 'POST', undefined, writeAsNorth)).status, 202);
    const space = await api('/spaces', 'POST', { name: 'North shift inventory' }, writeAsNorth);
    assert.equal(space.status, 201);
    const spacePath = '/spaces/' + space.body.id;
    assert.equal((await api(spacePath + '/repositories', 'POST', { projectId: projects[0], revision: 0 }, writeAsNorth)).status, 200);
    assert.equal((await api(spacePath + '/repositories', 'POST', { projectId: projects[1], revision: 1 })).body.error,
        'SPACE_REPOSITORY_TENANT_MISMATCH');
    assert.equal((await api(spacePath + '/members', 'PUT', { accountId: south.body.accounts[0].id, role: 'VIEWER', revision: 1 }, writeAsNorth)).status, 400);
    const southern = await signIn('south');
    const southUser = { Cookie: southern.cookie };
    assert.deepEqual((await api('/projects', 'GET', undefined, southUser)).body.map(item => item.projectId), [projects[1]]);
    assert.deepEqual((await api('/spaces', 'GET', undefined, southUser)).body, []);
    assert.equal((await api(spacePath, 'GET', undefined, southUser)).status, 404);
    const rejected = { ...snapshot, version: 2, organizations: [{ ...group, members: ['unconfirmed'] }] };
    assert.equal((await api(directoryPath('north'), 'PUT', rejected)).status, 400);
    assert.deepEqual((await api('/projects', 'GET', undefined, user)).body.map(item => item.projectId), [projects[0]]);
    const removed = await api(directoryPath('north'), 'PUT', { ...snapshot, version: 2, organizations: [{ ...group, members: [] }] });
    assert.equal(removed.status, 200);
    assert.equal((await api('/projects', 'GET', undefined, user)).status, 401);
    const replacement = await signIn('north');
    assert.equal(replacement.result.status, 200);
    assert.deepEqual((await api('/projects', 'GET', undefined, { Cookie: replacement.cookie })).body, []);
    assert.equal((await api(directoryPath('north'), 'PUT', snapshot)).body.error, 'EXTERNAL_DIRECTORY_OUT_OF_ORDER');
    const withoutMember = { ...snapshot, organizations: [{ ...group, members: [] }] };
    assert.equal((await api(directoryPath('north'), 'PUT', { ...withoutMember, version: 3, validUntil: now + 1 })).body.state, 'STALE');
    assert.equal((await signIn('north')).result.status, 401);
    assert.equal((await api(directoryPath('north'), 'PUT', { ...withoutMember, version: 4 })).body.state, 'ACTIVE');
    assert.equal((await api('/projects', 'GET', undefined, { Cookie: replacement.cookie })).status, 401);
    assert.deepEqual((await api('/projects', 'GET', undefined, southUser)).body.map(item => item.projectId), [projects[1]]);
});
