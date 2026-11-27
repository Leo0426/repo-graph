import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { providerBinding } from './model-providers.js';
import type { ModelProvider } from './model-providers.js';
import { ProviderSecrets } from './provider-secrets.js';

const databaseName = 'index.db';
const benchmarkName = 'benchmark-latest.json';
const manifestName = 'manifest.json';
const assetsName = 'assets';
const keys = [
    { name: databaseName + '-provider-key', suffix: '-provider-key', environment: 'REPOGRAPH_PROVIDER_ENCRYPTION_KEY' },
    { name: databaseName + '-git-key', suffix: '-git-key', environment: 'REPOGRAPH_GIT_ENCRYPTION_KEY' }
] as const;
const readable = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const references = new Set([databaseName, benchmarkName, ...keys.map(key => key.name)]);
const safePath = z.string().min(1).refine(path => path.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\\x00-\x1f]/.test(part)));
const file = z.object({ path: safePath, size: z.int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const format = z.object({ version: z.literal(1), createdAt: z.iso.datetime(), assetRoot: z.string().refine(isAbsolute),
    files: z.array(file), directories: z.array(safePath) }).strict();
type Manifest = z.infer<typeof format>;
type FileEntry = z.infer<typeof file>;

export class RecoveryError extends Error {}

function inside(root: string, path: string) {
    const offset = relative(root, path);
    return offset !== '..' && !offset.startsWith('..' + sep) && !isAbsolute(offset);
}

function missing(error: unknown) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }

async function directory(path: string) {
    const physical = await realpath(resolve(path));
    if (!(await lstat(physical)).isDirectory()) throw new RecoveryError('RECOVERY_DIRECTORY_REQUIRED');
    return physical;
}

async function output<T>(path: string, avoid: readonly string[], work: (target: string) => Promise<T>) {
    const absolute = resolve(path);
    const parent = await directory(dirname(absolute));
    const target = join(parent, basename(absolute));
    if (avoid.some(root => inside(root, target))) throw new RecoveryError('RECOVERY_DESTINATION_IN_SOURCE');
    await mkdir(target, { mode: 0o700 });
    try {
        const result = await work(target);
        await syncDirectory(target);
        await syncDirectory(parent);
        return result;
    } catch (error) {
        await rm(target, { force: true, recursive: true });
        throw error;
    }
}

async function syncDirectory(path: string) {
    const handle = await open(path, readable | constants.O_DIRECTORY);
    try { await handle.sync(); }
    finally { await handle.close(); }
}

async function syncFile(path: string) {
    const handle = await open(path, readable);
    try { await handle.sync(); }
    finally { await handle.close(); }
}

async function readBounded(path: string, limit: number) {
    const handle = await open(path, readable);
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > limit) throw new RecoveryError('RECOVERY_INVALID_METADATA');
        return await handle.readFile('utf8');
    } finally { await handle.close(); }
}

async function transfer(source: string, target?: string) {
    const input = await open(source, readable);
    try {
        const before = await input.stat({ bigint: true });
        if (!before.isFile()) throw new RecoveryError('RECOVERY_NONREGULAR_FILE');
        const sum = createHash('sha256');
        let size = 0;
        const reader = input.createReadStream({ autoClose: false });
        if (target) {
            const measured = new Transform({ transform(chunk: Buffer, _encoding, callback) {
                sum.update(chunk);
                size += chunk.byteLength;
                callback(null, chunk);
            } });
            await pipeline(reader, measured, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
            await syncFile(target);
        } else {
            for await (const chunk of reader) {
                sum.update(chunk);
                size += chunk.byteLength;
            }
        }
        const after = await input.stat({ bigint: true });
        if (BigInt(size) !== before.size || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
            throw new RecoveryError('RECOVERY_INPUT_CHANGED');
        }
        return { size, sha256: sum.digest('hex') };
    } finally { await input.close(); }
}

function checkFile(expected: FileEntry, actual: Omit<FileEntry, 'path'>) {
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) throw new RecoveryError('RECOVERY_CHECKSUM_MISMATCH');
}

async function captureAssets(source: string, target: string, manifest: Manifest, excluded: ReadonlySet<string>, path = assetsName) {
    await mkdir(join(target, path), { mode: 0o700 });
    manifest.directories.push(path);
    const entries = await readdir(source, { withFileTypes: true });
    entries.sort((first, second) => first.name.localeCompare(second.name));
    for (const entry of entries) {
        const original = join(source, entry.name);
        if (excluded.has(original)) continue;
        if (path.startsWith(assetsName + '/.git-sources/') && /^\.fetch-[a-f0-9-]{36}-[a-zA-Z0-9]{6}$/.test(entry.name)) continue;
        const key = path + '/' + entry.name;
        if (!safePath.safeParse(key).success) throw new RecoveryError('RECOVERY_INVALID_ASSET_PATH');
        if (entry.isDirectory()) await captureAssets(original, target, manifest, excluded, key);
        else if (entry.isFile()) manifest.files.push({ path: key, ...await transfer(original, join(target, key)) });
        else throw new RecoveryError('RECOVERY_NONREGULAR_FILE');
    }
    await syncDirectory(join(target, path));
}

function rows(db: DatabaseSync, table: string, sql: string) {
    return db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table) ? db.prepare(sql).all() : [];
}

function databaseChecks(db: DatabaseSync) {
    if (db.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok') || db.prepare('PRAGMA foreign_key_check').get()
        || !db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'project'").get()) {
        throw new RecoveryError('RECOVERY_DATABASE_INVALID');
    }
}

function managedPath(root: string, path: string) {
    if (!isAbsolute(path) || !inside(root, path) || root === path) throw new RecoveryError('RECOVERY_ASSET_OUTSIDE_SOURCE');
    const result = assetsName + '/' + relative(root, path).split(sep).join('/');
    if (!safePath.safeParse(result).success) throw new RecoveryError('RECOVERY_INVALID_ASSET_PATH');
    return result;
}

function referencedFiles(db: DatabaseSync, manifest: Manifest) {
    const files = new Map(manifest.files.map(item => [item.path, item]));
    const dirs = new Set(manifest.directories);
    const requireDirectory = (path: string) => {
        if (!dirs.has(path)) throw new RecoveryError('RECOVERY_REFERENCED_ASSET_MISSING');
    };
    const archived = rows(db, 'managed_asset', `SELECT a.source_root, p.root FROM managed_asset a
        JOIN project p ON a.project_id = p.id WHERE a.deleting = 0`);
    for (const row of archived) {
        requireDirectory(managedPath(manifest.assetRoot, String(row.source_root)));
        requireDirectory(managedPath(manifest.assetRoot, String(row.root)));
    }
    const worktrees = rows(db, 'git_repository', 'SELECT id, indexed_commit FROM git_repository WHERE indexed_commit IS NOT NULL');
    for (const row of worktrees) requireDirectory(assetsName + '/.git-sources/' + row.id + '/' + row.indexed_commit + '/tree');
    const objects = rows(db, 'archive_object', `SELECT DISTINCT o.sha256, o.size_bytes FROM archive_object o
        WHERE EXISTS (SELECT 1 FROM managed_asset_source s WHERE s.object_id = o.id)
            OR EXISTS (SELECT 1 FROM knowledge_archive_source s WHERE s.object_id = o.id)`);
    for (const row of objects) {
        const entry = files.get(assetsName + '/.archive-objects/' + row.sha256);
        if (entry?.sha256 !== row.sha256 || entry?.size !== row.size_bytes) throw new RecoveryError('RECOVERY_ARCHIVE_OBJECT_INVALID');
    }
}

async function verifyKeys(db: DatabaseSync, root: string, manifest: Manifest) {
    const providers = rows(db, 'model_provider', "SELECT payload AS config, encrypted_key AS credential FROM model_provider WHERE encrypted_key <> ''");
    for (const [table, path] of [['durable_job', '$.model'], ['ask_job', '$.provider']]) {
        providers.push(...rows(db, table, `SELECT json_extract(input, '${path}.config') AS config,
            json_extract(input, '${path}.encryptedKey') AS credential FROM ${table}
            WHERE json_extract(input, '${path}.encryptedKey') <> ''`));
    }
    const git = rows(db, 'git_connection', "SELECT id, url, credential FROM git_connection WHERE credential <> ''");
    const events = rows(db, 'git_event_secret', 'SELECT c.id, c.url, e.encrypted FROM git_event_secret e JOIN git_connection c ON c.id = e.connection_id');
    const load = async (name: string) => {
        if (!manifest.files.some(entry => entry.path === name)) throw new RecoveryError('RECOVERY_ENCRYPTION_KEY_MISMATCH');
        return new ProviderSecrets(null, await readBounded(join(root, name), 128), true);
    };
    try {
        if (providers.length) {
            const vault = await load(keys[0].name);
            for (const row of providers) vault.decrypt(providerBinding(JSON.parse(String(row.config)) as ModelProvider), String(row.credential));
        }
        if (git.length || events.length) {
            const vault = await load(keys[1].name);
            for (const row of git) vault.decrypt(JSON.stringify([row.id, row.url]), String(row.credential));
            for (const row of events) vault.decrypt(JSON.stringify([row.id, row.url, 'event']), String(row.encrypted));
        }
    } catch { throw new RecoveryError('RECOVERY_ENCRYPTION_KEY_MISMATCH'); }
}

async function verifyDatabase(path: string, root: string, manifest: Manifest) {
    for (const suffix of ['-wal', '-shm', '-journal']) {
        try {
            await lstat(path + suffix);
            throw new RecoveryError('RECOVERY_DATABASE_SIDECAR_FOUND');
        } catch (error) { if (!missing(error)) throw error; }
    }
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        databaseChecks(db);
        referencedFiles(db, manifest);
        await verifyKeys(db, root, manifest);
    } finally { db.close(); }
}

async function captureKeys(source: string, target: string, env: NodeJS.ProcessEnv, manifest: Manifest) {
    for (const key of keys) {
        let value = env[key.environment];
        if (value === undefined) {
            try { value = await readBounded(source + key.suffix, 128); }
            catch (error) { if (!missing(error)) throw error; }
        }
        if (value === undefined) continue;
        try { new ProviderSecrets(null, value, true); }
        catch { throw new RecoveryError('RECOVERY_ENCRYPTION_KEY_MISMATCH'); }
        const path = join(target, key.name);
        await writeFile(path, value.trim(), { flag: 'wx', mode: 0o600 });
        await syncFile(path);
        manifest.files.push({ path: key.name, ...await transfer(path) });
    }
}

export async function createBackup(paths: { database: string; assets: string; benchmark: string; projectsRoot?: string },
    destination: string, env: NodeJS.ProcessEnv = process.env) {
    const source = await realpath(resolve(paths.database));
    if (!(await lstat(source)).isFile()) throw new RecoveryError('RECOVERY_DATABASE_INVALID');
    const assets = await directory(paths.assets);
    const excluded = new Set(['', '-wal', '-shm', '-journal', ...keys.map(key => key.suffix)].map(suffix => source + suffix));
    const protectedRoots = [assets];
    if (paths.projectsRoot) protectedRoots.push(await directory(paths.projectsRoot));
    return await output(destination, protectedRoots, async target => {
        const db = new DatabaseSync(source, { timeout: 0 });
        try {
            db.exec('PRAGMA locking_mode=EXCLUSIVE');
            // A WAL connection holds this lock until close, including while managed files are copied.
            db.prepare('SELECT count(*) FROM sqlite_schema').get();
            databaseChecks(db);
            const captured = join(target, databaseName);
            await backup(db, captured);
            const portable = new DatabaseSync(captured);
            try { portable.exec('PRAGMA journal_mode=DELETE'); }
            finally { portable.close(); }
            await chmod(captured, 0o600);
            await syncFile(captured);
            const manifest: Manifest = { version: 1, assetRoot: assets, createdAt: new Date().toISOString(),
                files: [{ path: databaseName, ...await transfer(captured) }], directories: [] };
            await captureAssets(assets, target, manifest, excluded);
            await captureKeys(source, target, env, manifest);
            try {
                manifest.files.push({ path: benchmarkName, ...await transfer(resolve(paths.benchmark), join(target, benchmarkName)) });
            } catch (error) { if (!missing(error)) throw error; }
            await verifyDatabase(captured, target, manifest);
            await writeFile(join(target, manifestName), JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
            await syncFile(join(target, manifestName));
            return { version: manifest.version, files: manifest.files.length, createdAt: manifest.createdAt };
        } catch (error) {
            if ([5, 6].includes((error as { errcode?: number }).errcode ?? -1)) throw new RecoveryError('RECOVERY_DATABASE_IN_USE');
            throw error;
        } finally { db.close(); }
    });
}

async function loadManifest(root: string) {
    let manifest: Manifest;
    try { manifest = format.parse(JSON.parse(await readBounded(join(root, manifestName), 128 * 1024 * 1024))); }
    catch { throw new RecoveryError('RECOVERY_MANIFEST_INVALID'); }
    const files = new Set(manifest.files.map(item => item.path));
    const directories = new Set(manifest.directories);
    const hasParent = (path: string) => directories.has(path.slice(0, path.lastIndexOf('/')));
    if (!files.has(databaseName) || !directories.has(assetsName) || files.size !== manifest.files.length
        || directories.size !== manifest.directories.length
        || manifest.directories.some(path => path !== assetsName && (!path.startsWith(assetsName + '/') || !hasParent(path)))
        || manifest.files.some(({ path }) => directories.has(path) || (!references.has(path) && (!path.startsWith(assetsName + '/') || !hasParent(path))))) {
        throw new RecoveryError('RECOVERY_MANIFEST_INVALID');
    }
    manifest.directories.sort((left, right) => left.length - right.length || left.localeCompare(right));
    for (const path of manifest.directories) {
        if (!(await lstat(join(root, path))).isDirectory()) throw new RecoveryError('RECOVERY_MANIFEST_INVALID');
    }
    return manifest;
}

export async function verifyBackup(source: string) {
    const root = await directory(source);
    const manifest = await loadManifest(root);
    for (const entry of manifest.files) checkFile(entry, await transfer(join(root, entry.path)));
    await verifyDatabase(join(root, databaseName), root, manifest);
    return { version: manifest.version, files: manifest.files.length, createdAt: manifest.createdAt };
}

function relocateDatabase(path: string, target: string, manifest: Manifest) {
    const db = new DatabaseSync(path);
    try {
        db.exec('BEGIN IMMEDIATE');
        const updateProject = db.prepare('UPDATE project SET root = ? WHERE id = ?');
        const managed = rows(db, 'managed_asset', 'SELECT id, source_root, project_id FROM managed_asset WHERE source_root IS NOT NULL');
        if (managed.length) {
            const updateAsset = db.prepare('UPDATE managed_asset SET source_root = ? WHERE id = ?');
            const project = db.prepare('SELECT root FROM project WHERE id = ?');
            for (const row of managed) {
                const source = join(target, managedPath(manifest.assetRoot, String(row.source_root)));
                updateAsset.run(source, row.id);
                const prior = project.get(row.project_id!);
                if (prior) updateProject.run(join(target, managedPath(manifest.assetRoot, String(prior.root))), row.project_id);
            }
        }
        for (const row of rows(db, 'git_repository', 'SELECT id, project_id FROM git_repository')) {
            const binding = String(row.id);
            if (!/^[a-f0-9-]{36}$/.test(binding)) throw new RecoveryError('RECOVERY_INVALID_ASSET_PATH');
            updateProject.run(join(target, assetsName, '.git-sources', binding), row.project_id);
        }
        databaseChecks(db);
        db.exec('COMMIT');
    } finally { db.close(); }
}

export async function restoreBackup(source: string, destination: string) {
    const root = await directory(source);
    const manifest = await loadManifest(root);
    return await output(destination, [root], async target => {
        const database = join(target, databaseName);
        const candidate = database + '.pending';
        for (const path of manifest.directories) await mkdir(join(target, path), { mode: 0o700 });
        for (const entry of manifest.files) {
            const path = entry.path === databaseName ? candidate : join(target, entry.path);
            checkFile(entry, await transfer(join(root, entry.path), path));
        }
        await verifyDatabase(candidate, target, manifest);
        relocateDatabase(candidate, target, manifest);
        await syncFile(candidate);
        for (const path of manifest.directories.reverse()) await syncDirectory(join(target, path));
        await syncDirectory(target);
        await rename(candidate, database);
        return { version: manifest.version, files: manifest.files.length, database, assets: join(target, assetsName) };
    });
}
