import type { CodeUnit, IndexedSource, Language, UnitFactory } from './source.js';

type HeuristicLanguage = Exclude<Language, 'doc'>;
type Pattern = [kind: CodeUnit['kind'], signature: RegExp, arrow?: true];
const js: Pattern[] = [
    ['CLASS', /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([\w$]+)/],
    ['FUNCTION', /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)\s*(?:<[^<>]*>)?\s*\(/],
    ['FUNCTION', /^(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?(?:\(|[\w$]+\s*=>)/, true],
    ['METHOD', /^(?!(?:if|for|while|switch|catch|with|return|new|function)\b)(?:async\s+)?([\w$]+)\s*\([^;{}]*\)\s*\{/]
];
const signatures: Record<HeuristicLanguage, Pattern[]> = {
    java: [
        ['CLASS', /^(?:(?:public|protected|private|abstract|final|static|sealed|non-sealed)\s+)*(?:class|interface|enum|record)\s+([\w$]+)/],
        ['METHOD', /^(?!(?:if|for|switch|catch|while|return|throw|new)\b)[\w$][\w$.\s\[\]<>,?&]*?\s+([\w$]+)\s*\(/]
    ],
    python: [
        ['CLASS', /^class\s+(\w+)/],
        ['METHOD', /^(?:async\s+)?def\s+(\w+)\s*\(/]
    ],
    c: [
        ['STRUCT', /^(?:typedef\s+)?struct\s+(\w+)\s*\{/],
        ['FUNCTION', /^(?!(?:if|for|switch|while|return)\b)[\w][\w\s*]*?[\s*]+(\w+)\s*\(/]
    ],
    cpp: [
        ['CLASS', /^(?:template\s*<[^>]*>\s*)?(?:class|struct)\s+(\w+)/],
        ['FUNCTION', /^(?!(?:if|for|switch|while|return|throw|new)\b)[\w][\w\s*:~<>&,]*?[\s*&]+(?:[\w:]+::)?(\w+)\s*\(/]
    ],
    typescript: js,
    javascript: js
};

function maskNonCode(source: string, language: HeuristicLanguage) {
    const characters = source.split('');
    for (let index = 0; index < source.length; index++) {
        const character = source[index];
        const next = source[index + 1];
        let end = index;
        let literal = false;
        if (language === 'python' ? character === '#' : character === '/' && next === '/') {
            while (end < source.length && !'\r\n'.includes(source[end])) end++;
        } else if (language !== 'python' && character === '/' && next === '*') {
            const close = source.indexOf('*/', index + 2);
            end = close < 0 ? source.length : close + 2;
        } else if (character === '"' || character === "'" || character === '`') {
            literal = true;
            const quote = (language === 'python' || language === 'java') && source.startsWith(character.repeat(3), index)
                ? character.repeat(3) : character;
            const multiline = quote.length === 3 || character === '`';
            end += quote.length;
            while (end < source.length && (multiline || !'\r\n'.includes(source[end]))) {
                if (source.startsWith(quote, end)) { end += quote.length; break; }
                end += source[end] === '\\' ? 2 : 1;
            }
        }
        if (end === index) continue;
        for (let at = index; at < Math.min(source.length, end); at++) {
            if (!'\r\n'.includes(characters[at])) characters[at] = ' ';
        }
        if (literal && language === 'python') characters[index] = '"';
        index = end - 1;
    }
    return characters.join('');
}

function findOpener(code: string, start: number, python: boolean) {
    let depth = 0;
    for (let i = start; i < Math.min(code.length, start + 4096); i++) {
        const character = code[i];
        if (!depth && character === (python ? ':' : '{')) return i;
        if (!depth && (';}'.includes(character) || (python && '\r\n'.includes(character) && code[i - 1] !== '\\'))) break;
        if ('(['.includes(character) || (python && character === '{')) depth++;
        if (')]'.includes(character) || (python && character === '}')) {
            if (!depth) break;
            depth--;
        }
    }
    return undefined;
}

export function heuristicSource(file: string, language: HeuristicLanguage, source: string, unit: UnitFactory): IndexedSource {
    const code = maskNonCode(source, language);
    const lines = code.split(/\r\n|\r|\n/);
    const starts = [0];
    for (const ending of code.matchAll(/\r\n|\r|\n/g)) starts.push(ending.index + ending[0].length);
    const python = language === 'python';
    const opens: number[] = [];
    const pairs = new Map<number, number>();
    if (!python) for (let i = 0; i < code.length; i++) {
        if (code[i] === '{') opens.push(i);
        else if (code[i] === '}' && opens.length) pairs.set(opens.pop()!, i + 1);
    }
    const units: CodeUnit[] = [];
    let bodyLines = 0;
    let capturedCharacters = 0;
    const isTest = /(?:^|\/)(?:__tests__|tests?)\/|\.(?:spec|test)\.[^.]+$|(?:Test|Tests|Spec)\.java$/i.test(file);
    const indentation = (line: string) => (/^[ \t]*/.exec(line)?.[0] ?? '').replaceAll('\t', '    ').length;
    function lineAt(offset: number) {
        let lo = 0;
        let hi = lines.length;
        while (lo + 1 < hi) {
            const mid = (lo + hi) >>> 1;
            if (starts[mid] <= offset) lo = mid;
            else hi = mid;
        }
        return lo;
    }
    for (const [index, line] of lines.entries()) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.length > 1024) continue;
        const start = starts[index] + line.indexOf(trimmed);
        for (const [kind, pattern, arrow] of signatures[language]) {
            const name = pattern.exec(trimmed)?.[1];
            if (!name) continue;
            const opener = findOpener(code, start, python);
            if (opener === undefined || (arrow && !code.slice(start, opener).includes('=>'))) continue;
            let end = pairs.get(opener);
            if (python) {
                const headerLine = lineAt(opener);
                const headerEnd = starts[headerLine] + lines[headerLine].length;
                if (code.slice(opener + 1, headerEnd).trim()) end = headerEnd;
                else {
                    const level = indentation(line);
                    for (let child = headerLine + 1; child < lines.length; child++) {
                        if (++bodyLines > 2_000_000) throw new Error('SYNTAX_LIMIT');
                        const segment = lines[child];
                        const significant = Boolean(segment.trim());
                        if (significant && indentation(segment) <= level) break;
                        if (significant || end !== undefined) end = starts[child + 1] ?? code.length;
                    }
                }
            }
            if (end === undefined) continue;
            capturedCharacters += end - start;
            if (units.length === 10_000 || capturedCharacters > 8 * 1024 * 1024) throw new Error('SYNTAX_LIMIT');
            const raw = source.slice(start, end).trimEnd();
            units.push(unit(kind, name, file + '#' + name + '@L' + (index + 1), index + 1, lineAt(start + raw.length - 1) + 1,
                raw, source.slice(start, opener).trim(), null, { heuristic: 'true', ...(isTest ? { is_test: 'true' } : {}) }));
            break;
        }
    }
    return { units, edges: [], imports: [], exports: [], moduleKeys: [] };
}
