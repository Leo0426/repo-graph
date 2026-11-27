import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { deviceBearer, deviceScope } from './device-authorization.js';
import { digest } from './source.js';

const clientId = 'repograph-cli';
const startResult = z.object({ device_code: z.string().regex(/^[A-Za-z0-9_-]{43}$/), user_code: z.string().regex(/^[A-Z0-9-]{9}$/),
    verification_uri: z.url(), expires_in: z.int().min(1).max(600), interval: z.int().min(5).max(60), scope: z.literal(deviceScope) });
const tokenResult = z.object({ access_token: z.string().regex(/^rgd_[A-Za-z0-9_-]{43}$/), token_type: z.literal('Bearer'),
    expires_in: z.int().min(1).max(7 * 86_400), scope: z.literal(deviceScope) });

function credentialPath(site: URL, env: NodeJS.ProcessEnv) {
    const service = site.origin + site.pathname.replace(/\/$/, '');
    return join(env.REPOGRAPH_DEVICE_CREDENTIAL_DIR ?? join(homedir(), '.config', 'repograph', 'devices'), digest(service) + '.json');
}

export function savedDeviceCredential(site: URL, env: NodeJS.ProcessEnv) {
    try {
        const stored = JSON.parse(readFileSync(credentialPath(site, env), 'utf8')) as { token?: string; expires?: number };
        if (stored.token && stored.expires && stored.expires > Date.now() && deviceBearer.test('Bearer ' + stored.token)) return stored.token;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('DEVICE_CREDENTIAL_UNREADABLE');
    }
    return undefined;
}

export async function authorizeDevice(site: URL, name: string, env: NodeJS.ProcessEnv = process.env) {
    if (site.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(site.hostname)) {
        throw new Error('DEVICE_AUTH_HTTPS_REQUIRED');
    }
    const endpoint = (action: string) => new URL(site.pathname.replace(/\/$/, '') + '/api/v1/auth/device/' + action, site);
    const post = (action: string, fields: Record<string, string>) => fetch(endpoint(action), {
        method: 'POST', body: new URLSearchParams({ client_id: clientId, ...fields }), redirect: 'error', signal: AbortSignal.timeout(8000)
    });
    const response = await post('start', { client_name: name, scope: deviceScope });
    if (response.status === 404) throw new Error('DEVICE_AUTH_DISABLED');
    if (!response.ok) throw new Error('DEVICE_AUTH_REQUEST_FAILED');
    const started = startResult.parse(await response.json());
    const verification = new URL(started.verification_uri);
    if (verification.origin !== site.origin || verification.username || verification.password) throw new Error('DEVICE_VERIFICATION_ORIGIN_MISMATCH');
    console.log('Open ' + verification.href);
    console.log('Enter code ' + started.user_code);
    const deadline = Date.now() + started.expires_in * 1000;
    let interval = started.interval;
    while (Date.now() + interval * 1000 < deadline) {
        await delay(interval * 1000);
        const response = await post('token', { device_code: started.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
        const body = await response.json() as { error?: string; interval?: number };
        if (response.ok) {
            const issued = tokenResult.parse(body);
            const path = credentialPath(site, env);
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            const pending = path + '.' + randomUUID() + '.tmp';
            try {
                await writeFile(pending, JSON.stringify({ token: issued.access_token, expires: Date.now() + issued.expires_in * 1000 }),
                    { flag: 'wx', mode: 0o600 });
                await rename(pending, path);
            } finally { await rm(pending, { force: true }); }
            console.log('Authorized ' + site.origin);
            return;
        }
        if (body.error === 'slow_down' || body.error === 'authorization_pending') {
            interval = Math.min(120, Math.max(interval, body.interval ?? (body.error === 'slow_down' ? interval + 5 : interval)));
            continue;
        }
        if (body.error === 'access_denied') throw new Error('DEVICE_AUTH_DENIED');
        if (body.error === 'expired_token') break;
        throw new Error('DEVICE_AUTH_REQUEST_FAILED');
    }
    throw new Error('DEVICE_CODE_EXPIRED');
}
