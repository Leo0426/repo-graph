import type { IncomingMessage } from 'node:http';
import type { ZodType } from 'zod';
import { HttpError } from './http-error.js';

export async function readPayload<T>(request: IncomingMessage, schema: ZodType<T>, maxBytes: number,
    options: { allowForm?: boolean; allowSarif?: boolean } = {}): Promise<T> {
    const mime = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
    const json = mime === 'application/json' || (options.allowSarif && mime === 'application/sarif+json');
    if (!json && !(options.allowForm && mime === 'application/x-www-form-urlencoded')) {
        throw new HttpError(415, 'UNSUPPORTED_CONTENT_TYPE');
    }
    if (Number(request.headers['content-length']) > maxBytes) throw new HttpError(413, 'BODY_TOO_LARGE');
    const buffers: Buffer[] = [];
    let length = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += bytes.length;
        if (length > maxBytes) throw new HttpError(413, 'BODY_TOO_LARGE');
        buffers.push(bytes);
    }
    let value: unknown;
    try {
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(buffers, length));
        value = json ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    } catch {
        throw new HttpError(400, 'INVALID_INPUT');
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new HttpError(400, 'INVALID_INPUT');
    return parsed.data;
}
