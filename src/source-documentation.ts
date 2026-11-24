import type { Node } from '@vscode/tree-sitter-wasm';

export function documentationSummary(text: string) {
    const lines = text.slice(0, 8_192).split(/\r\n|\n|\r/);
    const paragraph: string[] = [];
    for (const raw of lines) {
        const line = raw.trim().replace(/^\*\s?/, '').trim();
        if (line.startsWith('@') || (!line && paragraph.length)) break;
        if (line) paragraph.push(line);
        if (paragraph.join(' ').length >= 240) break;
    }
    const summary = paragraph.join(' ');
    return (summary.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? summary).slice(0, 240).trimEnd();
}

export function blockDocumentation(comment: string) {
    if (!comment.startsWith('/**') && !comment.startsWith('/*!')) return '';
    return documentationSummary(comment.slice(3, -2));
}

export function precedingDocumentation(node: Node) {
    const comment = node.previousNamedSibling;
    if (!comment || !['block_comment', 'comment'].includes(comment.type)
        || node.startPosition.row - comment.endPosition.row > 1) return '';
    return blockDocumentation(comment.text);
}
