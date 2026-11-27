import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { availableProject } from './project-retirement.js';
import { archiveLimits, extractArchive, receiveArchive } from './archive.js';
import type { ArchiveFile } from './archive.js';
import { ArchiveObjects } from './archive-objects.js';
import { assetProfile } from './asset-profile.js';
import { HttpError } from './http-error.js';
import { dependencyInventory } from './sbom.js';
import { digest, sourceLanguages } from './source.js';
import type { IndexLanguage, IndexStrategy } from './source.js';

export const assetIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

interface AssetIndex {
    start: (root: string, languages: Set<IndexLanguage>, incremental: boolean, strategy?: IndexStrategy,
        register?: (projectId: string) => void) => Promise<unknown>;
    claim: (accountId: string, projectId: string) => void;
    frameworks: (projectId: string) => Record<string, number>;
    vulnerabilityCounts: (projectId: string) => Record<string, number>;
}

type ArchiveRequest = { accountId: string; key?: string; authorize: () => void; signal: AbortSignal };
type ArchiveStage = { id: string; lease: string; directory: string; source: string };
type ArchiveAdmission = { fingerprint: string; accountId: string; key?: string };
const stageLeaseMs = 120_000;
class ArchiveReplay extends Error {}

function inside(parent: string, child: string) {
    const path = relative(parent, child);
    return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}

export function indexLanguages(raw?: string | null, includeBytecode = false) {
    const values = raw?.trim() ? raw.split(',').map(item => item.trim().toLowerCase()) : sourceLanguages;
    const supported = new Set<string>([...sourceLanguages, 'class']);
    if (values.some(value => !supported.has(value))) throw new HttpError(400, 'UNSUPPORTED_LANGUAGE');
    const languages = new Set(values as IndexLanguage[]);
    if (includeBytecode) languages.add('class');
    return languages;
}

export function indexStrategy(raw?: string | null): IndexStrategy {
    const strategy = raw?.trim().toLowerCase() || 'auto';
    if (strategy === 'auto' || strategy === 'precise' || strategy === 'heuristic') return strategy;
    throw new HttpError(400, 'UNSUPPORTED_PARSE_STRATEGY');
}

export class Assets {
    private readonly limits = archiveLimits();
    private uploads = 0;
    private readonly deletes = new Set<string>();
    private readonly objects: ArchiveObjects;
    private recoveryTimer: NodeJS.Timeout | undefined;
    private recovery: Promise<void> | undefined;

    constructor(private readonly db: DatabaseSync, readonly root: string, private readonly index: AssetIndex) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS managed_asset (
                id TEXT PRIMARY KEY, project_id TEXT UNIQUE, source_root TEXT,
                filename TEXT, archive_type TEXT, manifest TEXT, created_at TEXT NOT NULL,
                deleting INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS managed_asset_upload (
                asset_id TEXT PRIMARY KEY REFERENCES managed_asset(id) ON DELETE CASCADE, lease TEXT NOT NULL, expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS managed_asset_name (
                asset_id TEXT PRIMARY KEY REFERENCES managed_asset(id) ON DELETE CASCADE, display_name TEXT NOT NULL, revision INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS managed_asset_request (
                actor_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
                asset_id TEXT REFERENCES managed_asset(id) ON DELETE SET NULL, PRIMARY KEY(actor_id, request_key)
            );
        `);
        this.objects = new ArchiveObjects(db, root);
    }

    private transaction<T>(operation: () => T) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = operation();
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    ownsPath(path: string) { return inside(this.root, path); }

    validateSource(id: string, path: string) {
        if (!inside(join(this.directory(id), 'source'), path)) throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
    }

    private directory(id: string) {
        if (!assetIdPattern.test(id)) throw new HttpError(404, 'ASSET_NOT_FOUND');
        return join(this.root, id);
    }

    private async removeSource(id: string) {
        const directory = this.directory(id);
        if (await realpath(this.root) !== this.root) throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
        try {
            const info = await lstat(directory);
            if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
                throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
            }
        } catch (error) {
            if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
        }
        await rm(directory, { recursive: true, force: true });
    }

    async recoverUploads() {
        const staged = this.db.prepare(`SELECT a.id, a.source_root FROM managed_asset a LEFT JOIN managed_asset_upload u ON u.asset_id = a.id
            WHERE a.project_id IS NULL AND (u.expires_at IS NULL OR u.expires_at <= ?)`).all(Date.now());
        for (const row of staged) {
            try {
                const id = String(row.id);
                if (!inside(this.directory(id), String(row.source_root))) {
                    throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
                }
                const lease = randomUUID();
                const claimed = this.transaction(() => this.db.prepare(`INSERT INTO managed_asset_upload
                    SELECT id, ?, ? FROM managed_asset WHERE id = ? AND project_id IS NULL
                    ON CONFLICT(asset_id) DO UPDATE SET lease = excluded.lease, expires_at = excluded.expires_at
                    WHERE expires_at <= ? RETURNING lease`).get(lease, Date.now() + stageLeaseMs, id, Date.now()));
                if (claimed) await this.discardStage(id, lease);
            } catch { console.error('Unable to remove an interrupted archive upload'); }
        }
        const deleting = this.db.prepare('SELECT id FROM managed_asset WHERE deleting = 1').all();
        for (const row of deleting) {
            if (this.deletes.has(String(row.id))) continue;
            try { await this.removeRetiredSource(String(row.id)); }
            catch { console.error('Unable to finish removing a managed archive'); }
        }
        this.collectObjects();
    }

    startRecovery() {
        if (this.recoveryTimer) return;
        this.recoveryTimer = setInterval(() => {
            if (this.recovery) return;
            this.recovery = this.recoverUploads().catch(() => console.error('Unable to recover managed archive storage'))
                .finally(() => { this.recovery = undefined; });
        }, 60_000).unref();
    }

    async close() {
        clearInterval(this.recoveryTimer);
        await this.recovery;
    }

    async importArchive(
        request: IncomingMessage, strategy: string | null, lang: string | null, includeBytecode: boolean,
        context: ArchiveRequest
    ) {
        return this.withStage(async stage => {
            const original = join(stage.directory, 'upload');
            const received = await receiveArchive(request, original, this.limits.upload, context.signal);
            const selected = indexStrategy(strategy ?? received.fields.strategy);
            const languages = indexLanguages(lang ?? received.fields.lang, includeBytecode);
            const input = this.admission(context, ['upload', received.sha256, received.name, selected, [...languages].sort()]);
            const previous = this.prior(input, context.authorize);
            if (previous) return previous;
            const extracted = await extractArchive(original, stage.source, this.limits, context.signal);
            const fd = await open(original, 'r');
            try { await fd.sync(); }
            finally { await fd.close(); }
            const result = await this.register(stage, extracted, received.name, received.name, selected, languages, input, context,
                () => this.objects.store(stage.id, original, { sha256: received.sha256, sizeBytes: received.sizeBytes, archiveType: extracted.archiveType }));
            try { await rm(original, { force: true }); }
            catch { console.error('Unable to remove a staged archive copy'); }
            return result;
        });
    }

    async reuse(id: string, displayName: string | undefined, strategy: string | null, lang: string | null, includeBytecode: boolean,
        authorizeSource: (projectId: string) => void, context: ArchiveRequest) {
        const current = this.find(id, authorizeSource);
        const object = current.sourceObject;
        if (!object) throw new HttpError(409, 'ARCHIVE_ORIGINAL_UNAVAILABLE');
        if (object.sizeBytes > this.limits.upload) throw new HttpError(413, 'ARCHIVE_UPLOAD_LIMIT');
        const selected = indexStrategy(strategy);
        const languages = indexLanguages(lang, includeBytecode);
        const name = displayName ?? current.displayName;
        const input = this.admission(context, ['reuse', id, object.id, displayName ?? null, selected, [...languages].sort()]);
        const previous = this.prior(input, context.authorize);
        if (previous) return previous;
        const verify = () => {
            const resource = this.find(id, authorizeSource);
            if (resource.sourceObject?.id !== object.id) throw new HttpError(409, 'ARCHIVE_SOURCE_CHANGED');
        };
        return this.withStage(async stage => {
            this.transaction(() => {
                this.verifyStage(stage);
                verify();
                this.objects.attach(stage.id, object.id);
            });
            const original = await this.objects.verifiedPath(object, context.signal);
            const extracted = await extractArchive(original, stage.source, this.limits, context.signal);
            if (extracted.archiveType !== object.archiveType) throw new HttpError(409, 'ARCHIVE_OBJECT_UNAVAILABLE');
            return this.register(stage, extracted, current.originalFileName, name, selected, languages, input, context, verify);
        });
    }

    private admission(context: ArchiveRequest, input: unknown[]) {
        return { accountId: context.accountId, key: context.key, fingerprint: digest(JSON.stringify(input)) };
    }

    private replay(input: ArchiveAdmission) {
        if (input.key === undefined) return undefined;
        const previous = this.db.prepare(`SELECT fingerprint, asset_id FROM managed_asset_request
            WHERE actor_id = ? AND request_key = ?`).get(input.accountId, input.key);
        if (!previous) return undefined;
        if (previous.fingerprint !== input.fingerprint) throw new HttpError(409, 'ASSET_REQUEST_CONFLICT');
        if (!previous.asset_id) throw new HttpError(410, 'ASSET_REQUEST_REMOVED');
        return String(previous.asset_id);
    }

    private prior(input: ArchiveAdmission, authorize: () => void) {
        authorize();
        const previous = this.replay(input);
        return previous ? this.find(previous) : undefined;
    }

    private verifyStage(stage: ArchiveStage) {
        if (!this.db.prepare('SELECT 1 FROM managed_asset_upload WHERE asset_id = ? AND lease = ? AND expires_at > ?')
            .get(stage.id, stage.lease, Date.now())) throw new HttpError(409, 'ASSET_UPLOAD_LEASE_LOST');
    }

    private async register(stage: ArchiveStage, extracted: Awaited<ReturnType<typeof extractArchive>>, originalName: string, displayName: string,
        strategy: IndexStrategy, languages: Set<IndexLanguage>, input: ArchiveAdmission, context: ArchiveRequest, capture: () => void) {
        const projectRoot = await realpath(extracted.projectRoot);
        if (!inside(stage.source, projectRoot)) throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
        context.signal.throwIfAborted();
        const previous = this.prior(input, context.authorize);
        if (previous) return previous;
        try {
            this.index.start(projectRoot, languages, true, strategy, projectId => {
                this.verifyStage(stage);
                context.authorize();
                if (this.replay(input)) throw new ArchiveReplay();
                capture();
                this.db.prepare(`UPDATE managed_asset SET project_id = ?, source_root = ?, filename = ?, archive_type = ?, manifest = ? WHERE id = ?`)
                    .run(projectId, projectRoot, originalName, extracted.archiveType, JSON.stringify(extracted.files), stage.id);
                this.db.prepare('INSERT INTO managed_asset_name VALUES (?, ?, 0)').run(stage.id, displayName);
                this.index.claim(context.accountId, projectId);
                if (input.key !== undefined) this.db.prepare('INSERT INTO managed_asset_request VALUES (?, ?, ?, ?)')
                    .run(input.accountId, input.key, input.fingerprint, stage.id);
                this.db.prepare('DELETE FROM managed_asset_upload WHERE asset_id = ?').run(stage.id);
            });
        } catch (error) {
            const replay = this.prior(input, context.authorize);
            if (replay) return replay;
            throw error;
        }
        return this.find(stage.id);
    }

    private async withStage<T>(operation: (stage: ArchiveStage) => Promise<T>) {
        if (this.uploads >= 2) throw new HttpError(503, 'ASSET_UPLOAD_CAPACITY_EXHAUSTED');
        this.uploads++;
        const id = randomUUID();
        const directory = this.directory(id);
        const source = join(directory, 'source');
        const lease = randomUUID();
        let recorded = false;
        let timer: NodeJS.Timeout | undefined;
        try {
            this.transaction(() => {
                this.db.prepare('INSERT INTO managed_asset(id, created_at, source_root) VALUES (?, ?, ?)').run(id, new Date().toISOString(), source);
                this.db.prepare('INSERT INTO managed_asset_upload VALUES (?, ?, ?)').run(id, lease, Date.now() + stageLeaseMs);
            });
            recorded = true;
            timer = setInterval(() => {
                try {
                    const now = Date.now();
                    this.db.prepare('UPDATE managed_asset_upload SET expires_at = ? WHERE asset_id = ? AND lease = ? AND expires_at > ?')
                        .run(now + stageLeaseMs, id, lease, now);
                } catch { console.error('Unable to renew an archive stage'); }
            }, stageLeaseMs / 4).unref();
            if (await realpath(this.root) !== this.root) throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
            await mkdir(directory, { mode: 0o700 });
            return await operation({ id, lease, directory, source });
        } finally {
            clearInterval(timer);
            this.uploads--;
            if (recorded) {
                try { await this.discardStage(id, lease); }
                catch { console.error('Unable to remove a failed archive upload'); }
            }
        }
    }

    private async discardStage(id: string, lease: string) {
        const active = this.db.prepare('UPDATE managed_asset_upload SET expires_at = ? WHERE asset_id = ? AND lease = ? RETURNING asset_id')
            .get(Date.now() + stageLeaseMs, id, lease);
        if (!active) return;
        await this.removeSource(id);
        this.db.prepare('DELETE FROM managed_asset WHERE id = ? AND project_id IS NULL').run(id);
        this.collectObjects();
    }

    private collectObjects() {
        try { this.objects.collect(); }
        catch { console.error('Unable to reconcile archive source storage'); }
    }

    bindSnapshot(projectId: string, snapshotId: string) { return this.objects.bindSnapshot(projectId, snapshotId); }

    async reindex(id: string, languages: Set<IndexLanguage>, authorize: () => void, strategy?: IndexStrategy) {
        const { projectRoot, projectId } = this.find(id);
        this.validateSource(id, projectRoot);
        try {
            if (await realpath(projectRoot) !== projectRoot || !(await lstat(projectRoot)).isDirectory()) {
                throw new Error('INVALID_ASSET_SOURCE');
            }
        } catch { throw new HttpError(409, 'ASSET_SOURCE_UNAVAILABLE'); }
        const current = this.find(id);
        if (current.projectId !== projectId || current.projectRoot !== projectRoot) throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
        if (current.status === 'INDEXING') throw new HttpError(409, 'ASSET_INDEXING');
        authorize();
        const completion = this.index.start(projectRoot, languages, false, strategy);
        return { asset: this.find(id), completion };
    }

    private row(id: string) {
        if (!assetIdPattern.test(id)) throw new HttpError(404, 'ASSET_NOT_FOUND');
        const row = this.db.prepare(`
            SELECT a.*, s.status AS index_state, s.payload AS index_payload, n.display_name, n.revision
            FROM managed_asset a LEFT JOIN index_status s ON s.project_id = a.project_id
            LEFT JOIN managed_asset_name n ON n.asset_id = a.id
            WHERE a.id = ? AND a.project_id IS NOT NULL
        `).get(id);
        if (!row) throw new HttpError(404, 'ASSET_NOT_FOUND');
        return row;
    }

    find(id: string, authorize?: (projectId: string) => void) {
        const row = this.row(id);
        const projectId = String(row.project_id);
        if (!this.db.prepare(`SELECT 1 FROM managed_asset a WHERE a.id = ? AND ${availableProject('a.project_id')}`).get(id)) {
            throw new HttpError(404, 'ASSET_NOT_FOUND');
        }
        authorize?.(projectId);
        if (row.deleting) throw new HttpError(409, 'ASSET_DELETION_PENDING');
        const status = row.index_state === 'running' ? 'INDEXING'
            : row.index_state === 'done' || row.index_state === 'partial' ? 'READY' : 'FAILED';
        const index = row.index_payload ? JSON.parse(String(row.index_payload)) : {};
        const { status: _status, indexedAt, message, ...result } = index;
        const error = status === 'FAILED' ? (message ?? result.errors?.[0] ?? 'INDEX_FAILED') : '';
        return {
            assetId: id, projectId, originalFileName: String(row.filename), archiveType: String(row.archive_type),
            displayName: String(row.display_name ?? row.filename), revision: Number(row.revision ?? 0), sourceObject: this.objects.read(id) ?? null,
            projectRoot: String(row.source_root), status, error, createdAt: String(row.created_at),
            updatedAt: indexedAt ?? String(row.created_at),
            indexResult: typeof result.totalFiles === 'number' ? result : null,
            pollUrl: `/api/v1/assets/${id}`
        };
    }

    rename(id: string, displayName: string, revision: number, authorize: (projectId: string) => void) {
        return this.transaction(() => {
            const asset = this.find(id, authorize);
            if (asset.revision !== revision) throw new HttpError(409, 'ASSET_REVISION_CHANGED');
            this.db.prepare(`INSERT INTO managed_asset_name VALUES (?, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET display_name = excluded.display_name, revision = excluded.revision`)
                .run(id, displayName, revision + 1);
            return this.find(id);
        });
    }

    async profile(id: string, includes: string[], excludes: string[], authorize: (projectId: string) => void) {
        const asset = this.find(id, authorize);
        if (asset.status !== 'READY') throw new HttpError(409, 'ASSET_NOT_READY');
        const { projectId, projectRoot } = asset;
        this.validateSource(id, projectRoot);
        const inventory = await dependencyInventory(projectRoot);
        this.find(id, authorize);
        return assetProfile({ assetId: id, projectId, projectRoot }, this.manifest(id),
            includes, excludes, this.index.frameworks(projectId), inventory, this.index.vulnerabilityCounts(projectId));
    }

    manifest(id: string): ArchiveFile[] { return JSON.parse(String(this.row(id).manifest)); }

    forProject(projectId: string) {
        const row = this.db.prepare('SELECT id FROM managed_asset WHERE project_id = ?').get(projectId);
        return row ? String(row.id) : null;
    }

    async removeRetiredSource(id: string) {
        const row = this.db.prepare(`SELECT a.source_root, a.deleting, p.id AS liveProject FROM managed_asset a
            LEFT JOIN project p ON p.id = a.project_id WHERE a.id = ? AND a.project_id IS NOT NULL`).get(id);
        if (!row) return;
        this.validateSource(id, String(row.source_root));
        if (row.deleting !== 1 || row.liveProject || this.deletes.has(id)) throw new HttpError(409, 'ASSET_DELETION_PENDING');
        this.deletes.add(id);
        try {
            await this.removeSource(id);
            this.db.prepare('DELETE FROM managed_asset WHERE id = ?').run(id);
            this.collectObjects();
        } finally { this.deletes.delete(id); }
    }
}
