import { basename } from 'node:path/posix';

const assignments = /(?<!\w)(?:[\w-]*[_-])?(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|client[_-]?secret|authorization)["']?[ \t]*[:=][ \t]*/gi;
const auth = /\b(?:Bearer|Basic)[ \t]+[^\s"'<>]+/gi;
const keyBlock = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;
const sensitive = /^(?:\.env(?:\..*)?|id_(?:rsa|ed25519)|secrets?(?:\..*)?|credentials(?:\..*)?)$|\.(?:pem|key|p12|pfx|jks)$/i;

export function isSensitiveReviewPath(path: string) { return sensitive.test(basename(path)); }

export function redactReviewText(text: string, maskAll = false, unifiedLines = false) {
    const chars = text.split('');
    function mask(start: number, end: number) {
        for (let index = start; index < end; index++) {
            const ch = text[index];
            if (ch === '\r' || ch === '\n' || unifiedLines && (index === 0 || text[index - 1] === '\n') && ' +-'.includes(ch)) continue;
            chars[index] = '*';
        }
    }
    if (maskAll) {
        mask(0, text.length);
        return chars.join('');
    }
    let maskedThrough = 0;
    for (const match of text.matchAll(assignments)) {
        if (match.index < maskedThrough) continue;
        let start = match.index + match[0].length;
        const quote = text[start];
        const quoted = quote === '"' || quote === "'" || quote === '`';
        const tripleQuoted = quoted && quote !== '`' && text.startsWith(quote.repeat(3), start);
        const delimiter = tripleQuoted ? quote.repeat(3) : quote;
        const multiline = tripleQuoted || quote === '`';
        if (quoted) start += delimiter.length;
        let end = start;
        for (; end < text.length; end++) {
            const ch = text[end];
            if ((!multiline && (ch === '\n' || ch === '\r')) ||
                (quoted && text.startsWith(delimiter, end)) || (!quoted && /[\s,;\]}]/.test(ch))) break;
            if (quoted && ch === '\\' && end + 1 < text.length) {
                end += text.startsWith('\r\n', end + 1) ? 2 : 1;
            }
        }
        mask(start, end);
        maskedThrough = end;
    }
    for (const match of text.matchAll(auth)) {
        const firstSpace = match[0].search(/[ \t]/);
        mask(match.index + firstSpace + 1, match.index + match[0].length);
    }
    for (const match of text.matchAll(keyBlock)) mask(match.index, match.index + match[0].length);
    return chars.join('');
}
