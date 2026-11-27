import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { ArchiveFile } from './archive.js';
import { HttpError } from './http-error.js';
import { readProjectFile, relativeEvidencePath } from './project-file.js';
import { digest } from './source.js';

const fileLimit = 64 * 1024 * 1024;
const stageLimit = 512 * 1024 * 1024;
const defaultProfiles: Record<string, string[]> = { SEMGREP: ['REPOGRAPH_SEMGREP_BINARY', 'REPOGRAPH_SEMGREP_RULES'],
    CODEQL: ['REPOGRAPH_CODEQL_BINARY'], SLITHER: ['REPOGRAPH_SLITHER_BINARY', 'REPOGRAPH_SOLC_BINARY'] };

export async function scannerProfiles(scanners: readonly string[]) {
    const keys = [...new Set(scanners.flatMap(scanner => defaultProfiles[scanner] ?? []))].sort();
    const proofs = await Promise.all(keys.map(async key => {
        const configured = process.env[key]?.trim() ?? '';
        if (!configured || !isAbsolute(configured)) return [key, configured];
        try {
            const path = await realpath(configured);
            const info = await lstat(path, { bigint: true });
            if (!info.isFile()) return [key, path, 'UNAVAILABLE'];
            const rules = key.endsWith('_RULES') ? digest(await readProjectFile(path, 16 * 1024 * 1024)) : null;
            return [key, path, String(info.size), String(info.mtimeNs), String(info.ino), rules];
        } catch { return [key, configured, 'UNAVAILABLE']; }
    }));
    return digest(JSON.stringify([process.env.PATH ?? '', proofs]));
}

export async function scanManifest(root: string, files: ArchiveFile[], signal?: AbortSignal) {
    if (files.length > 50_000 || files.reduce((sum, item) => sum + item.sizeBytes, 0) > stageLimit || files.some(file => file.sizeBytes > fileLimit)) {
        throw new HttpError(413, 'SCAN_SOURCE_TOO_LARGE');
    }
    const frozen: (ArchiveFile & { sha256: string })[] = [];
    const paths = new Set<string>();
    for (const file of files) {
        signal?.throwIfAborted();
        if (!file.path || relativeEvidencePath(file.path) !== file.path || paths.has(file.path)) throw new HttpError(409, 'SCAN_SOURCE_MANIFEST_INVALID');
        paths.add(file.path);
        const sha256 = file.sha256 ?? digest(await readProjectFile(join(root, file.path), file.sizeBytes));
        if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(409, 'SCAN_SOURCE_MANIFEST_INVALID');
        frozen.push({ path: file.path, sizeBytes: file.sizeBytes, sha256 });
    }
    return frozen.sort((a, b) => a.path < b.path ? -1 : 1);
}

export async function stageScan(root: string, source: string, files: Awaited<ReturnType<typeof scanManifest>>, signal: AbortSignal) {
    await mkdir(source, { mode: 0o700 });
    const parents = new Set<string>([source]);
    for (const file of files) {
        signal.throwIfAborted();
        const content = await readProjectFile(join(root, file.path), file.sizeBytes)
            .catch(() => { throw new HttpError(409, 'SCAN_SOURCE_CHANGED'); });
        if (content.length !== file.sizeBytes || digest(content) !== file.sha256) throw new HttpError(409, 'SCAN_SOURCE_CHANGED');
        const target = join(source, file.path);
        const parent = dirname(target);
        if (!parents.has(parent)) {
            await mkdir(parent, { mode: 0o700, recursive: true });
            parents.add(parent);
        }
        await writeFile(target, content, { signal, flag: 'wx', mode: 0o400 });
    }
}
