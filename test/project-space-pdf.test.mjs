import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as wait } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import PDFDocument from 'pdfkit';

test('space PDF and CSV revisions retain original bytes and exact evidence coordinates', { timeout: 25_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'repograph-space-pdf-'));
    const storage = join(root, 'state.db');
    const token = randomBytes(24).toString('hex');
    let child, base;
    async function start() {
        child = spawn(process.execPath, ['dist/server.js'], { env: {
            ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined,
            REPOGRAPH_PORT: '0', REPOGRAPH_PROJECTS_ROOT: root, REPOGRAPH_DB_PATH: storage,
            REPOGRAPH_ASSETS_ROOT: join(root, 'assets'), REPOGRAPH_EMBEDDING_MODEL: undefined
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
    async function stop() {
        if (child?.exitCode === null && child.signalCode === null) {
            const stopped = once(child, 'exit');
            child.kill('SIGTERM');
            await stopped;
        }
    }
    t.after(async () => { await stop(); await rm(root, { recursive: true, force: true }); });
    const request = (path, { headers, ...options } = {}) => fetch(path.startsWith('/api/v1') ? base + path : base + '/api/v1' + path, {
        ...options, headers: { Authorization: 'Bearer ' + token, ...headers }
    });
    async function json(path, method = 'GET', body, headers) {
        const response = await request(path, { method, body: JSON.stringify(body), headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers
        } });
        return { status: response.status, body: await response.json() };
    }
    async function upload(path, method, key, bytes, type = 'application/pdf') {
        const response = await request(path, { method, body: bytes, headers: { 'Content-Type': type, 'Idempotency-Key': key } });
        return { status: response.status, body: await response.json() };
    }
    const font = await readFile(new URL('../resources/fonts/NotoSansSC-Regular.ttf', import.meta.url));
    async function pdf(marker, password) {
        const doc = new PDFDocument({ margin: 48, ...(password ? { userPassword: password } : {}) });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        const complete = once(doc, 'end');
        doc.font(font).fontSize(18).text('Warehouse cover');
        doc.addPage().font(font).fontSize(16).text('仓储操作记录').moveDown().text(marker, { continued: true }).text(' receives 42 crates.');
        doc.addPage().rect(48, 48, 120, 70).fill('#3B617E');
        doc.end();
        await complete;
        return Buffer.concat(chunks);
    }

    await start();
    const space = await json('/spaces', 'POST', { name: 'Document fixture' });
    assert.equal(space.status, 201);
    const path = '/spaces/' + space.body.id;
    const documents = path + '/documents';
    const legacyText = '\uFEFFheading\r\nlegacy body\r\n';
    const old = await json(documents, 'POST', { name: 'legacy.md', key: 'legacy', markdown: legacyText });
    await stop();
    const preUpgrade = new DatabaseSync(storage);
    preUpgrade.exec(`ALTER TABLE project_space_document_version DROP COLUMN pdf_page_index;
        ALTER TABLE project_space_document_version DROP COLUMN csv_format;`);
    preUpgrade.close();
    await start();
    const legacy = await json(documents + '/' + old.body.id);
    assert.equal(legacy.body.markdown, legacyText);
    assert.equal(legacy.body.version.encoding, 'UTF-8');

    const csv = Buffer.from('\uFEFFsku,note,count\r\n42,"中文, tracked\r\nacross lines",2\r\n43,"quoted ""edge""",3');
    const createdCsv = await upload(documents + '?name=Stock.csv', 'POST', 'create-csv', csv, 'text/csv');
    assert.equal(createdCsv.status, 201, JSON.stringify(createdCsv.body));
    const table = createdCsv.body;
    assert.equal(table.mediaType, 'text/csv');
    assert.deepEqual(table.csvRows, [['sku', 'note', 'count'], ['42', '中文, tracked\r\nacross lines', '2'], ['43', 'quoted "edge"', '3']]);
    const tablePath = documents + '/' + table.id;
    const tableRevision = versionId => tablePath + '/versions/' + versionId;
    const initialTable = tableRevision(table.version.id);
    assert.deepEqual(Buffer.from(await (await request(initialTable + '/export')).arrayBuffer()), csv);
    const patch = { key: 'change-cell', baseVersionId: table.version.id, edits: [{ row: 2, column: 3, value: '4,000' }] };
    const [changed, repeated] = await Promise.all([json(tablePath + '/cells', 'PATCH', patch), json(tablePath + '/cells', 'PATCH', patch)]);
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.version.id, repeated.body.version.id);
    assert.equal(changed.body.csvRows[1][2], '4,000');
    const edited = Buffer.from(csv.toString().replace(',2\r\n', ',"4,000"\r\n'));
    assert.deepEqual(Buffer.from(await (await request(tableRevision(changed.body.version.id) + '/export')).arrayBuffer()), edited);
    assert.deepEqual(Buffer.from(await (await request(initialTable + '/export')).arrayBuffer()), csv);
    assert.equal((await json(tablePath + '/cells', 'PATCH', { ...patch, key: 'stale-cell' })).status, 409);
    const reverted = await json(tablePath + '/restore', 'POST', { key: 'table-restore', baseVersionId: changed.body.version.id,
        restoreVersionId: table.version.id });
    assert.equal(reverted.status, 200, JSON.stringify(reverted.body));
    assert.deepEqual(reverted.body.csvRows, table.csvRows);
    assert.equal((await upload(documents + '?name=broken.csv', 'POST', 'broken-table', Buffer.from('a,"unfinished'), 'text/csv')).body.error, 'CSV_INVALID');
    assert.equal((await upload(documents + '?name=broken.csv', 'POST', 'binary-table', Buffer.from([0xff]), 'text/csv')).body.error, 'CSV_INVALID_ENCODING');
    assert.deepEqual((await json(documents + '/search?q=tracked')).body[0].cell, { row: 2, column: 2 });
    const cellSearch = await json('/search/knowledge', 'POST', { query: 'tracked', scopes: [{ kind: 'document', spaceId: space.body.id,
        documentId: table.id, versionId: changed.body.version.id }] });
    const csvHit = cellSearch.body.results[0];
    assert.deepEqual(csvHit.cell, { row: 2, column: 2 });
    assert.match(csvHit.excerpt, /中文, tracked/);
    const csvLink = await request(csvHit.link, { redirect: 'manual' });
    assert.equal(csvLink.status, 303);
    const cellLocation = new URL(csvLink.headers.get('Location'), base);
    assert.deepEqual([cellLocation.searchParams.get('row'), cellLocation.searchParams.get('column'), cellLocation.searchParams.get('revision')],
        ['2', '2', changed.body.version.id]);
    assert.equal((await request(csvHit.link.replace('column=2', 'column=200'), { redirect: 'manual' })).status, 404);

    const original = await pdf('Frozenmarker');
    const latest = await pdf('Replacementmarker');
    const createPath = documents + '?name=Guide.pdf';
    assert.equal((await upload(createPath, 'POST', 'broken', Buffer.from('%PDF-1.7\nNot a file'))).body.error, 'PDF_INVALID');
    assert.equal((await upload(createPath, 'POST', 'locked', await pdf('secret', 'fixture-password'))).body.error, 'PDF_PASSWORD_REQUIRED');
    const [first, replay] = await Promise.all([upload(createPath, 'POST', 'original', original), upload(createPath, 'POST', 'original', original)]);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(replay.body.version.id, first.body.version.id);
    assert.equal(first.body.mediaType, 'application/pdf');
    assert.equal(first.body.kind, 'PDF');
    assert.equal(first.body.version.bytes, original.length);
    assert.equal(first.body.version.pageCount, 3);
    assert.equal(first.body.version.encoding, null);
    assert.match(first.body.pdfPages[1].text, /仓储操作记录[\s\S]*Frozenmarker receives 42 crates/);
    assert.deepEqual(first.body.pdfPages[2], { text: '', truncated: false });
    const id = first.body.id;
    const initialVersion = first.body.version.id;
    const document = documents + '/' + id;
    const initialExport = document + '/versions/' + initialVersion + '/export';
    let exported = await request(initialExport);
    assert.equal(exported.headers.get('Content-Type'), 'application/pdf');
    assert.match(exported.headers.get('Content-Disposition'), /\.pdf"$/);
    assert.deepEqual(Buffer.from(await exported.arrayBuffer()), original);
    assert.equal((await request(initialExport, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
    assert.equal((await json(document, 'PUT', { baseVersionId: initialVersion, key: 'wrong-format', markdown: '# Convert' })).body.error, 'DOCUMENT_FORMAT_READ_ONLY');
    assert.equal((await upload(createPath, 'POST', 'original', latest)).body.error, 'IDEMPOTENCY_KEY_CONFLICT');
    assert.equal((await json(documents + '/search?q=Frozenmarker')).body[0].page, 2);
    const search = await json('/search/knowledge', 'POST', { query: 'Frozenmarker', scopes: [{ kind: 'space', spaceId: space.body.id }] });
    assert.equal(search.status, 200, JSON.stringify(search.body));
    const hit = search.body.results.find(item => item.versionId === initialVersion);
    assert.equal(hit.page, 2);
    assert.match(hit.excerpt, /Frozenmarker/);
    const opened = await request(hit.link, { redirect: 'manual' });
    assert.equal(opened.status, 303);
    const location = new URL(opened.headers.get('Location'), base);
    assert.equal(location.searchParams.get('page'), '2');
    assert.equal(location.searchParams.get('revision'), initialVersion);
    assert.equal((await request(hit.link.replace('page=2', 'page=4'), { redirect: 'manual' })).status, 404);

    const frozen = await json('/ask/sessions', 'POST', { scopes: [{ spaceId: space.body.id, documentId: id }] });
    assert.equal(frozen.status, 201);
    const replace = await upload(document + '?baseVersionId=' + initialVersion, 'PUT', 'replace', latest);
    assert.equal(replace.status, 200, JSON.stringify(replace.body));
    assert.equal(replace.body.id, id);
    assert.notEqual(replace.body.version.id, initialVersion);
    assert.match(replace.body.pdfPages[1].text, /Replacementmarker/);
    assert.equal((await json(documents + '/search?q=Frozenmarker')).body.length, 0);
    assert.equal((await upload(document + '?baseVersionId=' + initialVersion, 'PUT', 'stale', latest)).body.error, 'DOCUMENT_VERSION_CHANGED');
    assert.equal((await upload(documents + '/' + old.body.id + '?baseVersionId=' + old.body.version.id, 'PUT', 'mistyped', latest)).body.error,
        'DOCUMENT_FORMAT_MISMATCH');

    const provider = createServer(async (incoming, response) => {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const payload = JSON.parse(Buffer.concat(chunks));
        const prompt = JSON.parse(payload.messages.at(-1).content);
        const citations = prompt.evidence.map(item => item.id);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ message: { content: JSON.stringify({ answer: 'The document records 42 crates.', citations }) },
            prompt_eval_count: 81, eval_count: 24, done_reason: 'stop' }));
    }).listen(0, '127.0.0.1');
    await once(provider, 'listening');
    t.after(() => { provider.closeAllConnections(); return new Promise(resolve => provider.close(resolve)); });
    const model = await json('/admin/model-providers/legacy-ollama', 'PUT', { name: 'Fixture model', protocol: 'OLLAMA',
        baseUrl: 'http://127.0.0.1:' + provider.address().port, model: 'fixture', enabled: true, timeoutMillis: 10_000, maxOutputTokens: 1000 });
    assert.equal(model.status, 200);
    const documentRef = { spaceId: space.body.id, documentId: table.id, versionId: changed.body.version.id };
    const csvAsk = '/ask/sessions/' + (await json('/ask/sessions', 'POST', { scopes: [documentRef] })).body.id;
    const badCell = await json(csvAsk + '/turns', 'POST', { question: 'Read the exact cell', context: [{ ...documentRef, cell: { row: 2, column: 9 } }] },
        { 'Idempotency-Key': 'invalid-cell' });
    assert.equal(badCell.body.error, 'ASK_CONTEXT_CELL_OUT_OF_RANGE');
    const csvTurn = await json(csvAsk + '/turns', 'POST', { question: 'What was tracked?', context: [{ ...documentRef, cell: { row: 2, column: 3 } }] },
        { 'Idempotency-Key': 'valid-cell' });
    assert.equal(csvTurn.status, 202, JSON.stringify(csvTurn.body));
    let csvRecord;
    for (let i = 0; i < 240; i++) {
        csvRecord = (await json(csvAsk + '/turns/' + csvTurn.body.turn.id)).body;
        if (!['QUEUED', 'RUNNING'].includes(csvRecord.status)) break;
        await wait(25);
    }
    assert.equal(csvRecord.status, 'COMPLETED', JSON.stringify(csvRecord));
    const csvReferences = (await json(csvAsk + '/events')).body.events.find(item => item.type === 'ASSISTANT_MESSAGE').data.citations;
    const csvReference = csvReferences.find(item => item.cell?.column === 3);
    assert.match(csvReference.excerpt, /4,000/);
    assert.ok(csvReferences.some(item => item.cell?.column === 2 && item.cell.row === 2));
    const cellCitation = await request(csvAsk + '/turns/' + csvTurn.body.turn.id + '/citations/' + csvReference.id + '?open=1', { redirect: 'manual' });
    const citedCell = new URL(cellCitation.headers.get('Location'), base);
    assert.deepEqual([citedCell.searchParams.get('row'), citedCell.searchParams.get('column'), citedCell.searchParams.get('revision')],
        ['2', '3', changed.body.version.id]);
    const session = '/ask/sessions/' + frozen.body.id;
    const turn = await json(session + '/turns', 'POST', { question: 'Frozenmarker', context: [
        { spaceId: space.body.id, documentId: id, versionId: initialVersion, page: 2 }
    ] }, { 'Idempotency-Key': 'pdf-question' });
    assert.equal(turn.status, 202, JSON.stringify(turn.body));
    let record;
    for (let i = 0; i < 240; i++) {
        record = (await json(session + '/turns/' + turn.body.turn.id)).body;
        if (!['QUEUED', 'RUNNING'].includes(record.status)) break;
        await wait(25);
    }
    assert.equal(record.status, 'COMPLETED', JSON.stringify(record));
    const events = (await json(session + '/events')).body.events;
    const citation = events.find(item => item.type === 'ASSISTANT_MESSAGE').data.citations.find(item => item.kind === 'DOCUMENT');
    assert.equal(citation.page, 2);
    assert.equal(citation.versionId, initialVersion);
    assert.match(citation.excerpt, /Frozenmarker/);
    const citationOpen = await request(session + '/turns/' + turn.body.turn.id + '/citations/' + citation.id + '?open=1', { redirect: 'manual' });
    assert.equal(citationOpen.status, 303);
    assert.match(citationOpen.headers.get('Location'), /[?&]page=2(?:&|$)/);
    const priorContext = await json(session + '/context');
    assert.equal(priorContext.status, 200);
    assert.equal(priorContext.body.messages.find(item => item.role === 'assistant').citations[0].page, 2);
    const env = { REPOGRAPH_BASE_URL: base, REPOGRAPH_ACCESS_TOKEN: token };
    const argumentsJson = JSON.stringify({ sessionId: frozen.body.id });
    const cli = await promisify(execFile)(process.execPath, ['dist/cli.js', 'read_ask_context', argumentsJson], { env });
    assert.deepEqual(JSON.parse(cli.stdout), priorContext.body);
    const edit = { spaceId: space.body.id, documentId: table.id, baseVersionId: reverted.body.version.id,
        key: 'csv-shared-client', edits: [{ row: 3, column: 3, value: '' }] };
    const csvCli = await promisify(execFile)(process.execPath, ['dist/cli.js', 'edit_space_csv', JSON.stringify(edit)], { env });
    const csvFinal = JSON.parse(csvCli.stdout);
    assert.equal(csvFinal.csvRows[2][2], '');
    const client = new Client({ name: 'PDF fixture', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/mcp.js'], env }));
    try {
        const output = await client.callTool({ name: 'read_ask_context', arguments: JSON.parse(argumentsJson) });
        assert.equal(output.isError, false);
        assert.deepEqual(output.structuredContent.body, priorContext.body);
        const tableOutput = await client.callTool({ name: 'edit_space_csv', arguments: edit });
        assert.equal(tableOutput.isError, false);
        assert.deepEqual(tableOutput.structuredContent.body, csvFinal);
    } finally { await client.close(); }
    const follow = await json(session + '/turns', 'POST', { question: '请继续说明？' }, { 'Idempotency-Key': 'pdf-followup' });
    assert.equal(follow.status, 202, JSON.stringify(follow.body));
    for (let i = 0; i < 240; i++) {
        record = (await json(session + '/turns/' + follow.body.turn.id)).body;
        if (!['QUEUED', 'RUNNING'].includes(record.status)) break;
        await wait(25);
    }
    assert.equal(record.status, 'COMPLETED', JSON.stringify(record));
    const followed = (await json(session + '/events')).body.events.filter(item => item.turnId === follow.body.turn.id);
    const evidence = followed.find(item => item.type === 'EVIDENCE').data;
    assert.equal(evidence.coverage.documentMatches, 0);
    assert.equal(evidence.coverage.carriedCitations, 1);
    assert.equal(evidence.citations[0].versionId, initialVersion);
    assert.equal(evidence.citations[0].page, 2);

    const privateInput = { attachments: [{ name: 'Private guide.pdf', pdfBase64: original.toString('base64') }] };
    const submittedPrivate = await json('/ask/sessions', 'POST', privateInput, { 'Idempotency-Key': 'private-pdf' });
    assert.equal(submittedPrivate.status, 201, JSON.stringify(submittedPrivate.body));
    assert.equal((await json('/ask/sessions', 'POST', privateInput, { 'Idempotency-Key': 'private-pdf' })).body.id, submittedPrivate.body.id);
    const [privateFile] = submittedPrivate.body.scope.attachments;
    assert.equal(privateFile.bytes, original.length);
    assert.equal(JSON.stringify(submittedPrivate.body).includes(privateInput.attachments[0].pdfBase64), false);
    const privateSession = '/ask/sessions/' + submittedPrivate.body.id;
    assert.equal((await json(privateSession + '/attachments')).body[0].pageCount, 3);
    const filePath = privateSession + '/attachments/' + privateFile.attachmentId;
    const privateVersion = '?versionId=' + privateFile.versionId;
    const privatePreview = await json(filePath + privateVersion);
    assert.deepEqual(privatePreview.body.pdfPages, first.body.pdfPages);
    const privateDownload = filePath + '/download' + privateVersion;
    const privateOriginal = await request(privateDownload);
    assert.equal(privateOriginal.headers.get('Content-Type'), 'application/pdf');
    assert.deepEqual(Buffer.from(await privateOriginal.arrayBuffer()), original);
    assert.equal((await json(session + '/attachments/' + privateFile.attachmentId + privateVersion)).status, 404);
    const exact = { attachmentId: privateFile.attachmentId, versionId: privateFile.versionId, page: 2 };
    assert.equal((await json(privateSession + '/turns', 'POST', { question: 'Read page', context: [{ ...exact, page: 4 }] },
        { 'Idempotency-Key': 'invalid-page' })).body.error, 'ASK_CONTEXT_PAGE_OUT_OF_RANGE');
    const privateTurn = await json(privateSession + '/turns', 'POST', { question: 'Frozenmarker', context: [exact] },
        { 'Idempotency-Key': 'private-page' });
    assert.equal(privateTurn.status, 202, JSON.stringify(privateTurn.body));
    for (let i = 0; i < 240; i++) {
        record = (await json(privateSession + '/turns/' + privateTurn.body.turn.id)).body;
        if (!['QUEUED', 'RUNNING'].includes(record.status)) break;
        await wait(25);
    }
    assert.equal(record.status, 'COMPLETED', JSON.stringify(record));
    const privateEvents = (await json(privateSession + '/events')).body.events;
    const attachmentCitation = privateEvents.find(item => item.type === 'ASSISTANT_MESSAGE').data.citations[0];
    assert.equal(attachmentCitation.kind, 'ATTACHMENT');
    assert.equal(attachmentCitation.page, 2);
    const attachmentCitationPath = privateSession + '/turns/' + privateTurn.body.turn.id + '/citations/' + attachmentCitation.id;
    const attachmentLink = await request(attachmentCitationPath + '?open=1', { redirect: 'manual' });
    assert.equal(attachmentLink.status, 303);
    assert.equal(new URL(attachmentLink.headers.get('Location'), base).searchParams.get('page'), '2');
    assert.equal((await json(filePath, 'POST', { action: 'remove', revision: 0 }, { 'Idempotency-Key': 'remove-pdf' })).status, 200);
    assert.equal((await request(privateDownload)).status, 404);
    assert.equal((await json(attachmentCitationPath)).status, 404);
    assert.equal((await json(filePath, 'POST', { action: 'restore', revision: 1 }, { 'Idempotency-Key': 'restore-pdf' })).status, 200);
    assert.deepEqual((await json(attachmentCitationPath)).body, attachmentCitation);

    const restoredVersion = await json(document + '/restore', 'POST', { baseVersionId: replace.body.version.id,
        restoreVersionId: initialVersion, key: 'restore-version' });
    assert.equal(restoredVersion.status, 200, JSON.stringify(restoredVersion.body));
    assert.deepEqual(restoredVersion.body.pdfPages, first.body.pdfPages);
    assert.notEqual(restoredVersion.body.version.id, initialVersion);
    const deleted = await json(path + '/items/' + id, 'DELETE');
    assert.equal(deleted.status, 200);
    assert.equal((await request(initialExport)).status, 404);
    assert.equal((await json(session + '/context')).status, 404);
    const recycle = path + '/trash/' + deleted.body.id;
    const recovered = await json(recycle + '/restore', 'POST', {});
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    await stop();
    await start();
    exported = await request(initialExport);
    assert.deepEqual(Buffer.from(await exported.arrayBuffer()), original);
    assert.match((await json(document)).body.pdfPages[1].text, /Frozenmarker/);
    assert.deepEqual(Buffer.from(await (await request(privateDownload)).arrayBuffer()), original);
    assert.deepEqual((await json(tableRevision(csvFinal.version.id))).body.csvRows, csvFinal.csvRows);
});
