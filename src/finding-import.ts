import { isAbsolute, relative } from 'node:path';
import { z } from 'zod';
import { HttpError } from './http-error.js';
import { redactReviewText } from './review-redaction.js';
import { digest } from './source.js';

export const findingBody = z.record(z.string(), z.unknown());
export const maxFindingBody = 8 * 1024 * 1024;
export const maxFindingRows = 1000;
export const findingFormats = ['semgrep', 'sarif', 'codeql', 'slither'] as const;
const MAX_TRACE = 16;
const controls = /[\x00-\x1f\x7f-\x9f]/;
const severities = {
    CRITICAL: 'CRITICAL', ERROR: 'CRITICAL', BLOCKER: 'CRITICAL', HIGH: 'HIGH', MAJOR: 'HIGH',
    MEDIUM: 'MEDIUM', WARNING: 'MEDIUM', WARN: 'MEDIUM', MODERATE: 'MEDIUM', LOW: 'LOW', MINOR: 'LOW',
    INFO: 'INFO', INFORMATIONAL: 'INFO', NOTE: 'INFO'
} as const;

type ObjectValue = Record<string, unknown>;
export type FindingSeverity = typeof severities[keyof typeof severities] | 'UNKNOWN';
export type FindingFormat = typeof findingFormats[number];
export function isFindingFormat(value: string): value is FindingFormat {
    return findingFormats.some(format => format === value);
}
interface Location { filePath: string; startLine: number; endLine: number }
interface Trace extends Location {
    kind: 'source' | 'call' | 'sink' | 'flow' | 'note' | 'protection'; path?: number;
    symbol?: string; message?: string; legacyKind?: string;
}
export interface ExternalFinding extends Location {
    fingerprint: string; tool: string; ruleId: string; severity: FindingSeverity;
    cwe: string; message: string; symbol: string; trace: Trace[]; codeVersion: string; ruleVersion: string;
    traceIncomplete?: true;
    legacyScan?: { scanner: string; scanId: string; firstSeenAt: string; lastSeenAt: string; hasArchivedRun?: true };
}

const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const index = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : -1;
const line = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647 ? value : 0;

export function findingPublicText(value: string, limit: number) {
    return redactReviewText(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, limit).trim();
}

function identifier(value: unknown, max: number) {
    const name = string(value);
    return name.length <= max && !controls.test(name) ? name : '';
}

function severity(value: unknown): FindingSeverity {
    const label = string(value).toUpperCase();
    return Object.hasOwn(severities, label) ? severities[label as keyof typeof severities] : 'UNKNOWN';
}

function cwe(...values: unknown[]) {
    for (const value of values) for (const item of Array.isArray(value) ? value.slice(0, 100) : [value]) {
        const match = /(?:\bCWE[\s-]*|^)([0-9]{1,7})(?!\d)/i.exec(string(item));
        if (match) return 'CWE-' + Number(match[1]);
    }
    return '';
}

function safePath(value: string) {
    if (!value || value.length > 4096 || controls.test(value) || value.startsWith('//') || value.includes('\\')
        || /^[a-z][a-z\d+.-]*:/i.test(value)) return '';
    if (value.split('/').includes('..')) return '';
    return value.split('/').filter(part => part && part !== '.').join('/');
}

function inProject(value: string, root: string) {
    const path = safePath(value);
    if (!path) return '';
    if (!isAbsolute(value)) return path;
    const local = relative(root, '/' + path);
    return isAbsolute(local) ? '' : safePath(local);
}

function uriPath(value: unknown) {
    const uri = string(value);
    if (!uri || uri.length > 8192 || /[?#\\]/.test(uri)) return '';
    const local = /^file:\/\/(?:localhost)?(\/[^/].*|\/)$/i.exec(uri);
    if (!local && (/^[a-z][a-z\d+.-]*:/i.test(uri) || uri.startsWith('//'))) return '';
    try { return decodeURIComponent(local ? local[1] : uri); }
    catch { return ''; }
}

function sarifPath(location: ObjectValue, run: ObjectValue, root: string) {
    const entry = object(object(array(run.artifacts)[index(location.index)]).location);
    const path = uriPath(location.uri ?? entry.uri);
    const baseId = identifier(location.uriBaseId ?? entry.uriBaseId, 150);
    if (!safePath(path)) return '';
    if (!baseId) return inProject(path, root);
    const bases = object(run.originalUriBaseIds);
    let directory = '';
    let sourceRoot = '';
    const visited = new Set<string>();
    for (let key = baseId; key;) {
        if (visited.has(key) || visited.size >= 8) return '';
        visited.add(key);
        const entry = Object.hasOwn(bases, key) ? object(bases[key]) : {};
        const portion = uriPath(entry.uri);
        if (key === '%SRCROOT%') {
            if (entry.uri !== undefined && (!isAbsolute(portion) || (portion !== '/' && !safePath(portion)))) return '';
            sourceRoot = portion;
            break;
        }
        if (!safePath(portion)) return '';
        if (isAbsolute(portion)) {
            if (!inProject(portion, root) && portion.replace(/\/+$/, '') !== root) return '';
            sourceRoot = root;
            directory = inProject(portion, root) + '/' + directory;
            break;
        }
        directory = portion + '/' + directory;
        key = identifier(entry.uriBaseId, 150);
    }
    if (isAbsolute(path) && sourceRoot && safePath(sourceRoot)) {
        const prefix = '/' + safePath(sourceRoot) + '/';
        const clean = '/' + safePath(path);
        if (clean.startsWith(prefix)) return safePath(clean.slice(prefix.length));
    }
    return isAbsolute(path) ? inProject(path, root) : safePath(directory + path);
}

function location(filePath: string, from: unknown, to: unknown): Location | null {
    const startLine = line(from), endLine = to === undefined ? startLine : line(to);
    return filePath && startLine && endLine >= startLine ? { filePath, startLine, endLine } : null;
}

function semgrepTrace(item: ObjectValue, primary: Location, root: string) {
    const trace = object(item.dataflow_trace);
    const entries: (readonly [Trace['kind'], unknown])[] = [['source', trace.taint_source],
        ...array(trace.intermediate_vars).slice(0, MAX_TRACE - 2).map(value => ['call', value] as const), ['sink', trace.taint_sink]];
    return entries.flatMap(([kind, value]) => {
        const part = object(object(value).location ?? array(value)[1]);
        const path = string(part.path ?? part.file);
        const loc = location(path ? inProject(path.replace(/\\/g, '/'), root) : primary.filePath,
            object(part.start).line ?? part.line, object(part.end).line);
        return loc ? [{ ...loc, kind }] : [];
    });
}

const sarifTraceKinds = new Map<string, Trace['kind']>([
    ['source', 'source'], ['sink', 'sink'], ['call', 'call'], ['sanitizer', 'protection'],
    ['validation', 'protection'], ['guard', 'protection'], ['barrier', 'protection']
]);

function sarifTrace(result: ObjectValue, run: ObjectValue, root: string) {
    const trace: Trace[] = [];
    const flows = array(result.codeFlows);
    const shared = array(run.threadFlowLocations);
    let incomplete = flows.length > MAX_TRACE;
    let path = 0;
    for (const flow of flows.slice(0, MAX_TRACE)) {
        const threads = array(object(flow).threadFlows);
        incomplete ||= !threads.length || threads.length > MAX_TRACE;
        for (const thread of threads.slice(0, MAX_TRACE)) {
            const entries = array(object(thread).locations);
            path++;
            incomplete ||= !entries.length || entries.length > MAX_TRACE;
            let ordered = -1;
            for (const value of entries.slice(0, MAX_TRACE)) {
                if (trace.length >= MAX_TRACE) return { trace, traceIncomplete: true as const };
                const entry = object(value);
                const linked = object(shared[index(entry.index)]);
                const order = index(entry.executionOrder ?? linked.executionOrder);
                if (order >= 0) {
                    incomplete ||= order <= ordered;
                    ordered = order;
                }
                const kinds = array(entry.kinds ?? linked.kinds);
                const roles = new Set(kinds.slice(0, 16)
                    .map(kind => sarifTraceKinds.get(string(kind).toLowerCase())).filter(role => role !== undefined));
                incomplete ||= roles.size > 1 || kinds.length > 16;
                const physical = object(object(entry.location ?? linked.location).physicalLocation);
                const region = object(physical.region);
                const found = location(sarifPath(object(physical.artifactLocation), run, root), region.startLine, region.endLine);
                if (found) trace.push({ ...found, kind: roles.size === 1 ? roles.values().next().value ?? 'flow' : 'flow', path });
                else incomplete = true;
            }
        }
    }
    return { trace, ...(incomplete ? { traceIncomplete: true as const } : {}) };
}

class InvalidFinding extends Error {}

function primary(tool: string, rule: unknown, path: string, from: unknown, to: unknown, rawMessage: unknown) {
    const ruleId = identifier(rule, 500);
    if (!ruleId) throw new InvalidFinding('INVALID_FINDING_RULE');
    if (!path) throw new InvalidFinding('UNSAFE_FINDING_PATH');
    const loc = location(path, from, to);
    if (!loc) throw new InvalidFinding('INVALID_FINDING_RANGE');
    return { ...loc, tool, ruleId, fingerprint: digest([tool, ruleId, path, loc.startLine].join('|')).slice(0, 16),
        message: findingPublicText(string(rawMessage) || ruleId, 1500) };
}

function semgrep(result: ObjectValue, root: string) {
    const extra = object(result.extra), metadata = object(extra.metadata);
    const found = primary('semgrep', result.check_id, inProject(string(result.path).replace(/\\/g, '/'), root),
        object(result.start).line, object(result.end).line, extra.message ?? metadata.description);
    return { ...found, severity: severity(extra.severity ?? metadata.impact), cwe: cwe(metadata.cwe, metadata.cwe_id, metadata.tags),
        symbol: identifier(metadata.function ?? metadata.symbol, 500), trace: semgrepTrace(extra, found, root) };
}

function slither(result: ObjectValue, root: string) {
    const element = object(array(result.elements)[0]);
    const mapping = object(element.source_mapping);
    const reportedPath = [mapping.filename_relative, mapping.filename_short, mapping.filename_absolute].map(string).find(Boolean);
    let first = Number.MAX_SAFE_INTEGER;
    let last = 0;
    for (const value of array(mapping.lines)) {
        const number = line(value);
        if (!number) continue;
        first = Math.min(first, number);
        last = Math.max(last, number);
    }
    const found = primary('slither', result.check, inProject(reportedPath?.replace(/\\/g, '/') ?? '', root), first, last,
        result.description);
    const symbol = identifier(element.name, 500);
    const { filePath, startLine, endLine } = found;
    const trace: Trace[] = [{ filePath, startLine, endLine, symbol, kind: 'note', legacyKind: 'context-unavailable',
        message: 'The source location is from Slither. Indexed Solidity context is unavailable.' }];
    return { ...found, severity: severity(result.impact), cwe: '', symbol, trace };
}

function sarif(result: ObjectValue, run: ObjectValue, rules: Map<string, ObjectValue>, driverRules: unknown[], tool: string, root: string) {
    const locationEntry = object(array(result.locations)[0]);
    const physical = object(locationEntry.physicalLocation), region = object(physical.region), message = object(result.message);
    const ruleId = result.ruleId ?? object(result.rule).id ?? object(driverRules[index(result.ruleIndex ?? object(result.rule).index)]).id;
    const rule = rules.get(string(ruleId)) ?? {};
    const props = object(rule.properties), own = object(result.properties);
    const found = primary(tool, ruleId, sarifPath(object(physical.artifactLocation), run, root), region.startLine, region.endLine,
        message.text ?? message.markdown);
    const symbol = object(array(locationEntry.logicalLocations)[0]);
    return { ...found, severity: severity(result.level ?? object(rule.defaultConfiguration).level),
        cwe: cwe(own.cwe, own.tags, props.cwe, props.tags), symbol: identifier(symbol.fullyQualifiedName ?? symbol.name, 500),
        ...sarifTrace(result, run, root) };
}

export function normalizeFindings(format: FindingFormat, body: ObjectValue, root: string, limit: number,
    versions: { codeVersion: string; ruleVersion: string }) {
    const findings: ExternalFinding[] = [];
    const skipped: { position: number; reason: string }[] = [];
    let scanned = 0, reported = 0;
    const consume = (results: unknown[], parse: (row: ObjectValue) => Omit<ExternalFinding, 'codeVersion' | 'ruleVersion'>) => {
        reported += results.length;
        for (const row of results.slice(0, Math.max(0, limit - scanned))) {
            scanned++;
            try { findings.push({ ...parse(object(row)), ...versions }); }
            catch (error) {
                if (!(error instanceof InvalidFinding)) throw error;
                skipped.push({ position: scanned, reason: error.message });
            }
        }
    };
    if (format === 'semgrep') {
        if (!Array.isArray(body.results)) throw new HttpError(400, 'INVALID_SEMGREP_REPORT');
        consume(body.results, item => semgrep(item, root));
    } else if (format === 'slither') {
        const { detectors } = object(body.results);
        if (body.success === false || !Array.isArray(detectors)) throw new HttpError(400, 'INVALID_SLITHER_REPORT');
        consume(detectors, item => slither(item, root));
    } else {
        if (!Array.isArray(body.runs) || (body.version !== undefined && body.version !== '2.1.0')) {
            throw new HttpError(400, 'INVALID_SARIF_REPORT');
        }
        for (const value of body.runs) {
            const run = object(value), driver = object(object(run.tool).driver);
            if (run.results !== undefined && run.results !== null && !Array.isArray(run.results)) throw new HttpError(400, 'INVALID_SARIF_REPORT');
            const results = array(run.results);
            if (scanned >= limit) { reported += results.length; continue; }
            const entries = array(driver.rules);
            const rules = new Map(entries.map(rule => [string(object(rule).id), object(rule)]));
            const tool = identifier(driver.name ?? object(run.automationDetails).id, 120) || (format === 'codeql' ? 'CodeQL' : 'sarif');
            consume(results, result => sarif(result, run, rules, entries, tool, root));
        }
    }
    return { findings, skipped, reported, truncated: reported > scanned };
}
