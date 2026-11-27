import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HttpError } from './http-error.js';

export type PdfPageText = { text: string; truncated: boolean };
export type ParsedPdf = { pages: PdfPageText[] } | { error: 'PDF_INVALID' | 'PDF_PASSWORD_REQUIRED' | 'PDF_PAGE_LIMIT' };

export function encodePdfPages(pages: PdfPageText[]) {
    return { text: pages.map(page => page.text).join('\n'), pageIndex: JSON.stringify(pages.map(page => [page.text.length, page.truncated])) };
}

export function decodePdfPages(text: string, index: string) {
    let offset = 0;
    return (JSON.parse(index) as [number, boolean][]).map(([length, truncated]) => {
        const page = { text: text.slice(offset, offset + length), truncated };
        offset += length + 1;
        return page;
    });
}

let running = 0;

export async function extractPdfText(bytes: Buffer, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!/%PDF-[12]\.\d/u.test(bytes.subarray(0, 1024).toString('latin1'))) throw new HttpError(422, 'PDF_INVALID');
    if (running >= 3) throw new HttpError(503, 'PDF_PARSER_BUSY');
    const deadline = AbortSignal.timeout(12_000);
    const worker = fork(fileURLToPath(new URL('./pdf-text-worker.js', import.meta.url)), {
        env: {}, execArgv: ['--max-old-space-size=128'], serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        signal: AbortSignal.any([signal, deadline]), killSignal: 'SIGKILL'
    });
    const exited = new Promise(resolve => worker.once('close', resolve));
    running++;
    try {
        const result = await new Promise<ParsedPdf>((resolve, reject) => {
            worker.once('message', message => resolve(message as ParsedPdf));
            worker.once('error', reject);
            worker.once('exit', () => reject(new Error('PDF_WORKER_EXIT')));
            worker.send(bytes, error => { if (error) reject(error); });
        });
        if ('error' in result) throw new HttpError(result.error === 'PDF_PAGE_LIMIT' ? 413 : 422, result.error);
        return result.pages;
    } catch (error) {
        signal.throwIfAborted();
        if (deadline.aborted) throw new HttpError(504, 'PDF_PARSE_TIMEOUT');
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, 'PDF_PARSER_UNAVAILABLE');
    } finally {
        worker.kill('SIGKILL');
        await exited;
        running--;
    }
}

export function bestPdfPage(pages: PdfPageText[], terms: string[]) {
    let winner = 0;
    let rank = -1;
    for (const [index, page] of pages.entries()) {
        const text = page.text.toLowerCase();
        const score = terms.filter(term => text.includes(term)).length;
        if (score > rank) { rank = score; winner = index; }
    }
    return winner + 1;
}
