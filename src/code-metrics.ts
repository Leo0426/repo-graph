import { dirname } from 'node:path/posix';
import type { DatabaseSync } from 'node:sqlite';
import type { CodeGraph } from './graph.js';
import type { CodeUnit } from './source.js';
import type { VulnerabilityInventory } from './vulnerability-inventory.js';

const procedures = "kind IN ('METHOD','FUNCTION','CONSTRUCTOR') AND json_extract(payload, '$.metadata.is_declaration') IS NOT 'true'";
const cLikeTokens = /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[\p{ID_Start}_$][\p{ID_Continue}_$]*|&&|\|\||\?\.|\?\?=?|\?:|\?/gu;
const pythonTokens = /#[^\r\n]*|"""(?:\\[\s\S]|"(?!"")|[^"\\])*"""|'''(?:\\[\s\S]|'(?!'')|[^'\\])*'''|"(?:\\[\s\S]|[^"\\\r\n])*"|'(?:\\[\s\S]|[^'\\\r\n])*'|[\p{ID_Start}_][\p{ID_Continue}_]*/gu;
const cBranches = new Set(['if', 'for', 'while', 'case', 'catch', '&&', '||', '?']);
const pythonBranches = new Set(['if', 'elif', 'for', 'while', 'case', 'except', 'and', 'or']);

interface QualityUnit {
    id: string; qualifiedName: string; filePath: string; startLine: number; kind: string;
    language: string; isTest: boolean; entryPoint: boolean; procedure: boolean;
}

export interface PackageDependency { from: string; to: string; count: number; cyclic: boolean }
export interface PackageCycle { packages: string[] }

export interface ComplexityMetric {
    qualifiedName: string; filePath: string; startLine: number; kind: string; complexity: number;
}

interface Summary { projectRoot: string; totalUnits: number; totalFiles: number; totalEdges: number }

function approximateComplexity(source: string, language: string) {
    const python = language === 'python';
    const branches = python ? pythonBranches : cBranches;
    let score = 1;
    for (const [token] of source.matchAll(python ? pythonTokens : cLikeTokens)) {
        if (branches.has(token)) score++;
    }
    return score;
}

function groupsOfMutuallyDependentPackages(dependencies: Map<string, Map<string, number>>) {
    const reverse = new Map<string, string[]>();
    for (const [from, targets] of dependencies) {
        for (const to of targets.keys()) {
            const sources = reverse.get(to) ?? [];
            sources.push(from);
            reverse.set(to, sources);
        }
    }
    const done: string[] = [];
    const visited = new Set<string>();
    for (const node of dependencies.keys()) {
        if (visited.has(node)) continue;
        const pending = [{ node, links: (dependencies.get(node) ?? new Map()).keys() }];
        visited.add(node);
        while (pending.length) {
            const frame = pending.at(-1)!;
            const next = frame.links.next();
            if (next.done) {
                done.push(frame.node);
                pending.pop();
            } else if (!visited.has(next.value)) {
                visited.add(next.value);
                pending.push({ node: next.value, links: (dependencies.get(next.value) ?? new Map()).keys() });
            }
        }
    }
    const groups: string[][] = [];
    visited.clear();
    for (const node of done.reverse()) {
        if (visited.has(node)) continue;
        const group: string[] = [];
        const pending = [node];
        visited.add(node);
        while (pending.length) {
            const current = pending.pop()!;
            group.push(current);
            for (const neighbor of reverse.get(current) ?? []) {
                if (visited.has(neighbor)) continue;
                visited.add(neighbor);
                pending.push(neighbor);
            }
        }
        if (group.length > 1) groups.push(group.sort());
    }
    return groups.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

export class CodeMetrics {
    constructor(private readonly db: DatabaseSync, private readonly graph: CodeGraph, private readonly vulnerabilities: VulnerabilityInventory) {}

    complexity(projectId: string, limit = Number.MAX_SAFE_INTEGER) {
        const ranked: ComplexityMetric[] = [];
        for (const value of this.db.prepare(`
            SELECT qualified_name, file_path, start_line, kind, language, json_extract(payload,'$.rawSource') AS source
            FROM unit WHERE project_id = ? AND ${procedures}
        `).iterate(projectId)) {
            const complexity = approximateComplexity(String(value.source ?? ''), String(value.language));
            if (complexity <= 1) continue;
            ranked.push({ qualifiedName: String(value.qualified_name), filePath: String(value.file_path),
                startLine: Number(value.start_line), kind: String(value.kind), complexity });
        }
        return ranked.sort((a, b) => b.complexity - a.complexity || a.filePath.localeCompare(b.filePath)
            || a.startLine - b.startLine || a.qualifiedName.localeCompare(b.qualifiedName)).slice(0, limit);
    }

    private units(projectId: string) {
        const units = new Map<string, QualityUnit>();
        for (const row of this.db.prepare(`
            SELECT id, qualified_name, file_path, start_line, kind, language, is_test,
                json_extract(payload, '$.metadata.is_entry_point') IS 'true' AS entry_point,
                (${procedures}) AS procedure
            FROM unit WHERE project_id = ? ORDER BY file_path, start_line, qualified_name, id
        `).iterate(projectId)) {
            const id = String(row.id);
            units.set(id, { id, qualifiedName: String(row.qualified_name), filePath: String(row.file_path),
                startLine: Number(row.start_line), kind: String(row.kind), language: String(row.language),
                isTest: !!row.is_test, entryPoint: !!row.entry_point,
                procedure: !!row.procedure });
        }
        return units;
    }

    private diagnosticsFrom(units: Map<string, QualityUnit>, calls: Map<string, Set<string>>) {
        const incoming = new Set<string>();
        for (const [from, targets] of calls) for (const to of targets) if (from !== to) incoming.add(to);
        let frontier = [...units.values()].filter(unit => unit.isTest).map(unit => unit.id);
        const covered = new Set(frontier);
        for (let step = 0; step < 6 && frontier.length; step++) {
            const next: string[] = [];
            for (const test of frontier) {
                for (const callee of calls.get(test) ?? []) {
                    if (covered.has(callee)) continue;
                    covered.add(callee);
                    next.push(callee);
                }
            }
            frontier = next;
        }
        const deadCode: string[] = [];
        const testGaps: string[] = [];
        let totalProductionMethods = 0;
        for (const { id, isTest, procedure, kind, entryPoint } of units.values()) {
            if (!procedure || isTest) continue;
            totalProductionMethods++;
            if (!covered.has(id)) testGaps.push(id);
            if (kind !== 'CONSTRUCTOR' && !entryPoint && !incoming.has(id)) deadCode.push(id);
        }
        return { deadCode, testGaps, totalProductionMethods };
    }

    private calls(projectId: string) {
        const calls = new Map<string, Set<string>>();
        for (const call of this.graph.callPairs(projectId)) {
            const from = String(call.source_id);
            const targets = calls.get(from) ?? new Set<string>();
            targets.add(String(call.target_id));
            calls.set(from, targets);
        }
        return calls;
    }

    diagnostics(projectId: string, category: 'deadCode' | 'testGaps', limit: number, offset: number) {
        const diagnostics = this.diagnosticsFrom(this.units(projectId), this.calls(projectId));
        const select = this.db.prepare('SELECT payload FROM unit WHERE id = ? AND project_id = ?');
        return diagnostics[category].slice(offset, offset + limit).map(id => JSON.parse(String(select.get(id, projectId)?.payload)) as CodeUnit);
    }

    private dependenciesFrom(projectId: string, units: Map<string, QualityUnit>, calls: Map<string, Set<string>>) {
        const parents = new Map<string, string>();
        for (const { source_id, target_id } of this.graph.typeParents(projectId)) parents.set(String(target_id), String(source_id));
        const classEdges = new Map<string, Set<string>>();
        const moduleEdges = new Map<string, Set<string>>();
        const nodes = new Map<string, string>();

        function add(map: Map<string, Set<string>>, from: string, to: string) {
            if (from === to) return;
            const targets = map.get(from) ?? new Set<string>();
            targets.add(to);
            map.set(from, targets);
        }

        function owner(id: string) {
            const unit = units.get(id)!;
            const type = units.get(parents.get(id) ?? '');
            const scope = type?.id ?? 'file:' + unit.filePath;
            const label = type?.language === 'java' && type.qualifiedName.includes('.')
                ? type.qualifiedName.slice(0, type.qualifiedName.lastIndexOf('.')) : dirname(unit.filePath);
            nodes.set(scope, label);
            return { scope, type };
        }

        for (const [sourceId, targets] of calls) {
            if (units.get(sourceId)?.isTest) continue;
            const source = owner(sourceId);
            for (const targetId of targets) {
                if (units.get(targetId)?.isTest) continue;
                const target = owner(targetId);
                if (source.type && target.type) add(classEdges, source.type.id, target.type.id);
                add(moduleEdges, source.scope, target.scope);
            }
        }

        const fanIn = new Map<string, number>();
        for (const targets of classEdges.values()) for (const target of targets) fanIn.set(target, (fanIn.get(target) ?? 0) + 1);
        const coupling = [...new Set([...classEdges.keys(), ...fanIn.keys()])].map(id => {
            const { qualifiedName, filePath, startLine } = units.get(id)!;
            const incoming = fanIn.get(id) ?? 0;
            const outgoing = classEdges.get(id)?.size ?? 0;
            return { classQualifiedName: qualifiedName, filePath, startLine, fanIn: incoming, fanOut: outgoing,
                instability: Math.round(1000 * outgoing / (incoming + outgoing)) / 1000 };
        });
        const dependencies = new Map<string, Map<string, number>>();
        for (const [source, targets] of moduleEdges) {
            const from = nodes.get(source)!;
            for (const target of targets) {
                const to = nodes.get(target)!;
                if (from === to) continue;
                const counts = dependencies.get(from) ?? new Map<string, number>();
                counts.set(to, (counts.get(to) ?? 0) + 1);
                dependencies.set(from, counts);
                if (!dependencies.has(to)) dependencies.set(to, new Map());
            }
        }

        const cycles: PackageCycle[] = groupsOfMutuallyDependentPackages(dependencies).map(packages => ({ packages }));
        const cyclic = new Map(cycles.flatMap(({ packages }, index) => packages.map(name => [name, index] as const)));
        const edges: PackageDependency[] = [];
        for (const from of [...dependencies.keys()].sort()) {
            for (const [to, count] of [...dependencies.get(from)!].sort(([a], [b]) => a.localeCompare(b))) {
                edges.push({ from, to, count, cyclic: cyclic.has(from) && cyclic.get(from) === cyclic.get(to) });
            }
        }
        return { coupling, cycles, edges };
    }

    dependencies(projectId: string) {
        return this.dependenciesFrom(projectId, this.units(projectId), this.calls(projectId));
    }

    report(projectId: string, stats: Summary, complexity = this.complexity(projectId)) {
        const units = this.units(projectId);
        const calls = this.calls(projectId);
        const { deadCode, testGaps, totalProductionMethods } = this.diagnosticsFrom(units, calls);
        const { coupling, cycles } = this.dependenciesFrom(projectId, units, calls);
        const highComplexityMethods = complexity.filter(metric => metric.complexity > 10).length;
        const highInstabilityClasses = coupling.filter(metric => metric.instability > 0.8).length;
        const gapRate = totalProductionMethods ? testGaps.length / totalProductionMethods : 0;
        const deadRate = totalProductionMethods ? deadCode.length / totalProductionMethods : 0;
        const active = this.vulnerabilities.activeCounts(projectId);
        const { CRITICAL: vulnCritical = 0, HIGH: vulnHigh = 0, MEDIUM: vulnMedium = 0, LOW: vulnLow = 0 } = active;
        const vulnerabilityPenalty = Math.min(vulnCritical * 15, 45) + Math.min(vulnHigh * 10, 40)
            + Math.min(vulnMedium * 5, 20) + Math.min(vulnLow * 2, 10);
        const penalty = Math.min(cycles.length * 10, 30) + Math.min(highComplexityMethods * 2, 20)
            + Math.min(highInstabilityClasses, 10) + (gapRate > 0.7 ? 15 : gapRate > 0.5 ? 10 : gapRate > 0.3 ? 5 : 0) + (deadRate > 0.1 ? 5 : 0);
        const { projectRoot, totalUnits, totalFiles, totalEdges } = stats;
        return {
            projectId, projectRoot, generatedAt: new Date().toISOString(), healthScore: Math.max(0, 100 - penalty - vulnerabilityPenalty),
            totalUnits, totalFiles, totalEdges, vulnCritical, vulnHigh, vulnMedium, vulnLow,
            packageCycles: cycles.length, highComplexityMethods, highInstabilityClasses,
            deadCodeCount: deadCode.length, testGapCount: testGaps.length, totalProductionMethods,
            topComplexMethods: complexity.slice(0, 5), topInstableCouplings: coupling.sort((a, b) => b.instability - a.instability
                || a.classQualifiedName.localeCompare(b.classQualifiedName)).slice(0, 5),
            packageCycleList: cycles.slice(0, 10), omittedReasons: [] as string[]
        };
    }
}
