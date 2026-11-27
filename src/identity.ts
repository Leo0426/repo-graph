import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { compare as compareBcrypt } from 'bcryptjs';
import { ExternalIdentity } from './external-identity.js';
import { HttpError } from './http-error.js';
import { availableProject, ensureProjectRetirement } from './project-retirement.js';

export const ADMIN_ID = 'builtin-admin';
type AccountStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';
export interface Account {
    id: string; username: string; displayName: string; email: string;
    role: 'ADMIN' | 'USER'; status: AccountStatus; credentialVersion: number; createdAt: string;
    deviceCredentialId?: string;
}
interface Credentials extends Account { passwordHash: string | null; salt: string | null }
interface Organization { id: string; name: string; active: boolean; createdAt: string }
interface ProjectOwner { projectId: string; ownerType: 'PERSONAL' | 'ORGANIZATION'; ownerId: string; updatedAt: string }
export const projectGrantRoles = ['ADMIN', 'EDITOR', 'VIEWER'] as const;
type ProjectGrantRole = typeof projectGrantRoles[number];

const accountColumns = `id, username, display_name AS displayName, email, role, status,
    credential_version AS credentialVersion, created_at AS createdAt`;
const ownerColumns = 'project_id AS projectId, owner_type AS ownerType, owner_id AS ownerId, updated_at AS updatedAt';
const dummySalt = randomBytes(16);
const dummyHash = Buffer.alloc(64);
export const legacyPasswordHash = /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/;
const transitions = {
    PENDING: ['ACTIVE', 'REJECTED'], ACTIVE: ['DISABLED'], REJECTED: ['ACTIVE'], DISABLED: ['ACTIVE']
};

function passwordHash(password: string, salt: Buffer) {
    return new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
            (error, hash) => error ? reject(error) : resolve(hash));
    });
}

function validatePassword(password: string) {
    if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw new HttpError(400, 'INVALID_PASSWORD_LENGTH');
}

function normalizeUsername(username: string) {
    const normalized = username.trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_.-]{2,63}$/.test(normalized) ? normalized : null;
}

async function matchesPassword(password: string, credentials?: Credentials) {
    if (credentials?.salt === null && credentials.passwordHash && legacyPasswordHash.test(credentials.passwordHash)) {
        return compareBcrypt(password, credentials.passwordHash);
    }
    const known = credentials?.salt && credentials.passwordHash;
    const salt = known ? Buffer.from(credentials.salt!, 'hex') : dummySalt;
    const expected = known ? Buffer.from(credentials.passwordHash!, 'hex') : dummyHash;
    const computed = await passwordHash(password, salt);
    return timingSafeEqual(computed, expected) && !!known;
}

export class IdentityDirectory {
    readonly external: ExternalIdentity;

    constructor(private readonly db: DatabaseSync) {
        ensureProjectRetirement(db);
        db.exec(`
            CREATE TABLE IF NOT EXISTS enterprise_account (
                id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, email TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('ADMIN','USER')),
                status TEXT NOT NULL CHECK(status IN ('PENDING','ACTIVE','REJECTED','DISABLED')),
                credential_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
                salt TEXT, password_hash TEXT
            );
            CREATE TABLE IF NOT EXISTS enterprise_organization (
                id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                active INTEGER NOT NULL CHECK(active IN (0,1)), created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS enterprise_membership (
                org_id TEXT NOT NULL REFERENCES enterprise_organization(id),
                account_id TEXT NOT NULL REFERENCES enterprise_account(id), PRIMARY KEY(org_id, account_id)
            );
            CREATE INDEX IF NOT EXISTS enterprise_membership_account ON enterprise_membership(account_id, org_id);
            CREATE TABLE IF NOT EXISTS enterprise_project_owner (
                project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
                owner_type TEXT NOT NULL CHECK(owner_type IN ('PERSONAL','ORGANIZATION')),
                owner_id TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS enterprise_project_owner_target ON enterprise_project_owner(owner_type, owner_id);
            CREATE TABLE IF NOT EXISTS enterprise_project_access (
                project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE, revision INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS enterprise_project_grant (
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                account_id TEXT NOT NULL REFERENCES enterprise_account(id),
                role TEXT NOT NULL CHECK(role IN ('ADMIN','EDITOR','VIEWER')),
                PRIMARY KEY(project_id, account_id)
            );
            CREATE INDEX IF NOT EXISTS enterprise_project_grant_account ON enterprise_project_grant(account_id, project_id);
            CREATE TABLE IF NOT EXISTS enterprise_audit (
                id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL,
                target_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
            );
        `);
        this.external = new ExternalIdentity(db, this, process.env);
    }

    async initializeAdmin(password?: string) {
        const existing = this.credentials('admin');
        if (!existing) {
            this.db.prepare(`
                INSERT INTO enterprise_account(id, username, display_name, email, role, status, created_at)
                VALUES (?, 'admin', 'Administrator', '', 'ADMIN', 'ACTIVE', ?)
            `).run(ADMIN_ID, new Date().toISOString());
        }
        if (existing?.passwordHash) return true;
        if (password === undefined) return false;
        validatePassword(password);
        const salt = randomBytes(16);
        const hash = await passwordHash(password, salt);
        this.db.prepare('UPDATE enterprise_account SET salt = ?, password_hash = ? WHERE id = ? AND password_hash IS NULL')
            .run(salt.toString('hex'), hash.toString('hex'), ADMIN_ID);
        return true;
    }

    private transaction<T>(operation: () => T): T {
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

    private credentials(username: string) {
        return this.db.prepare(`
            SELECT ${accountColumns}, salt, password_hash AS passwordHash FROM enterprise_account WHERE username = ?
        `).get(username) as unknown as Credentials | undefined;
    }

    account(id: string) {
        return this.db.prepare(`SELECT ${accountColumns} FROM enterprise_account WHERE id = ?`)
            .get(id) as unknown as Account | undefined;
    }

    accountByUsername(username: string) {
        const normalized = normalizeUsername(username);
        return normalized ? this.db.prepare(`SELECT ${accountColumns} FROM enterprise_account WHERE username = ?`)
            .get(normalized) as unknown as Account | undefined : undefined;
    }

    accountIsActive(account: Account | undefined) {
        return account?.status === 'ACTIVE' && this.external.accountActive(account.id);
    }

    requireCurrent(account: Pick<Account, 'id' | 'credentialVersion' | 'deviceCredentialId'>) {
        const current = this.account(account.id);
        if (current?.status !== 'ACTIVE' || current.credentialVersion !== account.credentialVersion || !this.external.accountActive(account.id)) {
            throw new HttpError(401, 'AUTHENTICATION_REQUIRED');
        }
        if (!account.deviceCredentialId) return current;
        const device = this.db.prepare(`SELECT 1 FROM device_credential WHERE id = ? AND account_id = ? AND credential_version = ?
            AND revoked_at IS NULL AND expires_at > ?`).get(account.deviceCredentialId, account.id, account.credentialVersion, Date.now());
        if (!device) throw new HttpError(401, 'AUTHENTICATION_REQUIRED');
        return { ...current, deviceCredentialId: account.deviceCredentialId };
    }

    async authenticate(username: string, password: string) {
        const login = normalizeUsername(username);
        const credentials = login ? this.credentials(login) : undefined;
        if (!password || Buffer.byteLength(password, 'utf8') > 72
            || !await matchesPassword(password, credentials) || !credentials) {
            throw new HttpError(401, 'INVALID_CREDENTIALS');
        }
        try {
            if (credentials.status === 'ACTIVE' && credentials.salt === null && credentials.passwordHash) {
                const salt = randomBytes(16);
                const hash = await passwordHash(password, salt);
                this.db.prepare(`
                    UPDATE enterprise_account SET salt = ?, password_hash = ?
                    WHERE id = ? AND status = 'ACTIVE' AND credential_version = ? AND salt IS NULL AND password_hash = ?
                `).run(salt.toString('hex'), hash.toString('hex'), credentials.id,
                    credentials.credentialVersion, credentials.passwordHash);
            }
            return this.requireCurrent(credentials);
        } catch {
            throw new HttpError(401, 'INVALID_CREDENTIALS');
        }
    }

    async register(input: { username: string; displayName: string; email: string; password: string }) {
        const username = normalizeUsername(input.username);
        if (!username) throw new HttpError(400, 'INVALID_USERNAME');
        validatePassword(input.password);
        const salt = randomBytes(16);
        const hash = await passwordHash(input.password, salt);
        return this.transaction(() => {
            const id = randomUUID();
            const row = this.db.prepare(`
                INSERT INTO enterprise_account(id, username, display_name, email, role, status, created_at, salt, password_hash)
                VALUES (?, ?, ?, ?, 'USER', 'PENDING', ?, ?, ?) ON CONFLICT(username) DO NOTHING
            `).run(id, username, input.displayName, input.email, new Date().toISOString(), salt.toString('hex'), hash.toString('hex'));
            if (!row.changes) throw new HttpError(409, 'ACCOUNT_EXISTS');
            this.record(id, 'ACCOUNT_REGISTERED', id, '');
            return this.account(id)!;
        });
    }

    async changePassword(account: Account, oldPassword: string, password: string) {
        validatePassword(password);
        if (Buffer.byteLength(oldPassword, 'utf8') > 72 || !await matchesPassword(oldPassword, this.credentials(account.username))) {
            throw new HttpError(401, 'INVALID_CREDENTIALS');
        }
        const salt = randomBytes(16);
        const hash = await passwordHash(password, salt);
        this.transaction(() => {
            this.requireCurrent(account);
            this.db.prepare(`
                UPDATE enterprise_account SET salt = ?, password_hash = ?, credential_version = credential_version + 1 WHERE id = ?
            `).run(salt.toString('hex'), hash.toString('hex'), account.id);
            this.record(account.id, 'PASSWORD_CHANGED', account.id, '');
        });
    }

    accounts() {
        return this.db.prepare(`SELECT ${accountColumns} FROM enterprise_account ORDER BY username`).all();
    }

    review(actor: string, id: string, status: AccountStatus, reason: string) {
        return this.transaction(() => {
            const target = this.account(id);
            if (!target) throw new HttpError(404, 'ACCOUNT_NOT_FOUND');
            if (id === ADMIN_ID) throw new HttpError(403, 'ACCESS_DENIED');
            if (!transitions[target.status].includes(status)) throw new HttpError(409, 'INVALID_ACCOUNT_TRANSITION');
            this.db.prepare('UPDATE enterprise_account SET status = ?, credential_version = credential_version + 1 WHERE id = ?')
                .run(status, id);
            this.record(actor, `ACCOUNT_${status}`, id, reason);
            return this.account(id)!;
        });
    }

    organizations() {
        return this.db.prepare(`SELECT o.id, coalesce(x.name, o.name) AS name, o.active = 1 AND coalesce(x.active, 1) = 1 AS active,
            o.created_at AS createdAt FROM enterprise_organization o LEFT JOIN external_directory_organization x ON x.organization_id = o.id
            ORDER BY name COLLATE NOCASE, o.id`)
            .all().map(row => ({ ...row, active: Boolean(row.active) }));
    }

    private organization(id: string): Organization {
        const row = this.db.prepare(`SELECT o.id, coalesce(x.name, o.name) AS name, o.active = 1 AND coalesce(x.active, 1) = 1 AS active,
            o.created_at AS createdAt FROM enterprise_organization o LEFT JOIN external_directory_organization x ON x.organization_id = o.id
            WHERE o.id = ?`).get(id);
        if (!row) throw new HttpError(404, 'ORGANIZATION_NOT_FOUND');
        return { id: String(row.id), name: String(row.name), active: Boolean(row.active), createdAt: String(row.createdAt) };
    }

    saveOrganization(actor: string, id: string | null, name: string, active: boolean) {
        return this.transaction(() => {
            const orgId = id ?? randomUUID();
            if (id) this.organization(id);
            if (id && this.external.organizationTenant(id)) throw new HttpError(409, 'EXTERNAL_DIRECTORY_MANAGED');
            if (this.db.prepare('SELECT 1 FROM enterprise_organization WHERE name = ? AND id <> ?').get(name, orgId)) {
                throw new HttpError(409, 'ORGANIZATION_EXISTS');
            }
            this.db.prepare(`
                INSERT INTO enterprise_organization(id, name, active, created_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = excluded.active
            `).run(orgId, name, Number(active), new Date().toISOString());
            this.record(actor, id ? 'ORGANIZATION_UPDATED' : 'ORGANIZATION_CREATED', orgId,
                `${name} · ${active ? 'ACTIVE' : 'DISABLED'}`);
            return this.organization(orgId);
        });
    }

    members(id: string) {
        this.organization(id);
        return this.db.prepare(`
            SELECT ${accountColumns} FROM enterprise_account
            WHERE id IN (SELECT account_id FROM enterprise_membership WHERE org_id = ?) ORDER BY username
        `).all(id);
    }

    setMembership(actor: string, orgId: string, accountId: string, member: boolean) {
        return this.transaction(() => {
            const org = this.organization(orgId);
            if (this.external.organizationTenant(orgId)) throw new HttpError(409, 'EXTERNAL_DIRECTORY_MANAGED');
            const account = this.account(accountId);
            if (!account) throw new HttpError(404, 'ACCOUNT_NOT_FOUND');
            if (member && (!org.active || !this.accountIsActive(account) || this.external.accountTenant(accountId))) {
                throw new HttpError(400, 'MEMBERSHIP_REQUIRES_ACTIVE');
            }
            const result = member
                ? this.db.prepare('INSERT OR IGNORE INTO enterprise_membership VALUES (?, ?)').run(orgId, accountId)
                : this.db.prepare('DELETE FROM enterprise_membership WHERE org_id = ? AND account_id = ?').run(orgId, accountId);
            if (result.changes) this.record(actor, member ? 'MEMBERSHIP_ADDED' : 'MEMBERSHIP_REMOVED', orgId, accountId);
            return this.members(orgId);
        });
    }

    owner(projectId: string) {
        return this.db.prepare(`SELECT ${ownerColumns} FROM enterprise_project_owner WHERE project_id = ?`)
            .get(projectId) as unknown as ProjectOwner | undefined;
    }

    // Called in the same transaction that registers a newly created project.
    claimCreatedProject(actor: string, projectId: string) {
        this.external.bindProject(projectId, this.external.accountTenant(actor));
        this.db.prepare("INSERT INTO enterprise_project_owner VALUES (?, 'PERSONAL', ?, ?)")
            .run(projectId, actor, new Date().toISOString());
        this.record(actor, 'PROJECT_ASSIGNED', projectId, `PERSONAL:${actor}`);
    }

    assign(actor: string, projectId: string, ownerType: ProjectOwner['ownerType'], ownerId: string) {
        return this.transaction(() => {
            if (!this.db.prepare('SELECT 1 FROM project WHERE id = ?').get(projectId)) throw new HttpError(404, 'PROJECT_NOT_FOUND');
            const active = ownerType === 'PERSONAL' ? this.accountIsActive(this.account(ownerId))
                : this.organization(ownerId).active && this.external.organizationActive(ownerId);
            if (!active) throw new HttpError(400, 'OWNER_MUST_BE_ACTIVE');
            const previous = this.owner(projectId);
            this.external.bindProject(projectId, ownerType === 'PERSONAL' ? this.external.accountTenant(ownerId) : this.external.organizationTenant(ownerId));
            this.db.prepare(`
                INSERT INTO enterprise_project_owner VALUES (?, ?, ?, ?)
                ON CONFLICT(project_id) DO UPDATE SET
                    owner_type = excluded.owner_type, owner_id = excluded.owner_id, updated_at = excluded.updated_at
            `).run(projectId, ownerType, ownerId, new Date().toISOString());
            if (previous?.ownerType !== ownerType || previous?.ownerId !== ownerId) {
                // Grants in an old ownership scope require explicit approval in the new scope.
                this.db.prepare('DELETE FROM enterprise_project_grant WHERE project_id = ?').run(projectId);
                this.advanceProjectAccess(projectId);
            }
            this.record(actor, 'PROJECT_ASSIGNED', projectId, `${ownerType}:${ownerId}`);
            return this.owner(projectId)!;
        });
    }

    private activeMembership(accountId: string, orgId: string) {
        return this.db.prepare(`
            SELECT 1 FROM enterprise_membership m JOIN enterprise_organization o ON o.id = m.org_id
            WHERE o.active = 1 AND m.org_id = ? AND m.account_id = ?
        `).get(orgId, accountId) !== undefined;
    }

    projectAvailable(projectId: string) {
        return !this.db.prepare("SELECT 1 FROM project_retirement WHERE project_id = ? AND state <> 'ACTIVE'").get(projectId);
    }

    requireAvailableProject(projectId: string) {
        if (!this.projectAvailable(projectId)) throw new HttpError(404, 'PROJECT_NOT_FOUND');
    }

    private projectRole(account: Pick<Account, 'id' | 'credentialVersion'>, projectId: string,
        includeRetired = false): 'OWNER' | ProjectGrantRole | undefined {
        const current = this.requireCurrent(account);
        if (!includeRetired) this.requireAvailableProject(projectId);
        if (current.role === 'ADMIN') return 'ADMIN';
        const owner = this.owner(projectId);
        if (!owner) return undefined;
        const tenant = this.external.projectTenant(projectId);
        if (this.external.accountTenant(account.id) !== tenant) return undefined;
        if (owner.ownerType === 'PERSONAL' && owner.ownerId === account.id) return 'OWNER';
        const orgMember = owner.ownerType === 'ORGANIZATION' && this.activeMembership(account.id, owner.ownerId);
        if (owner.ownerType === 'ORGANIZATION' && !orgMember) return undefined;
        const grant = this.db.prepare('SELECT role FROM enterprise_project_grant WHERE project_id = ? AND account_id = ?')
            .get(projectId, account.id);
        // Existing organization memberships retain their current project workflows.
        return (grant?.role as ProjectGrantRole | undefined) ?? (orgMember ? (tenant ? 'VIEWER' : 'EDITOR') : undefined);
    }

    requireProjectEditor(account: Pick<Account, 'id' | 'credentialVersion'>, projectId: string) {
        const role = this.projectRole(account, projectId);
        if (!role || role === 'VIEWER') throw new HttpError(403, 'ACCESS_DENIED');
    }

    requireProjectReader(account: Account, projectId: string) {
        if (!this.projectRole(account, projectId)) throw new HttpError(403, 'ACCESS_DENIED');
    }

    projectCapabilities(account: Account, projectId: string) {
        const role = this.projectRole(account, projectId);
        if (!role) throw new HttpError(403, 'ACCESS_DENIED');
        return { canEdit: role !== 'VIEWER', canManage: role === 'ADMIN' || role === 'OWNER' };
    }

    requireProjectManager(account: Account, projectId: string, options: { includeRetired?: boolean } = {}) {
        const role = this.projectRole(account, projectId, options.includeRetired);
        if (role !== 'ADMIN' && role !== 'OWNER') throw new HttpError(403, 'ACCESS_DENIED');
    }

    private projectAccessRevision(projectId: string) {
        const row = this.db.prepare('SELECT revision FROM enterprise_project_access WHERE project_id = ?').get(projectId);
        return Number(row?.revision ?? 0);
    }

    private advanceProjectAccess(projectId: string) {
        this.db.prepare(`
            INSERT INTO enterprise_project_access VALUES (?, 1)
            ON CONFLICT(project_id) DO UPDATE SET revision = revision + 1
        `).run(projectId);
    }

    projectAccess(account: Account, projectId: string) {
        const role = this.projectRole(account, projectId);
        if (role !== 'ADMIN' && role !== 'OWNER') throw new HttpError(403, 'ACCESS_DENIED');
        if (!this.db.prepare('SELECT 1 FROM project WHERE id = ?').get(projectId)) throw new HttpError(404, 'PROJECT_NOT_FOUND');
        return { projectId, owner: this.owner(projectId) ?? null, revision: this.projectAccessRevision(projectId),
            grants: this.db.prepare(`
                SELECT account_id AS accountId, role FROM enterprise_project_grant WHERE project_id = ? ORDER BY account_id
            `).all(projectId) };
    }

    setProjectGrant(actor: Account, projectId: string, accountId: string, role: ProjectGrantRole | null, revision: number) {
        return this.transaction(() => {
            const access = this.projectAccess(actor, projectId);
            if (access.revision !== revision) throw new HttpError(409, 'PROJECT_ACCESS_CHANGED');
            if (!access.owner) throw new HttpError(409, 'PROJECT_OWNER_REQUIRED');
            if (role) {
                if (access.owner.ownerType === 'PERSONAL' && access.owner.ownerId === accountId) throw new HttpError(409, 'ALREADY_PROJECT_OWNER');
                if (!this.accountIsActive(this.account(accountId)) || this.external.accountTenant(accountId) !== this.external.projectTenant(projectId)
                    || (access.owner.ownerType === 'ORGANIZATION' && !this.activeMembership(accountId, access.owner.ownerId))) {
                    throw new HttpError(400, 'PROJECT_GRANT_REQUIRES_ACTIVE_MEMBER');
                }
                this.db.prepare(`
                    INSERT INTO enterprise_project_grant VALUES (?, ?, ?)
                    ON CONFLICT(project_id, account_id) DO UPDATE SET role = excluded.role
                `).run(projectId, accountId, role);
            } else {
                this.db.prepare('DELETE FROM enterprise_project_grant WHERE project_id = ? AND account_id = ?').run(projectId, accountId);
            }
            this.advanceProjectAccess(projectId);
            this.record(actor.id, role ? 'PROJECT_ROLE_GRANTED' : 'PROJECT_ROLE_REVOKED', projectId, role ? `${accountId}:${role}` : accountId);
            return { projectId, revision: this.projectAccessRevision(projectId) };
        });
    }

    transferPersonalProject(actor: Account, projectId: string, nextOwner: string, revision: number) {
        return this.transaction(() => {
            this.requireCurrent(actor);
            const owner = this.owner(projectId);
            if (owner?.ownerType !== 'PERSONAL' || owner.ownerId !== actor.id) throw new HttpError(403, 'ACCESS_DENIED');
            if (this.projectAccessRevision(projectId) !== revision) throw new HttpError(409, 'PROJECT_ACCESS_CHANGED');
            if (nextOwner === actor.id) throw new HttpError(409, 'ALREADY_PROJECT_OWNER');
            if (!this.accountIsActive(this.account(nextOwner)) || this.external.accountTenant(nextOwner) !== this.external.projectTenant(projectId)) {
                throw new HttpError(400, 'OWNER_MUST_BE_ACTIVE');
            }
            this.db.prepare('UPDATE enterprise_project_owner SET owner_id = ?, updated_at = ? WHERE project_id = ?')
                .run(nextOwner, new Date().toISOString(), projectId);
            this.db.prepare('DELETE FROM enterprise_project_grant WHERE project_id = ? AND account_id = ?').run(projectId, nextOwner);
            this.db.prepare(`
                INSERT INTO enterprise_project_grant VALUES (?, ?, 'ADMIN')
                ON CONFLICT(project_id, account_id) DO UPDATE SET role = 'ADMIN'
            `).run(projectId, actor.id);
            this.advanceProjectAccess(projectId);
            this.record(actor.id, 'PROJECT_OWNERSHIP_TRANSFERRED', projectId, nextOwner);
            return this.projectAccess(actor, projectId);
        });
    }

    visibleProjects(account: Account) {
        if (this.requireCurrent(account).role === 'ADMIN') {
            return this.db.prepare("SELECT 1 FROM project_retirement WHERE state = 'TRASHED' LIMIT 1").get()
                ? this.db.prepare(`SELECT p.id FROM project p WHERE ${availableProject('p.id')} ORDER BY p.id`).all().map(row => String(row.id))
                : null;
        }
        return this.db.prepare(`SELECT o.project_id FROM enterprise_project_owner o
            LEFT JOIN external_project_tenant t ON t.project_id = o.project_id
            WHERE t.tenant_id IS ? AND ${availableProject('o.project_id')} AND (
                (o.owner_type = 'PERSONAL' AND (o.owner_id = ? OR EXISTS (
                    SELECT 1 FROM enterprise_project_grant g WHERE g.project_id = o.project_id AND g.account_id = ?)))
                OR (o.owner_type = 'ORGANIZATION' AND EXISTS (
                    SELECT 1 FROM enterprise_membership m JOIN enterprise_organization org ON org.id = m.org_id
                    WHERE m.org_id = o.owner_id AND m.account_id = ? AND org.active = 1))
            ) ORDER BY o.project_id`).all(this.external.accountTenant(account.id), account.id, account.id, account.id).map(row => String(row.project_id));
    }

    record(actor: string, action: string, target: string, reason: string) {
        this.db.prepare('INSERT INTO enterprise_audit(actor_id, action, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(actor, action, target, reason, new Date().toISOString());
    }

    audit(limit: number) {
        return this.db.prepare(`
            SELECT id, actor_id AS actorId, action, target_id AS targetId, reason, created_at AS createdAt
            FROM enterprise_audit ORDER BY id DESC LIMIT ?
        `).all(limit);
    }
}
