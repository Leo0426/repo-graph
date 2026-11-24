import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('quality reports reuse indexed calls, repository history and project permissions', { timeout: 20_000 }, async t => {
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'repograph-metrics-')));
    const root = join(tmp, 'inventory');
    await mkdir(root);
    const order = `package example.orders;
import example.stock.Inventory;
public class Order {
    public static int place(int qty) {
        // if (comment) case enum
        String ignored = "while (literal) && value ? yes : no";
        if (qty > 0 && qty < 10) return Inventory.find(qty);
        else if (qty < 0) return -qty;
        return 0;
    }
    public static int count(int qty) { return qty; }
    private void dormant() {}
}`;
    await writeFile(join(root, 'Order.java'), order);
    await writeFile(join(root, 'Inventory.java'), `package example.stock;
import example.orders.Order;
public class Inventory {
    public static int find(int qty) { return Order.count(qty); }
}`);
    await writeFile(join(root, 'OrderTest.java'), `package example.orders;
public class OrderTest {
    @Test public void placesOrder() { Order.place(1); }
}`);
    const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture',
        '-c', 'user.email=fixture@example.test', '-C', root, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    git('init', '-q');
    git('add', '--', '.');
    git('commit', '-qm', 'Inventory snapshot');
    await writeFile(join(root, 'Order.java'), order + '\n');
    git('add', '--', 'Order.java');
    git('commit', '-qm', 'Update formatting');

    const token = randomBytes(32).toString('hex');
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: { ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined,
            REPOGRAPH_PROJECTS_ROOT: tmp, REPOGRAPH_DB_PATH: join(tmp, 'index.db'), REPOGRAPH_ASSETS_ROOT: join(tmp, 'assets'),
            REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_PORT: '0' }, stdio: ['ignore', 'ignore', 'pipe']
    });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            await exited;
        }
        await rm(tmp, { recursive: true, force: true });
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
    async function request(path, parameters = {}, method = 'GET', authenticated = true) {
        const response = await fetch(base + '/api/v1' + path + '?' + new URLSearchParams(parameters), {
            method, headers: authenticated ? { Authorization: 'Bearer ' + token } : {}
        });
        const mime = response.headers.get('content-type');
        return { status: response.status, mime, body: mime.startsWith('application/json') ? await response.json() : await response.text() };
    }
    assert.equal((await request('/index/project', { projectRoot: root }, 'POST')).status, 202);
    let completed;
    for (let attempt = 0; attempt < 100; attempt++) {
        completed = (await request('/index/project/status', { projectRoot: root })).body;
        if (completed.status !== 'running') break;
        await delay(20);
    }
    assert.equal(completed.status, 'done');
    const [{ projectId }] = (await request('/projects')).body;
    const scoped = path => request(path, { projectId });
    assert.equal((await request('/metrics/report', { projectId }, 'GET', false)).status, 401);

    const complexity = await scoped('/metrics/complexity');
    assert.equal(complexity.status, 200);
    assert.deepEqual(complexity.body, [{ qualifiedName: 'example.orders.Order#place(int)', filePath: 'Order.java',
        startLine: 4, kind: 'METHOD', complexity: 4 }]);
    const cycles = (await scoped('/metrics/cycles')).body;
    assert.deepEqual(cycles, [{ packages: ['example.orders', 'example.stock'] }]);
    const coupling = (await scoped('/metrics/coupling')).body;
    const inventory = coupling.find(item => item.classQualifiedName === 'example.stock.Inventory');
    assert.deepEqual([inventory.fanIn, inventory.fanOut, inventory.instability], [1, 1, 0.5]);
    for (const path of ['/graph/deadcode', '/graph/testgaps']) {
        assert.deepEqual((await scoped(path)).body.map(unit => unit.qualifiedName), ['example.orders.Order#dormant()']);
    }
    const hotspots = (await scoped('/metrics/hotspots')).body;
    assert.deepEqual(hotspots, [{ filePath: 'Order.java', churnCount: 2, methodCount: 1,
        avgComplexity: 4, hotspotScore: 4.39 }]);

    const report = (await scoped('/metrics/report')).body;
    assert.equal(report.healthScore, 85);
    assert.equal(report.totalProductionMethods, 4);
    assert.equal(report.testGapCount, 1);
    assert.equal(report.deadCodeCount, 1);
    assert.equal(report.vulnHigh, 0);
    assert.ok(!report.omittedReasons.includes('VULNERABILITY_INVENTORY_UNAVAILABLE'));
    const dot = await scoped('/export/graph');
    assert.match(dot.mime, /^text\/plain/);
    assert.match(dot.body, /"example.orders" -> "example.stock" \[label="1"/);
    assert.match(dot.body, /"example.stock" -> "example.orders"/);
    const mermaid = await request('/export/graph', { projectId, format: 'mermaid' });
    assert.match(mermaid.body, /^graph LR/);
    assert.match(mermaid.body, /\["example\.orders"\]:::cyclic/);
    assert.equal((await request('/export/graph', { projectId, format: 'other' })).status, 400);

    const client = new Client({ name: 'quality-fixture', version: '1.0.0' });
    try {
        await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/mcp.js'], stderr: 'pipe',
            env: { REPOGRAPH_BASE_URL: base, REPOGRAPH_ACCESS_TOKEN: token } }));
        const result = await client.callTool({ name: 'get_health_report', arguments: { projectId } });
        assert.equal(result.isError, false);
        const { generatedAt: _, ...actual } = JSON.parse(result.content[0].text);
        const { generatedAt: _time, ...expected } = report;
        assert.deepEqual(actual, expected);
    } finally {
        await client.close();
    }
});
