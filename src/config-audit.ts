import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { findingPublicText } from './finding-import.js';
import { hostReportSeverity, maxHostReportItems, submittedTextFiles } from './host-report-input.js';
import { HttpError } from './http-error.js';

const auditDimensions = ['SECURITY_POLICY', 'HOST_BASELINE', 'SYSTEM_CONFIG', 'SYSTEM_LOG'] as const;
const dimension = z.enum(auditDimensions);
const enabled = new Set(['yes', 'on', '1', 'true', 'enabled']);

export const configAuditRequest = z.object({
    files: submittedTextFiles,
    dimensions: z.array(dimension).max(auditDimensions.length).nullish().transform(value => value ?? [])
});

const ruleShape = z.object({
    ruleId: z.string().min(1),
    dimension,
    severity: hostReportSeverity,
    basis: z.string().min(1),
    remediation: z.string().min(1),
    matcher: z.discriminatedUnion('type', [
        z.object({ type: z.literal('FORBIDDEN'), key: z.string().min(1) }),
        z.object({ type: z.literal('PRESENT'), key: z.string().min(1), valuePattern: z.string().min(1).optional() }),
        z.object({ type: z.literal('VALUE_PATTERN'), key: z.string().min(1), valuePattern: z.string().min(1), negate: z.boolean().default(false) })
    ])
});
const catalogPath = new URL('../resources/config-audit/rules.json', import.meta.url);
const rules = z.array(ruleShape).parse(JSON.parse(readFileSync(catalogPath, 'utf8'))).map(rule => ({
    ...rule, pattern: 'valuePattern' in rule.matcher && rule.matcher.valuePattern
        ? new RegExp('^(?:' + rule.matcher.valuePattern + ')$') : undefined
}));

type AuditDimension = typeof auditDimensions[number];
type Rule = typeof rules[number];
interface ConfigLine { value: string; lineNumber: number }
interface Violation {
    ruleId: string;
    dimension: AuditDimension;
    severity: z.infer<typeof hostReportSeverity>;
    filePath: string;
    lineNumber: number | null;
    evidence: string;
    basis: string;
    remediation: string;
}

function valueBeforeComment(raw: string) {
    let quote = '';
    let end = raw.length;
    for (let i = 0; i < raw.length; i++) {
        if (quote) {
            if (raw[i] === '\\') i++;
            else if (raw[i] === quote) quote = '';
        } else if (raw[i] === '#') {
            end = i;
            break;
        } else if (raw[i] === '"' || raw[i] === "'") quote = raw[i];
    }
    const value = raw.slice(0, end).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) return value.slice(1, -1);
    return value;
}

function indexedLines(content: string, keys: ReadonlySet<string>) {
    const values = new Map<string, ConfigLine[]>();
    for (const [index, line] of content.split(/\r\n|\n|\r/).entries()) {
        const match = /^([^\s=#]+)(?:\s*=\s*|\s+)(.*)$/.exec(line.trim());
        if (!match || !keys.has(match[1])) continue;
        const group = values.get(match[1]) ?? [];
        group.push({ value: valueBeforeComment(match[2]), lineNumber: index + 1 });
        values.set(match[1], group);
    }
    return values;
}

export function configAudit(request: z.infer<typeof configAuditRequest>) {
    const requested = new Set(request.dimensions);
    const active = rules.filter(rule => !requested.size || requested.has(rule.dimension));
    const keys = new Set(active.map(rule => rule.matcher.key));
    const violations: Violation[] = [];
    function record(rule: Rule, filePath: string, lineNumber: number | null, evidence: string) {
        if (violations.length >= maxHostReportItems) throw new HttpError(413, 'CONFIG_AUDIT_RESULT_LIMIT');
        const { ruleId, dimension, severity, basis, remediation } = rule;
        violations.push({ ruleId, dimension, severity, filePath, lineNumber, evidence, basis, remediation });
    }

    for (const file of request.files) {
        const filePath = findingPublicText(file.name, 240);
        const values = indexedLines(file.content, keys);
        for (const rule of active) {
            const { matcher, pattern } = rule;
            const lines = values.get(matcher.key) ?? [];
            if (matcher.type === 'FORBIDDEN') {
                for (const line of lines) {
                    const value = line.value.toLowerCase();
                    if (enabled.has(value)) record(rule, filePath, line.lineNumber, matcher.key + ' ' + value);
                }
            } else if (matcher.type === 'VALUE_PATTERN' && matcher.negate) {
                for (const line of lines) {
                    if (pattern?.test(line.value)) record(rule, filePath, line.lineNumber, '键 ' + matcher.key + ' 的值不符合要求');
                }
            } else if (!lines.length) record(rule, filePath, null, '缺少配置键 ' + matcher.key);
            else if (pattern && !lines.some(line => pattern.test(line.value))) {
                record(rule, filePath, lines[0].lineNumber, '键 ' + matcher.key + ' 的值不符合要求');
            }
        }
    }
    violations.sort((a, b) => a.filePath === b.filePath ? (a.lineNumber ?? 0) - (b.lineNumber ?? 0) : a.filePath < b.filePath ? -1 : 1);
    return {
        dimensionsAudited: [...new Set(active.map(rule => rule.dimension))], checkedRules: active.length, scannedFiles: request.files.length,
        violations, generatedAt: new Date().toISOString()
    };
}
