import type { ServerResponse } from 'node:http';

export class HttpError extends Error {
    constructor(readonly status: number, code: string) {
        super(code);
    }
}

export function send(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    }).end(JSON.stringify(body));
}
