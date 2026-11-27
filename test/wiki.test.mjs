import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

test('Wiki generation versions indexed module facts and retains old source citations', { timeout: 20_000 }, async t => {
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'repograph-wiki-')));
    const root = join(tmp, 'stockroom');
    await mkdir(join(root, 'stock'), { recursive: true });
    await mkdir(join(root, 'orders'));
    await writeFile(join(root, 'orders', 'order.ts'), 'import { count } from "../stock/item.js";\nexport function ship() { return count(); }\n');
    await writeFile(join(root, 'stock', 'item.ts'), 'export function count() { return 3; }\n');
    const token = randomBytes(32).toString('hex');
    let child, base;
    async function start() {
        child = spawn(process.execPath, ['dist/server.js'], {
            env: { ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined, REPOGRAPH_PORT: '0',
                REPOGRAPH_PROJECTS_ROOT: tmp, REPOGRAPH_DB_PATH: join(tmp, 'index.db'), REPOGRAPH_ASSETS_ROOT: join(tmp, 'assets'),
                REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_SNAPSHOT_RETENTION_SECONDS: '1', REPOGRAPH_PROJECT_RETENTION_SECONDS: '0' }, stdio: ['ignore', 'ignore', 'pipe']
        });
        base = await new Promise((resolve, reject) => {
            let logs = '';
            child.once('error', reject);
            child.once('exit', code => reject(new Error('Server exited (' + code + '): ' + logs)));
            child.stderr.on('data', chunk => {
                logs += chunk;
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
    t.after(async () => { await stop(); await rm(tmp, { recursive: true, force: true }); });

    async function request(path, query = {}, method = 'GET', authenticated = true, input, extraHeaders = {}) {
        const response = await fetch(base + '/api/v1' + path + '?' + new URLSearchParams(query), {
            method, headers: { ...(authenticated ? { Authorization: 'Bearer ' + token } : {}),
                ...(input ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }, body: input ? JSON.stringify(input) : undefined
        });
        return { status: response.status, body: await response.json(), requestId: response.headers.get('x-request-id') };
    }
    async function openResult(link) {
        const response = await fetch(base + link, { redirect: 'manual', headers: { Authorization: 'Bearer ' + token } });
        return { status: response.status, location: new URL(response.headers.get('location') ?? '/', base).searchParams };
    }
    const knowledge = (query, scopes) => request('/search/knowledge', {}, 'POST', true, { query, scopes, method: 'keyword' });
    async function until(path, query, terminal) {
        for (let attempt = 0; attempt < 300; attempt++) {
            const result = await request(path, query);
            assert.equal(result.status, 200);
            if (!terminal.includes(result.body.status)) return result.body;
            await delay(30);
        }
        assert.fail('Job did not reach a terminal status');
    }
    async function index() {
        assert.equal((await request('/index/project', { projectRoot: root }, 'POST')).status, 202);
        assert.equal((await until('/index/project/status', { projectRoot: root }, ['idle', 'running'])).status, 'done');
    }

    await start();
    await index();
    const [{ projectId }] = (await request('/projects')).body;
    async function generate(id = projectId) {
        const accepted = await request('/summaries/generate', { projectId: id }, 'POST');
        assert.equal(accepted.status, 202);
        assert.equal(accepted.body.pollVia, '/api/v1/agent-runs/' + accepted.body.agentRunId);
        return until(accepted.body.pollVia.slice('/api/v1'.length), {}, ['QUEUED', 'RUNNING']);
    }
    assert.deepEqual((await request('/summaries', { projectId })).body, []);
    const run = await generate();
    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.playbook, 'WIKI_SUMMARY');
    assert.deepEqual(run.steps.map(step => [step.capability, step.status]),
        [['FACTS', 'COMPLETED'], ['LLM_ARCH', 'SKIPPED'], ['LLM_BUSINESS', 'SKIPPED'], ['PERSIST', 'COMPLETED']]);
    assert.equal((await request('/agent-runs/' + run.id, {}, 'GET', false)).status, 401);
    const tree = (await request('/summaries/tree', { projectId })).body;
    assert.deepEqual(tree.map(node => [node.path, node.level, node.docVersion]), [['project', 'project', 1], ['package/orders', 'package', 1], ['package/stock', 'package', 1]]);
    const [, orders, stock] = (await request('/summaries', { projectId })).body;
    const business = await request('/summaries', { projectId, perspective: 'business' });
    assert.equal(business.status, 200);
    const businessOrders = business.body.find(document => document.scopeId === 'orders');
    assert.equal(businessOrders.title, orders.title);
    assert.notEqual(businessOrders.id, orders.id);
    assert.equal(businessOrders.knowledgeSnapshotId, orders.knowledgeSnapshotId);
    assert.ok(businessOrders.sections.some(section => section.title === 'Observed workflow'));
    assert.ok(orders.sections.every(section => section.source === 'facts'));
    assert.ok(orders.sections.some(section => section.body.includes('stock')));
    assert.deepEqual(stock.citations[0], { qualifiedName: 'count', filePath: 'stock/item.ts', startLine: 1, endLine: 1 });
    assert.match(stock.knowledgeSnapshotId, /^[a-f0-9-]{36}$/);
    const manifestPath = '/knowledge-snapshots/' + stock.knowledgeSnapshotId + '/manifest';
    const manifest = await request(manifestPath);
    assert.equal(manifest.body.status, 'VERIFIED');
    assert.equal(manifest.body.profile.wikiTemplateVersion, 2);
    assert.equal(manifest.body.coverage.files, 2);
    assert.deepEqual(manifest.body.pages.filter(page => page.scopeId === 'orders').map(page => [page.id, page.perspective]),
        [[orders.id, 'technical'], [businessOrders.id, 'business']]);
    assert.deepEqual((await request('/summaries/' + stock.id)).body, stock);
    assert.equal((await request('/summaries/' + stock.id, { projectId: '000000000000' })).status, 404);

    await rm(join(root, 'stock', 'item.ts'));
    await writeFile(join(root, 'orders', 'order.ts'), 'export function ship() { return 5; }\n');
    await index();
    await generate();
    await stop();
    const originalDatabase = new DatabaseSync(join(tmp, 'index.db'));
    try {
        originalDatabase.exec(`
            BEGIN IMMEDIATE;
            CREATE TABLE wiki_document_previous (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                run_id TEXT NOT NULL REFERENCES wiki_generation(run_id) ON DELETE CASCADE, level TEXT NOT NULL,
                scope_id TEXT NOT NULL, doc_version INTEGER NOT NULL, payload TEXT NOT NULL,
                UNIQUE(project_id, level, scope_id, doc_version)
            );
            INSERT INTO wiki_document_previous SELECT * FROM wiki_document WHERE coalesce(json_extract(payload,'$.perspective'),'technical') = 'technical';
            DROP TABLE wiki_page_search_entry;
            DROP TABLE wiki_page_terms;
            DROP TABLE wiki_page_revision;
            DROP TABLE wiki_page_draft;
            DROP TABLE wiki_page_write;
            DROP TABLE wiki_page_export;
            DROP TABLE knowledge_receipt;
            DROP TABLE wiki_document;
            ALTER TABLE wiki_document_previous RENAME TO wiki_document;
            COMMIT;
        `);
    } finally { originalDatabase.close(); }
    await start();
    assert.deepEqual((await request('/summaries/tree', { projectId })).body.map(node => [node.path, node.docVersion]),
        [['project', 2], ['package/orders', 2]]);
    assert.deepEqual((await request('/summaries/' + stock.id)).body, stock);
    assert.deepEqual((await request(manifestPath)).body, { status: 'LEGACY_UNRECORDED', snapshotId: stock.knowledgeSnapshotId });
    const frozenFile = await request('/knowledge-snapshots/' + stock.knowledgeSnapshotId + '/source', { file: 'stock/item.ts' });
    assert.equal(frozenFile.status, 200);
    assert.equal(frozenFile.body.text, 'export function count() { return 3; }\n');
    assert.equal((await request('/knowledge-snapshots/' + stock.knowledgeSnapshotId + '/source',
        { file: 'stock/item.ts', projectId: '000000000000' })).status, 404);
    const frozen = { projectId, snapshotId: stock.knowledgeSnapshotId };
    const latest = (await request('/summaries', { projectId })).body[0];
    const published = await request('/knowledge-snapshots', { projectId });
    assert.equal(published.status, 200);
    const releases = published.body;
    assert.deepEqual(releases.map(item => item.id), [latest.knowledgeSnapshotId, stock.knowledgeSnapshotId]);
    assert.notEqual(releases[0].sourceVersion, releases[1].sourceVersion);
    assert.equal(releases[0].parentSnapshotId, stock.knowledgeSnapshotId);
    assert.equal(releases[0].mode, 'incremental');
    const changes = await request('/knowledge-snapshots/' + latest.knowledgeSnapshotId + '/changes');
    assert.equal(changes.status, 200);
    assert.deepEqual(changes.body.changes.map(change => [change.kind, change.path]),
        [['MODIFIED', 'orders/order.ts'], ['DELETED', 'stock/item.ts']]);
    assert.deepEqual((await request('/summaries/tree', frozen)).body, tree);
    const located = await request('/locate', { ...frozen, file: 'stock/item.ts', line: '1', symbol: 'count' });
    assert.equal(located.status, 200);
    assert.match(located.body.rawSource, /return 3/);
    const frozenGraph = await request('/graph/callees', { ...frozen, target: 'ship', diagram: 'true' });
    assert.equal(frozenGraph.status, 200);
    assert.deepEqual(frozenGraph.body.results.map(unit => unit.qualifiedName), ['count']);
    assert.deepEqual((await request('/graph/callees', { projectId, target: 'ship' })).body, []);
    const frozenSearch = await request('/search/keyword', { ...frozen, q: 'count' });
    assert.equal(frozenSearch.status, 200);
    assert.ok(frozenSearch.body.some(hit => hit.snapshotId === stock.knowledgeSnapshotId && hit.unit.qualifiedName === 'count'));
    assert.deepEqual((await request('/search/keyword', { projectId, q: 'count' })).body, []);
    const archivedPack = await request('/context/pack', { ...frozen, q: 'ship' });
    assert.equal(archivedPack.status, 200);
    assert.ok(archivedPack.body.omittedReasons.includes('SNAPSHOT_VECTOR_INDEX_UNAVAILABLE'));
    assert.equal(archivedPack.body.snapshotId, stock.knowledgeSnapshotId);
    const calledEvidence = archivedPack.body.evidence.find(item => item.qualifiedName === 'count');
    assert.equal(calledEvidence.snapshotId, stock.knowledgeSnapshotId);
    assert.equal(calledEvidence.relation, 'CALLEE');
    assert.match(calledEvidence.excerpt, /return 3/);
    const spacePaths = [];
    for (const name of ['Inventory', 'Orders']) {
        const created = await request('/spaces', {}, 'POST', true, { name });
        assert.equal(created.status, 201);
        const path = '/spaces/' + created.body.id;
        const link = await request(path + '/repositories', {}, 'POST', true, { ...frozen, revision: created.body.revision });
        assert.equal(link.status, 200);
        spacePaths.push({ id: created.body.id, path, revision: link.body.revision });
    }
    const searchAcross = { query: 'ship', method: 'hybrid', limit: 20,
        scopes: [...spacePaths.map(space => ({ projectId, spaceId: space.id })), { projectId }] };
    const across = await request('/search/scoped', {}, 'POST', true, searchAcross);
    assert.equal(across.status, 200);
    assert.equal(across.body.coverage.length, 2);
    const oldCount = across.body.results.filter(item => item.unit.qualifiedName === 'count');
    assert.equal(oldCount.length, 1);
    assert.equal(oldCount[0].snapshotId, stock.knowledgeSnapshotId);
    assert.deepEqual(oldCount[0].spaceIds, spacePaths.map(space => space.id).sort());
    assert.deepEqual(new Set(across.body.results.filter(item => item.unit.qualifiedName === 'ship').map(item => item.snapshotId)),
        new Set([latest.knowledgeSnapshotId, stock.knowledgeSnapshotId]));
    const unpublishedRoot = join(tmp, 'unpublished');
    await mkdir(unpublishedRoot);
    await writeFile(join(unpublishedRoot, 'ship.ts'), 'export function ship() { return "live index only"; }');
    assert.equal((await request('/index/project', { projectRoot: unpublishedRoot }, 'POST')).status, 202);
    assert.equal((await until('/index/project/status', { projectRoot: unpublishedRoot }, ['idle', 'running'])).status, 'done');
    const projects = (await request('/projects')).body;
    const unpublished = { projectId: projects.find(item => item.projectName === 'unpublished').projectId };
    const incomplete = await request('/search/scoped', {}, 'POST', true, { ...searchAcross, scopes: [{ projectId }, unpublished] });
    assert.equal(incomplete.status, 200);
    assert.equal(incomplete.body.status, 'PARTIAL');
    assert.deepEqual(incomplete.body.coverage.map(item => item.status), ['MATCHED', 'INDEX_UNAVAILABLE']);
    assert.ok(incomplete.body.results.every(item => item.projectId === projectId));
    assert.equal((await request('/search/scoped', {}, 'POST', true, { ...searchAcross, scopes: [unpublished] })).status, 503);
    assert.equal((await request('/search/scoped', {}, 'POST', true, { ...searchAcross, scopes: Array(9).fill({ projectId }) })).status, 400);
    const linked = await knowledge('ship', spacePaths.map(space => ({ kind: 'space', spaceId: space.id })));
    assert.equal(linked.status, 200);
    const linkedShip = linked.body.results.filter(hit => hit.kind === 'SOURCE' && hit.title === 'ship');
    assert.equal(linkedShip.length, 1);
    assert.deepEqual(linkedShip[0].spaceIds, spacePaths.map(space => space.id).sort());
    assert.equal(linkedShip[0].direct, false);
    assert.equal((await openResult(linkedShip[0].link)).location.get('snapshotId'), frozen.snapshotId);
    const throughFirstSpace = await knowledge('ship', [{ kind: 'space', spaceId: spacePaths[0].id }]);
    const indirectLink = throughFirstSpace.body.results.find(hit => hit.kind === 'SOURCE').link;
    assert.equal((await openResult(indirectLink)).status, 303);
    const detach = await request(spacePaths[0].path + '/repositories/' + projectId, { revision: String(spacePaths[0].revision) }, 'DELETE');
    assert.equal(detach.status, 200);
    assert.equal((await request('/search/scoped', {}, 'POST', true, searchAcross)).status, 404);
    assert.equal((await openResult(indirectLink)).status, 404);
    assert.equal((await knowledge('ship', [{ kind: 'repository', ...frozen, spaceId: spacePaths[0].id }])).status, 404);
    assert.deepEqual((await request(spacePaths[0].path + '/repositories/detached')).body, [frozen]);
    const restoreLink = await request(spacePaths[0].path + '/repositories/' + projectId + '/restore', {}, 'POST', true, { revision: detach.body.revision });
    assert.equal(restoreLink.status, 200);
    assert.deepEqual((await request(spacePaths[0].path)).body.repositories, [frozen]);
    assert.equal((await openResult(indirectLink)).location.get('snapshotId'), frozen.snapshotId);
    assert.equal((await request(spacePaths[0].path + '/repositories/' + projectId,
        { revision: String(restoreLink.body.revision) }, 'DELETE')).status, 200);
    assert.deepEqual((await request('/agent-runs/' + run.id)).body, run);

    const phases = [];
    const technicalPhases = ['overview', 'modules', 'entrypoints', 'build', 'security'];
    const businessPhases = ['business-capabilities', 'business-workflows', 'business-gaps'];
    const allPhases = [...technicalPhases, ...businessPhases];
    let proposalCalls = 0;
    let malformed = true;
    let beforeInterruption;
    let windowGate;
    const originalKey = randomBytes(18).toString('hex');
    const fixture = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const prompt = JSON.parse(body.messages.at(-1).content);
        if (prompt.instruction) {
            proposalCalls++;
            response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
                message: { content: 'ModelProposalMarker' }, done_reason: 'stop'
            }));
            return;
        }
        phases.push({ phase: prompt.phase, model: body.model, prompt: JSON.stringify(prompt),
            originalCredential: request.headers.authorization === 'Bearer ' + originalKey });
        if (prompt.phase === 'business-workflows' && beforeInterruption) { beforeInterruption(); return; }
        if (prompt.phase === 'overview' && windowGate) {
            const pending = windowGate;
            windowGate = undefined;
            pending.started.resolve();
            await pending.release.promise;
        }
        const cite = prompt.citations[0]?.id;
        const text = prompt.phase === 'build' && malformed ? 'malformed' : JSON.stringify({
            body: 'Verified section for ' + prompt.phase + (prompt.phase === 'business-workflows' ? '\nBusinessJourneyMarker' : ''),
            citations: prompt.phase === 'business-workflows' && malformed ? ['fabricated']
                : [...(cite ? [cite] : []), ...(prompt.phase === 'overview' ? ['fabricated'] : [])]
        });
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: { content: text }, done_reason: 'stop' }));
    });
    fixture.listen(0, '127.0.0.1');
    await once(fixture, 'listening');
    t.after(() => { fixture.closeAllConnections(); return new Promise(resolve => fixture.close(resolve)); });
    const providerPath = '/admin/model-providers/legacy-ollama';
    const config = { name: 'Fixture', protocol: 'OLLAMA', model: 'fixture-a', enabled: true,
        baseUrl: 'http://127.0.0.1:' + fixture.address().port, timeoutMillis: 1500, maxOutputTokens: 1400 };
    assert.equal((await request(providerPath, {}, 'PUT', true, config)).status, 200);
    const partial = await generate();
    assert.equal(partial.status, 'PARTIAL');
    assert.equal(partial.steps.find(step => step.capability === 'LLM_ARCH:build').status, 'FAILED');
    assert.equal(partial.steps.find(step => step.capability === 'LLM_BUSINESS:business-workflows').error, 'WIKI_BUSINESS_CITATIONS_REQUIRED');
    const [earlier] = (await request('/summaries', { projectId })).body;
    assert.equal(earlier.status, 'PARTIAL');
    assert.equal(earlier.sections.filter(section => section.source === 'llm').length, 4);
    assert.equal(earlier.sections.filter(section => section.source === 'facts').length, 4);
    assert.deepEqual(earlier.citations.map(item => [item.qualifiedName, item.filePath, item.startLine]), [['ship', 'orders/order.ts', 1]]);
    assert.ok(!JSON.stringify(earlier).includes('fabricated'));
    assert.ok(phases.every(call => !call.prompt.includes(root) && !call.prompt.includes('return 5')));
    assert.deepEqual(phases.map(call => call.phase), allPhases);
    assert.ok(phases.filter(call => call.phase.startsWith('business-')).every(call => !call.prompt.includes('Complexity hotspots')));
    const [earlierBusiness] = (await request('/summaries', { projectId, perspective: 'business' })).body;
    assert.equal(earlierBusiness.status, 'PARTIAL');
    assert.deepEqual(earlierBusiness.sections.filter(section => section.source === 'llm').map(section => section.phase),
        ['business-capabilities', 'business-gaps']);
    assert.ok(!JSON.stringify(earlierBusiness).includes('BusinessJourneyMarker'));

    await stop();
    await start();
    malformed = false;
    const resumed = await generate();
    assert.equal(resumed.status, 'COMPLETED');
    assert.deepEqual(phases.slice(allPhases.length).map(call => call.phase), ['build', 'business-workflows']);
    const [full] = (await request('/summaries', { projectId })).body;
    assert.equal(full.docVersion, earlier.docVersion + 1);
    assert.equal(full.sections.filter(section => section.source === 'llm').length, 5);
    assert.equal(full.factsHash, earlier.factsHash);
    assert.deepEqual((await request('/summaries/' + earlier.id)).body, earlier);
    const businessView = { projectId, perspective: 'business', snapshotId: full.knowledgeSnapshotId, q: 'BusinessJourneyMarker' };
    const businessMatches = (await request('/summaries/search', businessView)).body;
    assert.equal(businessMatches[0].level, 'PROJECT');
    assert.deepEqual((await request('/summaries/search', { ...businessView, perspective: 'technical' })).body, []);
    const businessDownload = await fetch(base + '/api/v1/summaries/' + businessMatches[0].id + '/export?' + new URLSearchParams(businessView),
        { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(businessDownload.status, 200);
    assert.match(await businessDownload.text(), /BusinessJourneyMarker/);

    assert.equal((await request(providerPath, {}, 'PUT', true, { ...config, model: 'fixture-b' })).status, 200);
    const beforeProviderChange = phases.length;
    await generate();
    assert.deepEqual(phases.slice(beforeProviderChange).map(call => call.phase), allPhases);
    assert.ok(phases.slice(beforeProviderChange).every(call => call.model === 'fixture-b'));
    const beforeSourceChange = phases.length;
    await writeFile(join(root, 'orders', 'order.ts'), 'export function updatedShip() { return 6; }\n');
    await index();
    await generate();
    const [updated] = (await request('/summaries', { projectId })).body;
    assert.notEqual(updated.factsHash, full.factsHash);
    const afterSourceChange = phases.slice(beforeSourceChange).map(call => call.phase);
    assert.ok(afterSourceChange.includes('modules') && afterSourceChange.includes('business-workflows'));
    assert.ok(!afterSourceChange.includes('build'));
    assert.ok(updated.citations.some(citation => citation.qualifiedName === 'updatedShip'));

    assert.equal((await request(providerPath, {}, 'PUT', true, { ...config, model: 'fixture-interrupted', apiKey: originalKey })).status, 200);
    const submitting = new Promise(resolve => { beforeInterruption = resolve; });
    const accepted = await request('/summaries/generate', { projectId }, 'POST');
    assert.equal(accepted.status, 202);
    await submitting;
    const running = (await request('/agent-runs/' + accepted.body.agentRunId)).body;
    const candidate = running.inputReference.split(':')[1];
    assert.equal((await request('/knowledge-snapshots/' + candidate)).status, 404);
    assert.equal((await request('/knowledge-snapshots', { projectId })).body[0].id, updated.knowledgeSnapshotId);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    beforeInterruption = undefined;
    const pastCalls = phases.length;
    await start();
    await writeFile(join(root, 'orders', 'order.ts'), 'export function laterShip() { return 7; }\n');
    await index();
    assert.equal((await request(providerPath, {}, 'PUT', true, { ...config, model: 'fixture-after-restart' })).status, 200);
    const recovered = await until('/agent-runs/' + accepted.body.agentRunId, {}, ['QUEUED', 'RUNNING']);
    assert.equal(recovered.id, accepted.body.agentRunId);
    assert.equal(recovered.status, 'COMPLETED');
    assert.equal(recovered.steps.filter(step => step.capability === 'LLM_ARCH:overview').length, 1);
    assert.deepEqual(phases.slice(pastCalls).map(call => call.phase), ['business-workflows', 'business-gaps']);
    assert.equal(recovered.steps.filter(step => step.capability === 'LLM_BUSINESS:business-capabilities').length, 1);
    assert.ok(phases.slice(pastCalls).every(call => call.model === 'fixture-interrupted' && call.originalCredential));
    const [recoveredDoc] = (await request('/summaries', { projectId })).body;
    assert.equal(recoveredDoc.knowledgeSnapshotId, candidate);
    assert.ok(recoveredDoc.citations.some(citation => citation.qualifiedName === 'updatedShip'));
    const execution = (await request('/agent-runs/' + recovered.id + '/execution')).body;
    assert.equal(execution.attempt, 2);
    assert.ok(!JSON.stringify(execution).includes(originalKey) && !JSON.stringify(recovered).includes(originalKey));

    const scheduled = { projectId, notBefore: new Date(Date.now() + 60_000).toISOString() };
    const headers = { 'Idempotency-Key': 'delayed-test' };
    const delayed = await request('/summaries/generate', scheduled, 'POST', true, undefined, headers);
    assert.equal(delayed.status, 202);
    const diagnosticRequest = await request('/admin/diagnostics/requests/' + delayed.requestId);
    assert.equal(diagnosticRequest.body.runId, delayed.body.agentRunId);
    const diagnosticRun = '/admin/diagnostics/runs/' + delayed.body.agentRunId;
    assert.equal((await request(diagnosticRun)).body.queueState, 'QUEUED');
    const activity = (await request('/admin/diagnostics')).body.activity;
    assert.ok(activity.requests.accepted > 0);
    assert.ok(activity.queue.some(item => item.kind === 'WIKI_SUMMARY' && item.state === 'QUEUED' && item.count === 1));
    assert.deepEqual((await request('/summaries/generate', scheduled, 'POST', true, undefined, headers)).body, delayed.body);
    assert.equal((await request('/summaries/generate', { projectId }, 'POST', true, undefined, headers)).status, 409);
    const jobEndpoint = '/agent-runs/' + delayed.body.agentRunId + '/execution';
    const queued = await request(jobEndpoint);
    assert.equal(queued.body.state, 'QUEUED');
    assert.equal(queued.body.attempt, 0);
    const paused = await request(jobEndpoint, {}, 'POST', true, { action: 'pause', revision: queued.body.revision });
    assert.equal(paused.body.state, 'PAUSED');
    assert.equal((await request(jobEndpoint, {}, 'POST', true, { action: 'resume', revision: queued.body.revision })).status, 409);
    const rescheduled = await request(jobEndpoint, {}, 'POST', true, { action: 'resume', revision: paused.body.revision, priority: 1 });
    assert.equal(rescheduled.body.availableAt, queued.body.availableAt);
    assert.equal(rescheduled.body.priority, 1);
    assert.equal((await request(jobEndpoint, {}, 'POST', true, { action: 'cancel', revision: rescheduled.body.revision })).body.state, 'CANCELLED');
    assert.equal((await request('/agent-runs/' + delayed.body.agentRunId)).body.status, 'CANCELLED');
    assert.equal((await request(diagnosticRun)).body.status, 'CANCELLED');
    assert.deepEqual((await request(jobEndpoint + '/attempts')).body, []);
    const attempts = await request('/agent-runs/' + resumed.id + '/execution/attempts');
    assert.equal(attempts.body.at(-1).outcome, 'FINISHED');
    assert.match(attempts.body.at(-1).resultHash, /^[a-f0-9]{64}$/);
    assert.ok(attempts.body.at(-1).startedAt >= attempts.body.at(-1).claimedAt);
    assert.equal(Object.hasOwn(attempts.body.at(-1), 'leaseId'), false);
    assert.equal((await request('/knowledge-snapshots', { projectId })).body[0].id, candidate);

    await rm(join(root, 'orders', 'order.ts'));
    await writeFile(join(root, 'orders', 'moved.ts'), 'export function updatedShip() { return 6; }\n');
    await index();
    await generate();
    const [moved] = (await request('/knowledge-snapshots', { projectId })).body;
    const movedInput = await request('/knowledge-snapshots/' + moved.id + '/changes');
    assert.deepEqual(movedInput.body.changes,
        [{ kind: 'MOVED', path: 'orders/moved.ts', previousPath: 'orders/order.ts' }]);
    assert.equal((await request('/knowledge-snapshots/' + moved.id + '/source', { file: 'orders/order.ts' })).status, 404);

    const beforeFull = phases.length;
    const rebuilt = await request('/summaries/generate', { projectId, mode: 'full' }, 'POST');
    assert.equal(rebuilt.status, 202);
    assert.equal((await until('/agent-runs/' + rebuilt.body.agentRunId, {}, ['QUEUED', 'RUNNING'])).status, 'COMPLETED');
    const [fullSnapshot] = (await request('/knowledge-snapshots', { projectId })).body;
    assert.equal(fullSnapshot.mode, 'full');
    assert.equal(fullSnapshot.parentSnapshotId, null);
    assert.deepEqual(phases.slice(beforeFull).map(call => call.phase), allPhases);
    const fullReceipt = (await request('/knowledge-snapshots/' + fullSnapshot.id + '/manifest')).body;
    assert.equal(fullReceipt.status, 'VERIFIED');
    assert.equal(fullReceipt.profile.model.name, 'fixture-after-restart');
    assert.deepEqual(fullReceipt.profile.modelPlan, { maxOutputTokensPerCall: 1200, estimatedCostLimitUsd: 0.05, publicationReserveMs: 5000,
        tracks: [{ perspective: 'technical', phases: technicalPhases }, { perspective: 'business', phases: businessPhases }] });
    assert.deepEqual(fullReceipt.pages.find(page => page.perspective === 'business' && page.level === 'PROJECT').modelPhases, businessPhases);
    assert.deepEqual(fullReceipt.pages.find(page => page.perspective === 'technical' && page.level === 'PROJECT').modelPhases, technicalPhases);
    assert.ok(!JSON.stringify(fullReceipt).includes(originalKey));

    const view = { projectId, snapshotId: fullSnapshot.id, perspective: 'business' };
    const activeBusiness = (await request('/summaries', view)).body.find(document => document.scopeId === 'orders');
    assert.ok(activeBusiness);
    const page = '/summaries/' + activeBusiness.id;
    const originalRevision = activeBusiness.revision.id;
    assert.equal(originalRevision, activeBusiness.id);
    const edited = '\ufeff# Operations\r\n\r\n## 中文交付记录\r\n- 盘点行已校验\r\n\r\n' + 'ReleaseReviewMarker For handoff only.\r\n'.repeat(220);
    const [save, collision] = await Promise.all(['edit-1', 'edit-2'].map(key => request(page + '/revisions', view, 'POST', true,
        { baseRevisionId: originalRevision, markdown: edited }, { 'Idempotency-Key': key })));
    const edits = [save, collision];
    assert.deepEqual(edits.map(item => item.status).sort(), [201, 409]);
    const winningKey = 'edit-' + (edits.findIndex(item => item.status === 201) + 1);
    const saved = edits.find(item => item.status === 201).body;
    assert.equal(saved.markdown, edited);
    assert.equal(saved.revision.number, 2);
    assert.equal(saved.knowledgeSnapshotId, activeBusiness.knowledgeSnapshotId);
    assert.equal(saved.id, activeBusiness.id);
    assert.deepEqual((await request(page + '/revisions', view, 'POST', true,
        { baseRevisionId: originalRevision, markdown: edited }, { 'Idempotency-Key': winningKey })).body, saved);
    assert.equal((await request(page + '/revisions', view, 'POST', true, { baseRevisionId: saved.revision.id, markdown: 'Cannot publish bad citations',
        citations: [{ qualifiedName: 'invented', filePath: 'missing', startLine: 1, endLine: 1 }] }, { 'Idempotency-Key': 'bad-citation' })).status, 409);
    const queryView = { ...view, q: 'ReleaseReviewMarker' };
    assert.equal((await request('/summaries/search', queryView)).body[0].revision.id, saved.revision.id);
    assert.deepEqual((await request('/summaries/search', { ...queryView, perspective: 'technical' })).body, []);
    const exportPath = base + '/api/v1' + page + '/export?' + new URLSearchParams({ ...view, revisionId: saved.revision.id });
    for (let pass = 0; pass < 2; pass++) {
        const exported = await fetch(exportPath, { headers: { Authorization: 'Bearer ' + token } });
        assert.equal(exported.status, 200);
        assert.deepEqual(Buffer.from(await exported.arrayBuffer()), Buffer.from(edited));
    }
    const staleDraft = await request(page + '/drafts', view, 'POST', true,
        { baseRevisionId: saved.revision.id, markdown: 'PendingOnlyMarker' }, { 'Idempotency-Key': 'stale-draft' });
    assert.equal(staleDraft.status, 201);
    assert.deepEqual((await request('/summaries/search', { ...view, q: 'PendingOnlyMarker' })).body, []);
    const empty = await request(page + '/revisions', view, 'POST', true,
        { baseRevisionId: saved.revision.id, markdown: '' }, { 'Idempotency-Key': 'clear-page' });
    assert.equal(empty.status, 201);
    assert.deepEqual((await request('/summaries/search', queryView)).body, []);
    const stalePath = page + '/drafts/' + staleDraft.body.id;
    assert.equal((await request(stalePath + '/apply', view, 'POST', true, {}, { 'Idempotency-Key': 'apply-stale' })).status, 409);
    assert.equal((await request(stalePath + '/discard', view, 'POST', true, {}, { 'Idempotency-Key': 'discard-stale' })).body.state, 'DISCARDED');
    const acceptedDraft = await request(page + '/drafts', view, 'POST', true,
        { baseRevisionId: empty.body.revision.id, markdown: 'ApprovedWorkflowMarker' }, { 'Idempotency-Key': 'new-draft' });
    const acceptedPath = page + '/drafts/' + acceptedDraft.body.id;
    const comparison = await request(acceptedPath, view);
    assert.equal(comparison.body.baseMarkdown, '');
    assert.equal(comparison.body.markdown, 'ApprovedWorkflowMarker');
    const applied = await request(acceptedPath + '/apply', view, 'POST', true, {}, { 'Idempotency-Key': 'apply-draft' });
    assert.equal(applied.body.state, 'APPLIED');
    assert.equal((await request('/summaries/search', { ...view, q: 'ApprovedWorkflowMarker' })).body[0].revision.id, applied.body.appliedRevisionId);
    const space = spacePaths[1];
    const document = await request(space.path + '/documents', {}, 'POST', true,
        { name: 'Handoff.md', markdown: '# Handoff\n\nHistoryNeedle is in revision one.\n', key: 'handoff-v1' });
    assert.equal(document.status, 201);
    const docPath = space.path + '/documents/' + document.body.id;
    assert.equal((await request(docPath, {}, 'PUT', true,
        { markdown: '# Current handoff\n', baseVersionId: document.body.versionId, key: 'handoff-v2' })).status, 200);
    const scopes = [{ kind: 'repository', ...frozen }, { kind: 'wiki', projectId, snapshotId: fullSnapshot.id, pageId: activeBusiness.id,
        revisionId: saved.revision.id }, { kind: 'document', spaceId: space.id, documentId: document.body.id, versionId: document.body.versionId }];
    const unified = await knowledge('ship ReleaseReviewMarker HistoryNeedle', scopes);
    assert.equal(unified.status, 200);
    assert.equal(unified.body.status, 'COMPLETE');
    assert.deepEqual(new Set(unified.body.results.map(hit => hit.kind)), new Set(['SOURCE', 'WIKI', 'DOCUMENT']));
    const sourceHit = unified.body.results.find(hit => hit.kind === 'SOURCE' && hit.title === 'ship');
    assert.equal(sourceHit.filePath, 'orders/order.ts');
    const sourceOpen = await openResult(sourceHit.link);
    assert.equal(sourceOpen.status, 303);
    assert.equal(sourceOpen.location.get('snapshotId'), frozen.snapshotId);
    assert.equal(sourceOpen.location.get('line'), String(sourceHit.startLine));
    const wikiHit = unified.body.results.find(hit => hit.kind === 'WIKI' && hit.revisionId === saved.revision.id);
    assert.equal(wikiHit.perspective, 'business');
    assert.match(wikiHit.excerpt, /ReleaseReviewMarker/);
    const wikiOpen = await openResult(wikiHit.link);
    assert.equal(wikiOpen.status, 303);
    assert.equal(wikiOpen.location.get('revisionId'), saved.revision.id);
    assert.equal(wikiOpen.location.get('section'), String(wikiHit.section));
    const docHit = unified.body.results.find(hit => hit.kind === 'DOCUMENT');
    assert.equal(docHit.versionId, document.body.versionId);
    assert.match(docHit.excerpt, /HistoryNeedle/);
    const docOpen = await openResult(docHit.link);
    assert.equal(docOpen.status, 303);
    assert.equal(docOpen.location.get('revision'), document.body.versionId);
    assert.equal((await knowledge('HistoryNeedle', [{ kind: 'space', spaceId: space.id }])).body.results.length, 0);
    const none = await knowledge('NoSuchMarker987', [scopes[2]]);
    assert.equal(none.body.status, 'COMPLETE');
    assert.equal(none.body.coverage[0].status, 'NO_MATCHES');
    const noIndex = { kind: 'repository', ...unpublished };
    const partialKnowledge = await knowledge('HistoryNeedle', [scopes[2], noIndex]);
    assert.equal(partialKnowledge.body.status, 'PARTIAL');
    assert.ok(partialKnowledge.body.coverage.some(item => item.status === 'INDEX_UNAVAILABLE'));
    assert.equal((await knowledge('ship', [noIndex])).status, 503);
    assert.equal((await knowledge('ship', Array(9).fill(scopes[0]))).status, 400);
    assert.equal((await knowledge('HistoryNeedle', [{ ...scopes[2], versionId: saved.revision.id }])).status, 404);
    const restored = await request(page + '/revisions/' + saved.revision.id + '/restore', view, 'POST', true,
        { baseRevisionId: applied.body.appliedRevisionId }, { 'Idempotency-Key': 'restore-edit' });
    assert.equal(restored.body.markdown, edited);
    assert.equal(restored.body.revision.origin, 'RESTORE');
    assert.equal(restored.body.revision.number, 5);
    assert.deepEqual((await request(page + '/revisions', view)).body.revisions.map(revision => revision.number), [5, 4, 3, 2, 1]);
    assert.equal((await request(page + '/revisions/' + originalRevision, { ...view, perspective: 'technical' })).status, 404);

    const proposed = await request(page + '/drafts/generate', view, 'POST', true,
        { baseRevisionId: restored.body.revision.id, instruction: 'Summarize the workflow' }, { 'Idempotency-Key': 'generate-draft' });
    assert.equal(proposed.status, 201);
    assert.equal(proposed.body.state, 'PENDING');
    assert.equal(proposed.body.markdown, 'ModelProposalMarker');
    assert.equal(proposalCalls, 1);
    assert.deepEqual((await request(page + '/drafts/generate', view, 'POST', true,
        { baseRevisionId: restored.body.revision.id, instruction: 'Summarize the workflow' }, { 'Idempotency-Key': 'generate-draft' })).body, proposed.body);
    assert.equal(proposalCalls, 1);
    assert.equal((await request(page, view)).body.revision.id, restored.body.revision.id);
    assert.deepEqual((await request('/summaries/search', { ...view, q: 'ModelProposalMarker' })).body, []);
    assert.deepEqual((await request('/knowledge-snapshots/' + fullSnapshot.id + '/manifest')).body, fullReceipt);
    const artifactUrl = page + '/exports';
    const recipe = { revisionId: saved.revision.id, format: 'pdf' };
    const generated = await Promise.all([1, 2].map(() => request(artifactUrl, view, 'POST', true, recipe)));
    assert.ok(generated.every(result => result.status === 201 && result.body.format === 'pdf'));
    const artifact = generated[0].body;
    assert.deepEqual(generated[1].body, artifact);
    assert.equal(artifact.revisionId, saved.revision.id);
    const download = url => fetch(base + url, { headers: { Authorization: 'Bearer ' + token } });
    const pdf = await download(artifact.downloadPath);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    const pdfBytes = Buffer.from(await pdf.arrayBuffer());
    assert.match(pdfBytes.subarray(0, 16).toString('latin1'), /^%PDF-/);
    assert.equal(pdfBytes.byteLength, artifact.size);
    assert.equal(createHash('sha256').update(pdfBytes).digest('hex'), artifact.sha256);
    const wordExport = await request(artifactUrl, view, 'POST', true, { ...recipe, format: 'docx' });
    assert.equal(wordExport.status, 201);
    assert.equal(wordExport.body.revisionId, saved.revision.id);
    assert.match(wordExport.body.filename, /\.docx$/);
    const wordDownload = await download(wordExport.body.downloadPath);
    assert.equal(wordDownload.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const wordBytes = Buffer.from(await wordDownload.arrayBuffer());
    assert.equal(createHash('sha256').update(wordBytes).digest('hex'), wordExport.body.sha256);
    const wordParts = unzipSync(wordBytes);
    const wordDocument = strFromU8(wordParts['word/document.xml']);
    assert.match(strFromU8(wordParts['word/fontTable.xml']), /<w:embedRegular/);
    assert.ok(wordParts['word/fonts/noto-sans-sc.odttf'].byteLength > 1_000_000);
    assert.match(wordDocument, /w:pStyle w:val="Title"/);
    assert.match(wordDocument, /w:pStyle w:val="Heading2"/);
    assert.match(wordDocument, /中文交付记录/);
    assert.match(wordDocument, /盘点行已校验/);
    assert.match(wordDocument, new RegExp(saved.revision.id));
    assert.doesNotMatch(wordDocument, /ModelProposalMarker/);
    assert.deepEqual((await request(artifactUrl, view, 'POST', true, { ...recipe, format: 'docx' })).body, wordExport.body);
    const scopedMarkdown = await request(artifactUrl, view, 'POST', true, { ...recipe, format: 'markdown', section: 0 });
    assert.equal(scopedMarkdown.status, 201);
    assert.equal(scopedMarkdown.body.section, 0);
    assert.deepEqual(Buffer.from(await (await download(scopedMarkdown.body.downloadPath)).arrayBuffer()), Buffer.from(edited));
    assert.equal((await request(artifactUrl, view, 'POST', true, { ...recipe, section: 100 })).status, 404);
    assert.deepEqual((await request(artifactUrl, { ...view, revisionId: recipe.revisionId })).body.records.map(item => item.id),
        [scopedMarkdown.body.id, wordExport.body.id, artifact.id]);
    assert.deepEqual((await request(artifactUrl, { ...view, revisionId: restored.body.revision.id })).body.records, []);

    const body = new FormData();
    body.append('file', new Blob([zipSync({ 'stock.ts': strToU8('export function stock() { return 12; }\n') })]), 'stock.zip');
    const upload = await fetch(base + '/api/v1/assets/import', { method: 'POST', body, headers: { Authorization: 'Bearer ' + token } });
    assert.equal(upload.status, 202);
    const archived = await upload.json();
    assert.equal((await until('/assets/' + archived.assetId, {}, ['INDEXING'])).status, 'READY');
    const archivedRun = await generate(archived.projectId);
    assert.equal(archivedRun.status, 'COMPLETED');
    const [archivedWiki] = (await request('/summaries', { projectId: archived.projectId })).body;
    const retained = await request('/knowledge-snapshots/' + archivedWiki.knowledgeSnapshotId + '/source', { file: 'stock.ts' });
    assert.equal(retained.body.text, 'export function stock() { return 12; }\n');
    const large = await request('/summaries/' + archivedWiki.id + '/revisions', {}, 'POST', true,
        { baseRevisionId: archivedWiki.revision.id, markdown: 'Long archival note\n'.repeat(12_000) }, { 'Idempotency-Key': 'long-archive-wiki' });
    assert.equal(large.status, 201);
    const archiveExports = '/summaries/' + archivedWiki.id + '/exports';
    const largePdf = await request(archiveExports, {}, 'POST', true, { revisionId: large.body.revision.id, format: 'pdf' });
    assert.equal(largePdf.status, 413);
    assert.equal(largePdf.body.error, 'WIKI_PDF_LIMIT');
    assert.deepEqual((await request(archiveExports, { revisionId: large.body.revision.id })).body.records, []);

    const lifecycle = (id, owner = projectId) => ({ path: '/knowledge-snapshots/' + id + '/lifecycle', query: { projectId: owner } });
    const changeSnapshot = ({ path, query }, action, revision, key) =>
        request(path, query, 'POST', true, { action, revision }, { 'Idempotency-Key': key });
    const editedLife = lifecycle(fullSnapshot.id);
    const pinned = await request('/ask/sessions', {}, 'POST', true, { scopes: [{ projectId, snapshotId: fullSnapshot.id }] });
    assert.equal(pinned.status, 201);
    const leaf = lifecycle(archivedWiki.knowledgeSnapshotId, archived.projectId);
    const archivedSpace = await request('/spaces', {}, 'POST', true, { name: 'Archived release reference' });
    const archiveLink = '/spaces/' + archivedSpace.body.id + '/repositories';
    const linkedRelease = await request(archiveLink, {}, 'POST', true,
        { projectId: archived.projectId, snapshotId: archivedWiki.knowledgeSnapshotId, revision: archivedSpace.body.revision });
    assert.equal(linkedRelease.status, 200);
    const retiredLeaf = await changeSnapshot(leaf, 'retire', 0, 'retire-leaf');
    assert.equal(retiredLeaf.body.revision, 1);
    assert.equal((await changeSnapshot(leaf, 'purge', 1, 'collect-leaf')).body.error, 'SNAPSHOT_RETENTION_ACTIVE');
    const retired = await changeSnapshot(editedLife, 'retire', 0, 'retire-edited');
    assert.equal(retired.status, 200);
    const parent = lifecycle(stock.knowledgeSnapshotId);
    assert.equal((await changeSnapshot(parent, 'retire', 0, 'retire-parent')).status, 200);
    assert.deepEqual((await changeSnapshot(editedLife, 'retire', 0, 'retire-edited')).body, retired.body);
    assert.equal((await changeSnapshot(editedLife, 'restore', 1, 'retire-edited')).body.error, 'SNAPSHOT_REQUEST_CONFLICT');
    assert.equal((await request(page, view)).status, 404);
    assert.equal((await download(artifact.downloadPath)).status, 404);
    assert.equal((await request('/summaries/search', queryView)).status, 404);
    assert.equal((await request('/ask/sessions/' + pinned.body.id)).status, 404);
    assert.equal((await request('/knowledge-snapshots', { projectId })).body[0].id, moved.id);
    assert.equal((await request('/summaries', { projectId })).body[0].knowledgeSnapshotId, moved.id);
    assert.deepEqual(new Set((await request('/knowledge-snapshots/retired', { projectId })).body.snapshots.map(item => item.id)),
        new Set([fullSnapshot.id, stock.knowledgeSnapshotId]));
    assert.equal((await changeSnapshot(editedLife, 'restore', 0, 'restore-wrong')).body.error, 'SNAPSHOT_REVISION_CHANGED');
    await delay(1100);
    assert.equal((await changeSnapshot(editedLife, 'purge', 1, 'protected-edit')).body.error, 'SNAPSHOT_REFERENCED');
    assert.equal((await changeSnapshot(parent, 'purge', 1, 'protected-parent')).body.error, 'SNAPSHOT_REFERENCED');
    assert.equal((await changeSnapshot(leaf, 'purge', 1, 'collect-leaf')).body.error, 'SNAPSHOT_REFERENCED');
    assert.equal((await request(archiveLink + '/' + archived.projectId, { revision: String(linkedRelease.body.revision) }, 'DELETE')).status, 200);
    const publishedAgain = await changeSnapshot(editedLife, 'restore', 1, 'restore-edited');
    assert.equal(publishedAgain.body.revision, 2);
    assert.equal((await request(page, view)).body.revision.id, restored.body.revision.id);
    assert.deepEqual(Buffer.from(await (await download(artifact.downloadPath)).arrayBuffer()), pdfBytes);
    assert.equal((await request('/ask/sessions/' + pinned.body.id)).status, 200);
    assert.equal((await changeSnapshot(parent, 'restore', 1, 'restore-parent')).status, 200);
    const collected = await changeSnapshot(leaf, 'purge', 1, 'collect-leaf');
    assert.deepEqual(collected.body, { id: archivedWiki.knowledgeSnapshotId, projectId: archived.projectId, purged: true });
    assert.deepEqual((await changeSnapshot(leaf, 'purge', 1, 'collect-leaf')).body, collected.body);
    assert.equal((await request(leaf.path, leaf.query)).status, 404);
    assert.equal((await request('/agent-runs/' + archivedRun.id)).body.status, 'COMPLETED');
    assert.equal((await request('/assets/' + archived.assetId)).status, 200);
    const physical = new DatabaseSync(join(tmp, 'index.db'), { readOnly: true });
    try {
        assert.equal(physical.prepare('SELECT 1 FROM wiki_document WHERE id = ?').get(archivedWiki.id), undefined);
        assert.equal(physical.prepare('SELECT 1 FROM knowledge_source WHERE snapshot_id = ?').get(archivedWiki.knowledgeSnapshotId), undefined);
    } finally { physical.close(); }

    const [beforeContentEdit] = (await request('/summaries', { projectId })).body;
    const beforeEvidence = phases.length;
    await writeFile(join(root, 'orders', 'moved.ts'), 'export function updatedShip() { return 8; }\n');
    await index();
    assert.equal((await generate()).status, 'COMPLETED');
    const [afterContentEdit] = (await request('/summaries', { projectId })).body;
    assert.equal(afterContentEdit.factsHash, beforeContentEdit.factsHash);
    const rebuiltForContent = phases.slice(beforeEvidence).map(call => call.phase);
    assert.ok(rebuiltForContent.includes('modules') && rebuiltForContent.includes('business-workflows'));
    assert.ok(!rebuiltForContent.includes('overview') && !rebuiltForContent.includes('build'));

    const broken = await request('/summaries/generate', { projectId, notBefore: new Date(Date.now() + 60_000).toISOString() }, 'POST');
    assert.equal(broken.status, 202);
    const brokenId = broken.body.agentRunId;
    const candidateDb = new DatabaseSync(join(tmp, 'index.db'));
    let brokenSnapshot;
    try {
        const input = JSON.parse(candidateDb.prepare('SELECT input FROM durable_job WHERE id = ?').get(brokenId).input);
        brokenSnapshot = input.snapshotId;
        candidateDb.prepare('INSERT INTO wiki_job_phase VALUES (?, ?, ?)').run(brokenId, 'business-capabilities', JSON.stringify({
            section: { source: 'llm', title: '可观察能力范围', phase: 'business-capabilities', body: 'RejectedBusinessPhase' },
            citations: [{ qualifiedName: 'unknown', filePath: 'missing.ts', startLine: 1, endLine: 1 }], unknownCitations: false
        }));
        candidateDb.prepare('UPDATE durable_job SET available_at = ? WHERE id = ?').run(Date.now(), brokenId);
    } finally { candidateDb.close(); }
    const rejected = await until('/agent-runs/' + brokenId, {}, ['QUEUED', 'RUNNING']);
    assert.equal(rejected.status, 'FAILED');
    assert.equal(rejected.statusReason, 'WIKI_SNAPSHOT_CITATION_MISSING');
    assert.equal((await request('/knowledge-snapshots/' + brokenSnapshot)).status, 404);
    assert.equal((await request('/summaries', { projectId })).body[0].knowledgeSnapshotId, afterContentEdit.knowledgeSnapshotId);
    assert.deepEqual((await request('/summaries/search', { projectId, perspective: 'business', q: 'RejectedBusinessPhase' })).body, []);

    const oldQueued = await request('/summaries/generate', { projectId, notBefore: new Date(Date.now() + 60_000).toISOString() }, 'POST');
    assert.equal(oldQueued.status, 202);
    await stop();
    const oldStore = new DatabaseSync(join(tmp, 'index.db'));
    try {
        const input = JSON.parse(oldStore.prepare('SELECT input FROM durable_job WHERE id = ?').get(oldQueued.body.agentRunId).input);
        input.publication.wikiTemplateVersion = 1;
        delete input.publication.modelPlan;
        oldStore.prepare('UPDATE durable_job SET input = ?, available_at = ? WHERE id = ?')
            .run(JSON.stringify(input), Date.now(), oldQueued.body.agentRunId);
        const facts = createHash('sha256').update(JSON.stringify({ body: input.body, omissions: input.omissions })).digest('hex');
        const legacyFingerprint = createHash('sha256').update(JSON.stringify([1, input.model.config, facts])).digest('hex');
        oldStore.prepare('INSERT INTO wiki_phase VALUES (?, ?, ?, ?)').run(projectId, 'overview', legacyFingerprint,
            JSON.stringify({ section: { source: 'llm', title: '项目概述', phase: 'overview', body: 'LegacyPhaseCheckpoint' },
                citations: [], unknownCitations: false }));
    } finally { oldStore.close(); }
    const beforeLegacy = phases.length;
    await start();
    const legacyRun = await until('/agent-runs/' + oldQueued.body.agentRunId, {}, ['QUEUED', 'RUNNING']);
    assert.equal(legacyRun.status, 'COMPLETED');
    assert.ok(!legacyRun.steps.some(step => step.capability.startsWith('LLM_BUSINESS')));
    assert.deepEqual(phases.slice(beforeLegacy).map(call => call.phase), technicalPhases.slice(1));
    const [legacyWiki] = (await request('/summaries', { projectId })).body;
    assert.ok(legacyWiki.sections.some(section => section.body === 'LegacyPhaseCheckpoint'));
    const [legacyBusiness] = (await request('/summaries', { projectId, perspective: 'business' })).body;
    assert.ok(legacyBusiness.sections.every(section => section.source === 'facts'));
    assert.equal((await request('/knowledge-snapshots/' + legacyWiki.knowledgeSnapshotId + '/manifest')).body.profile.wikiTemplateVersion, 1);

    const tomorrow = (new Date().getUTCDay() + 1) % 7;
    const pool = { maxConcurrent: 4, reservedAsk: 0, backgroundWindow: { timeZone: 'UTC', start: '00:00', end: '23:59', weekdays: [tomorrow] } };
    const currentModel = { ...config, model: 'fixture-after-restart' };
    assert.equal((await request(providerPath, {}, 'PUT', true, { ...currentModel, pool })).status, 200);
    const beforeWindow = phases.length;
    const queuedByWindow = await request('/summaries/generate', { projectId, mode: 'full' }, 'POST');
    assert.equal(queuedByWindow.status, 202);
    const windowRun = '/agent-runs/' + queuedByWindow.body.agentRunId;
    const windowJob = windowRun + '/execution';
    const waiting = (await request(windowJob)).body;
    assert.equal(waiting.state, 'QUEUED');
    assert.equal(waiting.attempt, 0);
    assert.equal((await request(windowRun)).body.statusReason, 'PROVIDER_POOL_WINDOW_CLOSED');
    const manualPause = (await request(windowJob, {}, 'POST', true, { action: 'pause', revision: waiting.revision })).body;
    assert.equal(manualPause.state, 'PAUSED');
    const unbounded = { ...pool, backgroundWindow: null };
    assert.equal((await request(providerPath, {}, 'PUT', true, { ...currentModel, pool: unbounded })).status, 200);
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal((await request(windowJob)).body.state, 'PAUSED');
    assert.equal(phases.length, beforeWindow);
    const firstPhase = { started: Promise.withResolvers(), release: Promise.withResolvers() };
    windowGate = firstPhase;
    assert.equal((await request(windowJob, {}, 'POST', true, { action: 'resume', revision: manualPause.revision })).status, 200);
    try {
        await firstPhase.started.promise;
        assert.equal((await request(providerPath, {}, 'PUT', true, { ...currentModel, pool })).status, 200);
    } finally { firstPhase.release.resolve(); }
    const checkpointed = await until(windowRun, {}, ['RUNNING']);
    assert.equal(checkpointed.status, 'QUEUED');
    assert.equal(checkpointed.statusReason, 'PROVIDER_POOL_WINDOW_CLOSED');
    assert.deepEqual(phases.slice(beforeWindow).map(item => item.phase), ['overview']);
    assert.equal((await request(providerPath, {}, 'PUT', true, { ...currentModel, pool: unbounded })).status, 200);
    const windowResumed = await until(windowRun, {}, ['QUEUED', 'RUNNING']);
    assert.equal(windowResumed.status, 'COMPLETED', JSON.stringify(windowResumed));
    assert.deepEqual(phases.slice(beforeWindow).map(item => item.phase), allPhases);
    assert.equal((await request(windowJob)).body.attempt, 2);

    const repositoryLifecycle = '/projects/' + projectId + '/lifecycle';
    const transition = (action, revision, key) => request(repositoryLifecycle, {}, 'POST', true, { action, revision }, { 'Idempotency-Key': key });
    const deferred = await request('/summaries/generate', { projectId, notBefore: new Date(Date.now() + 60_000).toISOString() }, 'POST');
    assert.equal(deferred.status, 202);
    const repositoryTrash = await transition('trash', 0, 'hide-repository');
    assert.equal(repositoryTrash.status, 200);
    assert.equal(repositoryTrash.body.state, 'TRASHED');
    assert.deepEqual((await transition('trash', 0, 'hide-repository')).body, repositoryTrash.body);
    assert.equal((await transition('restore', 1, 'hide-repository')).body.error, 'PROJECT_LIFECYCLE_REQUEST_CONFLICT');
    assert.equal((await transition('purge', 1, 'blocked-job')).body.error, 'PROJECT_WORK_PENDING');
    assert.equal((await request('/projects')).body.some(project => project.projectId === projectId), false);
    assert.equal((await request('/projects/trash')).body.projects[0].projectId, projectId);
    assert.equal((await request('/knowledge-snapshots/' + stock.knowledgeSnapshotId + '/source', { file: 'stock/item.ts' })).status, 404);
    assert.equal((await request('/ask/sessions/' + pinned.body.id)).status, 404);
    assert.equal((await openResult(sourceHit.link)).status, 404);
    assert.equal((await request('/search/keyword', { q: 'updatedShip' })).body.some(hit => hit.projectId === projectId), false);
    assert.deepEqual((await request('/graph/symbols', { q: 'updatedShip' })).body, []);
    assert.equal((await request('/index/project', { projectRoot: root }, 'POST')).status, 404);
    await stop();
    const dueWhileHidden = new DatabaseSync(join(tmp, 'index.db'));
    try { dueWhileHidden.prepare('UPDATE durable_job SET available_at = ? WHERE id = ?').run(Date.now(), deferred.body.agentRunId); }
    finally { dueWhileHidden.close(); }
    await start();
    assert.equal((await request(repositoryLifecycle)).body.state, 'TRASHED');
    await delay(420);
    const queuedWhileHidden = new DatabaseSync(join(tmp, 'index.db'), { readOnly: true });
    try { assert.equal(queuedWhileHidden.prepare('SELECT state FROM durable_job WHERE id = ?').get(deferred.body.agentRunId).state, 'QUEUED'); }
    finally { queuedWhileHidden.close(); }
    assert.equal((await transition('restore', 1, 'restore-repository')).body.state, 'ACTIVE');
    assert.equal((await until(deferred.body.pollVia.slice('/api/v1'.length), {}, ['QUEUED', 'RUNNING'])).status, 'COMPLETED');
    assert.equal((await request('/knowledge-snapshots/' + stock.knowledgeSnapshotId + '/source', { file: 'stock/item.ts' })).body.text, 'export function count() { return 3; }\n');
    assert.equal((await request('/ask/sessions/' + pinned.body.id)).status, 200);
    assert.equal((await request('/summaries/' + stock.id)).status, 200);

    assert.equal((await request('/index/project', { projectId }, 'DELETE')).status, 200);
    assert.equal((await transition('purge', 3, 'protected-repository')).body.error, 'PROJECT_STILL_REFERENCED');
    assert.equal((await request('/knowledge-snapshots/' + stock.knowledgeSnapshotId)).status, 404);
    assert.equal((await request('/summaries/' + stock.id)).status, 404);
    assert.equal((await request('/agent-runs/' + run.id)).status, 404);

    const localLife = '/projects/' + unpublished.projectId + '/lifecycle';
    const localChange = (action, revision) => request(localLife, {}, 'POST', true, { action, revision }, { 'Idempotency-Key': action });
    assert.equal((await localChange('trash', 0)).body.state, 'TRASHED');
    assert.equal((await localChange('purge', 1)).body.state, 'PURGED');
    assert.match(await readFile(join(unpublishedRoot, 'ship.ts'), 'utf8'), /live index only/);
    assert.equal((await request('/index/project', { projectRoot: unpublishedRoot }, 'POST')).status, 202);
    assert.equal((await until('/index/project/status', { projectRoot: unpublishedRoot }, ['idle', 'running'])).status, 'done');
    const restoredRoot = (await request('/projects')).body.find(project => project.projectName === 'unpublished');
    assert.notEqual(restoredRoot.projectId, unpublished.projectId);
    assert.equal((await request(localLife)).body.state, 'PURGED');
});
