import { savedDeviceCredential } from './device-cli.js';
import { serviceContractShape } from './service-contract.js';
import type { ServiceQuery } from './service-contract.js';

interface Session { cookie: string; csrf: string }
interface Result { status: number; ok: boolean; body: unknown; requestId?: string }

function readCookie(response: Response, name: string) {
    const pair = response.headers.getSetCookie().map(value => value.split(';', 1)[0])
        .find(value => value.startsWith(`${name}=`));
    if (!pair) throw new Error('Account sign-in failed');
    return pair;
}

export class RepoGraphClient {
    private readonly app: URL;
    private readonly token: string | undefined;
    private readonly username: string | undefined;
    private readonly password: string | undefined;
    private session: Session | undefined;
    private signingIn: Promise<Session> | undefined;

    constructor(env: NodeJS.ProcessEnv = process.env) {
        this.username = env.REPOGRAPH_USERNAME;
        this.password = env.REPOGRAPH_PASSWORD;
        const app = new URL(env.REPOGRAPH_BASE_URL ?? 'http://127.0.0.1:8080');
        if (!['http:', 'https:'].includes(app.protocol) || app.username || app.password || app.search || app.hash) {
            throw new Error('INVALID_SERVICE_URL');
        }
        this.app = app;
        this.token = env.REPOGRAPH_ACCESS_TOKEN ?? (this.username ? undefined : savedDeviceCredential(app, env));
        if (!!this.username !== !!this.password || (!this.token && !this.username)) throw new Error('CREDENTIALS_REQUIRED');
    }

    private apiPath(path: string) { return new URL(`${this.app.pathname.replace(/\/$/, '')}/api/v1${path}`, this.app); }

    private async signIn() {
        const options = { redirect: 'error', signal: AbortSignal.timeout(8_000) } as const;
        const preflight = await fetch(this.apiPath('/auth/csrf'), options);
        if (!preflight.ok) throw new Error('Account sign-in failed');
        const nonce = readCookie(preflight, 'repograph_csrf');
        const { token: csrf } = await preflight.json();
        const login = await fetch(this.apiPath('/auth/login'), {
            ...options, method: 'POST', body: JSON.stringify({ username: this.username, password: this.password }),
            headers: { Cookie: nonce, Origin: this.app.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }
        });
        try {
            if (!login.ok) throw new Error('Account sign-in failed');
            const cookie = readCookie(login, 'repograph_session');
            const current = await fetch(this.apiPath('/auth/csrf'), { ...options, headers: { Cookie: cookie } });
            if (!current.ok) throw new Error('Account sign-in failed');
            const ready = await current.json();
            if (typeof ready.token !== 'string') throw new Error('Account sign-in failed');
            return { cookie, csrf: ready.token };
        } finally { await login.body?.cancel(); }
    }

    private getSession() {
        if (this.session) return this.session;
        this.signingIn ??= this.signIn().then(result => { this.session = result; return result; })
            .finally(() => { this.signingIn = undefined; });
        return this.signingIn;
    }

    async request(path: string, query: ServiceQuery = {}, signal?: AbortSignal, method = 'GET',
        payload?: string, key?: string): Promise<Result> {
        const url = this.apiPath(path);
        for (const [name, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(name, String(value));
        const deadline = AbortSignal.timeout(15_000);
        const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
        const send = (active: Session | undefined) => fetch(url, {
            method, signal: requestSignal, redirect: 'error', body: payload,
            headers: {
                ...(active ? { Cookie: active.cookie, Origin: this.app.origin, 'X-CSRF-Token': active.csrf } : { Authorization: `Bearer ${this.token}` }),
                ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...(key ? { 'Idempotency-Key': key } : {})
            }
        });
        const active = this.username ? await this.getSession() : undefined;
        let response = await send(active);
        if (response.status === 401 && active) {
            await response.body?.cancel();
            if (this.session === active) this.session = undefined;
            response = await send(await this.getSession());
        }
        const requestId = response.headers.get('X-Request-Id') ?? undefined;
        const body = response.status === 204 ? null : await response.json().catch(error => {
            if (response.ok) throw error;
            return { error: 'SERVICE_RESPONSE_UNREADABLE' };
        });
        return { status: response.status, ok: response.ok, body, requestId };
    }

    async checkFeature(feature: string, signal?: AbortSignal): Promise<Result | undefined> {
        const discovery = await this.request('/capabilities', {}, signal);
        if (!discovery.ok && discovery.status !== 404 && discovery.status !== 501) return discovery;
        const contract = serviceContractShape.safeParse(discovery.body);
        if (discovery.ok && contract.success && contract.data.features[feature]) return undefined;
        return { status: 501, ok: false, body: { error: 'SERVICE_CAPABILITY_UNAVAILABLE', feature }, requestId: discovery.requestId };
    }
}
