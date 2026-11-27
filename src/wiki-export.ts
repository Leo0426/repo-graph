import type { SummaryDocument } from './wiki.js';
import { HttpError } from './http-error.js';

export const wikiArtifactFormats = ['markdown', 'pdf', 'docx'] as const;

const markup = (value: string) => value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (value: string) => markup(value.replace(/[\x00-\x1f\x7f]/g, ' '))
    .replace(/[\\`*_{}\[\]()#+!|~]/g, '\\$&');

function bodyMarkdown(text: string) {
    const lines: string[] = [];
    let open = '';
    for (const line of text.split(/\r?\n/)) {
        const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (open) {
            if (fence && fence[1][0] === open[0] && fence[1].length >= open.length && !fence[2].trim()) open = '';
            lines.push(line);
        } else if (fence && !fence[2].includes(fence[1][0])) {
            open = fence[1];
            lines.push(markup(line));
        } else lines.push(markup(line));
    }
    if (open) lines.push(open);
    return lines.join('\n');
}

export function wikiMarkdown(document: SummaryDocument) {
    if (document.markdown !== undefined) return document.markdown;
    const lines = ['# ' + inline(document.title), '', '- Version ' + document.docVersion,
        '- Generated ' + document.generatedAt, '- Status ' + document.status];
    if (document.perspective) lines.push('- Perspective ' + document.perspective);
    if (document.model) lines.push('- Model ' + inline(document.model));
    if (document.knowledgeSnapshotId) lines.push('- Published snapshot ' + document.knowledgeSnapshotId);
    if (document.legacyImported) lines.push('- Document migrated from the legacy instance');
    for (const section of document.sections) {
        lines.push('', '## ' + inline(section.title), '');
        if (section.source === 'llm') lines.push('Model-generated section', '');
        lines.push(bodyMarkdown(section.body));
    }
    if (document.citations.length) lines.push('', '## Source references', '',
        ...document.citations.map(item => '- ' + inline(item.qualifiedName) + ' · ' + inline(item.filePath) + ':' + item.startLine + '–' + item.endLine));
    if (document.missingInfo.length) lines.push('', '## Missing information', '', ...document.missingInfo.map(item => '- ' + inline(item)));
    return lines.join('\n') + '\n';
}

export function wikiExportText(page: SummaryDocument, section: number | undefined) {
    if (section === undefined) return wikiMarkdown(page);
    const selected = page.sections[section];
    if (!selected) throw new HttpError(404, 'WIKI_SECTION_NOT_FOUND');
    return selected.body;
}
