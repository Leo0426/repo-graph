import type { DetectionRule } from './detection-rules.js';

const semgrepSeverity: Record<DetectionRule['severity'], string> = {
    CRITICAL: 'ERROR', HIGH: 'ERROR', MEDIUM: 'WARNING', LOW: 'INFO', INFO: 'INFO', UNKNOWN: 'WARNING'
};

function yamlValue(value: string | number | string[]) {
    // JSON strings and flow arrays use YAML-compatible quoting when reserved line breaks are escaped.
    return JSON.stringify(value).replace(/[\x7f-\x9f\u2028\u2029]/g,
        char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}

export function toSemgrepYaml(rule: DetectionRule) {
    const regex = rule.matcherKind === 'REGEX';
    // Close the PCRE2 quote, match the literal backslash plus E, then reopen the quote.
    const expression = regex ? '(?s-m)' + rule.pattern : '\\Q' + rule.pattern.replaceAll('\\E', '\\E\\\\E\\Q') + '\\E';
    const metadata = {
        cwe: rule.cwe,
        'repograph-frameworks': rule.frameworks,
        'repograph-languages': rule.languages,
        'repograph-matcher-kind': rule.matcherKind,
        'repograph-pattern': rule.pattern,
        ...(regex ? { 'repograph-regex-engine': rule.regexEngine ?? 'ECMASCRIPT' } : {}),
        'repograph-source': rule.source,
        'repograph-version': rule.version
    };
    return [
        'rules:',
        '  - id: ' + yamlValue(rule.ruleId),
        '    languages: ' + yamlValue(rule.languages),
        '    message: ' + yamlValue(rule.title),
        '    metadata:',
        ...Object.entries(metadata).map(([key, value]) => '      ' + key + ': ' + yamlValue(value)),
        '    pattern-regex: ' + yamlValue(expression),
        '    severity: ' + yamlValue(semgrepSeverity[rule.severity]),
        ''
    ].join('\n');
}

export function toSourceSinkJson(rule: DetectionRule) {
    const sink = {
        matcherKind: rule.matcherKind, pattern: rule.pattern,
        ...(rule.matcherKind === 'REGEX' ? { regexEngine: rule.regexEngine ?? 'ECMASCRIPT', regexFlags: ['DOTALL'] } : {})
    };
    return JSON.stringify({
        cwe: rule.cwe, frameworks: rule.frameworks, languages: rule.languages, ruleId: rule.ruleId, severity: rule.severity,
        sinks: [sink], source: rule.source, sources: [], version: rule.version
    }) + '\n';
}
