import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { create as createTar } from 'tar';

const zipFixture = Buffer.from(
    'UEsDBBQAAAAIAHp+eF0ywUVpNQAAADMAAAAOAAAAYnVuZGxlL21haW4udHNLrSjILypRSCvNSy7JzM9TSCxKzsgsS/VLzE3V0FSoVihKLSktylNQKs4vLUpOVbJWqOUCAFBLAwQUAAAACAB6fnhdbhArHxMAAAARAAAAEAAAAGJ1bmRsZS9SRUFETUUubWRTVnAsSs7ILEtVKM4vLUpO5QIAUEsDBBQAAAAIAHp+eF1Zg3OpFAAAABIAAAATAAAAYnVuZGxlL3BhY2thZ2UuanNvbqtWykvMTVWyUkqtSMwtyElVqgUAUEsBAhQDFAAAAAgAen54XTLBRWk1AAAAMwAAAA4AAAAAAAAAAAAAAIABAAAAAGJ1bmRsZS9tYWluLnRzUEsBAhQDFAAAAAgAen54XW4QKx8TAAAAEQAAABAAAAAAAAAAAAAAAIABYQAAAGJ1bmRsZS9SRUFETUUubWRQSwECFAMUAAAACAB6fnhdWYNzqRQAAAASAAAAEwAAAAAAAAAAAAAAgAGiAAAAYnVuZGxlL3BhY2thZ2UuanNvblBLBQYAAAAAAwADALsAAADnAAAAAAA=',
    'base64'
);

test('archive upload enters the managed index, exposes a profile, and removes only its managed source', { timeout: 25_000 }, async t => {
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'repograph-asset-')));
    const projects = join(tmp, 'projects');
    const managed = join(tmp, 'managed');
    await mkdir(projects);
    await writeFile(join(projects, 'untouched.ts'), 'function retained() {}');
    const rules = join(tmp, 'operator-rules.yml');
    const scanner = join(tmp, 'semgrep-fixture');
    const marker = join(tmp, 'scanner-started');
    const codeql = join(tmp, 'codeql-fixture');
    const codeqlState = join(tmp, 'codeql-state');
    await writeFile(rules, 'partial');
    await writeFile(scanner, [
        '#!/usr/bin/env node',
        'const assert = require("node:assert/strict");',
        'const { dirname, join } = require("node:path");',
        'const { readFileSync, writeFileSync } = require("node:fs");',
        'const args = process.argv.slice(2);',
        'if (args[0] === "--version") { console.log("1.163.0"); return; }',
        'assert.equal(args[0], "scan");',
        'const config = args[args.indexOf("--config") + 1];',
        'const projectRoot = args[args.indexOf("--project-root") + 1];',
        'assert.equal(args.at(-1), projectRoot);',
        'for (const arg of ["--json", "--metrics=off", "--no-git-ignore", "--disable-version-check"]) assert.ok(args.includes(arg));',
        'assert.notEqual(process.cwd(), projectRoot);',
        'assert.equal(process.env.REPOGRAPH_ACCESS_TOKEN, undefined);',
        'const mode = readFileSync(config, "utf8");',
        'if (mode === "slow") { writeFileSync(join(dirname(config), "scanner-started"), "ready"); setInterval(() => {}, 1000); return; }',
        'const finding = { check_id: "fixture." + mode, path: join(projectRoot, "main.ts"), start: { line: 1 },',
        '  end: { line: 1 }, extra: { message: "Review this test annotation", severity: "WARNING", lines: "not retained" } };',
        'const results = mode === "partial" ? [finding, { ...finding, path: join(dirname(projectRoot), "outside.ts") }] : [finding];',
        'console.log(JSON.stringify({ results }));',
    ].join('\n') + '\n', { mode: 0o700 });
    await writeFile(codeqlState, 'fail');
    await writeFile(codeql, [
        '#!/usr/bin/env node',
        'const assert = require("node:assert/strict");',
        'const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");',
        'const { dirname, join } = require("node:path");',
        'const { pathToFileURL } = require("node:url");',
        'const args = process.argv.slice(2);',
        'const option = name => args.find(arg => arg.startsWith(name + "="))?.slice(name.length + 1);',
        'if (args[0] === "version") { assert.ok(args.includes("--format=json")); console.log(JSON.stringify({ version: "2.27.4" })); return; }',
        'assert.equal(args[0], "database");',
        'assert.equal(process.env.REPOGRAPH_ACCESS_TOKEN, undefined);',
        'const database = args.at(-1);',
        'if (args[1] === "create") {',
        '    assert.equal(option("--build-mode"), "none");',
        '    assert.ok(args.includes("--no-run-unnecessary-builds"));',
        '    assert.equal(args.some(arg => arg.startsWith("--command")), false);',
        '    const source = option("--source-root");',
        '    assert.equal(dirname(source), process.cwd());',
        '    const language = option("--language");',
        '    assert.equal(process.env.PYTHONSAFEPATH, "1");',
        '    assert.equal(process.env.PYTHONPATH, language === "python" ? join(dirname(process.argv[1]), "python", "tools") : undefined);',
        '    const file = language === "javascript-typescript"',
        '        ? (existsSync(join(source, "main.ts")) ? "main.ts" : "index.ts")',
        '        : language === "python" ? "labels.py" : "ArchiveMarker.java";',
        '    assert.ok(existsSync(join(source, file)));',
        '    assert.equal(existsSync(join(source, "package.json")), false);',
        '    assert.equal(existsSync(join(source, "build.gradle")), false);',
        '    mkdirSync(database);',
        '    writeFileSync(join(database, "info"), JSON.stringify({ source, file }));',
        '    return;',
        '}',
        'assert.equal(args[1], "analyze");',
        'assert.ok(args.includes("--no-download"));',
        'assert.ok(args.includes("--no-sarif-add-file-contents"));',
        'const mode = readFileSync(join(dirname(process.argv[1]), "codeql-state"), "utf8");',
        'const { source, file } = JSON.parse(readFileSync(join(database, "info"), "utf8"));',
        'if (mode === "fail" || (mode === "java-partial" && file.endsWith(".java"))) process.exit(2);',
        'const result = name => ({ ruleId: "fixture/annotation", level: "note", message: { text: "Review this annotation" },',
        '    locations: [{ physicalLocation: { artifactLocation: { uri: name, uriBaseId: "%SRCROOT%" }, region: { startLine: 1 } } }] });',
        'writeFileSync(option("--output"), JSON.stringify({ version: "2.1.0", runs: [{ tool: { driver: { name: "CodeQL" } },',
        '    originalUriBaseIds: { "%SRCROOT%": { uri: pathToFileURL(source + "/").href } }, results: [result(file)] }] }));'
    ].join('\n') + '\n', { mode: 0o700 });
    const realSlither = process.env.REPOGRAPH_TEST_SLITHER_BINARY;
    const realSolc = process.env.REPOGRAPH_TEST_SOLC_BINARY;
    assert.equal(!!realSlither, !!realSolc, 'Supply both real Solidity tool paths or neither.');
    const slither = realSlither ?? join(tmp, 'slither-fixture');
    const solc = realSolc ?? join(tmp, 'solc-fixture');
    if (!realSlither) {
        await writeFile(solc, '#!/bin/sh\nprintf "%s\\n" "Version: 0.8.30+commit.fixture"\n', { mode: 0o700 });
        await writeFile(slither, [
            '#!/usr/bin/env node',
            'const assert = require("node:assert/strict");',
            'const { existsSync, readFileSync } = require("node:fs");',
            'const args = process.argv.slice(2);',
            'if (args[0] === "--version") { console.log("0.11.6"); return; }',
            'assert.equal(process.env.REPOGRAPH_ACCESS_TOKEN, undefined);',
            'assert.ok(existsSync("contracts/Label.sol"));',
            'assert.ok(existsSync("contracts/Display Name.sol"));',
            'assert.equal(existsSync("contracts/._Label.sol"), false);',
            'assert.equal(existsSync("slither.config.json"), false);',
            'assert.equal(existsSync("build.gradle"), false);',
            'assert.equal(args[args.indexOf("--compile-force-framework") + 1], "solc");',
            'assert.ok(args.includes("--solc-args=--base-path . --allow-paths ."));',
            'assert.deepEqual(args.slice(-2), ["--json", "-"]);',
            'assert.match(readFileSync(args[0], "utf8"), /from "\\.\\/contracts\\/Display Name\\.sol";/);',
            'const report = { success: true, results: { detectors: [{ check: "naming-convention", impact: "Informational",',
            '    description: "Review the label name", elements: [{ name: "display_label",',
            '        source_mapping: { filename_relative: "contracts/Label.sol", lines: [5] } }] }] } };',
            'console.log(JSON.stringify(report));',
            'process.exitCode = 1;'
        ].join('\n') + '\n', { mode: 0o700 });
    }
    const token = randomBytes(32).toString('hex');
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: {
            ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined,
            REPOGRAPH_PROJECTS_ROOT: projects, REPOGRAPH_ASSETS_ROOT: managed,
            REPOGRAPH_SEMGREP_BINARY: scanner, REPOGRAPH_SEMGREP_RULES: rules,
            REPOGRAPH_CODEQL_BINARY: codeql, REPOGRAPH_SLITHER_BINARY: slither, REPOGRAPH_SOLC_BINARY: solc,
            REPOGRAPH_ASSET_MAX_UPLOAD_MIB: '1', REPOGRAPH_ASSET_MAX_DEPTH: '2',
            REPOGRAPH_DB_PATH: join(tmp, 'index.db'), REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_PORT: '0'
        },
        stdio: ['ignore', 'ignore', 'pipe']
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
        child.once('exit', code => reject(new Error(`Server exited (${code}): ${stderr}`)));
        child.stderr.on('data', chunk => {
            stderr += chunk;
            const address = stderr.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
            if (address) resolve(address);
        });
    });
    async function api(path, init = {}, credential = token) {
        const response = await fetch(`${base}/api/v1${path}`, {
            ...init, headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...init.headers }
        });
        return { status: response.status, body: await response.json(), headers: response.headers };
    }
    function upload(data, name, strategy) {
        const body = new FormData();
        body.append('file', new Blob([data]), name);
        if (strategy) body.append('strategy', strategy);
        return api('/assets/import', { method: 'POST', body });
    }
    async function ready(assetId) {
        for (let attempt = 0; attempt < 100; attempt++) {
            const result = await api(`/assets/${assetId}`);
            assert.equal(result.status, 200);
            if (result.body.status !== 'INDEXING') return result.body;
            await delay(20);
        }
        assert.fail('Asset did not reach a terminal state');
    }

    const incoming = await upload(zipFixture, 'from-source.zip', 'heuristic');
    assert.equal(incoming.status, 202);
    const zip = await ready(incoming.body.assetId);
    assert.equal(zip.status, 'READY');
    assert.equal(zip.archiveType, 'ZIP');
    assert.equal(zip.originalFileName, 'from-source.zip');
    assert.equal(zip.projectRoot, join(managed, zip.assetId, 'source', 'bundle'));
    const fallback = '/symbol/' + encodeURIComponent('main.ts#archiveName@L1') + '?projectId=' + zip.projectId;
    assert.equal((await api(fallback)).body.metadata.heuristic, 'true');
    assert.equal((await api('/assets/' + zip.assetId + '/reindex', { method: 'POST' })).status, 202);
    assert.equal((await ready(zip.assetId)).status, 'READY');
    assert.equal((await api(fallback)).status, 200);
    assert.equal((await api('/assets/' + zip.assetId + '/reindex?strategy=precise', { method: 'POST' })).status, 202);
    assert.equal((await ready(zip.assetId)).status, 'READY');
    assert.equal((await api(fallback)).status, 404);
    assert.equal((await api(`/symbol/archiveName?projectId=${zip.projectId}`)).body.filePath, 'main.ts');

    const profile = await api(`/assets/${zip.assetId}/profile?excludeScanner=SEMGREP&includeScanner=SEMGREP`);
    assert.equal(profile.status, 200);
    assert.deepEqual(profile.body.categoryDistribution, { BUSINESS: 2, DOCUMENTATION: 1 });
    assert.equal(profile.body.scannerPlan.find(item => item.scanner === 'SEMGREP').selected, false);
    assert.ok(profile.body.omittedReasons.length);
    const available = await api('/scanners/capabilities');
    assert.equal(available.status, 200);
    assert.equal(available.body[0].capability.scanner, 'SEMGREP');
    assert.equal(available.body[0].available, true);
    assert.equal(available.body[0].toolVersion, '1.163.0');
    assert.equal(available.body[1].capability.scanner, 'CODEQL');
    assert.equal(available.body[1].available, true);
    assert.equal(available.body[1].toolVersion, '2.27.4');
    const solidityCapability = available.body.find(item => item.capability.scanner === 'SLITHER');
    assert.equal(solidityCapability.available, true);
    assert.match(solidityCapability.toolVersion, /^\d+\.\d+\.\d+/);
    assert.deepEqual(solidityCapability.capability.languages, ['solidity']);
    const scanAsset = '/assets/' + zip.assetId;
    const submitScan = (timeoutSeconds = 5) => api(scanAsset + '/scan-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scanners: ['SEMGREP'], timeoutSeconds })
    });
    async function finishScan(path) {
        for (let attempt = 0; attempt < 180; attempt++) {
            const result = await api(path);
            assert.equal(result.status, 200);
            if (!['QUEUED', 'RUNNING'].includes(result.body.status)) return result.body;
            await delay(25);
        }
        assert.fail('Scan did not reach a terminal state');
    }
    const queued = await submitScan();
    assert.equal(queued.status, 202);
    assert.equal(queued.body.status, 'QUEUED');
    const taskPath = '/scan-tasks/' + queued.body.taskId;
    assert.equal(queued.headers.get('location'), '/api/v1' + taskPath);
    const partial = await finishScan(taskPath);
    assert.equal(partial.status, 'PARTIAL');
    assert.equal(partial.findingCount, 1);
    assert.equal(partial.scanners[0].error, 'SCANNER_INCOMPLETE_REPORT');
    await writeFile(rules, 'complete');
    assert.deepEqual((await api(taskPath + '/retry', { method: 'POST' })).body,
        { taskId: partial.id, status: 'QUEUED' });
    const succeeded = await finishScan(taskPath);
    assert.equal(succeeded.status, 'SUCCEEDED');
    assert.equal(succeeded.attempt, 2);
    assert.equal(succeeded.scanners.length, 2);
    const observations = (await api(taskPath + '/findings')).body;
    assert.deepEqual(observations.findings.map(finding => finding.ruleId), ['fixture.partial', 'fixture.complete']);
    assert.equal(observations.findings[0].filePath, 'main.ts');
    assert.doesNotMatch(JSON.stringify(observations), /not retained|outside\.ts/);
    const inventory = (await api(scanAsset + '/external-findings')).body;
    assert.equal(inventory.length, 2);
    assert.equal((await api('/triage/findings/' + inventory[0].fingerprint + '?projectId=' + zip.projectId)).status, 200);
    const synced = await api(scanAsset + '/scans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scanners: ['SEMGREP'] })
    });
    assert.equal(synced.status, 200);
    assert.equal(synced.body.status, 'SUCCEEDED');
    assert.equal(synced.body.runs[0].findingCount, 1);
    assert.equal((await api(scanAsset + '/external-findings')).body.length, 2);
    assert.equal((await api(scanAsset + '/scans')).body.length, 3);

    const combined = await api(scanAsset + '/scan-tasks', { method: 'POST' });
    assert.equal(combined.status, 202);
    const combinedPath = '/scan-tasks/' + combined.body.taskId;
    const combinedPartial = await finishScan(combinedPath);
    assert.equal(combinedPartial.status, 'PARTIAL');
    assert.deepEqual(combinedPartial.scanners.map(run => [run.scanner, run.status]), [
        ['SEMGREP', 'SUCCEEDED'], ['CODEQL', 'FAILED']
    ]);
    await writeFile(codeqlState, 'success');
    assert.equal((await api(combinedPath + '/retry', { method: 'POST' })).status, 200);
    const combinedRetried = await finishScan(combinedPath);
    assert.equal(combinedRetried.status, 'SUCCEEDED');
    assert.deepEqual(combinedRetried.scanners.map(run => [run.scanner, run.status]), [
        ['SEMGREP', 'SUCCEEDED'], ['CODEQL', 'FAILED'], ['CODEQL', 'SUCCEEDED']
    ]);
    assert.equal(combinedRetried.scanners[0].scanId, combinedPartial.scanners[0].scanId);
    const combinedFindings = (await api(combinedPath + '/findings')).body.findings;
    assert.deepEqual(combinedFindings.map(finding => [finding.tool, finding.filePath]), [['semgrep', 'main.ts'], ['CodeQL', 'main.ts']]);
    assert.equal((await api('/triage/findings/' + combinedFindings[1].fingerprint + '?projectId=' + zip.projectId)).status, 200);

    await writeFile(rules, 'slow');
    const slow = await submitScan();
    assert.equal(slow.status, 202);
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await stat(marker).catch(() => null)) break;
        await delay(10);
    }
    assert.ok((await stat(marker)).isFile());
    assert.equal((await submitScan()).status, 409);
    assert.equal((await api(scanAsset, { method: 'DELETE' })).status, 409);
    const slowPath = '/scan-tasks/' + slow.body.taskId;
    assert.equal((await api(slowPath + '/cancel', { method: 'POST' })).body.status, 'CANCELLED');
    assert.equal((await finishScan(slowPath)).status, 'CANCELLED');
    const timed = await submitScan(1);
    assert.equal(timed.status, 202);
    const expired = await finishScan('/scan-tasks/' + timed.body.taskId);
    assert.equal(expired.status, 'FAILED');
    assert.equal(expired.scanners[0].status, 'TIMED_OUT');
    const csrf = await api('/auth/csrf', {}, null);
    const credentials = { username: 'archive-reader', password: randomBytes(24).toString('hex') };
    const anonymous = {
        Cookie: csrf.headers.getSetCookie()[0].split(';', 1)[0],
        'X-CSRF-Token': csrf.body.token, Origin: base, 'Content-Type': 'application/json'
    };
    const registered = await api('/auth/register', {
        method: 'POST', headers: anonymous,
        body: JSON.stringify({ ...credentials, displayName: 'Archive reader', email: 'reader@example.test' })
    }, null);
    await api(`/admin/accounts/${registered.body.id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE', reason: 'Read archived project' })
    });
    const signedIn = await api('/auth/login', { method: 'POST', headers: anonymous, body: JSON.stringify(credentials) }, null);
    assert.equal(signedIn.status, 200);
    const session = { headers: { Cookie: signedIn.headers.getSetCookie()[0].split(';', 1)[0] } };
    assert.equal((await api(`/assets/${zip.assetId}/profile`, session, null)).status, 403);
    assert.equal((await api(taskPath, session, null)).status, 404);
    assert.equal((await api(`/sbom/${zip.projectId}`, session, null)).status, 403);
    assert.equal((await api(`/admin/projects/${zip.projectId}/owner`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'PERSONAL', ownerId: registered.body.id })
    })).status, 200);
    assert.equal((await api(`/assets/${zip.assetId}/profile`, session, null)).status, 200);
    assert.equal((await api(taskPath, session, null)).status, 200);
    assert.equal((await api(`/sbom/${zip.projectId}`, session, null)).status, 200);

    const tarSource = join(tmp, 'tar-source');
    await mkdir(tarSource);
    await writeFile(join(tarSource, 'index.ts'), 'export function tarSymbol() { return 1; }');
    await writeFile(join(tarSource, 'ArchiveMarker.java'), [
        'package sample.archive;',
        'class ArchiveMarker { void mark() {} }',
        '@RestController',
        '@RequestMapping(path = {"/reports/", "/legacy"})',
        '@PreAuthorize("hasRole(\'READER\')")',
        'class ArchiveReports {',
        '    @org.springframework.web.bind.annotation.GetMapping("daily")',
        '    @PreAuthorize("hasAuthority(\'reports:read\')")',
        '    public void daily() { ArchiveFiles.read(); }',
        '    @RequestMapping(method = {RequestMethod.POST, RequestMethod.PUT})',
        '    public void shared() { RequestMethod method = RequestMethod.DELETE; }',
        '}',
        '@RestController @RequestMapping("/status") class ArchiveStatus {',
        '    @GetMapping("/about") public void about() {}',
        '    @GetMapping("/ping") public void ping() {}',
        '}',
        'class ArchivePolicy {',
        '    SecurityFilterChain filter(HttpSecurity http) {',
        '        String password = "fixture-redaction-marker";',
        '        return http.authorizeHttpRequests(config -> config.requestMatchers("/status/ping").authenticated()).build();',
        '    }',
        '}'
    ].join('\n'));
    await writeFile(join(tarSource, 'ArchiveFiles.java'), [
        'package sample.archive;',
        'public class ArchiveFiles {',
        '    public static void read() { java.nio.file.Files.readString(path); }',
        '}'
    ].join('\n'));
    await writeFile(join(tarSource, 'package.json'), JSON.stringify({ name: 'archive-fixture', dependencies: { labels: '1.2.3' } }));
    await writeFile(join(tarSource, 'build.gradle'), '// Test asset build configuration should stay out of the scanner workspace.\n');
    await mkdir(join(tarSource, 'contracts'));
    await writeFile(join(tarSource, 'contracts', 'Display Name.sol'),
        '// SPDX-License-Identifier: MIT\npragma solidity >=0.8.0 <0.9.0;\ncontract DisplayName {}\n');
    await writeFile(join(tarSource, 'contracts', '._Label.sol'), Buffer.from('0005160700020000', 'hex'));
    await writeFile(join(tarSource, 'contracts', 'Label.sol'), '// SPDX-License-Identifier: MIT\n'
        + 'pragma solidity >=0.8.0 <0.9.0;\nimport {DisplayName} from "./Display Name.sol";\n'
        + 'contract Label is DisplayName {\n    function display_label() external pure returns (uint256) { return 1; }\n}\n');
    await writeFile(join(tarSource, 'slither.config.json'), JSON.stringify({ detectors_to_exclude: 'naming-convention' }));
    const tarFile = join(tmp, 'fixture.tar.gz');
    await writeFile(join(tarSource, 'labels.py'), 'def label_text(value):\n    return value.strip()\n');
    await createTar({ gzip: true, cwd: tarSource, file: tarFile }, await readdir(tarSource));
    const packed = await upload(await readFile(tarFile), 'fixture.tar.gz');
    assert.equal(packed.status, 202);
    const archive = await ready(packed.body.assetId);
    assert.equal(archive.status, 'READY');
    assert.equal(archive.archiveType, 'TAR_GZ');
    assert.equal((await api(`/symbol/tarSymbol?projectId=${archive.projectId}`)).body.filePath, 'index.ts');
    assert.equal((await api(`/symbol/${encodeURIComponent('sample.archive.ArchiveMarker#mark()')}?projectId=${archive.projectId}`))
        .body.filePath, 'ArchiveMarker.java');
    const tarProfile = (await api(`/assets/${archive.assetId}/profile`)).body;
    assert.deepEqual(tarProfile.dependencies, [{
        coordinate: 'labels', version: '1.2.3', scope: 'required', purl: 'pkg:npm/labels@1.2.3',
        sources: ['package.json'], constraints: []
    }]);
    assert.ok(!tarProfile.omittedReasons.includes('DEPENDENCY_INVENTORY_UNAVAILABLE'));
    await writeFile(codeqlState, 'java-partial');
    const codeqlOnly = await api(`/assets/${archive.assetId}/scans`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scanners: ['CODEQL'] })
    });
    assert.equal(codeqlOnly.body.status, 'PARTIAL');
    assert.match(codeqlOnly.body.runs[0].error, /java-kotlin: CODEQL_ANALYSIS_FAILED/);
    assert.deepEqual(codeqlOnly.body.runs[0].findings.map(finding => finding.filePath).sort(), ['index.ts', 'labels.py']);
    assert.equal(tarProfile.scannerPlan.find(item => item.scanner === 'SLITHER').selected, true);
    const slitherOnly = await api(`/assets/${archive.assetId}/scans`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scanners: ['SLITHER'] })
    });
    assert.equal(slitherOnly.status, 200);
    assert.equal(slitherOnly.body.status, 'SUCCEEDED', JSON.stringify(slitherOnly.body));
    const [slitherRun] = slitherOnly.body.runs;
    assert.equal(slitherRun.scanner, 'SLITHER');
    const styleFinding = slitherRun.findings.find(finding => finding.ruleId === 'naming-convention');
    assert.deepEqual([styleFinding.tool, styleFinding.filePath, styleFinding.startLine], ['slither', 'contracts/Label.sol', 5]);
    assert.ok(slitherRun.findings.every(finding => ['contracts/Label.sol', 'contracts/Display Name.sol'].includes(finding.filePath)));
    const slitherReport = await api(`/triage/findings/${styleFinding.fingerprint}?projectId=${archive.projectId}`);
    assert.equal(slitherReport.status, 200);
    assert.equal(slitherReport.body.finding.filePath, 'contracts/Label.sol');

    const authorizationPath = `/assets/${archive.assetId}/authorization-evidence`;
    const authorization = await api(authorizationPath + '?depth=1');
    assert.equal(authorization.status, 200);
    assert.deepEqual(authorization.body.map(evidence => [evidence.projectId, evidence.route.path, evidence.route.httpMethods]), [
        [archive.projectId, '/reports/daily', ['GET']], [archive.projectId, '/reports', ['POST', 'PUT']],
        [archive.projectId, '/status/about', ['GET']], [archive.projectId, '/status/ping', ['GET']]
    ]);
    const [daily, shared, about, ping] = authorization.body;
    assert.equal(daily.status, 'LOCAL_CONSTRAINT_CANDIDATE');
    assert.deepEqual(daily.constraints.map(({ scope, expression, effective }) => [scope, expression, effective]), [
        ['CLASS', "hasRole('READER')", false], ['METHOD', "hasAuthority('reports:read')", true]
    ]);
    assert.equal(shared.constraints[0].effective, true);
    assert.deepEqual(daily.resourceAccesses, [{
        kind: 'FILE', target: 'Files API',
        callPath: ['sample.archive.ArchiveReports#daily()', 'sample.archive.ArchiveFiles#read()'],
        citations: [
            { qualifiedName: 'sample.archive.ArchiveReports#daily()', filePath: 'ArchiveMarker.java', startLine: 7, endLine: 9 },
            { qualifiedName: 'sample.archive.ArchiveFiles#read()', filePath: 'ArchiveFiles.java', startLine: 3, endLine: 3 }
        ]
    }]);
    assert.equal(about.status, 'NO_LOCAL_EVIDENCE');
    assert.deepEqual(about.constraints, []);
    assert.equal(ping.status, 'POLICY_CANDIDATE');
    assert.equal(ping.constraints[0].scope, 'CONFIGURATION');
    assert.equal(ping.constraints[0].effective, false);
    assert.match(ping.constraints[0].expression, /requestMatchers\("\/status\/ping"\)/);
    assert.ok(!ping.constraints[0].expression.includes('fixture-redaction-marker'));
    assert.deepEqual((await api(authorizationPath + '?depth=0')).body[0].resourceAccesses, []);
    assert.equal((await api(authorizationPath + '?depth=-1')).status, 400);
    assert.equal((await api(authorizationPath, session, null)).status, 403);
    assert.equal((await api(`/assets/${zip.assetId}/authorization-evidence`, session, null)).status, 200);

    const deleted = await api(`/index/project?projectId=${zip.projectId}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.equal((await api(`/assets/${zip.assetId}`)).status, 404);
    assert.equal((await api(`/assets/${zip.assetId}/authorization-evidence`)).status, 404);
    assert.equal((await api(`/symbol/archiveName?projectId=${zip.projectId}`)).status, 404);
    await assert.rejects(stat(zip.projectRoot), { code: 'ENOENT' });
    assert.equal((await stat(join(projects, 'untouched.ts'))).isFile(), true);
    assert.deepEqual(await readdir(managed), [archive.assetId]);

    const rejected = await upload('plain file content', 'invalid.zip');
    assert.equal(rejected.status, 415);
    const truncated = await upload(zipFixture.subarray(0, 100), 'incomplete.zip');
    assert.equal(truncated.status, 400);
    const tooLarge = await upload(Buffer.alloc(1024 * 1024 + 1), 'ordinary-large-input.zip');
    assert.equal(tooLarge.status, 413);
    const deep = join(tmp, 'nested', 'docs');
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, 'guide.md'), '# Legitimate nested document');
    const file = join(tmp, 'deep.tar.gz');
    await createTar({ gzip: true, cwd: tmp, file }, ['nested']);
    const overDepth = await upload(await readFile(file), 'deep.tar.gz');
    assert.equal(overDepth.status, 413);
    assert.equal(overDepth.body.error, 'ARCHIVE_DEPTH_LIMIT');
    assert.deepEqual(await readdir(managed), [archive.assetId]);
});
