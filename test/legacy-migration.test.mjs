import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { promisify } from 'node:util';
import { toSourceSinkJson } from '../dist/rule-export.js';

const run = promisify(execFile);
const timestamp = '2026-11-10T09:46:00Z';
const password = 'migration-fixture-password';
// Generated once by Spring Security BCryptPasswordEncoder(12).
const bcrypt = '$2a$12$QTHWyxzn8aER8YOfwgCLVOsLFinWwWM6xjP.ekWQNad2uTUIGbukK';

async function legacyFixture(t) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'repograph-migrate-test-')));
    const projectRoot = join(root, 'project');
    const output = join(root, 'converted');
    const source = join(root, 'legacy.db');
    const projectId = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
    await mkdir(projectRoot);
    const db = new DatabaseSync(source);
    db.exec(`
        CREATE TABLE enterprise_accounts (id, username, display_name, email, password_hash, role, status, credential_version, created_at);
        CREATE TABLE enterprise_organizations (id, name, active, created_at);
        CREATE TABLE enterprise_memberships (organization_id, account_id);
        CREATE TABLE enterprise_project_owners (project_id, owner_type, owner_id, updated_at);
        CREATE TABLE enterprise_audit (id INTEGER PRIMARY KEY, actor_id, action, target_id, reason, created_at);
        CREATE TABLE index_history (project_root, status, indexed_at);
        CREATE TABLE file_cache (project_id, file_path, md5);
        CREATE TABLE pending_project_deletions (project_id);
    `);
    const account = db.prepare('INSERT INTO enterprise_accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    account.run('builtin-admin', 'admin', 'Administrator', 'admin@localhost', bcrypt, 'ADMIN', 'ACTIVE', 3, timestamp);
    account.run('legacy-analyst', 'analyst', 'Analyst', 'analyst@example.test', bcrypt, 'USER', 'ACTIVE', 7, timestamp);
    account.run('legacy-pending', 'queued', 'Queued', 'queued@example.test', bcrypt, 'USER', 'PENDING', 2, timestamp);
    db.prepare('INSERT INTO enterprise_organizations VALUES (?, ?, ?, ?)').run('legacy-team', 'Team', 1, timestamp);
    db.prepare('INSERT INTO enterprise_memberships VALUES (?, ?)').run('legacy-team', 'legacy-analyst');
    db.prepare('INSERT INTO enterprise_project_owners VALUES (?, ?, ?, ?)').run(projectId, 'ORGANIZATION', 'legacy-team', timestamp);
    db.prepare('INSERT INTO enterprise_audit VALUES (?, ?, ?, ?, ?, ?)').run(42, 'builtin-admin', 'PROJECT_ASSIGNED', projectId, 'fixture', timestamp);
    db.prepare('INSERT INTO index_history VALUES (?, ?, ?)').run(projectRoot, 'done', timestamp);
    db.prepare('INSERT INTO file_cache VALUES (?, ?, ?)').run(projectId, 'Example.java', 'fixture');
    db.close();
    let child;
    t.after(async () => {
        if (child?.exitCode === null && child.signalCode === null) {
            const ended = once(child, 'exit');
            child.kill('SIGTERM');
            await ended;
        }
        await rm(root, { recursive: true, force: true });
    });
    const env = { ...process.env, REPOGRAPH_ACCESS_TOKEN: undefined, REPOGRAPH_ADMIN_PASSWORD: undefined,
        REPOGRAPH_PROVIDER_ENCRYPTION_KEY: undefined, REPOGRAPH_LEGACY_PROVIDER_ENCRYPTION_KEY: undefined,
        REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_PORT: '0', REPOGRAPH_PROJECTS_ROOT: root, REPOGRAPH_PROJECT_RETENTION_SECONDS: '0' };
    async function migrate(...args) {
        const { stdout } = await run(process.execPath, ['dist/migrate-legacy.js', '--source', source,
            '--output', output, '--projects-root', root, ...args], { env });
        return JSON.parse(stdout);
    }
    async function start() {
        child = spawn(process.execPath, ['dist/server.js'], {
            env: { ...env, REPOGRAPH_DB_PATH: join(output, 'index.db') }, stdio: ['ignore', 'ignore', 'pipe']
        });
        return new Promise((resolve, reject) => {
            let messages = '';
            child.once('error', reject);
            child.once('exit', code => reject(new Error(`Server exited (${code}): ${messages}`)));
            child.stderr.on('data', chunk => {
                messages += chunk;
                const url = messages.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
                if (url) resolve(url);
            });
        });
    }
    return { root, source, output, projectRoot, projectId, migrate, start };
}

async function login(base, username, supplied = password) {
    const preflight = await fetch(base + '/api/v1/auth/csrf');
    let cookie = preflight.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
    const { token } = await preflight.json();
    const result = await fetch(base + '/api/v1/auth/login', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: base, 'X-CSRF-Token': token, Cookie: cookie },
        body: JSON.stringify({ username, password: supplied }) });
    cookie = result.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
    return { status: result.status, request: (path, method = 'GET', csrf, input, extraHeaders = {}) => fetch(base + '/api/v1' + path, {
        method, headers: { Cookie: cookie, Origin: base, ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
            ...(input ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }, body: JSON.stringify(input)
    }) };
}

test('the offline converter preserves identity, project rights and legacy password login in a fresh database', { timeout: 20_000 }, async t => {
    const { root, source, output, projectId, projectRoot, migrate, start } = await legacyFixture(t);
    const reviewPlans = ['conflicting', 'unclaimed', 'unknown'].map(name => {
        const path = join(root, name);
        return { projectId: createHash('sha256').update(path).digest('hex').slice(0, 12), path };
    });
    await Promise.all(reviewPlans.map(item => mkdir(item.path)));
    const [conflicting, unclaimed, unknown] = reviewPlans;
    const inaccessible = '000000000001';
    const legacy = new DatabaseSync(source);
    for (const item of reviewPlans) legacy.prepare('INSERT INTO index_history VALUES (?, ?, ?)').run(item.path, 'done', timestamp);
    const ownerClaim = legacy.prepare('INSERT INTO enterprise_project_owners VALUES (?, ?, ?, ?)');
    ownerClaim.run(conflicting.projectId, 'PERSONAL', 'legacy-analyst', timestamp);
    ownerClaim.run(conflicting.projectId, 'ORGANIZATION', 'legacy-team', timestamp);
    ownerClaim.run(unknown.projectId, 'PERSONAL', 'missing-account', timestamp);
    ownerClaim.run(inaccessible, 'PERSONAL', 'legacy-analyst', timestamp);
    legacy.exec('CREATE TABLE advisories (id, summary, severity, cwe, group_id, artifact_id, introduced, fixed, source)');
    legacy.prepare('INSERT INTO advisories VALUES (?,?,?,?,?,?,?,?,?)').run(
        'fixture-warning', 'Fixture advisory', 'LOW', null, 'fixture.group', 'core', null, '2.0', 'imported');
    legacy.close();
    await writeFile(join(projectRoot, 'pom.xml'), `<project><dependencies>
        <dependency><groupId>fixture.group</groupId><artifactId>core</artifactId><version>[1.0]</version></dependency>
    </dependencies></project>`);
    const sourceBytes = await readFile(source);
    const preview = await migrate('--dry-run');
    assert.equal(preview.migrated.accounts, 3);
    assert.equal(preview.migrated.projectOwners, 1);
    assert.equal(preview.migrated.dependencyAdvisories, 1);
    assert.equal(preview.skipped.file_cache, 1);
    const outstanding = {
        [conflicting.projectId]: 'CONFLICTING_OWNER_EVIDENCE', [unclaimed.projectId]: 'MISSING_OWNER_EVIDENCE',
        [unknown.projectId]: 'UNKNOWN_LEGACY_OWNER', [inaccessible]: 'LEGACY_PROJECT_UNAVAILABLE'
    };
    assert.deepEqual(Object.fromEntries(preview.ownershipReview.map(entry => [entry.projectId, entry.reason])), outstanding);
    await assert.rejects(readFile(join(output, 'index.db')), { code: 'ENOENT' });
    const imported = await migrate();
    assert.deepEqual(imported.migrated, preview.migrated);
    assert.deepEqual(imported.ownershipReview, preview.ownershipReview);
    await assert.rejects(migrate(), /DESTINATION_EXISTS/);
    assert.deepEqual(await readFile(source), sourceBytes);

    const base = await start();
    assert.equal((await login(base, 'analyst', 'incorrect password')).status, 401);
    assert.equal((await login(base, 'queued')).status, 401);
    const analyst = await login(base, 'analyst');
    assert.equal(analyst.status, 200);
    const projects = await (await analyst.request('/projects')).json();
    assert.deepEqual(projects.map(item => [item.projectId, item.projectRoot, item.nodeCount]), [[projectId, projectRoot, 0]]);
    assert.deepEqual(await (await analyst.request('/index/project/status?' + new URLSearchParams({ projectRoot }))).json(), { status: 'idle' });
    assert.equal((await analyst.request('/admin/accounts')).status, 403);
    const { token: analystCsrf } = await (await analyst.request('/auth/csrf')).json();
    const scan = await analyst.request('/vulns/scan/deps?' + new URLSearchParams({ projectId }), 'POST', analystCsrf);
    assert.equal(scan.status, 200);
    assert.equal((await scan.json()).newFindings, 1);
    const records = await (await analyst.request('/vulns?' + new URLSearchParams({ projectId }))).json();
    assert.equal(records[0].dependency.advisoryId, 'fixture-warning');
    assert.equal(records[0].dependency.source, 'imported');
    const admin = await login(base, 'admin');
    assert.equal(admin.status, 200);
    const audit = await (await admin.request('/admin/audit')).json();
    assert.ok(audit.some(event => event.id === 42 && event.actorId === 'builtin-admin' && event.targetId === projectId));
    assert.deepEqual(Object.fromEntries(audit.filter(event => event.action === 'LEGACY_OWNER_REVIEW_REQUIRED')
        .map(event => [event.targetId, event.reason])), outstanding);
    const { token: adminCsrf } = await (await admin.request('/auth/csrf')).json();
    assert.equal((await admin.request('/admin/projects/' + conflicting.projectId + '/owner', 'PUT', adminCsrf,
        { ownerType: 'PERSONAL', ownerId: 'legacy-analyst' })).status, 200);
    await assert.rejects(migrate(), /DESTINATION_EXISTS/);
    const repaired = await (await analyst.request('/projects')).json();
    assert.deepEqual(repaired.map(entry => entry.projectId).sort(), [projectId, conflicting.projectId].sort());
    const benchmarkReport = { projectLabel: 'Archived corpus', generatedAt: timestamp, semantic: {
        title: 'SEMANTIC SEARCH', total: 0, threshold: .65, hit1Rate: 0, hit3Rate: 0, hit5Rate: 0, hit10Rate: 0,
        mrr10: 0, passed: false, cases: []
    } };
    const benchmarkFile = join(output, 'benchmark-latest.json');
    await writeFile(benchmarkFile, JSON.stringify(benchmarkReport));
    assert.equal((await analyst.request('/benchmark/results')).status, 404);
    assert.deepEqual(await (await admin.request('/benchmark/results')).json(), benchmarkReport);
    await writeFile(benchmarkFile, JSON.stringify({ ...benchmarkReport, projectId }));
    assert.equal((await analyst.request('/benchmark/results')).status, 200);
    await writeFile(benchmarkFile, JSON.stringify({ ...benchmarkReport, projectId: '000000000000' }));
    assert.equal((await analyst.request('/benchmark/results')).status, 404);
    const target = new DatabaseSync(join(output, 'index.db'), { readOnly: true });
    try {
        const analyst = target.prepare("SELECT salt, password_hash, credential_version FROM enterprise_account WHERE username = 'analyst'").get();
        assert.match(analyst.salt, /^[a-f0-9]{32}$/);
        assert.match(analyst.password_hash, /^[a-f0-9]{128}$/);
        assert.equal(analyst.credential_version, 7);
        assert.equal(target.prepare("SELECT salt FROM enterprise_account WHERE username = 'queued'").get().salt, null);
    } finally { target.close(); }
});

test('legacy review snapshots retain report evidence, review decisions and stable scoped deep links', { timeout: 20_000 }, async t => {
    const { source, projectId, migrate, start } = await legacyFixture(t);
    const snapshotId = '10000000-0000-0000-0000-000000000001';
    const duplicateSnapshot = '10000000-0000-0000-0000-000000000002';
    const confirmedId = '10000000-0000-0000-0000-000000000003';
    const claimedId = '10000000-0000-0000-0000-000000000004';
    const anotherId = '10000000-0000-0000-0000-000000000005';
    const openId = '10000000-0000-0000-0000-000000000006';
    const waitingRun = '50000000-0000-0000-0000-000000000001';
    const interruptedRun = '50000000-0000-0000-0000-000000000002';
    const missingReportRun = '50000000-0000-0000-0000-000000000003';
    const unmappedRun = '50000000-0000-0000-0000-000000000004';
    const changeRun = '50000000-0000-0000-0000-000000000005';
    const filename = 'src/Record.java';
    function finding(ruleId, startLine, filePath = filename) {
        const value = { tool: 'semgrep', ruleId, filePath, startLine, endLine: startLine,
            message: 'A historical review observation', severity: 'LOW', cwe: '', symbol: '', trace: [],
            raw: 'raw-legacy-payload-never-exposed' };
        const fingerprint = createHash('sha256').update(`semgrep|${ruleId}|${filePath}|${startLine}`).digest('hex').slice(0, 16);
        return { value, fingerprint };
    }
    function frozen(observation, verdict) {
        return { finding: observation.value, located: true, locatedQualifiedName: 'Record#format()', verdict, confidence: 0.8,
            reasons: ['C1 provided context'], missingInfo: [], remediation: 'Review the saved context',
            developerSummary: 'Historical finding summary', decisionEvidence: [{ source: 'HISTORICAL_FEEDBACK',
                reference: 'past-review', summary: 'The previous review was retained', applied: true }],
            pack: { query: 'fixture', taskType: 'security', requestedBudgetChars: 200, usedBudgetChars: 50, seedCount: 1,
                keywordSeedCount: 0, callGraphExpanded: 0, impactExpanded: 0, omittedReasons: [], evidence: [{
                    citationId: 'C1', qualifiedName: 'Record#format()', kind: 'METHOD', language: 'java', filePath: filename, startLine: 4,
                    endLine: 5, source: 'VECTOR', relation: 'SEED', finalScore: 0.8, truncated: false, securitySignals: [],
                    excerpt: 'String token = "fixture-secret-value";\nString label = "frozen";'
                }] }
        };
    }
    const observed = finding('fixture.confirmed', 4, './' + filename);
    const ambiguous = finding('fixture.ambiguous', 7);
    const open = finding('fixture.open', 8);
    const frozenConfirmed = frozen(observed, 'TRUE_RISK');
    const frozenAmbiguous = frozen(ambiguous, 'LIKELY_FALSE_POSITIVE');
    const db = new DatabaseSync(source);
    db.exec(`
        CREATE TABLE external_findings(project_id, fingerprint, scanner, scan_id, finding_json, first_seen_at, last_seen_at);
        CREATE TABLE report_snapshots(id, project_id, schema_version, tool_version, code_version, rule_version, generated_at, reports_json);
        CREATE TABLE review_queue_entries(id, snapshot_id, project_id, fingerprint, rule_id, cwe, severity, verdict, confidence, status,
            claimed_by, claimed_at, updated_at);
        CREATE TABLE review_queue_audit(id, entry_id, action, actor, reason, occurred_at);
        CREATE TABLE triage_feedback(fingerprint, project_id, status, reviewer, reason, code_version, rule_version, updated_at);
        CREATE TABLE rule_suppressions(id, project_id, rule_id, scope, scope_value, reason, created_by, created_at, expires_at, active);
        CREATE TABLE rule_suppression_audit(id, suppression_id, action, actor, reason, occurred_at);
        CREATE TABLE agent_runs(id, project_id, playbook, playbook_version, status, input_reference, output_reference,
            status_reason, created_at, updated_at, completed_at);
        CREATE TABLE agent_steps(id, run_id, sequence_no, capability, status, summary, error, started_at, finished_at);
        CREATE TABLE agent_step_references(step_id, kind, position, reference_value);
        CREATE TABLE agent_step_results(step_id, position, subject_reference, baseline, recommendation, uncertainty, advisory_only);
    `);
    db.prepare('INSERT INTO external_findings VALUES (?,?,?,?,?,?,?)').run(projectId, observed.fingerprint, 'SEMGREP', 'historical-scan',
        JSON.stringify(observed.value), timestamp, timestamp);
    const snapshot = db.prepare('INSERT INTO report_snapshots VALUES (?,?,?,?,?,?,?,?)');
    snapshot.run(snapshotId, projectId, '1', '0.5.0', 'legacy-code', 'legacy-rules', timestamp,
        JSON.stringify([frozenConfirmed, frozen(open, 'NEEDS_REVIEW')]));
    snapshot.run(duplicateSnapshot, projectId, '1', '0.5.0', '', '', timestamp, JSON.stringify([frozenAmbiguous, frozenAmbiguous]));
    const entry = db.prepare('INSERT INTO review_queue_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    entry.run(confirmedId, snapshotId, projectId, observed.fingerprint, observed.value.ruleId, '', 'LOW', 'TRUE_RISK', 0.8,
        'CONFIRMED', 'analyst', timestamp, timestamp);
    entry.run(openId, snapshotId, projectId, open.fingerprint, open.value.ruleId, '', 'LOW', 'NEEDS_REVIEW', 0.8,
        'IN_REVIEW', 'analyst', timestamp, timestamp);
    for (const id of [claimedId, anotherId]) entry.run(id, duplicateSnapshot, projectId, ambiguous.fingerprint, ambiguous.value.ruleId, '', 'LOW',
        'LIKELY_FALSE_POSITIVE', 0.8, 'IN_REVIEW', 'analyst', timestamp, timestamp);
    const audit = db.prepare('INSERT INTO review_queue_audit VALUES (?,?,?,?,?,?)');
    audit.run('20000000-0000-0000-0000-000000000001', confirmedId, 'SUBMITTED', 'system', '', '2026-11-10T09:46:00Z');
    audit.run('20000000-0000-0000-0000-000000000002', confirmedId, 'CLAIMED', 'analyst', '', '2026-11-10T09:46:00.1Z');
    audit.run('20000000-0000-0000-0000-000000000003', confirmedId, 'CONFIRMED', 'analyst', 'Confirmed in the legacy instance',
        '2026-11-10T09:46:00.2Z');
    db.prepare('INSERT INTO triage_feedback VALUES (?,?,?,?,?,?,?,?)')
        .run(observed.fingerprint, projectId, 'TRUE_POSITIVE', 'previous-analyst', 'api_key="fixture-legacy-feedback"',
            'legacy-code', 'legacy-rules', timestamp);
    const expired = '30000000-0000-0000-0000-000000000001';
    const revoked = '30000000-0000-0000-0000-000000000002';
    const suppression = db.prepare('INSERT INTO rule_suppressions VALUES (?,?,?,?,?,?,?,?,?,?)');
    suppression.run(expired, projectId, observed.value.ruleId, 'FILE_GLOB', '**/*.java', 'Expired fixture', 'previous-analyst',
        '2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z', 1);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    suppression.run(revoked, projectId, observed.value.ruleId, 'PROJECT', '', 'Revoked fixture', 'previous-analyst', timestamp, future, 0);
    const policyAudit = db.prepare('INSERT INTO rule_suppression_audit VALUES (?,?,?,?,?,?)');
    policyAudit.run('40000000-0000-0000-0000-000000000001', revoked, 'CREATED', 'previous-analyst', 'Revoked fixture', timestamp);
    policyAudit.run('40000000-0000-0000-0000-000000000002', revoked, 'REVOKED', 'reviewer', 'Already verified', timestamp);
    const runRow = db.prepare('INSERT INTO agent_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const submitReference = 'report-snapshot:' + snapshotId;
    const latest = '2026-11-10T09:46:00.3Z';
    runRow.run(interruptedRun, projectId, 'SAST_TRIAGE', '1', 'RUNNING', 'upload:sarif', '', '', latest, latest, '');
    runRow.run(waitingRun, projectId, 'SAST_TRIAGE', '1', 'WAITING_FOR_REVIEW', 'upload:semgrep', submitReference, '', timestamp, timestamp, '');
    runRow.run(missingReportRun, projectId, 'SAST_TRIAGE', '1', 'PARTIAL', 'upload:semgrep',
        'report-snapshot:60000000-0000-0000-0000-000000000001', 'MODEL_FAILURE', timestamp, timestamp, timestamp);
    runRow.run(unmappedRun, '123456789012', 'SAST_TRIAGE', '1', 'FAILED', 'upload:sarif', '', 'MODEL_FAILURE', timestamp, timestamp, timestamp);
    runRow.run(changeRun, projectId, 'CHANGE_REVIEW', '1', 'COMPLETED', 'change-input:fixture', 'change-review:' + snapshotId, '', timestamp, timestamp, timestamp);
    const step = db.prepare('INSERT INTO agent_steps VALUES (?,?,?,?,?,?,?,?,?)');
    const oldModel = waitingRun + ':step:1';
    const stepSubmit = waitingRun + ':step:2';
    step.run(stepSubmit, waitingRun, 2, 'SUBMIT_REVIEW', 'COMPLETED', 'Submitted for review', '', timestamp, timestamp);
    step.run(oldModel, waitingRun, 1, 'LLM_ADVISORY', 'COMPLETED', 'token="fixture-agent-summary-secret"', '', timestamp, timestamp);
    step.run(interruptedRun + ':step:2', interruptedRun, 2, 'LLM_ADVISORY', 'RUNNING', '', '', latest, '');
    step.run(interruptedRun + ':step:1', interruptedRun, 1, 'BUILD_CONTEXT', 'COMPLETED', 'Captured evidence', '', latest, latest);
    step.run(unmappedRun + ':step:1', unmappedRun, 1, 'IMPORT_FINDINGS', 'FAILED', '', 'NO_FINDINGS', timestamp, timestamp);
    const reference = db.prepare('INSERT INTO agent_step_references VALUES (?,?,?,?)');
    const subject = 'finding:' + observed.fingerprint;
    reference.run(oldModel, 'EVIDENCE', 1, subject + '#C1');
    reference.run(oldModel, 'EVIDENCE', 0, 'finding:' + open.fingerprint + '#C1');
    reference.run(oldModel, 'EVIDENCE', 2, subject + '#UNREGISTERED');
    reference.run(oldModel, 'MISSING', 0, 'Inspect authorization="fixture-agent-reference-secret"');
    reference.run(stepSubmit, 'EVIDENCE', 0, submitReference);
    reference.run(unmappedRun + ':step:1', 'MISSING', 0, 'NO_FINDINGS');
    const decision = db.prepare('INSERT INTO agent_step_results VALUES (?,?,?,?,?,?,?)');
    decision.run(oldModel, 0, subject, 'TRUE_RISK', 'NEEDS_REVIEW', 0.4, 1);
    decision.run(oldModel, 1, 'finding:' + open.fingerprint, 'NEEDS_REVIEW', 'TRUE_RISK', 0.7, 0);
    db.close();
    const report = await migrate();
    assert.equal(report.migrated.externalFindings, 1);
    assert.equal(report.migrated.reviewSnapshots, 2);
    assert.equal(report.migrated.reviewEntries, 4);
    assert.equal(report.migrated.reviewEvents, 3);
    assert.deepEqual([report.migrated.triageFeedback, report.migrated.ruleSuppressions, report.migrated.ruleSuppressionEvents], [1, 2, 2]);
    assert.deepEqual([report.migrated.agentRuns, report.migrated.agentSteps, report.migrated.agentStepReferences, report.migrated.agentStepResults], [4, 4, 5, 1]);
    assert.deepEqual([report.skipped.agent_runs, report.skipped.agent_steps, report.skipped.agent_step_references, report.skipped.agent_step_results], [1, 1, 1, 1]);
    const base = await start();
    const analyst = await login(base, 'analyst');
    const query = '?' + new URLSearchParams({ projectId });
    const savedRunRoute = '/agent-runs/' + waitingRun;
    const savedRun = await (await analyst.request(savedRunRoute + query)).json();
    assert.deepEqual([savedRun.id, savedRun.status, savedRun.outputReference, savedRun.legacyImported],
        [waitingRun, 'WAITING_FOR_REVIEW', submitReference, true]);
    assert.equal(savedRun.outputUnavailable, undefined);
    assert.deepEqual(savedRun.steps.map(item => item.id), [oldModel, stepSubmit]);
    assert.deepEqual(savedRun.steps[0].evidenceReferences, ['finding:' + open.fingerprint + '#C1', subject + '#C1', subject + '#UNREGISTERED']);
    assert.deepEqual(savedRun.steps[0].results, [{ subjectReference: subject, baseline: 'TRUE_RISK', recommendation: 'NEEDS_REVIEW',
        uncertainty: 0.4, advisoryOnly: true, citationIds: ['C1'] }]);
    assert.doesNotMatch(JSON.stringify(savedRun), /fixture-agent-.*-secret/);
    const migratedExport = await analyst.request(savedRunRoute + '/export' + query);
    assert.match(migratedExport.headers.get('content-disposition'), /^attachment/);
    assert.deepEqual(await migratedExport.json(), savedRun);
    assert.equal((await analyst.request(savedRunRoute + '?projectId=123456789012')).status, 404);
    assert.equal((await analyst.request('/agent-runs/' + unmappedRun + query)).status, 404);
    const recovered = await (await analyst.request('/agent-runs/' + interruptedRun + query)).json();
    assert.equal(recovered.status, 'PARTIAL');
    assert.equal(recovered.statusReason, 'PROCESS_INTERRUPTED');
    assert.deepEqual(recovered.steps.map(item => item.status), ['COMPLETED', 'FAILED']);
    assert.equal(recovered.steps[1].error, 'PROCESS_INTERRUPTED');
    const missingReport = await (await analyst.request('/agent-runs/' + missingReportRun + query)).json();
    assert.equal(missingReport.outputUnavailable, true);
    const migratedChange = await (await analyst.request('/agent-runs/' + changeRun + query)).json();
    assert.equal(migratedChange.playbook, 'CHANGE_REVIEW');
    assert.equal(migratedChange.outputUnavailable, true);
    const recent = await (await analyst.request('/agent-runs' + query + '&playbook=SAST_TRIAGE&limit=1')).json();
    assert.deepEqual(recent.map(item => item.id), [interruptedRun]);
    const sourceFinding = await (await analyst.request('/triage/findings/' + observed.fingerprint + query)).json();
    assert.equal(sourceFinding.finding.fingerprint, observed.fingerprint);
    assert.equal(sourceFinding.finding.legacyScan.scanId, 'historical-scan');
    assert.equal(sourceFinding.report.verdict, 'NEEDS_REVIEW');
    assert.deepEqual(sourceFinding.report.decisionEvidence.map(item => [item.source, item.applied]), [['HISTORICAL_FEEDBACK', false]]);
    const policyHistory = await (await analyst.request('/triage/suppressions/' + revoked + '/audit' + query)).json();
    assert.deepEqual(policyHistory.map(row => [row.action, row.actor]), [['CREATED', 'previous-analyst'], ['REVOKED', 'reviewer']]);
    const policies = await (await analyst.request('/triage/suppressions' + query)).json();
    assert.deepEqual(policies.map(row => [row.id, row.active]), [[revoked, false], [expired, true]]);
    const feedback = await (await analyst.request('/triage/feedback' + query)).json();
    assert.equal(feedback[0].reviewer, 'previous-analyst');
    assert.doesNotMatch(feedback[0].reason, /fixture-legacy-feedback/);
    assert.ok(!JSON.stringify(sourceFinding).includes('raw-legacy-payload-never-exposed'));

    const snapshotPath = '/review-queue/snapshots/' + snapshotId;
    const view = await (await analyst.request(snapshotPath + '/review' + query)).json();
    const confirmed = view.items.find(item => item.entry.id === confirmedId);
    assert.equal(confirmed.entry.id, confirmedId);
    assert.equal(confirmed.entry.status, 'CONFIRMED');
    assert.equal(confirmed.entry.revision, 2);
    assert.match(confirmed.entry.vulnerabilityId, /^[a-f0-9]{16}$/);
    assert.equal(confirmed.report.verdict, 'TRUE_RISK');
    assert.equal(confirmed.report.pack.evidence[0].citationId, 'C1');
    assert.match(confirmed.report.pack.evidence[0].excerpt, /"\*+";\nString label = "frozen"/);
    assert.equal(confirmed.report.decisionEvidence[0].reference, 'past-review');
    assert.equal(view.snapshot.generatedAt, timestamp);
    assert.ok(!JSON.stringify(view).includes('raw-legacy-payload-never-exposed'));
    const timeline = await (await analyst.request('/review-queue/' + confirmedId + '/audit' + query)).json();
    assert.deepEqual(timeline.map(row => row.action), ['SUBMIT', 'CLAIM', 'CONFIRM']);
    assert.equal(timeline[2].reason, 'Confirmed in the legacy instance');
    const exported = await (await analyst.request(snapshotPath + '/export' + query + '&format=json')).json();
    assert.deepEqual(exported, view.snapshot);
    const markdown = await (await analyst.request(snapshotPath + '/export' + query + '&format=markdown')).text();
    assert.match(markdown, /Historical finding summary/);
    assert.match(markdown, /The previous review was retained/);
    assert.ok(!markdown.includes('fixture-secret-value'));
    assert.equal((await analyst.request(snapshotPath + '/export?projectId=123456789012&format=json')).status, 404);
    const ambiguousView = await (await analyst.request('/review-queue/snapshots/' + duplicateSnapshot + '/review' + query)).json();
    assert.deepEqual(ambiguousView.items.map(item => [item.reportMatchCount, item.report]), [[2, null], [2, null]]);
    const { token } = await (await analyst.request('/auth/csrf')).json();
    const duplicate = await (await analyst.request('/triage/findings/import' + query + '&format=semgrep', 'POST', token, {
        results: [{ check_id: observed.value.ruleId, path: filename, start: { line: 4 }, end: { line: 4 }, extra: { message: 'Fresh observation' } }]
    })).json();
    assert.equal(duplicate.duplicates, 1);
    assert.equal(duplicate.imported, 0);
    assert.equal((await analyst.request('/review-queue/' + claimedId + '/confirm' + query, 'POST', token,
        { reason: 'Ambiguous history', revision: 0 })).status, 409);
    const rejected = await analyst.request('/review-queue/' + openId + '/reject' + query, 'POST', token,
        { reason: 'Reviewed in current service', revision: 0 });
    assert.equal(rejected.status, 200);
    assert.equal((await rejected.json()).status, 'REJECTED');
    assert.deepEqual(await (await analyst.request(snapshotPath + '/export' + query + '&format=json')).json(), exported);
});

test('legacy change review snapshots preserve original scoped evidence, ledgers and run links', { timeout: 20_000 }, async t => {
    const { root, source, projectRoot, projectId, migrate, start } = await legacyFixture(t);
    const legacyRoot = join(root, 'legacy-project');
    await symlink(projectRoot, legacyRoot);
    const oldProjectId = createHash('sha256').update(legacyRoot).digest('hex').slice(0, 12);
    const snapshotId = '80000000-0000-0000-0000-000000000001';
    const earlyId = '80000000-0000-0000-0000-000000000002';
    const unrelatedId = '80000000-0000-0000-0000-000000000003';
    const agentId = '80000000-0000-0000-0000-000000000004';
    const unitId = 'a1'.repeat(32);
    const filePath = 'src/Review.java';
    const sensitivePath = '.env.production';
    const hunk = { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, header: '@@ -1 +1 @@ token="fixture-heading-secret"',
        lines: ['-return previous;', '+return current;'] };
    const config = { ...hunk, header: '@@ -1 +1 @@ fixture-sensitive-header',
        lines: ['-previous value', '+fixture-sensitive-value', '\\ No newline at end of file'] };
    const planned = { fileIndex: 1, hunkOrdinal: 1, oldPath: filePath, newPath: filePath, parsedHunkIndex: 0,
        unitId, unitHunkIndex: 0, disposition: 'PLANNED', reason: '' };
    const omitted = { fileIndex: 1, hunkOrdinal: 2, oldPath: filePath, newPath: filePath, parsedHunkIndex: null,
        unitId: '', unitHunkIndex: null, disposition: 'OMITTED', reason: 'hunk parsing incomplete' };
    const configDisposition = { fileIndex: 2, hunkOrdinal: 1, oldPath: sensitivePath, newPath: 'renamed-config.txt',
        parsedHunkIndex: 0, unitId: '', unitHunkIndex: null, disposition: 'OMITTED', reason: 'unit limit reached' };
    const files = [
        { oldPath: filePath, newPath: filePath, kind: 'MODIFIED', hunks: [hunk], errors: ['hunk parsing incomplete'],
            hunkCandidates: [{ ordinal: 1, hunkIndex: 0, error: '' }, { ordinal: 2, hunkIndex: null, error: 'hunk parsing incomplete' }] },
        { oldPath: sensitivePath, newPath: 'renamed-config.txt', kind: 'RENAMED', hunks: [config], errors: [],
            hunkCandidates: [{ ordinal: 1, hunkIndex: 0, error: '' }] }
    ];
    const evidence = { citationId: unitId + ':C1', qualifiedName: 'Review#run()', kind: 'METHOD', language: 'java', filePath,
        startLine: 1, endLine: 3, source: 'CHANGE', relation: 'SEED', finalScore: 1, truncated: false, securitySignals: [],
        excerpt: 'String token = "fixture-source-secret";\nreturn current;' };
    const contextPack = { evidence: [evidence, { ...evidence, citationId: unitId + ':C2', filePath: 'renamed-config.txt',
        excerpt: 'fixture-sensitive-context' }], query: filePath, taskType: 'change-review', omittedReasons: [], requestedBudgetChars: 500,
        usedBudgetChars: 100, seedCount: 1, keywordSeedCount: 0, callGraphExpanded: 0, impactExpanded: 0 };
    const units = [{ unit: { id: unitId, filePath, hunks: [hunk], estimatedChars: 200 }, status: 'MAPPED',
        qualifiedName: evidence.qualifiedName, contextPack, externalFindingReferences: ['a'.repeat(16)], vulnerabilityReferences: ['b'.repeat(16)],
        omittedReasons: [], hunkMappings: [{ hunkIndex: 0, status: 'MAPPED', changedRanges: [{ startLine: 1, endLine: 1 }],
            qualifiedNames: [evidence.qualifiedName], omittedReasons: [] }] }];
    const payload = { id: snapshotId, projectId: oldProjectId, status: 'PARTIAL', baseVersion: 'old', targetVersion: 'new', source: 'legacy fixture',
        generatedAt: timestamp, files, units, hunkLedger: [planned, omitted, configDisposition], omittedHunkCount: 2,
        omittedReasons: ['Historic comparison'], untrustedEvidence: true,
        requestConfig: { maxUnits: 10, requestedBudgetChars: 500, effectiveBudgetChars: 500, maxHunksPerUnit: 4, maxContextReferences: 60 } };
    const db = new DatabaseSync(source);
    db.prepare('UPDATE index_history SET project_root = ?').run(legacyRoot);
    db.prepare('UPDATE enterprise_project_owners SET project_id = ?').run(oldProjectId);
    db.exec(`
        CREATE TABLE change_review_snapshots (id, project_id, base_version, target_version, source, generated_at, status, payload);
        CREATE TABLE agent_runs(id, project_id, playbook, playbook_version, status, input_reference, output_reference,
            status_reason, created_at, updated_at, completed_at);
    `);
    const save = db.prepare('INSERT INTO change_review_snapshots VALUES (?,?,?,?,?,?,?,?)');
    const insert = input => save.run(input.id, input.projectId, input.baseVersion, input.targetVersion, input.source,
        input.generatedAt, input.status, JSON.stringify(input));
    insert(payload);
    insert({ ...payload, id: earlyId, requestConfig: undefined, hunkLedger: undefined });
    insert({ ...payload, id: unrelatedId, projectId: '123456789012' });
    db.prepare('INSERT INTO agent_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(agentId, oldProjectId, 'CHANGE_REVIEW', '1',
        'WAITING_FOR_REVIEW', 'change-input:fixture', 'change-review:' + snapshotId, '', timestamp, timestamp, '');
    db.close();
    const preview = await migrate('--dry-run');
    assert.equal(preview.migrated.changeReviewSnapshots, 2);
    assert.equal(preview.skipped.change_review_snapshots, 1);
    assert.deepEqual((await migrate()).migrated, preview.migrated);
    const base = await start();
    const analyst = await login(base, 'analyst');
    const query = '?' + new URLSearchParams({ projectId });
    const path = '/change-reviews/' + snapshotId;
    const snapshot = await (await analyst.request(path + query)).json();
    assert.deepEqual([snapshot.id, snapshot.projectId, snapshot.status, snapshot.generatedAt, snapshot.legacyImported],
        [snapshotId, projectId, 'PARTIAL', timestamp, true]);
    assert.deepEqual(snapshot.requestConfig, payload.requestConfig);
    assert.deepEqual(snapshot.hunkLedger, payload.hunkLedger);
    assert.deepEqual([snapshot.totalHunkCount, snapshot.plannedHunkCount, snapshot.omittedHunkCount], [3, 1, 2]);
    assert.deepEqual(snapshot.units[0].hunkMappings, units[0].hunkMappings);
    assert.deepEqual(snapshot.units[0].legacyReferences, { externalFindingFingerprints: ['a'.repeat(16)], vulnerabilityIds: ['b'.repeat(16)] });
    assert.equal(snapshot.units[0].contextPack.evidence[0].citationId, evidence.citationId);
    assert.equal(snapshot.units[0].contextPack.evidence[0].projectId, projectId);
    assert.deepEqual(snapshot.files[1].hunks[0].lines.map(line => line[0]), ['-', '+', '\\']);
    assert.equal(snapshot.files[1].hunks[0].lines[2], '\\ No newline at end of file');
    assert.doesNotMatch(JSON.stringify(snapshot), /fixture-(sensitive|source-secret|heading-secret)/);
    assert.deepEqual(await (await analyst.request(path + '/export' + query + '&format=json')).json(), snapshot);
    const markdown = await (await analyst.request(path + '/export' + query + '&format=markdown')).text();
    assert.ok(markdown.includes(evidence.citationId));
    assert.match(markdown, /hunk parsing incomplete/);
    assert.match(markdown, /aaaaaaaaaaaaaaaa/);
    assert.doesNotMatch(markdown, /fixture-(sensitive|source-secret|heading-secret)/);
    const early = await (await analyst.request('/change-reviews/' + earlyId + query)).json();
    assert.equal(early.requestConfig, null);
    assert.deepEqual(early.hunkLedger.map(item => item.disposition), ['PLANNED', 'OMITTED', 'OMITTED']);
    assert.equal((await analyst.request(path + '?projectId=' + oldProjectId)).status, 403);
    assert.equal((await analyst.request('/change-reviews/' + unrelatedId + query)).status, 404);
    const agent = await (await analyst.request('/agent-runs/' + agentId + query)).json();
    assert.equal(agent.outputReference, 'change-review:' + snapshotId);
    assert.equal(agent.outputUnavailable, undefined);

    const prompts = [];
    const model = createServer(async (request, response) => {
        const body = [];
        for await (const chunk of request) body.push(chunk);
        const prompt = JSON.parse(JSON.parse(Buffer.concat(body)).messages.at(-1).content);
        prompts.push(prompt);
        const action = prompt.round === 1 ? { action: 'READ_CONTEXT', citationIds: [evidence.citationId] }
            : { action: 'FINISH', findings: [{ summary: 'Add a focused regression test.', uncertainty: 0.3, citationIds: [evidence.citationId] }] };
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            choices: [{ message: { content: JSON.stringify(action) }, finish_reason: 'stop' }]
        }));
    });
    model.listen(0, '127.0.0.1');
    await once(model, 'listening');
    t.after(() => { model.closeAllConnections(); model.close(); });
    const admin = await login(base, 'admin');
    const { token: adminCsrf } = await (await admin.request('/auth/csrf')).json();
    const providerPath = '/admin/model-providers';
    const created = await admin.request(providerPath, 'POST', adminCsrf, { name: 'Legacy fixture model', model: 'fixture',
        protocol: 'OPENAI_COMPATIBLE', baseUrl: 'http://127.0.0.1:' + model.address().port + '/v1', enabled: true,
        timeoutMillis: 3000, maxOutputTokens: 1024 });
    assert.equal(created.status, 201);
    const profile = await created.json();
    assert.equal((await admin.request(providerPath + '/' + profile.id + '/select', 'POST', adminCsrf)).status, 200);
    const { token: analystCsrf } = await (await analyst.request('/auth/csrf')).json();
    const rerun = await analyst.request('/agent-runs/change-review', 'POST', analystCsrf, { projectId, snapshotId });
    assert.equal(rerun.status, 202);
    const started = await rerun.json();
    let completed;
    for (let attempt = 0; attempt < 100; attempt++) {
        completed = await (await analyst.request('/agent-runs/' + started.id + query)).json();
        if (!['QUEUED', 'RUNNING'].includes(completed.status)) break;
        await delay(20);
    }
    assert.equal(completed.status, 'PARTIAL');
    assert.deepEqual(completed.steps.flatMap(step => step.results).map(item => item.citationIds), [[evidence.citationId]]);
    assert.equal(prompts.length, 2);
    assert.match(prompts[1].readContext[0].excerpt, /return current/);
    assert.doesNotMatch(JSON.stringify(prompts), /fixture-(sensitive|source-secret|heading-secret)/);
    assert.deepEqual(await (await analyst.request(path + query)).json(), snapshot);
});

test('legacy Wiki preserves per-scope versions and citations and continues versioning after regeneration', { timeout: 20_000 }, async t => {
    const { root, source, projectRoot, projectId, migrate, start } = await legacyFixture(t);
    const oldRoot = join(root, 'old-scope');
    await symlink(projectRoot, oldRoot);
    const oldProjectId = createHash('sha256').update(oldRoot).digest('hex').slice(0, 12);
    const runId = '90000000-0000-0000-0000-000000000001';
    const ids = Array.from({ length: 6 }, (_, index) => '91000000-0000-0000-0000-00000000000' + index);
    const [earlyId, latestId, packageId, olderDuplicateId, archivedId, skippedId] = ids;
    const citation = { qualifiedName: 'demo.archive.Archive#current()', filePath: 'src/Archive.java', startLine: 3, endLine: 3 };
    const body = '- Archived model note\n- token="fixture-wiki-secret"\n- <script>fixture-marker</script>';
    const baseDoc = { projectId: oldProjectId, level: 'PROJECT', scopeId: '__project__', title: 'Archived architecture', generatedAt: timestamp,
        status: 'PARTIAL', model: 'legacy-model', sections: [{ title: 'Structure', body: '- Archived structure' },
            { title: 'Model notes', source: 'llm', body }],
        citations: [citation, { ...citation, filePath: '../outside.ts' }], missingInfo: ['Model missed a cited class: details'] };
    const documents = [
        { ...baseDoc, id: earlyId, docVersion: 2, title: 'Early architecture' },
        { ...baseDoc, id: latestId, docVersion: 4 },
        { ...baseDoc, id: packageId, level: 'PACKAGE', scopeId: 'demo.archive', title: 'Archived package', docVersion: 7 },
        { ...baseDoc, id: olderDuplicateId, level: 'PACKAGE', scopeId: 'demo.archive', title: 'Earlier same version', docVersion: 7,
            generatedAt: '2026-11-10T09:46:00.001Z' },
        { ...baseDoc, id: archivedId, level: 'PACKAGE', scopeId: 'removed.package', title: 'Removed package', docVersion: 3 },
        { ...baseDoc, id: skippedId, projectId: '123456789012', docVersion: 10 }
    ];
    documents[2].generatedAt = '2026-11-10T09:46:00.123Z';
    const db = new DatabaseSync(source);
    db.prepare('UPDATE index_history SET project_root = ?').run(oldRoot);
    db.prepare('UPDATE enterprise_project_owners SET project_id = ?').run(oldProjectId);
    db.exec(`
        CREATE TABLE summaries(id, project_id, scope_id, level, doc_version, title, document_json, generated_at);
        CREATE TABLE summary_generation_cache(project_id, scope_id, phase, facts_hash, payload_json, completed_at);
        CREATE TABLE agent_runs(id, project_id, playbook, playbook_version, status, input_reference, output_reference,
            status_reason, created_at, updated_at, completed_at);
    `);
    const store = db.prepare('INSERT INTO summaries VALUES (?,?,?,?,?,?,?,?)');
    for (const doc of documents) store.run(doc.id, doc.projectId, doc.scopeId, doc.level, doc.docVersion, doc.title, JSON.stringify(doc), doc.generatedAt);
    db.prepare('INSERT INTO summary_generation_cache VALUES (?,?,?,?,?,?)').run(oldProjectId, '__project__', 'LLM_ARCH', 'java-hash', '{}', timestamp);
    db.prepare('INSERT INTO agent_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(runId, oldProjectId, 'WIKI_SUMMARY', '1',
        'COMPLETED', 'facts:graph:' + oldProjectId, 'summaries:project:' + oldProjectId, '', timestamp, timestamp, timestamp);
    db.close();
    const preview = await migrate('--dry-run');
    assert.equal(preview.migrated.wikiDocuments, 5);
    assert.equal(preview.skipped.summaries, 1);
    assert.equal(preview.skipped.summary_generation_cache, 1);
    assert.deepEqual((await migrate()).migrated, preview.migrated);
    const base = await start();
    const analyst = await login(base, 'analyst');
    const query = '?' + new URLSearchParams({ projectId });
    const latest = await (await analyst.request('/summaries' + query)).json();
    assert.deepEqual(latest.map(doc => [doc.id, doc.docVersion]), [[latestId, 4], [packageId, 7], [archivedId, 3]]);
    const tree = await (await analyst.request('/summaries/tree' + query)).json();
    assert.deepEqual(tree.map(node => [node.path, node.id]), [['project', latestId], ['package/demo.archive', packageId], ['package/removed.package', archivedId]]);
    const doc = await (await analyst.request('/summaries/' + earlyId + query)).json();
    assert.deepEqual([doc.id, doc.projectId, doc.generatedAt, doc.status, doc.model, doc.legacyImported, doc.factsHash],
        [earlyId, projectId, timestamp, 'PARTIAL', 'legacy-model', true, null]);
    assert.deepEqual(doc.sections.map(section => section.source), ['facts', 'llm']);
    assert.deepEqual(doc.citations, [citation]);
    assert.ok(doc.missingInfo.includes('LEGACY_WIKI_CITATION_UNAVAILABLE'));
    assert.doesNotMatch(JSON.stringify(doc), /fixture-wiki-secret/);
    const exported = await analyst.request('/summaries/' + earlyId + '/export' + query);
    assert.match(exported.headers.get('content-disposition'), /^attachment/);
    const markdown = await exported.text();
    assert.match(markdown, /Early architecture[\s\S]+Archived model note[\s\S]+src\/Archive.java:3/);
    assert.match(markdown, /&lt;script&gt;/);
    assert.doesNotMatch(markdown, /fixture-wiki-secret|<script>/);
    assert.equal((await analyst.request('/summaries/' + earlyId + '/export?projectId=' + oldProjectId)).status, 404);
    assert.equal((await analyst.request('/summaries/' + skippedId + query)).status, 404);
    const run = await (await analyst.request('/agent-runs/' + runId + query)).json();
    assert.equal(run.outputReference, 'summaries:project:' + projectId);
    assert.equal(run.outputUnavailable, undefined);

    const file = join(projectRoot, citation.filePath);
    await mkdir(join(projectRoot, 'src'));
    await writeFile(file, 'package demo.archive;\npublic class Archive {\n    public int current() { return 1; }\n}');
    const admin = await login(base, 'admin');
    const { token: adminCsrf } = await (await admin.request('/auth/csrf')).json();
    assert.equal((await admin.request('/index/file?' + new URLSearchParams({ projectRoot, file }), 'POST', adminCsrf)).status, 200);
    const { token } = await (await analyst.request('/auth/csrf')).json();
    const accepted = await analyst.request('/summaries/generate' + query, 'POST', token);
    assert.equal(accepted.status, 202);
    const { agentRunId } = await accepted.json();
    let current;
    for (let attempt = 0; attempt < 100; attempt++) {
        current = await (await analyst.request('/agent-runs/' + agentRunId + query)).json();
        if (!['RUNNING', 'QUEUED'].includes(current.status)) break;
        await delay(20);
    }
    assert.equal(current.status, 'COMPLETED');
    const after = await (await analyst.request('/summaries/tree' + query)).json();
    assert.deepEqual(after.map(node => [node.path, node.docVersion]), [['project', 5], ['package/demo.archive', 8]]);
    assert.deepEqual(await (await analyst.request('/summaries/' + earlyId + query)).json(), doc);
    assert.equal((await (await analyst.request('/summaries/' + olderDuplicateId + query)).json()).title, 'Earlier same version');
    assert.equal((await (await analyst.request('/summaries/' + archivedId + query)).json()).docVersion, 3);
});

test('legacy detection rules retain published versions, audit and scoped evaluation history', { timeout: 20_000 }, async t => {
    const { source, projectId, migrate, start } = await legacyFixture(t);
    const ruleId = 'fixture.review-marker';
    const legacyRegex = 'fixture.legacy-regex';
    const db = new DatabaseSync(source);
    db.exec(`
        CREATE TABLE detection_rule_versions(rule_id, version, source, cwe, severity, title, matcher_kind, pattern, status,
            change_notes, active, created_at, updated_at);
        CREATE TABLE rule_languages(rule_id, version, item_index, language);
        CREATE TABLE rule_frameworks(rule_id, version, item_index, framework);
        CREATE TABLE rule_regression_samples(rule_id, version, sample_type, item_index, content);
        CREATE TABLE detection_rule_audit(id, rule_id, version, action, actor, reason, occurred_at);
        CREATE TABLE rule_evaluations(id, project_id, rule_id, version, report_json, generated_at);
    `);
    const version = db.prepare('INSERT INTO detection_rule_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    version.run(ruleId, 1, 'local', 'CWE-000', 'INFO',
        'Review marker', 'SUBSTRING', 'review ready', 'PUBLISHED', 'Initial fixture', 1, timestamp, timestamp);
    version.run(legacyRegex, 1, 'local', 'CWE-000', 'MEDIUM', 'Review regex', 'REGEX',
        '\\Qreview.ready\\E', 'PUBLISHED', 'Legacy Java matcher', 1, timestamp, timestamp);
    db.prepare('INSERT INTO rule_languages VALUES (?,?,?,?)').run(ruleId, 1, 0, 'text');
    db.prepare('INSERT INTO rule_languages VALUES (?,?,?,?)').run(legacyRegex, 1, 0, 'typescript');
    db.prepare('INSERT INTO rule_frameworks VALUES (?,?,?,?)').run(ruleId, 1, 0, 'fixture');
    const samples = db.prepare('INSERT INTO rule_regression_samples VALUES (?,?,?,?,?)');
    samples.run(ruleId, 1, 'POSITIVE', 1, 'review ready now');
    samples.run(ruleId, 1, 'POSITIVE', 0, 'review ready');
    samples.run(ruleId, 1, 'NEGATIVE', 0, 'waiting');
    samples.run(ruleId, 99, 'NEGATIVE', 0, 'orphan');
    const auditId = 'a1000000-0000-0000-0000-000000000001';
    db.prepare('INSERT INTO detection_rule_audit VALUES (?,?,?,?,?,?,?)').run(auditId, ruleId, 1, 'PUBLISHED',
        'legacy-reviewer', 'Published fixture', timestamp);
    const report = { ruleId, version: 1, projectId, generatedAt: timestamp, metrics: { hits: 0, confirmed: 0, falsePositives: 0,
        needsReview: 0, confirmationRate: null, falsePositiveRate: null, suppressionRate: null, noContextRate: null },
        regression: [], omittedReasons: ['No reviewed hits'] };
    const evaluation = db.prepare('INSERT INTO rule_evaluations VALUES (?,?,?,?,?,?)');
    evaluation.run('a1000000-0000-0000-0000-000000000002', projectId, ruleId, 1, JSON.stringify(report), timestamp);
    evaluation.run('a1000000-0000-0000-0000-000000000003', '123456789012', ruleId, 1, '{}', timestamp);
    db.close();
    const preview = await migrate('--dry-run');
    assert.deepEqual([preview.migrated.detectionRuleVersions, preview.migrated.detectionRuleAudit, preview.migrated.ruleEvaluations], [2, 1, 1]);
    assert.deepEqual([preview.skipped.rule_regression_samples, preview.skipped.rule_evaluations], [1, 1]);
    assert.deepEqual((await migrate()).migrated, preview.migrated);
    const base = await start();
    const admin = await login(base, 'admin');
    const analyst = await login(base, 'analyst');
    const path = '/rules/' + ruleId;
    const active = await (await analyst.request(path + '/active')).json();
    const migratedRegex = await (await analyst.request('/rules/' + legacyRegex + '/active')).json();
    assert.deepEqual(JSON.parse(toSourceSinkJson(migratedRegex)).sinks, [{
        matcherKind: 'REGEX', pattern: '\\Qreview.ready\\E', regexEngine: 'JAVA', regexFlags: ['DOTALL']
    }]);
    assert.deepEqual([active.status, active.pattern, active.positiveSamples, active.frameworks], ['PUBLISHED', 'review ready',
        ['review ready', 'review ready now'], ['fixture']]);
    assert.deepEqual((await (await analyst.request(path + '/audit')).json()).map(event => event.id), [auditId]);
    assert.deepEqual(await (await analyst.request(path + '/evaluations?' + new URLSearchParams({ projectId }))).json(), [report]);
    assert.equal((await analyst.request(path + '/evaluations?projectId=123456789012')).status, 403);
    const draft = { ...active, title: 'Updated fixture', matcherKind: 'REGEX', pattern: 'review.+ready',
        positiveSamples: ['review\nready'], negativeSamples: ['draft only'], reason: 'Review newer wording', actor: 'spoofed' };
    const { token: reviewerCsrf } = await (await analyst.request('/auth/csrf')).json();
    assert.equal((await analyst.request('/rules', 'POST', reviewerCsrf, draft)).status, 403);
    const { token } = await (await admin.request('/auth/csrf')).json();
    const create = await admin.request('/rules', 'POST', token, draft);
    assert.equal(create.status, 200);
    assert.deepEqual([(await create.json()).version, (await (await admin.request(path + '/active')).json()).version], [2, 1]);
    const action = { reason: 'Reviewed sample set', actor: 'spoofed' };
    assert.equal((await admin.request(path + '/versions/2/publish', 'POST', token, action)).status, 409);
    assert.equal((await admin.request(path + '/versions/2/review', 'POST', token, action)).status, 200);
    const published = await Promise.all([admin.request(path + '/versions/2/publish', 'POST', token, action),
        admin.request(path + '/versions/2/publish', 'POST', token, action)]);
    assert.deepEqual(published.map(result => result.status).sort(), [200, 409]);
    assert.equal((await (await admin.request(path + '/active')).json()).version, 2);
    const bad = await admin.request('/rules', 'POST', token, { ...draft, positiveSamples: ['not matched'] });
    assert.equal((await bad.json()).version, 3);
    assert.equal((await admin.request(path + '/versions/3/review', 'POST', token, action)).status, 200);
    assert.equal((await admin.request(path + '/versions/3/publish', 'POST', token, action)).status, 409);
    assert.equal((await admin.request(path + '/versions/3/reject', 'POST', token, action)).status, 200);
    assert.equal((await (await admin.request(path + '/rollback', 'POST', token, action)).json()).version, 1);
    const versions = await (await analyst.request('/rules?' + new URLSearchParams({ ruleId }))).json();
    assert.deepEqual(versions.map(rule => [rule.version, rule.status, rule.active]), [[3, 'REJECTED', false], [2, 'ROLLED_BACK', false], [1, 'PUBLISHED', true]]);
    const events = await (await analyst.request(path + '/audit')).json();
    assert.deepEqual(events.map(item => item.action), ['PUBLISHED', 'CREATED', 'SUBMITTED_FOR_REVIEW', 'SUPERSEDED', 'PUBLISHED',
        'CREATED', 'SUBMITTED_FOR_REVIEW', 'REJECTED', 'ROLLED_BACK', 'RESTORED']);
    assert.ok(events.slice(1).every(event => event.actor === 'admin'));
    const query = '?' + new URLSearchParams({ projectId });
    const empty = await (await analyst.request(path + '/evaluation' + query)).json();
    assert.equal(empty.metrics.hits, 0);
    assert.equal(empty.metrics.confirmationRate, null);
    assert.deepEqual(empty.regression.find(item => item.metric === 'hits'), { metric: 'hits', previous: 0, current: 0, delta: 0 });
    const scan = { results: [{ check_id: ruleId, path: 'fixture.txt', start: { line: 1 }, extra: { message: 'Review marker fixture' } }] };
    const submit = '/review-queue/snapshots' + query + '&format=semgrep&codeVersion=source-v1&ruleVersion=1';
    const snapshot = await analyst.request(submit, 'POST', reviewerCsrf, scan);
    assert.equal(snapshot.status, 200);
    const { entries: [{ fingerprint }] } = await snapshot.json();
    assert.equal((await analyst.request(submit, 'POST', reviewerCsrf, scan)).status, 200);
    const writeFeedback = ruleVersion => analyst.request('/triage/feedback' + query, 'POST', reviewerCsrf, {
        fingerprint, codeVersion: 'source-v1', ruleVersion, status: 'TRUE_POSITIVE', reason: 'Reviewed marker'
    });
    assert.equal((await writeFeedback('2')).status, 200);
    assert.equal((await analyst.request('/triage/suppressions' + query, 'POST', reviewerCsrf, {
        ruleId, scope: 'PROJECT', reason: 'Fixture only', expiresAt: new Date(Date.now() + 86_400_000).toISOString()
    })).status, 200);
    const mismatch = await (await analyst.request(path + '/evaluation' + query)).json();
    assert.deepEqual(mismatch.metrics, { ...report.metrics, hits: 1, suppressionRate: 1, noContextRate: 1 });
    assert.ok(mismatch.omittedReasons.includes('RULE_EVALUATION_FEEDBACK_VERSION_MISMATCH'));
    assert.equal((await writeFeedback('1')).status, 200);
    const measured = await (await analyst.request(path + '/evaluation' + query)).json();
    assert.deepEqual(measured.metrics, { ...mismatch.metrics, confirmed: 1, confirmationRate: 1, falsePositiveRate: 0 });
    assert.deepEqual(measured.regression.find(item => item.metric === 'confirmationRate'),
        { metric: 'confirmationRate', previous: null, current: 1, delta: null });
    assert.deepEqual((await (await analyst.request(path + '/evaluations' + query + '&limit=1')).json())[0], measured);
});

test('legacy scan history preserves task and run identities and paginates captured findings', { timeout: 20_000 }, async t => {
    const { root, source, projectRoot, projectId, migrate, start } = await legacyFixture(t);
    const oldRoot = join(root, 'old-scan-path');
    await symlink(projectRoot, oldRoot);
    const oldProjectId = createHash('sha256').update(oldRoot).digest('hex').slice(0, 12);
    const uuid = ordinal => 'a2000000-0000-0000-0000-' + String(ordinal).padStart(12, '0');
    const taskId = uuid(1), batchId = uuid(2), originalBatchId = uuid(3), interruptedId = uuid(4), assetId = uuid(5);
    const firstId = originalBatchId + '-semgrep', secondId = batchId + '-codeql';
    const fixture = { tool: 'semgrep', ruleId: 'fixture.marker', severity: 'INFO', message: 'Marker token="fixture-scan-secret"',
        filePath: 'src/Marker.java', startLine: 1, endLine: 1, raw: 'fixture-raw-scanner-payload' };
    const fingerprint = createHash('sha256').update('semgrep|fixture.marker|src/Marker.java|1').digest('hex').slice(0, 16);
    const first = { scanId: firstId, projectId: oldProjectId, scanner: 'SEMGREP', status: 'SUCCEEDED', toolVersion: 'fixture 1',
        exitCode: 0, durationMs: 20, startedAt: timestamp, finishedAt: timestamp, error: '', findings: [fixture] };
    const nextTime = '2026-11-10T09:46:30Z';
    const second = { ...first, scanId: secondId, scanner: 'CODEQL', status: 'TIMED_OUT', exitCode: -1, startedAt: nextTime,
        finishedAt: nextTime, error: 'tool detail fixture-secret-run-error', findings: [fixture, { ...fixture, startLine: 2, endLine: 2 }] };
    const db = new DatabaseSync(source);
    db.prepare('UPDATE index_history SET project_root = ?').run(oldRoot);
    db.prepare('UPDATE enterprise_project_owners SET project_id = ?').run(oldProjectId);
    db.prepare('INSERT INTO enterprise_accounts VALUES (?,?,?,?,?,?,?,?,?)').run('legacy-outsider', 'outsider', 'Outsider',
        'outsider@example.test', bcrypt, 'USER', 'ACTIVE', 1, timestamp);
    db.exec(`
        CREATE TABLE scan_tasks(id,project_id,asset_id,scanners,languages,timeout_seconds,status,attempt,batch_id,error,batch_json,created_at,updated_at);
        CREATE TABLE scanner_runs(scan_id,batch_id,project_id,scanner,status,started_at,result_json);
        CREATE TABLE external_findings(project_id,fingerprint,scanner,scan_id,finding_json,first_seen_at,last_seen_at);
    `);
    const task = db.prepare('INSERT INTO scan_tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const args = [oldProjectId, assetId, '["SEMGREP","CODEQL"]', '["java"]', 30];
    const captured = JSON.stringify({ batchId, projectId: oldProjectId, status: 'PARTIAL', runs: [first, second] });
    task.run(taskId, ...args, 'PARTIAL', 2, batchId, '', captured, timestamp, nextTime);
    task.run(interruptedId, ...args, 'RUNNING', 3, batchId, '', captured, timestamp, nextTime);
    task.run(uuid(6), '123456789012', ...args.slice(1), 'FAILED', 1, '', '', null, timestamp, timestamp);
    const run = db.prepare('INSERT INTO scanner_runs VALUES (?,?,?,?,?,?,?)');
    run.run(firstId, originalBatchId, oldProjectId, first.scanner, first.status, timestamp, JSON.stringify(first));
    run.run(uuid(7) + '-semgrep', uuid(7), '123456789012', 'SEMGREP', 'FAILED', timestamp, '{}');
    db.prepare('INSERT INTO external_findings VALUES (?,?,?,?,?,?,?)').run(oldProjectId, fingerprint, first.scanner, firstId,
        JSON.stringify(fixture), timestamp, timestamp);
    db.close();
    const preview = await migrate('--dry-run');
    assert.deepEqual([preview.migrated.scanTasks, preview.migrated.scannerRuns, preview.migrated.embeddedScannerRuns], [2, 1, 1]);
    assert.deepEqual([preview.skipped.scan_tasks, preview.skipped.scanner_runs], [1, 1]);
    assert.deepEqual((await migrate()).migrated, preview.migrated);
    const base = await start();
    const analyst = await login(base, 'analyst');
    const query = '?' + new URLSearchParams({ projectId });
    const details = await (await analyst.request('/scan-tasks/' + taskId + query)).json();
    const tasks = await (await analyst.request('/scan-tasks' + query)).json();
    assert.equal(tasks.total, 2);
    assert.deepEqual([details.id, details.projectId, details.status, details.batchId, details.attempt, details.assetAvailable, details.findingCount],
        [taskId, projectId, 'PARTIAL', batchId, 2, false, 2]);
    assert.deepEqual(details.scanners.map(item => [item.scanId, item.status]), [[firstId, 'SUCCEEDED'], [secondId, 'TIMED_OUT']]);
    const interrupted = await (await analyst.request('/scan-tasks/' + interruptedId + query)).json();
    assert.deepEqual([interrupted.status, interrupted.originalStatus, interrupted.error, interrupted.findingCount], ['FAILED', 'RUNNING', 'PROCESS_INTERRUPTED', 2]);
    assert.equal((await analyst.request('/scan-tasks/' + taskId + '?projectId=' + oldProjectId)).status, 404);
    const page = await (await analyst.request('/scan-tasks/' + taskId + '/findings' + query + '&page=1&size=1')).json();
    assert.deepEqual([page.page, page.size, page.total, page.findings[0].startLine], [1, 1, 2, 2]);
    const bounded = await (await analyst.request('/scan-tasks/' + taskId + '/findings' + query + '&page=-1&size=0')).json();
    assert.deepEqual([bounded.page, bounded.size, bounded.total, bounded.findings[0].startLine], [0, 1, 2, 1]);
    assert.doesNotMatch(JSON.stringify(page), /fixture-scan-secret|fixture-raw-scanner-payload/);
    const original = await (await analyst.request('/scans/' + firstId + query)).json();
    assert.equal(original.batchId, originalBatchId);
    assert.equal(original.findings[0].fingerprint, fingerprint);
    const embedded = await (await analyst.request('/scans/' + secondId + query)).json();
    assert.equal(embedded.batchId, '');
    assert.doesNotMatch(JSON.stringify(embedded), /fixture-secret-run-error/);
    const ordered = await (await analyst.request('/scans' + query)).json();
    assert.deepEqual(ordered.entries.map(item => item.scanId), [secondId, firstId]);
    const inventory = await (await analyst.request('/triage/findings/' + fingerprint + query)).json();
    assert.equal(inventory.finding.legacyScan.hasArchivedRun, true);
    const outsider = await login(base, 'outsider');
    assert.equal((await outsider.request('/scan-tasks' + query)).status, 403);
    assert.equal((await outsider.request('/scan-tasks/' + taskId + '/findings')).status, 404);
    assert.equal((await outsider.request('/scans/' + firstId)).status, 404);
});

test('legacy provider credentials are authenticated and rebound before the converted store is published', { timeout: 20_000 }, async t => {
    const { root, source, output, migrate, start } = await legacyFixture(t);
    const connections = [];
    const upstream = createServer((request, response) => {
        connections.push({ path: request.url, auth: request.headers.authorization });
        request.resume();
        request.on('end', () => {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
        });
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    t.after(() => { upstream.close(); upstream.closeAllConnections(); });

    const apiKey = randomBytes(24).toString('hex');
    const providerId = 'a6a22894-8ded-42b0-9c5c-85457a123456';
    const legacyKey = randomBytes(32);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', legacyKey, nonce);
    cipher.setAAD(Buffer.from(providerId));
    const ciphertext = Buffer.concat([cipher.update(apiKey), cipher.final()]);
    const encrypted = Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64');
    const db = new DatabaseSync(source);
    db.exec(`CREATE TABLE model_providers (id, name, protocol, base_url, model, enabled, selected, encrypted_key,
        timeout_millis, max_output_tokens, updated_at, input_usd_per_million, output_usd_per_million)`);
    db.prepare('INSERT INTO model_providers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(providerId, 'Legacy provider',
        'OPENAI_COMPATIBLE', `http://127.0.0.1:${upstream.address().port}/v1`, 'fixture-model', 1, 1, encrypted,
        15_000, 128, timestamp, 2, 4);
    db.close();

    const keyFile = join(root, 'provider-encryption-key');
    await writeFile(keyFile, randomBytes(32).toString('base64'), { mode: 0o600 });
    await assert.rejects(migrate(), /LEGACY_PROVIDER_KEY_INVALID/);
    await assert.rejects(stat(output), { code: 'ENOENT' });
    await writeFile(keyFile, legacyKey.toString('base64'));
    const summary = await migrate();
    assert.equal(summary.migrated.modelProviders, 1);
    assert.equal(connections.length, 0);
    const database = join(output, 'index.db');
    assert.equal((await stat(database + '-provider-key')).mode & 0o777, 0o600);
    assert.notEqual(await readFile(database + '-provider-key', 'utf8'), legacyKey.toString('base64'));
    assert.equal((await readFile(database)).includes(apiKey), false);
    const base = await start();
    const admin = await login(base, 'admin');
    const path = '/admin/model-providers';
    const providers = await (await admin.request(path)).json();
    assert.equal(providers[0].selected, true);
    assert.equal(providers[0].id, providerId);
    assert.equal(providers[0].apiKeyConfigured, true);
    assert.equal(providers[0].inputUsdPerMillionTokens, 2);
    assert.equal(JSON.stringify(providers).includes(apiKey), false);
    const { token } = await (await admin.request('/auth/csrf')).json();
    const result = await admin.request(path + '/' + providerId + '/test', 'POST', token);
    assert.equal(result.status, 200);
    assert.deepEqual(connections, [{ path: '/v1/chat/completions', auth: 'Bearer ' + apiKey }]);
});

test('legacy inventory retains decisions, scoped evidence and dependency deduplication after a project ID change', { timeout: 20_000 }, async t => {
    const { root, source, projectId, projectRoot, migrate, start } = await legacyFixture(t);
    const legacyRoot = join(root, 'legacy-project');
    await symlink(projectRoot, legacyRoot);
    const oldProjectId = createHash('sha256').update(legacyRoot).digest('hex').slice(0, 12);
    const dependencyUnit = 'dep:fixture.group:core:1.5:fixture-warning';
    const dependencyId = createHash('sha256').update(oldProjectId + ':DEP_VULNERABILITY:' + dependencyUnit).digest('hex').slice(0, 16);
    const reviewedId = '1000000000000001';
    const skippedId = '2000000000000002';
    const wikiRunId = '70000000-0000-0000-0000-000000000001';
    const db = new DatabaseSync(source);
    db.prepare('UPDATE index_history SET project_root = ?').run(legacyRoot);
    db.prepare('UPDATE enterprise_project_owners SET project_id = ?').run(oldProjectId);
    db.exec(`
        CREATE TABLE advisories (id, summary, severity, cwe, group_id, artifact_id, introduced, fixed, source);
        CREATE TABLE vuln_findings (id, project_id, rule_id, cwe, severity, status, unit_id, qual_name, file_path,
            start_line, title, detail, found_at);
        CREATE TABLE vuln_taint_evidence (finding_id, sequence_no, role, method_qn, from_slot, to_slot, file_path,
            start_line, end_line, source_excerpt);
        CREATE TABLE agent_runs(id, project_id, playbook, playbook_version, status, input_reference, output_reference,
            status_reason, created_at, updated_at, completed_at);
    `);
    db.prepare('INSERT INTO advisories VALUES (?,?,?,?,?,?,?,?,?)').run('fixture-warning', 'Fixture advisory', 'LOW', '',
        'fixture.group', 'core', '1.0', '2.0', 'imported');
    const finding = db.prepare('INSERT INTO vuln_findings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    finding.run(dependencyId, oldProjectId, 'DEP_VULNERABILITY', '', 'LOW', 'FIXED',
        dependencyUnit, 'fixture.group:core', 'pom.xml', 0, 'Previous dependency finding', null, timestamp);
    finding.run(reviewedId, oldProjectId, 'WEAK_CRYPTO', 'CWE-327', 'MEDIUM', 'CONFIRMED', '0'.repeat(64),
        'example.Check#summarize()', 'src/Check.java', 3, 'Previous review finding', 'An existing review decision', timestamp);
    finding.run(skippedId, '123456789012', 'FIXTURE_REVIEW', '', 'LOW', 'SUSPECTED', '1'.repeat(64),
        'other.Check#summarize()', 'src/Check.java', 1, 'Unmapped finding', '', timestamp);
    const step = db.prepare('INSERT INTO vuln_taint_evidence VALUES (?,?,?,?,?,?,?,?,?,?)');
    step.run(reviewedId, 2, 'PROPAGATION', 'example.Check#summarize()', '', '', '', 0, 0, '');
    step.run(reviewedId, 1, 'SOURCE', 'example.Check#summarize()', '', '', 'src/Check.java', 3, 4,
        'String apiKey = "fixture-value-to-mask";\nString note = "sample";');
    step.run(skippedId, 1, 'SOURCE', 'other.Check#summarize()', '', '', 'src/Check.java', 1, 1, '');
    db.prepare('INSERT INTO agent_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(wikiRunId, oldProjectId, 'WIKI_SUMMARY', '1',
        'COMPLETED', 'facts:graph:' + oldProjectId, 'summaries:project:' + oldProjectId, '', timestamp, timestamp, timestamp);
    db.close();
    await writeFile(join(projectRoot, 'pom.xml'), `<project><dependencies>
        <dependency><groupId>fixture.group</groupId><artifactId>core</artifactId><version>1.5</version></dependency>
    </dependencies></project>`);
    await mkdir(join(projectRoot, 'src'));
    await writeFile(join(projectRoot, 'src', 'Check.java'), [
        'package example;',
        'public class Check {',
        '  public int summarize() { return "MD5".length(); }',
        '  public int call() { return this.summarize(); }',
        '}'
    ].join('\n'));

    const preview = await migrate('--dry-run');
    assert.equal(preview.migrated.vulnerabilityFindings, 2);
    assert.equal(preview.migrated.vulnerabilityEvidenceSteps, 2);
    assert.equal(preview.migrated.agentRuns, 1);
    assert.equal(preview.skipped.vuln_findings, 1);
    assert.equal(preview.skipped.vuln_taint_evidence, 1);
    const imported = await migrate();
    assert.deepEqual(imported.migrated, preview.migrated);
    const base = await start();
    const analyst = await login(base, 'analyst');
    const query = '?' + new URLSearchParams({ projectId });
    const wiki = await (await analyst.request('/agent-runs/' + wikiRunId + query)).json();
    assert.deepEqual([wiki.id, wiki.projectId, wiki.inputReference, wiki.outputReference, wiki.outputUnavailable],
        [wikiRunId, projectId, 'facts:graph:' + projectId, 'summaries:project:' + projectId, true]);
    assert.equal((await analyst.request('/agent-runs/' + wikiRunId + '?projectId=' + oldProjectId)).status, 404);
    const detailPath = '/vulns/' + reviewedId;
    const detail = await (await analyst.request(detailPath + query)).json();
    assert.equal(detail.finding.projectId, projectId);
    assert.equal(detail.finding.status, 'CONFIRMED');
    assert.equal(detail.finding.foundAt, timestamp);
    assert.equal(detail.finding.legacyImported, true);
    assert.equal(detail.audit.length, 1);
    assert.equal(detail.audit[0].fromStatus, null);
    assert.equal(detail.audit[0].toStatus, 'CONFIRMED');
    assert.equal(detail.audit[0].actor, 'system:legacy-migration');
    const evidence = await (await analyst.request(detailPath + '/taint-evidence' + query)).json();
    assert.deepEqual(evidence.map(step => step.sequence), [1, 2]);
    assert.equal(evidence[0].filePath, 'src/Check.java');
    assert.match(evidence[0].sourceExcerpt, /String apiKey = "\*+";\nString note = "sample";/);
    assert.ok(!JSON.stringify(evidence).includes('fixture-value-to-mask'));
    assert.deepEqual(detail.evidence, evidence);
    assert.equal((await analyst.request(detailPath + '/taint-evidence?projectId=123456789012')).status, 404);
    assert.equal((await analyst.request('/vulns/' + skippedId)).status, 404);
    assert.deepEqual(await (await analyst.request(detailPath + '/impact' + query)).json(), []);
    const admin = await login(base, 'admin');
    const { token: adminCsrf } = await (await admin.request('/auth/csrf')).json();
    const repository = '?' + new URLSearchParams({ projectRoot });
    assert.equal((await admin.request('/index/project' + repository, 'POST', adminCsrf)).status, 202);
    for (let i = 0; i < 100; i++) {
        const job = await (await admin.request('/index/project/status' + repository)).json();
        if (job.status !== 'running') { assert.equal(job.status, 'done'); break; }
        await delay(20);
    }
    const impact = await (await analyst.request(detailPath + '/impact' + query)).json();
    assert.deepEqual(impact.map(unit => unit.qualifiedName), ['example.Check#call()']);

    const { token } = await (await analyst.request('/auth/csrf')).json();
    const codeScan = await analyst.request('/vulns/scan/code' + query, 'POST', token);
    assert.equal(codeScan.status, 200);
    assert.deepEqual(await codeScan.json().then(({ matchedFindings, newFindings }) => [matchedFindings, newFindings]), [1, 0]);
    const scan = await analyst.request('/vulns/scan/deps' + query, 'POST', token);
    assert.equal(scan.status, 200);
    const result = await scan.json();
    assert.equal(result.newFindings, 0);
    assert.deepEqual(result.preview.map(item => item.id), [dependencyId]);
    const dependency = await (await analyst.request('/vulns/' + dependencyId + query)).json();
    assert.equal(dependency.finding.status, 'FIXED');
    assert.equal(dependency.finding.dependency.purl, 'pkg:maven/fixture.group/core@1.5');
    assert.equal(dependency.finding.dependency.fixed, '');
    assert.equal((await analyst.request(detailPath + '/status' + query + '&status=FIXED&revision=0', 'PUT', token)).status, 200);
    const report = await (await analyst.request('/vulns/report/' + projectId)).json();
    assert.deepEqual(report.byStatus, { FIXED: 2 });
});

test('legacy managed archives rebuild a private copy and keep assigned project records', { timeout: 20_000 }, async t => {
    const { root, source, output, migrate, start } = await legacyFixture(t);
    const legacyAssets = join(root, 'old-assets');
    const assetId = '10100000-0000-0000-0000-000000000001';
    const unsafeId = '10100000-0000-0000-0000-000000000002';
    const deletingId = '10100000-0000-0000-0000-000000000003';
    const original = join(legacyAssets, assetId, 'source', 'bundle');
    const unsafe = join(legacyAssets, unsafeId, 'source');
    const removed = join(legacyAssets, deletingId, 'source');
    const projectIdFor = path => createHash('sha256').update(path).digest('hex').slice(0, 12);
    const oldProjectId = projectIdFor(original);
    await mkdir(join(original, 'empty'), { recursive: true });
    await mkdir(unsafe, { recursive: true });
    await mkdir(removed, { recursive: true });
    const contents = 'export function restoredBundle() { return 32; }\n';
    await writeFile(join(original, 'main.ts'), contents);
    await writeFile(join(original, 'package.json'), '{"name":"archive-fixture","dependencies":{"labels":"1.0.0"}}');
    await symlink(join(original, 'main.ts'), join(unsafe, 'unsafe.ts'));
    await writeFile(join(removed, 'old.ts'), 'export const old = true;');
    const db = new DatabaseSync(source);
    db.exec(`CREATE TABLE imported_assets (asset_id, project_id, original_name, archive_type, project_root, status,
        error, created_at, updated_at);
        CREATE TABLE vuln_findings (id, project_id, rule_id, cwe, severity, status, unit_id, qual_name, file_path,
            start_line, title, detail, found_at);
        CREATE TABLE scan_tasks(id,project_id,asset_id,scanners,languages,timeout_seconds,status,attempt,batch_id,error,batch_json,created_at,updated_at);
        CREATE TABLE scanner_runs(scan_id,batch_id,project_id,scanner,status,started_at,result_json);`);
    const asset = db.prepare('INSERT INTO imported_assets VALUES (?,?,?,?,?,?,?,?,?)');
    for (const [id, path] of [[assetId, original], [unsafeId, unsafe], [deletingId, removed]]) {
        asset.run(id, projectIdFor(path), 'legacy-bundle.zip', 'ZIP', path, 'READY', '', timestamp, timestamp);
        db.prepare('INSERT INTO index_history VALUES (?,?,?)').run(path, 'done', timestamp);
    }
    db.prepare('INSERT INTO pending_project_deletions VALUES (?)').run(projectIdFor(removed));
    db.prepare('INSERT INTO enterprise_project_owners VALUES (?,?,?,?)').run(oldProjectId, 'ORGANIZATION', 'legacy-team', timestamp);
    const findingId = '1000000000001001';
    db.prepare('INSERT INTO vuln_findings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(findingId, oldProjectId,
        'FIXTURE_REVIEW', '', 'LOW', 'FIXED', '0'.repeat(64), 'restoredBundle', 'main.ts', 1, 'Historical decision', '', timestamp);
    const taskId = '10100000-0000-0000-0000-000000000004';
    const batchId = '10100000-0000-0000-0000-000000000005';
    const scanId = batchId + '-semgrep';
    const scan = { scanId, projectId: oldProjectId, scanner: 'SEMGREP', status: 'SUCCEEDED', toolVersion: 'fixture 1',
        exitCode: 0, durationMs: 10, startedAt: timestamp, finishedAt: timestamp, findings: [], error: '' };
    db.prepare('INSERT INTO scan_tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(taskId, oldProjectId, assetId, '["SEMGREP"]',
        '["typescript"]', 30, 'SUCCEEDED', 1, batchId, '', JSON.stringify({
            batchId, projectId: oldProjectId, status: 'SUCCEEDED', runs: [scan]
        }), timestamp, timestamp);
    db.prepare('INSERT INTO scanner_runs VALUES (?,?,?,?,?,?,?)').run(scanId, batchId, oldProjectId, 'SEMGREP',
        'SUCCEEDED', timestamp, JSON.stringify(scan));
    db.close();
    const sourceBytes = await readFile(source);
    const args = ['--legacy-assets-root', legacyAssets];
    const dryRun = await migrate(...args, '--dry-run');
    assert.equal(dryRun.migrated.managedAssets, 1);
    assert.equal(dryRun.skipped.imported_assets, 2);
    assert.equal(dryRun.assetsSkipped.unsafe, 1);
    assert.equal(dryRun.assetsSkipped.pendingDeletion, 1);
    await assert.rejects(stat(output), { code: 'ENOENT' });
    const result = await migrate(...args);
    assert.deepEqual(result.migrated, dryRun.migrated);
    assert.equal(result.assetIndex.ready, 1);
    assert.deepEqual(await readFile(source), sourceBytes);

    const base = await start();
    const analyst = await login(base, 'analyst');
    const assetRoute = '/assets/' + assetId;
    const response = await analyst.request(assetRoute);
    assert.equal(response.status, 200);
    const restored = await response.json();
    const targetRoot = join(output, 'index.db-assets', assetId, 'source', 'bundle');
    const project = projectIdFor(targetRoot);
    const query = '?' + new URLSearchParams({ projectId: project });
    assert.equal(restored.assetId, assetId);
    assert.equal(restored.projectId, project);
    assert.notEqual(project, oldProjectId);
    assert.equal(restored.projectRoot, targetRoot);
    assert.equal(restored.createdAt, timestamp);
    assert.equal(restored.status, 'READY');
    assert.equal((await stat(join(targetRoot, 'empty'))).isDirectory(), true);
    assert.equal(await readFile(join(targetRoot, 'main.ts'), 'utf8'), contents);
    assert.equal((await (await analyst.request('/symbol/restoredBundle' + query)).json()).filePath, 'main.ts');
    assert.equal((await (await analyst.request('/vulns/' + findingId + query)).json()).finding.status, 'FIXED');
    assert.equal((await (await analyst.request(assetRoute + '/profile')).json()).dependencies[0].coordinate, 'labels');
    const archivedRuns = await (await analyst.request(assetRoute + '/scans')).json();
    assert.deepEqual(archivedRuns.map(item => [item.scanId, item.projectId, item.findings]), [[scanId, project, []]]);
    assert.equal((await (await analyst.request('/scan-tasks/' + taskId)).json()).assetAvailable, true);
    assert.equal((await analyst.request('/assets/' + unsafeId)).status, 404);
    const { token: analystToken } = await (await analyst.request('/auth/csrf')).json();
    assert.equal((await analyst.request(assetRoute + '/reindex', 'POST', analystToken)).status, 403);

    const admin = await login(base, 'admin');
    const { token } = await (await admin.request('/auth/csrf')).json();
    assert.equal((await admin.request(assetRoute + '/reindex', 'POST', token)).status, 202);
    for (let i = 0; i < 100; i++) {
        const state = await (await admin.request(assetRoute)).json();
        if (state.status !== 'INDEXING') { assert.equal(state.status, 'READY'); break; }
        await delay(20);
    }
    assert.equal((await admin.request(assetRoute, 'DELETE', token)).status, 200);
    assert.equal((await admin.request('/scans/' + scanId)).status, 404);
    assert.equal((await admin.request('/scan-tasks/' + taskId)).status, 404);
    assert.equal((await stat(targetRoot)).isDirectory(), true);
    const lifecycle = '/projects/' + project + '/lifecycle';
    assert.equal((await admin.request(lifecycle, 'POST', token, { action: 'purge', revision: 1 },
        { 'Idempotency-Key': 'purge-migrated-archive' })).status, 202);
    async function collected() { return (await (await admin.request(lifecycle)).json()).state === 'PURGED'; }
    for (let i = 0; i < 100 && !await collected(); i++) await delay(25);
    assert.equal(await collected(), true);
    await assert.rejects(stat(targetRoot), { code: 'ENOENT' });
    assert.equal(await readFile(join(original, 'main.ts'), 'utf8'), contents);
    assert.equal(await readFile(join(removed, 'old.ts'), 'utf8'), 'export const old = true;');
});
