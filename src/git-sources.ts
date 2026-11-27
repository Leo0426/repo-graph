import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { agentStep } from './agent-runs.js';
import type { AgentRun, AgentRuns } from './agent-runs.js';
import { nextCalendarOccurrence } from './calendar-schedule.js';
import type { CalendarSchedule } from './calendar-schedule.js';
import { DurableJobs } from './durable-jobs.js';
import type { JobAction } from './durable-jobs.js';
import { hostedGitCredential, resolveHostedGit, sameHostedUrl } from './git-hosted.js';
import type { HostedGitAdapter, HostedGitIdentity } from './git-hosted.js';
import { gitBranch, gitOrigins, gitRepositoryUrl, materializeGitCommit, removeGitBinding, resolveGitCommit } from './git-transport.js';
import type { GitCredential } from './git-transport.js';
import { HttpError } from './http-error.js';
import type { Account, IdentityDirectory } from './identity.js';
import { DispatcherHealth } from './operability.js';
import { availableProject } from './project-retirement.js';
import { ProviderSecrets } from './provider-secrets.js';
import { digest } from './source.js';

type Binding = { id: string; projectId: string; connectionId: string; branch: string; name: string; indexedCommit: string | null;
    indexedRunId: string | null };
type Connection = { id: string; name: string; url: string; origin: string; repositoryId: string;
    enabled: boolean; revision: number; credentialConfigured: boolean };
type ConnectionRow = Omit<Connection, 'enabled' | 'credentialConfigured'> & { enabled: number; credential: string };
type SyncInput = { bindingId: string; connectionId: string; connectionRevision: number; credentialVersion: number; commit: string;
    publishAfterSync?: boolean };
type SyncLease = NonNullable<ReturnType<DurableJobs<SyncInput>['claim']>>;
type Execution = NonNullable<ReturnType<DurableJobs<SyncInput>['get']>>;
type Automation = { projectId: string; revision: number; intervalMinutes: number | null; calendar: CalendarSchedule | null; eventEnabled: boolean;
    nextAt: number | null; actorId: string; credentialVersion: number; publishAfterSync: boolean };

export type GitOrigin = { type: 'GIT'; repositoryId: string; connectionId: string; branch: string; gitCommit: string; syncRunId: string };

const playbook = 'GIT_SYNC';
const leaseMs = 10_000;
const timeoutMs = 10 * 60_000;
const bindingColumns = `id, project_id AS projectId, connection_id AS connectionId, branch, name,
    indexed_commit AS indexedCommit, indexed_run_id AS indexedRunId`;
const connectionColumns = `id, name, url, origin, repository_id AS repositoryId, enabled, revision, credential`;

function publicConnection(row: ConnectionRow): Connection {
    const { enabled, credential, ...fields } = row;
    return { ...fields, enabled: enabled === 1, credentialConfigured: Boolean(credential) };
}

export class GitSources {
    private readonly origins = gitOrigins(process.env.REPOGRAPH_GIT_ORIGINS);
    private readonly queue: DurableJobs<SyncInput>;
    private readonly work = new Map<string, { projectId: string; cancel: AbortController; promise: Promise<void> }>();
    private readonly checking = new Set<Promise<unknown>>();
    private readonly automationTasks = new Map<string, Promise<unknown>>();
    private readonly shutdown = new AbortController();
    private timer: NodeJS.Timeout | undefined;
    private readonly dispatcher = new DispatcherHealth();
    private lastAutomationPoll = 0;
    private lastPublicationPoll = 0;
    private secrets: ProviderSecrets | undefined;

    constructor(private readonly db: DatabaseSync, private readonly root: string, private readonly keyPath: string | null,
        private readonly identity: IdentityDirectory, private readonly runs: AgentRuns,
        private readonly index: (root: string, logical: string, signal: AbortSignal, guard: () => void, fence: () => void) => Promise<{ status: string }>,
        private readonly publish: (projectId: string, projectName: string, actor: Account, key: string, verify: () => void) => { agentRunId: string }) {
        this.queue = new DurableJobs(db);
        db.exec(`
            CREATE TABLE IF NOT EXISTS git_connection (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, origin TEXT NOT NULL,
                repository_id TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
                revision INTEGER NOT NULL, credential TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS git_connection_identity (
                connection_id TEXT PRIMARY KEY REFERENCES git_connection(id) ON DELETE CASCADE,
                adapter TEXT NOT NULL CHECK(adapter IN ('GITHUB','GITLAB')),
                instance TEXT NOT NULL, upstream_id TEXT NOT NULL,
                UNIQUE(adapter, instance, upstream_id)
            );
            CREATE TABLE IF NOT EXISTS git_repository (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE REFERENCES project(id) ON DELETE CASCADE,
                connection_id TEXT NOT NULL REFERENCES git_connection(id), branch TEXT NOT NULL, name TEXT NOT NULL,
                indexed_commit TEXT, indexed_run_id TEXT,
                UNIQUE(connection_id, branch)
            );
            CREATE TABLE IF NOT EXISTS git_sync (
                run_id TEXT PRIMARY KEY REFERENCES agent_run(id) ON DELETE CASCADE,
                binding_id TEXT NOT NULL REFERENCES git_repository(id) ON DELETE CASCADE, git_commit TEXT NOT NULL,
                connection_revision INTEGER NOT NULL, publish_after_sync INTEGER NOT NULL DEFAULT 0 CHECK(publish_after_sync IN (0,1))
            );
            CREATE INDEX IF NOT EXISTS git_sync_binding_commit ON git_sync(binding_id, git_commit);
            CREATE TABLE IF NOT EXISTS git_event_secret (
                connection_id TEXT PRIMARY KEY REFERENCES git_connection(id) ON DELETE CASCADE, encrypted TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS git_automation (
                project_id TEXT PRIMARY KEY REFERENCES git_repository(project_id) ON DELETE CASCADE,
                revision INTEGER NOT NULL, interval_minutes INTEGER, next_at INTEGER,
                event_enabled INTEGER NOT NULL CHECK(event_enabled IN (0,1)), actor_id TEXT NOT NULL,
                credential_version INTEGER NOT NULL, publish_after_sync INTEGER NOT NULL DEFAULT 0 CHECK(publish_after_sync IN (0,1)),
                calendar_json TEXT
            );
            CREATE INDEX IF NOT EXISTS git_automation_due ON git_automation(next_at);
            CREATE TABLE IF NOT EXISTS git_publication (
                sync_run_id TEXT PRIMARY KEY REFERENCES git_sync(run_id) ON DELETE CASCADE,
                state TEXT NOT NULL CHECK(state IN ('PENDING','SUBMITTED','FAILED')), actor_id TEXT NOT NULL,
                credential_version INTEGER NOT NULL, wiki_run_id TEXT REFERENCES agent_run(id) ON DELETE SET NULL, reason TEXT
            );
            CREATE INDEX IF NOT EXISTS git_publication_state ON git_publication(state);
        `);
        if (!db.prepare("SELECT 1 FROM pragma_table_info('git_automation') WHERE name = 'publish_after_sync'").get()) {
            db.exec('ALTER TABLE git_automation ADD COLUMN publish_after_sync INTEGER NOT NULL DEFAULT 0 CHECK(publish_after_sync IN (0,1))');
        }
        if (!db.prepare("SELECT 1 FROM pragma_table_info('git_automation') WHERE name = 'calendar_json'").get()) {
            db.exec('ALTER TABLE git_automation ADD COLUMN calendar_json TEXT');
        }
        if (!db.prepare("SELECT 1 FROM pragma_table_info('git_sync') WHERE name = 'publish_after_sync'").get()) {
            db.exec('ALTER TABLE git_sync ADD COLUMN publish_after_sync INTEGER NOT NULL DEFAULT 0 CHECK(publish_after_sync IN (0,1))');
        }
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

    private requireAdmin(actor: Account) {
        if (this.identity.requireCurrent(actor).role !== 'ADMIN') throw new HttpError(403, 'ACCESS_DENIED');
    }

    private vault() {
        const required = !!this.db.prepare(`SELECT 1 FROM git_connection WHERE credential <> ''
            UNION ALL SELECT 1 FROM git_event_secret LIMIT 1`).get();
        return this.secrets ??= new ProviderSecrets(this.keyPath, process.env.REPOGRAPH_GIT_ENCRYPTION_KEY, required);
    }

    private connection(id: string) {
        const row = this.db.prepare(`SELECT ${connectionColumns} FROM git_connection WHERE id = ?`).get(id);
        if (!row) throw new HttpError(404, 'GIT_CONNECTION_NOT_FOUND');
        return row as unknown as ConnectionRow;
    }

    private binding(id: string) {
        return this.db.prepare(`SELECT ${bindingColumns} FROM git_repository WHERE project_id = ?`).get(id) as unknown as Binding | undefined;
    }

    private requireBinding(id: string) {
        const binding = this.binding(id);
        if (!binding) throw new HttpError(404, 'GIT_REPOSITORY_NOT_FOUND');
        return binding;
    }

    private credential(row: ConnectionRow) {
        if (!row.credential) return undefined;
        return JSON.parse(this.vault().decrypt(JSON.stringify([row.id, row.url]), row.credential)) as GitCredential;
    }

    private remote(row: ConnectionRow) {
        if (!row.enabled) throw new HttpError(409, 'GIT_CONNECTION_DISABLED');
        gitRepositoryUrl(row.url, this.origins);
        return row.url;
    }

    listConnections(actor: Account) {
        this.requireAdmin(actor);
        return (this.db.prepare(`SELECT ${connectionColumns} FROM git_connection ORDER BY name, id`).all() as unknown as ConnectionRow[])
            .map(row => this.connectionView(row));
    }

    getConnection(actor: Account, id: string) {
        this.requireAdmin(actor);
        return this.connectionView(this.connection(id));
    }

    private connectionView(row: ConnectionRow) {
        const enabled = !!this.db.prepare('SELECT 1 FROM git_event_secret WHERE connection_id = ?').get(row.id);
        return { ...publicConnection(row), eventSecretConfigured: enabled, hostedIdentity: this.hostedIdentity(row.id) ?? null };
    }

    private hostedIdentity(id: string) {
        return this.db.prepare(`SELECT adapter, instance, upstream_id AS upstreamId FROM git_connection_identity
            WHERE connection_id = ?`).get(id) as HostedGitIdentity | undefined;
    }

    private ensureConnectionUnique(url: string, hosted?: HostedGitIdentity, excludeId?: string) {
        const byUrl = this.db.prepare('SELECT id FROM git_connection WHERE url = ?').get(url);
        if (byUrl && byUrl.id !== excludeId) throw new HttpError(409, 'GIT_CONNECTION_EXISTS');
        if (!hosted) return;
        const byIdentity = this.db.prepare(`SELECT connection_id AS id FROM git_connection_identity
            WHERE adapter = ? AND instance = ? AND upstream_id = ?`).get(hosted.adapter, hosted.instance, hosted.upstreamId);
        if (byIdentity && byIdentity.id !== excludeId) throw new HttpError(409, 'GIT_HOSTED_REPOSITORY_EXISTS');
    }

    private storeHostedIdentity(id: string, identity: HostedGitIdentity) {
        this.db.prepare('INSERT INTO git_connection_identity VALUES (?, ?, ?, ?)')
            .run(id, identity.adapter, identity.instance, identity.upstreamId);
    }

    async createConnection(actor: Account, input: { name: string; url: string; adapter?: HostedGitAdapter; credential?: GitCredential },
        signal?: AbortSignal) {
        this.requireAdmin(actor);
        const remote = gitRepositoryUrl(input.url, this.origins);
        const { adapter, credential: suppliedCredential } = input;
        const hosted = adapter && await this.checkRemote(active => resolveHostedGit(adapter, remote, suppliedCredential, active), signal);
        const url = hosted?.url ?? remote.url;
        return this.transaction(() => {
            signal?.throwIfAborted();
            this.requireAdmin(actor);
            this.ensureConnectionUnique(url, hosted?.identity);
            const id = randomUUID();
            const repositoryId = digest(JSON.stringify(hosted
                ? [hosted.identity.adapter, hosted.identity.instance, hosted.identity.upstreamId] : [remote.origin, remote.path]));
            const credential = suppliedCredential ? this.vault().encrypt(JSON.stringify([id, url]), JSON.stringify(suppliedCredential)) : '';
            this.db.prepare('INSERT INTO git_connection VALUES (?, ?, ?, ?, ?, 1, 0, ?)')
                .run(id, input.name, url, remote.origin, repositoryId, credential);
            if (hosted) this.storeHostedIdentity(id, hosted.identity);
            this.identity.record(actor.id, 'GIT_CONNECTION_CREATED', id, '');
            return this.connectionView(this.connection(id));
        });
    }

    async reconnect(actor: Account, id: string, input: { revision: number; url: string; adapter?: HostedGitAdapter;
        enabled?: boolean; credential?: GitCredential | null }, signal?: AbortSignal) {
        this.requireAdmin(actor);
        const row = this.connection(id);
        if (row.revision !== input.revision) throw new HttpError(409, 'GIT_CONNECTION_CHANGED');
        const previous = this.hostedIdentity(id);
        const adapter = previous?.adapter ?? input.adapter;
        if (!adapter) throw new HttpError(409, 'GIT_HOSTED_ADAPTER_REQUIRED');
        if (previous && input.adapter && input.adapter !== previous.adapter) throw new HttpError(409, 'GIT_HOSTED_ADAPTER_CHANGED');
        const target = gitRepositoryUrl(input.url, this.origins);
        if (target.origin !== row.origin) throw new HttpError(409, 'GIT_HOSTED_INSTANCE_CHANGED');
        if (!previous && !sameHostedUrl(adapter, gitRepositoryUrl(row.url, this.origins), target)) {
            throw new HttpError(409, 'GIT_HOSTED_VERIFICATION_REQUIRED');
        }
        const credential = input.credential === undefined ? this.credential(row) : input.credential ?? undefined;
        const proof = await this.checkRemote(active => resolveHostedGit(adapter, target, credential, active), signal);
        if (previous && proof.identity.upstreamId !== previous.upstreamId) throw new HttpError(409, 'GIT_REPOSITORY_IDENTITY_CHANGED');
        return this.transaction(() => {
            signal?.throwIfAborted();
            this.requireAdmin(actor);
            if (this.connection(id).revision !== input.revision) throw new HttpError(409, 'GIT_CONNECTION_CHANGED');
            const enabled = Number(input.enabled ?? Boolean(row.enabled));
            if (previous && proof.url === row.url && enabled === row.enabled && input.credential === undefined) return this.connectionView(row);
            this.ensureConnectionUnique(proof.url, proof.identity, id);
            const encrypted = credential ? this.vault().encrypt(JSON.stringify([id, proof.url]), JSON.stringify(credential)) : '';
            this.db.prepare('UPDATE git_connection SET url = ?, enabled = ?, credential = ?, revision = revision + 1 WHERE id = ?')
                .run(proof.url, enabled, encrypted, id);
            if (proof.url !== row.url) {
                const saved = this.db.prepare('SELECT encrypted FROM git_event_secret WHERE connection_id = ?').get(id);
                if (saved) {
                    const secret = this.vault().decrypt(JSON.stringify([id, row.url, 'event']), String(saved.encrypted));
                    this.db.prepare('UPDATE git_event_secret SET encrypted = ? WHERE connection_id = ?')
                        .run(this.vault().encrypt(JSON.stringify([id, proof.url, 'event']), secret), id);
                }
            }
            if (!previous) this.storeHostedIdentity(id, proof.identity);
            this.identity.record(actor.id, previous ? 'GIT_CONNECTION_RECONNECTED' : 'GIT_CONNECTION_IDENTITY_VERIFIED', id, '');
            if (input.credential !== undefined) this.identity.record(actor.id, 'GIT_CONNECTION_CREDENTIAL_CHANGED', id, '');
            if (enabled !== row.enabled) this.identity.record(actor.id, enabled ? 'GIT_CONNECTION_ENABLED' : 'GIT_CONNECTION_DISABLED', id, '');
            return this.connectionView(this.connection(id));
        });
    }

    async updateConnection(actor: Account, id: string, input: { revision: number; enabled?: boolean; credential?: GitCredential | null;
        eventSecret?: string | null }, signal?: AbortSignal) {
        this.requireAdmin(actor);
        const before = this.connection(id);
        if (before.revision !== input.revision) throw new HttpError(409, 'GIT_CONNECTION_CHANGED');
        const hosted = !before.enabled && input.enabled ? this.hostedIdentity(id) : undefined;
        if (hosted) {
            const credential = input.credential === undefined ? this.credential(before) : input.credential ?? undefined;
            await this.checkRemote(active => this.verifyHostedIdentity(before, hosted, credential, active), signal);
        }
        return this.transaction(() => {
            signal?.throwIfAborted();
            this.requireAdmin(actor);
            const row = this.connection(id);
            if (row.revision !== input.revision) throw new HttpError(409, 'GIT_CONNECTION_CHANGED');
            let encrypted = row.credential;
            if (input.credential !== undefined) encrypted = input.credential ? this.vault()
                .encrypt(JSON.stringify([id, row.url]), JSON.stringify(input.credential)) : '';
            const enabled = input.enabled ?? (row.enabled === 1);
            this.db.prepare('UPDATE git_connection SET enabled = ?, credential = ?, revision = revision + 1 WHERE id = ?')
                .run(Number(enabled), encrypted, id);
            if (input.credential !== undefined) this.identity.record(actor.id, 'GIT_CONNECTION_CREDENTIAL_CHANGED', id, '');
            if (input.eventSecret !== undefined) {
                if (input.eventSecret) {
                    const secret = this.vault().encrypt(JSON.stringify([id, row.url, 'event']), input.eventSecret);
                    this.db.prepare(`INSERT INTO git_event_secret VALUES (?, ?) ON CONFLICT(connection_id) DO UPDATE SET encrypted = excluded.encrypted`)
                        .run(id, secret);
                } else this.db.prepare('DELETE FROM git_event_secret WHERE connection_id = ?').run(id);
                this.identity.record(actor.id, 'GIT_EVENT_SECRET_CHANGED', id, '');
            }
            if (Number(enabled) !== row.enabled) this.identity.record(actor.id, enabled ? 'GIT_CONNECTION_ENABLED' : 'GIT_CONNECTION_DISABLED', id, '');
            return this.connectionView(this.connection(id));
        });
    }

    disconnect(actor: Account, id: string, revision: number) {
        return this.transaction(() => {
            this.requireAdmin(actor);
            const row = this.connection(id);
            if (row.revision !== revision) throw new HttpError(409, 'GIT_CONNECTION_CHANGED');
            const event = this.db.prepare('DELETE FROM git_event_secret WHERE connection_id = ?').run(id);
            if (row.enabled || row.credential || event.changes) {
                this.db.prepare("UPDATE git_connection SET enabled = 0, credential = '', revision = revision + 1 WHERE id = ?").run(id);
                this.identity.record(actor.id, 'GIT_CONNECTION_DISCONNECTED', id, '');
            }
            return this.connectionView(this.connection(id));
        });
    }

    private async checkRemote<T>(lookupRemote: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) {
        const active = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(90_000), ...(signal ? [signal] : [])]);
        if (this.checking.size >= 12) throw new HttpError(503, 'GIT_LOOKUP_CAPACITY_EXHAUSTED');
        const lookup = lookupRemote(active);
        this.checking.add(lookup);
        try { return await lookup; }
        catch (error) {
            if (active.aborted && !signal?.aborted) throw new HttpError(504, 'GIT_REMOTE_REQUEST_TIMED_OUT');
            throw error;
        } finally { this.checking.delete(lookup); }
    }

    private async verifyHostedIdentity(connection: ConnectionRow, expected: HostedGitIdentity, credential: GitCredential | undefined,
        signal: AbortSignal) {
        const remote = gitRepositoryUrl(connection.url, this.origins);
        if (remote.origin !== expected.instance) throw new HttpError(409, 'GIT_HOSTED_INSTANCE_CHANGED');
        const proof = await resolveHostedGit(expected.adapter, remote, credential, signal);
        if (proof.identity.upstreamId !== expected.upstreamId) throw new HttpError(409, 'GIT_REPOSITORY_IDENTITY_CHANGED');
    }

    private resolveCommit(connection: ConnectionRow, branch: string, signal?: AbortSignal) {
        const remote = this.remote(connection);
        const hosted = this.hostedIdentity(connection.id);
        const credential = this.credential(connection);
        return this.checkRemote(async active => {
            if (hosted) {
                await this.verifyHostedIdentity(connection, hosted, credential, active);
                this.requireConnectionRevision(connection.id, connection.revision);
            }
            return resolveGitCommit(remote, branch, active, hostedGitCredential(hosted, credential));
        }, signal);
    }

    async testConnection(actor: Account, id: string, branch: string, signal?: AbortSignal) {
        this.requireAdmin(actor);
        const connection = this.connection(id);
        const commit = await this.resolveCommit(connection, branch, signal);
        this.requireAdmin(actor);
        this.requireConnectionRevision(id, connection.revision);
        return { commit };
    }

    createBinding(actor: Account, id: string, name: string | undefined, tracking: string) {
        return this.transaction(() => {
            this.requireAdmin(actor);
            const connection = this.connection(id);
            this.remote(connection);
            const branch = gitBranch(tracking);
            const prior = this.db.prepare('SELECT project_id AS id FROM git_repository WHERE connection_id = ? AND branch = ?').get(id, branch);
            if (prior) return this.details(actor, String(prior.id));
            const bindingId = randomUUID();
            const logical = this.logicalRoot(bindingId);
            const projectId = digest(logical).slice(0, 12);
            this.db.prepare('INSERT INTO project(id, root) VALUES (?, ?)').run(projectId, logical);
            this.identity.claimCreatedProject(actor.id, projectId);
            this.db.prepare(`INSERT INTO git_repository(id, project_id, connection_id, branch, name) VALUES (?, ?, ?, ?, ?)`)
                .run(bindingId, projectId, id, branch, name ?? connection.name);
            this.identity.record(actor.id, 'GIT_REPOSITORY_CONNECTED', projectId, id);
            return this.details(actor, projectId);
        });
    }

    private logicalRoot(id: string) { return join(this.root, id); }

    removeRetiredBinding(id: string) { return removeGitBinding(this.root, id); }

    activeProject(id: string) { return Array.from(this.work.values()).some(item => item.projectId === id); }

    details(actor: Account, id: string) {
        const capabilities = this.identity.projectCapabilities(actor, id);
        const binding = this.requireBinding(id);
        const connection = this.connection(binding.connectionId);
        const latest = this.db.prepare(`SELECT g.run_id AS runId, g.git_commit AS "commit", r.status, d.revision,
            json_extract(r.payload, '$.statusReason') AS reason, p.state AS publicationStatus, p.reason AS publicationReason,
            p.wiki_run_id AS wikiRunId, w.status AS wikiStatus
            FROM git_sync g JOIN agent_run r ON r.id = g.run_id JOIN durable_job d ON d.id = g.run_id
            LEFT JOIN git_publication p ON p.sync_run_id = g.run_id LEFT JOIN agent_run w ON w.id = p.wiki_run_id
            WHERE g.binding_id = ? ORDER BY g.rowid DESC LIMIT 1`).get(binding.id);
        const automation = this.automation(id);
        return { ...binding, ...capabilities, repositoryId: connection.repositoryId, url: connection.url, enabled: connection.enabled === 1,
            latestSync: latest as unknown as { runId: string; commit: string; status: AgentRun['status']; revision: number; reason: string | null;
                publicationStatus: 'PENDING' | 'SUBMITTED' | 'FAILED' | null; publicationReason: string | null;
                wikiRunId: string | null; wikiStatus: AgentRun['status'] | null } | undefined ?? null,
            automation: { revision: automation?.revision ?? 0, intervalMinutes: automation?.intervalMinutes ?? null,
                calendar: automation?.calendar ?? null,
                eventEnabled: automation?.eventEnabled ?? false, nextAt: automation?.nextAt ?? null,
                publishAfterSync: automation?.publishAfterSync ?? false } };
    }

    name(id: string) { return this.binding(id)?.name; }

    location(id: string) {
        const binding = this.binding(id);
        if (!binding) return undefined;
        if (!binding.indexedCommit) throw new HttpError(409, 'GIT_SOURCE_NOT_INDEXED');
        return join(this.logicalRoot(binding.id), binding.indexedCommit, 'tree');
    }

    origin(id: string): GitOrigin | undefined {
        const binding = this.binding(id);
        if (!binding) return undefined;
        if (!binding.indexedCommit || !binding.indexedRunId) throw new HttpError(409, 'GIT_SOURCE_NOT_INDEXED');
        const index = this.db.prepare('SELECT status FROM index_status WHERE project_id = ?').get(id);
        const process = this.db.prepare(`SELECT r.status FROM git_sync s JOIN agent_run r ON r.id = s.run_id
            WHERE s.binding_id = ? ORDER BY s.rowid DESC LIMIT 1`).get(binding.id);
        if (index?.status !== 'done' || process?.status !== 'COMPLETED') throw new HttpError(409, 'GIT_SOURCE_INDEX_NOT_READY');
        const connection = this.connection(binding.connectionId);
        return { type: 'GIT', repositoryId: connection.repositoryId, connectionId: connection.id, branch: binding.branch,
            gitCommit: binding.indexedCommit, syncRunId: binding.indexedRunId };
    }

    async sync(actor: Account, id: string, signal?: AbortSignal, request?: { commit?: string; connectionRevision?: number;
        automationRevision: number; trigger: 'event' | 'schedule' }) {
        this.identity.requireProjectEditor(actor, id);
        const binding = this.requireBinding(id);
        const connection = this.connection(binding.connectionId);
        if (request?.connectionRevision !== undefined) this.requireConnectionRevision(connection.id, request.connectionRevision);
        const commit = await this.resolveCommit(connection, binding.branch, signal);
        signal?.throwIfAborted();
        if (request?.commit && commit !== request.commit) throw new HttpError(409, 'GIT_EVENT_REF_CHANGED');
        return this.admit(actor, binding, connection.revision, commit, undefined, request);
    }

    retry(actor: Account, id: string, runId: string) {
        this.identity.requireProjectEditor(actor, id);
        const binding = this.requireBinding(id);
        const old = this.db.prepare(`SELECT g.git_commit, g.connection_revision, g.publish_after_sync, d.state FROM git_sync g
            JOIN durable_job d ON d.id = g.run_id
            WHERE g.run_id = ? AND g.binding_id = ?`).get(runId, binding.id);
        if (!old) throw new HttpError(404, 'GIT_SYNC_NOT_FOUND');
        if (!['FAILED', 'CANCELLED'].includes(String(old.state))) throw new HttpError(409, 'GIT_SYNC_RETRY_UNAVAILABLE');
        return this.admit(actor, binding, Number(old.connection_revision), String(old.git_commit), { runId, publishAfterSync: !!old.publish_after_sync });
    }

    private admit(actor: Account, binding: Binding, revision: number, commit: string, retryFrom?: { runId: string; publishAfterSync: boolean },
        trigger?: { automationRevision: number; trigger: 'event' | 'schedule' }) {
        const id = binding.projectId;
        const result = this.transaction(() => {
            this.identity.requireProjectEditor(actor, id);
            if (this.requireBinding(id).id !== binding.id) throw new HttpError(409, 'GIT_REPOSITORY_CHANGED');
            if (trigger) {
                const current = this.automation(id);
                if (current?.revision !== trigger.automationRevision || (trigger.trigger === 'event' ? !current.eventEnabled
                    : !current.intervalMinutes && !current.calendar)) {
                    throw new HttpError(409, 'GIT_AUTOMATION_CHANGED');
                }
            }
            const connection = this.requireConnectionRevision(binding.connectionId, revision);
            const publishAfterSync = retryFrom?.publishAfterSync ?? this.automation(id)?.publishAfterSync ?? false;
            const previous = this.db.prepare(`SELECT g.run_id AS id FROM git_sync g
                WHERE g.binding_id = ? AND g.git_commit = ? AND g.connection_revision = ? AND g.publish_after_sync = ?
                ORDER BY g.rowid DESC LIMIT 1`).get(binding.id, commit, revision, Number(publishAfterSync));
            if (previous && previous.id !== retryFrom?.runId) {
                return { runId: String(previous.id), commit, reused: true };
            }
            if (this.queue.hasActive(playbook, id)) throw new HttpError(409, 'GIT_SYNC_IN_PROGRESS');
            if (this.db.prepare(`SELECT 1 FROM git_publication p JOIN git_sync s ON s.run_id = p.sync_run_id
                WHERE s.binding_id = ? AND p.state = 'PENDING'`).get(binding.id)) throw new HttpError(409, 'GIT_WIKI_SUBMISSION_PENDING');
            if (this.queue.pending(playbook) >= 40) throw new HttpError(503, 'GIT_SYNC_CAPACITY_EXHAUSTED');
            const run = this.runs.create(id, playbook, 'git:' + binding.id + ':' + commit, null, retryFrom?.runId);
            this.db.prepare('INSERT INTO git_sync VALUES (?, ?, ?, ?, ?)').run(run.id, binding.id, commit, revision, Number(publishAfterSync));
            this.queue.enqueue({ id: run.id, kind: playbook, projectId: id, actorId: actor.id, fingerprint: commit, input: {
                bindingId: binding.id, connectionId: connection.id, connectionRevision: connection.revision, credentialVersion: actor.credentialVersion,
                commit, publishAfterSync }, availableAt: Date.now(), budgetMs: timeoutMs });
            return { runId: run.id, commit, reused: false };
        });
        this.dispatch();
        return result;
    }

    private requireConnectionRevision(id: string, revision: number) {
        const connection = this.connection(id);
        this.remote(connection);
        if (connection.revision !== revision) throw new HttpError(409, 'GIT_CONNECTION_CHANGED');
        return connection;
    }

    private automation(id: string) {
        const row = this.db.prepare(`SELECT project_id AS projectId, revision, interval_minutes AS intervalMinutes,
            event_enabled AS eventEnabled, next_at AS nextAt, actor_id AS actorId, credential_version AS credentialVersion,
            publish_after_sync AS publishAfterSync, calendar_json AS calendarJson
            FROM git_automation WHERE project_id = ?`).get(id);
        if (!row) return undefined;
        const { calendarJson, ...rest } = row;
        return { ...rest, calendar: calendarJson ? JSON.parse(String(calendarJson)) : null,
            eventEnabled: Boolean(row.eventEnabled), publishAfterSync: Boolean(row.publishAfterSync) } as unknown as Automation;
    }

    configureAutomation(actor: Account, id: string, input: { revision: number; intervalMinutes: number | null; calendar?: CalendarSchedule | null; eventEnabled: boolean;
        publishAfterSync?: boolean }) {
        return this.transaction(() => {
            this.identity.requireProjectManager(actor, id);
            const binding = this.requireBinding(id);
            const previous = this.automation(id);
            if ((previous?.revision ?? 0) !== input.revision) throw new HttpError(409, 'GIT_AUTOMATION_CHANGED');
            if (input.eventEnabled && !this.connectionView(this.connection(binding.connectionId)).eventSecretConfigured) {
                throw new HttpError(409, 'GIT_EVENT_SECRET_REQUIRED');
            }
            const now = Date.now();
            const provided = input.calendar ?? null;
            const calendar = provided ? { ...provided, weekdays: [...provided.weekdays].sort() }
                : input.calendar === undefined && input.intervalMinutes === null ? previous?.calendar ?? null : null;
            const nextAt = calendar ? JSON.stringify(calendar) === JSON.stringify(previous?.calendar) && previous?.nextAt
                ? previous.nextAt : nextCalendarOccurrence(calendar, now) : input.intervalMinutes ? now : null;
            this.db.prepare(`INSERT INTO git_automation(project_id, revision, interval_minutes, next_at, event_enabled, actor_id,
                credential_version, publish_after_sync, calendar_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id) DO UPDATE SET revision = excluded.revision, interval_minutes = excluded.interval_minutes,
                    next_at = excluded.next_at, event_enabled = excluded.event_enabled, actor_id = excluded.actor_id,
                    credential_version = excluded.credential_version, publish_after_sync = excluded.publish_after_sync, calendar_json = excluded.calendar_json`)
                .run(id, input.revision + 1, input.intervalMinutes, nextAt, Number(input.eventEnabled), actor.id, actor.credentialVersion,
                    Number(input.publishAfterSync ?? previous?.publishAfterSync ?? false), calendar ? JSON.stringify(calendar) : null);
            this.identity.record(actor.id, 'GIT_AUTOMATION_UPDATED', id, '');
            return this.details(actor, id).automation;
        });
    }

    verifyEvent(connectionId: string, signature: string | undefined, body: Uint8Array) {
        const match = signature && /^sha256=([a-f0-9]{64})$/.exec(signature);
        let connection: ConnectionRow;
        try { connection = this.connection(connectionId); }
        catch { throw new HttpError(401, 'INVALID_GIT_EVENT_SIGNATURE'); }
        const stored = this.db.prepare('SELECT encrypted FROM git_event_secret WHERE connection_id = ?').get(connectionId);
        if (!match || !stored) throw new HttpError(401, 'INVALID_GIT_EVENT_SIGNATURE');
        const secret = this.vault().decrypt(JSON.stringify([connectionId, connection.url, 'event']), String(stored.encrypted));
        const expected = createHmac('sha256', secret).update(body).digest();
        if (!timingSafeEqual(expected, Buffer.from(match[1], 'hex'))) throw new HttpError(401, 'INVALID_GIT_EVENT_SIGNATURE');
        this.remote(connection);
        return connection.revision;
    }

    async event(connectionId: string, revision: number, input: { url: string; ref: string; commit: string; timestamp: string }, signal?: AbortSignal) {
        const connection = this.requireConnectionRevision(connectionId, revision);
        const eventTime = Date.parse(input.timestamp);
        if (!Number.isFinite(eventTime) || Math.abs(Date.now() - eventTime) > 5 * 60_000) throw new HttpError(409, 'GIT_EVENT_EXPIRED');
        const remote = gitRepositoryUrl(input.url, this.origins);
        const hosted = this.hostedIdentity(connectionId);
        if (hosted ? !sameHostedUrl(hosted.adapter, remote, gitRepositoryUrl(connection.url, this.origins)) : remote.url !== connection.url) {
            throw new HttpError(403, 'GIT_EVENT_REPOSITORY_MISMATCH');
        }
        if (!input.ref.startsWith('refs/heads/')) throw new HttpError(400, 'INVALID_GIT_BRANCH');
        const branch = gitBranch(input.ref.slice('refs/heads/'.length));
        const binding = this.db.prepare('SELECT project_id FROM git_repository WHERE connection_id = ? AND branch = ?').get(connectionId, branch);
        const id = binding && String(binding.project_id);
        const config = id && this.automation(id);
        if (!config || !config.eventEnabled) throw new HttpError(404, 'GIT_EVENT_BINDING_NOT_FOUND');
        const actor = this.identity.requireCurrent({ id: config.actorId, credentialVersion: config.credentialVersion });
        return this.sync(actor, config.projectId, signal, { commit: input.commit, connectionRevision: revision,
            automationRevision: config.revision, trigger: 'event' });
    }

    private pollAutomation() {
        const now = Date.now();
        if (now - this.lastAutomationPoll < 1_000 || this.automationTasks.size >= 4) return;
        this.lastAutomationPoll = now;
        const due = this.db.prepare(`SELECT a.project_id AS projectId FROM git_automation a
            JOIN git_repository r ON r.project_id = a.project_id JOIN git_connection c ON c.id = r.connection_id
            WHERE c.enabled = 1 AND a.next_at <= ? AND (a.interval_minutes IS NOT NULL OR a.calendar_json IS NOT NULL)
                AND ${availableProject('a.project_id')}
            ORDER BY a.next_at, a.project_id LIMIT ?`).all(now, 4 - this.automationTasks.size);
        for (const row of due) {
            const id = String(row.projectId);
            if (this.automationTasks.has(id)) continue;
            const config = this.automation(id);
            if (!config || config.nextAt === null || config.nextAt > now) continue;
            const next = config.calendar ? nextCalendarOccurrence(config.calendar, now) : now + config.intervalMinutes! * 60_000;
            const reserved = this.db.prepare(`UPDATE git_automation SET next_at = ? WHERE project_id = ? AND revision = ? AND next_at = ?`)
                .run(next, id, config.revision, config.nextAt).changes;
            if (!reserved) continue;
            const job = Promise.resolve().then(() => {
                const actor = this.identity.requireCurrent({ id: config.actorId, credentialVersion: config.credentialVersion });
                return this.sync(actor, id, this.shutdown.signal, { automationRevision: config.revision, trigger: 'schedule' });
            }).catch(() => undefined).finally(() => this.automationTasks.delete(id));
            this.automationTasks.set(id, job);
        }
    }

    private pollPublication() {
        const now = Date.now();
        if (now - this.lastPublicationPoll < 1_000) return;
        this.lastPublicationPoll = now;
        const pending = this.db.prepare(`SELECT p.sync_run_id AS id, p.actor_id AS actorId, p.credential_version AS credentialVersion,
            r.project_id AS projectId, r.name,
            r.connection_id AS connectionId, s.connection_revision AS revision
            FROM git_publication p JOIN git_sync s ON s.run_id = p.sync_run_id JOIN git_repository r ON r.id = s.binding_id
            WHERE p.state = 'PENDING' AND ${availableProject('r.project_id')} ORDER BY p.rowid LIMIT 16`).all();
        const record = this.db.prepare(`UPDATE git_publication SET state = ?, wiki_run_id = ?, reason = ?
            WHERE sync_run_id = ? AND state = 'PENDING'`);
        const transient = new Set(['WIKI_ALREADY_RUNNING', 'WIKI_QUEUE_FULL', 'WIKI_INDEX_RUNNING']);
        for (const job of pending) {
            try {
                const actor = this.identity.requireCurrent({ id: String(job.actorId), credentialVersion: Number(job.credentialVersion) });
                const projectId = String(job.projectId);
                const verify = () => {
                    this.requireConnectionRevision(String(job.connectionId), Number(job.revision));
                    if (this.requireBinding(projectId).indexedRunId !== job.id) throw new HttpError(409, 'GIT_PUBLICATION_SOURCE_CHANGED');
                };
                const wiki = this.publish(projectId, String(job.name), actor, 'git-sync:' + job.id, verify);
                record.run('SUBMITTED', wiki.agentRunId, null, job.id);
            } catch (error) {
                if (error instanceof HttpError && transient.has(error.message)) continue;
                const reason = error instanceof HttpError ? error.message : 'GIT_PUBLICATION_FAILED';
                record.run('FAILED', null, reason, job.id);
            }
        }
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => this.dispatch(), 250).unref();
        this.dispatch();
    }

    workerHealth() { return this.dispatcher.status(!!this.timer && !this.shutdown.signal.aborted); }

    private dispatch() {
        if (this.shutdown.signal.aborted) return;
        try {
            this.transaction(() => {
                for (const job of this.queue.reconcile(playbook)) this.syncQueueState(job, 'GIT_SYNC_INTERRUPTED');
            });
            this.pollPublication();
            this.pollAutomation();
            const lease = this.work.size ? undefined : this.queue.claim(playbook, 1, leaseMs);
            this.dispatcher.observe(true);
            if (!lease) return;
            const cancel = new AbortController();
            const promise = this.execute(lease, cancel.signal).catch(() => {
                console.error('Unable to persist Git synchronization result');
            }).finally(() => {
                this.work.delete(lease.id);
                this.dispatch();
            });
            this.work.set(lease.id, { projectId: lease.projectId, cancel, promise });
        } catch {
            if (this.dispatcher.observe(false)) console.error('Unable to claim a Git synchronization job');
        }
    }

    private step(run: AgentRun, title: string) {
        const existing = run.steps.find(step => step.capability === title);
        const step = existing ?? agentStep(run, title);
        step.status = 'RUNNING';
        step.finishedAt = null;
        this.runs.save(run);
        return () => {
            step.status = 'COMPLETED';
            step.finishedAt = new Date().toISOString();
            this.runs.save(run);
        };
    }

    execution(run: AgentRun) { return run.playbook === playbook ? this.queue.get(run.id) : undefined; }
    attempts(id: string) { return this.queue.history(id); }

    control(actor: Account, run: AgentRun, action: JobAction, revision: number, priority?: number) {
        const state = this.transaction(() => {
            const current = this.execution(run);
            if (!current) throw new HttpError(404, 'JOB_NOT_FOUND');
            this.identity.requireProjectManager(actor, run.projectId);
            const state = this.queue.change(run.id, revision, action, priority);
            this.syncQueueState(state);
            return state;
        });
        this.dispatch();
        return state;
    }

    private syncQueueState(job: Execution, reason = 'GIT_SYNC_FAILED') {
        if (job.state === 'RUNNING' || job.state === 'FINISHED') return;
        const run = this.runs.get(job.id);
        if (!run) return;
        if (job.state === 'FAILED' || job.state === 'CANCELLED') {
            this.queue.clearInput(run.id);
            this.runs.fail(run, job.state === 'CANCELLED' ? 'CANCELLED' : reason, job.state);
            return;
        }
        run.status = job.state;
        run.statusReason = null;
        for (const step of run.steps) if (step.status === 'RUNNING') step.status = 'PENDING';
        this.runs.save(run);
    }

    private async execute(lease: SyncLease, cancellation: AbortSignal) {
        const timer = new AbortController();
        const signal = AbortSignal.any([cancellation, timer.signal, AbortSignal.timeout(Math.max(1, lease.deadline - Date.now()))]);
        const fence = () => { this.queue.assertLease(lease); };
        const guard = () => {
            signal.throwIfAborted();
            this.queue.assertRunnable(lease);
            this.identity.requireProjectEditor({ id: lease.actorId, credentialVersion: lease.input.credentialVersion }, lease.projectId);
            return this.requireConnectionRevision(lease.input.connectionId, lease.input.connectionRevision);
        };
        const heartbeat = setInterval(() => {
            try {
                if (!this.queue.renew(lease, leaseMs)) throw new HttpError(409, 'JOB_LEASE_LOST');
                guard();
            }
            catch (error) { timer.abort(error); }
        }, 750).unref();
        const run = this.runs.get(lease.id);
        try {
            const connection = guard();
            if (!run) return;
            const binding = this.requireBinding(lease.projectId);
            if (binding.id !== lease.input.bindingId || binding.connectionId !== connection.id) throw new HttpError(409, 'GIT_REPOSITORY_CHANGED');
            this.queue.begin(lease);
            run.status = 'RUNNING';
            const finishFetch = this.step(run, 'GIT_CHECKOUT');
            const logical = this.logicalRoot(binding.id);
            const hosted = this.hostedIdentity(connection.id);
            const credential = this.credential(connection);
            if (hosted) {
                await this.verifyHostedIdentity(connection, hosted, credential, signal);
                guard();
            }
            const root = await materializeGitCommit(logical, connection.url, lease.input.commit, signal, hostedGitCredential(hosted, credential), {
                leaseId: lease.leaseId, guard, leaseActive: id => this.queue.leaseActive(id)
            });
            if (hosted) await this.verifyHostedIdentity(connection, hosted, credential, signal);
            guard();
            finishFetch();
            const finishIndex = this.step(run, 'INDEX_SOURCE');
            const indexed = await this.index(root, logical, signal, guard, fence);
            guard();
            if (indexed.status !== 'done') throw new HttpError(409, 'GIT_SOURCE_INDEX_FAILED');
            this.transaction(() => {
                guard();
                this.queue.finish(lease, 'FINISHED', digest(JSON.stringify([binding.id, lease.input.commit, indexed])));
                this.queue.clearInput(lease.id);
                this.db.prepare('UPDATE git_repository SET indexed_commit = ?, indexed_run_id = ? WHERE id = ?')
                    .run(lease.input.commit, lease.id, binding.id);
                finishIndex();
                run.status = 'COMPLETED';
                run.completedAt = new Date().toISOString();
                run.outputReference = 'git:' + binding.id + ':' + lease.input.commit;
                this.runs.save(run);
                if (lease.input.publishAfterSync) this.db.prepare(`INSERT INTO git_publication VALUES (?, 'PENDING', ?, ?, NULL, NULL)`)
                    .run(lease.id, lease.actorId, lease.input.credentialVersion);
            });
        } catch (error) {
            if (!run) return;
            this.transaction(() => {
                try { fence(); }
                catch { return; }
                const retry = this.shutdown.signal.aborted || error instanceof HttpError && error.message === 'INDEX_CAPACITY_EXHAUSTED';
                const next = this.queue.finish(lease, retry ? 'QUEUED' : 'FAILED');
                this.syncQueueState(next, error instanceof HttpError ? error.message : signal.aborted ? 'GIT_SYNC_TIMEOUT' : 'GIT_SYNC_FAILED');
            });
        } finally { clearInterval(heartbeat); }
    }

    async close() {
        this.shutdown.abort();
        clearInterval(this.timer);
        for (const task of this.work.values()) task.cancel.abort();
        await Promise.allSettled([...this.checking, ...this.automationTasks.values(), ...[...this.work.values()].map(task => task.promise)]);
    }
}
