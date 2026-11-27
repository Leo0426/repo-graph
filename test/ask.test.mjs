import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

test('private Ask turns freeze evidence, resume their timeline, and stop delivery on revocation', { timeout: 25_000 }, async t => {
    const temp = await realpath(await mkdtemp(join(tmpdir(), 'repograph-ask-')));
    const root = join(temp, 'inventory');
    await mkdir(root);
    const token = randomBytes(24).toString('hex');
    let child, base;
    async function start() {
        child = spawn(process.execPath, ['dist/server.js'], { env: { ...process.env,
            REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined, REPOGRAPH_PORT: '0',
            REPOGRAPH_PROJECTS_ROOT: temp, REPOGRAPH_DB_PATH: join(temp, 'index.db'),
            REPOGRAPH_ASSETS_ROOT: join(temp, 'assets'), REPOGRAPH_EMBEDDING_MODEL: undefined
        }, stdio: ['ignore', 'ignore', 'pipe'] });
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
    async function stop(signal = 'SIGTERM') {
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill(signal);
        await exited;
    }
    t.after(async () => { await stop(); await rm(temp, { recursive: true, force: true }); });
    function call(path, method = 'GET', body, headers = {}) {
        return fetch(base + '/api/v1' + path, { method, headers: { Authorization: 'Bearer ' + token,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: JSON.stringify(body) });
    }
    async function api(path, method, body, headers) {
        const response = await call(path, method, body, headers);
        return { status: response.status, body: await response.json() };
    }
    async function terminal(path, pending) {
        for (let attempt = 0; attempt < 350; attempt++) {
            const response = await api(path);
            assert.equal(response.status, 200);
            if (!pending.includes(response.body.status)) return response.body;
            await delay(25);
        }
        assert.fail('Run did not complete');
    }
    const pending = ['QUEUED', 'RUNNING'];
    const countFile = 'count.ts';
    async function index(value) {
        await writeFile(join(root, countFile), 'export function countInventory() { return ' + value + '; }\n');
        const query = '?' + new URLSearchParams({ projectRoot: root });
        assert.equal((await api('/index/project' + query, 'POST')).status, 202);
        assert.equal((await terminal('/index/project/status' + query, ['idle', 'running'])).status, 'done');
    }
    async function publish(projectId) {
        const accepted = await api('/summaries/generate?projectId=' + projectId, 'POST');
        assert.equal(accepted.status, 202);
        assert.equal((await terminal(accepted.body.pollVia.slice('/api/v1'.length), pending)).status, 'COMPLETED');
        return (await api('/knowledge-snapshots?projectId=' + projectId)).body[0].id;
    }

    await start();
    await index(31);
    const [{ projectId }] = (await api('/projects')).body;
    const oldSnapshot = await publish(projectId);
    const [wiki] = (await api('/summaries?' + new URLSearchParams({ projectId, snapshotId: oldSnapshot }))).body;
    const wikiPage = '/summaries/' + wiki.id;
    const oldWiki = await api(wikiPage + '/revisions', 'POST', { baseRevisionId: wiki.revision.id,
        markdown: '# Inventory\nOldWikiMarker documents the 31-unit policy.' }, { 'Idempotency-Key': 'old-wiki' });
    assert.equal(oldWiki.status, 201);
    const space = await api('/spaces', 'POST', { name: 'Inventory fixtures' });
    const path = '/spaces/' + space.body.id;
    const linked = await api(path + '/repositories', 'POST', { projectId, revision: space.body.revision });
    assert.equal(linked.status, 200);
    const doc = await api(path + '/documents', 'POST', { name: 'Inventory.md', markdown: '# Policy\nInventoryPolicy allows 31 units.',
        key: 'first-document' });
    assert.equal(doc.status, 201);
    const created = await api('/ask/sessions', 'POST', { scopes: [{ spaceId: space.body.id }], title: 'Old inventory' });
    assert.equal(created.status, 201);
    assert.equal(created.body.scope.repositories[0].snapshotId, oldSnapshot);
    assert.equal(created.body.scope.documents[0].versionId, doc.body.version.id);
    assert.ok(created.body.scope.wikiRevisions[oldSnapshot].some(item => item.pageId === wiki.id && item.revisionId === oldWiki.body.revision.id));
    const session = '/ask/sessions/' + created.body.id;

    const newWiki = await api(wikiPage + '/revisions', 'POST', { baseRevisionId: oldWiki.body.revision.id,
        markdown: '# Inventory\nNewWikiMarker corrects the policy to 75 units.' }, { 'Idempotency-Key': 'new-wiki' });
    assert.equal(newWiki.status, 201);
    await index(75);
    const newSnapshot = await publish(projectId);
    assert.notEqual(newSnapshot, oldSnapshot);
    assert.equal((await api(path + '/documents/' + doc.body.id, 'PUT', { key: 'new-document', baseVersionId: doc.body.version.id,
        markdown: '# Policy\nInventoryPolicy allows 75 units.' })).status, 200);
    assert.equal((await api(session + '/turns', 'POST', { question: 'countInventory', context: [{ projectId,
        snapshotId: newSnapshot, path: countFile }] }, { 'Idempotency-Key': 'outside' })).status, 403);
    assert.equal((await api(session + '/turns', 'POST', { question: 'Inventory', context: [{ projectId,
        snapshotId: oldSnapshot, wikiId: wiki.id, revisionId: newWiki.body.revision.id }] }, { 'Idempotency-Key': 'wiki-outside' })).status, 403);

    const prompts = [];
    let hold;
    const provider = createServer(async (req, response) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const payload = JSON.parse(Buffer.concat(chunks));
        const prompt = JSON.parse(payload.messages.at(-1).content);
        prompts.push(prompt);
        if (hold) {
            const gates = hold;
            hold = undefined;
            gates.started.resolve();
            await gates.release.promise;
            if (response.destroyed) return;
        }
        const evidence = prompt.evidence.find(item => item.kind === 'SOURCE') ?? prompt.evidence[0];
        const wikiEvidence = prompt.evidence.find(item => item.kind === 'WIKI' && item.excerpt.includes('OldWikiMarker'));
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ message: { content: JSON.stringify({ answer: 'The captured source allows 31 units.',
            citations: [evidence.id, ...(wikiEvidence ? [wikiEvidence.id] : [])] }) },
            prompt_eval_count: 81, eval_count: 24, done_reason: 'stop' }));
    }).listen(0, '127.0.0.1');
    await once(provider, 'listening');
    t.after(() => { hold?.release.resolve(); provider.closeAllConnections(); return new Promise(resolve => provider.close(resolve)); });
    const model = await api('/admin/model-providers/legacy-ollama', 'PUT', { name: 'Fixture model', protocol: 'OLLAMA',
        baseUrl: 'http://127.0.0.1:' + provider.address().port, model: 'fixture', enabled: true, timeoutMillis: 10_000, maxOutputTokens: 1000 });
    assert.equal(model.status, 200);

    function submit(question, key, context = [], timeoutMs = 90_000) {
        return api(session + '/turns', 'POST', { question, context, timeoutMs }, { 'Idempotency-Key': key });
    }
    const question = 'What do countInventory and InventoryPolicy allow?';
    const contextual = [{ projectId, path: countFile, line: 1 }, { spaceId: space.body.id, documentId: doc.body.id, line: 2 },
        { projectId, snapshotId: oldSnapshot, wikiId: wiki.id, revisionId: oldWiki.body.revision.id }];
    const firstStream = { started: Promise.withResolvers(), release: Promise.withResolvers() };
    hold = firstStream;
    const [first, replay] = await Promise.all([submit(question, 'first', contextual), submit(question, 'first', contextual)]);
    assert.equal(first.status, 202);
    assert.equal(replay.status, 202);
    assert.equal(first.body.turn.id, replay.body.turn.id);
    assert.equal((await submit('different question', 'first')).status, 409);
    try {
        await Promise.race([firstStream.started.promise, delay(3000).then(() => assert.fail('The first model call was not dispatched'))]);
        const connection = await call(session + '/events', 'GET', undefined, { Accept: 'text/event-stream' });
        assert.equal(connection.status, 200);
        await connection.body.cancel();
    } finally { firstStream.release.resolve(); }
    const final = await terminal(session + '/turns/' + first.body.turn.id, pending);
    assert.equal(final.status, 'COMPLETED', JSON.stringify(final));
    assert.match(prompts[0].evidence.find(item => item.kind === 'SOURCE').excerpt, /return 31/);
    assert.match(prompts[0].evidence.find(item => item.kind === 'DOCUMENT').excerpt, /31 units/);
    assert.match(prompts[0].evidence.find(item => item.kind === 'WIKI').excerpt, /OldWikiMarker/);
    assert.doesNotMatch(JSON.stringify(prompts[0]), /NewWikiMarker/);
    assert.equal(prompts[0].evidence.find(item => item.kind === 'SOURCE').snapshotId, oldSnapshot);
    const timeline = await api(session + '/events');
    assert.deepEqual(timeline.body.events.map(item => item.type), ['USER_MESSAGE', 'TURN_STARTED', 'EVIDENCE', 'ASSISTANT_MESSAGE', 'TURN_FINISHED']);
    assert.deepEqual(timeline.body.events.at(-1).data.usage, { inputTokens: 81, outputTokens: 24, costUsd: null });
    const usage = (await api('/admin/model-usage')).body.records.find(item => item.capability === 'ASK');
    assert.deepEqual([usage.status, usage.inputTokens, usage.outputTokens, usage.costUsd], ['COMPLETED', 81, 24, null]);
    assert.deepEqual([usage.actorId, usage.projectId, usage.runId], [null, null, null]);
    assert.deepEqual((await api('/admin/model-usage?runId=' + first.body.turn.id)).body.records, []);
    const citationUrl = session + '/turns/' + first.body.turn.id + '/citations/' + timeline.body.events[3].data.citations[0].id;
    assert.equal((await api(citationUrl)).body.snapshotId, oldSnapshot);
    const wikiCitation = timeline.body.events[3].data.citations.find(item => item.kind === 'WIKI');
    assert.equal(wikiCitation.revisionId, oldWiki.body.revision.id);
    const redirected = await fetch(base + '/api/v1' + session + '/turns/' + first.body.turn.id + '/citations/' + wikiCitation.id + '?open=1',
        { headers: { Authorization: 'Bearer ' + token }, redirect: 'manual' });
    assert.equal(redirected.status, 303);
    assert.equal(new URL(redirected.headers.get('location'), base).searchParams.get('revisionId'), oldWiki.body.revision.id);
    const resumed = await call(session + '/events', 'GET', undefined, { Accept: 'text/event-stream', 'Last-Event-ID': '3' });
    const stream = await resumed.text();
    assert.equal(resumed.status, 200);
    assert.match(stream, /id: 4\nevent: ASSISTANT_MESSAGE/);
    assert.doesNotMatch(stream, /id: 3/);
    assert.equal((await api('/agent-runs?projectId=' + projectId + '&playbook=ASK')).body.length, 0);

    const gated = { started: Promise.withResolvers(), release: Promise.withResolvers() };
    hold = gated;
    const interrupted = await submit('Follow up on countInventory', 'interrupted');
    assert.equal(interrupted.status, 202);
    try {
        await Promise.race([gated.started.promise, delay(3000).then(() => assert.fail('Provider was not called'))]);
        assert.equal((await submit('another concurrent turn', 'parallel')).status, 409);
        await stop('SIGKILL');
    } finally { gated.release.resolve(); }
    const interruptedDatabase = new DatabaseSync(join(temp, 'index.db'));
    try { interruptedDatabase.prepare('UPDATE model_invocation SET deadline_at = 0 WHERE run_id = ?').run(interrupted.body.turn.id); }
    finally { interruptedDatabase.close(); }
    await start();
    const stopped = await terminal(session + '/turns/' + interrupted.body.turn.id, pending);
    assert.equal(stopped.status, 'FAILED');
    assert.equal(stopped.reason, 'ASK_MODEL_OUTCOME_UNKNOWN');
    assert.equal(stopped.attempt, 2);
    const restartedAttempts = await api(session + '/turns/' + interrupted.body.turn.id + '/attempts');
    assert.deepEqual(restartedAttempts.body.map(attempt => attempt.outcome), ['LEASE_EXPIRED', 'FAILED']);
    const unknown = (await api('/admin/model-usage')).body.records.find(record => record.status === 'UNKNOWN');
    assert.equal(unknown.reason, 'MODEL_OUTCOME_UNKNOWN');
    assert.equal(unknown.inputTokens, null);
    assert.equal(prompts.length, 2);
    const again = await submit(question + ' Check OldWikiMarker.', 'after-restart');
    assert.equal((await terminal(session + '/turns/' + again.body.turn.id, pending)).status, 'COMPLETED');
    assert.match(prompts.at(-1).evidence.find(item => item.kind === 'SOURCE').excerpt, /return 31/);
    assert.match(prompts.at(-1).evidence.find(item => item.kind === 'WIKI' && item.revisionId === oldWiki.body.revision.id).excerpt, /OldWikiMarker/);
    assert.match(prompts.at(-1).history[0].text, /countInventory/);

    const toCancel = { started: Promise.withResolvers(), release: Promise.withResolvers() };
    hold = toCancel;
    const cancelled = await submit(question, 'cancel');
    try {
        await Promise.race([toCancel.started.promise, delay(3000).then(() => assert.fail('Provider was not called'))]);
        assert.equal((await api(session + '/turns/' + cancelled.body.turn.id + '/cancel', 'POST')).status, 200);
        assert.equal((await terminal(session + '/turns/' + cancelled.body.turn.id, pending)).status, 'CANCELLED');
    } finally { toCancel.release.resolve(); }

    const limitGate = { started: Promise.withResolvers(), release: Promise.withResolvers() };
    hold = limitGate;
    const timed = await submit(question, 'timeout', contextual, 1000);
    try {
        await Promise.race([limitGate.started.promise, delay(3000).then(() => assert.fail('Provider was not called for budget test'))]);
        assert.equal((await terminal(session + '/turns/' + timed.body.turn.id, pending)).status, 'TIMED_OUT');
    } finally { limitGate.release.resolve(); }

    const toRevoke = { started: Promise.withResolvers(), release: Promise.withResolvers() };
    hold = toRevoke;
    const cursor = (await api(session + '/events')).body.next;
    const revokedTurn = await submit(question, 'revoke-in-stream');
    assert.equal(revokedTurn.status, 202);
    const inProgress = await call(session + '/events', 'GET', undefined, { Accept: 'text/event-stream', 'Last-Event-ID': String(cursor) });
    await Promise.race([toRevoke.started.promise, delay(3000).then(() => assert.fail('Provider was not called for stream test'))]);
    const latestSpace = await api(path);
    try {
        assert.equal((await api(path + '/repositories/' + projectId + '?revision=' + latestSpace.body.revision, 'DELETE')).status, 200);
        const interrupted = await inProgress.text();
        assert.match(interrupted, /ASK_SCOPE_ACCESS_CHANGED/);
        assert.doesNotMatch(interrupted, /ASSISTANT_MESSAGE/);
    } finally { toRevoke.release.resolve(); }
    assert.equal((await api(session + '/events')).status, 404);
    assert.equal((await api(citationUrl)).status, 404);
    assert.equal((await api(session + '/turns/' + first.body.turn.id)).status, 404);
    assert.equal((await api(session + '/turns/' + first.body.turn.id + '/attempts')).status, 404);
    assert.deepEqual((await api('/ask/sessions')).body, []);
    assert.equal((await api('/knowledge-snapshots/' + oldSnapshot)).status, 200);
    const missing = randomUUID();
    const strictScopes = { scopes: [{ projectId, snapshotId: oldSnapshot }, { spaceId: missing }] };
    assert.equal((await api('/ask/sessions', 'POST', strictScopes)).status, 404);
    const partial = await api('/ask/sessions', 'POST', { ...strictScopes, allowPartialSpaces: true });
    assert.equal(partial.status, 201);
    assert.equal(partial.body.scope.omittedSpaces, 1);
    assert.doesNotMatch(JSON.stringify(partial.body), new RegExp(missing));
    await stop();
    const stored = new DatabaseSync(join(temp, 'index.db'));
    try { stored.prepare('UPDATE ask_session SET expires_at = 0 WHERE id = ?').run(partial.body.id); }
    finally { stored.close(); }
    await start();
    assert.equal((await api('/ask/sessions/' + partial.body.id)).status, 404);
    assert.deepEqual((await api('/ask/sessions')).body, []);

    const privateText = '\ufeff# Local memo\r\nUniqueAttachmentMarker allows 13 units.\r\nDon’t disclose it outside this conversation.\r\n';
    const attachmentInput = { attachments: [{ name: '盘点.md', text: privateText }], title: 'Private memo' };
    const creation = { 'Idempotency-Key': 'create-with-private-file' };
    assert.equal((await api('/ask/sessions', 'POST', attachmentInput)).body.error, 'ASK_IDEMPOTENCY_KEY_REQUIRED');
    assert.equal((await api('/ask/sessions', 'POST', { attachments: [{ name: 'memo.md', text: '录'.repeat(180_000) }] },
        { 'Idempotency-Key': 'oversized-file' })).status, 413);
    assert.equal((await api('/ask/sessions', 'POST', { attachments: [
        { name: 'Memo.md', text: '' }, { name: 'memo.md', text: 'Duplicate' }
    ] }, { 'Idempotency-Key': 'duplicate-files' })).body.error, 'ASK_ATTACHMENT_NAME_CONFLICT');
    const [privateCreated, privateReplay] = await Promise.all([api('/ask/sessions', 'POST', attachmentInput, creation),
        api('/ask/sessions', 'POST', attachmentInput, creation)]);
    assert.equal(privateCreated.status, 201);
    assert.deepEqual(privateReplay.body, privateCreated.body);
    assert.equal((await api('/ask/sessions', 'POST', { ...attachmentInput, title: 'Changed' }, creation)).status, 409);
    const privatePath = '/ask/sessions/' + privateCreated.body.id;
    const [attachment] = privateCreated.body.scope.attachments;
    assert.equal(attachment.bytes, Buffer.byteLength(privateText));
    assert.equal(attachment.name, '盘点.md');
    assert.doesNotMatch(JSON.stringify(privateCreated.body), /UniqueAttachmentMarker/);
    const attachmentPath = privatePath + '/attachments/' + attachment.attachmentId;
    const version = '?versionId=' + attachment.versionId;
    assert.equal((await api(attachmentPath + version)).body.text, privateText);
    assert.equal((await api(attachmentPath + '?versionId=' + randomUUID())).status, 404);
    const downloaded = await call(attachmentPath + '/download' + version);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get('content-disposition'), /filename\*=UTF-8''/);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), Buffer.from(privateText));
    const other = await api('/ask/sessions', 'POST', { scopes: [{ projectId }] });
    assert.equal((await api('/ask/sessions/' + other.body.id + '/attachments/' + attachment.attachmentId + version)).status, 404);

    const byContent = await api(privatePath + '/turns', 'POST', { question: 'What does UniqueAttachmentMarker allow?' },
        { 'Idempotency-Key': 'search-private-content' });
    assert.equal((await terminal(privatePath + '/turns/' + byContent.body.turn.id, pending)).status, 'COMPLETED');
    const privateEvents = (await api(privatePath + '/events')).body.events;
    const found = privateEvents.find(event => event.type === 'ASSISTANT_MESSAGE').data.citations[0];
    assert.deepEqual([found.kind, found.attachmentId, found.versionId], ['ATTACHMENT', attachment.attachmentId, attachment.versionId]);
    assert.match(found.excerpt, /allows 13 units/);
    const privateLink = privatePath + '/turns/' + byContent.body.turn.id + '/citations/' + found.id;
    const redirect = await fetch(base + '/api/v1' + privateLink + '?open=1', { redirect: 'manual', headers: { Authorization: 'Bearer ' + token } });
    assert.equal(redirect.status, 303);
    const route = new URL(redirect.headers.get('Location'), base);
    assert.equal(route.searchParams.get('revision'), attachment.versionId);
    assert.equal(route.searchParams.get('line'), String(found.startLine));

    const privateGate = { started: Promise.withResolvers(), release: Promise.withResolvers() };
    hold = privateGate;
    const privateCursor = (await api(privatePath + '/events')).body.next;
    const contextualTurn = await api(privatePath + '/turns', 'POST', { question: 'Use the exact attachment line',
        context: [{ attachmentId: attachment.attachmentId, versionId: attachment.versionId, line: 2 }] },
    { 'Idempotency-Key': 'attachment-removal-in-flight' });
    assert.equal(contextualTurn.status, 202);
    await Promise.race([privateGate.started.promise, delay(3000).then(() => assert.fail('Private attachment was not retrieved'))]);
    const rangedExcerpt = prompts.at(-1).evidence.find(item => item.kind === 'ATTACHMENT');
    assert.match(rangedExcerpt.excerpt, /^UniqueAttachmentMarker/);
    assert.equal(rangedExcerpt.startLine, 2);
    const receiving = await call(privatePath + '/events', 'GET', undefined, { Accept: 'text/event-stream', 'Last-Event-ID': String(privateCursor) });
    const remove = { 'Idempotency-Key': 'remove-file' };
    const change = { action: 'remove', revision: 0 };
    try {
        const removed = await api(attachmentPath, 'POST', change, remove);
        assert.equal(removed.body.revision, 1);
        assert.deepEqual((await api(attachmentPath, 'POST', change, remove)).body, removed.body);
        assert.match(await receiving.text(), /ASK_SCOPE_ACCESS_CHANGED/);
    } finally { privateGate.release.resolve(); }
    assert.equal((await api(privatePath + '/events')).body.error, 'ASK_ATTACHMENT_REMOVED');
    assert.equal((await api(privatePath + '/context')).body.error, 'ASK_ATTACHMENT_REMOVED');
    assert.equal((await api(privateLink)).status, 404);
    assert.equal((await call(attachmentPath + '/download' + version)).status, 404);
    assert.equal((await api(privatePath + '/attachments')).body[0].versionId, attachment.versionId);
    assert.equal((await api(attachmentPath, 'POST', { action: 'restore', revision: 1 }, remove)).status, 409);
    const restored = await api(attachmentPath, 'POST', { action: 'restore', revision: 1 }, { 'Idempotency-Key': 'restore-file' });
    assert.equal(restored.body.revision, 2);
    assert.equal((await api(privateLink)).body.versionId, attachment.versionId);
    assert.equal((await api(attachmentPath + version)).body.text, privateText);
    const stoppedPrivate = await terminal(privatePath + '/turns/' + contextualTurn.body.turn.id, pending);
    assert.equal(stoppedPrivate.status, 'FAILED');
    await stop();
    const expiry = new DatabaseSync(join(temp, 'index.db'));
    try { expiry.prepare('UPDATE ask_session SET expires_at = 0 WHERE id = ?').run(privateCreated.body.id); }
    finally { expiry.close(); }
    await start();
    assert.equal((await api(privatePath + '/attachments')).status, 404);
    const reclaimed = new DatabaseSync(join(temp, 'index.db'), { readOnly: true });
    try {
        assert.equal(reclaimed.prepare('SELECT 1 FROM ask_attachment WHERE id = ?').get(attachment.attachmentId), undefined);
        assert.equal(reclaimed.prepare("SELECT count(*) AS matches FROM ask_attachment_search WHERE ask_attachment_search MATCH 'UniqueAttachmentMarker'").get().matches, 0);
    } finally { reclaimed.close(); }
});
