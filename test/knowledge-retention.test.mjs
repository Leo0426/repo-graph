import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { RepositoryIndex } from '../dist/index.js';

test('larger incremental publication retains the exact graph and collects only abandoned candidates', { timeout: 25_000 }, async t => {
    const scratch = await realpath(await mkdtemp(join(tmpdir(), 'repograph-retained-')));
    const root = join(scratch, 'inventory');
    const database = join(scratch, 'index.db');
    await mkdir(join(root, 'modules'), { recursive: true });
    const previousRetention = process.env.REPOGRAPH_SNAPSHOT_RETENTION_SECONDS;
    process.env.REPOGRAPH_SNAPSHOT_RETENTION_SECONDS = '0';
    const repo = await RepositoryIndex.open(database, scratch);
    if (previousRetention === undefined) delete process.env.REPOGRAPH_SNAPSHOT_RETENTION_SECONDS;
    else process.env.REPOGRAPH_SNAPSHOT_RETENTION_SECONDS = previousRetention;
    const storage = new DatabaseSync(database, { readOnly: true });
    t.after(async () => {
        storage.close();
        await repo.close();
        await rm(scratch, { recursive: true, force: true });
    });
    await repo.identity.initializeAdmin();
    const admin = repo.identity.account('builtin-admin');
    await writeFile(join(root, 'shared.ts'), 'export function stockLevel() { return 3; }\n');
    for (let group = 0; group < 16; group++) {
        const section = join(root, 'modules', 'batch' + group);
        await mkdir(section);
        await Promise.all(Array.from({ length: 10 }, (_, file) => writeFile(join(section, 'entry' + file + '.ts'),
            `import { stockLevel } from '../../shared.js';\nexport function batch${group}Entry${file}() { return stockLevel(); }\n`)));
    }
    async function until(read, predicate) {
        for (let index = 0; index < 400; index++) {
            const result = await read();
            if (predicate(result)) return result;
            await delay(20);
        }
        assert.fail('Expected a completed fixture operation');
    }
    async function index() {
        await repo.start(root, new Set(['typescript']), true);
        const result = await until(() => repo.status(root), entry => entry.status !== 'running');
        assert.equal(result.status, 'done', JSON.stringify(result.errors));
        return result;
    }
    await index();
    const [{ projectId }] = repo.projects();
    const releases = () => repo.knowledgeSnapshots.list(projectId, 20, 0);
    const publish = async (key, mode) => {
        const run = repo.wiki.submit(projectId, 'Fixture inventory', admin, key, undefined, mode);
        const complete = await until(() => repo.agentRuns.get(run.agentRunId), entry => !['QUEUED', 'RUNNING'].includes(entry.status));
        assert.equal(complete.status, 'COMPLETED', JSON.stringify(complete));
        return releases()[0];
    };
    const base = await publish('complete-release', 'full');
    const baseReceipt = repo.knowledgeSnapshots.receipt(base.id);
    assert.equal(baseReceipt.coverage.files, 161);
    assert.ok(baseReceipt.coverage.relations >= 160);
    assert.deepEqual(new Set(baseReceipt.pages.map(page => page.perspective)), new Set(['technical', 'business']));

    await writeFile(join(root, 'shared.ts'), 'export function stockLevel() { return 4; }\n');
    await rename(join(root, 'modules/batch7/entry2.ts'), join(root, 'modules/batch7/relocated.ts'));
    await rm(join(root, 'modules/batch8/entry3.ts'));
    await writeFile(join(root, 'modules/batch9/new.ts'), 'export const inbound = 7;\n');
    const reindex = await index();
    assert.ok(reindex.skippedFiles > 150);
    assert.equal(releases()[0].id, base.id);
    const target = await publish('incremental-release', 'incremental');
    assert.equal(target.parentSnapshotId, base.id);
    assert.deepEqual(repo.knowledgeSnapshots.changes(target.id, 10, 0).changes, [
        { path: 'modules/batch7/relocated.ts', kind: 'MOVED', previousPath: 'modules/batch7/entry2.ts' },
        { path: 'modules/batch8/entry3.ts', kind: 'DELETED' }, { path: 'modules/batch9/new.ts', kind: 'ADDED' },
        { path: 'shared.ts', kind: 'MODIFIED' }
    ]);
    assert.match(repo.knowledgeSnapshots.source(base.id, 'shared.ts').text, /return 3/);
    assert.match(repo.knowledgeSnapshots.source(target.id, 'shared.ts').text, /return 4/);
    assert.notEqual(repo.knowledgeSnapshots.source(base.id, 'modules/batch8/entry3.ts'), undefined);
    assert.equal(repo.knowledgeSnapshots.source(target.id, 'modules/batch8/entry3.ts'), undefined);
    assert.ok(repo.knowledgeSnapshots.receipt(target.id).coverage.relations >= 159);
    assert.deepEqual(repo.knowledgeSnapshots.receipt(base.id), baseReceipt);

    const temporarySource = join(root, 'candidate-only.ts');
    await writeFile(temporarySource, 'export function candidateOnly() { return 451; }\n');
    await index();
    const pending = repo.wiki.submit(projectId, 'Fixture inventory', admin, 'scheduled-candidate', Date.now() + 60_000);
    const job = repo.wiki.execution(pending.agentRunId);
    const pendingRun = repo.agentRuns.get(pending.agentRunId);
    const pendingSnapshot = pendingRun.inputReference.slice('knowledge-snapshot:'.length);
    const paused = repo.wiki.control(pendingRun, admin, 'pause', job.revision);
    assert.equal(paused.state, 'PAUSED');
    const stranded = repo.agentRuns.create(projectId, 'WIKI_SUMMARY', 'fixture:stranded-candidate');
    const abandoned = repo.knowledgeSnapshots.freeze(projectId, stranded.id, 'incremental');
    repo.agentRuns.fail(stranded, 'FIXTURE_ABANDONED');
    const bytesHash = repo.knowledgeSnapshots.source(pendingSnapshot, 'candidate-only.ts').digest;
    await rm(temporarySource);
    await index();
    const row = id => storage.prepare('SELECT published_at FROM knowledge_snapshot WHERE id = ?').get(id);
    const blob = () => storage.prepare('SELECT 1 AS present FROM knowledge_blob WHERE hash = ?').get(bytesHash);
    assert.equal(row(pendingSnapshot)?.published_at, null);
    assert.equal(row(abandoned.id)?.published_at, null);
    assert.equal(blob()?.present, 1);
    repo.snapshotRetirement.collect();
    assert.equal(row(abandoned.id), undefined);
    assert.equal(row(pendingSnapshot)?.published_at, null);
    assert.equal(blob()?.present, 1);
    assert.equal(releases()[0].id, target.id);
    repo.wiki.control(pendingRun, admin, 'cancel', paused.revision);
    assert.equal(row(pendingSnapshot), undefined);
    assert.equal(blob(), undefined);
    assert.deepEqual(releases().map(item => item.id), [target.id, base.id]);
});
