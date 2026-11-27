import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, unlinkSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { ArchiveFile, ArchiveType } from './archive.js';
import { HttpError } from './http-error.js';

export interface ArchiveObject { id: string; sha256: string; sizeBytes: number; archiveType: ArchiveType }
export interface ArchiveOrigin { type: 'ARCHIVE'; assetId: string; objectId: string; sha256: string; sizeBytes: number; archiveType: ArchiveType }

const digestPattern = /^[a-f0-9]{64}$/;
const unreferenced = `NOT EXISTS (SELECT 1 FROM managed_asset_source s WHERE s.object_id = archive_object.id)
    AND NOT EXISTS (SELECT 1 FROM knowledge_archive_source k WHERE k.object_id = archive_object.id)`;
function missing(error: unknown) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }

function retentionMs() {
    const value = process.env.REPOGRAPH_ARCHIVE_RETENTION_SECONDS ?? '86400';
    if (!/^\d{1,8}$/.test(value)) throw new Error('Invalid REPOGRAPH_ARCHIVE_RETENTION_SECONDS');
    return Number(value) * 1000;
}

export class ArchiveObjects {
    private readonly root: string;
    private readonly retention = retentionMs();

    constructor(private readonly db: DatabaseSync, assetsRoot: string) {
        this.root = join(assetsRoot, '.archive-objects');
        db.exec(`
            CREATE TABLE IF NOT EXISTS archive_object (
                id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL,
                archive_type TEXT NOT NULL CHECK(archive_type IN ('ZIP','TAR_GZ')), reclaim_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS managed_asset_source (
                asset_id TEXT PRIMARY KEY REFERENCES managed_asset(id) ON DELETE CASCADE,
                object_id TEXT NOT NULL REFERENCES archive_object(id)
            );
            CREATE INDEX IF NOT EXISTS managed_asset_source_object ON managed_asset_source(object_id);
            CREATE TABLE IF NOT EXISTS knowledge_archive_source (
                snapshot_id TEXT PRIMARY KEY REFERENCES knowledge_snapshot(id) ON DELETE CASCADE,
                object_id TEXT NOT NULL REFERENCES archive_object(id)
            );
            CREATE INDEX IF NOT EXISTS knowledge_archive_source_object ON knowledge_archive_source(object_id);
        `);
    }

    private verifyRoot(create = false) {
        if (create) mkdirSync(this.root, { recursive: true, mode: 0o700 });
        try {
            if (!lstatSync(this.root).isDirectory() || realpathSync(this.root) !== this.root) {
                throw new HttpError(409, 'ARCHIVE_OBJECT_STORAGE_CHANGED');
            }
            return true;
        } catch (error) {
            if (missing(error) && !create) return false;
            throw error;
        }
    }

    private path(sha256: string) {
        if (!digestPattern.test(sha256)) throw new HttpError(409, 'ARCHIVE_OBJECT_STORAGE_CHANGED');
        return join(this.root, sha256);
    }

    private checkFile(path: string, expectedSize: number) {
        const info = lstatSync(path);
        if (!info.isFile() || info.size !== expectedSize) throw new HttpError(409, 'ARCHIVE_OBJECT_UNAVAILABLE');
        return info;
    }

    private syncDirectory() {
        const fd = openSync(this.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { fsyncSync(fd); }
        finally { closeSync(fd); }
    }

    read(assetId: string) {
        return this.db.prepare(`SELECT o.id, o.sha256, o.size_bytes AS sizeBytes, o.archive_type AS archiveType
            FROM managed_asset_source s JOIN archive_object o ON o.id = s.object_id WHERE s.asset_id = ?`)
            .get(assetId) as unknown as ArchiveObject | undefined;
    }

    // The caller owns the transaction. Files are durable before the new object is referenced.
    store(assetId: string, original: string, data: Omit<ArchiveObject, 'id'>) {
        this.verifyRoot(true);
        const path = this.path(data.sha256);
        const current = this.db.prepare('SELECT id, size_bytes, archive_type FROM archive_object WHERE sha256 = ?').get(data.sha256);
        const id = String(current?.id ?? randomUUID());
        if (current) {
            if (current.size_bytes !== data.sizeBytes || current.archive_type !== data.archiveType) throw new HttpError(409, 'ARCHIVE_OBJECT_CONFLICT');
            try { this.checkFile(path, data.sizeBytes); }
            catch (error) {
                if (!missing(error)) throw error;
                linkSync(original, path);
                this.syncDirectory();
            }
        } else {
            // A previous transaction may have stopped after linking this exact digest.
            try { unlinkSync(path); }
            catch (error) { if (!missing(error)) throw error; }
            linkSync(original, path);
            this.syncDirectory();
            this.db.prepare('INSERT INTO archive_object VALUES (?, ?, ?, ?, NULL)').run(id, data.sha256, data.sizeBytes, data.archiveType);
        }
        this.attach(assetId, id);
    }

    attach(assetId: string, objectId: string) {
        this.db.prepare('INSERT INTO managed_asset_source VALUES (?, ?)').run(assetId, objectId);
        this.db.prepare('UPDATE archive_object SET reclaim_at = NULL WHERE id = ?').run(objectId);
    }

    async verifiedPath(object: ArchiveObject, signal: AbortSignal) {
        if (!this.verifyRoot()) throw new HttpError(409, 'ARCHIVE_OBJECT_UNAVAILABLE');
        const path = this.path(object.sha256);
        try {
            const first = this.checkFile(path, object.sizeBytes);
            const hash = createHash('sha256');
            let size = 0;
            const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                for await (const chunk of descriptor.createReadStream({ autoClose: false, signal })) {
                    size += chunk.length;
                    if (size > object.sizeBytes) throw new HttpError(409, 'ARCHIVE_OBJECT_UNAVAILABLE');
                    hash.update(chunk);
                }
            } finally { await descriptor.close(); }
            const last = this.checkFile(path, object.sizeBytes);
            if (size !== object.sizeBytes || hash.digest('hex') !== object.sha256
                || first.ino !== last.ino || first.dev !== last.dev || first.mtimeMs !== last.mtimeMs) {
                throw new HttpError(409, 'ARCHIVE_OBJECT_UNAVAILABLE');
            }
            return path;
        } catch (error) {
            if (missing(error)) throw new HttpError(409, 'ARCHIVE_OBJECT_UNAVAILABLE');
            throw error;
        }
    }

    bindSnapshot(projectId: string, snapshotId: string) {
        const asset = this.db.prepare('SELECT id, manifest FROM managed_asset WHERE project_id = ? AND deleting = 0').get(projectId);
        if (!asset) return undefined;
        const assetId = String(asset.id);
        const object = this.read(assetId);
        if (!object) return undefined;
        const files = JSON.parse(String(asset.manifest)) as ArchiveFile[];
        const expected = new Map(files.map(file => [file.path, file.sha256]));
        const indexed = this.db.prepare('SELECT path, hash FROM indexed_source WHERE project_id = ?').iterate(projectId);
        for (const row of indexed) {
            if (expected.get(String(row.path)) !== row.hash) throw new HttpError(409, 'ARCHIVE_INDEX_SOURCE_MISMATCH');
        }
        this.db.prepare('INSERT INTO knowledge_archive_source VALUES (?, ?)').run(snapshotId, object.id);
        const { id: objectId, ...data } = object;
        return { type: 'ARCHIVE', assetId, objectId, ...data } satisfies ArchiveOrigin;
    }

    collect(now = Date.now()) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            this.db.prepare(`UPDATE archive_object SET reclaim_at = ? WHERE reclaim_at IS NULL AND ${unreferenced}`).run(now + this.retention);
            if (this.verifyRoot()) {
                let changed = false;
                const due = this.db.prepare(`SELECT id, sha256 FROM archive_object WHERE reclaim_at <= ? AND ${unreferenced}`).all(now);
                for (const row of due) {
                    const path = this.path(String(row.sha256));
                    try { unlinkSync(path); changed = true; }
                    catch (error) { if (!missing(error)) { console.error('Unable to reclaim an archived source object'); continue; } }
                    this.db.prepare('DELETE FROM archive_object WHERE id = ?').run(row.id);
                }
                const hasObject = this.db.prepare('SELECT 1 FROM archive_object WHERE sha256 = ?');
                for (const digest of readdirSync(this.root)) {
                    if (!digestPattern.test(digest) || hasObject.get(digest)) continue;
                    const orphan = this.path(digest);
                    try {
                        if (lstatSync(orphan).mtimeMs + this.retention > now) continue;
                        unlinkSync(orphan);
                        changed = true;
                    } catch { console.error('Unable to reclaim an interrupted archive source object'); }
                }
                if (changed) this.syncDirectory();
            }
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
}
