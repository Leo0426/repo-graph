import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { HttpError } from './http-error.js';
import type { Account, IdentityDirectory } from './identity.js';
import { digest } from './source.js';

const codeSeconds = 600;
const tokenSeconds = 7 * 24 * 60 * 60;
const alphabet = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
const shortCode = new RegExp('^[' + alphabet + ']{8}$');
const longCode = /^[A-Za-z0-9_-]{43}$/;
export const deviceBearer = /^Bearer (rgd_[A-Za-z0-9_-]{43})$/;
export const deviceScope = 'knowledge.read';
const clientName = z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f\u007f]+$/u);
export const deviceStartInput = z.object({ client_id: z.literal('repograph-cli'), client_name: clientName,
    scope: z.literal(deviceScope).default(deviceScope) }).strict();
export const deviceTokenInput = z.object({ client_id: z.literal('repograph-cli'), device_code: z.string().regex(longCode),
    grant_type: z.literal('urn:ietf:params:oauth:grant-type:device_code') }).strict();
export const deviceUserCode = z.string().trim().max(12).transform(code => code.replace(/[- ]/g, '').toUpperCase()).pipe(z.string().regex(shortCode));
const routeId = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const allowedReads = new Set(['/api/v1/capabilities', '/api/v1/projects', '/api/v1/knowledge-snapshots', '/api/v1/summaries',
    '/api/v1/summaries/tree', '/api/v1/spaces', '/api/v1/search/knowledge/open']);
const resource = new RegExp('^/api/v1/(?:knowledge-snapshots/' + routeId + '/(?:source|manifest|changes)|summaries/' + routeId
    + '|spaces/' + routeId + '/documents/' + routeId + '(?:/versions(?:/' + routeId + '(?:/export)?)?)?)$');

export function deviceRouteAllowed(method: string | undefined, pathname: string) {
    return method === 'GET' && (allowedReads.has(pathname) || resource.test(pathname))
        || method === 'POST' && ['/api/v1/search/knowledge', '/api/v1/search/scoped'].includes(pathname);
}

export class DeviceAuthorization {
    constructor(private readonly db: DatabaseSync, private readonly identity: IdentityDirectory, private readonly clock = Date.now) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS device_request (
                device_hash TEXT PRIMARY KEY, user_hash TEXT NOT NULL UNIQUE, client_name TEXT NOT NULL,
                expires_at INTEGER NOT NULL, next_at INTEGER NOT NULL, interval_seconds INTEGER NOT NULL,
                polls INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL CHECK(state IN ('PENDING','APPROVED','DENIED','CONSUMED')),
                account_id TEXT REFERENCES enterprise_account(id), credential_version INTEGER
            );
            CREATE INDEX IF NOT EXISTS device_request_expiry ON device_request(expires_at);
            CREATE TABLE IF NOT EXISTS device_credential (
                id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL REFERENCES enterprise_account(id),
                credential_version INTEGER NOT NULL, client_name TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
                revoked_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS device_credential_owner ON device_credential(account_id, expires_at);
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

    start(client: string, verificationUri: string) {
        return this.transaction(() => {
            const now = this.clock();
            this.db.prepare('DELETE FROM device_request WHERE expires_at <= ?').run(now);
            this.db.prepare('DELETE FROM device_credential WHERE expires_at < ?').run(now - tokenSeconds * 1000);
            if (Number(this.db.prepare("SELECT count(*) AS n FROM device_request WHERE state IN ('PENDING','APPROVED')").get()?.n) >= 128) {
                throw new HttpError(503, 'DEVICE_REQUEST_CAPACITY');
            }
            if (Number(this.db.prepare('SELECT count(*) AS n FROM device_request').get()?.n) >= 512) {
                throw new HttpError(503, 'DEVICE_REQUEST_CAPACITY');
            }
            const device = randomBytes(32).toString('base64url');
            let code: string;
            do { code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
            while (this.db.prepare('SELECT 1 FROM device_request WHERE user_hash = ?').get(digest(code)));
            this.db.prepare(`INSERT INTO device_request(device_hash, user_hash, client_name, expires_at, next_at, interval_seconds, state)
                VALUES (?, ?, ?, ?, ?, 5, 'PENDING')`).run(digest(device), digest(code), client, now + codeSeconds * 1000, now + 5000);
            return { device_code: device, user_code: code.slice(0, 4) + '-' + code.slice(4),
                verification_uri: verificationUri, expires_in: codeSeconds, interval: 5, scope: deviceScope };
        });
    }

    inspect(actor: Account, code: string) {
        this.identity.requireCurrent(actor);
        const row = this.db.prepare("SELECT client_name, expires_at FROM device_request WHERE user_hash = ? AND state = 'PENDING' AND expires_at > ?")
            .get(digest(code), this.clock());
        if (!row) throw new HttpError(404, 'DEVICE_CODE_UNAVAILABLE');
        return { clientName: String(row.client_name), expiresAt: new Date(Number(row.expires_at)).toISOString(), scope: deviceScope };
    }

    decide(actor: Account, code: string, approved: boolean) {
        return this.transaction(() => {
            this.identity.requireCurrent(actor);
            const saved = this.db.prepare(`UPDATE device_request SET state = ?, account_id = ?, credential_version = ?
                WHERE user_hash = ? AND state = 'PENDING' AND expires_at > ?`)
                .run(approved ? 'APPROVED' : 'DENIED', actor.id, actor.credentialVersion, digest(code), this.clock());
            if (!saved.changes) throw new HttpError(404, 'DEVICE_CODE_UNAVAILABLE');
            return { status: approved ? 'approved' : 'denied' };
        });
    }

    exchange(deviceCode: string) {
        const result = this.transaction(() => {
            const now = this.clock();
            const key = digest(deviceCode);
            const row = this.db.prepare('SELECT * FROM device_request WHERE device_hash = ?').get(key);
            if (!row || row.state === 'CONSUMED') return { error: 'invalid_grant' } as const;
            if (Number(row.expires_at) <= now || Number(row.polls) >= 72) return { error: 'expired_token' } as const;
            if (row.state === 'DENIED') return { error: 'access_denied' } as const;
            const early = now < Number(row.next_at);
            const interval = Number(row.interval_seconds) + (early ? 5 : 0);
            this.db.prepare('UPDATE device_request SET polls = polls + 1, interval_seconds = ?, next_at = ? WHERE device_hash = ?')
                .run(interval, now + interval * 1000, key);
            if (early) return { error: 'slow_down', interval } as const;
            if (row.state === 'PENDING') return { error: 'authorization_pending', interval } as const;
            const account = this.identity.account(String(row.account_id));
            if (!account || !this.identity.accountIsActive(account) || account.credentialVersion !== row.credential_version) return { error: 'access_denied' } as const;
            const count = this.db.prepare(`SELECT count(*) AS n FROM device_credential WHERE account_id = ?
                AND credential_version = ? AND revoked_at IS NULL AND expires_at > ?`).get(account.id, account.credentialVersion, now);
            if (Number(count?.n) >= 32) return { error: 'device_credential_limit' } as const;
            const secret = 'rgd_' + randomBytes(32).toString('base64url');
            const id = randomUUID();
            this.db.prepare(`INSERT INTO device_credential(id,token_hash,account_id,credential_version,client_name,created_at,expires_at)
                VALUES (?,?,?,?,?,?,?)`).run(id, digest(secret), account.id, account.credentialVersion, row.client_name,
                    now, now + tokenSeconds * 1000);
            this.db.prepare("UPDATE device_request SET state = 'CONSUMED' WHERE device_hash = ?").run(key);
            this.identity.record(account.id, 'DEVICE_CREDENTIAL_ISSUED', id, '');
            return { access_token: secret, token_type: 'Bearer', expires_in: tokenSeconds, scope: deviceScope };
        });
        return result;
    }

    authenticate(secret: string) {
        const row = this.db.prepare(`SELECT id, account_id AS accountId, credential_version AS credentialVersion FROM device_credential
            WHERE token_hash = ? AND expires_at > ? AND revoked_at IS NULL`).get(digest(secret), this.clock());
        if (!row) return undefined;
        try {
            return this.identity.requireCurrent({ id: String(row.accountId), credentialVersion: Number(row.credentialVersion),
                deviceCredentialId: String(row.id) });
        } catch (error) {
            if (!(error instanceof HttpError) || error.status !== 401) throw error;
            return undefined;
        }
    }

    list(actor: Account) {
        this.identity.requireCurrent(actor);
        return this.db.prepare(`SELECT id, client_name AS clientName, created_at AS createdAt, expires_at AS expiresAt FROM device_credential
            WHERE account_id = ? AND credential_version = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC, id`)
            .all(actor.id, actor.credentialVersion, this.clock());
    }

    revoke(actor: Account, id: string) {
        return this.transaction(() => {
            this.identity.requireCurrent(actor);
            const result = this.db.prepare('UPDATE device_credential SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL')
                .run(this.clock(), id, actor.id);
            if (!result.changes) throw new HttpError(404, 'DEVICE_CREDENTIAL_NOT_FOUND');
            this.identity.record(actor.id, 'DEVICE_CREDENTIAL_REVOKED', id, '');
            return { revoked: true };
        });
    }
}
