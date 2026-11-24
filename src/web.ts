import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

const assets = new Map([
    ['/', { file: '../public/index.html', type: 'text/html; charset=utf-8' }],
    ['/login', { file: '../public/index.html', type: 'text/html; charset=utf-8' }],
    ['/workbench.css', { file: '../public/workbench.css', type: 'text/css; charset=utf-8' }],
    ['/workbench.js', { file: './web-client.js', type: 'application/javascript; charset=utf-8' }]
]);

const wikiPrototypeAssets = new Map([
    ['/', { file: '../public/wiki-prototype.html', type: 'text/html; charset=utf-8' }],
    ['/wiki-prototype.css', { file: '../public/wiki-prototype.css', type: 'text/css; charset=utf-8' }],
    ['/wiki-prototype.js', { file: './wiki-prototype.js', type: 'application/javascript; charset=utf-8' }],
    ['/wiki-prototype-cover.jpg', { file: '../public/wiki-prototype-cover.jpg', type: 'image/jpeg' }]
]);

export function localHost(request: IncomingMessage) {
    return /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(request.headers.host ?? '');
}

export async function webAsset(request: IncomingMessage, response: ServerResponse, url: URL) {
    const { pathname, searchParams } = url;
    const prototype = process.env.NODE_ENV === 'development' && (pathname !== '/'
        || (searchParams.get('view') === 'wiki' && /^(A|B|C)$/.test(searchParams.get('variant') ?? '')))
        ? wikiPrototypeAssets.get(pathname) : undefined;
    const asset = prototype ?? assets.get(pathname);
    if (!asset || !localHost(request) || (request.method !== 'GET' && request.method !== 'HEAD')) return false;
    const body = await readFile(new URL(asset.file, import.meta.url));
    response.writeHead(200, {
        'Content-Type': asset.type, 'Content-Length': body.length, 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
            + (prototype ? "; img-src 'self'" : ''),
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
    }).end(request.method === 'HEAD' ? undefined : body);
    return true;
}

export function sameBrowserOrigin(request: IncomingMessage) {
    return localHost(request) && request.headers.origin === `http://${request.headers.host}`;
}
