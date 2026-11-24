import { HttpError } from './http-error.js';

export interface DiffHunk {
    oldStart: number; oldCount: number; newStart: number; newCount: number; header: string; lines: string[];
}
export interface DiffFile {
    oldPath: string; newPath: string; kind: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' | 'BINARY';
    hunks: DiffHunk[]; errors: string[]; hunkCandidates: { ordinal: number; hunkIndex: number | null; error: string }[];
}

const headerPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;
const noNewline = '\\ No newline at end of file';
const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

function gitPath(text: string) {
    if (!text.startsWith('"')) return text;
    if (!text.endsWith('"')) return undefined;
    const pieces: Uint8Array[] = [];
    const parts = text.slice(1, -1).matchAll(/[^"\\]+|\\(?:[0-3][0-7]{2}|[abtnvfr"\\])|./gu);
    for (const [part] of parts) {
        if (part === '"' || part === '\\') return undefined;
        if (!part.startsWith('\\')) pieces.push(Buffer.from(part));
        else if (part.length === 4) pieces.push(Uint8Array.of(parseInt(part.slice(1), 8)));
        else pieces.push(Uint8Array.of(escapes[part[1]]));
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(pieces)); }
    catch { return undefined; }
}

function safePath(text: string | undefined, prefix = '', nullAllowed = false) {
    if (text === '/dev/null' && nullAllowed) return '';
    const name = text?.startsWith(prefix) ? text.slice(prefix.length) : text;
    if (!name || name.length > 4096 || /[\\\u0000-\u001f\u007f]/.test(name) || /^[a-zA-Z]:/.test(name)
        || name.split('/').some(part => !part || part === '.' || part === '..')) return undefined;
    return name;
}

function headerPath(text: string) { return gitPath(text.split('\t', 1)[0]); }

function fileHeader(line: string) {
    const token = line.slice('diff --git '.length);
    const quoted = /^("(?:\\.|[^"\\])*") ("(?:\\.|[^"\\])*"|b\/.+)$/.exec(token);
    const plain = /^(a\/.+) (b\/.+|"(?:\\.|[^"\\])*")$/.exec(token);
    const match = quoted ?? plain;
    return match ? [gitPath(match[1]), gitPath(match[2])] : [];
}

function coordinates(header: string) {
    const match = headerPattern.exec(header);
    if (!match) return undefined;
    const [oldStart, oldCount, newStart, newCount] = [match[1], match[2] ?? '1', match[3], match[4] ?? '1'].map(Number);
    const counts = [oldStart, oldCount, newStart, newCount];
    if (counts.some(value => !Number.isSafeInteger(value) || value > 2_147_483_647)
        || (!oldCount && !newCount) || (!oldStart && oldCount) || (!newStart && newCount)
        || oldStart + oldCount > 2_147_483_648 || newStart + newCount > 2_147_483_648) return undefined;
    return { oldStart, oldCount, newStart, newCount };
}

export function parseDiff(diff: string) {
    const lines = diff.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    const files: DiffFile[] = [];
    const errors = new Set<string>();
    let current: DiffFile | undefined;
    let candidates = 0;

    function issue(file: DiffFile, code: string) { if (!file.errors.includes(code)) file.errors.push(code); }

    function begin(oldPath = '', newPath = '') {
        if (files.length >= 2048) throw new HttpError(413, 'DIFF_FILE_LIMIT');
        current = { oldPath, newPath, kind: 'MODIFIED', hunks: [], errors: [], hunkCandidates: [] };
        files.push(current);
        return current;
    }

    function paths(file: DiffFile, before: string | undefined, after: string | undefined, prefixes: boolean) {
        const oldPath = safePath(before, prefixes ? 'a/' : '', true);
        const newPath = safePath(after, prefixes ? 'b/' : '', true);
        if (oldPath === undefined || newPath === undefined || (!oldPath && !newPath)) issue(file, 'INVALID_DIFF_PATH');
        file.oldPath = oldPath ?? '';
        file.newPath = newPath ?? '';
    }

    function pathPair(index: number) { return lines[index].startsWith('--- ') && lines[index + 1]?.startsWith('+++ '); }

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) {
            const name = safePath(gitPath(line.slice(line.indexOf(' ', 5) + 1))) ?? '';
            issue(begin(name, name), 'UNSUPPORTED_COMBINED_DIFF');
            continue;
        }
        if (line.startsWith('diff --git ')) {
            const [from, to] = fileHeader(line);
            const file = begin();
            if (from !== undefined && to !== undefined) paths(file, from, to, true);
            continue;
        }
        if (pathPair(index)) {
            const file = !current || current.hunkCandidates.length || current.kind === 'BINARY' ? begin() : current;
            const before = headerPath(line.slice(4));
            const after = headerPath(lines[++index].slice(4));
            const standard = (before === '/dev/null' || before?.startsWith('a/')) && (after === '/dev/null' || after?.startsWith('b/'));
            paths(file, before, after, !!standard);
            continue;
        }
        if (line.startsWith('@@')) {
            if (++candidates > 8192) throw new HttpError(413, 'DIFF_HUNK_LIMIT');
            const file = current ?? begin();
            const coords = coordinates(line);
            const body: string[] = [];
            let old = 0;
            let next = 0;
            let markerAllowed = false;
            let invalid = !coords || file.kind === 'BINARY';
            let cursor = index + 1;
            for (; cursor < lines.length; cursor++) {
                const text = lines[cursor];
                if (text.startsWith('diff --git ') || text.startsWith('@@')) break;
                if (pathPair(cursor) && (!coords || old >= coords.oldCount && next >= coords.newCount)) break;
                if (text === noNewline) {
                    if (!markerAllowed) invalid = true;
                    markerAllowed = false;
                    body.push(text);
                    continue;
                }
                const first = text[0];
                if (first !== '+' && first !== '-' && first !== ' ') {
                    if (text) invalid = true;
                    break;
                }
                if (first !== '+') old++;
                if (first !== '-') next++;
                markerAllowed = true;
                body.push(text);
            }
            const previous = file.hunks.at(-1);
            if (!coords || old !== coords.oldCount || next !== coords.newCount || !file.oldPath && old > 0 || !file.newPath && next > 0
                || previous && (coords.oldStart < previous.oldStart + previous.oldCount || coords.newStart < previous.newStart + previous.newCount)) invalid = true;
            if (invalid) issue(file, 'INVALID_DIFF_HUNK');
            const hunkIndex = !invalid && coords ? file.hunks.push({ ...coords, header: line, lines: body }) - 1 : null;
            file.hunkCandidates.push({ ordinal: file.hunkCandidates.length + 1, hunkIndex, error: invalid ? 'INVALID_DIFF_HUNK' : '' });
            index = cursor - 1;
            continue;
        }
        if (!current && !/^(?:Binary files |GIT binary patch)/.test(line)) continue;
        const file = current ?? begin();
        if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.kind = 'BINARY';
        else if (file.kind === 'BINARY') continue;
        else if (line.startsWith('new file mode ')) file.oldPath = '';
        else if (line.startsWith('deleted file mode ')) file.newPath = '';
        else if (/^(?:rename|copy) (?:from|to) /.test(line)) {
            const match = /^(rename|copy) (from|to) (.*)$/.exec(line)!;
            const path = safePath(gitPath(match[3]));
            if (path === undefined) issue(file, 'INVALID_DIFF_PATH');
            else if (match[2] === 'from') file.oldPath = path;
            else file.newPath = path;
            if (match[1] === 'copy') issue(file, 'COPY_METADATA_PRESENT');
        }
    }

    for (const file of files) {
        if (!file.oldPath && !file.newPath) issue(file, 'MISSING_DIFF_PATH');
        if (file.kind !== 'BINARY') {
            file.kind = !file.oldPath && file.newPath ? 'ADDED' : file.oldPath && !file.newPath ? 'DELETED'
                : file.newPath !== file.oldPath ? 'RENAMED' : 'MODIFIED';
        }
        for (const issue of file.errors) errors.add(issue);
    }
    if (!files.length) errors.add('NO_DIFF_FILES');
    return { files, errors: [...errors] };
}
