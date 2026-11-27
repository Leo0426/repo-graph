import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { localTimeWindowInput, localTimeWindowOpen } from '../dist/calendar-schedule.js';
import { GenerationGateway } from '../dist/generation.js';
import { DEFAULT_PROVIDER, ModelProviders } from '../dist/model-providers.js';
import { ModelUsage } from '../dist/model-usage.js';

test('model permits enforce live pool capacity and credential revocation across SQLite connections', async t => {
    const root = await mkdtemp(join(tmpdir(), 'repograph-model-pool-'));
    const database = join(root, 'state.db');
    const keyPath = join(root, 'model-key');
    const first = new DatabaseSync(database);
    const second = new DatabaseSync(database);
    t.after(async () => { first.close(); second.close(); await rm(root, { force: true, recursive: true }); });
    const directory = { owner: () => undefined, record: () => {} };
    const providers = new ModelProviders(first, directory, keyPath);
    const settings = { name: 'Fixture endpoint', protocol: 'OPENAI_COMPATIBLE', baseUrl: 'http://127.0.0.1:1/v1', model: 'fixture',
        enabled: true, maxOutputTokens: 800, timeoutMillis: 10_000, clearApiKey: false };
    providers.save('admin', DEFAULT_PROVIDER, { ...settings, apiKey: 'training-fixture-first', pool: { maxConcurrent: 2, reservedAsk: 1 } });
    const frozen = providers.freeze();
    const current = new ModelUsage(first, directory);
    const remote = new ModelUsage(second, directory);
    const gateway = new GenerationGateway(providers, current);
    const wiki = () => current.send(frozen.config, frozen.encryptedKey, { capability: 'WIKI' });
    const ask = () => remote.send(frozen.config, frozen.encryptedKey, { capability: 'ASK' });
    const firstAsk = ask();
    assert.ok(firstAsk.id);
    const background = wiki();
    assert.ok(background.id, 'Ask uses the reserved slot without reducing the background limit');
    assert.deepEqual(wiki(), { reason: 'PROVIDER_POOL_BUSY' });
    assert.deepEqual(ask(), { reason: 'PROVIDER_POOL_BUSY' });
    assert.equal(current.list(20, 0).records.length, 2);
    remote.settle(firstAsk.id, null, { inputTokens: 10, outputTokens: 3, costUsd: null });
    assert.deepEqual(wiki(), { reason: 'PROVIDER_POOL_BUSY' });
    const secondAsk = ask();
    assert.ok(secondAsk.id);
    remote.settle(secondAsk.id, 'PROVIDER_CANCELLED');
    first.prepare('UPDATE model_invocation SET deadline_at = 0 WHERE id = ?').run(background.id);
    const resumedBackground = wiki();
    assert.ok(resumedBackground.id);
    assert.equal(current.list(20, 0).records.find(row => row.id === background.id).status, 'UNKNOWN');

    const rotated = providers.save('admin', DEFAULT_PROVIDER, { ...settings, apiKey: 'training-fixture-next' });
    assert.deepEqual(rotated.pool, { maxConcurrent: 2, reservedAsk: 1 });
    const stale = gateway.resume(frozen).complete({ system: 'Fixture', user: 'No request should be sent.' });
    await assert.rejects(stale, { message: 'PROVIDER_ACCESS_CHANGED' });
    assert.deepEqual(ask(), { reason: 'PROVIDER_ACCESS_CHANGED' });
    current.settle(resumedBackground.id, null);
    const newCredentials = providers.freeze();
    const newest = remote.send(newCredentials.config, newCredentials.encryptedKey, { capability: 'WIKI' });
    assert.ok(newest.id);
    remote.settle(newest.id, null);
    const tomorrow = (new Date().getUTCDay() + 1) % 7;
    providers.save('admin', DEFAULT_PROVIDER, { ...settings, apiKey: '', pool: { maxConcurrent: 2, reservedAsk: 1,
        backgroundWindow: { timeZone: 'UTC', start: '00:00', end: '23:59', weekdays: [tomorrow] } } });
    assert.deepEqual(current.closedBackgroundPools(), [DEFAULT_PROVIDER]);
    assert.deepEqual(remote.send(newCredentials.config, newCredentials.encryptedKey, { capability: 'WIKI' }), { reason: 'PROVIDER_POOL_WINDOW_CLOSED' });
    assert.ok(remote.send(newCredentials.config, newCredentials.encryptedKey, { capability: 'ASK' }).id);
    assert.equal(remote.send(newCredentials.config, newCredentials.encryptedKey, { capability: 'FINDING_REVIEW' }).reason, 'PROVIDER_POOL_WINDOW_CLOSED');
    providers.save('admin', DEFAULT_PROVIDER, { ...settings, enabled: false, apiKey: '' });
    await assert.rejects(gateway.resume(newCredentials).complete({ system: 'Fixture', user: 'No request should be sent.' }),
        { message: 'PROVIDER_ACCESS_CHANGED' });
});

test('background model windows use local weekdays and continue through midnight', () => {
    const window = localTimeWindowInput.parse({ timeZone: 'Asia/Kolkata', weekdays: [1], start: '22:00', end: '02:00' });
    assert.equal(localTimeWindowOpen(window, Date.parse('2026-11-23T16:29:59Z')), false);
    assert.equal(localTimeWindowOpen(window, Date.parse('2026-11-23T16:30:00Z')), true);
    assert.equal(localTimeWindowOpen(window, Date.parse('2026-11-23T20:29:59Z')), true);
    assert.equal(localTimeWindowOpen(window, Date.parse('2026-11-23T20:30:00Z')), false);
    assert.equal(localTimeWindowOpen(window, Date.parse('2026-11-24T16:30:00Z')), false);
    const repeated = localTimeWindowInput.parse({ timeZone: 'America/New_York', weekdays: [0], start: '01:30', end: '03:00' });
    assert.equal(localTimeWindowOpen(repeated, Date.parse('2026-11-01T05:45:00Z')), true);
    assert.equal(localTimeWindowOpen(repeated, Date.parse('2026-11-01T06:45:00Z')), true);
    assert.equal(localTimeWindowInput.safeParse({ ...window, end: window.start }).success, false);
});

test('administrator provider drafts and connection tests preserve credential and selection boundaries', { timeout: 20_000 }, async t => {
    const tmp = await mkdtemp(join(tmpdir(), 'repograph-providers-'));
    const database = join(tmp, 'index.db');
    const accessToken = randomBytes(32).toString('hex');
    const apiKey = randomBytes(32).toString('hex');
    const received = [];
    let advisoryOutput = 'valid';
    let advisoryGate;
    let spaceGate;
    let held = false, beginHold, releaseHold;
    const reviewStarted = new Promise(resolve => { beginHold = resolve; });
    const reviewReleased = new Promise(resolve => { releaseHold = resolve; });
    const fixture = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
        received.push({ path: req.url, method: req.method, headers: req.headers, input });
        if (req.url === '/v1/chat/completions' && input.messages[0].content.startsWith('Write the complete Markdown document')) {
            if (spaceGate) { spaceGate.started(); await spaceGate.released; }
            const prompt = JSON.parse(input.messages.at(-1).content);
            const content = prompt.markdown ? '# Revised handoff\n\nPrepared from the authorized version.\n' : '# Generated handoff\n\nReady for handoff.\n';
            return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
                choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 34, completion_tokens: 18 }
            }));
        }
        if (req.url === '/redirect/models') return res.writeHead(302, { Location: '/unexpected' }).end();
        if (req.url === '/hang/chat/completions') return res.writeHead(200).write('{');
        if (req.url === '/v1/chat/completions' && input.messages.at(-1).content.startsWith('Review reported finding evidence.')) {
            if (advisoryGate && (!advisoryGate.contains || input.messages.at(-1).content.includes(advisoryGate.contains))) {
                advisoryGate.started(); await advisoryGate.released;
            }
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
    async function stop(signal = 'SIGTERM') {
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        const stopped = once(child, 'exit');
        child.kill(signal);
        await stopped;
    }
    t.after(async () => {
        advisoryGate?.release();
        spaceGate?.release();
        releaseHold();
        await stop();
        fixture.closeAllConnections();
        await new Promise(resolve => fixture.close(resolve));
        await rm(tmp, { recursive: true, force: true });
    });
    const path = '/admin/model-providers';
    async function request(path, method = 'GET', input, auth = true, headers = {}) {
        const response = await fetch(base + '/api/v1' + path, { method,
            headers: { ...(auth ? { Authorization: 'Bearer ' + accessToken } : {}),
                ...(input ? { 'Content-Type': 'application/json' } : {}), ...headers },
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
    const recorded = (await request('/admin/model-usage')).body.records[0];
    assert.deepEqual([recorded.capability, recorded.status, recorded.inputTokens, recorded.outputTokens, recorded.costUsd],
        ['FINDING_REVIEW', 'COMPLETED', 40, 15, null]);
    assert.doesNotMatch(JSON.stringify(recorded), /fixture-model-output-secret|fixture-source-secret|Review reported finding/);
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
    async function pollRun(id, limit = 150) {
        for (let attempt = 0; attempt < limit; attempt++) {
            const current = (await request('/agent-runs/' + id + project)).body;
            if (!['RUNNING', 'QUEUED'].includes(current.status)) return current;
            await new Promise(resolve => setTimeout(resolve, 15));
        }
        assert.fail('SAST triage did not reach a terminal state');
    }
    function holdAdvisory(contains) {
        let started, release;
        const reached = new Promise(resolve => { started = resolve; });
        const released = new Promise(resolve => { release = resolve; });
        advisoryGate = { started, released, release, contains };
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
    const sent = received.length;
    advisoryGate.release();
    advisoryGate = undefined;
    const reviewedAgent = await pollRun(startedAgent.body.id);
    assert.equal(reviewedAgent.status, 'PARTIAL');
    const finishedStep = reviewedAgent.steps.find(item => item.id === runningStep.id);
    assert.equal(finishedStep.status, 'PARTIAL');
    assert.ok(finishedStep.finishedAt);
    assert.ok(finishedStep.missingInfo.includes('PROVIDER_ACCESS_CHANGED'));
    assert.equal(received.length, sent);
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

    const recoveryHeld = holdAdvisory('fixture.interrupted');
    const recoveryInput = { results: ['fixture.retained', 'fixture.interrupted', 'fixture.remaining']
        .map(check_id => ({ ...scan.results[0], check_id })) };
    const recoveryRoute = agentPath + '&format=semgrep';
    const recoveryHeaders = { 'Idempotency-Key': 'recover-triage' };
    const recoveryRun = await request(recoveryRoute, 'POST', recoveryInput, true, recoveryHeaders);
    assert.equal(recoveryRun.status, 202);
    await recoveryHeld;
    const recoveryAddress = '/agent-runs/' + recoveryRun.body.id;
    const beforeCrash = (await request(recoveryAddress + project)).body.steps.find(step => step.capability === 'LLM_ADVISORY');
    assert.equal(beforeCrash.results.length, 1);
    await stop('SIGKILL');
    advisoryGate.release();
    advisoryGate = undefined;
    const originalSource = await readFile(file, 'utf8');
    await writeFile(file, 'export function dispatch(qty: number) { return 917; }');
    await start();
    const refresh = '/index/file?' + new URLSearchParams({ file, projectRoot: root });
    assert.equal((await request(refresh, 'POST')).status, 200);
    assert.equal((await request(recoveryRoute, 'POST', recoveryInput, true, recoveryHeaders)).body.id, recoveryRun.body.id);
    const afterCrash = await pollRun(recoveryRun.body.id, 430);
    assert.equal(afterCrash.status, 'PARTIAL');
    const recoveredStep = afterCrash.steps.find(step => step.capability === 'LLM_ADVISORY');
    assert.equal(recoveredStep.id, beforeCrash.id);
    assert.equal(recoveredStep.results.length, 2);
    assert.deepEqual(recoveredStep.results[0], beforeCrash.results[0]);
    assert.ok(recoveredStep.missingInfo.includes('ADVISORY_RESPONSE_UNCONFIRMED'));
    const attempts = (await request(recoveryAddress + '/execution/attempts' + project)).body;
    assert.deepEqual(attempts.map(attempt => attempt.outcome), ['LEASE_EXPIRED', 'FINISHED']);
    const frozenAfter = (await request('/review-queue/snapshots/' + afterCrash.outputReference.split(':')[1] + '/export' + project + '&format=json')).body;
    assert.ok(frozenAfter.reports.every(report => report.pack.evidence.some(evidence => /return qty/.test(evidence.excerpt))));
    assert.doesNotMatch(JSON.stringify(frozenAfter), /return 917/);
    assert.equal(received.filter(item => item.input?.messages?.at(-1).content?.includes('fixture.interrupted')).length, 1);
    await writeFile(file, originalSource);
    assert.equal((await request(refresh, 'POST')).status, 200);

    const calls = received.length;
    const lastInvocation = (await request('/admin/model-usage')).body.records[0].id;
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
    assert.equal((await request('/admin/model-usage')).body.records[0].id, lastInvocation);
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

    const space = await request('/spaces', 'POST', { name: 'Generated delivery' });
    assert.equal(space.status, 201);
    const spacePath = '/spaces/' + space.body.id;
    const generate = (input, auth = true) => request(spacePath + '/documents/generate', 'POST', input, auth);
    const firstGeneration = { target: { name: 'Handoff.md' }, instruction: 'Draft the handoff checklist.', key: 'space-document-create' };
    assert.equal((await generate(firstGeneration)).body.error, 'GENERATION_DISABLED');
    assert.equal((await generate(firstGeneration, false)).status, 401);
    assert.equal((await request(path + '/' + id, 'PUT', { ...config, apiKey: '' })).status, 200);
    const firstDocument = await generate(firstGeneration);
    assert.equal(firstDocument.status, 201);
    assert.match(firstDocument.body.markdown, /^# Generated handoff/);
    const firstVersion = firstDocument.body.version.id;
    const item = spacePath + '/documents/' + firstDocument.body.id;
    const callsAfterCreate = received.length;
    assert.deepEqual(await generate(firstGeneration), firstDocument);
    assert.equal((await generate({ ...firstGeneration, instruction: 'Use a changed instruction.' })).body.error, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal((await generate({ ...firstGeneration, key: 'taken-name' })).body.error, 'SPACE_ITEM_NAME_CONFLICT');
    assert.equal(received.length, callsAfterCreate);

    let started, release;
    const generationStarted = new Promise(resolve => { started = resolve; });
    const generationReleased = new Promise(resolve => { release = resolve; });
    spaceGate = { started, released: generationReleased, release };
    const editGeneration = { target: { itemId: firstDocument.body.id, baseVersionId: firstVersion },
        instruction: 'Revise this handoff.', key: 'space-document-edit' };
    const pending = generate(editGeneration);
    await generationStarted;
    assert.equal(JSON.parse(received.at(-1).input.messages.at(-1).content).markdown, firstDocument.body.markdown);
    assert.equal((await generate(editGeneration)).body.error, 'SPACE_GENERATION_IN_PROGRESS');
    const manual = await request(item, 'PUT', { key: 'manual-space-revision', baseVersionId: firstVersion, markdown: '# Manual revision\n' });
    assert.equal(manual.status, 200);
    release();
    spaceGate = undefined;
    assert.equal((await pending).body.error, 'DOCUMENT_VERSION_CHANGED');
    assert.equal((await generate(editGeneration)).body.error, 'DOCUMENT_VERSION_CHANGED');
    assert.deepEqual((await request(item)).body, manual.body);
    const secondGeneration = { ...editGeneration, target: { ...editGeneration.target, baseVersionId: manual.body.version.id }, key: 'space-generation-new-base' };
    const revised = await generate(secondGeneration);
    assert.equal(revised.status, 200);
    assert.equal(revised.body.version.ordinal, 3);
    assert.match(revised.body.markdown, /^# Revised handoff/);
    assert.equal((await request('/admin/model-usage')).body.records[0].capability, 'SPACE_DOCUMENT');
    const stableCalls = received.length;
    await stop();
    await start();
    const replayed = await generate(secondGeneration);
    assert.deepEqual(replayed, revised);
    assert.equal(received.length, stableCalls);
    assert.equal((await request(item + '/versions/' + firstVersion)).body.markdown, firstDocument.body.markdown);
    assert.deepEqual((await request(item + '/versions')).body.map(version => version.ordinal), [3, 2, 1]);
});
