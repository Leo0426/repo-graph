import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from './http-error.js';

const DEBOUNCE_MS = 300;
const RECONCILE_MS = 30_000;

interface Registration { projectId: string; root: string }
interface Watch extends Registration {
    controller: AbortController;
    timer?: NodeJS.Timeout;
    native?: FSWatcher;
    inode?: string;
    job?: Promise<void>;
    requested: boolean;
}

export class IndexWatches {
    private readonly active = new Map<string, Watch>();
    private closing = false;

    constructor(private readonly db: DatabaseSync,
        private readonly reindex: (id: string, root: string, signal: AbortSignal) => Promise<unknown>,
        private readonly acceptsEvent: (root: string, filename: string) => boolean) {
        db.exec(`CREATE TABLE IF NOT EXISTS index_watch (
            project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE
        )`);
    }

    restore(permitted: (projectId: string, root: string) => boolean) {
        const registrations = this.db.prepare(`
            SELECT p.id AS projectId, p.root FROM index_watch w JOIN project p ON p.id = w.project_id ORDER BY p.id
        `).all();
        for (const { projectId, root } of registrations) {
            if (permitted(String(projectId), String(root))) this.attach(String(projectId), String(root));
        }
    }

    persist(projectId: string) {
        if (this.closing) throw new HttpError(503, 'INDEX_CLOSING');
        this.db.prepare('INSERT OR IGNORE INTO index_watch VALUES (?)').run(projectId);
    }

    attach(projectId: string, root: string) {
        if (this.active.has(projectId)) return;
        const entry: Watch = { projectId, root, controller: new AbortController(), requested: false };
        this.active.set(projectId, entry);
        this.schedule(entry, true);
    }

    list(allowed: readonly string[] | null) {
        const visible = allowed === null ? null : new Set(allowed);
        return [...this.active.values()].filter(entry => visible === null || visible.has(entry.projectId))
            .map(({ projectId, root }) => ({ projectId, root })).sort((a, b) => a.projectId.localeCompare(b.projectId));
    }

    has(id: string) { return this.active.has(id); }

    async stop(id: string) {
        this.db.prepare('DELETE FROM index_watch WHERE project_id = ?').run(id);
        await this.detach(id);
    }

    detach(id: string) {
        const entry = this.active.get(id);
        if (!entry) return;
        this.active.delete(id);
        entry.controller.abort();
        clearTimeout(entry.timer);
        entry.native?.close();
        return entry.job;
    }

    async close() {
        this.closing = true;
        await Promise.all([...this.active.keys()].map(id => this.detach(id)));
    }

    private schedule(entry: Watch, immediate: boolean) {
        if (entry.controller.signal.aborted) return;
        if (immediate && entry.requested) return;
        if (immediate) entry.requested = true;
        if (entry.job) return;
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
            entry.requested = false;
            entry.job = this.reconcile(entry).finally(() => {
                entry.job = undefined;
                const requested = entry.requested;
                entry.requested = false;
                this.schedule(entry, requested);
            });
        }, immediate ? DEBOUNCE_MS : RECONCILE_MS);
        entry.timer.unref();
    }

    private async reconcile(entry: Watch) {
        const signal = entry.controller.signal;
        try {
            const state = await lstat(entry.root, { bigint: true });
            if (!state.isDirectory() || await realpath(entry.root) !== entry.root || signal.aborted) {
                entry.native?.close();
                return;
            }
            const inode = `${state.dev}:${state.ino}`;
            if (entry.inode !== inode) {
                entry.native?.close();
                entry.native = undefined;
                entry.inode = undefined;
                try {
                    const handle = watch(entry.root, { recursive: true, persistent: false }, (_type, filename) => {
                        if (!filename || this.acceptsEvent(entry.root, filename)) this.schedule(entry, true);
                    });
                    handle.on('error', () => handle.close());
                    handle.on('close', () => {
                        if (entry.native !== handle) return;
                        entry.native = undefined;
                        entry.inode = undefined;
                    });
                    entry.native = handle;
                    entry.inode = inode;
                } catch {
                    // Periodic scans continue on filesystems without native recursive notifications.
                }
            }
            await this.reindex(entry.projectId, entry.root, signal);
        } catch (error) {
            if (['ENOENT', 'ENOTDIR'].includes(String((error as NodeJS.ErrnoException).code))) {
                entry.native?.close();
                return;
            }
            if (error instanceof HttpError && ['INDEX_ALREADY_RUNNING', 'INDEX_CAPACITY_EXHAUSTED'].includes(error.message)) {
                entry.requested = true;
            } else if (!(error instanceof HttpError)) {
                console.error('Unable to reconcile watched project');
            }
        }
    }
}
