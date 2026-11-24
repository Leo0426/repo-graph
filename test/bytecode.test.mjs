import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { zipSync } from 'fflate';

// javac --release 17 -g:lines,source. Inventory extends Base, implements Counted,
// calls Helper.convert(long) and has a lambda calling Helper.convert(int).
const classData = {
    'Base.class': 'yv66vgAAAD0ADQoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWBwAIAQAKcGFydHMvQmFzZQEABENvZGUBAA9MaW5lTnVtYmVyVGFibGUBAApTb3VyY2VGaWxlAQAOSW52ZW50b3J5LmphdmEAIAAHAAIAAAAAAAEAAAAFAAYAAQAJAAAAHQABAAEAAAAFKrcAAbEAAAABAAoAAAAGAAEAAAAMAAEACwAAAAIADA==',
    'Counted.class': 'yv66vgAAAD0ACQcAAgEADXBhcnRzL0NvdW50ZWQHAAQBABBqYXZhL2xhbmcvT2JqZWN0AQAFY291bnQBAAQoSilJAQAKU291cmNlRmlsZQEADkludmVudG9yeS5qYXZhBgAAAQADAAAAAAABBAEABQAGAAAAAQAHAAAAAgAI',
    'Helper.class': 'yv66vgAAAD0AEAoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWBwAIAQAMcGFydHMvSGVscGVyAQAEQ29kZQEAD0xpbmVOdW1iZXJUYWJsZQEAB2NvbnZlcnQBAAQoSilJAQAEKEkpSQEAClNvdXJjZUZpbGUBAA5JbnZlbnRvcnkuamF2YQAgAAcAAgAAAAAAAwAAAAUABgABAAkAAAAdAAEAAQAAAAUqtwABsQAAAAEACgAAAAYAAQAAAA4ACAALAAwAAQAJAAAAGwACAAIAAAADHoisAAAAAQAKAAAABgABAAAADwAIAAsADQABAAkAAAAaAAEAAQAAAAIarAAAAAEACgAAAAYAAQAAABAAAQAOAAAAAgAP',
    'Inventory$Nested.class': 'yv66vgAAAD0AEgoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWBwAIAQAWcGFydHMvSW52ZW50b3J5JE5lc3RlZAEABENvZGUBAA9MaW5lTnVtYmVyVGFibGUBAApTb3VyY2VGaWxlAQAOSW52ZW50b3J5LmphdmEBAAhOZXN0SG9zdAcADwEAD3BhcnRzL0ludmVudG9yeQEADElubmVyQ2xhc3NlcwEABk5lc3RlZAAhAAcAAgAAAAAAAQABAAUABgABAAkAAAAdAAEAAQAAAAUqtwABsQAAAAEACgAAAAYAAQAAAAoAAwALAAAAAgAMAA0AAAACAA4AEAAAAAoAAQAHAA4AEQAJ',
    'Inventory.class': 'yv66vgAAAD0AOwoAAgADBwAEDAAFAAYBAApwYXJ0cy9CYXNlAQAGPGluaXQ+AQADKClWCQAIAAkHAAoMAAsADAEAD3BhcnRzL0ludmVudG9yeQEABXZhbHVlAQABSQoADgAPBwAQDAARABIBAAxwYXJ0cy9IZWxwZXIBAAdjb252ZXJ0AQAEKEopSRIAAAAUDAAVABYBAANydW4BABYoKUxqYXZhL2xhbmcvUnVubmFibGU7CgAOABgMABEAGQEABChJKUkHABsBAA1wYXJ0cy9Db3VudGVkAQANQ29uc3RhbnRWYWx1ZQMAAAACAQAEQ29kZQEAD0xpbmVOdW1iZXJUYWJsZQEABWNvdW50AQAEdGFzawEADWxhbWJkYSR0YXNrJDABAApTb3VyY2VGaWxlAQAOSW52ZW50b3J5LmphdmEBAAtOZXN0TWVtYmVycwcAJwEAFnBhcnRzL0ludmVudG9yeSROZXN0ZWQBABBCb290c3RyYXBNZXRob2RzEAAGDwYAKwoACAAsDAAiAAYPBgAuCgAvADAHADEMADIAMwEAImphdmEvbGFuZy9pbnZva2UvTGFtYmRhTWV0YWZhY3RvcnkBAAttZXRhZmFjdG9yeQEAzChMamF2YS9sYW5nL2ludm9rZS9NZXRob2RIYW5kbGVzJExvb2t1cDtMamF2YS9sYW5nL1N0cmluZztMamF2YS9sYW5nL2ludm9rZS9NZXRob2RUeXBlO0xqYXZhL2xhbmcvaW52b2tlL01ldGhvZFR5cGU7TGphdmEvbGFuZy9pbnZva2UvTWV0aG9kSGFuZGxlO0xqYXZhL2xhbmcvaW52b2tlL01ldGhvZFR5cGU7KUxqYXZhL2xhbmcvaW52b2tlL0NhbGxTaXRlOwEADElubmVyQ2xhc3NlcwEABk5lc3RlZAcANwEAJWphdmEvbGFuZy9pbnZva2UvTWV0aG9kSGFuZGxlcyRMb29rdXAHADkBAB5qYXZhL2xhbmcvaW52b2tlL01ldGhvZEhhbmRsZXMBAAZMb29rdXAAIQAIAAIAAQAaAAEAEgALAAwAAQAcAAAAAgAdAAQAAQAFAAYAAQAeAAAAJgACAAEAAAAKKrcAASoFtQAHsQAAAAEAHwAAAAoAAgAAAAIABAADAAEAIAASAAEAHgAAAB8AAgADAAAABx+4AA0FYKwAAAABAB8AAAAGAAEAAAAFAAEAIQAWAAEAHgAAAB4AAQABAAAABroAEwAAsAAAAAEAHwAAAAYAAQAAAAgQCgAiAAYAAQAeAAAAHgABAAAAAAAGBLgAF1exAAAAAQAfAAAABgABAAAACAAEACMAAAACACQAJQAAAAQAAQAmACgAAAAMAAEALQADACkAKgApADQAAAASAAIAJgAIADUACQA2ADgAOgAZ'
};
const bytecode = name => Buffer.from(classData[name], 'base64');

async function workspace(t) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'repograph-bytecode-')));
    const token = randomBytes(24).toString('hex');
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: {
            ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined,
            REPOGRAPH_PROJECTS_ROOT: root, REPOGRAPH_DB_PATH: join(root, 'index.db'),
            REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_PORT: '0'
        }, stdio: ['ignore', 'ignore', 'pipe']
    });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            await exited;
        }
        await rm(root, { recursive: true, force: true });
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
    async function api(path, parameters = {}, method = 'GET') {
        const response = await fetch(`${base}/api/v1${path}?${new URLSearchParams(parameters)}`, {
            method, headers: { Authorization: 'Bearer ' + token }
        });
        return { status: response.status, body: response.status === 204 ? null : await response.json() };
    }
    async function reindex(projectRoot, lang) {
        const start = await api('/index/project', { projectRoot, ...(lang ? { lang } : {}) }, 'POST');
        assert.equal(start.status, 202, JSON.stringify(start.body));
        for (let attempt = 0; attempt < 100; attempt++) {
            const status = await api('/index/project/status', { projectRoot });
            assert.equal(status.status, 200);
            if (status.body.status !== 'running') return status.body;
            await delay(20);
        }
        assert.fail('Indexing did not reach a terminal state');
    }
    return { root, api, reindex, base, token };
}

test('bytecode indexing is opt-in and indexes build output with JVM method and line identities', { timeout: 10_000 }, async t => {
    const { root, api, reindex } = await workspace(t);
    const projectRoot = join(root, 'project');
    const folder = join(projectRoot, 'build', 'classes', 'java', 'main', 'parts');
    await mkdir(folder, { recursive: true });
    // This class does not need to be under a directory matching its declared package.
    const file = 'build/classes/java/main/parts/renamed.class';
    await writeFile(join(projectRoot, file), bytecode('Inventory.class'));
    assert.equal((await reindex(projectRoot)).totalFiles, 0);
    const indexed = await reindex(projectRoot, 'class');
    assert.equal(indexed.status, 'done', JSON.stringify(indexed));
    assert.equal(indexed.parsedFiles, 1);

    const projectId = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
    const target = 'parts.Inventory#count(long)';
    const result = await api('/symbol/' + encodeURIComponent(target), { projectId });
    assert.equal(result.status, 200);
    assert.equal(result.body.id, createHash('sha256').update(projectId + file + 'METHOD' + target).digest('hex'));
    assert.deepEqual([result.body.language, result.body.startLine, result.body.endLine], ['java', 5, 5]);
    assert.equal(result.body.metadata.bytecode, 'true');
    assert.equal(result.body.metadata.return_type, 'int');
    assert.equal((await api('/locate', { projectId, file, line: 5 })).body.id, result.body.id);

    await writeFile(join(folder, 'Helper.class'), bytecode('Helper.class'));
    assert.equal((await reindex(projectRoot, 'class')).skippedFiles, 1);
    const callees = await api('/graph/callees', { projectId, target });
    assert.deepEqual(callees.body.map(unit => unit.qualifiedName), ['parts.Helper#convert(long)']);
    await rm(join(folder, 'Helper.class'));
    assert.equal((await reindex(projectRoot, 'class')).status, 'done');
    assert.deepEqual((await api('/graph/callees', { projectId, target })).body, []);

    assert.equal((await api('/watch', { projectId, root: projectRoot }, 'POST')).body.status, 'watching');
    await writeFile(join(folder, 'Base.class'), bytecode('Base.class'));
    for (let attempt = 0; attempt < 75; attempt++) {
        if ((await api('/symbol/parts.Base', { projectId })).status === 200) break;
        await delay(30);
    }
    assert.equal((await api('/symbol/parts.Base', { projectId })).status, 200);
    assert.equal((await api('/watch/' + projectId, {}, 'DELETE')).status, 204);
});

test('JARs expose binary graph and archive-entry locations while retaining the last good index on failure', { timeout: 10_000 }, async t => {
    const { root, api, reindex, base, token } = await workspace(t);
    const projectRoot = join(root, 'jar-fixture');
    const file = 'inventory.jar';
    const path = join(projectRoot, file);
    await mkdir(projectRoot);
    const entries = Object.fromEntries(Object.keys(classData).map(name => ['parts/' + name, bytecode(name)]));
    entries['META-INF/versions/21/parts/Inventory.class'] = new Uint8Array([0, 1]);
    const jar = zipSync(entries);
    await writeFile(path, jar);
    assert.equal((await reindex(projectRoot)).totalFiles, 0);
    const indexed = await reindex(projectRoot, 'class');
    assert.equal(indexed.status, 'done', JSON.stringify(indexed));
    assert.equal(indexed.parsedFiles, 1);
    assert.ok(indexed.totalUnits >= 10, JSON.stringify(indexed));

    const projectId = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
    async function graph(kind, target) {
        const response = await api('/graph/' + kind, { projectId, target, depth: 1 });
        assert.equal(response.status, 200);
        return response.body.map(unit => unit.qualifiedName);
    }
    const target = 'parts.Inventory#count(long)';
    assert.deepEqual(await graph('callees', target), ['parts.Helper#convert(long)']);
    assert.deepEqual(await graph('callees', 'parts.Inventory#Inventory()'), ['parts.Base#Base()']);
    assert.deepEqual(await graph('callees', 'parts.Inventory#task()'), ['parts.Inventory#lambda$task$0()']);
    assert.deepEqual(await graph('callees', 'parts.Inventory#lambda$task$0()'), ['parts.Helper#convert(int)']);
    assert.deepEqual(await graph('subtypes', 'parts.Base'), ['parts.Inventory']);
    assert.deepEqual(await graph('subtypes', 'parts.Counted'), ['parts.Inventory']);
    const symbol = await api('/symbol/' + encodeURIComponent('parts.Inventory$Nested'), { projectId });
    assert.equal(symbol.body.parentQualifiedName, 'parts.Inventory');
    assert.equal(symbol.body.metadata.archive_entry, 'parts/Inventory$Nested.class');
    assert.equal(symbol.body.metadata.source_file, 'Inventory.java');
    assert.equal((await api('/locate', { projectId, file, line: 5 })).status, 404);
    const loc = { projectId, file, archiveEntry: 'parts/Inventory.class', line: 5 };
    assert.equal((await api('/locate', loc)).body.qualifiedName, target);
    const mcp = new Client({ name: 'bytecode-locate-test', version: '1.0.0' });
    try {
        await mcp.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/mcp.js'], stderr: 'pipe',
            env: { REPOGRAPH_BASE_URL: base, REPOGRAPH_ACCESS_TOKEN: token } }));
        const located = await mcp.callTool({ name: 'locate_at', arguments: loc });
        assert.equal(located.isError, false);
        assert.equal(JSON.parse(located.content[0].text).qualifiedName, target);
    } finally {
        await mcp.close();
    }
    assert.equal((await reindex(projectRoot, 'class')).skippedFiles, 1);

    await writeFile(path, zipSync({ ...entries, 'parts/Inventory.class': new Uint8Array([0, 1, 2]) }));
    const partial = await reindex(projectRoot, 'class');
    assert.equal(partial.status, 'partial');
    assert.deepEqual(partial.errors, ['inventory.jar: INVALID_CLASS_FILE']);
    assert.deepEqual(await graph('callees', target), ['parts.Helper#convert(long)']);
    await writeFile(path, jar);
    assert.equal((await reindex(projectRoot, 'class')).parsedFiles, 1);
    await rm(path);
    assert.equal((await reindex(projectRoot)).totalUnits, 0);
});
