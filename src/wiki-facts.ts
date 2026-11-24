import { dirname } from 'node:path/posix';
import type { DatabaseSync } from 'node:sqlite';
import type { CodeMetrics } from './code-metrics.js';
import type { CodeGraph } from './graph.js';

const MAX_UNITS = 20_000;
const MAX_CALLS = 100_000;
const MAX_MODULES = 200;
const PROJECT_SCOPE = '__project__';

export interface SummaryCitation { qualifiedName: string; filePath: string; startLine: number; endLine: number }
interface FactUnit extends SummaryCitation { id: string; scope: string; root: boolean; entry: boolean }
interface ModuleFacts {
    name: string;
    units: FactUnit[];
    files: Set<string>;
    entries: number;
    incoming: Map<string, number>;
    outgoing: Map<string, number>;
    references: Map<FactUnit, number>;
}
export type SummarySection = { title: string; body: string } & ({ source: 'facts' } | { source: 'llm'; phase?: string });
export interface SummaryDraft {
    level: 'PROJECT' | 'PACKAGE';
    scopeId: string;
    title: string;
    sections: SummarySection[];
    citations: SummaryCitation[];
}

function scopeFor(language: string, qualifiedName: string, file: string) {
    if (language !== 'java') return dirname(file);
    const type = qualifiedName.split(/[#$]/, 1)[0];
    const separator = type.lastIndexOf('.');
    return separator < 0 ? '.' : type.slice(0, separator);
}

function plain(text: string) {
    return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/[\\`*_{}\[\]()#+!|~]/g, '\\$&');
}

function section(title: string, items: string[], empty = 'No matching indexed facts.'): SummarySection {
    return { title, body: items.length ? items.map(item => '- ' + item).join('\n') : empty, source: 'facts' };
}

function countLabel(value: number, label: string) { return `${value} ${label}${value === 1 ? '' : 's'}`; }

function increment<T>(counts: Map<T, number>, key: T) { counts.set(key, (counts.get(key) ?? 0) + 1); }

function topDependencies(dependencies: Map<string, number>) {
    return [...dependencies.entries()].sort(([a, n], [b, m]) => m - n || a.localeCompare(b)).slice(0, 10);
}

function listings(units: Iterable<FactUnit>): SummaryCitation[] {
    return [...new Set(units)].map(({ qualifiedName, filePath, startLine, endLine }) => ({ qualifiedName, filePath, startLine, endLine }));
}

function location(unit: FactUnit) { return plain(unit.qualifiedName) + ' · ' + plain(unit.filePath) + ':' + unit.startLine; }

export function wikiFacts(db: DatabaseSync, graph: CodeGraph, metrics: CodeMetrics, projectId: string, projectName: string) {
    const units = new Map<string, FactUnit>();
    const packages = new Map<string, ModuleFacts>();
    const locations = new Map<string, FactUnit>();
    const key = (unit: Pick<FactUnit, 'filePath' | 'qualifiedName' | 'startLine'>) => JSON.stringify([unit.filePath, unit.startLine, unit.qualifiedName]);
    const counts = db.prepare(`SELECT count(*) AS units, coalesce(sum(json_extract(payload, '$.metadata.is_entry_point') IS 'true'),0) AS entries
        FROM unit WHERE project_id = ?`).get(projectId)!;
    const files = Number(db.prepare('SELECT count(*) AS total FROM indexed_file WHERE project_id = ?').get(projectId)?.total ?? 0);
    for (const row of db.prepare(`
        SELECT id, qualified_name, language, file_path, start_line, end_line,
            json_extract(payload,'$.parentQualifiedName') IS NULL AS root,
            json_extract(payload,'$.metadata.is_entry_point') IS 'true' AS entry
        FROM unit WHERE project_id = ? ORDER BY file_path, start_line, end_line, id LIMIT ?
    `).iterate(projectId, MAX_UNITS)) {
        const name = String(row.qualified_name), filePath = String(row.file_path);
        const scope = scopeFor(String(row.language), name, filePath);
        const unit: FactUnit = { id: String(row.id), scope, qualifiedName: name, filePath, startLine: Number(row.start_line),
            endLine: Number(row.end_line), root: !!row.root, entry: !!row.entry };
        units.set(unit.id, unit);
        locations.set(key(unit), unit);
        let module = packages.get(scope);
        if (!module) {
            module = { name: scope, units: [], files: new Set(), entries: 0, incoming: new Map(), outgoing: new Map(), references: new Map() };
            packages.set(scope, module);
        }
        module.units.push(unit);
        module.files.add(filePath);
        if (unit.entry) module.entries++;
    }

    const omissions: string[] = [];
    if (Number(counts.units) > MAX_UNITS) omissions.push('WIKI_UNIT_LIMIT');
    if (packages.size > MAX_MODULES) omissions.push('WIKI_MODULE_LIMIT');
    if (db.prepare('SELECT 1 FROM index_dirty WHERE project_id = ? LIMIT 1').get(projectId)) omissions.push('WIKI_INDEX_HAS_PENDING_FILES');
    const callExamples: { from: FactUnit; to: FactUnit }[] = [];
    let scannedCalls = 0;
    let crossModuleCalls = 0;
    for (const call of graph.callPairs(projectId)) {
        if (++scannedCalls > MAX_CALLS) { omissions.push('WIKI_CALL_LIMIT'); break; }
        const from = units.get(String(call.source_id)), to = units.get(String(call.target_id));
        if (!from || !to) continue;
        if (from.entry && callExamples.length < 10) callExamples.push({ from, to });
        if (from.scope === to.scope) continue;
        crossModuleCalls++;
        increment(packages.get(from.scope)!.outgoing, to.scope);
        increment(packages.get(to.scope)!.incoming, from.scope);
        increment(packages.get(to.scope)!.references, to);
    }

    const complexity = metrics.complexity(projectId, 200).flatMap(metric => {
        const unit = locations.get(key(metric));
        return unit ? [{ unit, value: metric.complexity }] : [];
    });
    const modules = [...packages.values()].sort((a, b) => b.units.length - a.units.length || a.name.localeCompare(b.name)).slice(0, MAX_MODULES);
    const entries = [...units.values()].filter(unit => unit.entry).slice(0, 10);
    const topComplexity = complexity.slice(0, 10);
    const body: SummaryDraft[] = [{ level: 'PROJECT', scopeId: PROJECT_SCOPE, title: projectName + ' Structure', sections: [
        section('Overview', [countLabel(files, 'indexed file'), countLabel(Number(counts.units), 'indexed symbol'),
            countLabel(Number(counts.entries), 'detected entry point'), countLabel(packages.size, 'observed module'),
            countLabel(crossModuleCalls, 'observed cross-module call')]),
        section('Modules', modules.slice(0, 20).map(module => [plain(module.name), countLabel(module.units.length, 'symbol'),
            countLabel(module.files.size, 'file')].join(' · '))),
        section('Entry points and direct calls', [...entries.map(location), ...callExamples.map(({ from, to }) => location(from) + ' → ' + location(to))]),
        section('Complexity hotspots', topComplexity.map(({ unit, value }) => location(unit) + ' · CC ' + value))
    ], citations: listings([...entries, ...callExamples.flatMap(({ from, to }) => [from, to]), ...topComplexity.map(item => item.unit)]) }];

    for (const module of modules) {
        const references = [...module.references.entries()].sort(([a, n], [b, m]) => m - n || a.id.localeCompare(b.id)).slice(0, 5).map(([unit]) => unit);
        if (!references.length) references.push(...module.units.filter(unit => unit.root).slice(0, 5));
        const hotspots = complexity.filter(item => item.unit.scope === module.name).slice(0, 5);
        const total = (counts: Map<string, number>) => [...counts.values()].reduce((sum, n) => sum + n, 0);
        body.push({ level: 'PACKAGE', scopeId: module.name, title: module.name, sections: [
            section('Module facts', [countLabel(module.units.length, 'indexed symbol'), countLabel(module.files.size, 'indexed file'),
                countLabel(module.entries, 'detected entry point'), countLabel(total(module.incoming), 'incoming call'),
                countLabel(total(module.outgoing), 'outgoing call')]),
            section('Cross-module dependencies', [...topDependencies(module.incoming).map(([name, n]) => `${plain(name)} → ${plain(module.name)} · ${n}`),
                ...topDependencies(module.outgoing).map(([name, n]) => `${plain(module.name)} → ${plain(name)} · ${n}`)]),
            section('Key symbols', references.map(location)),
            section('Complexity hotspots', hotspots.map(({ unit, value }) => location(unit) + ' · CC ' + value))
        ], citations: listings([...references, ...hotspots.map(item => item.unit)]) });
    }
    return { body, omissions };
}
