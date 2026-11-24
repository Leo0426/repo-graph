import type { Node } from '@vscode/tree-sitter-wasm';
import { FlowData, nestedFlowBodies } from './flow-data.js';
import { withFlowProcedure } from './flow-source.js';
import { HttpError } from './http-error.js';
import type { CodeUnit } from './source.js';
import { sourceLine, syntaxChildren } from './syntax-tree.js';

export interface ParameterFlowSlot {
    kind: 'PARAM' | 'RETURN' | 'CALL_ARG' | 'SINK';
    index: number;
    calleeHint: string | null;
}
interface Site {
    slot: ParameterFlowSlot;
    line: number;
    reads: string[];
}
interface ParameterSummary {
    parameters: string[];
    reachable: Map<string, Set<string>>;
    sites: Site[];
    locations: Map<string, number>;
}
interface Hop {
    methodQn: string; unitId: string; filePath: string; line: number; from: ParameterFlowSlot; to: ParameterFlowSlot;
}
interface Path { hops: Hop[]; reachesSink: boolean; sinkDescription: string | null }
interface Work { unitId: string; parameter: number; hops: Hop[]; depth: number }
export interface ParameterCallSite { line: number; targetId: string; name: string; paramTypes: string }

const maxPaths = 50;
const maxMethods = 200;
const maxStates = 400;
const maxCallSites = 1_000;
const maxSourceBytes = 4 * 1024 * 1024;
const maxElapsedMs = 3_000;
interface SinkRule { ruleId: string; cwe: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'; title: string }
const sinkRules: [string[], SinkRule][] = [
    [['executeQuery', 'executeUpdate', 'execute', 'executeBatch', 'executeLargeUpdate'],
        { ruleId: 'SQL_INJECTION_TAINT', cwe: 'CWE-89', severity: 'HIGH', title: 'Request parameter may reach statement execution' }],
    [['exec', 'start'], { ruleId: 'COMMAND_INJECTION_TAINT', cwe: 'CWE-78', severity: 'HIGH', title: 'Request parameter may reach process execution' }],
    [['readObject', 'readUnshared', 'deserialize'],
        { ruleId: 'INSECURE_DESER_TAINT', cwe: 'CWE-502', severity: 'HIGH', title: 'Request parameter may reach deserialization' }],
    [['loadClass', 'forName', 'invoke', 'newInstance'],
        { ruleId: 'UNSAFE_REFLECTION_TAINT', cwe: 'CWE-470', severity: 'HIGH', title: 'Request parameter may reach reflection' }],
    [['lookup'], { ruleId: 'JNDI_INJECTION_TAINT', cwe: 'CWE-917', severity: 'CRITICAL', title: 'Request parameter may reach a naming lookup' }],
    [['write', 'print', 'println', 'sendError'],
        { ruleId: 'XSS_TAINT', cwe: 'CWE-79', severity: 'MEDIUM', title: 'Request parameter may reach response output' }],
    [['sendRedirect'], { ruleId: 'OPEN_REDIRECT_TAINT', cwe: 'CWE-601', severity: 'MEDIUM', title: 'Request parameter may reach a redirect' }],
    [['parse'], { ruleId: 'XXE_TAINT', cwe: 'CWE-611', severity: 'HIGH', title: 'Request parameter may reach parsing' }],
    [['search'], { ruleId: 'LDAP_INJECTION_TAINT', cwe: 'CWE-90', severity: 'HIGH', title: 'Request parameter may reach directory search' }]
];
export const parameterSinkRules: ReadonlyMap<string, SinkRule> = new Map(
    sinkRules.flatMap(([names, rule]) => names.map(name => [name, rule] as const))
);

function locationKey(line: number, name: string) { return line + ':' + name; }

function summarize(unit: CodeUnit, fields: ReadonlySet<string>) {
    if (unit.language !== 'java' || unit.metadata.heuristic === 'true') return;
    return withFlowProcedure(unit, procedure => {
        const { body, lineOffset } = procedure;
        const facts = new FlowData(procedure, fields);
        const reachable = new Map<string, Set<string>>();
        const sites: Site[] = [];
        const locations = new Map<string, number>();
        let nodes = 0;
        let transfers = 0;
        const reads = (node: Node | null) => [...facts.access(node).reads.keys()];
        const transfer = (value: Node | null, target: Node | null) => {
            if (!value || !target) return;
            const written = [...facts.access(target, false, true).writes.keys()];
            for (const source of reads(value)) {
                const ends = reachable.get(source) ?? new Set<string>();
                for (const end of written) {
                    if (ends.has(end)) continue;
                    if (++transfers > 25_000) throw new HttpError(413, 'FLOW_ANALYSIS_LIMIT');
                    ends.add(end);
                }
                if (ends.size) reachable.set(source, ends);
            }
        };
        const visit = (node: Node, depth: number) => {
            if (++nodes > 35_000 || depth > 128 || sites.length >= maxCallSites) throw new HttpError(413, 'FLOW_ANALYSIS_LIMIT');
            if (nestedFlowBodies.has(node.type)) return;
            const child = (name: string) => node.childForFieldName(name);
            if (node.type === 'variable_declarator' || node.type === 'enhanced_for_statement') {
                transfer(child('value'), child('name'));
            } else if (node.type === 'assignment_expression') {
                transfer(child('right'), child('left'));
            } else if (node.type === 'try_statement' || node.type === 'try_with_resources_statement') {
                for (const handler of syntaxChildren(node).filter(item => item.type === 'catch_clause')) {
                    const parameter = syntaxChildren(handler).find(item => item.type === 'catch_formal_parameter');
                    transfer(child('body'), parameter?.childForFieldName('name') ?? null);
                }
            } else if (node.type === 'return_statement') {
                const dependencies = reads(syntaxChildren(node)[0] ?? null);
                if (dependencies.length) sites.push({ slot: { kind: 'RETURN', index: -1, calleeHint: null },
                    line: sourceLine(node) + lineOffset, reads: dependencies });
            } else if (node.type === 'method_invocation' || node.type === 'method_reference') {
                const name = child('name') ?? (node.type === 'method_reference' ? syntaxChildren(node).at(-1) : undefined);
                if (name?.type === 'identifier') {
                    const line = sourceLine(node) + lineOffset;
                    const key = locationKey(line, name.text);
                    locations.set(key, (locations.get(key) ?? 0) + 1);
                    const args = syntaxChildren(child('arguments'));
                    for (const [index, arg] of args.entries()) {
                        const dependencies = reads(arg);
                        if (dependencies.length) sites.push({ slot: { kind: 'CALL_ARG', index, calleeHint: name.text },
                            line, reads: dependencies });
                    }
                }
            }
            for (const item of syntaxChildren(node)) visit(item, depth + 1);
        };
        visit(body, 0);
        return { parameters: [...facts.entry.writes.keys()], reachable, sites, locations } satisfies ParameterSummary;
    });
}

function reached(summary: ParameterSummary, key: string) {
    const seen = new Set([key]);
    for (const position of seen) {
        for (const next of summary.reachable.get(position) ?? []) seen.add(next);
    }
    return seen;
}

function parameterForCall(target: ParameterCallSite, index: number) {
    const types = target.paramTypes.split(',');
    return types.at(-1)?.endsWith('...') ? Math.min(index, types.length - 1) : index;
}

export function traceParameterFlow(
    source: CodeUnit, sourceParamIndex: number, maxDepth: number,
    calls: (unitId: string, limit: number) => ParameterCallSite[],
    load: (unitId: string) => CodeUnit | undefined,
    fields: (unit: CodeUnit) => ReadonlySet<string>,
    deadline = performance.now() + maxElapsedMs
) {
    const initial = summarize(source, fields(source));
    if (!initial) return undefined;
    if (sourceParamIndex >= initial.parameters.length) throw new HttpError(400, 'INVALID_PARAM_INDEX');

    const summaries = new Map<string, { location: Pick<CodeUnit, 'filePath' | 'qualifiedName'>; summary?: ParameterSummary } | undefined>(
        [[source.id, { location: { filePath: source.filePath, qualifiedName: source.qualifiedName }, summary: initial }]]);
    const callIndex = new Map<string, { sites: Map<string, ParameterCallSite[]>; truncated: boolean }>();
    const paths: Path[] = [];
    const uniquePaths = new Set<string>();
    const limitations = new Set(['FLOW_INSENSITIVE', 'CALLER_RETURN_FLOW_UNAVAILABLE']);
    const queue: Work[] = [{ unitId: source.id, parameter: sourceParamIndex, hops: [], depth: 0 }];
    const visited = new Set([source.id + ':' + sourceParamIndex]);
    let truncated = false;
    let bytes = Buffer.byteLength(source.rawSource);

    function add(hops: Hop[], reachesSink: boolean) {
        const { to } = hops[hops.length - 1];
        const key = JSON.stringify(hops);
        if (uniquePaths.has(key)) return;
        if (paths.length >= maxPaths) { truncated = true; return; }
        uniquePaths.add(key);
        paths.push({ hops, reachesSink, sinkDescription: reachesSink ? `SINK:${to.calleeHint}.arg[${to.index}]` : null });
    }

    for (let cursor = 0; cursor < queue.length; cursor++) {
        if (performance.now() > deadline) {
            truncated = true;
            limitations.add('TRACE_TIME_LIMIT');
            break;
        }
        const { unitId, parameter, hops, depth } = queue[cursor];
        if (!summaries.has(unitId)) {
            if (summaries.size >= maxMethods) { truncated = true; break; }
            const unit = load(unitId);
            if (!unit) {
                summaries.set(unitId, undefined);
                limitations.add('CALLEE_SOURCE_UNAVAILABLE');
                if (hops.length) add(hops, false);
                continue;
            }
            bytes += Buffer.byteLength(unit.rawSource);
            if (bytes > maxSourceBytes) {
                truncated = true;
                limitations.add('TRACE_SOURCE_LIMIT');
                break;
            }
            let summary;
            try { summary = summarize(unit, fields(unit)); }
            catch (error) {
                if (!(error instanceof HttpError) || error.status !== 413) throw error;
                truncated = true;
                limitations.add('METHOD_ANALYSIS_LIMIT');
            }
            summaries.set(unitId, { location: { filePath: unit.filePath, qualifiedName: unit.qualifiedName }, summary });
        }
        const method = summaries.get(unitId);
        const summary = method?.summary;
        const key = summary?.parameters[parameter];
        if (!method || !summary || !key) {
            limitations.add('CALLEE_SOURCE_UNAVAILABLE');
            if (hops.length) add(hops, false);
            continue;
        }
        const dependencies = reached(summary, key);
        const propagated = summary.sites.filter(site => site.reads.some(read => dependencies.has(read)));
        let resolved = callIndex.get(unitId);
        if (!resolved && propagated.some(site => site.slot.kind === 'CALL_ARG')) {
            const relations = calls(unitId, maxCallSites + 1);
            resolved = { sites: new Map(), truncated: relations.length > maxCallSites };
            if (resolved.truncated) {
                limitations.add('CALL_SITE_LIMIT');
                truncated = true;
            }
            for (const target of relations.slice(0, maxCallSites)) {
                const key = locationKey(target.line, target.name);
                const at = resolved.sites.get(key) ?? [];
                at.push(target);
                resolved.sites.set(key, at);
            }
            callIndex.set(unitId, resolved);
        }
        for (const { slot, line } of propagated) {
            const hop: Hop = { methodQn: method.location.qualifiedName, unitId, filePath: method.location.filePath, line,
                from: { kind: 'PARAM', index: parameter, calleeHint: null }, to: slot };
            if (slot.kind === 'RETURN' || !slot.calleeHint) {
                add([...hops, hop], false);
                continue;
            }
            const address = locationKey(line, slot.calleeHint);
            const targets = resolved?.sites.get(address) ?? [];
            if (targets.length > 1 || (summary.locations.get(address) ?? 0) > 1) {
                limitations.add('AMBIGUOUS_CALL_SITE');
                add([...hops, hop], false);
            } else if (!targets.length) {
                if (!resolved?.truncated && parameterSinkRules.has(slot.calleeHint)) {
                    limitations.add('SINK_NAME_HEURISTIC');
                    add([...hops, { ...hop, to: { ...slot, kind: 'SINK' } }], true);
                } else {
                    limitations.add('UNRESOLVED_CALL_SITE');
                    add([...hops, hop], false);
                }
            } else if (depth >= maxDepth || queue.length >= maxStates) {
                truncated = true;
                add([...hops, hop], false);
            } else {
                const target = targets[0];
                const parameter = parameterForCall(target, slot.index);
                const key = target.targetId + ':' + parameter;
                if (!visited.has(key)) {
                    visited.add(key);
                    queue.push({ unitId: target.targetId, parameter, hops: [...hops, hop], depth: depth + 1 });
                }
            }
        }
        if (!propagated.length && hops.length) add(hops, false);
    }
    return { sourceMethod: source.qualifiedName, sourceParamIndex, paths, methodsAnalyzed: summaries.size, truncated,
        limitations: [...limitations] };
}
