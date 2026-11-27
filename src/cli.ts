import { ZodError } from 'zod';
import { askSessionPayloadBytes } from './ask-attachments.js';
import { authorizeDevice } from './device-cli.js';
import { RepoGraphClient } from './service-client.js';
import { serviceOperations } from './service-contract.js';

function help() {
    const operations = Object.entries(serviceOperations).map(([name, spec]) => `  ${name}\n    ${spec.description}`);
    console.log([
        'Usage: <launcher> <operation> [JSON]',
        'Use - in place of JSON to read from standard input.',
        'Set REPOGRAPH_BASE_URL and use REPOGRAPH_ACCESS_TOKEN, or REPOGRAPH_USERNAME and REPOGRAPH_PASSWORD.',
        '',
        '  capabilities',
        '    Read the connected service contract.',
        '  projects',
        '    List authorized repositories.',
        '  authorize_device [name]',
        '    Save a read-only credential after browser approval.',
        ...operations
    ].join('\n'));
}

async function input(argument: string | undefined, maximum = 128 * 1024) {
    if (argument === undefined) return {};
    if (argument !== '-') {
        if (Buffer.byteLength(argument) > maximum) throw new Error('INPUT_TOO_LARGE');
        return JSON.parse(argument) as unknown;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
        const buffer = Buffer.from(chunk as Buffer);
        bytes += buffer.length;
        if (bytes > maximum) throw new Error('INPUT_TOO_LARGE');
        chunks.push(buffer);
    }
    return bytes ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown : {};
}

async function main() {
    const [name, json, ...unexpected] = process.argv.slice(2);
    if (!name || name === '--help' || name === '-h') { help(); return; }
    const builtIn = name === 'capabilities' ? '/capabilities' : name === 'projects' ? '/projects' : undefined;
    if (name === 'authorize_device' && !unexpected.length) {
        const site = new URL(process.env.REPOGRAPH_BASE_URL ?? 'http://127.0.0.1:8080');
        if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password || site.search || site.hash) {
            throw new Error('INVALID_SERVICE_URL');
        }
        await authorizeDevice(site, json ?? 'CLI');
        return;
    }
    if (unexpected.length || (builtIn ? json !== undefined : !Object.hasOwn(serviceOperations, name))) {
        throw new Error('INVALID_ARGUMENTS');
    }
    const client = new RepoGraphClient();
    const spec = builtIn ? undefined : serviceOperations[name as keyof typeof serviceOperations];
    const call = spec?.request(await input(json, name === 'create_ask_session' ? askSessionPayloadBytes : undefined));
    const unavailable = spec ? await client.checkFeature(call?.feature ?? spec.feature) : undefined;
    const result = unavailable ?? (call
        ? await client.request(call.path, call.query, undefined, call.method, JSON.stringify(call.body), call.idempotencyKey)
        : await client.request(builtIn!));
    if (result.ok) console.log(JSON.stringify(result.body, null, 2));
    else {
        console.error(JSON.stringify({ status: result.status, requestId: result.requestId, result: result.body }));
        process.exitCode = 1;
    }
}

try { await main(); }
catch (error) {
    const codes = ['CREDENTIALS_REQUIRED', 'INVALID_SERVICE_URL', 'INVALID_ARGUMENTS', 'INPUT_TOO_LARGE',
        'DEVICE_AUTH_DISABLED', 'DEVICE_AUTH_REQUEST_FAILED', 'DEVICE_AUTH_DENIED', 'DEVICE_CODE_EXPIRED',
        'DEVICE_VERIFICATION_ORIGIN_MISMATCH', 'DEVICE_CREDENTIAL_UNREADABLE', 'DEVICE_AUTH_HTTPS_REQUIRED'];
    const code = error instanceof SyntaxError || error instanceof ZodError ? 'INVALID_ARGUMENTS'
        : error instanceof Error && codes.includes(error.message) ? error.message : 'SERVICE_REQUEST_FAILED';
    console.error(JSON.stringify({ error: code }));
    process.exitCode = code === 'SERVICE_REQUEST_FAILED' ? 1 : 2;
}
