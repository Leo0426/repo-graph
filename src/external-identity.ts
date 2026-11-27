import { createPublicKey, randomUUID, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { HttpError } from './http-error.js';
import type { IdentityDirectory } from './identity.js';
import { digest } from './source.js';

export const externalIdPattern = /^(?!\.{1,2}$)[A-Za-z0-9_.:@~-]{1,128}$/;
const externalId = z.string().regex(externalIdPattern);
const label = z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/u);
const timestamp = z.int().min(0).max(8_640_000_000_000_000);
const actorInput = z.strictObject({ subject: externalId, displayName: label, email: z.email().max(254).default(''), active: z.boolean().default(true) });
const organizationInput = z.strictObject({ id: externalId, name: label, active: z.boolean().default(true), members: z.array(externalId).max(1000) });
export const externalDirectoryInput = z.strictObject({ version: z.int().positive(), issuedAt: timestamp, validUntil: timestamp,
    accounts: z.array(actorInput).max(1000), organizations: z.array(organizationInput).max(100) }).refine(snapshot => {
    const accounts = new Set(snapshot.accounts.map(account => account.subject));
    return snapshot.issuedAt < snapshot.validUntil && accounts.size === snapshot.accounts.length
        && new Set(snapshot.organizations.map(organization => organization.id)).size === snapshot.organizations.length
        && snapshot.organizations.every(organization => new Set(organization.members).size === organization.members.length
            && organization.members.every(id => accounts.has(id)));
});
export const externalSessionInput = z.strictObject({ assertion: z.string().min(1).max(4096) });
const header = z.strictObject({ alg: z.literal('Ed25519'), typ: z.literal('repograph-session+jwt') });
const claims = z.strictObject({ iss: z.string(), aud: z.string(), tenant: externalId, sub: externalId, iat: z.int().nonnegative(),
    exp: z.int().nonnegative(), jti: externalId, nonce: z.string().regex(/^[a-f0-9]{64}$/) });
type Projection = z.infer<typeof externalDirectoryInput>;
type Issuer = { name: string; audience: string; publicKey: KeyObject };
const signInDenied = () => new HttpError(401, 'EXTERNAL_SESSION_INVALID');

function issuerConfiguration(env: NodeJS.ProcessEnv): Issuer | undefined {
    const { REPOGRAPH_EXTERNAL_ISSUER: name, REPOGRAPH_EXTERNAL_AUDIENCE: audience, REPOGRAPH_EXTERNAL_PUBLIC_KEY_FILE: keyFile } = env;
    if (!name && !audience && !keyFile) return undefined;
    const url = name ? URL.parse(name) : null;
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || !audience?.trim()
        || audience.length > 256 || !keyFile || !name) throw new Error('Invalid external identity issuer configuration');
    const publicKey = createPublicKey(readFileSync(keyFile));
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('External identity requires an Ed25519 verification key');
    return { name, audience, publicKey };
}

export class ExternalIdentity {
    private readonly issuer: Issuer | undefined;

    constructor(private readonly db: DatabaseSync, private readonly directory: IdentityDirectory,
        env: NodeJS.ProcessEnv, private readonly now = Date.now) {
        this.issuer = issuerConfiguration(env);
        db.exec(`
            CREATE TABLE IF NOT EXISTS external_directory (
                id TEXT PRIMARY KEY, issuer TEXT NOT NULL, tenant_key TEXT NOT NULL, version INTEGER NOT NULL,
                issued_at INTEGER NOT NULL, valid_until INTEGER NOT NULL, digest TEXT NOT NULL,
                UNIQUE(issuer, tenant_key)
            );
            CREATE TABLE IF NOT EXISTS external_directory_account (
                tenant_id TEXT NOT NULL REFERENCES external_directory(id), subject TEXT NOT NULL,
                account_id TEXT NOT NULL UNIQUE REFERENCES enterprise_account(id), active INTEGER NOT NULL CHECK(active IN (0,1)),
                digest TEXT NOT NULL, PRIMARY KEY(tenant_id, subject)
            );
            CREATE TABLE IF NOT EXISTS external_directory_organization (
                tenant_id TEXT NOT NULL REFERENCES external_directory(id), external_id TEXT NOT NULL,
                organization_id TEXT NOT NULL UNIQUE REFERENCES enterprise_organization(id), name TEXT NOT NULL,
                active INTEGER NOT NULL CHECK(active IN (0,1)), PRIMARY KEY(tenant_id, external_id)
            );
            CREATE TABLE IF NOT EXISTS external_assertion_receipt (
                issuer TEXT NOT NULL, jti TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(issuer, jti)
            );
            CREATE INDEX IF NOT EXISTS external_assertion_expiry ON external_assertion_receipt(expires);
            CREATE TABLE IF NOT EXISTS external_project_tenant (
                project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
                tenant_id TEXT NOT NULL REFERENCES external_directory(id)
            );
        `);
    }

    get enabled() { return !!this.issuer; }

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

    accountTenant(id: string) {
        const row = this.db.prepare('SELECT tenant_id FROM external_directory_account WHERE account_id = ?').get(id);
        return row ? String(row.tenant_id) : null;
    }

    organizationTenant(id: string) {
        const row = this.db.prepare('SELECT tenant_id FROM external_directory_organization WHERE organization_id = ?').get(id);
        return row ? String(row.tenant_id) : null;
    }

    projectTenant(id: string) {
        const row = this.db.prepare('SELECT tenant_id FROM external_project_tenant WHERE project_id = ?').get(id);
        return row ? String(row.tenant_id) : null;
    }

    bindProject(id: string, tenant: string | null) {
        const previous = this.projectTenant(id);
        if (previous && previous !== tenant) throw new HttpError(409, 'PROJECT_TENANT_MISMATCH');
        if (tenant && !previous) this.db.prepare('INSERT INTO external_project_tenant VALUES (?, ?)').run(id, tenant);
    }

    accountActive(id: string) {
        const row = this.db.prepare(`SELECT a.active, d.issuer, d.valid_until AS validUntil FROM external_directory_account a
            JOIN external_directory d ON d.id = a.tenant_id WHERE a.account_id = ?`).get(id);
        return !row || !!row.active && row.issuer === this.issuer?.name && Number(row.validUntil) > this.now();
    }

    organizationActive(id: string) {
        const row = this.db.prepare(`SELECT g.active, d.issuer, d.valid_until AS validUntil FROM external_directory_organization g
            JOIN external_directory d ON d.id = g.tenant_id WHERE g.organization_id = ?`).get(id);
        return !row || !!row.active && row.issuer === this.issuer?.name && Number(row.validUntil) > this.now();
    }

    private tenant(key: string) {
        if (!this.issuer) throw new HttpError(404, 'EXTERNAL_IDENTITY_DISABLED');
        return this.db.prepare(`SELECT id, version, issued_at AS issuedAt, valid_until AS validUntil, digest
            FROM external_directory WHERE issuer = ? AND tenant_key = ?`).get(this.issuer.name, key);
    }

    status(key: string) {
        const tenant = this.tenant(key);
        if (!tenant) throw new HttpError(404, 'EXTERNAL_TENANT_NOT_FOUND');
        const accounts = this.db.prepare(`SELECT subject, account_id AS id FROM external_directory_account
            WHERE tenant_id = ? AND active = 1 ORDER BY subject`).all(tenant.id);
        const organizations = this.db.prepare(`SELECT external_id AS externalId, organization_id AS id, name, active FROM external_directory_organization
            WHERE tenant_id = ? ORDER BY external_id`).all(tenant.id).map(item => ({ ...item, active: Boolean(item.active) }));
        return { id: tenant.id, key, version: tenant.version, issuedAt: tenant.issuedAt, validUntil: tenant.validUntil,
            state: Number(tenant.validUntil) > this.now() ? 'ACTIVE' : 'STALE', accounts, organizations };
    }

    sync(actorId: string, key: string, input: Projection) {
        if (!this.issuer) throw new HttpError(404, 'EXTERNAL_IDENTITY_DISABLED');
        if (input.issuedAt > this.now()) throw new HttpError(400, 'EXTERNAL_DIRECTORY_FROM_FUTURE');
        const issuer = this.issuer.name;
        const accounts = [...input.accounts].sort((a, b) => a.subject < b.subject ? -1 : 1);
        const groups = input.organizations.map(org => ({ ...org, members: [...org.members].sort() })).sort((a, b) => a.id < b.id ? -1 : 1);
        const fingerprint = digest(JSON.stringify([input.version, input.issuedAt, input.validUntil, accounts, groups]));
        return this.transaction(() => {
            const previous = this.tenant(key);
            if (previous?.version === input.version) {
                if (previous.digest !== fingerprint) throw new HttpError(409, 'EXTERNAL_DIRECTORY_VERSION_CONFLICT');
                return this.status(key);
            }
            if (previous && (input.version < Number(previous.version) || input.issuedAt < Number(previous.issuedAt))) {
                throw new HttpError(409, 'EXTERNAL_DIRECTORY_OUT_OF_ORDER');
            }
            const id = previous ? String(previous.id) : randomUUID();
            this.db.prepare(`INSERT INTO external_directory VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE
                SET version = excluded.version, issued_at = excluded.issued_at, valid_until = excluded.valid_until, digest = excluded.digest`)
                .run(id, issuer, key, input.version, input.issuedAt, input.validUntil, fingerprint);
            this.projectDirectory(id, accounts, groups, !!previous && Number(previous.validUntil) <= this.now());
            this.directory.record(actorId, 'EXTERNAL_DIRECTORY_PROJECTED', id, String(input.version));
            return this.status(key);
        });
    }

    private projectDirectory(tenant: string, accounts: Projection['accounts'], groups: Projection['organizations'], previousExpired: boolean) {
        const started = new Date(this.now()).toISOString();
        const memberships = new Map(accounts.map(account => [account.subject, [] as string[]]));
        for (const group of groups) if (group.active) {
            for (const subject of group.members) memberships.get(subject)!.push(group.id);
        }
        const accountMapping = new Map<string, string>();
        const oldActors = new Map(this.db.prepare(`SELECT subject, account_id AS id, active, digest FROM external_directory_account WHERE tenant_id = ?`)
            .all(tenant).map(row => [String(row.subject), row]));
        for (const account of accounts) {
            const previous = oldActors.get(account.subject);
            oldActors.delete(account.subject);
            const id = previous ? String(previous.id) : randomUUID();
            const changed = digest(JSON.stringify([account, memberships.get(account.subject)]));
            if (!previous) this.db.prepare(`INSERT INTO enterprise_account(id, username, display_name, email, role, status, created_at)
                VALUES (?, ?, ?, ?, 'USER', 'ACTIVE', ?)`).run(id, 'external-' + id, account.displayName, account.email, started);
            else if (previousExpired || previous.digest !== changed || Boolean(previous.active) !== account.active) {
                this.db.prepare(`UPDATE enterprise_account SET display_name = ?, email = ?, credential_version = credential_version + 1 WHERE id = ?`)
                    .run(account.displayName, account.email, id);
            }
            this.db.prepare(`INSERT INTO external_directory_account VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id, subject) DO UPDATE SET active = excluded.active, digest = excluded.digest`)
                .run(tenant, account.subject, id, Number(account.active), changed);
            if (account.active) accountMapping.set(account.subject, id);
        }
        for (const account of oldActors.values()) if (account.active) {
            this.db.prepare('UPDATE external_directory_account SET active = 0 WHERE account_id = ?').run(account.id);
            this.db.prepare('UPDATE enterprise_account SET credential_version = credential_version + 1 WHERE id = ?').run(account.id);
        }
        this.db.prepare(`DELETE FROM enterprise_membership WHERE org_id IN (
            SELECT organization_id FROM external_directory_organization WHERE tenant_id = ?)`).run(tenant);
        this.db.prepare('UPDATE external_directory_organization SET active = 0 WHERE tenant_id = ?').run(tenant);
        for (const group of groups) {
            const previous = this.db.prepare(`SELECT organization_id AS id FROM external_directory_organization
                WHERE tenant_id = ? AND external_id = ?`).get(tenant, group.id);
            const id = previous ? String(previous.id) : randomUUID();
            if (!previous) this.db.prepare('INSERT INTO enterprise_organization VALUES (?, ?, 1, ?)').run(id, 'external-' + id, started);
            this.db.prepare(`INSERT INTO external_directory_organization VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id,external_id)
                DO UPDATE SET name = excluded.name, active = excluded.active`).run(tenant, group.id, id, group.name, Number(group.active));
            if (group.active) for (const subject of group.members) {
                const accountId = accountMapping.get(subject);
                if (accountId) this.db.prepare('INSERT INTO enterprise_membership VALUES (?, ?)').run(id, accountId);
            }
        }
    }

    exchange(assertion: string, expectedNonce: string) {
        if (!this.issuer) throw new HttpError(404, 'EXTERNAL_IDENTITY_DISABLED');
        const { name, audience, publicKey } = this.issuer;
        const parts = assertion.split('.');
        if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw signInDenied();
        const signature = Buffer.from(parts[2], 'base64url');
        if (signature.byteLength !== 64 || signature.toString('base64url') !== parts[2]
            || !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, signature)) throw signInDenied();
        const decode = (segment: string) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(segment, 'base64url'))) as unknown;
        let identity;
        try {
            header.parse(decode(parts[0]));
            identity = claims.parse(decode(parts[1]));
        } catch { throw signInDenied(); }
        const now = Math.floor(this.now() / 1000);
        if (identity.iss !== name || identity.aud !== audience || identity.nonce !== expectedNonce || identity.iat > now + 15
            || identity.exp <= now || identity.exp <= identity.iat || identity.exp - identity.iat > 300) throw signInDenied();
        return this.transaction(() => {
            const tenant = this.tenant(identity.tenant);
            const row = tenant && this.db.prepare(`SELECT account_id AS id FROM external_directory_account
                WHERE tenant_id = ? AND subject = ? AND active = 1`).get(tenant.id, identity.sub);
            const account = row && this.directory.account(String(row.id));
            if (account?.status !== 'ACTIVE' || !this.accountActive(account.id)) throw signInDenied();
            this.db.prepare('DELETE FROM external_assertion_receipt WHERE expires <= ?').run(now);
            const once = this.db.prepare('INSERT OR IGNORE INTO external_assertion_receipt VALUES (?, ?, ?)').run(name, identity.jti, identity.exp);
            if (!once.changes) throw signInDenied();
            return account;
        });
    }
}
