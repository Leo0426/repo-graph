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

test('flow analysis reads project-scoped indexed source and keeps both definitions at a Java branch merge', { timeout: 15_000 }, async t => {
    const temporary = await realpath(await mkdtemp(join(tmpdir(), 'repograph-flow-')));
    const root = join(temporary, 'fixture');
    await mkdir(root);
    const java = [
        'package demo;',
        'class Calculator {',
        '  int baseline;',
        '  int adjust(int input) {',
        '    int current;',
        '    if (input > 0) {',
        '      current = this.baseline;',
        '    } else {',
        '      current = input;',
        '    }',
        '    for (int i = 0; i < 3; i++) {',
        '      if (i == 0) continue;',
        '      if (current > 20) break;',
        '      this.baseline += i;',
        '    }',
        '    return current;',
        '  }',
        '}'
    ].join('\n');
    await writeFile(join(root, 'Calculator.java'), java);
    await writeFile(join(root, 'MessageFormatter.java'), [
        'package demo;',
        'class MessageFormatter {',
        '  int calls;',
        '  @GetMapping("/format") String format(@RequestParam String value) {',
        '    String copied = value.trim();',
        '    return relay(0, copied);',
        '  }',
        '  String relay(int retry, String message) {',
        '    return MessageOutput.finish(message);',
        '  }',
        '  String finish(String message) {',
        '    calls++;',
        '    return message;',
        '  }',
        '  String finish(int count) { return "fixed"; }',
        '  String sameLine(String message) { finish(0); return finish(message); }',
        '  String repeated(String message) { return repeated(message); }',
        '}'
    ].join('\n'));
    await writeFile(join(root, 'MessageOutput.java'), [
        'package demo;',
        'public class MessageOutput {',
        '  static java.io.PrintWriter reporter;',
        '  public static String finish(String message) {',
        '    reporter.println(message);',
        '    String apiKey = "fixture-do-not-expose";',
        '    return message;',
        '  }',
        '  public static String finish(int count) { return "fixed"; }',
        '}'
    ].join('\n'));
    await writeFile(join(root, 'Paths.java'), [
        'package demo;',
        'class Paths {',
        '  int updates;',
        '  int choose(int n) {',
        '    try {',
        '      switch (n) {',
        '        case 0: return 0;',
        '        default: return n;',
        '      }',
        '    } finally {',
        '      this.updates++;',
        '    }',
        '  }',
        '}'
    ].join('\n'));
    await writeFile(join(root, 'bounded.c'), [
        'int bounded(int amount) {',
        '    int result = 0;',
        '    do {',
        '        result++;',
        '        if (result >= amount) break;',
        '    } while (result < 10);',
        '    return result;',
        '}'
    ].join('\n'));
    await writeFile(join(root, 'series.py'), [
        'class Series:',
        '    @staticmethod',
        '    def choose(values, fallback=0):',
        '        for item in values:',
        '            if item:',
        '                return item',
        '            elif fallback:',
        '                break',
        '        else:',
        '            return 10',
        '        return fallback'
    ].join('\n'));
    const token = randomBytes(32).toString('hex');
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: { ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined,
            REPOGRAPH_PROJECTS_ROOT: temporary, REPOGRAPH_DB_PATH: join(temporary, 'index.db'),
            REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_PORT: '0' },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            await exited;
        }
        await rm(temporary, { recursive: true, force: true });
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
    async function api(path, params, method = 'GET') {
        const response = await fetch(base + '/api/v1' + path + '?' + new URLSearchParams(params),
            { method, headers: { Authorization: 'Bearer ' + token } });
        return { status: response.status, body: await response.json() };
    }
    const projectId = createHash('sha256').update(root).digest('hex').slice(0, 12);
    assert.equal((await api('/index/project', { projectRoot: root }, 'POST')).status, 202);
    for (let i = 0; i < 100; i++) {
        const status = await api('/index/project/status', { projectRoot: root });
        if (status.body.status !== 'running') { assert.equal(status.body.status, 'done'); break; }
        await delay(20);
    }
    const target = 'demo.Calculator#adjust(int)';
    const response = await api('/flow/analyze', { projectId, target });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const result = response.body;
    assert.equal(result.target, target);
    assert.equal(result.language, 'java');
    assert.equal(result.precise, true);
    assert.deepEqual(result.summary, { parameters: ['input'], fieldReads: ['baseline'], fieldWrites: ['baseline'], returnSources: ['current'] });
    const { nodes, edges } = result.controlFlowGraph;
    const nodeAt = (line, kind) => nodes.find(node => node.line === line && node.kind === kind);
    const branches = nodeAt(6, 'CONDITION');
    const positive = nodeAt(7, 'STATEMENT');
    const negative = nodeAt(9, 'STATEMENT');
    const returned = nodeAt(16, 'RETURN');
    function hasEdge(list, from, to, kind, symbol = '') {
        return list.some(edge => edge.sourceId === from.id && edge.targetId === to.id && edge.kind === kind && edge.symbol === symbol);
    }
    assert.ok(hasEdge(edges, branches, positive, 'TRUE_BRANCH'));
    assert.ok(hasEdge(edges, branches, negative, 'FALSE_BRANCH'));
    assert.ok(edges.some(edge => edge.kind === 'LOOP_BACK'));
    const broken = nodes.find(node => /^break/.test(node.label));
    assert.ok(hasEdge(edges, broken, returned, 'NEXT'));
    const dependencies = result.programDependenceGraph.edges;
    for (const definition of [positive, negative]) assert.ok(hasEdge(dependencies, definition, returned, 'DATA_DEPENDENCY', 'current'));
    assert.ok(hasEdge(dependencies, branches, positive, 'CONTROL_DEPENDENCY'));
    assert.equal((await api('/flow/analyze', { projectId: '000000000000', target })).status, 404);
    assert.equal((await api('/flow/analyze', { projectId, target: 'demo.Calculator' })).status, 404);
    assert.deepEqual((await api('/flow/analyze', { projectId, target: result.unitId })).body, result);

    const finallyResult = (await api('/flow/analyze', { projectId, target: 'demo.Paths#choose(int)' })).body;
    const finalFlow = finallyResult.controlFlowGraph;
    assert.equal(finalFlow.edges.filter(edge => edge.kind === 'CASE_BRANCH').length, 2);
    for (const returned of finalFlow.nodes.filter(node => node.kind === 'RETURN')) {
        assert.ok(finalFlow.nodes.some(node => node.kind === 'FINALLY' && hasEdge(finalFlow.edges, returned, node, 'NEXT')));
    }

    const c = await api('/flow/analyze', { projectId, target: 'bounded' });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.precise, false);
    assert.equal(c.body.programDependenceGraph, null);
    assert.deepEqual(c.body.summary.parameters, ['amount']);
    assert.deepEqual(c.body.summary.returnSources, ['result']);
    assert.ok(c.body.controlFlowGraph.edges.some(edge => edge.kind === 'LOOP_BACK'));

    const python = await api('/flow/analyze', { projectId, target: 'Series#choose' });
    assert.equal(python.status, 200, JSON.stringify(python.body));
    assert.equal(python.body.programDependenceGraph, null);
    assert.deepEqual(python.body.summary.parameters, ['values', 'fallback']);
    const pyGraph = python.body.controlFlowGraph;
    const loop = pyGraph.nodes.find(node => node.line === 4 && node.kind === 'CONDITION');
    const otherwise = pyGraph.nodes.find(node => node.line === 10 && node.kind === 'RETURN');
    const after = pyGraph.nodes.find(node => node.line === 11 && node.kind === 'RETURN');
    const breakNode = pyGraph.nodes.find(node => node.line === 8 && node.label === 'break');
    assert.ok(hasEdge(pyGraph.edges, loop, otherwise, 'FALSE_BRANCH'));
    assert.ok(hasEdge(pyGraph.edges, breakNode, after, 'NEXT'));
    const source = 'demo.MessageFormatter#format(String)';
    const trace = await api('/flow/taint', { projectId, source });
    assert.equal(trace.status, 200, JSON.stringify(trace.body));
    assert.equal(trace.body.methodsAnalyzed, 3);
    assert.equal(trace.body.truncated, false);
    const output = trace.body.paths.find(path => path.reachesSink);
    assert.equal(output.sinkDescription, 'SINK:println.arg[0]');
    assert.deepEqual(output.hops.map(hop => [hop.methodQn, hop.from.index, hop.to.kind, hop.to.index, hop.line]), [
        [source, 0, 'CALL_ARG', 1, 6],
        ['demo.MessageFormatter#relay(int,String)', 1, 'CALL_ARG', 0, 9],
        ['demo.MessageOutput#finish(String)', 0, 'SINK', 0, 5]
    ]);
    assert.equal(output.hops.at(-1).filePath, 'MessageOutput.java');
    assert.ok(trace.body.paths.some(path => !path.reachesSink && path.hops.at(-1).to.kind === 'RETURN'));
    assert.ok(trace.body.limitations.includes('SINK_NAME_HEURISTIC'));
    const otherParameter = await api('/flow/taint', { projectId, source: 'demo.MessageFormatter#relay(int,String)', paramIndex: 0 });
    assert.deepEqual(otherParameter.body.paths, []);
    const depth = await api('/flow/taint', { projectId, source, maxDepth: 1 });
    assert.equal(depth.body.truncated, true);
    assert.equal(depth.body.methodsAnalyzed, 2);
    assert.ok(depth.body.paths.every(path => !path.reachesSink));
    const ambiguous = await api('/flow/taint', { projectId, source: 'demo.MessageFormatter#sameLine(String)' });
    assert.ok(ambiguous.body.limitations.includes('AMBIGUOUS_CALL_SITE'));
    assert.equal(ambiguous.body.methodsAnalyzed, 1);
    assert.ok(ambiguous.body.paths.every(path => !path.reachesSink));
    const loopTrace = await api('/flow/taint', { projectId, source: 'demo.MessageFormatter#repeated(String)' });
    assert.equal(loopTrace.body.methodsAnalyzed, 1);
    assert.equal(loopTrace.body.truncated, false);
    assert.equal((await api('/flow/taint', { projectId, source, paramIndex: 1 })).status, 400);
    assert.equal((await api('/flow/taint', { projectId: '000000000000', source })).status, 404);

    const scan = await api('/vulns/scan/taint', { projectId }, 'POST');
    assert.equal(scan.status, 200, JSON.stringify(scan.body));
    assert.deepEqual([scan.body.entryPoints, scan.body.matchedFindings, scan.body.newFindings, scan.body.truncated], [1, 1, 1, false]);
    const [finding] = (await api('/vulns', { projectId })).body;
    assert.equal(finding.ruleId, 'XSS_TAINT');
    assert.equal(finding.status, 'SUSPECTED');
    const findingPath = '/vulns/' + finding.id;
    const evidence = (await api(findingPath + '/taint-evidence', { projectId })).body;
    assert.deepEqual(evidence.map(step => [step.sequence, step.role, step.filePath]), [
        [1, 'SOURCE', 'MessageFormatter.java'], [2, 'PROPAGATION', 'MessageFormatter.java'],
        [3, 'PROPAGATION', 'MessageFormatter.java'], [4, 'SINK', 'MessageOutput.java']
    ]);
    assert.match(evidence[3].sourceExcerpt, /apiKey = "\*+"/);
    assert.doesNotMatch(JSON.stringify(evidence), /fixture-do-not-expose/);
    assert.equal((await api(findingPath + '/status', { projectId, status: 'DISMISSED', reason: 'Local diagnostic only' }, 'PUT')).status, 200);
    const repeated = await api('/vulns/scan/taint', { projectId }, 'POST');
    assert.equal(repeated.body.newFindings, 0);
    const detail = (await api(findingPath, { projectId })).body;
    assert.equal(detail.finding.status, 'DISMISSED');
    assert.equal(detail.audit.length, 2);
    assert.deepEqual(detail.evidence, evidence);
    const mcp = new Client({ name: 'flow-integration', version: '1.0.0' });
    try {
        await mcp.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/mcp.js'], stderr: 'pipe',
            env: { REPOGRAPH_BASE_URL: base, REPOGRAPH_ACCESS_TOKEN: token } }));
        const reply = await mcp.callTool({ name: 'analyze_flow', arguments: { target, projectId } });
        assert.equal(reply.isError, false);
        assert.deepEqual(JSON.parse(reply.content[0].text), result);
        const crossProcedure = await mcp.callTool({ name: 'trace_taint', arguments: { source, projectId } });
        assert.equal(crossProcedure.isError, false);
        assert.deepEqual(JSON.parse(crossProcedure.content[0].text), trace.body);
    } finally { await mcp.close(); }

    await writeFile(join(root, 'Calculator.java'), 'unindexed source change');
    assert.deepEqual((await api('/flow/analyze', { projectId, target })).body, result);
});
