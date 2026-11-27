import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy, TextContent } from 'pdfjs-dist/types/src/display/api.js';
import type { ParsedPdf, PdfPageText } from './pdf-text.js';

const pdfAssets = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const pageLimit = 180;
const pageTextLimit = 48_000;
const documentTextLimit = 600_000;

async function readPage(page: PDFPageProxy, limit: number): Promise<PdfPageText> {
    const reader = page.streamTextContent().getReader();
    let text = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) return { text: text.trimEnd(), truncated: false };
            for (const item of (value as TextContent).items) {
                if (!('str' in item)) continue;
                const fragment = item.str.replace(/[\u0000\r]/gu, '') + (item.hasEOL ? '\n' : '');
                const remaining = limit - text.length;
                if (fragment.length > remaining) {
                    text += fragment.slice(0, remaining).replace(/[\uD800-\uDBFF]$/u, '');
                    return { text, truncated: true };
                }
                text += fragment;
            }
        }
    } finally {
        await reader.cancel().catch(() => undefined);
        page.cleanup();
    }
}

async function extract(bytes: Uint8Array): Promise<ParsedPdf> {
    const task = getDocument({
        data: new Uint8Array(bytes), verbosity: VerbosityLevel.ERRORS,
        useSystemFonts: false, useWorkerFetch: false, useWasm: false, disableFontFace: true, stopAtErrors: true,
        cMapUrl: join(pdfAssets, 'cmaps') + sep, standardFontDataUrl: join(pdfAssets, 'standard_fonts') + sep
    });
    try {
        const pdf = await task.promise;
        if (!pdf.numPages) return { error: 'PDF_INVALID' };
        if (pdf.numPages > pageLimit) return { error: 'PDF_PAGE_LIMIT' };
        const pages: PdfPageText[] = [];
        let remaining = documentTextLimit;
        for (let page = 1; page <= pdf.numPages; page++) {
            const result = remaining ? await readPage(await pdf.getPage(page), Math.min(remaining, pageTextLimit))
                : { text: '', truncated: true };
            remaining -= result.text.length;
            pages.push(result);
        }
        return { pages };
    } catch (error) {
        return { error: (error as Error).name === 'PasswordException' ? 'PDF_PASSWORD_REQUIRED' : 'PDF_INVALID' };
    } finally { await task.destroy(); }
}

process.once('message', (data: Uint8Array) => {
    void extract(data).then(result => process.send?.(result), () => process.send?.({ error: 'PDF_INVALID' }));
});
