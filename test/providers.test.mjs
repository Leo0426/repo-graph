import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('administrator provider drafts and connection tests preserve credential and selection boundaries', { timeout: 20_000 }, async t => {
    const tmp = await mkdtemp(join(tmpdir(), 'repograph-providers-'));
    const database = join(tmp, 'index.db');
    const accessToken = randomBytes(32).toString('hex');
    const apiKey = randomBytes(32).toString('hex');
    const received = [];
    let advisoryOutput = 'valid';
    let advisoryGate;
    let held = false, beginHold, releaseHold;
    const reviewStarted = new Promise(resolve => { beginHold = resolve; });
    const reviewReleased = new Promise(resolve => { releaseHold = resolve; });
    const fixture = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
        received.push({ path: req.url, method: req.method, headers: req.headers, input });
        if (req.url === '/redirect/models') return res.writeHead(302, { Location: '/unexpected' }).end();
        if (req.url === '/hang/chat/completions') return res.writeHead(200).write('{');
        if (req.url === '/v1/chat/completions' && input.messages.at(-1).content.startsWith('Review reported finding evidence.')) {
            if (advisoryGate) { advisoryGate.started(); await advisoryGate.released; }
            const citations = advisoryOutput === 'unsupported' ? ['UNREGISTERED_EVIDENCE'] : ['C1', 'C1', 'UNREGISTERED_EVIDENCE'];
            const invalidFinding = advisoryOutput === 'partial' && input.messages.at(-1).content.includes('fixture.fail-review');
            const content = advisoryOutput === 'invalid' || invalidFinding ? '{}' : JSON.stringify({
                suggestedVerdict: 'LIKELY_FALSE_POSITIVE', uncertainty: 0.25, citations,
                missingInfo: ['Credential template api_key="fixture-model-output-secret"']
            });
            return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
                choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 15 }
            }));
        }
        if (req.url === '/v1/chat/completions' && input.messages.at(-1).content.startsWith('Review indexed architecture facts.')) {
            if (held) { beginHold(); await reviewReleased; }
            const candidate = { priority: 1, title: 'Simplify stock dispatch', location: 'untrusted.ts', problem: 'Multiple decision branches',
                suggestion: 'Extract the shared decision logic', benefit: 'Easier to test', cost: 'Small', risk: 'Check behavior', methodology: 'U2',
                citations: ['ARCH-CC-1', 'ARCH-UNKNOWN'] };
            const content = JSON.stringify({ observations: ['Consider adding focused tests.'], candidates: [candidate], missingInfo: [] });
            return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
                choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 40 }
            }));
        }
        const body = req.url === '/api/tags' ? { models: [{ name: 'beta:latest' }, { name: 'alpha:latest' }, { name: 'alpha:latest' }] }
            : req.url === '/api/chat' ? { message: { content: 'OK' }, done_reason: 'stop', done: true }
                : req.url?.startsWith('/v1/models') ? { data: [{ id: 'external' }], has_more: false }
                    : req.url === '/v1/messages' ? { content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' }
                        : req.url === '/v1/chat/completions' ? { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] } : null;
        res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' }).end(JSON.stringify(body ?? { error: apiKey }));
    });
    fixture.listen(0, '127.0.0.1');
    await once(fixture, 'listening');
    const upstream = 'http://127.0.0.1:' + fixture.address().port;
    let child, base;
    async function start() {
        child = spawn(process.execPath, ['dist/server.js'], {
            env: { ...process.env, REPOGRAPH_PORT: '0', REPOGRAPH_PROJECTS_ROOT: tmp, REPOGRAPH_DB_PATH: database,
                REPOGRAPH_ASSETS_ROOT: join(tmp, 'assets'), REPOGRAPH_ACCESS_TOKEN: accessToken,
                REPOGRAPH_PROVIDER_ENCRYPTION_KEY: undefined, REPOGRAPH_EMBEDDING_MODEL: undefined,
                REPOGRAPH_ADMIN_PASSWORD: undefined }, stdio: ['ignore', 'ignore', 'pipe']
        });
        base = await new Promise((resolve, reject) => {
            let logs = '';
            child.once('error', reject);
            child.once('exit', code => reject(new Error('Server exited (' + code + '): ' + logs)));
            child.stderr.on('data', data => {
                logs += data;
                const address = logs.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
                if (address) resolve(address);
            });
        });
    }
    async function stop() {
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        const stopped = once(child, 'exit');
        child.kill('SIGTERM');
        await stopped;
    }
    t.after(async () => {
        advisoryGate?.release();
        releaseHold();
        await stop();
        fixture.closeAllConnections();
        await new Promise(resolve => fixture.close(resolve));
        await rm(tmp, { recursive: true, force: true });
    });
    const path = '/admin/model-providers';
    async function request(path, method = 'GET', input, auth = true) {
        const response = await fetch(base + '/api/v1' + path, { method,
            headers: { ...(auth ? { Authorization: 'Bearer ' + accessToken } : {}),
                ...(input ? { 'Content-Type': 'application/json' } : {}) },
            body: input ? JSON.stringify(input) : undefined });
        const body = await response.json();
        assert.ok(!JSON.stringify(body).includes(apiKey));
        return { status: response.status, body };
    }
    const config = { name: 'Internal test', protocol: 'OPENAI_COMPATIBLE', model: 'external', baseUrl: upstream + '/v1/',
        apiKey, enabled: true, timeoutMillis: 1000, maxOutputTokens: 256 };

    await start();
    assert.equal((await request(path, 'GET', undefined, false)).status, 401);
    const created = await request(path, 'POST', config);
    assert.equal(created.status, 201);
    assert.equal(created.body.apiKeyConfigured, true);
    assert.equal(created.body.baseUrl, upstream + '/v1');
    assert.equal(created.body.selected, false);
    const id = created.body.id;
    assert.equal((await request(path + '/' + id + '/select', 'POST')).body.selected, true);
    const beforeCapability = received.length;
    assert.deepEqual((await request('/capabilities/generation')).body, {
        configured: true, enabled: true, protocol: 'OPENAI_COMPATIBLE', name: 'Internal test', model: 'external',
        connectionStatus: 'NOT_CHECKED', generationStatus: 'NOT_VERIFIED'
    });
    assert.equal(received.length, beforeCapability);
    const trusted = await request(path + '/models', 'POST', { ...config, providerId: id, apiKey: '' });
    assert.deepEqual(trusted.body, { models: ['external'] });
    assert.equal(received.at(-1).headers.authorization, 'Bearer ' + apiKey);
    assert.equal((await request(path + '/models', 'POST', { ...config, providerId: id, apiKey: '', baseUrl: upstream + '/redirect' })).status, 400);
    assert.equal((await request(path + '/models', 'POST', { ...config, apiKey: '', baseUrl: upstream + '/redirect' })).status, 502);
    assert.ok(!received.some(item => item.path === '/unexpected'));
    assert.equal((await request(path + '/' + id, 'PUT', { ...config, apiKey: '', baseUrl: upstream + '/wrong' })).status, 400);
    assert.equal((await request(path + '/' + id, 'DELETE')).status, 409);
    assert.equal((await request(path + '/' + id + '/test', 'POST')).body.connected, true);
    assert.equal(received.at(-1).input.max_tokens, 128);

    for (const [protocol, baseUrl] of [['OLLAMA', upstream], ['OPENAI', upstream + '/v1'], ['ANTHROPIC', upstream + '/v1']]) {
        const profile = await request(path, 'POST', { ...config, apiKey: '', protocol, baseUrl, enabled: false });
        assert.equal(profile.status, 201);
        assert.equal((await request(path + '/' + profile.body.id + '/test', 'POST')).body.connected, true);
        const sent = received.at(-1);
        assert.equal(sent.input.stream, false);
        if (protocol === 'OLLAMA') {
            assert.equal(sent.input.options.num_predict, 128);
            assert.deepEqual((await request(path + '/models', 'POST', { ...config, apiKey: '', protocol, baseUrl })).body.models,
                ['alpha:latest', 'beta:latest']);
        } else if (protocol === 'OPENAI') assert.equal(sent.input.max_completion_tokens, 128);
        else assert.equal(sent.headers['anthropic-version'], '2023-06-01');
        assert.deepEqual((await request(path + '/' + profile.body.id, 'DELETE')).body, { deleted: true });
    }
    const stalled = await request(path, 'POST', { ...config, apiKey: '', baseUrl: upstream + '/hang' });
    assert.deepEqual((await request(path + '/' + stalled.body.id + '/test', 'POST')).body,
        { connected: false, message: 'PROVIDER_TIMEOUT' });
    await stop();
    assert.ok(!(await readFile(database)).includes(Buffer.from(apiKey)));
    assert.equal((await stat(database + '-provider-key')).mode & 0o777, 0o600);
    await start();
    assert.equal((await request(path)).body.find(profile => profile.id === id).selected, true);
    assert.equal((await request(path + '/' + id + '/test', 'POST')).body.connected, true);
    assert.equal(received.at(-1).headers.authorization, 'Bearer ' + apiKey);
    assert.deepEqual((await request('/admin/audit')).body.filter(event => event.targetId === id).map(event => event.action),
        ['PROVIDER_SELECTED', 'PROVIDER_CREATED']);

    const root = join(await realpath(tmp), 'repo');
    const file = join(root, 'stock.ts');
    await mkdir(root);
    await writeFile(file, 'export function dispatch(qty: number) { const token = "fixture-source-secret"; if (qty > 0) return qty; return 0; }');
    assert.equal((await request('/index/file?' + new URLSearchParams({ file, projectRoot: root }), 'POST')).status, 200);
    const [{ projectId }] = (await request('/projects')).body;
    const architecture = '/architecture/reviews';
    const project = '?' + new URLSearchParams({ projectId });
    const stream = await fetch(base + '/api/v1' + architecture + '/stream' + project, {
        headers: { Authorization: 'Bearer ' + accessToken } });
    assert.equal(stream.status, 200);
    const events = (await stream.text()).trim().split('\n\n').map(event => {
        const [name, data] = event.split('\n');
        return [name.slice(7), JSON.parse(data.slice(6))];
    });
    assert.deepEqual(events.map(([name]) => name), ['phase', 'delta', 'result', 'complete']);
    const reviewed = events[2][1];
    assert.equal(reviewed.status, 'COMPLETED');
    assert.equal(reviewed.candidates[0].location, 'stock.ts:1');
    assert.deepEqual(reviewed.candidates[0].citations, ['ARCH-CC-1']);
    assert.equal(reviewed.usage.costUsd, null);
    assert.ok(!received.at(-1).input.messages.at(-1).content.includes(root));
    assert.ok(!received.at(-1).input.messages.at(-1).content.includes('return qty'));

    const scan = { results: [{ check_id: 'fixture.review', path: 'stock.ts', start: { line: 1 },
        extra: { message: 'Review stock dispatch token="fixture-alert-secret"', lines: 'fixture-raw-tool-payload' } }] };
    const imported = await request('/triage/findings/import' + project + '&format=semgrep', 'POST', scan);
    assert.equal(imported.body.imported, 1);
    const [{ fingerprint }] = (await request('/triage/findings' + project)).body.findings;
    const baseline = (await request('/triage/findings/' + fingerprint + project)).body.report;
    const advisory = '/triage/advisory' + project;
    assert.equal((await request(advisory, 'POST', { fingerprint }, false)).status, 401);
    const assessment = await request(advisory, 'POST', { fingerprint, heuristicReport: { evidence: 'fixture-fabricated-evidence' } });
    assert.equal(assessment.status, 200);
    assert.equal(assessment.body.status, 'COMPLETED');
    assert.equal(assessment.body.advisoryOnly, true);
    assert.equal(assessment.body.suggestedVerdict, 'LIKELY_FALSE_POSITIVE');
    assert.equal(assessment.body.heuristicReport.verdict, 'NEEDS_REVIEW');
    assert.deepEqual(assessment.body.heuristicReport, baseline);
    assert.deepEqual(assessment.body.citations, ['C1']);
    assert.ok(assessment.body.missingInfo.includes('ADVISORY_UNKNOWN_CITATIONS'));
    assert.doesNotMatch(JSON.stringify(assessment.body), /fixture-model-output-secret|UNREGISTERED_EVIDENCE/);
    assert.deepEqual(assessment.body.usage, { inputTokens: 40, outputTokens: 15, costUsd: null });
    const prompt = received.at(-1).input.messages.at(-1).content;
    assert.match(prompt, /return qty/);
    assert.doesNotMatch(prompt, /fixture-(source-secret|alert-secret|raw-tool-payload|fabricated-evidence)/);
    assert.ok(!prompt.includes(root));
    const ephemeralScan = { results: [{ ...scan.results[0], check_id: 'fixture.preview-only' }] };
    const ephemeral = (await request(advisory + '&format=semgrep', 'POST', ephemeralScan)).body;
    assert.equal(ephemeral.status, 'COMPLETED');
    assert.equal(ephemeral.heuristicReport.finding.ruleId, 'fixture.preview-only');
    assert.equal((await request('/triage/findings/' + ephemeral.heuristicReport.finding.fingerprint + project)).status, 404);
    assert.equal((await request(advisory + '&format=semgrep', 'POST', { results: [...scan.results, ...ephemeralScan.results] })).status, 400);
    const frozen = await request('/review-queue/snapshots' + project, 'POST', { fingerprints: [fingerprint] });
    const frozenRoute = '/review-queue/snapshots/' + frozen.body.snapshotId + '/export' + project + '&format=json';
    const originalSnapshot = (await request(frozenRoute)).body;
    assert.deepEqual((await request(advisory, 'POST', { fingerprint, snapshotId: frozen.body.snapshotId })).body.heuristicReport,
        originalSnapshot.reports[0]);
    assert.deepEqual((await request(frozenRoute)).body, originalSnapshot);
    assert.deepEqual((await request('/vulns' + project)).body, []);
    advisoryOutput = 'unsupported';
    const unsupported = (await request(advisory, 'POST', { fingerprint })).body;
    assert.equal(unsupported.suggestedVerdict, null);
    assert.ok(unsupported.missingInfo.includes('ADVISORY_VERDICT_WITHOUT_EVIDENCE'));
    advisoryOutput = 'invalid';
    const invalid = (await request(advisory, 'POST', { fingerprint })).body;
    assert.equal(invalid.status, 'FAILED');
    assert.deepEqual(invalid.heuristicReport, baseline);
    assert.ok(invalid.missingInfo.includes('INVALID_ADVISORY_OUTPUT'));
    assert.equal((await request(path + '/' + stalled.body.id + '/select', 'POST')).status, 200);
    const timeout = (await request(advisory, 'POST', { fingerprint })).body;
    assert.equal(timeout.status, 'TIMED_OUT');
    assert.deepEqual(timeout.heuristicReport, baseline);
    assert.equal((await request(path + '/' + id + '/select', 'POST')).status, 200);

    const agentPath = '/agent-runs/sast-triage' + project;
    async function pollRun(id) {
        for (let attempt = 0; attempt < 150; attempt++) {
            const current = (await request('/agent-runs/' + id + project)).body;
            if (!['RUNNING', 'QUEUED'].includes(current.status)) return current;
            await new Promise(resolve => setTimeout(resolve, 15));
        }
        assert.fail('SAST triage did not reach a terminal state');
    }
    function holdAdvisory() {
        let started, release;
        const reached = new Promise(resolve => { started = resolve; });
        const released = new Promise(resolve => { release = resolve; });
        advisoryGate = { started, released, release };
        return reached;
    }
    const batchScan = { results: [...scan.results, { ...scan.results[0], check_id: 'fixture.fail-review' }] };
    advisoryOutput = 'partial';
    const reviewHeld = holdAdvisory();
    const startedAgent = await request(agentPath + '&format=semgrep', 'POST', batchScan);
    assert.equal(startedAgent.status, 202);
    await reviewHeld;
    const agentAddress = '/agent-runs/' + startedAgent.body.id;
    const running = (await request(agentAddress + project)).body;
    const runningStep = running.steps.at(-1);
    assert.deepEqual([running.status, runningStep.capability, runningStep.status, runningStep.finishedAt], ['RUNNING', 'LLM_ADVISORY', 'RUNNING', null]);
    assert.equal((await request(agentPath, 'POST', { fingerprints: [fingerprint] })).status, 409);
    assert.equal((await request(path + '/' + id, 'PUT', { ...config, apiKey: '', enabled: false })).status, 200);
    advisoryGate.release();
    advisoryGate = undefined;
    const reviewedAgent = await pollRun(startedAgent.body.id);
    assert.equal(reviewedAgent.status, 'PARTIAL');
    const finishedStep = reviewedAgent.steps.find(item => item.id === runningStep.id);
    assert.equal(finishedStep.status, 'PARTIAL');
    assert.ok(finishedStep.finishedAt);
    assert.ok(finishedStep.missingInfo.includes('INVALID_ADVISORY_OUTPUT'));
    const [advice] = finishedStep.results;
    assert.deepEqual([advice.baseline, advice.recommendation, advice.advisoryOnly, advice.citationIds], ['NEEDS_REVIEW', 'LIKELY_FALSE_POSITIVE', true, ['C1']]);
    assert.equal(advice.usage.costUsd, null);
    const agentSnapshot = '/review-queue/snapshots/' + reviewedAgent.outputReference.split(':')[1] + '/export' + project + '&format=json';
    assert.deepEqual((await request(agentSnapshot)).body.reports.map(report => report.verdict), ['NEEDS_REVIEW', 'NEEDS_REVIEW']);
    assert.deepEqual((await request('/vulns' + project)).body, []);
    assert.doesNotMatch(JSON.stringify(reviewedAgent), /fixture-(source-secret|alert-secret|raw-tool-payload|model-output-secret)/);
    assert.equal((await request(path + '/' + id, 'PUT', { ...config, apiKey: '' })).status, 200);

    advisoryOutput = 'valid';
    const cancelledHeld = holdAdvisory();
    const toCancel = await request(agentPath, 'POST', { fingerprints: [fingerprint] });
    assert.equal(toCancel.status, 202);
    await cancelledHeld;
    const cancelAddress = '/agent-runs/' + toCancel.body.id + '/cancel' + project;
    assert.equal((await request(cancelAddress, 'POST')).body.status, 'CANCELLED');
    advisoryGate.release();
    advisoryGate = undefined;
    const cancelled = await pollRun(toCancel.body.id);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.outputReference, null);
    assert.equal(cancelled.steps.at(-1).error, 'CANCELLED');
    assert.equal((await request(cancelAddress, 'POST')).body.status, 'CANCELLED');

    const calls = received.length;
    assert.equal((await request(path + '/' + id, 'PUT', { ...config, apiKey: '',
        inputUsdPerMillionTokens: 1_000_000, outputUsdPerMillionTokens: 1_000_000 })).status, 200);
    const tooExpensive = (await request(architecture + project, 'POST')).body;
    assert.equal(tooExpensive.status, 'FAILED');
    assert.ok(tooExpensive.missingInfo.includes('PROVIDER_COST_LIMIT'));
    const overBudget = (await request(advisory, 'POST', { fingerprint })).body;
    assert.equal(overBudget.status, 'BUDGET_EXCEEDED');
    assert.equal(overBudget.modelUsed, false);
    assert.deepEqual(overBudget.heuristicReport, baseline);
    assert.equal(received.length, calls);
    assert.equal((await request(path + '/' + id, 'PUT', { ...config, apiKey: '' })).status, 200);

    held = true;
    const inFlight = request(architecture + project, 'POST');
    await reviewStarted;
    assert.equal((await request(path + '/' + id, 'PUT', { ...config, enabled: false, apiKey: '', clearApiKey: true })).body.apiKeyConfigured, false);
    releaseHold();
    assert.equal((await inFlight).body.status, 'COMPLETED');
    assert.equal((await request('/capabilities/generation')).body.enabled, false);
    const fallback = (await request(architecture + project, 'POST')).body;
    assert.equal(fallback.status, 'DISABLED');
    assert.ok(fallback.evidence.some(item => item.citationId === 'ARCH-CC-1'));
    assert.deepEqual(fallback.candidates, []);
    const disabled = (await request(advisory, 'POST', { fingerprint })).body;
    assert.equal(disabled.status, 'DISABLED');
    assert.equal(disabled.modelUsed, false);
    assert.deepEqual(disabled.heuristicReport, baseline);
});
