import { createWriteStream, constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { archiveLimits } from './archive.js';
import type { ArchiveFile, ArchiveLimits } from './archive.js';
import { assetIdPattern } from './assets.js';
import { digest } from './source.js';

const date = z.string().refine(value => Number.isFinite(Date.parse(value)));
export const legacyAssetRow = z.object({
    asset_id: z.string().regex(assetIdPattern), project_id: z.string().regex(/^[a-f0-9]{12}$/),
    original_name: z.string(), archive_type: z.enum(['ZIP', 'TAR_GZ']), project_root: z.string(),
    status: z.enum(['INDEXING', 'READY', 'FAILED']), created_at: date, updated_at: date
});

type AssetRow = z.infer<typeof legacyAssetRow>;
type Entry = { path: string; info: BigIntStats };
export interface LegacyAssetCopy {
    id: string; oldProjectId: string; projectId: string; source: string; projectRoot: string; filename: string;
    archiveType: AssetRow['archive_type']; createdAt: string;
    files: (Entry & ArchiveFile)[]; directories: Entry[];
}

type SkipReason = 'unsafe' | 'unavailable' | 'limits' | 'pendingDeletion';
class OldAssetError extends Error {
    constructor(readonly reason: SkipReason) { super(reason); }
}

function safeSegment(name: string) {
    return !!name && name !== '.' && name !== '..' && !/[\\:\x00-\x1f\x7f]/u.test(name);
}

function projectId(root: string) { return digest(root).slice(0, 12); }

function projectWrapper(root: string, row: AssetRow) {
    const source = join(root, row.asset_id, 'source');
    const rest = relative(source, resolve(row.project_root));
    return !rest || safeSegment(rest) && !rest.includes(sep) ? rest : undefined;
}

async function inspectTree(root: string, limits: ArchiveLimits, wrapperDepth: number) {
    const files: LegacyAssetCopy['files'] = [];
    const directories: Entry[] = [];
    const seen = new Set<string>();
    let size = 0;
    let entries = wrapperDepth;
    async function walk(folder: string, depth: number) {
        const path = folder ? join(root, folder) : root;
        const info = await lstat(path, { bigint: true });
        if (!info.isDirectory() || await realpath(path) !== path) throw new OldAssetError('unsafe');
        directories.push({ path: folder, info });
        for await (const entry of await opendir(path)) {
            if (++entries > limits.entries || depth >= limits.depth) throw new OldAssetError('limits');
            const name = folder ? join(folder, entry.name) : entry.name;
            const collision = name.normalize('NFD').toLowerCase();
            if (!safeSegment(entry.name) || name.length > 4096 || seen.has(collision)) throw new OldAssetError('unsafe');
            seen.add(collision);
            const absolute = join(root, name);
            if (entry.isDirectory()) { await walk(name, depth + 1); continue; }
            const info = await lstat(absolute, { bigint: true });
            if (!info.isFile() || info.nlink !== 1n || await realpath(absolute) !== absolute) throw new OldAssetError('unsafe');
            if (info.size > BigInt(Math.min(limits.file, limits.extracted - size))) throw new OldAssetError('limits');
            const sizeBytes = Number(info.size);
            size += sizeBytes;
            files.push({ path: name.split(sep).join('/'), info, sizeBytes });
        }
    }
    await walk('', wrapperDepth);
    if (!files.length) throw new OldAssetError('unavailable');
    return { files: files.sort((a, b) => a.path.localeCompare(b.path)), directories };
}

export async function planLegacyAssets(rows: AssetRow[], sourceRoot: string, destination: string, deleting: ReadonlySet<string>) {
    const skipped = { unsafe: 0, unavailable: 0, limits: 0, pendingDeletion: 0 };
    const assets: LegacyAssetCopy[] = [];
    if (!rows.length) return { assets, skipped };
    const configured = resolve(sourceRoot);
    let canonical: string | undefined;
    try {
        const root = await realpath(configured);
        if ((await stat(root)).isDirectory()) canonical = root;
    } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
    const limits = archiveLimits();
    for (const row of rows) {
        if (deleting.has(row.project_id)) { skipped.pendingDeletion++; continue; }
        if (!canonical) { skipped.unavailable++; continue; }
        try {
            if (!isAbsolute(row.project_root) || row.project_root.includes('\0')
                || projectId(resolve(row.project_root)) !== row.project_id) throw new OldAssetError('unsafe');
            const wrapper = projectWrapper(configured, row) ?? projectWrapper(canonical, row);
            if (wrapper === undefined) throw new OldAssetError('unsafe');
            const source = join(canonical, row.asset_id, 'source', wrapper);
            const projectRoot = join(destination, row.asset_id, 'source', wrapper);
            const tree = await inspectTree(source, limits, Number(!!wrapper));
            const filename = row.original_name.replace(/[\x00-\x1f\x7f]/g, '_').slice(0, 255).trim() || 'upload';
            assets.push({ id: row.asset_id, source, projectRoot, oldProjectId: row.project_id, projectId: projectId(projectRoot),
                filename, archiveType: row.archive_type, createdAt: row.created_at, ...tree });
        } catch (error) {
            if (error instanceof OldAssetError) skipped[error.reason]++;
            else if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) skipped.unavailable++;
            else throw error;
        }
    }
    return { assets, skipped };
}

function unchanged(expected: BigIntStats, current: BigIntStats) {
    return expected.ino === current.ino && expected.dev === current.dev && expected.size === current.size
        && expected.mtimeNs === current.mtimeNs && expected.ctimeNs === current.ctimeNs;
}

export async function copyLegacyAsset(asset: LegacyAssetCopy) {
    for (const directory of asset.directories) {
        await mkdir(join(asset.projectRoot, directory.path), { recursive: true, mode: 0o700 });
    }
    for (const { path, info, sizeBytes } of asset.files) {
        const source = join(asset.source, path);
        const target = join(asset.projectRoot, path);
        if (await realpath(source) !== source) throw new Error('LEGACY_ASSET_CHANGED');
        const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const before = await handle.stat({ bigint: true });
            if (!before.isFile() || before.nlink !== 1n || !unchanged(info, before)) throw new Error('LEGACY_ASSET_CHANGED');
            const input = sizeBytes === 0 ? Readable.from([]) : handle.createReadStream({ start: 0, end: sizeBytes - 1, autoClose: false });
            await pipeline(input, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
            if (await realpath(source) !== source || !unchanged(before, await lstat(source, { bigint: true }))
                || (await stat(target)).size !== sizeBytes) throw new Error('LEGACY_ASSET_CHANGED');
        } finally { await handle.close(); }
    }
    for (const directory of asset.directories) {
        const path = join(asset.source, directory.path);
        if (await realpath(path) !== path || !unchanged(directory.info, await lstat(path, { bigint: true }))) throw new Error('LEGACY_ASSET_CHANGED');
    }
}
