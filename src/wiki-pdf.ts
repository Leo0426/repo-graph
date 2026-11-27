import { setImmediate as nextTurn } from 'node:timers/promises';
import PDFDocument from 'pdfkit';
import { HttpError } from './http-error.js';
import { documentFont } from './pdf-font.js';
import { wikiExportText } from './wiki-export.js';
import type { SummaryDocument } from './wiki.js';

const maxInputBytes = 192 * 1024;
const maxOutputBytes = 16 * 1024 * 1024;
const maxPages = 180;
const fencePattern = /^ {0,3}(`{3,}|~{3,})/;
const headingPattern = /^ {0,3}#{1,6}\s+(.+)$/;
const listPattern = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const plain = (text: string) => text.replace(/\\([\\`*_{}\[\]()#+!|~])/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export async function wikiPdf(page: SummaryDocument, section: number | undefined, signal: AbortSignal) {
    const text = wikiExportText(page, section);
    if (Buffer.byteLength(text) > maxInputBytes) throw new HttpError(413, 'WIKI_PDF_LIMIT');
    const font = await documentFont();
    signal.throwIfAborted();
    const document = new PDFDocument({ size: 'A4', margin: 46, bufferPages: true, lang: 'zh-CN', info: { Title: page.title } });
    const chunks: Buffer[] = [];
    let size = 0;
    let pageCount = 1;
    document.on('pageAdded', () => { if (++pageCount > maxPages) throw new HttpError(413, 'WIKI_PDF_LIMIT'); });
    const output = new Promise<Buffer>((resolve, reject) => {
        document.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxOutputBytes) document.destroy(new HttpError(413, 'WIKI_PDF_LIMIT'));
            else chunks.push(chunk);
        });
        document.once('error', reject);
        document.once('end', () => resolve(Buffer.concat(chunks)));
        document.once('close', () => reject(new HttpError(500, 'WIKI_PDF_FAILED')));
    });
    void output.catch(() => undefined);
    try {
        document.font(font).fontSize(23).fillColor('#16263c').text(page.title).moveDown(0.35);
        document.fontSize(9).fillColor('#435469')
            .text(`Revision ${page.revision?.number ?? 1}  |  ${page.revision?.id ?? page.id}`)
            .text(`Snapshot ${page.knowledgeSnapshotId ?? 'unavailable'}`).moveDown();
        if (section !== undefined) document.fontSize(15).fillColor('#16263c').text(page.sections[section].title).moveDown(0.5);
        let fence = '';
        const lines = text.replace(/^\ufeff/, '').split(/\r\n|\n|\r/);
        if (section === undefined && page.markdown === undefined && lines[0].startsWith('# ')) lines.shift();
        for (const [index, line] of lines.entries()) {
            if (index % 64 === 0) { await nextTurn(); signal.throwIfAborted(); }
            const delimiter = fencePattern.exec(line)?.[1];
            if (delimiter && (!fence || (delimiter[0] === fence[0] && delimiter.length >= fence.length))) {
                fence = fence ? '' : delimiter;
                document.moveDown(0.25);
                continue;
            }
            if (fence) {
                document.fontSize(9).fillColor('#253747').text(line.replace(/\t/g, '    ') || ' ', { indent: 10, lineGap: 1 });
                continue;
            }
            const heading = headingPattern.exec(line);
            if (heading) {
                document.moveDown(0.45).fontSize(14).fillColor('#16263c').text(plain(heading[1])).moveDown(0.25);
                continue;
            }
            if (!line.trim()) { document.moveDown(0.45); continue; }
            const item = listPattern.exec(line);
            document.fontSize(10.5).fillColor('#253747')
                .text(item ? `${item[2].length === 1 ? '-' : item[2]}  ${plain(item[3])}` : plain(line), item
                    ? { indent: Math.min(38, 9 + item[1].length * 4), lineGap: 2 }
                    : { lineGap: 2 });
        }
        const pages = document.bufferedPageRange();
        for (let index = 0; index < pages.count; index++) {
            document.switchToPage(pages.start + index);
            const { width, height, margins } = document.page;
            const label = `${index + 1} / ${pages.count}`;
            document.fontSize(8).fillColor('#526278');
            document.text(label, width - margins.right - document.widthOfString(label), height - 29, { lineBreak: false });
        }
        signal.throwIfAborted();
        document.end();
        return await output;
    } catch (error) {
        document.destroy();
        if (signal.aborted) signal.throwIfAborted();
        if (error instanceof HttpError) throw error;
        throw new HttpError(500, 'WIKI_PDF_FAILED');
    }
}
