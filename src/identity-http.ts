import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { deviceBearer, deviceStartInput, deviceTokenInput, deviceUserCode } from './device-authorization.js';
import type { DeviceAuthorization } from './device-authorization.js';
import { HttpError, send } from './http-error.js';
import { externalDirectoryInput, externalIdPattern, externalSessionInput } from './external-identity.js';
import { readPayload } from './http-body.js';
import { ADMIN_ID } from './identity.js';
import type { Account, IdentityDirectory } from './identity.js';
import type { RepositoryIndex } from './index.js';
import { localHost, sameBrowserOrigin } from './web.js';

const SESSION = 'repograph_session';
const NONCE = 'repograph_csrf';
const CSRF = 'x-csrf-token';
const SESSION_SECONDS = 8 * 60 * 60;
const NONCE_SECONDS = 15 * 60;
const MAX_SESSIONS = 512;
const MAX_BODY = 16_384;
const PREFIX = '/api/v1';
const random = () => randomBytes(32).toString('hex');
const text = (max: number) => z.string().trim().min(1).max(max);
const login = z.object({ username: z.string().max(256), password: z.string().max(256) });
const registration = login.extend({ displayName: text(100), email: z.string().trim().email().max(254) });
const changePassword = z.object({ oldPassword: z.string().max(256), newPassword: z.string().max(256) });
const review = z.object({ status: z.enum(['ACTIVE', 'REJECTED', 'DISABLED']), reason: text(500) });
const org = z.object({ name: text(100), active: z.boolean().default(true) });
const membership = z.object({ member: z.boolean() });
const owner = z.object({ ownerType: z.enum(['PERSONAL', 'ORGANIZATION']), ownerId: text(64) });
const devicePreview = z.object({ code: deviceUserCode }).strict();
const deviceDecision = devicePreview.extend({ approved: z.boolean() });
const deviceId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const perMinute = { login: 30, register: 5, 'device-start': 8, 'device-exchange': 120, 'device-review': 30 };

interface Session { account: Pick<Account, 'id' | 'credentialVersion'>; csrf: string; expires: number }
interface Principal { account: Account; session?: Session }

function cookie(request: IncomingMessage, name: string) {
    return request.headers.cookie?.split(';').map(pair => pair.trim())
        .find(pair => pair.startsWith(`${name}=`))?.slice(name.length + 1);
}

function setCookie(response: ServerResponse, name: string, value: string, age: number) {
    response.appendHeader('Set-Cookie', `${name}=${value}; Path=${PREFIX}; HttpOnly; SameSite=Strict; Max-Age=${age}`);
}

function sameSecret(expected: string | undefined, provided: string | undefined) {
    if (!expected || !provided) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    return a.length === b.length && timingSafeEqual(a, b);
}

function payload<T>(request: IncomingMessage, schema: z.ZodType<T>, allowForm = false) {
    return readPayload(request, schema, MAX_BODY, { allowForm });
}

export class IdentityHttp {
    private readonly sessions = new Map<string, Session>();
    private readonly limits = new Map<string, { count: number; expires: number }>();

    constructor(private readonly directory: IdentityDirectory, private readonly token?: string, private readonly devices?: DeviceAuthorization) {}

    private checkBearer(request: IncomingMessage) {
        return !!this.token && sameSecret(`Bearer ${this.token}`, request.headers.authorization);
    }

    principal(request: IncomingMessage): Principal | undefined {
        if (this.checkBearer(request)) return { account: this.directory.account(ADMIN_ID)! };
        const credential = deviceBearer.exec(request.headers.authorization ?? '')?.[1];
        if (credential) {
            const account = this.devices?.authenticate(credential);
            return account && { account };
        }
        const id = cookie(request, SESSION);
        const session = id && localHost(request) ? this.sessions.get(id) : undefined;
        if (!session || session.expires <= Date.now()) {
            if (id) this.sessions.delete(id);
            return;
        }
        try {
            return { account: this.directory.requireCurrent(session.account), session };
        } catch (error) {
            if (!(error instanceof HttpError)) throw error;
            this.sessions.delete(id!);
            return;
        }
    }

    private beginSession(request: IncomingMessage, response: ServerResponse, account: Account) {
        const now = Date.now();
        for (const [id, session] of this.sessions) {
            if (session.expires <= now) this.sessions.delete(id);
        }
        const previous = cookie(request, SESSION);
        if (previous) this.sessions.delete(previous);
        if (this.sessions.size >= MAX_SESSIONS) throw new HttpError(503, 'SESSION_CAPACITY_EXHAUSTED');
        const id = random();
        this.sessions.set(id, {
            account: { id: account.id, credentialVersion: account.credentialVersion },
            csrf: random(), expires: now + SESSION_SECONDS * 1000
        });
        setCookie(response, SESSION, id, SESSION_SECONDS);
        setCookie(response, NONCE, '', 0);
    }

    private endSession(request: IncomingMessage, response: ServerResponse) {
        const id = cookie(request, SESSION);
        if (id) this.sessions.delete(id);
        setCookie(response, SESSION, '', 0);
        setCookie(response, NONCE, '', 0);
    }

    // Origins are present on browser mutations. Non-browser clients must still send the cookie-bound token.
    private verifyOrigin(request: IncomingMessage) {
        if (!localHost(request) || (request.headers.origin !== undefined && !sameBrowserOrigin(request))) {
            throw new HttpError(403, 'ORIGIN_FORBIDDEN');
        }
    }

    private verifyCsrf(request: IncomingMessage, session?: Session) {
        this.verifyOrigin(request);
        const value = request.headers[CSRF];
        const expected = session?.csrf ?? cookie(request, NONCE);
        if (!/^[a-f0-9]{64}$/.test(expected ?? '') || typeof value !== 'string' || !sameSecret(expected, value)) {
            throw new HttpError(403, 'INVALID_CSRF_TOKEN');
        }
    }

    requireWrite(request: IncomingMessage, principal: Principal) {
        if (principal.session && request.method !== 'GET' && request.method !== 'HEAD') {
            this.verifyCsrf(request, principal.session);
        }
    }

    private rateLimit(request: IncomingMessage, response: ServerResponse, key: keyof typeof perMinute) {
        const address = `${key}:${request.socket.remoteAddress ?? 'unknown'}`;
        const now = Date.now();
        let bucket = this.limits.get(address);
        if (!bucket || bucket.expires <= now) {
            if (this.limits.size >= 512) for (const [name, earlier] of this.limits) {
                if (earlier.expires <= now) this.limits.delete(name);
            }
            if (!bucket && this.limits.size >= 512) throw new HttpError(429, 'RATE_LIMITED');
            bucket = { count: 0, expires: now + 60_000 };
            this.limits.set(address, bucket);
        }
        if (++bucket.count > perMinute[key]) {
            response.setHeader('Retry-After', Math.ceil((bucket.expires - now) / 1000));
            throw new HttpError(429, 'RATE_LIMITED');
        }
    }

    async authenticateRoute(request: IncomingMessage, response: ServerResponse, path: string) {
        const route = `${request.method} ${path}`;
        switch (route) {
            case `POST ${PREFIX}/auth/device/start`: {
                if (!this.devices) throw new HttpError(404, 'DEVICE_AUTH_DISABLED');
                this.verifyOrigin(request);
                this.rateLimit(request, response, 'device-start');
                const input = await payload(request, deviceStartInput, true);
                send(response, 200, this.devices.start(input.client_name, 'http://' + request.headers.host! + '/?authorizeDevice=1'));
                return true;
            }
            case `POST ${PREFIX}/auth/device/token`: {
                if (!this.devices) throw new HttpError(404, 'DEVICE_AUTH_DISABLED');
                this.verifyOrigin(request);
                this.rateLimit(request, response, 'device-exchange');
                const input = await payload(request, deviceTokenInput, true);
                const result = this.devices.exchange(input.device_code);
                send(response, 'error' in result ? 400 : 200, result);
                return true;
            }
            case `GET ${PREFIX}/auth/csrf`: {
                this.verifyOrigin(request);
                const session = this.principal(request)?.session;
                const nonce = cookie(request, NONCE);
                const token = session?.csrf ?? (nonce && /^[a-f0-9]{64}$/.test(nonce) ? nonce : random());
                if (!session && token !== nonce) setCookie(response, NONCE, token, NONCE_SECONDS);
                send(response, 200, { token, headerName: 'X-CSRF-Token' });
                return true;
            }
            case `POST ${PREFIX}/auth/register`: {
                this.verifyCsrf(request, this.principal(request)?.session);
                this.rateLimit(request, response, 'register');
                send(response, 201, await this.directory.register(await payload(request, registration)));
                return true;
            }
            case `POST ${PREFIX}/auth/login`: {
                this.verifyCsrf(request, this.principal(request)?.session);
                this.rateLimit(request, response, 'login');
                const input = await payload(request, login, true);
                const account = await this.directory.authenticate(input.username, input.password);
                this.beginSession(request, response, account);
                send(response, 200, account);
                return true;
            }
            case `POST ${PREFIX}/auth/external-session`: {
                if (!this.directory.external.enabled) throw new HttpError(404, 'EXTERNAL_IDENTITY_DISABLED');
                this.verifyCsrf(request, this.principal(request)?.session);
                this.rateLimit(request, response, 'login');
                const { assertion } = await payload(request, externalSessionInput);
                if (response.destroyed) return true;
                const account = this.directory.external.exchange(assertion, String(request.headers[CSRF]));
                this.beginSession(request, response, account);
                send(response, 200, account);
                return true;
            }
            case `POST ${PREFIX}/web/session`: {
                if (!sameBrowserOrigin(request)) throw new HttpError(403, 'ORIGIN_FORBIDDEN');
                if (!this.checkBearer(request)) throw new HttpError(401, 'AUTHENTICATION_REQUIRED');
                this.beginSession(request, response, this.directory.account(ADMIN_ID)!);
                send(response, 200, { connected: true });
                return true;
            }
            case `DELETE ${PREFIX}/web/session`:
            case `POST ${PREFIX}/auth/logout`: {
                const principal = this.principal(request);
                if (principal?.session) this.verifyCsrf(request, principal.session);
                else this.verifyOrigin(request);
                this.endSession(request, response);
                send(response, 200, { status: 'logged_out' });
                return true;
            }
            default:
                return false;
        }
    }

    async accountRoute(request: IncomingMessage, response: ServerResponse, url: URL, account: Account, repository: RepositoryIndex) {
        const path = url.pathname;
        const route = `${request.method} ${path}`;
        if (path.startsWith(PREFIX + '/auth/device/')) {
            if (!this.devices) throw new HttpError(404, 'DEVICE_AUTH_DISABLED');
            if (!this.principal(request)?.session || (request.method !== 'GET' && !sameBrowserOrigin(request))) {
                throw new HttpError(403, 'DEVICE_BROWSER_SESSION_REQUIRED');
            }
            if (route === `POST ${PREFIX}/auth/device/inspect`) {
                this.rateLimit(request, response, 'device-review');
                send(response, 200, this.devices.inspect(account, (await payload(request, devicePreview)).code));
                return true;
            }
            if (route === `POST ${PREFIX}/auth/device/decision`) {
                this.rateLimit(request, response, 'device-review');
                const { code, approved } = await payload(request, deviceDecision);
                send(response, 200, this.devices.decide(account, code, approved));
                return true;
            }
            if (route === `GET ${PREFIX}/auth/device/credentials`) {
                send(response, 200, this.devices.list(account));
                return true;
            }
            const id = path.slice((PREFIX + '/auth/device/credentials/').length);
            if (request.method === 'DELETE' && path.startsWith(PREFIX + '/auth/device/credentials/') && deviceId.test(id)) {
                send(response, 200, this.devices.revoke(account, id));
                return true;
            }
            throw new HttpError(404, 'NOT_FOUND');
        }
        if (route === `GET ${PREFIX}/auth/me`) {
            send(response, 200, account);
            return true;
        }
        if (route === `POST ${PREFIX}/auth/password`) {
            const input = await payload(request, changePassword);
            await this.directory.changePassword(account, input.oldPassword, input.newPassword);
            this.endSession(request, response);
            send(response, 200, { status: 'password_changed' });
            return true;
        }
        if (!path.startsWith(`${PREFIX}/admin/`)) return false;
        requireAdmin(account);
        const parts = path.slice(`${PREFIX}/admin/`.length).split('/');
        // Account versions may change while the request body is being received.
        const after = async <T>(schema: z.ZodType<T>) => {
            const input = await payload(request, schema);
            this.directory.requireCurrent(account);
            return input;
        };
        let result: unknown;
        if (route === `GET ${PREFIX}/admin/accounts`) result = this.directory.accounts();
        else if (route === `GET ${PREFIX}/admin/organizations`) result = this.directory.organizations();
        else if (route === `POST ${PREFIX}/admin/organizations`) {
            const input = await after(org);
            send(response, 201, this.directory.saveOrganization(account.id, null, input.name, input.active));
            return true;
        } else if (route === `GET ${PREFIX}/admin/projects`) {
            result = repository.projects().map(project => ({ project, owner: this.directory.owner(String(project.projectId)) ?? null }));
        } else if (route === `GET ${PREFIX}/admin/audit`) {
            const raw = url.searchParams.get('limit') ?? '100';
            if (!/^\d{1,5}$/.test(raw) || Number(raw) < 1) throw new HttpError(400, 'INVALID_LIMIT');
            result = this.directory.audit(Math.min(Number(raw), 500));
        } else if (parts[0] === 'external-directory' && parts.length === 2 && externalIdPattern.test(parts[1])
            && (request.method === 'GET' || request.method === 'PUT')) {
            if (!this.directory.external.enabled) throw new HttpError(404, 'EXTERNAL_IDENTITY_DISABLED');
            if (request.method === 'GET') result = this.directory.external.status(parts[1]);
            else {
                const input = await readPayload(request, externalDirectoryInput, 2 * 1024 * 1024);
                if (response.destroyed) return true;
                requireAdmin(this.directory.requireCurrent(account));
                result = this.directory.external.sync(account.id, parts[1], input);
            }
        } else if (parts[0] === 'accounts' && parts.length === 3 && parts[2] === 'review' && request.method === 'POST') {
            const input = await after(review);
            result = this.directory.review(account.id, parts[1], input.status, input.reason);
        } else if (parts[0] === 'organizations' && parts.length === 2 && request.method === 'PUT') {
            const input = await after(org);
            result = this.directory.saveOrganization(account.id, parts[1], input.name, input.active);
        } else if (parts[0] === 'organizations' && parts[2] === 'members' && parts.length === 3 && request.method === 'GET') {
            result = this.directory.members(parts[1]);
        } else if (parts[0] === 'organizations' && parts[2] === 'members' && parts.length === 4 && request.method === 'PUT') {
            const input = await after(membership);
            result = this.directory.setMembership(account.id, parts[1], parts[3], input.member);
        } else if (parts[0] === 'projects' && parts.length === 3 && parts[2] === 'owner' && request.method === 'PUT') {
            if (!/^[0-9a-f]{12}$/.test(parts[1])) throw new HttpError(400, 'INVALID_PROJECT_ID');
            const input = await after(owner);
            result = this.directory.assign(account.id, parts[1], input.ownerType, input.ownerId);
        } else return false;
        send(response, 200, result);
        return true;
    }
}

export function requireAdmin(account: Account) {
    if (account.role !== 'ADMIN') throw new HttpError(403, 'ACCESS_DENIED');
}
