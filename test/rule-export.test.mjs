import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { toSemgrepYaml, toSourceSinkJson } from '../dist/rule-export.js';

const exec = promisify(execFile);
const semgrep = process.env.REPOGRAPH_TEST_SEMGREP_BINARY;

const base = {
    ruleId: 'fixture.review-marker', version: 3, source: 'local', cwe: 'CWE-000',
    title: 'Review : marker',
    languages: ['typescript'], frameworks: ['fixture'], severity: 'UNKNOWN',
    matcherKind: 'REGEX', pattern: '^// first.*// last$'
};

const literal = '$LABEL...*(value)\\E #中文\n// \'quoted\'';

test('rule export preserves versioned metadata, matcher text and severity across formats', () => {
    const rule = Object.freeze({ ...base, regexEngine: 'JAVA' });
    const yaml = toSemgrepYaml(rule);
    const sourceSink = toSourceSinkJson(rule);
    assert.match(yaml, /^rules:\n  - id: "fixture\.review-marker"\n/);
    assert.ok(yaml.includes('    pattern-regex: ' + JSON.stringify('(?s-m)' + rule.pattern)));
    assert.ok(yaml.includes('      repograph-regex-engine: "JAVA"'));
    assert.ok(yaml.includes('    severity: "WARNING"'));
    assert.deepEqual(JSON.parse(sourceSink), {
        cwe: 'CWE-000', frameworks: ['fixture'], languages: ['typescript'], ruleId: base.ruleId, severity: 'UNKNOWN',
        sinks: [{ matcherKind: 'REGEX', pattern: base.pattern, regexEngine: 'JAVA', regexFlags: ['DOTALL'] }],
        source: 'local', sources: [], version: 3
    });
    assert.equal(toSemgrepYaml(rule), yaml);
    assert.equal(toSourceSinkJson(rule), sourceSink);
    const current = { ...base, version: 4, severity: 'HIGH' };
    assert.match(toSemgrepYaml(current), /repograph-regex-engine: "ECMASCRIPT"/);
    assert.match(toSemgrepYaml(current), /repograph-version: 4/);
    assert.match(toSemgrepYaml(current), /severity: "ERROR"/);
    assert.equal(JSON.parse(toSourceSinkJson(current)).sinks[0].regexEngine, 'ECMASCRIPT');
    assert.equal(JSON.parse(toSourceSinkJson(current)).severity, 'HIGH');
    assert.equal(JSON.parse(toSourceSinkJson(current)).version, 4);
});

test('substring export quotes backslashes, newlines and rule-like text as data', () => {
    const rule = { ...base, matcherKind: 'SUBSTRING', pattern: literal, title: 'yes\nrules:\n- id: injected' };
    const yaml = toSemgrepYaml(rule);
    const pattern = String.raw`\Q$LABEL...*(value)\E\\E\Q #中文` + "\n// 'quoted'" + String.raw`\E`;
    assert.ok(yaml.includes('    pattern-regex: ' + JSON.stringify(pattern)));
    assert.ok(yaml.includes('    message: ' + JSON.stringify(rule.title)));
    assert.doesNotMatch(yaml, /^- id: injected$/m);
    assert.doesNotMatch(yaml, /repograph-regex-engine/);
    assert.deepEqual(JSON.parse(toSourceSinkJson(rule)).sinks, [{ matcherKind: 'SUBSTRING', pattern: literal }]);
});

test('Semgrep CE executes both exported matchers against positive and negative samples',
    { skip: !semgrep && 'Set REPOGRAPH_TEST_SEMGREP_BINARY to run the local Semgrep check', timeout: 30_000 }, async t => {
        const directory = await mkdtemp(join(tmpdir(), 'repograph-rule-export-'));
        t.after(() => rm(directory, { recursive: true, force: true }));
        const { SEMGREP_APP_TOKEN: _token, ...env } = process.env;
        env.SEMGREP_SETTINGS_FILE = join(directory, 'settings.yml');
        for (const { kind, pattern, positive, negative } of [
            { kind: 'REGEX', pattern: base.pattern, positive: '// first\n// last',
                negative: '// prefix\n// first\n// last\n// suffix' },
            { kind: 'SUBSTRING', pattern: literal, positive: '// ' + literal,
                negative: "// LABEL(value) #中文\n// 'quoted'" }
        ]) {
            await Promise.all([
                writeFile(join(directory, 'rule.yaml'), toSemgrepYaml({ ...base, matcherKind: kind, pattern })),
                writeFile(join(directory, 'positive.ts'), positive), writeFile(join(directory, 'negative.ts'), negative)
            ]);
            const { stdout } = await exec(semgrep, ['scan', '--config', 'rule.yaml', '--json', '--quiet', '--metrics=off',
                '--disable-version-check', '--oss-only', '--disable-nosem', '--no-git-ignore', '--no-rewrite-rule-ids',
                'positive.ts', 'negative.ts'], { cwd: directory, env, timeout: 10_000 });
            const report = JSON.parse(stdout);
            assert.deepEqual(report.errors, []);
            assert.deepEqual(report.results.map(({ path, check_id }) => [path, check_id]), [['positive.ts', base.ruleId]]);
        }
    });
