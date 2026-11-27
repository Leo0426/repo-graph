import { z } from 'zod';
import { HttpError } from './http-error.js';

const maximumRows = 4096;
const maximumColumns = 128;
const maximumCells = 20_000;
export const csvCell = z.strictObject({ row: z.int().min(1).max(maximumRows), column: z.int().min(1).max(maximumColumns) });
export const csvEdits = z.array(csvCell.extend({ value: z.string().max(32_768).refine(value => !value.includes('\0')) })).min(1).max(128)
    .refine(edits => new Set(edits.map(edit => `${edit.row}/${edit.column}`)).size === edits.length);
export type CsvCell = z.infer<typeof csvCell>;
type Cell = { start: number; end: number; quoted: boolean; value: string };

const delimiter = (char: string | undefined) => char === ',' || char === '\r' || char === '\n' || char === undefined;

function readCell(text: string, start: number): Cell {
    let end = start;
    if (text[start] === '"') {
        while ((end = text.indexOf('"', end + 1)) >= 0) {
            if (text[end + 1] !== '"') {
                if (!delimiter(text[end + 1])) break;
                return { start, end: end + 1, quoted: true, value: text.slice(start + 1, end).replaceAll('""', '"') };
            }
            end++;
        }
        throw new HttpError(400, 'CSV_INVALID');
    }
    while (!delimiter(text[end])) {
        if (text[end] === '"') throw new HttpError(400, 'CSV_INVALID');
        end++;
    }
    return { start, end, quoted: false, value: text.slice(start, end) };
}

function parse(bytes: Uint8Array) {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new HttpError(400, 'CSV_INVALID_ENCODING'); }
    if (text.includes('\0')) throw new HttpError(400, 'CSV_INVALID');
    let cursor = text.startsWith('\uFEFF') ? 1 : 0;
    const rows: Cell[][] = [];
    let cells = 0;
    while (cursor < text.length) {
        if (rows.length >= maximumRows) throw new HttpError(413, 'CSV_GRID_TOO_LARGE');
        const row: Cell[] = [];
        while (true) {
            if (row.length >= maximumColumns || cells++ >= maximumCells) throw new HttpError(413, 'CSV_GRID_TOO_LARGE');
            const cell = readCell(text, cursor);
            row.push(cell);
            cursor = cell.end;
            if (text[cursor] !== ',') break;
            cursor++;
        }
        rows.push(row);
        cursor += text.startsWith('\r\n', cursor) ? 2 : 1;
    }
    return { rows, text };
}

export function csvRows(bytes: Uint8Array) { return parse(bytes).rows.map(row => row.map(cell => cell.value)); }

export function editCsv(bytes: Uint8Array, edits: z.infer<typeof csvEdits>) {
    const { rows, text } = parse(bytes);
    const changes = edits.flatMap(({ row, column, value }) => {
        const cell = rows[row - 1]?.[column - 1];
        if (!cell) throw new HttpError(400, 'CSV_CELL_NOT_FOUND');
        if (cell.value === value) return [];
        if (Buffer.from(value).toString('utf8') !== value) throw new HttpError(400, 'CSV_INVALID_ENCODING');
        const replacement = cell.quoted || !value.length || /[,"\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
        return [{ ...cell, replacement }];
    }).sort((a, b) => a.start - b.start);
    const parts: string[] = [];
    let end = 0;
    for (const change of changes) {
        parts.push(text.slice(end, change.start), change.replacement);
        end = change.end;
    }
    return Buffer.from(parts.join('') + text.slice(end));
}

export function bestCsvCell(rows: string[][], terms: string[]): CsvCell | undefined {
    let result: CsvCell | undefined;
    let high = 0;
    for (const [index, row] of rows.entries()) {
        for (const [field, cell] of row.entries()) {
            const text = cell.toLowerCase();
            const score = terms.reduce((total, term) => total + Number(text.includes(term)), 0);
            if (score <= high) continue;
            high = score;
            result = { row: index + 1, column: field + 1 };
        }
    }
    return result;
}
