import { setImmediate as nextTurn } from 'node:timers/promises';
import { strToU8, zipSync } from 'fflate';
import { HttpError } from './http-error.js';
import { documentFont } from './pdf-font.js';
import { wikiExportText } from './wiki-export.js';
import type { SummaryDocument } from './wiki.js';

export const docxMediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const maxInput = 192 * 1024;
const maxParagraphs = 10_000;
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const packageTypes = 'http://schemas.openxmlformats.org/package/2006/content-types';
const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const eastAsianFont = 'Noto Sans SC Thin';
const fontKey = 'BCE4A0AA-F7B2-4692-80C6-17DECE1AE05B';
const fonts = `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="${eastAsianFont}"/><w:lang w:eastAsia="zh-CN"/>`;
const eastAsian = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303F]/u;

function xml(text: string) {
    return text.replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '\uFFFD')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const plain = (text: string) => text.replace(/\\([\\`*_{}\[\]()#+!|~])/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function paragraph(text: string, style: string, indent?: number) {
    const runs = text.split('\t').map(part => `<w:t xml:space="preserve">${xml(part)}</w:t>`).join('<w:tab/>');
    const placement = indent === undefined ? '' : `<w:tabs><w:tab w:val="left" w:pos="${indent}"/></w:tabs>`
        + `<w:ind w:left="${indent}" w:hanging="260"/>`;
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${placement}</w:pPr><w:r>${runs}</w:r></w:p>`;
}

function style(id: string, name: string, paragraphProperties: string, runProperties: string) {
    const inheritance = id === 'Normal' ? ' w:default="1"' : '';
    const base = id === 'Normal' ? '' : '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>';
    return `<w:style w:type="paragraph" w:styleId="${id}"${inheritance}><w:name w:val="${name}"/>${base}`
        + `<w:pPr>${paragraphProperties}</w:pPr><w:rPr>${runProperties}</w:rPr></w:style>`;
}

const styles = [
    style('Normal', 'Normal', '<w:spacing w:after="115" w:line="290" w:lineRule="auto"/>', fonts + '<w:sz w:val="22"/>'),
    style('Title', 'Title', '<w:keepNext/><w:spacing w:after="240"/>', '<w:b/><w:color w:val="000000"/><w:sz w:val="42"/>'),
    style('Revision', 'Revision details', '<w:keepNext/><w:spacing w:after="70"/>', '<w:color w:val="445468"/><w:sz w:val="18"/>'),
    ...Array.from({ length: 6 }, (_, level) => style(`Heading${level + 1}`, `heading ${level + 1}`,
        `<w:keepNext/><w:keepLines/><w:spacing w:before="280" w:after="115"/><w:outlineLvl w:val="${level}"/>`,
        `<w:b/><w:sz w:val="${level === 0 ? 30 : level === 1 ? 26 : 23}"/>`)),
    style('ListParagraph', 'List Paragraph', '<w:spacing w:after="60"/>', ''),
    style('Code', 'Code', '<w:spacing w:after="0" w:line="260" w:lineRule="auto"/><w:ind w:left="240"/>',
        `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="${eastAsianFont}"/><w:sz w:val="19"/>`),
    style('Blank', 'Paragraph spacing', '<w:spacing w:after="35" w:line="100" w:lineRule="exact"/>', '')
].join('');

export async function wikiDocx(page: SummaryDocument, section: number | undefined, signal: AbortSignal) {
    const text = wikiExportText(page, section);
    if (Buffer.byteLength(text) > maxInput) throw new HttpError(413, 'WIKI_DOCX_LIMIT');
    const lines = text.replace(/^\ufeff/, '').split(/\r\n|\n|\r/);
    if (lines.length > maxParagraphs) throw new HttpError(413, 'WIKI_DOCX_LIMIT');
    const beginning = /^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(lines[0]);
    if (section === undefined && beginning && (page.markdown === undefined || plain(beginning[1]) === page.title)) lines.shift();

    const paragraphs = [paragraph(page.title, 'Title'),
        paragraph(`Revision ${page.revision?.number ?? 1}  |  ${page.revision?.id ?? page.id}`, 'Revision'),
        paragraph(`Snapshot ${page.knowledgeSnapshotId ?? 'unavailable'}`, 'Revision')];
    if (section !== undefined) paragraphs.push(paragraph(page.sections[section].title, 'Heading1'));
    let fence = '';
    for (const [index, line] of lines.entries()) {
        if (index % 128 === 0) { await nextTurn(); signal.throwIfAborted(); }
        const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (delimiter && (!fence || (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !delimiter[2].trim()))) {
            fence = fence ? '' : delimiter[1];
        } else if (fence) paragraphs.push(paragraph(page.markdown === undefined && section === undefined ? plain(line) : line, 'Code'));
        else {
            const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
            const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
            if (heading) paragraphs.push(paragraph(plain(heading[2]), 'Heading' + heading[1].length));
            else if (item) paragraphs.push(paragraph((item[2].length === 1 ? '•' : item[2]) + '\t' + plain(item[3]),
                'ListParagraph', 420 + Math.min(6, Math.floor(item[1].replace(/\t/g, '    ').length / 2)) * 250));
            else paragraphs.push(paragraph(plain(line), line.trim() ? 'Normal' : 'Blank'));
        }
    }
    const main = `<w:document xmlns:w="${word}"><w:body>${paragraphs.join('')}<w:sectPr>`
        + '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1230" w:right="1180" w:bottom="1230" w:left="1180"'
        + ' w:header="680" w:footer="680" w:gutter="0"/></w:sectPr></w:body></w:document>';
    const rel = (...parts: [type: string, target: string][]) => `<Relationships xmlns="${packageRelationships}">`
        + parts.map(([type, target], index) => `<Relationship Id="rId${index + 1}" Type="${relationships}/${type}" Target="${target}"/>`).join('')
        + '</Relationships>';
    const embed = eastAsian.test(text) || eastAsian.test(page.title) || (section !== undefined && eastAsian.test(page.sections[section].title));
    const fontTypes = embed ? '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>'
        + '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>' : '';
    const entries: Record<string, string> = {
        '[Content_Types].xml': `<Types xmlns="${packageTypes}">`
            + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
            + `<Default Extension="xml" ContentType="application/xml"/>`
            + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            + fontTypes + '</Types>',
        '_rels/.rels': rel(['officeDocument', 'word/document.xml']),
        'word/document.xml': main,
        'word/_rels/document.xml.rels': embed ? rel(['styles', 'styles.xml'], ['fontTable', 'fontTable.xml']) : rel(['styles', 'styles.xml']),
        'word/styles.xml': `<w:styles xmlns:w="${word}">${styles}</w:styles>`
    };
    if (embed) {
        entries['word/fontTable.xml'] = `<w:fonts xmlns:w="${word}" xmlns:r="${relationships}">`
            + `<w:font w:name="${eastAsianFont}"><w:altName w:val="Noto Sans SC"/><w:family w:val="swiss"/>`
            + `<w:embedRegular r:id="rId1" w:fontKey="{${fontKey}}"/></w:font></w:fonts>`;
        entries['word/_rels/fontTable.xml.rels'] = rel(['font', 'fonts/noto-sans-sc.odttf']);
    }
    const parts = Object.fromEntries(Object.entries(entries).map(([path, content]) => [path, strToU8(declaration + content)]));
    if (embed) {
        const font = Buffer.from(await documentFont());
        const key = Buffer.from(fontKey.replaceAll('-', ''), 'hex').reverse();
        // WordprocessingML obfuscates the first two 16-byte blocks with the reversed key.
        for (let position = 0; position < 32; position++) font[position] ^= key[position % key.length];
        parts['word/fonts/noto-sans-sc.odttf'] = font;
    }
    signal.throwIfAborted();
    const archive = zipSync(parts, { level: 3, mtime: new Date('2000-01-01T00:00:00Z') });
    if (archive.length > 12 * 1024 * 1024) throw new HttpError(413, 'WIKI_DOCX_LIMIT');
    return archive;
}
