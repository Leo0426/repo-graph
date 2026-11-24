import type { ExternalFinding } from './finding-import.js';
import type { contextPack } from './retrieval.js';

type Citation = ReturnType<typeof contextPack>['evidence'][number];
type TraceStep = ExternalFinding['trace'][number];

const protections: Record<string, { name: string; pattern: RegExp; remediation: string }> = {
    'CWE-78': { name: 'Input validation', pattern: /\b(?:matches|validateCommand|allowlist|whitelist)\b/i,
        remediation: 'Use a fixed program and allowlisted arguments selected independently of untrusted input.' },
    'CWE-89': { name: 'Parameterized query', pattern: /\b(?:PreparedStatement|prepareStatement|NamedParameterJdbcTemplate)\b/i,
        remediation: 'Bind input values using a parameterized query. Select identifiers from an allowlist.' },
    'CWE-79': { name: 'Output encoding', pattern: /\b(?:htmlEscape|escapeHtml\w*|encodeForHtml|Jsoup\s*\.\s*clean)\b/i,
        remediation: 'Encode values for the output context and sanitize any permitted rich text.' },
    'CWE-22': { name: 'Path containment', pattern: /\b(?:getCanonicalPath|toRealPath|normalize|startsWith)\s*\(/i,
        remediation: 'Resolve the path and verify that it remains within the authorized directory before use.' },
    'CWE-502': { name: 'Deserialization type filter', pattern: /\b(?:ObjectInputFilter|setObjectInputFilter|serialFilter)\b/i,
        remediation: 'Prefer a data-only format for untrusted input. Apply an explicit type allowlist if object deserialization is required.' }
};

function protectionLines(item: Citation, marker: RegExp) {
    if (item.truncated) return new Set<number>();
    // Preserve line numbers when masking comments and quoted literals.
    const code = item.excerpt.replace(/\/\*[\s\S]*?(?:\*\/|$)|(?:\/\/|#)[^\r\n]*|"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\[^]|[^"\\])*"|'(?:\\[^]|[^'\\])*'|`(?:\\[^]|[^`\\])*`/g,
        text => text.replace(/[^\r\n]/g, ' '));
    const lines = code.split(/\r\n|\r|\n/);
    return new Set(lines.flatMap((text, offset) => marker.test(text) ? [item.startLine + offset] : []));
}

function pathWindows(finding: ExternalFinding) {
    const paths = new Map<number, TraceStep[]>();
    if (finding.traceIncomplete) return [];
    for (const step of finding.trace) {
        if (step.path === undefined) return [];
        const path = paths.get(step.path);
        if (path) path.push(step);
        else paths.set(step.path, [step]);
    }
    const windows: TraceStep[][] = [];
    for (const path of paths.values()) {
        const source = path.findLastIndex(step => step.kind === 'source');
        const sink = path.findIndex(step => step.kind === 'sink');
        const includesFinding = path.some(step => step.kind === 'sink' && step.filePath === finding.filePath
            && step.startLine <= finding.endLine && step.endLine >= finding.startLine);
        if (source < 0 || sink <= source || !includesFinding) return [];
        windows.push(path.slice(source + 1, sink).filter(step => step.kind === 'protection'));
    }
    return windows;
}

export function findingProtection(finding: ExternalFinding, evidence: Citation[]) {
    const protection = Object.hasOwn(protections, finding.cwe) ? protections[finding.cwe] : undefined;
    if (!protection) return { covered: false, evidence: [], remediation: '' };
    const windows = pathWindows(finding);
    const cited = evidence.flatMap(item => {
        if (item.source !== 'FINDING' && item.relation !== 'CALLEE') return [];
        const lines = protectionLines(item, protection.pattern);
        if (!lines.size) return [];
        const paths = windows.flatMap((steps, index) => steps.some(step => step.filePath === item.filePath
            && lines.has(step.startLine)) ? [index] : []);
        return [{ citationId: item.citationId, paths }];
    });
    const covered = windows.length > 0 && new Set(cited.flatMap(item => item.paths)).size === windows.length;
    return { covered, remediation: protection.remediation, evidence: cited.map(({ citationId, paths }) => ({
        citationId, covered: !!paths.length,
        summary: paths.length
            ? `${protection.name} candidate appears after all source steps and before every sink step on ${paths.length} of ${windows.length} reported paths.`
            : `${protection.name} candidate lacks matching, ordered evidence on a complete reported path.`
    })) };
}
