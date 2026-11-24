import { isIP, isIPv4 } from 'node:net';
import { z } from 'zod';
import { findingPublicText } from './finding-import.js';
import { hostReportSeverity, maxHostReportItems, submittedTextFiles } from './host-report-input.js';
import { HttpError } from './http-error.js';

export const threatReportRequest = z.object({
    logs: submittedTextFiles,
    outboundWhitelist: z.array(z.string().trim().min(1).max(128)).max(1024).nullish().transform(value => value ?? [])
});

interface Rule {
    ruleId: string;
    kind: 'ATTACK_HISTORY' | 'VIOLATION_OUTBOUND';
    severity: z.infer<typeof hostReportSeverity>;
    pattern: RegExp;
    captures: ('user' | 'ip')[];
    evidence: string;
    detail: string;
    minCount?: number;
    startsAt?: string;
}
const syslogTime = /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/;
const rules: Rule[] = [
    {
        ruleId: 'attack-brute-force-ssh', kind: 'ATTACK_HISTORY', severity: 'HIGH',
        pattern: /Failed password for (?:invalid user )?(\S+) from (\S+)/g,
        captures: ['user', 'ip'], minCount: 5,
        evidence: 'Failed password for {1} from {2}',
        detail: '疑似 SSH 暴力破解，{count} 次登录失败，首条目标用户 {1}（来源 {2}）'
    },
    {
        ruleId: 'attack-auth-failure', kind: 'ATTACK_HISTORY', severity: 'MEDIUM',
        startsAt: 'authentication failure', pattern: /^authentication failure.*user=(\S+)/g,
        captures: ['user'],
        evidence: 'authentication failure user={1}', detail: '认证失败记录，用户 {1}'
    },
    {
        ruleId: 'attack-invalid-user-probe', kind: 'ATTACK_HISTORY', severity: 'MEDIUM',
        pattern: /Invalid user (\S+) from (\S+)/g,
        captures: ['user', 'ip'],
        evidence: 'Invalid user {1} from {2}', detail: '无效用户名探测，{1}（来源 {2}）'
    },
    {
        ruleId: 'outbound-iptables-dst', kind: 'VIOLATION_OUTBOUND', severity: 'HIGH',
        pattern: /\bDST=([0-9]{1,3}(?:\.[0-9]{1,3}){3})(?![\w.])/g,
        captures: ['ip'],
        evidence: 'DST={1}', detail: '违规外联（防火墙记录），目标 {1} 不在允许列表'
    },
    {
        ruleId: 'outbound-app-connect', kind: 'VIOLATION_OUTBOUND', severity: 'HIGH',
        pattern: /\boutbound connection to ([0-9]{1,3}(?:\.[0-9]{1,3}){3})(?![\w.])/gi,
        captures: ['ip'],
        evidence: 'outbound connection to {1}', detail: '违规外联（应用记录），目标 {1} 不在允许列表'
    }
];

function outboundWhitelist(entries: string[]) {
    const exact = new Set(entries);
    const networks = new Map<number, Set<number>>();
    const addressNumber = (value: string) => value.split('.').reduce((address, octet) => address * 256 + Number(octet), 0);
    const prefixNumber = (ip: number, prefix: number) => prefix === 0 ? 0 : ip >>> (32 - prefix);
    for (const entry of exact) {
        const match = /^([^/]+)\/(\d{1,2})$/.exec(entry);
        if (!match || !isIPv4(match[1]) || Number(match[2]) > 32) continue;
        const prefix = Number(match[2]);
        const addresses = networks.get(prefix) ?? new Set<number>();
        addresses.add(prefixNumber(addressNumber(match[1]), prefix));
        networks.set(prefix, addresses);
    }
    return (target: string) => {
        if (exact.has(target)) return true;
        const numeric = addressNumber(target);
        for (const [prefix, addresses] of networks) if (addresses.has(prefixNumber(numeric, prefix))) return true;
        return false;
    };
}

interface LogMatch { lineNumber: number; time: string | null; fields: string[] }
function publicMatch(rule: Rule, match: RegExpMatchArray, line: string, lineNumber: number): LogMatch {
    return {
        lineNumber, time: syslogTime.exec(line)?.[1] ?? null,
        fields: rule.captures.map((format, index) => {
            const value = match[index + 1] ?? '';
            const safe = format === 'ip' ? value.length <= 45 && isIP(value) > 0 : /^[\w.@-]{1,64}$/.test(value);
            return safe ? value : '［省略］';
        })
    };
}

function reportRecord(rule: Rule, logFile: string, match: LogMatch, count: number) {
    const interpolate = (template: string) => template.replace(/\{(count|\d+)\}/g,
        (_, field: string) => field === 'count' ? String(count) : match.fields[Number(field) - 1] ?? '');
    const { ruleId, kind, severity } = rule;
    return { ruleId, kind, severity, time: match.time, logFile, lineNumber: match.lineNumber,
        evidence: interpolate(rule.evidence), detail: interpolate(rule.detail) };
}

export function threatReport(request: z.infer<typeof threatReportRequest>) {
    const allowed = outboundWhitelist(request.outboundWhitelist);
    const records: ReturnType<typeof reportRecord>[] = [];
    function add(rule: Rule, file: string, match: LogMatch, count = 0) {
        if (records.length >= maxHostReportItems) throw new HttpError(413, 'THREAT_REPORT_RESULT_LIMIT');
        records.push(reportRecord(rule, file, match, count));
    }
    for (const log of request.logs) {
        const file = findingPublicText(log.name, 240);
        const lines = log.content.split(/\r\n|\n|\r/);
        for (const rule of rules) {
            let first: LogMatch | undefined;
            let count = 0;
            for (const [index, line] of lines.entries()) {
                const start = rule.startsAt ? line.indexOf(rule.startsAt) : 0;
                if (start < 0) continue;
                for (const match of line.slice(start).matchAll(rule.pattern)) {
                    if (rule.kind === 'VIOLATION_OUTBOUND' && (!isIPv4(match[1]) || allowed(match[1]))) continue;
                    if (rule.minCount) {
                        count++;
                        first ??= publicMatch(rule, match, line, index + 1);
                    } else add(rule, file, publicMatch(rule, match, line, index + 1));
                }
            }
            if (first && rule.minCount && count >= rule.minCount) add(rule, file, first, count);
        }
    }
    records.sort((a, b) => a.logFile === b.logFile ? a.lineNumber - b.lineNumber : a.logFile < b.logFile ? -1 : 1);
    return { scannedLogs: request.logs.length, records, generatedAt: new Date().toISOString() };
}
