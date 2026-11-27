import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32, createGunzip } from 'node:zlib';
import busboy from 'busboy';
import { Parser } from 'tar';
import type { ReadEntry } from 'tar';
import yauzl from 'yauzl';
import { HttpError } from './http-error.js';

const MIB = 1024 * 1024;
export interface ArchiveLimits {
    upload: number;
    extracted: number;
    file: number;
    entries: number;
    depth: number;
}

export function archiveLimits(env: NodeJS.ProcessEnv = process.env): ArchiveLimits {
    function read(name: string, fallback: number, maximum: number) {
        const raw = env[name];
        if (raw === undefined) return fallback;
        const number = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number) || number < 1 || number > maximum) {
            throw new Error(`Invalid ${name}`);
        }
        return number;
    }
    return {
        upload: read('REPOGRAPH_ASSET_MAX_UPLOAD_MIB', 200, 1024) * MIB,
        extracted: read('REPOGRAPH_ASSET_MAX_EXTRACTED_MIB', 1024, 8192) * MIB,
        file: read('REPOGRAPH_ASSET_MAX_FILE_MIB', 50, 1024) * MIB,
        entries: read('REPOGRAPH_ASSET_MAX_ENTRIES', 50_000, 200_000),
        depth: read('REPOGRAPH_ASSET_MAX_DEPTH', 32, 64)
    };
}

function limitError(code: string) { return new HttpError(413, code); }
function unsafe() { return new HttpError(400, 'UNSAFE_ARCHIVE_ENTRY'); }

export async function receiveArchive(request: IncomingMessage, destination: string, limit: number, signal: AbortSignal) {
    if (!request.headers['content-type']?.toLowerCase().startsWith('multipart/form-data')) {
        throw new HttpError(415, 'MULTIPART_ARCHIVE_REQUIRED');
    }
    const requestLimit = limit + 65_536;
    if (Number(request.headers['content-length']) > requestLimit) throw limitError('ARCHIVE_UPLOAD_LIMIT');
    let parser: ReturnType<typeof busboy>;
    try {
        parser = busboy({ headers: request.headers, defParamCharset: 'utf8',
            limits: { fileSize: limit + 1, files: 2, fields: 3, parts: 4, fieldSize: 4096 } });
    } catch {
        throw new HttpError(400, 'INVALID_ARCHIVE_UPLOAD');
    }

    const fields: Record<string, string> = {};
    let name = '';
    let sizeBytes = 0;
    const hash = createHash('sha256');
    let writing: Promise<void> | undefined;
    let fault: HttpError | undefined;
    const reject = (code = 'INVALID_ARCHIVE_UPLOAD') => { fault ??= new HttpError(400, code); };
    parser.on('field', (field, value, info) => {
        if (!['lang', 'strategy'].includes(field) || Object.hasOwn(fields, field) || info.nameTruncated || info.valueTruncated) {
            reject();
        } else fields[field] = value;
    });
    parser.on('filesLimit', () => reject());
    parser.on('fieldsLimit', () => reject());
    parser.on('partsLimit', () => reject());
    parser.on('file', (field, file, info) => {
        if (field !== 'file' || writing) {
            reject();
            file.resume();
            return;
        }
        name = (info.filename ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 255);
        file.once('limit', () => { fault = limitError('ARCHIVE_UPLOAD_LIMIT'); });
        const fingerprint = new Transform({ transform(chunk: Buffer, _, done) {
            sizeBytes += chunk.byteLength;
            hash.update(chunk);
            done(null, chunk);
        } });
        writing = pipeline(file, fingerprint, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
        void writing.catch(error => parser.destroy(error));
    });
    async function* body() {
        let received = 0;
        for await (const chunk of request.iterator({ destroyOnReturn: false })) {
            received += chunk.length;
            if (received > requestLimit) throw limitError('ARCHIVE_UPLOAD_LIMIT');
            yield chunk;
        }
    }
    try {
        await pipeline(body(), parser, { signal });
        await writing;
    } catch (error) {
        await writing?.catch(() => undefined);
        if (error instanceof HttpError) throw error;
        throw fault ?? new HttpError(400, 'INVALID_ARCHIVE_UPLOAD');
    }
    if (fault) throw fault;
    if (!writing || !sizeBytes || sizeBytes !== (await lstat(destination)).size) throw new HttpError(400, 'ARCHIVE_FILE_REQUIRED');
    return { name: name || 'archive', fields, sha256: hash.digest('hex'), sizeBytes };
}

export interface ArchiveFile { path: string; sizeBytes: number; sha256?: string }
export type ArchiveType = 'ZIP' | 'TAR_GZ';

export class ArchiveWriter {
    private readonly paths = new Map<string, { name: string; directory: boolean; explicit: boolean }>();
    private readonly files: ArchiveFile[] = [];
    private entries = 0;
    private size = 0;
    private rootSeen = false;

    constructor(private readonly root: string, private readonly limits: ArchiveLimits, private readonly preservePathBytes = false) {}

    async put(name: string, directory: boolean, size: number, stream?: Readable, checksum?: number, signal?: AbortSignal) {
        if (++this.entries > this.limits.entries) throw limitError('ARCHIVE_ENTRY_LIMIT');
        if (!Number.isSafeInteger(size) || size < 0 || (directory && size !== 0)) throw unsafe();
        if (size > this.limits.file || size > this.limits.extracted - this.size) throw limitError('ARCHIVE_EXTRACT_LIMIT');
        if (directory && name === './') {
            if (this.rootSeen) throw unsafe();
            this.rootSeen = true;
            return;
        }
        const relative = name.replace(/^(?:\.\/)+/, '').replace(/\/$/, '');
        const path = this.preservePathBytes ? relative : relative.normalize('NFC');
        const parts = path.split('/');
        if (!name || name.startsWith('/') || (!directory && name.endsWith('/')) || path.length > 4096
            || parts.some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f\x7f]/u.test(part))) {
            throw unsafe();
        }
        if (parts.length > this.limits.depth) throw limitError('ARCHIVE_DEPTH_LIMIT');

        for (let i = 1; i <= parts.length; i++) {
            const segment = parts.slice(0, i).join('/');
            const key = segment.normalize('NFD').toLowerCase();
            const last = i === parts.length;
            const previous = this.paths.get(key);
            const folder = !last || directory;
            if (previous && (previous.name !== segment || previous.directory !== folder || (last && previous.explicit))) {
                throw unsafe();
            }
            if (!previous && this.paths.size >= this.limits.entries) throw limitError('ARCHIVE_ENTRY_LIMIT');
            this.paths.set(key, { name: segment, directory: folder, explicit: last || !!previous?.explicit });
        }

        const destination = join(this.root, ...parts);
        if (directory) {
            await mkdir(destination, { recursive: true, mode: 0o700 });
            return;
        }
        if (!stream) throw unsafe();
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        let written = 0;
        let crc = 0;
        const fingerprint = createHash('sha256');
        const monitor = new Transform({
            transform: (chunk: Buffer, _, done) => {
                written += chunk.length;
                if (written > size || written > this.limits.extracted - this.size) {
                    done(limitError('ARCHIVE_EXTRACT_LIMIT'));
                    return;
                }
                if (checksum !== undefined) crc = crc32(chunk, crc);
                fingerprint.update(chunk);
                done(null, chunk);
            }
        });
        await pipeline(stream, monitor, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
        if (written !== size || (checksum !== undefined && crc !== checksum)) throw new HttpError(400, 'INVALID_ARCHIVE_CHECKSUM');
        this.size += written;
        this.files.push({ path, sizeBytes: written, sha256: fingerprint.digest('hex') });
    }

    manifest() {
        if (!this.files.length) throw new HttpError(400, 'ARCHIVE_EMPTY');
        const top = new Set([...this.paths.values()].map(item => item.name.split('/', 1)[0]));
        const first = this.files[0].path.split('/', 1)[0];
        const unwrap = top.size === 1 && this.files[0].path.includes('/');
        const files = unwrap ? this.files.map(file => ({ ...file, path: file.path.slice(first.length + 1) })) : this.files;
        return {
            projectRoot: unwrap ? join(this.root, first) : this.root,
            files: files.sort((a, b) => a.path.localeCompare(b.path))
        };
    }
}

async function unzip(path: string, writer: ArchiveWriter, limits: ArchiveLimits, signal: AbortSignal) {
    const file = await yauzl.openPromise(path, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true });
    try {
        if (file.entryCount > limits.entries) throw limitError('ARCHIVE_ENTRY_LIMIT');
        for await (const entry of file.eachEntry()) {
            signal.throwIfAborted();
            const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
            if ((entry.generalPurposeBitFlag & 1) || (mode !== 0 && mode !== 0x8000 && mode !== 0x4000)) throw unsafe();
            const directory = entry.fileName.endsWith('/') || mode === 0x4000 || (entry.externalFileAttributes & 0x10) !== 0;
            if (directory && mode === 0x8000) throw unsafe();
            if (directory) {
                await writer.put(entry.fileName, true, entry.uncompressedSize);
            } else {
                if (entry.uncompressedSize > limits.file) throw limitError('ARCHIVE_EXTRACT_LIMIT');
                const stream = await file.openReadStreamPromise(entry);
                try {
                    await writer.put(entry.fileName, false, entry.uncompressedSize, stream, entry.crc32, signal);
                } finally { stream.destroy(); }
            }
        }
    } finally { file.close(); }
}

async function untar(path: string, writer: ArchiveWriter, limits: ArchiveLimits, signal: AbortSignal) {
    const receiver = new Parser({ strict: true, maxMetaEntrySize: MIB });
    const cancel = new AbortController();
    const active = AbortSignal.any([signal, cancel.signal]);
    const failure = (error: unknown) => cancel.abort(error);
    receiver.on('error', failure);
    receiver.on('ignoredEntry', (entry: ReadEntry) => failure(entry.meta ? limitError('ARCHIVE_META_LIMIT') : unsafe()));

    const ended = once(receiver, 'end', { signal: active });
    void ended.catch(() => undefined);
    let writing = Promise.resolve();
    receiver.on('entry', (entry: ReadEntry) => {
        writing = writing.then(async () => {
            active.throwIfAborted();
            const directory = entry.type === 'Directory';
            if (entry.linkpath || (!directory && entry.type !== 'File' && entry.type !== 'OldFile')) throw unsafe();
            await writer.put(entry.path, directory, entry.size, directory ? undefined : Readable.from(entry), undefined, active);
            if (directory) entry.resume();
        });
        void writing.catch(failure);
    });

    const limit = limits.extracted + 1024 * limits.entries + 32 * MIB;
    let total = 0;
    const bound = new Transform({
        transform(chunk: Buffer, _, done) {
            total += chunk.length;
            if (total > limit) done(limitError('ARCHIVE_EXTRACT_LIMIT'));
            else done(null, chunk);
        }
    });
    try {
        await pipeline(createReadStream(path), createGunzip(), bound, async source => {
            for await (const bytes of source) {
                active.throwIfAborted();
                if (!receiver.write(bytes)) await once(receiver, 'drain', { signal: active });
            }
            receiver.end();
            await ended;
        }, { signal: active });
        await writing;
    } catch (error) {
        cancel.abort(error);
        await writing.catch(() => undefined);
        throw active.reason ?? error;
    }
}

export async function extractArchive(path: string, root: string, limits: ArchiveLimits, signal: AbortSignal) {
    const input = await open(path, 'r');
    const signature = Buffer.alloc(4);
    try { await input.read(signature, 0, 4, 0); } finally { await input.close(); }
    let type: ArchiveType;
    if (signature.readUInt32LE() === 0x04034b50 || signature.readUInt32LE() === 0x06054b50) type = 'ZIP';
    else if (signature[0] === 0x1f && signature[1] === 0x8b) type = 'TAR_GZ';
    else throw new HttpError(415, 'UNSUPPORTED_ARCHIVE_TYPE');
    await mkdir(root, { mode: 0o700 });
    const writer = new ArchiveWriter(root, limits);
    try {
        if (type === 'ZIP') await unzip(path, writer, limits, signal);
        else await untar(path, writer, limits, signal);
    } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, 'INVALID_ARCHIVE');
    }
    return { archiveType: type, ...writer.manifest() };
}
