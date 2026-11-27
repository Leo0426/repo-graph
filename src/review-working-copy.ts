import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { HttpError } from './http-error.js';
import { readProjectFile, relativeEvidencePath } from './project-file.js';
import { digest, languageOf } from './source.js';

const command = promisify(execFile);
const gitObject = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const maxFile = 256 * 1024;
const maxCapture = 2 * 1024 * 1024;
export const overlayPath = z.string().min(1).max(4096).refine(path => relativeEvidencePath(path) === path
    && !path.split('/').some(part => part.toLowerCase() === '.git') && Boolean(languageOf(path)) && languageOf(path) !== 'class');
export type WorkingFile = { path: string; base: Buffer | null; target: Buffer | null };

async function git(root: string, args: string[], signal: AbortSignal) {
    try {
        const { stdout } = await command('git', ['--no-replace-objects', '--literal-pathspecs', '-c', 'core.fsmonitor=false',
            '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, signal, timeout: 4000, maxBuffer: maxFile + 1, encoding: 'buffer',
                env: { PATH: process.env.PATH, LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
                    GIT_ALLOW_PROTOCOL: '', GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } });
        return stdout;
    } catch (error) {
        signal.throwIfAborted();
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(503, 'GIT_EXECUTABLE_UNAVAILABLE');
        throw new HttpError(409, 'OVERLAY_GIT_BASE_UNAVAILABLE');
    }
}

async function head(root: string, signal: AbortSignal) {
    const sha = (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'], signal)).toString('ascii').trim();
    if (!gitObject.test(sha)) throw new HttpError(409, 'OVERLAY_GIT_BASE_UNAVAILABLE');
    return sha;
}

async function workingFile(root: string, path: string) {
    const absolute = join(root, path);
    try {
        const stat = await lstat(absolute);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new HttpError(409, 'OVERLAY_SOURCE_PATH_CHANGED');
        if (stat.size > maxFile) throw new HttpError(413, 'OVERLAY_SOURCE_TOO_LARGE');
        return await readProjectFile(absolute, maxFile);
    } catch (error) {
        if (error instanceof HttpError) throw error;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            let parent = dirname(absolute);
            while (parent !== root) {
                try {
                    if (await realpath(parent) !== parent) throw new HttpError(409, 'OVERLAY_SOURCE_PATH_CHANGED');
                    break;
                } catch (cause) {
                    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw new HttpError(409, 'OVERLAY_SOURCE_PATH_CHANGED');
                }
                parent = dirname(parent);
            }
            return null;
        }
        throw new HttpError(409, 'OVERLAY_SOURCE_PATH_CHANGED');
    }
}

export async function captureWorkingCopy(root: string, paths: string[], frozen: (path: string) => Uint8Array | undefined, signal: AbortSignal) {
    signal.throwIfAborted();
    try { if (await realpath(root) !== root) throw new Error(); }
    catch { throw new HttpError(409, 'OVERLAY_SOURCE_PATH_CHANGED'); }
    if ((await git(root, ['rev-parse', '--show-toplevel'], signal)).toString('utf8').replace(/\r?\n$/, '') !== root) {
        throw new HttpError(409, 'OVERLAY_GIT_ROOT_MISMATCH');
    }
    const baseCommit = await head(root, signal);
    const tree = (await git(root, ['ls-tree', '-rzl', '--full-tree', baseCommit, '--', ...paths], signal)).toString('utf8');
    const entries = new Map<string, { mode: string; type: string; hash: string; size: number }>();
    for (const record of tree.split('\0')) {
        if (!record) continue;
        const boundary = record.indexOf('\t');
        const [mode, type, hash, size] = record.slice(0, boundary).trim().split(/ +/);
        entries.set(record.slice(boundary + 1), { mode, type, hash, size: Number(size) });
    }
    const files: WorkingFile[] = [];
    let bytes = 0;
    for (const path of paths) {
        signal.throwIfAborted();
        const entry = entries.get(path);
        if (entry && (entry.type !== 'blob' || !/^100(?:644|755)$/.test(entry.mode) || !gitObject.test(entry.hash))) {
            throw new HttpError(409, 'OVERLAY_GIT_ENTRY_UNSUPPORTED');
        }
        if (entry && (!Number.isSafeInteger(entry.size) || entry.size > maxFile)) throw new HttpError(413, 'OVERLAY_SOURCE_TOO_LARGE');
        const base = entry ? await git(root, ['cat-file', 'blob', entry.hash], signal) : null;
        const indexed = frozen(path);
        if ((!base && indexed) || (base && (!indexed || !base.equals(indexed)))) {
            throw new HttpError(409, 'OVERLAY_BASE_SOURCE_MISMATCH');
        }
        const target = await workingFile(root, path);
        bytes += (base?.length ?? 0) + (target?.length ?? 0);
        if (bytes > maxCapture) throw new HttpError(413, 'OVERLAY_SOURCE_TOO_LARGE');
        if (!base && !target) throw new HttpError(404, 'OVERLAY_SELECTED_SOURCE_NOT_FOUND');
        if (!base || !target || !base.equals(target)) files.push({ path, base, target });
    }
    if (await head(root, signal) !== baseCommit) throw new HttpError(409, 'OVERLAY_GIT_BASE_CHANGED');
    return { baseCommit, files, digest: digest(JSON.stringify([baseCommit,
        files.map(file => [file.path, file.base && digest(file.base), file.target && digest(file.target)])])) };
}
