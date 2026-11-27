import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempDisposable, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

test('offline host reports audit supplied configuration and summarize submitted logs', { timeout: 15_000 }, async t => {
    const fixture = await mkdtempDisposable(join(tmpdir(), 'repograph-config-audit-'));
    const token = randomBytes(32).toString('hex');
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: { ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined,
            REPOGRAPH_DB_PATH: join(fixture.path, 'index.db'), REPOGRAPH_PROJECTS_ROOT: fixture.path, REPOGRAPH_PORT: '0',
            REPOGRAPH_EMBEDDING_MODEL: undefined },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            const stopped = once(child, 'exit');
            child.kill('SIGTERM');
            await stopped;
        }
        await fixture.remove();
    });
    const base = await new Promise((resolve, reject) => {
        let messages = '';
        child.once('error', reject);
        child.once('exit', code => reject(new Error('Server exited (' + code + '): ' + messages)));
        child.stderr.on('data', chunk => {
            messages += chunk;
            const url = messages.match(/RepoGraph listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
            if (url) resolve(url);
        });
    });
    const request = (payload, authorized = true, reportPath = 'config-audit') => fetch(base + '/api/v1/' + reportPath + '/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(payload)
    });
    assert.equal((await fetch(base + '/api/v1/health')).status, 401);
    const health = await fetch(base + '/api/v1/health', { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', sqlite: 'ok', ollama: 'disabled' });
    for (const path of ['/livez', '/readyz']) {
        const probe = await fetch(base + path);
        assert.equal(probe.status, 200);
        assert.deepEqual(await probe.json(), { status: 'ok' });
    }
    const diagnosticPath = base + '/api/v1/admin/diagnostics';
    const authorization = { headers: { Authorization: 'Bearer ' + token } };
    assert.equal((await fetch(diagnosticPath)).status, 401);
    const diagnostics = await (await fetch(diagnosticPath, authorization)).json();
    assert.equal(diagnostics.status, 'ok');
    assert.equal(diagnostics.components.managedFiles, 'available');
    assert.equal(diagnostics.components.fullText, 'available');
    assert.equal(diagnostics.components.generation.status, 'disabled');
    for (const worker of ['wiki', 'gitSync', 'ask', 'changeReview', 'sastTriage', 'archiveScan', 'localIndex']) {
        assert.equal(diagnostics.components.workers[worker].status, 'available');
    }
    const store = join(fixture.path, 'index.db-assets');
    await rename(store, store + '-offline');
    try {
        const fault = await (await fetch(diagnosticPath, authorization)).json();
        assert.equal(fault.status, 'degraded');
        assert.equal(fault.components.managedFiles, 'unavailable');
        assert.equal(fault.components.database, 'available');
        assert.equal((await fetch(base + '/readyz')).status, 200);
    } finally { await rename(store + '-offline', store); }
    const storage = new DatabaseSync(join(fixture.path, 'index.db'));
    try { storage.exec('DROP TABLE ask_job; DROP TABLE unit_search;'); }
    finally { storage.close(); }
    let dispatcherFault;
    for (let attempt = 0; attempt < 30; attempt++) {
        dispatcherFault = await (await fetch(diagnosticPath, authorization)).json();
        if (dispatcherFault.components.workers.ask.status === 'unavailable') break;
        await delay(40);
    }
    assert.equal(dispatcherFault.status, 'degraded');
    assert.equal(dispatcherFault.components.workers.ask.status, 'unavailable');
    assert.equal(dispatcherFault.components.workers.wiki.status, 'available');
    assert.equal(dispatcherFault.components.fullText, 'unavailable');
    assert.deepEqual(dispatcherFault.activity.unavailableQueues, ['ask']);
    const payload = { dimensions: ['SECURITY_POLICY'], files: [
        { name: 'z.conf', content: "# policy\r\nPermitRootLogin = 'yes' # comment\r\nPASS_MIN_LEN=12\r\nMaxAuthTries 3\r\nTMOUT=600" },
        { name: 'a.conf', content: 'PASS_MIN_LEN=12\nMaxAuthTries 3\nTMOUT=synthetic-credential-text' }
    ] };
    assert.equal((await request(payload, false)).status, 401);
    const response = await request(payload);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const observed = await (await fetch(diagnosticPath + '/requests/' + response.headers.get('x-request-id'), authorization)).json();
    assert.equal(observed.status, 200);
    assert.ok(observed.durationMs >= 0);
    assert.doesNotMatch(JSON.stringify(observed), /synthetic-credential-text|z\.conf|config-audit/);
    const report = await response.json();
    assert.deepEqual(report.dimensionsAudited, ['SECURITY_POLICY']);
    assert.equal(report.checkedRules, 5);
    assert.equal(report.scannedFiles, 2);
    assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(report.violations.map(({ filePath, ruleId, lineNumber, severity }) => [filePath, ruleId, lineNumber, severity]), [
        ['a.conf', 'policy-session-timeout', 3, 'MEDIUM'],
        ['z.conf', 'policy-permit-root-login', 2, 'HIGH']
    ]);
    assert.equal(report.violations[1].evidence, 'PermitRootLogin yes');
    assert.doesNotMatch(JSON.stringify(report), /synthetic-credential-text/);
    const empty = await (await request({ files: null })).json();
    assert.equal(empty.checkedRules, 16);
    assert.deepEqual([...empty.dimensionsAudited].sort(), ['HOST_BASELINE', 'SECURITY_POLICY', 'SYSTEM_CONFIG', 'SYSTEM_LOG']);
    assert.deepEqual(await (await request({ files: [{ name: 'sysctl.conf', content: 'kernel.kexec_load_disabled=1' }],
        dimensions: ['SYSTEM_CONFIG'] })).json().then(result => result.violations), []);
    assert.equal((await request({ dimensions: ['UNSUPPORTED'] })).status, 400);
    assert.equal((await request({ files: [{ name: 'oversized.conf', content: ' '.repeat(1024 * 1024) }] })).status, 413);

    const logs = { outboundWhitelist: ['192.0.2.0/24', '198.51.100.4', 'approved-service'], logs: [
        { name: 'network.log', content: 'Oct 13 10:03:04 kernel DST=192.0.2.32\n'
            + 'Oct 13 10:03:05 app Outbound Connection To 198.51.100.4\n'
            + 'Oct 13 10:03:06 app Outbound Connection To 203.0.113.7 privateToken=sample-token-fixture' },
        { name: 'auth.log', content: [
            ...Array(5).fill('Oct 13 09:10:01 sshd: Failed password for example-user from 203.0.113.9 port 40100'),
            'Oct 13 09:13:00 sshd: authentication failure; secret=hidden-fixture user=example-reviewer',
            'Oct 13 09:15:00 sshd: Invalid user sample from 2001:db8::9'
        ].join('\r\n') }
    ] };
    const detections = await request(logs, true, 'threat-detection');
    assert.equal(detections.status, 200);
    const logReport = await detections.json();
    assert.equal(logReport.scannedLogs, 2);
    assert.deepEqual(logReport.records.map(item => [item.logFile, item.lineNumber, item.ruleId]), [
        ['auth.log', 1, 'attack-brute-force-ssh'], ['auth.log', 6, 'attack-auth-failure'],
        ['auth.log', 7, 'attack-invalid-user-probe'], ['network.log', 3, 'outbound-app-connect']
    ]);
    assert.equal(logReport.records[0].time, 'Oct 13 09:10:01');
    assert.match(logReport.records[0].detail, /5 次登录失败.*example-user.*203\.0\.113\.9/);
    assert.equal(logReport.records[3].kind, 'VIOLATION_OUTBOUND');
    assert.match(logReport.records[3].evidence, /203\.0\.113\.7/);
    assert.doesNotMatch(JSON.stringify(logReport), /hidden-fixture|sample-token-fixture/);
    const belowThreshold = await (await request({ logs: [{ name: 'short.log',
        content: 'Oct 13 09:10:01 sshd: Failed password for example-user from 203.0.113.9\n'.repeat(4) }] },
        true, 'threat-detection')).json();
    assert.deepEqual(belowThreshold.records, []);
    const boundedLogs = await request({ logs: [{ name: 'network.log', content: 'kernel DST=203.0.113.7\n'.repeat(5001) }] }, true, 'threat-detection');
    assert.equal(boundedLogs.status, 413);
    assert.deepEqual(await boundedLogs.json(), { error: 'THREAT_REPORT_RESULT_LIMIT' });
});
