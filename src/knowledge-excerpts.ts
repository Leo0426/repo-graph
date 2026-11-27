import { HttpError } from './http-error.js';

export function clipExcerpt(text: string) {
    return text.slice(0, 1200).replace(/[\uD800-\uDBFF]$/, '');
}

export function lineExcerpt(text: string, first: number) {
    const lines = text.split(/\r\n|\n|\r/);
    if (first > lines.length) throw new HttpError(400, 'ASK_CONTEXT_LINE_OUT_OF_RANGE');
    const excerpt = clipExcerpt(lines.slice(first - 1, first + 24).join('\n'));
    return { excerpt, startLine: first, endLine: first + (excerpt.match(/\n/g)?.length ?? 0) };
}

export function queryTerms(query: string) {
    return query.toLowerCase().match(/[\p{L}\p{N}_]+/gu)?.slice(0, 20) ?? [];
}

export function matchedLine(text: string, query: string) {
    const terms = queryTerms(query).slice(0, 12);
    if (!terms.length) return 1;
    const target = text.split(/\r\n|\n|\r/).findIndex(line => terms.some(term => line.toLowerCase().includes(term)));
    return Math.max(1, target - 2);
}

export function queryExcerpt(text: string, terms: string[]) {
    const lines = text.split(/\r\n|\n|\r/);
    let first = 0;
    let offset = 0;
    for (const [index, line] of lines.entries()) {
        const lower = line.toLowerCase();
        const column = Math.min(...terms.map(term => lower.indexOf(term)).filter(position => position >= 0));
        if (Number.isFinite(column)) {
            first = index;
            offset = column >= 950 ? column - 100 : 0;
            break;
        }
    }
    const sample = lines.slice(first, first + 25).join('\n').slice(offset).replace(/^[\uDC00-\uDFFF]/, '');
    const excerpt = clipExcerpt(sample);
    return { excerpt, startLine: first + 1, endLine: first + 1 + (excerpt.match(/\n/g)?.length ?? 0),
        truncated: first !== 0 || offset !== 0 || lines.length > 25 || sample.length !== excerpt.length };
}
