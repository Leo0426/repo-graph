import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('REST semantic search ranks declaration and source vectors while code search uses source vectors', { timeout: 25_000 }, async t => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'repograph-vector-')));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, 'greetings.ts'), [
        '/** A welcome message for new arrivals. */',
        'function welcome() { /* authorize and encrypt */ return "hello"; }',
        'function farewell() { /* authorize */ return "bye"; }'
    ].join('\n'));
    let available = true;
    let reportedModel = 'fixture';
    const embeddingInputs = [];
    const fragment = 'return renderCaption("caption-for-published-card");';
    const embeddingStarted = Promise.withResolvers();
    const releaseFirstEmbedding = Promise.withResolvers();
    let holdFirstEmbedding = true;
    const upstream = createServer(async (request, response) => {
        if (request.url === '/api/tags') {
            assert.equal(request.method, 'GET');
            response.writeHead(available ? 200 : 503, { 'Content-Type': 'application/json' }).end('{"models":[]}');
            return;
        }
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        embeddingInputs.push(...body.input);
        assert.equal(request.url, '/api/embed');
        assert.equal(body.model, 'fixture');
        assert.equal(body.dimensions, 3);
        if (holdFirstEmbedding) {
            holdFirstEmbedding = false;
            embeddingStarted.resolve();
            await releaseFirstEmbedding.promise;
        }
        if (!available) {
            response.writeHead(503).end('offline');
            return;
        }
        const embeddings = body.input.map(input => {
            if (input.includes(fragment) && input.length <= 480) return [0, 1, 0];
            if (input === 'search_query: a friendly greeting' || input.includes('A welcome message for new arrivals.')) return [1, 0, 0];
            if (input === 'search_query: farewell') return [0.3, 1, 0];
            if (input === 'code like this' || input.includes('return "bye"')) return [0, 1, 0];
            return [0, 0, 1];
        });
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ model: reportedModel, embeddings }));
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    t.after(() => new Promise(resolve => upstream.close(resolve)));

    const token = randomBytes(32).toString('hex');
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: {
            ...process.env,
            REPOGRAPH_ACCESS_TOKEN: token,
            REPOGRAPH_PROJECTS_ROOT: directory,
            REPOGRAPH_DB_PATH: join(directory, '.repograph', 'index.db'),
            REPOGRAPH_PORT: '0',
            REPOGRAPH_EMBEDDING_URL: `http://127.0.0.1:${upstream.address().port}`,
            REPOGRAPH_EMBEDDING_MODEL: 'fixture',
            REPOGRAPH_EMBEDDING_DIMENSIONS: '3',
            REPOGRAPH_EMBEDDING_QUERY_PREFIX: 'search_query:'
        },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    t.after(async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const ended = once(child, 'exit');
        child.kill('SIGTERM');
        await ended;
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
    async function request(path, parameters, method = 'GET') {
        const response = await fetch(`${base}/api/v1${path}?${new URLSearchParams(parameters)}`, {
            method, headers: { Authorization: `Bearer ${token}` }
        });
        return { status: response.status, body: await response.json() };
    }

    const projectId = createHash('sha256').update(directory).digest('hex').slice(0, 12);
    const projectRoot = directory;
    async function finishIndex() {
        for (let attempt = 0; attempt < 100; attempt++) {
            const indexed = (await request('/index/project/status', { projectRoot })).body;
            if (indexed.status !== 'running') return indexed;
            await delay(20);
        }
        assert.fail('Index did not reach a terminal state');
    }
    async function index() {
        assert.equal((await request('/index/project', { projectRoot }, 'POST')).status, 202);
        return finishIndex();
    }
    async function publish() {
        const accepted = await request('/summaries/generate', { projectId }, 'POST');
        assert.equal(accepted.status, 202);
        for (let attempt = 0; attempt < 100; attempt++) {
            const run = (await request('/agent-runs/' + accepted.body.agentRunId, { projectId })).body;
            if (['QUEUED', 'RUNNING'].includes(run.status)) { await delay(20); continue; }
            assert.equal(run.status, 'COMPLETED');
            return (await request('/knowledge-snapshots', { projectId })).body[0];
        }
        assert.fail('Wiki did not publish a snapshot');
    }

    assert.equal((await request('/index/project', { projectRoot }, 'POST')).status, 202);
    try {
        await embeddingStarted.promise;
        const running = (await request('/index/project/status', { projectRoot })).body;
        assert.deepEqual(running, {
            status: 'running', stage: 'embedding', done: 0, total: 2, pct: 0, processedFiles: 0, totalFiles: 1
        });
    } finally {
        releaseFirstEmbedding.resolve();
    }
    const initial = await finishIndex();
    assert.equal(initial.status, 'done');
    const initialSnapshot = await publish();
    assert.equal(initial.stage, undefined);
    assert.deepEqual(await request('/health'), { status: 200, body: { status: 'ok', sqlite: 'ok', ollama: 'ok' } });
    const semantic = await request('/search/semantic', { projectId, q: 'a friendly greeting', limit: '1' });
    assert.equal(semantic.status, 200);
    assert.equal(semantic.body.results[0].unit.qualifiedName, 'welcome');
    assert.equal(semantic.body.results[0].score, 0.8);
    assert.equal(semantic.body.results[0].projectId, projectId);
    assert.equal(semantic.body.hasMore, true);
    const code = await request('/search/code', { projectId, snippet: 'code like this', limit: '1' });
    assert.equal(code.status, 200);
    assert.equal(code.body.results[0].unit.qualifiedName, 'farewell');
    const next = await request('/search/code', { projectId, snippet: 'code like this', limit: '1', offset: '1' });
    assert.equal(next.body.results[0].unit.qualifiedName, 'welcome');
    assert.equal(next.body.hasMore, false);
    assert.ok(embeddingInputs.some(input => input.startsWith('A welcome message for new arrivals.')
        && input.includes('function welcome()') && !input.includes('return "hello"')));
    assert.ok(embeddingInputs.includes('function welcome() { /* authorize and encrypt */ return "hello"; }'));
    assert.ok(embeddingInputs.includes('search_query: a friendly greeting'));
    assert.ok(embeddingInputs.includes('code like this'));
    const unopened = await request('/search/semantic', { projectId: '000000000000', q: 'a friendly greeting' });
    assert.deepEqual(unopened.body.results, []);
    const hybrid = await request('/search/graphrag', { projectId, q: 'a friendly greeting', limit: '1' });
    assert.equal(hybrid.body.seedCount, 1);
    assert.equal(hybrid.body.results[0].source, 'VECTOR');
    assert.equal(hybrid.body.results[0].unit.qualifiedName, 'welcome');
    const hybridOptions = { projectId, q: 'farewell', limit: '1' };
    const ranked = await request('/search/graphrag', hybridOptions);
    assert.equal(ranked.status, 200);
    assert.deepEqual(ranked.body.results.map(hit => hit.source), ['KEYWORD', 'VECTOR']);
    const unranked = await request('/search/graphrag', { ...hybridOptions, rerank: 'false' });
    assert.equal(unranked.status, 200);
    assert.deepEqual(unranked.body.results.map(hit => hit.source), ['VECTOR', 'KEYWORD']);
    assert.equal(unranked.body.results[0].finalScore, unranked.body.results[0].vectorScore);
    assert.equal(unranked.body.results[1].securityScore, 0.3);
    assert.equal(unranked.body.securityHighlightCount, 1);
    assert.ok(Math.abs(ranked.body.results[0].finalScore - unranked.body.results[1].finalScore - 0.15) < 1e-9);
    const overlapping = await request('/search/graphrag', { ...hybridOptions, limit: '2', rerank: 'false' });
    assert.deepEqual(overlapping.body.results.map(hit => hit.source), ['VECTOR', 'VECTOR']);
    const farewell = overlapping.body.results[1];
    assert.equal(farewell.unit.qualifiedName, 'farewell');
    assert.ok(Math.abs(farewell.vectorScore - 0.2 / Math.hypot(0.3, 1)) < 1e-7);
    assert.equal(farewell.finalScore, farewell.vectorScore);
    assert.ok(farewell.securitySignals.includes('keyword:farewell'));
    assert.equal((await index()).skippedFiles, 1);

    assert.equal((await request('/benchmark/results')).status, 404);
    const cases = join(directory, 'benchmark-cases.json');
    const output = join(directory, '.repograph', 'benchmark-latest.json');
    await writeFile(cases, JSON.stringify({
        semantic: [
            { id: 'S1', description: 'Greeting', query: 'a friendly greeting', expectedPatterns: ['WELCOME'] },
            { id: 'S2', description: 'Missing symbol', query: 'a friendly greeting', expectedPatterns: ['missing'] }
        ],
        code: [{ id: 'C1', description: 'Second result has score zero', query: 'code like this', expectedPatterns: ['welcome'] }]
    }));
    const benchmark = () => run(process.execPath, ['dist/benchmark-cli.js', '--cases', cases, '--project', projectId, '--output', output],
        { env: { ...process.env, REPOGRAPH_BASE_URL: base, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_EMBEDDING_MODEL: 'other-client-model' } });
    await assert.rejects(benchmark(), { code: 1 });
    const snapshot = await request('/benchmark/results');
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.projectId, projectId);
    assert.match(snapshot.body.corpusDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual([snapshot.body.embedding.model, snapshot.body.embedding.dimensions], ['fixture:latest', 3]);
    assert.match(snapshot.body.embedding.profile, /^[a-f0-9]{64}$/);
    assert.equal(snapshot.body.semantic.hit10Rate, .5);
    assert.equal(snapshot.body.semantic.mrr10, .5);
    assert.equal(snapshot.body.semantic.passed, false);
    assert.equal(snapshot.body.semantic.cases[1].rank, 0);
    assert.equal(snapshot.body.code.cases[0].hitScore, 0);
    assert.equal(snapshot.body.code.cases[0].rank, 2);
    assert.equal(snapshot.body.code.passed, true);
    assert.doesNotMatch(JSON.stringify(snapshot.body), /a friendly greeting|code like this/);
    const bundledOutput = join(directory, '.repograph', 'bundled-benchmark.json');
    await assert.rejects(run(process.execPath, ['dist/benchmark-cli.js', '--project', projectId, '--output', bundledOutput],
        { env: { ...process.env, REPOGRAPH_BASE_URL: base, REPOGRAPH_ACCESS_TOKEN: token } }), { code: 1 });
    const bundled = JSON.parse(await readFile(bundledOutput, 'utf8'));
    assert.notEqual(bundled.corpusDigest, snapshot.body.corpusDigest);
    assert.deepEqual(bundled.embedding, snapshot.body.embedding);
    assert.deepEqual([bundled.semantic.cases.length, bundled.code.cases.length], [23, 8]);
    assert.deepEqual([bundled.semantic.hit10Rate, bundled.code.hit10Rate], [0, 0]);

    let queryCount = 0;
    const switchingApp = createServer((request, response) => {
        response.setHeader('Content-Type', 'application/json');
        if (request.url.startsWith('/api/v1/projects')) {
            return response.end(JSON.stringify([{ projectId, projectName: 'fixture', nodeCount: 2, indexedAt: '2026-01-01' }]));
        }
        const profile = { model: 'fixture:latest', dimensions: 3, profile: (++queryCount === 1 ? 'a' : 'b').repeat(64) };
        response.setHeader('X-RepoGraph-Embedding', encodeURIComponent(JSON.stringify(profile)));
        response.end(JSON.stringify({ results: [] }));
    }).listen(0, '127.0.0.1');
    await once(switchingApp, 'listening');
    try {
        const switched = run(process.execPath, ['dist/benchmark-cli.js', '--cases', cases, '--project', projectId, '--output', output],
            { env: { ...process.env, REPOGRAPH_BASE_URL: `http://127.0.0.1:${switchingApp.address().port}`, REPOGRAPH_ACCESS_TOKEN: token } });
        await assert.rejects(switched, error => error.code === 2 && error.stderr.includes('BENCHMARK_EMBEDDING_CHANGED'));
        assert.equal(queryCount, 2);
        assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), snapshot.body);
    } finally { await new Promise(resolve => switchingApp.close(resolve)); }

    reportedModel = 'another-model';
    assert.equal((await request('/search/semantic', { projectId, q: 'a friendly greeting' })).status, 503);
    reportedModel = 'fixture:latest';
    assert.equal((await request('/search/semantic', { projectId, q: 'a friendly greeting' })).status, 200);

    available = false;
    assert.deepEqual(await request('/health'), { status: 207, body: { status: 'degraded', sqlite: 'ok', ollama: 'error' } });
    const degraded = (await request('/admin/diagnostics')).body;
    assert.equal(degraded.status, 'degraded');
    assert.equal(degraded.components.vectorSearch, 'unavailable');
    assert.equal(degraded.components.fullText, 'available');
    await assert.rejects(benchmark(), { code: 2 });
    assert.deepEqual((await request('/benchmark/results')).body, snapshot.body);
    await writeFile(join(directory, 'greetings.ts'), 'function bonjour() { return "hello"; }');
    const partial = await index();
    assert.equal(partial.status, 'partial');
    assert.deepEqual(partial.errors, ['greetings.ts: EMBEDDING_UNAVAILABLE']);
    assert.deepEqual(await request('/summaries/generate', { projectId }, 'POST'), {
        status: 409, body: { error: 'WIKI_SNAPSHOT_VECTOR_INCOMPLETE' }
    });
    assert.equal((await request('/knowledge-snapshots', { projectId })).body[0].id, initialSnapshot.id);
    assert.deepEqual((await request('/search/semantic', { projectId, q: 'bonjour' })).body, {
        error: 'EMBEDDING_UNAVAILABLE'
    });
    const fallback = await request('/context/pack', { projectId, q: 'bonjour' });
    assert.deepEqual(fallback.body.omittedReasons, ['EMBEDDING_UNAVAILABLE']);
    assert.equal(fallback.body.evidence[0].qualifiedName, 'bonjour');

    available = true;
    assert.equal((await index()).status, 'done');
    const recovered = await request('/search/semantic', { projectId, q: 'bonjour' });
    assert.deepEqual(recovered.body.results.map(hit => hit.unit.qualifiedName), ['bonjour']);
    const archived = await request('/search/semantic', { projectId, snapshotId: initialSnapshot.id, q: 'a friendly greeting' });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.results[0].snapshotId, initialSnapshot.id);
    assert.equal(archived.body.results[0].unit.qualifiedName, 'welcome');
    assert.equal((await request('/search/semantic', { projectId: '000000000000', snapshotId: initialSnapshot.id, q: 'greeting' })).status, 404);

    await writeFile(join(directory, 'welcome-team.ts'), [
        '/** Publishes greetings for the welcome team. */',
        'class WelcomeTeam {',
        '    /** Display the hello message. */',
        '    greet() { return "hello"; }',
        '}'
    ].join('\n'));
    assert.equal((await index()).status, 'done');
    assert.ok(embeddingInputs.some(input => input.startsWith('Display the hello message.')
        && input.includes('greet()') && input.includes('Publishes greetings for the welcome team.')
        && input.includes('class WelcomeTeam')));

    const cardFile = join(directory, 'card.ts');
    const padding = Array.from({ length: 24 }, (_, index) => `    const label${index} = "ordinary card decoration";`);
    const card = ['export function publishCard() {', ...padding, '    ' + fragment, '}'].join('\n');
    await writeFile(cardFile, card);
    assert.equal((await index()).status, 'done');
    assert.ok(embeddingInputs.includes(card));
    assert.ok(embeddingInputs.some(input => input.length <= 480 && input !== fragment && input.includes(fragment)));
    const localMatch = await request('/search/code', { projectId, snippet: fragment, limit: '1' });
    assert.equal(localMatch.body.results[0].unit.qualifiedName, 'publishCard');
    assert.equal(localMatch.body.results[0].score, 1);
    const publishedCard = await publish();
    await writeFile(cardFile, card.replace(fragment, 'return renderCaption("updated-card-caption");'));
    assert.equal((await index()).status, 'done');
    const afterEdit = await request('/search/code', { projectId, snippet: fragment });
    const reindexed = afterEdit.body.results.find(result => result.unit.id === localMatch.body.results[0].unit.id);
    assert.equal(reindexed.score, 0);
    assert.doesNotMatch(reindexed.unit.rawSource, /caption-for-published-card/);
    const archivedCard = await request('/search/code', { projectId, snapshotId: publishedCard.id, snippet: fragment, limit: '1' });
    assert.equal(archivedCard.body.results[0].score, 1);
    assert.equal(archivedCard.body.results[0].snapshotId, publishedCard.id);
    assert.match(archivedCard.body.results[0].unit.rawSource, /caption-for-published-card/);
});
