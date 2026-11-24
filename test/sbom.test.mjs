import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('exports an authorized CycloneDX inventory and records bounded offline Maven advisory matches', { timeout: 20_000 }, async t => {
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'repograph-sbom-')));
    t.after(() => rm(tmp, { recursive: true, force: true }));
    const root = join(tmp, 'warehouse');
    await Promise.all(['gradle', 'modules/web', 'modules/api/jobs', 'modules/api/foreign', 'apps/tasks', 'ignored',
        'npm-packages/client', 'npm-packages/utils', 'npm-packages/ignored', 'tools/nested/runner']
        .map(path => mkdir(join(root, path), { recursive: true })));
    const sibling = join(tmp, 'sibling');
    await mkdir(sibling);
    await writeFile(join(sibling, 'build.gradle.kts'), 'dependencies { implementation("example.gradle:sibling-test-marker:1.0.0") }');
    await writeFile(join(sibling, 'pom.xml'), `<project><dependencies><dependency><groupId>example.libs</groupId>
        <artifactId>sibling-test-marker</artifactId><version>1.0.0</version></dependency></dependencies></project>`);
    await writeFile(join(sibling, 'package.json'), JSON.stringify({ name: 'sibling', dependencies: { 'sibling-test-marker': '1.0.0' } }));
    await symlink(sibling, join(root, 'linked'), 'dir');
    const files = {
        'main.ts': 'export const inventory = 1;',
        'pom.xml': `<project xmlns="http://maven.apache.org/POM/4.0.0">
            <groupId>example.warehouse</groupId><artifactId>warehouse</artifactId><version>1.2.0</version>
            <packaging>pom</packaging><modules><module>modules/api</module><module>linked</module>
                <module>modules/missing</module><module>../sibling</module></modules>
            <properties><widget.version>2.1.0</widget.version></properties>
            <dependencyManagement><dependencies><dependency><groupId>example.libs</groupId>
                <artifactId>widget</artifactId><version>${'\${widget.version}'}</version>
            </dependency><dependency><groupId>example.libs</groupId>
                <artifactId>unused</artifactId><version>1.0.0</version>
            </dependency></dependencies></dependencyManagement>
            <dependencies><dependency><groupId>example.libs</groupId><artifactId>widget</artifactId>
            </dependency><dependency><groupId>example.libs</groupId><artifactId>optional</artifactId>
                <version>[1.0,2.0)</version><scope>provided</scope>
            </dependency></dependencies></project>`,
        'modules/api/pom.xml': `<project>
            <parent><groupId>example.warehouse</groupId><artifactId>warehouse</artifactId>
                <version>1.2.0</version><relativePath>../../pom.xml</relativePath></parent>
            <artifactId>warehouse-api</artifactId>
            <modules><module>jobs/pom.xml</module><module>foreign</module></modules>
            <properties><widget.version>2.6.0</widget.version></properties>
            <dependencies><dependency><groupId>example.libs</groupId><artifactId>widget</artifactId></dependency></dependencies>
        </project>`,
        'modules/api/jobs/pom.xml': `<project>
            <parent><groupId>example.warehouse</groupId><artifactId>warehouse-api</artifactId><version>1.2.0</version></parent>
            <artifactId>warehouse-jobs</artifactId>
            <properties><widget.version>2.8.0</widget.version></properties>
        </project>`,
        'modules/api/foreign/pom.xml': `<project>
            <parent><groupId>example.warehouse</groupId><artifactId>different-parent</artifactId><version>1.2.0</version></parent>
            <artifactId>warehouse-foreign</artifactId>
            <dependencies><dependency><groupId>example.libs</groupId><artifactId>widget</artifactId></dependency></dependencies>
        </project>`,
        'gradle/libs.versions.toml': [
            '[versions]', 'toolkit = "3.0.0"', '[libraries]',
            'ui-kit = { module = "example.gradle:ui-kit", version.ref = "toolkit" }',
            'task-kit = { module = "example.gradle:task-kit", version.ref = "toolkit" }'
        ].join('\n'),
        'build.gradle.kts': 'dependencies {\n    testImplementation(libs.ui.kit)\n    implementation("example.gradle:service:4.2.0")\n}\n',
        'gradle.lockfile': 'example.gradle:transitive:1.9.0=runtimeClasspath\nempty=testFixtures\n',
        'settings.gradle.kts': [
            'rootProject.name = "warehouse"', '// include(":ignored")',
            'include(', '    ":modules:web", ":tasks", ":linked", ":outside"', ')',
            'project(":tasks").projectDir = file("apps/tasks")',
            'project(":outside").projectDir = file("../sibling")'
        ].join('\n'),
        'modules/web/build.gradle.kts': 'dependencies { implementation("example.gradle:web-runtime:1.0.0") }',
        'apps/tasks/build.gradle': 'dependencies { implementation "example.gradle:task-runtime:1.0.0"; implementation libs.task.kit }',
        'ignored/build.gradle.kts': 'dependencies { implementation("example.gradle:undeclared:1.0.0") }',
        'package.json': JSON.stringify({
            name: 'warehouse-web', workspaces: ['npm-packages/*', 'tools/**/runner', '!npm-packages/ignored', 'linked', '../sibling'],
            dependencies: { '@example/view': '^2.0.0', palettes: '~1.2.0', 'local-utils': 'file:npm-packages/utils' }
        }),
        'npm-packages/client/package.json': JSON.stringify({ name: 'warehouse-client', dependencies: { 'terminal-tools': '^3.0.0' } }),
        'npm-packages/utils/package.json': JSON.stringify({ name: 'local-utils', version: '1.0.0' }),
        'npm-packages/ignored/package.json': '{ invalid member data',
        'tools/nested/runner/package.json': JSON.stringify({ name: 'warehouse-runner', dependencies: { 'workspace-runner': '^4.0.0' } }),
        'package-lock.json': JSON.stringify({
            lockfileVersion: 3, packages: {
                '': { name: 'warehouse-web', dependencies: { '@example/view': '^2.0.0' } },
                'node_modules/@example/view': { version: '2.4.0' },
                'node_modules/@example/view/node_modules/labels': { version: '1.1.0' },
                'node_modules/terminal-tools': { version: '1.4.0' },
                'node_modules/local-utils': { resolved: 'npm-packages/utils', link: true },
                'npm-packages/utils': { name: 'local-utils', version: '1.0.0' },
                'npm-packages/client': { name: 'warehouse-client', dependencies: { 'terminal-tools': '^3.0.0' } },
                'npm-packages/client/node_modules/terminal-tools': { version: '3.2.0' }
            }
        }),
        'pyproject.toml': `[project]
name = "warehouse_jobs"
dependencies = [
  "Acme_Metrics==3.2.0; python_version >= '3.10'",
  "scheduler>=1,<3",
]
[project.optional-dependencies]
reports = ["reports==4.1.0"]
`,
        'requirements-dev.txt': 'test_helpers==0.9.0 # shared helpers\n'
    };
    await Promise.all(Object.entries(files).map(([path, body]) => writeFile(join(root, path), body)));
    const token = randomBytes(32).toString('hex');
    const child = spawn(process.execPath, ['dist/server.js'], {
        env: {
            ...process.env, REPOGRAPH_ACCESS_TOKEN: token, REPOGRAPH_ADMIN_PASSWORD: undefined,
            REPOGRAPH_PROJECTS_ROOT: tmp, REPOGRAPH_ASSETS_ROOT: join(tmp, 'assets'),
            REPOGRAPH_DB_PATH: join(tmp, 'index.db'), REPOGRAPH_EMBEDDING_MODEL: undefined, REPOGRAPH_PORT: '0'
        }, stdio: ['ignore', 'ignore', 'pipe']
    });
    t.after(async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
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
    const api = (path, init) => fetch(`${base}/api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await api(`/index/project?projectRoot=${encodeURIComponent(root)}`, { method: 'POST' })).status, 202);
    const [project] = await (await api('/projects')).json();
    const endpoint = `/sbom/${project.projectId}`;
    assert.equal((await fetch(`${base}/api/v1${endpoint}`)).status, 401);
    const response = await api(endpoint);
    assert.equal(response.status, 200);
    const bom = await response.json();
    assert.equal(bom.specVersion, '1.4');
    assert.equal(bom.metadata.component.name, 'warehouse');
    const components = new Map(bom.components.map(component => [component.purl, component]));
    assert.deepEqual(components.get('pkg:maven/example.gradle/web-runtime@1.0.0')?.properties,
        [{ name: 'repograph:manifest', value: 'modules/web/build.gradle.kts' }]);
    assert.deepEqual(components.get('pkg:maven/example.gradle/task-runtime@1.0.0')?.properties,
        [{ name: 'repograph:manifest', value: 'apps/tasks/build.gradle' }]);
    assert.deepEqual(components.get('pkg:maven/example.gradle/task-kit@3.0.0')?.properties, [
        { name: 'repograph:manifest', value: 'gradle/libs.versions.toml' },
        { name: 'repograph:manifest', value: 'apps/tasks/build.gradle' }
    ]);
    assert.deepEqual(components.get('pkg:maven/example.libs/widget@2.6.0')?.properties, [
        { name: 'repograph:manifest', value: 'modules/api/pom.xml' },
        { name: 'repograph:manifest', value: 'pom.xml' }
    ]);
    assert.deepEqual(components.get('pkg:maven/example.libs/widget@2.8.0')?.properties, [
        { name: 'repograph:manifest', value: 'modules/api/pom.xml' },
        { name: 'repograph:manifest', value: 'modules/api/jobs/pom.xml' },
        { name: 'repograph:manifest', value: 'pom.xml' }
    ]);
    assert.ok(components.has('pkg:maven/example.libs/widget'));
    assert.equal(components.get('pkg:maven/example.libs/widget').version, undefined);
    assert.deepEqual(components.get('pkg:npm/terminal-tools@3.2.0')?.properties, [
        { name: 'repograph:manifest', value: 'package-lock.json' },
        { name: 'repograph:manifest', value: 'npm-packages/client/package.json' }
    ]);
    assert.deepEqual(components.get('pkg:npm/terminal-tools@1.4.0')?.properties,
        [{ name: 'repograph:manifest', value: 'package-lock.json' }]);
    assert.deepEqual(components.get('pkg:npm/workspace-runner')?.properties, [
        { name: 'repograph:manifest', value: 'tools/nested/runner/package.json' },
        { name: 'repograph:versionConstraint', value: '^4.0.0' }
    ]);
    assert.ok(!bom.metadata.properties.some(property => property.value === 'npm-packages/ignored/package.json: PARSE_FAILED'));
    assert.equal(components.size, 21, [...components.keys()].join('\n'));
    assert.ok(bom.metadata.properties.some(property => property.value === 'linked/build.gradle.kts: READ_FAILED'));
    assert.ok(bom.metadata.properties.some(property => property.value === 'gradle: UNRESOLVED_SUBPROJECT'));
    for (const issue of ['linked/pom.xml: READ_FAILED', 'modules/missing/pom.xml: MODULE_UNAVAILABLE', 'pom.xml: MODULE_PATH_UNRESOLVED',
        'modules/api/foreign/pom.xml: PARENT_UNRESOLVED', 'linked/package.json: READ_FAILED', 'npm: UNSUPPORTED_WORKSPACE_PATTERN']) {
        assert.ok(bom.metadata.properties.some(property => property.value === issue), issue);
    }
    assert.ok(components.has('pkg:maven/example.libs/widget@2.1.0'));
    assert.equal(components.get('pkg:maven/example.libs/optional')?.scope, 'optional');
    assert.equal(components.get('pkg:maven/example.gradle/ui-kit@3.0.0')?.scope, 'excluded');
    assert.ok(components.has('pkg:maven/example.gradle/service@4.2.0'));
    assert.ok(components.has('pkg:maven/example.gradle/transitive@1.9.0'));
    assert.ok(components.has('pkg:npm/%40example/view@2.4.0'));
    assert.ok(components.has('pkg:npm/labels@1.1.0'));
    assert.equal(components.get('pkg:npm/palettes')?.version, undefined);
    assert.equal(components.get('pkg:npm/palettes')?.properties.find(p => p.name === 'repograph:versionConstraint')?.value, '~1.2.0');
    assert.ok(components.has('pkg:pypi/acme-metrics@3.2.0'));
    assert.equal(components.get('pkg:pypi/scheduler')?.version, undefined);
    assert.equal(components.get('pkg:pypi/reports@4.1.0')?.scope, 'optional');
    assert.equal(components.get('pkg:pypi/test-helpers@0.9.0')?.scope, 'excluded');
    assert.equal((await api(`${endpoint}?projectRoot=${encodeURIComponent(tmp)}`)).status, 400);
    assert.equal((await api(`${endpoint}?format=unsupported`)).status, 400);
    await writeFile(join(root, 'package-lock.json'), '{');
    const partial = await (await api(endpoint)).json();
    assert.ok(partial.metadata.properties.some(property => property.value === 'package-lock.json: PARSE_FAILED'));
    assert.ok(partial.components.some(component => component.purl === 'pkg:npm/%40example/view'));
    assert.ok(!partial.components.some(component => component.name === 'local-utils'));
    assert.ok(partial.components.some(component => component.purl === 'pkg:npm/terminal-tools'
        && component.properties.some(property => property.value === 'npm-packages/client/package.json')));
    assert.ok(partial.components.some(component => component.purl === 'pkg:maven/example.libs/widget@2.1.0'));

    await writeFile(join(root, 'pom.xml'), `<project><dependencies>
        <dependency><groupId>org.apache.logging.log4j</groupId><artifactId>log4j-core</artifactId><version>2.15.0</version></dependency>
        <dependency><groupId>org.apache.logging.log4j</groupId><artifactId>log4j-core</artifactId><version>2.14.0</version><scope>test</scope></dependency>
        <dependency><groupId>com.google.guava</groupId><artifactId>guava</artifactId><version>[31.0,33.0)</version></dependency>
    </dependencies></project>`);
    const check = '/vulns/scan/deps?' + new URLSearchParams({ projectId: project.projectId });
    assert.equal((await fetch(base + '/api/v1' + check, { method: 'POST' })).status, 401);
    assert.equal((await api(check + '&projectRoot=' + encodeURIComponent(tmp), { method: 'POST' })).status, 400);
    const checked = await api(check, { method: 'POST' });
    assert.equal(checked.status, 200);
    const checkResult = await checked.json();
    assert.equal(checkResult.newFindings, 3);
    assert.equal(checkResult.matchedFindings, 3);
    assert.equal(checkResult.unverifiedComponents, 1);
    assert.ok(checkResult.issues.includes('package-lock.json: PARSE_FAILED'));

    const inventory = '/vulns?' + new URLSearchParams({ projectId: project.projectId });
    const records = await (await api(inventory)).json();
    assert.deepEqual(records.map(record => record.dependency.advisoryId).sort(),
        ['CVE-2021-44832', 'CVE-2021-45046', 'CVE-2021-45105']);
    for (const record of records) {
        assert.equal(record.status, 'SUSPECTED');
        assert.equal(record.ruleId, 'DEP_VULNERABILITY');
        assert.equal(record.dependency.version, '2.15.0');
        assert.deepEqual(record.dependency.manifests, ['pom.xml']);
        const legacyUnit = 'dep:org.apache.logging.log4j:log4j-core:2.15.0:' + record.dependency.advisoryId;
        assert.equal(record.id, createHash('sha256').update(project.projectId + ':DEP_VULNERABILITY:' + legacyUnit).digest('hex').slice(0, 16));
    }
    const detail = '/vulns/' + records[0].id + '?' + new URLSearchParams({ projectId: project.projectId });
    assert.equal((await api(detail.replace('?', '/status?') + '&status=DISMISSED', { method: 'PUT' })).status, 200);
    const repeat = await (await api(check, { method: 'POST' })).json();
    assert.equal(repeat.newFindings, 0);
    assert.equal((await (await api(detail)).json()).finding.status, 'DISMISSED');

    await writeFile(join(root, 'pom.xml'), '<project/>');
    await writeFile(join(root, 'build.gradle.kts'), 'dependencies { implementation("org.apache.logging.log4j:log4j-core:2.14.0") }');
    await writeFile(join(root, 'gradle/libs.versions.toml'),
        '[libraries]\nunused = { module = "com.google.guava:guava", version = "31.0-jre" }\n');
    const lockfile = join(root, 'gradle.lockfile');
    const coordinate = 'org.apache.logging.log4j:log4j-core:';
    await writeFile(lockfile, coordinate + '2.17.1=runtimeClasspath\n');
    assert.equal((await (await api(check, { method: 'POST' })).json()).matchedFindings, 0);
    await writeFile(lockfile, coordinate + '2.0-beta8=runtimeClasspath\n');
    const directlyChecked = await (await api(check, { method: 'POST' })).json();
    assert.deepEqual(directlyChecked.preview.map(item => item.advisoryId).sort(), ['CVE-2021-44832', 'CVE-2021-45105']);
    const mcp = new Client({ name: 'advisory-migration-test', version: '1.0.0' });
    try {
        await mcp.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/mcp.js'], stderr: 'pipe',
            env: { REPOGRAPH_BASE_URL: base, REPOGRAPH_ACCESS_TOKEN: token } }));
        const checked = await mcp.callTool({ name: 'scan_dependency_advisories', arguments: { projectId: project.projectId } });
        assert.equal(checked.isError, false);
        const report = JSON.parse(checked.content[0].text);
        assert.equal(report.matchedFindings, 2);
        assert.equal(report.newFindings, 0);
        assert.deepEqual(report.preview, directlyChecked.preview);
    } finally { await mcp.close(); }

    const childScript = 'modules/web/build.gradle.kts';
    const childLockfile = 'modules/web/gradle.lockfile';
    await writeFile(lockfile, coordinate + '2.17.1=runtimeClasspath\n');
    await writeFile(join(root, childScript), 'dependencies { implementation("' + coordinate + '2.14.0") }');
    const childChecks = await (await api(check, { method: 'POST' })).json();
    async function assertManifests(preview, source) {
        await Promise.all(preview.map(async ({ id }) => {
            const detail = await (await api(`/vulns/${id}?projectId=${project.projectId}`)).json();
            assert.deepEqual(detail.finding.dependency.manifests, [source]);
        }));
    }
    assert.equal(childChecks.matchedFindings, 4);
    await assertManifests(childChecks.preview, childScript);
    await writeFile(join(root, childLockfile), coordinate + '2.17.1=runtimeClasspath\n');
    assert.equal((await (await api(check, { method: 'POST' })).json()).matchedFindings, 0);
    await writeFile(lockfile, coordinate + '2.16.0=runtimeClasspath\n');
    await writeFile(join(root, childScript), 'dependencies { implementation("' + coordinate + '2.16.0") }');
    const rootChecks = await (await api(check, { method: 'POST' })).json();
    assert.equal(rootChecks.matchedFindings, 2);
    await assertManifests(rootChecks.preview, 'gradle.lockfile');

    await writeFile(lockfile, coordinate + '2.17.1=runtimeClasspath\n');
    await writeFile(join(root, 'pom.xml'), `<project>
        <groupId>example.warehouse</groupId><artifactId>warehouse</artifactId><version>1.2.0</version>
        <packaging>pom</packaging><modules><module>modules/api</module></modules>
        <dependencyManagement><dependencies><dependency><groupId>org.apache.logging.log4j</groupId>
            <artifactId>log4j-core</artifactId><version>2.12.0</version>
        </dependency></dependencies></dependencyManagement>
    </project>`);
    const childPom = 'modules/api/pom.xml';
    await writeFile(join(root, childPom), `<project>
        <parent><groupId>example.warehouse</groupId><artifactId>warehouse</artifactId>
            <version>1.2.0</version><relativePath>../../pom.xml</relativePath></parent>
        <artifactId>warehouse-api</artifactId>
        <dependencies><dependency><groupId>org.apache.logging.log4j</groupId><artifactId>log4j-core</artifactId></dependency></dependencies>
    </project>`);
    const mavenChecks = await (await api(check, { method: 'POST' })).json();
    assert.equal(mavenChecks.newFindings, 4);
    assert.equal(mavenChecks.matchedFindings, 4);
    assert.ok(mavenChecks.preview.every(finding => finding.version === '2.12.0'));
    await assertManifests(mavenChecks.preview, childPom);
});
