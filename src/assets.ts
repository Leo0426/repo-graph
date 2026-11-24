import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { archiveLimits, extractArchive, receiveArchive } from './archive.js';
import type { ArchiveFile } from './archive.js';
import { assetProfile } from './asset-profile.js';
import { HttpError } from './http-error.js';
import { dependencyInventory } from './sbom.js';
import { sourceLanguages } from './source.js';
import type { IndexLanguage, IndexStrategy } from './source.js';

export const assetIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

interface AssetIndex {
    start: (root: string, languages: Set<IndexLanguage>, incremental: boolean, strategy?: IndexStrategy,
        register?: (projectId: string) => void) => Promise<unknown>;
    remove: (projectId: string, recordDeletion: () => void) => void;
    frameworks: (projectId: string) => Record<string, number>;
    vulnerabilityCounts: (projectId: string) => Record<string, number>;
}

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

    constructor(private readonly db: DatabaseSync, readonly root: string, private readonly index: AssetIndex) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS managed_asset (
                id TEXT PRIMARY KEY, project_id TEXT UNIQUE, source_root TEXT,
                filename TEXT, archive_type TEXT, manifest TEXT, created_at TEXT NOT NULL,
                deleting INTEGER NOT NULL DEFAULT 0
            );
        `);
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
        const staged = this.db.prepare('SELECT id, source_root FROM managed_asset WHERE project_id IS NULL').all();
        for (const row of staged) {
            try {
                if (!inside(this.directory(String(row.id)), String(row.source_root))) {
                    throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
                }
                await this.removeSource(String(row.id));
                this.db.prepare('DELETE FROM managed_asset WHERE id = ? AND project_id IS NULL').run(row.id);
            } catch { console.error('Unable to remove an interrupted archive upload'); }
        }
    }

    async importArchive(
        request: IncomingMessage, strategy: string | null, lang: string | null, includeBytecode: boolean,
        authorize: () => void, signal: AbortSignal
    ) {
        if (this.uploads >= 2) throw new HttpError(503, 'ASSET_UPLOAD_CAPACITY_EXHAUSTED');
        this.uploads++;
        const id = randomUUID();
        const directory = this.directory(id);
        const source = join(directory, 'source');
        const archived = join(directory, 'upload');
        const createdAt = new Date().toISOString();
        let recorded = false;
        let registered = false;
        try {
            this.db.prepare('INSERT INTO managed_asset(id, created_at, source_root) VALUES (?, ?, ?)').run(id, createdAt, source);
            recorded = true;
            if (await realpath(this.root) !== this.root) throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
            await mkdir(directory, { mode: 0o700 });
            const received = await receiveArchive(request, archived, this.limits.upload, signal);
            const selectedStrategy = indexStrategy(strategy ?? received.fields.strategy);
            const languages = indexLanguages(lang ?? received.fields.lang, includeBytecode);
            const packageContents = await extractArchive(archived, source, this.limits, signal);
            await rm(archived);
            const projectRoot = await realpath(packageContents.projectRoot);
            if (!inside(source, projectRoot)) throw new HttpError(409, 'ASSET_STORAGE_CHANGED');
            signal.throwIfAborted();
            authorize();
            this.index.start(projectRoot, languages, true, selectedStrategy, projectId => {
                this.db.prepare(`
                    UPDATE managed_asset SET project_id = ?, source_root = ?, filename = ?, archive_type = ?, manifest = ?
                    WHERE id = ?
                `).run(projectId, projectRoot, received.name, packageContents.archiveType,
                    JSON.stringify(packageContents.files), id);
            });
            registered = true;
            return this.find(id);
        } finally {
            this.uploads--;
            if (recorded && !registered) {
                try {
                    await this.removeSource(id);
                    this.db.prepare('DELETE FROM managed_asset WHERE id = ? AND project_id IS NULL').run(id);
                } catch { console.error('Unable to remove a failed archive upload'); }
            }
        }
    }

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
            SELECT a.*, s.status AS index_state, s.payload AS index_payload
            FROM managed_asset a LEFT JOIN index_status s ON s.project_id = a.project_id
            WHERE a.id = ? AND a.project_id IS NOT NULL
        `).get(id);
        if (!row) throw new HttpError(404, 'ASSET_NOT_FOUND');
        return row;
    }

    find(id: string, authorize?: (projectId: string) => void) {
        const row = this.row(id);
        const projectId = String(row.project_id);
        authorize?.(projectId);
        if (row.deleting) throw new HttpError(409, 'ASSET_DELETION_PENDING');
        const status = row.index_state === 'running' ? 'INDEXING'
            : row.index_state === 'done' || row.index_state === 'partial' ? 'READY' : 'FAILED';
        const index = row.index_payload ? JSON.parse(String(row.index_payload)) : {};
        const { status: _status, indexedAt, message, ...result } = index;
        const error = status === 'FAILED' ? (message ?? result.errors?.[0] ?? 'INDEX_FAILED') : '';
        return {
            assetId: id, projectId, originalFileName: String(row.filename), archiveType: String(row.archive_type),
            projectRoot: String(row.source_root), status, error, createdAt: String(row.created_at),
            updatedAt: indexedAt ?? String(row.created_at),
            indexResult: typeof result.totalFiles === 'number' ? result : null,
            pollUrl: `/api/v1/assets/${id}`
        };
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

    async delete(id: string, expectedRoot: string | null = null) {
        const row = this.row(id);
        this.validateSource(id, String(row.source_root));
        if (expectedRoot !== null && (!isAbsolute(expectedRoot) || resolve(expectedRoot) !== row.source_root)) {
            throw new HttpError(400, 'PROJECT_ROOT_MISMATCH');
        }
        if (row.index_state === 'running') throw new HttpError(409, 'ASSET_INDEXING');
        if (this.deletes.has(id)) throw new HttpError(409, 'ASSET_DELETION_PENDING');
        this.deletes.add(id);
        try {
            if (!row.deleting) {
                this.index.remove(String(row.project_id), () => {
                    this.db.prepare('UPDATE managed_asset SET deleting = 1 WHERE id = ?').run(id);
                });
            }
            await this.removeSource(id);
            this.db.prepare('DELETE FROM managed_asset WHERE id = ?').run(id);
        } finally { this.deletes.delete(id); }
    }
}
