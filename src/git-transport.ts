import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { archiveLimits, ArchiveWriter } from './archive.js';
import { HttpError } from './http-error.js';

const run = promisify(execFile);
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const loopback = new Set(['127.0.0.1', '[::1]', 'localhost']);
const commandBudget = 90_000;
const capabilities = ['http', 'https'];
const gitConfig = ['-c', 'http.followRedirects=false', '-c', 'http.sslVerify=true', '-c', 'credential.helper=',
    '-c', 'http.lowSpeedLimit=1', '-c', 'http.lowSpeedTime=25', '-c', 'fetch.unpackLimit=1', '-c', 'transfer.fsckObjects=true'];
const decode = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export interface GitCredential { username?: string; token: string }

function networkOrigin(url: URL) {
    return !url.username && !url.password && !url.search && !url.hash && url.port !== '0'
        && (url.protocol === 'https:' || (url.protocol === 'http:' && loopback.has(url.hostname)));
}

export function gitOrigins(configuration = '') {
    const origins = new Set<string>();
    for (const item of configuration.split(',').map(value => value.trim()).filter(Boolean)) {
        const url = new URL(item);
        if (!networkOrigin(url) || url.pathname !== '/') throw new Error('Invalid REPOGRAPH_GIT_ORIGINS');
        origins.add(url.origin);
    }
    return origins;
}

export function gitRepositoryUrl(raw: string, origins: ReadonlySet<string>) {
    try {
        if (!/^https?:\/\/[^/]+\/[A-Za-z0-9_./-]+$/i.test(raw) || /[\\?#\s]/u.test(raw) || raw.length > 500) throw new Error();
        const path = raw.slice(raw.indexOf('/', raw.indexOf('//') + 2)).replace(/\/+$/, '');
        if (!path || path.slice(1).split('/').some(part => !part || part.startsWith('.'))) throw new Error();
        const url = new URL(raw);
        if (!networkOrigin(url)) throw new Error();
        if (!origins.has(url.origin)) throw new HttpError(403, 'GIT_ORIGIN_NOT_ALLOWED');
        return { origin: url.origin, path, url: url.origin + path };
    } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, 'INVALID_GIT_REPOSITORY_URL');
    }
}

export function gitBranch(value: string) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/.test(value) || value.includes('..')
        || value.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock') || part.endsWith('.'))) {
        throw new HttpError(400, 'INVALID_GIT_BRANCH');
    }
    return value;
}

function environment(credential?: GitCredential) {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: capabilities.join(':') };
    if (credential) {
        const header = credential.username === undefined ? 'Bearer ' + credential.token
            : 'Basic ' + Buffer.from(credential.username + ':' + credential.token).toString('base64');
        env.REPOGRAPH_GIT_AUTHORIZATION = 'Authorization: ' + header;
    }
    return env;
}

async function git(args: string[], options: { signal: AbortSignal; cwd?: string; credential?: GitCredential; maxBuffer?: number }) {
    const { signal, cwd, credential, maxBuffer = 1024 * 1024 } = options;
    try {
        const { stdout } = await run('git', [
            ...gitConfig, ...(credential ? ['--config-env=http.extraHeader=REPOGRAPH_GIT_AUTHORIZATION'] : []), ...args
        ], { env: environment(credential), cwd, signal, timeout: commandBudget, maxBuffer, encoding: 'buffer' });
        return stdout;
    } catch (error) {
        signal.throwIfAborted();
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(503, 'GIT_EXECUTABLE_UNAVAILABLE');
        if (args[0] === 'ls-remote' && (error as { code?: number }).code === 2) throw new HttpError(404, 'GIT_BRANCH_NOT_FOUND');
        throw new HttpError(502, 'GIT_REMOTE_REQUEST_FAILED');
    }
}

export async function resolveGitCommit(remote: string, branch: string, signal: AbortSignal, credential?: GitCredential) {
    const ref = 'refs/heads/' + gitBranch(branch);
    const listed = await git(['ls-remote', '--refs', '--exit-code', '--', remote, ref], { signal, credential });
    const [commit, matched, extra] = listed.toString('ascii').trim().split(/\s+/);
    if (!commitPattern.test(commit) || matched !== ref || extra) throw new HttpError(502, 'GIT_REMOTE_REF_INVALID');
    return commit;
}

async function extractGitTree(repository: string, commit: string, tree: string, signal: AbortSignal, limits: ReturnType<typeof archiveLimits>) {
    const entries = await git(['ls-tree', '-rzl', '--full-tree', commit], { cwd: repository, signal, maxBuffer: Math.min(32 * 1024 * 1024, limits.extracted) });
    const rows = decode.decode(entries).split('\0');
    const objects = [];
    let bytes = 0;
    if (rows.length - 1 > limits.entries) throw new HttpError(413, 'ARCHIVE_ENTRY_LIMIT');
    for (const row of rows) {
        if (!row) continue;
        const tab = row.indexOf('\t');
        const [mode, type, object, rawSize] = row.slice(0, tab).trim().split(/ +/);
        if ((mode === '120000' && type === 'blob') || (mode === '160000' && type === 'commit')) continue;
        if (tab < 0 || type !== 'blob' || !['100644', '100755'].includes(mode) || !commitPattern.test(object) || !/^\d+$/.test(rawSize)) {
            throw new HttpError(400, 'GIT_UNSUPPORTED_TREE_ENTRY');
        }
        const path = row.slice(tab + 1);
        if (path.split('/').some(part => part.toLowerCase() === '.git')) throw new HttpError(400, 'GIT_UNSUPPORTED_TREE_ENTRY');
        const size = Number(rawSize);
        bytes += size;
        if (!Number.isSafeInteger(size) || size > limits.file || bytes > limits.extracted) throw new HttpError(413, 'ARCHIVE_EXTRACT_LIMIT');
        objects.push({ object, size, path });
    }

    await mkdir(tree, { mode: 0o700 });
    const writer = new ArchiveWriter(tree, limits, true);
    const reader = spawn('git', [...gitConfig, 'cat-file', '--batch'], {
        cwd: repository, env: environment(), stdio: ['pipe', 'pipe', 'ignore'], signal
    });
    reader.stdin.on('error', () => {});
    const exited = once(reader, 'close');
    void exited.catch(() => undefined);
    const input = reader.stdout[Symbol.asyncIterator]();
    let buffered = Buffer.alloc(0);
    const more = async () => {
        const next = await input.next();
        if (next.done) throw new HttpError(502, 'GIT_OBJECT_READ_FAILED');
        return Buffer.from(next.value);
    };
    const header = async () => {
        while (buffered.indexOf(10) < 0 && buffered.length <= 256) buffered = Buffer.concat([buffered, await more()]);
        const end = buffered.indexOf(10);
        if (end < 0 || end > 256) throw new HttpError(502, 'GIT_OBJECT_READ_FAILED');
        const line = buffered.subarray(0, end).toString('ascii');
        buffered = buffered.subarray(end + 1);
        return line;
    };
    async function* file(bytes: number) {
        while (bytes > 0) {
            if (!buffered.length) buffered = await more();
            const count = Math.min(buffered.length, bytes);
            const chunk = buffered.subarray(0, count);
            buffered = buffered.subarray(count);
            bytes -= count;
            yield chunk;
        }
    }
    try {
        for (const { object, size, path } of objects) {
            signal.throwIfAborted();
            if (!reader.stdin.write(object + '\n')) await once(reader.stdin, 'drain', { signal });
            if (await header() !== object + ' blob ' + size) throw new HttpError(502, 'GIT_OBJECT_READ_FAILED');
            await writer.put(path, false, size, Readable.from(file(size)), undefined, signal);
            if (!buffered.length) buffered = await more();
            if (buffered[0] !== 10) throw new HttpError(502, 'GIT_OBJECT_READ_FAILED');
            buffered = buffered.subarray(1);
        }
        reader.stdin.end();
        if ((await exited)[0] !== 0) throw new HttpError(502, 'GIT_OBJECT_READ_FAILED');
    } finally {
        if (reader.exitCode === null && reader.signalCode === null) reader.kill();
        await exited.catch(() => undefined);
    }
}

async function availableTree(tree: string) {
    try {
        if (!(await lstat(tree)).isDirectory() || await realpath(tree) !== tree) throw new HttpError(409, 'GIT_STORAGE_CHANGED');
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

export async function removeGitBinding(root: string, binding: string) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(binding)) throw new HttpError(409, 'GIT_STORAGE_CHANGED');
    if (!await availableTree(root)) return;
    const directory = join(root, binding);
    if (await availableTree(directory)) await rm(directory, { recursive: true, force: true });
}

export async function materializeGitCommit(directory: string, remote: string, commit: string, signal: AbortSignal,
    credential: GitCredential | undefined, workspace: { leaseId: string; guard: () => void; leaseActive: (id: string) => boolean }) {
    if (!commitPattern.test(commit)) throw new HttpError(400, 'INVALID_GIT_COMMIT');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!await availableTree(directory)) throw new HttpError(409, 'GIT_STORAGE_CHANGED');
    for (const entry of await readdir(directory)) {
        const prior = /^\.fetch-([a-f0-9-]{36})-[a-zA-Z0-9]{6}$/.exec(entry)?.[1];
        if (!prior || prior === workspace.leaseId || workspace.leaseActive(prior)) continue;
        workspace.guard();
        await rm(join(directory, entry), { recursive: true, force: true });
    }
    if (await availableTree(join(directory, commit, 'tree'))) return join(directory, commit, 'tree');
    const temporary = await mkdtemp(join(directory, '.fetch-' + workspace.leaseId + '-'));
    try {
        const limits = archiveLimits();
        const staging = join(temporary, 'commit');
        const tree = join(staging, 'tree');
        const repository = join(temporary, 'objects');
        await mkdir(staging, { mode: 0o700 });
        await git(['init', '--bare', '--quiet', '--object-format=' + (commit.length === 64 ? 'sha256' : 'sha1'), repository], { signal });
        const exceedsLimit = new AbortController();
        const fetching = AbortSignal.any([signal, exceedsLimit.signal]);
        const directoryOfPacks = join(repository, 'objects', 'pack');
        const check = async () => {
            try {
                const entries = await readdir(directoryOfPacks);
                let bytes = 0;
                for (const entry of entries) bytes += (await lstat(join(directoryOfPacks, entry))).size;
                if (bytes > limits.upload) exceedsLimit.abort(new HttpError(413, 'GIT_PACK_LIMIT'));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') exceedsLimit.abort(new HttpError(409, 'GIT_STORAGE_CHANGED'));
            }
        };
        const monitor = setInterval(() => void check(), 80).unref();
        try {
            await git(['fetch', '--depth=1', '--no-tags', '--no-recurse-submodules', '--no-auto-maintenance', '--', remote, commit],
                { cwd: repository, signal: fetching, credential });
            await check();
            fetching.throwIfAborted();
        } finally { clearInterval(monitor); }
        const resolved = await git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], { cwd: repository, signal });
        if (resolved.toString('ascii').trim() !== commit) throw new HttpError(409, 'GIT_COMMIT_MISMATCH');
        await extractGitTree(repository, commit, tree, signal, limits);
        signal.throwIfAborted();
        workspace.guard();
        const destination = join(directory, commit);
        try { await rename(staging, destination); }
        catch (error) {
            if (!['EEXIST', 'ENOTEMPTY'].includes(String((error as NodeJS.ErrnoException).code))
                || !await availableTree(join(destination, 'tree'))) throw error;
        }
        return join(destination, 'tree');
    } finally { await rm(temporary, { recursive: true, force: true }); }
}
