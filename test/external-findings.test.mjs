import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('external scan imports normalize locations, deduplicate reports and freeze related change evidence', { timeout: 20_000 }, async t => {
    const folder = await realpath(await mkdtemp(join(tmpdir(), 'repograph-findings-')));
    const roots = [join(folder, 'source'), join(folder, 'other')];
    const path = 'src/order file.ts';
    for (const root of roots) {
        await mkdir(join(root, 'src'), { recursive: true });
        await writeFile(join(root, path), 'export function computeOrder() {\n    return 2;\n}\n');
    }
    const token = randomBytes(32).toString('hex');
    const githubToken = randomBytes(32).toString('hex');
    const githubRequests = [];
    let githubBase;
    const github = createServer(async (request, response) => {
        let body = '';
        for await (const chunk of request) body += chunk;
        githubRequests.push({ method: request.method, path: request.url, authenticated: request.headers.authorization === 'Bearer ' + githubToken,
            comment: body ? JSON.parse(body).body : undefined });
        if (request.method === 'GET' && /\/pulls\/(42|43|44)$/.test(request.url)) {
            response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
        } else if (request.url.endsWith('/issues/42/comments')) {
            response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({
                html_url: 'https://127.0.0.1/fixture/labels/pull/42#issuecomment-7'
            }));
        } else if (request.url.endsWith('/issues/43/comments')) {
            response.writeHead(307, { Location: githubBase + '/redirected' }).end();
        } else if (request.url.endsWith('/issues/44/comments')) {
            response.writeHead(201, { 'Content-Type': 'application/json' }).end('{}');
        } else response.writeHead(404).end();
    });
    github.listen(0, '127.0.0.1');
    await once(github, 'listening');
    githubBase = 'http://127.0.0.1:' + github.address().port;
    let child, base;
    async function stop() {
        if (!child || child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
    }
    t.after(async () => {
        await stop();
        await new Promise(resolve => github.close(resolve));
        await rm(folder, { recursive: true, force: true });
    });
    async function start(publishing = true) {
        child = spawn(process.execPath, ['dist/server.js'], { env: { ...process.env, REPOGRAPH_ACCESS_TOKEN: token,
            REPOGRAPH_ADMIN_PASSWORD: undefined, REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_PORT: '0', REPOGRAPH_PROJECTS_ROOT: folder,
            REPOGRAPH_GITHUB_TOKEN: publishing ? githubToken : undefined, REPOGRAPH_GITHUB_API_BASE_URL: githubBase + '/api/v3',
            REPOGRAPH_DB_PATH: join(folder, 'index.db'), REPOGRAPH_ASSETS_ROOT: join(folder, 'assets') }, stdio: ['ignore', 'ignore', 'pipe'] });
        base = await new Promise((resolve, reject) => {
            let stderr = '';
            child.once('error', reject);
            child.once('exit', code => reject(new Error('Server exited (' + code + '): ' + stderr)));
            child.stderr.on('data', bytes => {
                stderr += bytes;
                const address = stderr.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
                if (address) resolve(address);
            });
        });
    }
    async function request(route, args = {}, body, options = {}) {
        const response = await fetch(base + '/api/v1' + route + '?' + new URLSearchParams(args), {
            method: options.method ?? (body === undefined ? 'GET' : 'POST'),
            headers: { ...(options.authorized !== false ? { Authorization: 'Bearer ' + token } : {}),
                ...(body === undefined ? {} : { 'Content-Type': options.mime ?? 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const type = response.headers.get('content-type');
        return { status: response.status, body: type?.includes('json') ? await response.json() : /application\/(pdf|zip)/.test(type ?? '')
            ? Buffer.from(await response.arrayBuffer()) : await response.text() };
    }

    await start();
    for (const root of roots) assert.equal((await request('/index/file', { file: join(root, path), projectRoot: root }, undefined, { method: 'POST' })).status, 200);
    const projects = (await request('/projects')).body;
    const [projectId, otherId] = roots.map(root => projects.find(project => project.projectRoot === root).projectId);
    const endpoint = '/triage/findings/import';
    const args = { projectId, format: 'semgrep', codeVersion: 'target-v1' };
    const secret = 'fixture-do-not-persist';
    const result = { check_id: 'fixture.order-review', path, start: { line: 2 }, end: { line: 2 },
        extra: { message: 'Please review this result. api_key="' + secret + '"', severity: 'WARNING', lines: secret,
            metadata: { cwe: ['CWE-123: Fixture'] } } };
    const report = { results: [result, { ...result, path: '../outside.ts' }, { ...result, path: 'elsewhere.ts', start: { line: 0 } }] };
    const publishPath = '/triage/report/pr';
    const pull = { ...args, owner: 'fixture', repo: 'labels', prNumber: 42 };
    const reviewUpload = { results: [{ ...result, extra: { ...result.extra, message: result.extra.message + ' @fixture-user' } }] };
    assert.equal((await request(publishPath, pull, reviewUpload, { authorized: false })).status, 401);
    assert.equal((await request(publishPath, { ...pull, repo: '..' }, reviewUpload)).status, 400);
    assert.equal((await request(publishPath, { ...pull, projectId: '1234567890ab' }, reviewUpload)).status, 404);
    assert.equal(githubRequests.length, 0);
    const published = await request(publishPath, pull, reviewUpload);
    assert.equal(published.status, 200);
    assert.equal(published.body.commentUrl, 'https://127.0.0.1/fixture/labels/pull/42#issuecomment-7');
    assert.equal(published.body.findingsCount, 1);
    const previewToPublish = await request('/triage/report', args, reviewUpload);
    assert.deepEqual(published.body.reports, previewToPublish.body);
    assert.deepEqual(githubRequests.map(({ method, path, authenticated }) => [method, path, authenticated]), [
        ['GET', '/api/v3/repos/fixture/labels/pulls/42', true],
        ['POST', '/api/v3/repos/fixture/labels/issues/42/comments', true]
    ]);
    const { comment } = githubRequests[1];
    assert.match(comment, /RepoGraph SAST triage[\s\S]*NEEDS_REVIEW × 1/);
    assert.match(comment, /&#64;fixture\\-user/);
    assert.doesNotMatch(comment, /fixture-do-not-persist|return 2|@fixture-user/);
    assert.deepEqual((await request('/triage/findings', { projectId })).body.findings, []);
    githubRequests.length = 0;
    assert.deepEqual(await request(publishPath, { ...pull, prNumber: 40 }, reviewUpload),
        { status: 404, body: { error: 'GITHUB_PR_NOT_FOUND' } });
    assert.deepEqual(await request(publishPath, { ...pull, prNumber: 43 }, reviewUpload),
        { status: 502, body: { error: 'GITHUB_COMMENT_FAILED' } });
    assert.deepEqual(await request(publishPath, { ...pull, prNumber: 44 }, reviewUpload),
        { status: 502, body: { error: 'GITHUB_COMMENT_UNCONFIRMED' } });
    assert.deepEqual(githubRequests.map(({ method, path }) => method + ' ' + path), [
        'GET /api/v3/repos/fixture/labels/pulls/40',
        'GET /api/v3/repos/fixture/labels/pulls/43', 'POST /api/v3/repos/fixture/labels/issues/43/comments',
        'GET /api/v3/repos/fixture/labels/pulls/44', 'POST /api/v3/repos/fixture/labels/issues/44/comments'
    ]);
    assert.equal((await request(endpoint, args, report, { authorized: false })).status, 401);
    const imported = await request(endpoint, args, report);
    assert.equal(imported.status, 200);
    assert.equal(imported.body.imported, 1);
    assert.deepEqual(imported.body.skipped.map(item => item.reason), ['UNSAFE_FINDING_PATH', 'INVALID_FINDING_RANGE']);
    const fingerprint = createHash('sha256').update('semgrep|fixture.order-review|' + path + '|2').digest('hex').slice(0, 16);
    const entry = `/triage/findings/${fingerprint}`;
    const first = (await request(entry, { projectId })).body;
    assert.deepEqual([first.finding.fingerprint, first.finding.severity, first.finding.cwe, first.finding.codeVersion],
        [fingerprint, 'MEDIUM', 'CWE-123', 'target-v1']);
    assert.equal(first.report.locatedQualifiedName, 'computeOrder');
    assert.equal(first.report.verdict, 'NEEDS_REVIEW');
    assert.doesNotMatch(JSON.stringify(first), /fixture-do-not-persist/);
    const preview = await request('/triage/report', { ...args }, { results: [{
        ...result, check_id: 'preview-only', extra: { ...result.extra, message: 'Review <b>literal</b>\n# Unexpected heading' }
    }] });
    assert.equal(preview.body[0].report.locatedQualifiedName, 'computeOrder');
    assert.match(preview.body[0].markdown, /## Evidence/);
    assert.match(preview.body[0].markdown, /C1.*computeOrder.*order file\.ts/);
    assert.match(preview.body[0].markdown, /## Missing information[\s\S]*FINDING\\_REPORT\\_VERSION\\_UNVERIFIED/);
    assert.match(preview.body[0].markdown, /confidence 0\.50/);
    assert.match(preview.body[0].markdown, /&lt;b&gt;literal&lt;\/b&gt;/);
    assert.doesNotMatch(preview.body[0].markdown, /^# Unexpected heading$/m);
    assert.equal((await request('/triage/findings/' + preview.body[0].fingerprint, { projectId })).status, 404);
    assert.equal((await request(entry, { projectId: otherId })).status, 404);
    assert.equal((await request(endpoint, args, { results: [{ ...result, extra: { message: 'replacement' } }] })).body.duplicates, 1);
    assert.deepEqual((await request(entry, { projectId })).body, first);

    const sarif = { version: '2.1.0', runs: [{ tool: { driver: { name: 'CodeQL', rules: [{ id: 'fixture/rule', properties: { tags: ['external/cwe/cwe-079'] } }] } },
        originalUriBaseIds: { '%SRCROOT%': { uri: 'file:///ci/checkout/' } }, artifacts: [{ location: { uri: 'src/order%20file.ts', uriBaseId: '%SRCROOT%' } }],
        results: [{ ruleIndex: 0, level: 'note', message: { text: 'Imported artifact reference' }, locations: [{ physicalLocation: {
            artifactLocation: { index: 0 }, region: { startLine: 2 } } }] }, { ruleId: 'external', locations: [{ physicalLocation: {
                artifactLocation: { uri: 'https://external.example/report.ts' }, region: { startLine: 3 } } }] }] }] };
    const sarifImport = await request(endpoint, { projectId, format: 'sarif', codeVersion: 'older-v0' }, sarif, { mime: 'application/sarif+json' });
    assert.equal(sarifImport.body.imported, 1);
    assert.deepEqual(sarifImport.body.skipped.map(item => item.reason), ['UNSAFE_FINDING_PATH']);
    const list = (await request('/triage/findings', { projectId, limit: 1 })).body;
    assert.equal(list.total, 2);
    assert.equal(list.findings.length, 1);
    const [codeql] = (await request('/triage/findings', { projectId, tool: 'CodeQL' })).body.findings;
    assert.deepEqual([codeql.ruleId, codeql.filePath, codeql.severity, codeql.cwe], ['fixture/rule', path, 'INFO', 'CWE-79']);
    const detector = { check: 'fixture-contract-label', impact: 'Informational', description: 'Review this contract label',
        elements: [{ name: 'computeOrder', source_mapping: { filename_relative: 'contracts/Example.sol', lines: [7, 5, 6] } }],
        additional_fields: { raw: secret } };
    const slither = { success: true, results: { detectors: [detector, { ...detector, elements: [
        { source_mapping: { filename_relative: '../outside.sol', lines: [1] } }
    ] }] } };
    const slitherArgs = { projectId, format: 'slither' };
    const slitherImport = await request(endpoint, slitherArgs, slither);
    assert.equal(slitherImport.status, 200);
    assert.equal(slitherImport.body.imported, 1);
    assert.deepEqual(slitherImport.body.skipped.map(item => item.reason), ['UNSAFE_FINDING_PATH']);
    const [contract] = (await request('/triage/findings', { projectId, tool: 'slither' })).body.findings;
    assert.deepEqual([contract.filePath, contract.startLine, contract.endLine, contract.severity],
        ['contracts/Example.sol', 5, 7, 'INFO']);
    assert.equal(contract.trace[0].legacyKind, 'context-unavailable');
    const contractReport = (await request('/triage/findings/' + contract.fingerprint, { projectId })).body.report;
    assert.equal(contractReport.located, false);
    assert.deepEqual(contractReport.pack.evidence, []);
    assert.ok(contractReport.missingInfo.includes('SOLIDITY_INDEX_UNAVAILABLE'));
    assert.doesNotMatch(JSON.stringify(contractReport), /fixture-do-not-persist/);
    assert.equal((await request(endpoint, slitherArgs, slither)).body.duplicates, 1);
    assert.equal((await request(endpoint, slitherArgs, { ...slither, success: false })).status, 400);

    const protectedPath = 'src/label-display.ts';
    const protectedFile = join(roots[0], protectedPath);
    await writeFile(protectedFile, [
        'export function labelDisplay(label, reader) {',
        '    const draft = label; // prepareStatement in a comment is not evidence',
        '    const prepared = reader.prepareStatement(draft);',
        '    return reader.executeUpdate(prepared);',
        '}',
        'export function showLabel(label, reader) { return labelDisplay(label, reader); }',
        ''
    ].join('\n'));
    assert.equal((await request('/index/file', { file: protectedFile, projectRoot: roots[0] }, undefined, { method: 'POST' })).status, 200);
    const physicalLocation = line => ({ artifactLocation: { uri: protectedPath }, region: { startLine: line } });
    const step = (kind, line) => ({ kinds: [kind], location: { physicalLocation: physicalLocation(line) } });
    const claimedProtection = [step('source', 2), step('sanitizer', 3), step('sink', 4)];
    const reportForPaths = (...paths) => ({ version: '2.1.0', runs: [{
        tool: { driver: { name: 'ReviewFixture' } }, results: [{ ruleId: 'fixture.label',
            properties: { cwe: 'CWE-89' }, message: { text: 'Review the labels adapter' },
            locations: [{ physicalLocation: physicalLocation(4) }],
            codeFlows: paths.map(locations => ({ threadFlows: [{ locations }] }))
        }]
    }] });
    async function assessProtection(...paths) {
        const value = await request('/triage/report', { projectId, format: 'sarif' }, reportForPaths(...paths));
        assert.equal(value.status, 200);
        return value.body[0];
    }
    const safeCandidate = await assessProtection(claimedProtection);
    assert.equal(safeCandidate.report.verdict, 'NEEDS_REVIEW');
    assert.deepEqual(safeCandidate.report.pack.evidence.map(item => [item.qualifiedName, item.relation]),
        [['labelDisplay', 'SEED'], ['showLabel', 'CALLER']]);
    assert.deepEqual(safeCandidate.finding.trace.map(item => [item.kind, item.path]),
        [['source', 1], ['protection', 1], ['sink', 1]]);
    assert.deepEqual(safeCandidate.report.decisionEvidence.map(item => [item.source, item.reference, item.applied]),
        [['PATH_PROTECTION', 'C1', true]]);
    assert.match(safeCandidate.markdown, /PATH\\_PROTECTION · Applied · C1/);
    assert.ok(safeCandidate.report.missingInfo.includes('FINDING_PROTECTION_RUNTIME_UNVERIFIED'));
    for (const paths of [
        [[step('source', 1), step('guard', 2), step('sink', 4)]],
        [[step('sanitizer', 3), step('source', 2), step('sink', 4)]],
        [[step('source', 1), step('guard', 3), step('source', 2), step('sink', 4)]],
        [[step('source', 2), step('sink', 4), step('guard', 3), step('sink', 4)]],
        [claimedProtection, [step('source', 2), step('sink', 4)]],
        [claimedProtection, [...Array.from({ length: 16 }, () => step('call', 2)), step('source', 2), step('sink', 4)]]
    ]) {
        const pending = await assessProtection(...paths);
        assert.equal(pending.report.verdict, 'TRUE_RISK');
        assert.deepEqual(pending.report.decisionEvidence.map(item => [item.reference, item.applied]), [['C1', false]]);
    }
    const coveredPaths = await assessProtection(claimedProtection, claimedProtection);
    assert.equal(coveredPaths.report.verdict, 'NEEDS_REVIEW');
    assert.match(coveredPaths.report.decisionEvidence[0].summary, /2 of 2 reported paths/);

    const diff = ['--- ' + path, '+++ ' + path, '@@ -1,3 +1,3 @@', ' export function computeOrder() {', '-    return 1;', '+    return 2;', ' }'].join('\n');
    const snap = (await request('/change-reviews', {}, { projectId, targetVersion: 'target-v1', diff })).body;
    assert.equal(snap.units[0].externalFindingReferences.length, 1);
    assert.equal(snap.units[0].externalFindingReferences[0].fingerprint, fingerprint);
    assert.equal(snap.units[0].externalFindingReferences[0].version, 'MATCHED_DECLARED_VERSION');
    assert.ok(!snap.omittedReasons.includes('EXTERNAL_FINDINGS_UNAVAILABLE'));
    assert.match((await request('/change-reviews/' + snap.id + '/export', { projectId, format: 'markdown' })).body,
        new RegExp('Imported findings[\\s\\S]+' + fingerprint));
    await stop();
    await start(false);
    const outboundCount = githubRequests.length;
    assert.deepEqual(await request(publishPath, pull, reviewUpload), { status: 502, body: { error: 'GITHUB_COMMENT_NOT_CONFIGURED' } });
    assert.equal(githubRequests.length, outboundCount);
    assert.deepEqual((await request(entry, { projectId })).body, first);
    assert.deepEqual((await request('/change-reviews/' + snap.id, { projectId })).body, snap);

    const queue = '/review-queue';
    const inventory = '/vulns';
    const beforeHealth = (await request('/metrics/report', { projectId })).body.healthScore;
    const recorded = await request(inventory + '/from-finding', { projectId }, { fingerprint });
    assert.equal(recorded.status, 200);
    assert.equal(recorded.body.status, 'SUSPECTED');
    const vulnId = recorded.body.id;
    const vuln = `${inventory}/${vulnId}`;
    assert.equal((await request(vuln, { projectId: otherId })).status, 404);
    const activeHealth = (await request('/metrics/report', { projectId })).body;
    assert.equal(activeHealth.vulnMedium, 1);
    assert.equal(activeHealth.healthScore, beforeHealth - 5);
    const submitted = await request(queue + '/snapshots', { projectId }, { fingerprints: [fingerprint] });
    assert.equal(submitted.status, 200);
    const { snapshotId, entries: [queued] } = submitted.body;
    const address = `${queue}/snapshots/${snapshotId}`;
    assert.equal(queued.status, 'PENDING');
    const frozen = (await request(address + '/export', { format: 'json' })).body;
    assert.deepEqual([frozen.schemaVersion, frozen.toolVersion, frozen.codeVersion], ['1', '0.1.0', 'target-v1']);
    assert.match(frozen.reports[0].pack.evidence[0].excerpt, /return 2/);
    const reviewEntry = `${queue}/${queued.id}`;
    const claims = await Promise.all([request(reviewEntry + '/claim', {}, { actor: 'ignored-a' }),
        request(reviewEntry + '/claim', {}, { actor: 'ignored-b' })]);
    assert.deepEqual(claims.map(item => item.status).sort(), [200, 409]);
    assert.equal((await request(reviewEntry + '/confirm', { projectId: otherId }, { reason: 'Foreign' })).status, 404);
    assert.equal((await request(reviewEntry + '/confirm', {}, { reason: '' })).status, 400);
    assert.equal((await request(reviewEntry + '/return', {}, { reason: 'Need another review' })).body.status, 'PENDING');
    assert.equal((await request(reviewEntry + '/claim', {}, {})).body.status, 'IN_REVIEW');
    assert.equal((await request(reviewEntry + '/confirm', {}, { reason: 'Outdated decision', revision: 1 })).status, 409);
    const decision = await request(reviewEntry + '/confirm', {}, { reason: '已核对索引中的返回值' });
    assert.equal(decision.body.status, 'CONFIRMED');
    assert.equal(decision.body.vulnerabilityId, vulnId);
    const afterConfirm = (await request(vuln, { projectId })).body;
    assert.equal(afterConfirm.finding.status, 'CONFIRMED');
    assert.equal(afterConfirm.finding.qualifiedName, 'computeOrder');
    assert.equal(afterConfirm.reviews[0].snapshotId, snapshotId);
    assert.deepEqual(afterConfirm.audit.map(event => event.toStatus), ['SUSPECTED', 'CONFIRMED']);
    assert.deepEqual((await request(inventory, { projectId, status: 'CONFIRMED' })).body.map(item => item.id), [vulnId]);
    const mcp = new Client({ name: 'inventory-fixture', version: '1.0.0' });
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/mcp.js'], stderr: 'pipe',
        env: { REPOGRAPH_BASE_URL: base, REPOGRAPH_ACCESS_TOKEN: token } }));
    try {
        const response = await mcp.callTool({ name: 'list_vulns', arguments: { projectId, status: 'CONFIRMED' } });
        assert.equal(response.isError, false);
        assert.deepEqual(JSON.parse(response.content[0].text).map(item => item.id), [vulnId]);
        const assessment = await mcp.callTool({ name: 'triage_finding', arguments: { projectId, fingerprint } });
        assert.equal(assessment.isError, false);
        assert.deepEqual(JSON.parse(assessment.content[0].text), first);
        const preview = await mcp.callTool({ name: 'triage_finding', arguments: { projectId, format: 'semgrep', json: JSON.stringify({ results: [result] }) } });
        assert.equal(preview.isError, false);
        assert.equal(JSON.parse(preview.content[0].text)[0].fingerprint, fingerprint);
        assert.match(JSON.parse(preview.content[0].text)[0].markdown, /## Evidence[\s\S]*C1.*computeOrder/);
        const slitherPreview = await mcp.callTool({ name: 'triage_finding',
            arguments: { ...slitherArgs, json: JSON.stringify(slither) } });
        assert.equal(slitherPreview.isError, false);
        assert.equal(JSON.parse(slitherPreview.content[0].text)[0].report.located, false);
        const feedback = await mcp.callTool({ name: 'record_triage_feedback', arguments: { projectId, fingerprint,
            status: 'FALSE_POSITIVE', reviewer: 'impersonator', reason: 'MCP fixture' } });
        assert.equal(feedback.isError, false);
        assert.equal(JSON.parse(feedback.content[0].text).reviewer, 'admin');
        const feedbackList = await mcp.callTool({ name: 'list_triage_feedback', arguments: { projectId, status: 'FALSE_POSITIVE' } });
        assert.equal(feedbackList.isError, false);
        assert.deepEqual(JSON.parse(feedbackList.content[0].text), [JSON.parse(feedback.content[0].text)]);
    } finally { await mcp.close(); }
    assert.equal((await request(inventory + '/report/' + projectId)).body.confirmedFindings[0].id, vulnId);
    const withVuln = (await request('/change-reviews', {}, { projectId, targetVersion: 'target-v1', diff })).body;
    assert.equal(withVuln.units[0].vulnerabilityReferences[0].id, vulnId);
    assert.equal(withVuln.units[0].vulnerabilityReferences[0].status, 'CONFIRMED');
    assert.equal((await request(reviewEntry + '/reject', {}, { reason: 'Late duplicate' })).status, 409);
    const audit = (await request(reviewEntry + '/audit')).body;
    assert.deepEqual(audit.map(item => [item.action, item.actor]),
        [['SUBMIT', 'admin'], ['CLAIM', 'admin'], ['RETURN', 'admin'], ['CLAIM', 'admin'], ['CONFIRM', 'admin']]);
    assert.equal(audit.at(-1).reason, '已核对索引中的返回值');
    assert.equal((await request(queue, { projectId, status: 'CONFIRMED', page: '0', size: '1' })).body.total, 1);

    const sourceFile = join(roots[0], path);
    await writeFile(sourceFile, 'export function computeOrder() {\n    return 8;\n}\n');
    assert.equal((await request('/index/file', { file: sourceFile, projectRoot: roots[0] }, undefined, { method: 'POST' })).status, 200);
    assert.match((await request(entry, { projectId })).body.report.pack.evidence[0].excerpt, /return 8/);
    assert.deepEqual((await request(address + '/export', { format: 'json' })).body, frozen);
    const bundle = (await request(address + '/review')).body;
    assert.equal(bundle.items[0].entry.status, 'CONFIRMED');
    assert.equal(bundle.items[0].reportMatchCount, 1);
    assert.deepEqual(bundle.snapshot, frozen);
    assert.match((await request(address + '/export', { format: 'markdown' })).body, /return 2/);
    const pdf = await request(address + '/export', { format: 'pdf' });
    assert.equal(pdf.status, 200);
    assert.match(pdf.body.subarray(0, 12).toString(), /^%PDF/);
    const batch = await request(queue + '/snapshots/export-batch', {}, { snapshotIds: [snapshotId, 'f2dd2286-b18f-41c4-a1ec-f1a0a6573ea0'], format: 'json' });
    assert.equal(batch.status, 200);
    const { unzipSync, strFromU8 } = await import('fflate');
    const files = unzipSync(batch.body);
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    assert.deepEqual(manifest.map(item => item.status), ['exported', 'missing']);
    assert.deepEqual(JSON.parse(strFromU8(files[manifest[0].file])), frozen);
    assert.equal((await request(queue + '/snapshots/export-batch', { projectId: otherId }, { snapshotIds: [snapshotId], format: 'json' })).status, 404);
    const legacy = await request(queue + '/snapshots', { projectId, format: 'semgrep' }, { results: [result] });
    assert.equal(legacy.status, 200);
    const otherEntry = `${queue}/${legacy.body.entries[0].id}`;
    assert.equal((await request(otherEntry + '/claim', {}, {})).status, 200);
    assert.equal((await request(otherEntry + '/reject', {}, { reason: 'Insufficient evidence' })).body.status, 'REJECTED');
    const fixed = await request(vuln + '/status', { status: 'FIXED', reason: 'Verified fix', revision: '1' }, undefined, { method: 'PUT' });
    assert.equal(fixed.body.status, 'FIXED');
    assert.equal((await request('/metrics/report', { projectId })).body.vulnMedium, 0);
    assert.equal((await request(vuln + '/status', { status: 'CONFIRMED' }, undefined, { method: 'PUT' })).status, 409);
    const reopenedReview = await request(queue + '/snapshots', { projectId }, { fingerprints: [fingerprint] });
    const reopened = `${queue}/${reopenedReview.body.entries[0].id}`;
    assert.equal((await request(reopened + '/claim', {}, {})).status, 200);
    assert.equal((await request(reopened + '/confirm', {}, { reason: 'Later review of the old report' })).body.vulnerabilityId, vulnId);
    assert.equal((await request(vuln, { projectId })).body.finding.status, 'FIXED');
    assert.equal((await request(vuln, { projectId })).body.reviews.length, 2);
    assert.deepEqual((await request('/change-reviews/' + withVuln.id, { projectId })).body, withVuln);
    const beforeInventory = await request(queue + '/snapshots', { projectId, format: 'semgrep' },
        { results: [{ ...result, check_id: 'fixture.migrated-review' }] });
    const missingLink = beforeInventory.body.entries[0];
    await stop();
    const db = new DatabaseSync(join(folder, 'index.db'));
    const migratedAt = '2026-01-01T00:00:00.000Z';
    db.prepare("UPDATE review_queue_entry SET status = 'CONFIRMED', updated_at = ? WHERE id = ?").run(migratedAt, missingLink.id);
    db.prepare(`INSERT INTO review_queue_audit(id,entry_id,action,actor,reason,occurred_at) VALUES (?,?,'CONFIRM','previous-reviewer','Historical confirmation',?)`)
        .run(randomUUID(), missingLink.id, migratedAt);
    db.close();
    await start();
    assert.deepEqual((await request(reviewEntry + '/audit')).body, audit);
    assert.deepEqual((await request(address + '/export', { format: 'json' })).body, frozen);
    assert.equal((await request(vuln, { projectId })).body.finding.status, 'FIXED');
    const migrated = (await request(queue + `/snapshots/${beforeInventory.body.snapshotId}/review`)).body.items[0].entry;
    const migratedDetail = (await request(inventory + '/' + migrated.vulnerabilityId, { projectId })).body;
    assert.equal(migratedDetail.finding.foundAt, migratedAt);
    assert.equal(migratedDetail.audit[0].actor, 'previous-reviewer');
    const feedback = '/triage/feedback';
    const suppressions = '/triage/suppressions';
    const policyVersion = { codeVersion: 'target-v1', ruleVersion: 'rules-v1' };
    const review = { projectId, fingerprint, ...policyVersion, status: 'TRUE_POSITIVE', reviewer: 'impersonator',
        reason: '人工已复核 api_key="fixture-feedback-secret"' };
    assert.equal((await request(feedback, {}, review, { authorized: false })).status, 401);
    const recordedFeedback = await request(feedback, {}, review);
    assert.equal(recordedFeedback.status, 200);
    assert.equal(recordedFeedback.body.reviewer, 'admin');
    assert.doesNotMatch(recordedFeedback.body.reason, /fixture-feedback-secret/);
    assert.deepEqual((await request(feedback, { projectId, status: 'TRUE_POSITIVE' })).body, [recordedFeedback.body]);
    assert.deepEqual((await request(feedback, { projectId: otherId })).body, []);
    assert.equal((await request(feedback, { projectId: otherId }, review)).status, 400);
    const assess = async (scope = projectId, versions = policyVersion, finding = result) =>
        (await request('/triage/report', { projectId: scope, format: 'semgrep', ...versions }, { results: [finding] })).body[0];
    const acceptedPreview = await assess();
    const accepted = acceptedPreview.report;
    assert.equal(accepted.verdict, 'TRUE_RISK');
    assert.equal(accepted.decisionEvidence[0].source, 'HISTORICAL_FEEDBACK');
    assert.equal(accepted.decisionEvidence[0].applied, true);
    assert.match(acceptedPreview.markdown, /## Decision evidence[\s\S]*HISTORICAL\\_FEEDBACK · Applied/);
    assert.doesNotMatch(acceptedPreview.markdown, /fixture-feedback-secret/);
    const unversioned = (await request(entry, { projectId })).body.report;
    assert.equal(unversioned.verdict, 'NEEDS_REVIEW');
    assert.equal(unversioned.decisionEvidence[0].applied, false);
    assert.deepEqual((await assess(otherId)).report.decisionEvidence, []);
    const mismatch = await assess(projectId, { ...policyVersion, codeVersion: 'other' });
    assert.equal(mismatch.report.decisionEvidence[0].applied, false);
    assert.match(mismatch.markdown, /HISTORICAL\\_FEEDBACK · Skipped/);
    assert.match(mismatch.markdown, /FINDING\\_FEEDBACK\\_VERSION\\_MISMATCH/);
    assert.equal((await assess(projectId, { ...policyVersion, ruleVersion: 'other' })).report.decisionEvidence[0].applied, false);

    const policy = { projectId, ruleId: result.check_id, scope: 'FILE_GLOB', scopeValue: 'src/*.ts',
        reason: 'Generated fixtures', createdBy: 'impersonator', expiresAt: new Date(Date.now() + 60_000).toISOString() };
    assert.equal((await request(suppressions, {}, { ...policy, scopeValue: '../src/*.ts' })).status, 400);
    assert.equal((await request(suppressions, {}, { ...policy, expiresAt: '2000-01-01T00:00:00Z' })).status, 400);
    const createdPolicy = await request(suppressions, {}, policy);
    assert.equal(createdPolicy.status, 200);
    assert.equal(createdPolicy.body.createdBy, 'admin');
    assert.deepEqual((await request(suppressions, { projectId, ruleId: policy.ruleId })).body, [createdPolicy.body]);
    const suppression = suppressions + '/' + createdPolicy.body.id;
    assert.equal((await assess()).report.verdict, 'TRUE_RISK');
    assert.equal((await assess(projectId, policyVersion, { ...result, path: 'src/nested/other.ts' })).report.verdict, 'NEEDS_REVIEW');
    assert.equal((await request(entry, { projectId })).body.report.verdict, 'LIKELY_FALSE_POSITIVE');
    const policySnapshot = await request(queue + '/snapshots', { projectId, format: 'semgrep', ...policyVersion }, { results: [result] });
    assert.equal(policySnapshot.status, 200);
    const policyExport = queue + '/snapshots/' + policySnapshot.body.snapshotId + '/export';
    const policyFrozen = (await request(policyExport, { format: 'json' })).body;
    assert.deepEqual(policyFrozen.reports[0].decisionEvidence.map(item => item.source), ['RULE_SUPPRESSION', 'HISTORICAL_FEEDBACK']);
    assert.match((await request(policyExport, { format: 'markdown' })).body, /Generated fixtures/);
    assert.equal((await request(suppression + '/audit', { projectId: otherId })).status, 404);
    assert.equal((await request(suppression + '/revoke', {}, { reason: 'Review complete', actor: 'impersonator' })).status, 200);
    assert.equal((await request(suppression + '/revoke', {}, { reason: 'Repeated' })).status, 404);
    assert.deepEqual((await request(suppression + '/audit')).body.map(item => [item.action, item.actor]), [['CREATED', 'admin'], ['REVOKED', 'admin']]);
    assert.equal((await request(entry, { projectId })).body.report.verdict, 'NEEDS_REVIEW');
    assert.deepEqual((await request(policyExport, { format: 'json' })).body, policyFrozen);
    assert.equal((await request(vuln, { projectId })).body.finding.status, 'FIXED');
    const runEndpoint = '/agent-runs/sast-triage';
    const baselineVulnerability = (await request(vuln, { projectId })).body;
    async function finishedRun(accepted) {
        assert.equal(accepted.status, 202);
        let state;
        for (let attempt = 0; attempt < 100; attempt++) {
            state = (await request('/agent-runs/' + accepted.body.id, { projectId })).body;
            if (!['QUEUED', 'RUNNING'].includes(state.status)) return state;
            await new Promise(resolve => setTimeout(resolve, 15));
        }
        assert.fail('Triage did not reach a terminal state: ' + state.status);
    }
    const submittedRun = await finishedRun(await request(runEndpoint, { projectId }, { fingerprints: [fingerprint] }));
    assert.equal(submittedRun.playbook, 'SAST_TRIAGE');
    assert.equal(submittedRun.status, 'WAITING_FOR_REVIEW');
    assert.deepEqual(submittedRun.steps.map(step => [step.capability, step.status]), [
        ['LOAD_FINDINGS', 'COMPLETED'], ['BUILD_CONTEXT', 'COMPLETED'], ['TRIAGE_FINDINGS', 'COMPLETED'],
        ['LLM_ADVISORY', 'SKIPPED'], ['SUBMIT_REVIEW', 'COMPLETED']
    ]);
    assert.ok(submittedRun.steps.every((step, index) => step.sequence === index + 1 && step.runId === submittedRun.id && step.finishedAt));
    const submittedRunPath = '/agent-runs/' + submittedRun.id;
    assert.equal((await request(submittedRunPath, { projectId: otherId })).status, 404);
    assert.deepEqual((await request(submittedRunPath + '/export', { projectId })).body, submittedRun);
    const [kind, runSnapshotId] = submittedRun.outputReference.split(':');
    assert.equal(kind, 'report-snapshot');
    const stagedRun = (await request(queue + '/snapshots/' + runSnapshotId + '/review', { projectId })).body;
    assert.equal(stagedRun.items[0].entry.status, 'PENDING');
    assert.equal(stagedRun.snapshot.reports[0].verdict, 'NEEDS_REVIEW');
    const loadedVulnerability = await finishedRun(await request('/agent-runs/vulnerability-triage', { projectId, vulnerabilityId: vulnId },
        undefined, { method: 'POST' }));
    assert.equal(loadedVulnerability.inputReference, 'vulnerability:' + vulnId);
    assert.equal(loadedVulnerability.steps[0].capability, 'LOAD_VULNERABILITY');
    assert.deepEqual((await request(vuln, { projectId })).body, baselineVulnerability);
    const failedRun = await finishedRun(await request(runEndpoint, { projectId, format: 'semgrep' }, { results: [] }));
    assert.equal(failedRun.status, 'FAILED');
    assert.equal(failedRun.steps[0].error, 'NO_REVIEWABLE_FINDINGS');
    assert.equal(failedRun.outputReference, null);
    const partialRun = await finishedRun(await request(runEndpoint, { projectId, format: 'semgrep' }, {
        results: [{ ...result, check_id: 'fixture.preview-agent' }, { ...result, path: '../outside.ts' }]
    }));
    assert.equal(partialRun.status, 'PARTIAL');
    assert.ok(partialRun.outputReference.startsWith('report-snapshot:'));
    assert.ok(!JSON.stringify(partialRun).includes(secret));
    const listedRuns = (await request('/agent-runs', { projectId, playbook: 'SAST_TRIAGE', limit: 2 })).body;
    assert.deepEqual(listedRuns.map(run => run.id), [partialRun.id, failedRun.id]);

    const variants = '/triage/variants';
    const seedPath = 'src/review-seed.ts';
    const trackedPath = 'src/review-tracked.ts';
    const candidatePath = 'src/review-candidate.ts';
    for (const [root, file, name] of [
        [roots[0], seedPath, 'reviewedLabel'], [roots[0], trackedPath, 'trackedLabel'],
        [roots[0], candidatePath, 'candidateLabel'], [roots[1], candidatePath, 'foreignLabel']
    ]) {
        const absolute = join(root, file);
        await writeFile(absolute, `export function ${name}(labelReader) { return labelReader.executeQuery("fixture label"); }\n`);
        assert.equal((await request('/index/file', { file: absolute, projectRoot: root }, undefined, { method: 'POST' })).status, 200);
    }
    const variantRule = 'fixture.label-review';
    async function trackLabel(file) {
        const importedLabel = await request(endpoint, args, { results: [{ check_id: variantRule, path: file,
            start: { line: 1 }, extra: { message: 'Review label lookup via executeQuery.', severity: 'WARNING' } }] });
        assert.equal(importedLabel.body.imported, 1);
        const fingerprint = createHash('sha256').update(`semgrep|${variantRule}|${file}|1`).digest('hex').slice(0, 16);
        const pending = await request(inventory + '/from-finding', { projectId }, { fingerprint });
        assert.equal(pending.body.status, 'SUSPECTED');
        return pending.body;
    }
    const variantSeed = await trackLabel(seedPath);
    const variantTracked = await trackLabel(trackedPath);
    assert.deepEqual(await request(variants, { projectId }), { status: 200, body: [] });
    const decideLabel = (finding, status) => request(inventory + '/' + finding.id + '/status',
        { projectId, status, reason: 'Reviewed fixture' }, undefined, { method: 'PUT' });
    assert.equal((await decideLabel(variantTracked, 'DISMISSED')).body.status, 'DISMISSED');
    assert.equal((await decideLabel(variantSeed, 'CONFIRMED')).body.status, 'CONFIRMED');
    const inventoryBeforeVariants = await request(inventory, { projectId });
    assert.equal((await request(variants, { projectId }, undefined, { authorized: false })).status, 401);
    assert.equal((await request(variants)).status, 400);
    assert.deepEqual((await request(variants, { projectId: otherId })).body, []);
    assert.deepEqual((await request(variants, { projectId, limit: 0 })).body, []);
    const candidates = await request(variants, { projectId, limit: 1 });
    assert.equal(candidates.status, 200);
    assert.equal(candidates.body.length, 1);
    const [candidate] = candidates.body;
    assert.deepEqual([candidate.projectId, candidate.seedFindingId, candidate.ruleId, candidate.status],
        [projectId, variantSeed.id, variantRule, 'SUSPECTED']);
    assert.deepEqual([candidate.citation.filePath, candidate.citation.startLine, candidate.citation.endLine], [candidatePath, 1, 1]);
    assert.match(candidate.citation.qualifiedName, /candidateLabel/);
    assert.match(candidate.similarityReasons[0], /executeQuery/);
    assert.doesNotMatch(JSON.stringify(candidate), /fixture label/);
    assert.deepEqual(await request(variants, { projectId }), candidates);
    assert.deepEqual(await request(inventory, { projectId }), inventoryBeforeVariants);

    await stop();
    await start();
    assert.deepEqual(await request(variants, { projectId }), candidates);
    assert.deepEqual((await request(submittedRunPath, { projectId })).body, submittedRun);
    assert.equal((await request('/index/project', { projectId }, undefined, { method: 'DELETE' })).status, 200);
    assert.equal((await request(submittedRunPath)).status, 404);
    assert.equal((await request(suppression + '/audit')).status, 404);
    assert.equal((await request(vuln, { projectId })).status, 404);
});
