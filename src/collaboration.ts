import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { basename } from 'node:path';
import { z } from 'zod';
import { agentRunIdPattern } from './agent-runs.js';
import { askTurnInput } from './ask-evidence.js';
import { HttpError } from './http-error.js';
import type { Account } from './identity.js';
import type { RepositoryIndex } from './index.js';
import { digest } from './source.js';

const uuid = z.string().regex(agentRunIdPattern);
const project = z.string().regex(/^[0-9a-f]{12}$/);
export const collaborationIdPattern = /^(?!\.{1,2}$)[A-Za-z0-9._~-]{1,128}$/;
const eventId = z.string().regex(collaborationIdPattern);
const maxAttempts = 3;
const leaseMs = 60_000;
export const collaborationConnection = z.strictObject({
    name: z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f\u007f]+$/u), externalActor: eventId, accountId: uuid,
    projects: z.array(project).max(32).default([]), askSessions: z.array(uuid).max(32).default([])
}).refine(input => input.projects.length + input.askSessions.length > 0);
export const collaborationEvent = z.strictObject({ eventId, externalActor: eventId, action: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('wiki.generate'), projectId: project, mode: z.enum(['incremental', 'full']).default('incremental') }),
    z.strictObject({ type: z.literal('ask.turn'), sessionId: uuid, turn: askTurnInput })
]) });
type ConnectionInput = z.infer<typeof collaborationConnection>;
type EventInput = z.infer<typeof collaborationEvent>;
type Action = EventInput['action']['type'];
type Delivery = 'PROCESSING' | 'ACCEPTED' | 'RETRYABLE' | 'REJECTED';
type Connection = { id: string; externalActor: string; account: Account; projects: string[]; askSessions: string[] };
type Event = { eventId: string; hash: string; action: Action; target: string; attempts: number; delivery: Delivery;
    leaseUntil: number; runId: string | null; error: string | null; httpStatus: number };

export class CollaborationIngress {
    constructor(private readonly db: DatabaseSync, private readonly repository: RepositoryIndex, private readonly now = Date.now) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS collaboration_connection (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, external_actor TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES enterprise_account(id),
                credential_version INTEGER NOT NULL, credential_hash TEXT NOT NULL, projects TEXT NOT NULL, ask_sessions TEXT NOT NULL,
                created_at INTEGER NOT NULL, revoked_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS collaboration_event (
                connection_id TEXT NOT NULL REFERENCES collaboration_connection(id), event_id TEXT NOT NULL,
                hash TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, attempts INTEGER NOT NULL,
                delivery TEXT NOT NULL CHECK(delivery IN ('PROCESSING','ACCEPTED','RETRYABLE','REJECTED')),
                lease_until INTEGER NOT NULL, run_id TEXT, error TEXT, http_status INTEGER NOT NULL,
                PRIMARY KEY(connection_id, event_id)
            );
        `);
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

    create(admin: Account, input: ConnectionInput) {
        return this.transaction(() => {
            const account = this.repository.identity.account(input.accountId);
            if (!account || account.role !== 'USER' || !this.repository.identity.accountIsActive(account)) {
                throw new HttpError(400, 'COLLABORATION_ACTOR_UNAVAILABLE');
            }
            const id = randomUUID();
            const projects = [...new Set(input.projects)];
            const askSessions = [...new Set(input.askSessions)];
            projects.forEach(project => this.repository.identity.requireProjectEditor(account, project));
            askSessions.forEach(session => this.repository.ask.describe(account, session));
            const credential = 'rgc_' + randomBytes(32).toString('base64url');
            this.db.prepare(`INSERT INTO collaboration_connection VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
                .run(id, input.name, input.externalActor, account.id, account.credentialVersion, digest(credential),
                    JSON.stringify(projects), JSON.stringify(askSessions), this.now());
            this.repository.identity.record(admin.id, 'COLLABORATION_CONNECTION_CREATED', id, account.id);
            return { id, credential };
        });
    }

    list(limit: number, offset: number) {
        const rows = this.db.prepare(`SELECT id, name, external_actor AS externalActor, account_id AS accountId, projects,
            ask_sessions AS askSessions, created_at AS createdAt, revoked_at AS revokedAt FROM collaboration_connection
            ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(limit + 1, offset);
        return { connections: rows.slice(0, limit).map(row => ({ ...row, projects: JSON.parse(String(row.projects)) as string[],
            askSessions: JSON.parse(String(row.askSessions)) as string[] })), offset, hasMore: rows.length > limit };
    }

    revoke(admin: Account, id: string) {
        return this.transaction(() => {
            const connection = this.db.prepare('SELECT revoked_at AS revokedAt FROM collaboration_connection WHERE id = ?').get(id);
            if (!connection) throw new HttpError(404, 'COLLABORATION_CONNECTION_NOT_FOUND');
            if (connection.revokedAt !== null) return { id, revokedAt: Number(connection.revokedAt) };
            const revokedAt = this.now();
            this.db.prepare('UPDATE collaboration_connection SET revoked_at = ? WHERE id = ?').run(revokedAt, id);
            this.repository.identity.record(admin.id, 'COLLABORATION_CONNECTION_REVOKED', id, '');
            return { id, revokedAt };
        });
    }

    authenticate(id: string, authorization: string | undefined): Connection {
        const key = /^Bearer (rgc_[A-Za-z0-9_-]{43})$/.exec(authorization ?? '')?.[1];
        const row = key ? this.db.prepare(`SELECT * FROM collaboration_connection WHERE id = ? AND credential_hash = ? AND revoked_at IS NULL`)
            .get(id, digest(key)) : undefined;
        const account = row && this.repository.identity.account(String(row.account_id));
        if (!row || !account || !this.repository.identity.accountIsActive(account) || account.role !== 'USER' || account.credentialVersion !== row.credential_version) {
            throw new HttpError(401, 'COLLABORATION_AUTHENTICATION_REQUIRED');
        }
        return { id, externalActor: String(row.external_actor), account, projects: JSON.parse(String(row.projects)) as string[],
            askSessions: JSON.parse(String(row.ask_sessions)) as string[] };
    }

    private requireTarget(connection: Connection, action: Action, target: string) {
        const { account, projects, askSessions } = connection;
        if (!(action === 'wiki.generate' ? projects : askSessions).includes(target)) throw new HttpError(403, 'COLLABORATION_SCOPE_DENIED');
        if (action === 'wiki.generate') this.repository.identity.requireProjectEditor(account, target);
        else this.repository.ask.describe(account, target);
    }

    private event(connectionId: string, eventId: string) {
        return this.db.prepare(`SELECT event_id AS eventId, hash, action, target, attempts, delivery, lease_until AS leaseUntil,
            run_id AS runId, error, http_status AS httpStatus FROM collaboration_event WHERE connection_id = ? AND event_id = ?`)
            .get(connectionId, eventId) as unknown as Event | undefined;
    }

    private reserve(connectionId: string, input: EventInput, target: string) {
        const hash = digest(JSON.stringify(input));
        const now = this.now();
        const { eventId } = input;
        return this.transaction(() => {
            const previous = this.event(connectionId, eventId);
            if (previous?.hash && previous.hash !== hash) throw new HttpError(409, 'COLLABORATION_EVENT_CONFLICT');
            if (previous && (previous.delivery === 'ACCEPTED' || previous.delivery === 'REJECTED'
                || previous.delivery === 'PROCESSING' && previous.leaseUntil > now)) return { event: previous, reserved: false };
            if (previous && previous.attempts >= maxAttempts) {
                this.db.prepare(`UPDATE collaboration_event SET delivery = 'REJECTED', error = 'COLLABORATION_DELIVERY_UNCONFIRMED', http_status = 503
                    WHERE connection_id = ? AND event_id = ?`).run(connectionId, eventId);
                return { event: this.event(connectionId, eventId)!, reserved: false };
            }
            this.db.prepare(`INSERT INTO collaboration_event VALUES (?, ?, ?, ?, ?, 1, 'PROCESSING', ?, NULL, NULL, 202)
                ON CONFLICT(connection_id, event_id) DO UPDATE SET attempts = attempts + 1, delivery = 'PROCESSING',
                    lease_until = excluded.lease_until, error = NULL, http_status = 202`)
                .run(connectionId, eventId, hash, input.action.type, target, now + leaseMs);
            return { event: this.event(connectionId, eventId)!, reserved: true };
        });
    }

    submit(connection: Connection, input: EventInput) {
        if (input.externalActor !== connection.externalActor) throw new HttpError(403, 'COLLABORATION_ACTOR_MISMATCH');
        const target = input.action.type === 'wiki.generate' ? input.action.projectId : input.action.sessionId;
        this.requireTarget(connection, input.action.type, target);
        const reservation = this.reserve(connection.id, input, target);
        if (reservation.reserved) {
            const key = 'collab-' + digest(connection.id + ':' + input.eventId);
            let outcome: { runId: string | null; delivery: Delivery; error: string | null; httpStatus: number };
            try {
                const runId = input.action.type === 'wiki.generate'
                    ? this.repository.wiki.submit(target, this.repository.gitSources.name(target) ?? (basename(this.repository.projectRoot(target)) || target),
                        connection.account, key, undefined, input.action.mode).agentRunId
                    : this.repository.ask.submit(connection.account, target, key, input.action.turn).turn.id;
                outcome = { runId, delivery: 'ACCEPTED', error: null, httpStatus: 202 };
            } catch (error) {
                const failure = error instanceof HttpError ? error : new HttpError(500, 'COLLABORATION_DELIVERY_FAILED');
                const retryable = retryableDelivery(failure);
                outcome = { runId: null, delivery: retryable && reservation.event.attempts < maxAttempts ? 'RETRYABLE' : 'REJECTED',
                    error: failure.message, httpStatus: failure.status };
            }
            this.db.prepare(`UPDATE collaboration_event SET run_id = ?, delivery = ?, error = ?, http_status = ?
                WHERE connection_id = ? AND event_id = ? AND attempts = ? AND delivery = 'PROCESSING'`)
                .run(outcome.runId, outcome.delivery, outcome.error, outcome.httpStatus, connection.id, input.eventId, reservation.event.attempts);
        }
        const row = this.event(connection.id, input.eventId)!;
        return { status: row.httpStatus, body: receipt(row) };
    }

    inspect(connection: Connection, id: string) {
        const event = this.event(connection.id, id);
        if (!event) throw new HttpError(404, 'COLLABORATION_EVENT_NOT_FOUND');
        this.requireTarget(connection, event.action, event.target);
        if (!event.runId) return receipt(event);
        const run = event.action === 'wiki.generate' ? this.repository.agentRuns.get(event.runId)
            : this.repository.ask.inspect(connection.account, event.target, event.runId);
        if (!run) throw new HttpError(404, 'COLLABORATION_RUN_NOT_FOUND');
        return { ...receipt(event), jobStatus: run.status, jobReason: 'statusReason' in run ? run.statusReason : run.reason };
    }
}

function retryableDelivery(error: HttpError) {
    return error.status >= 500 || error.status === 429 || ['WIKI_ALREADY_RUNNING', 'ASK_TURN_ACTIVE'].includes(error.message);
}

function receipt(event: Event) {
    const { eventId, action, attempts, delivery, runId, error } = event;
    return { eventId, action, attempts, delivery, runId, ...(error ? { error } : {}) };
}
