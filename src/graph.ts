import type { DatabaseSync } from 'node:sqlite';
import type { CodeUnit } from './source.js';
import type { GraphFacts } from './graph-source.js';
import { jsAliasPrefix } from './js-path-aliases.js';
import type { JsAliasTarget } from './js-path-aliases.js';

const MAX_GRAPH_UNITS = 500;
const MAX_DIAGRAM_CONNECTIONS = 32;
const queryKinds = {
    callees: ['CALLS'],
    callers: ['CALLS'],
    subtypes: ['EXTENDS', 'IMPLEMENTS'],
    impact: ['CALLS', 'EXTENDS', 'IMPLEMENTS', 'DEFINES_TYPE', 'OVERRIDES']
};
export type GraphQuery = keyof typeof queryKinds;
type GraphConnection = { source: string; target: string; depth: number };
export type GraphDiagram = {
    root: CodeUnit; results: CodeUnit[]; members: CodeUnit[]; connections: GraphConnection[];
};

export class CodeGraph {
    constructor(private readonly db: DatabaseSync) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS relation (
                source_id TEXT NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
                target_id TEXT NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
                kind TEXT NOT NULL, line INTEGER NOT NULL,
                PRIMARY KEY(source_id, target_id, kind, line)
            );
            CREATE INDEX IF NOT EXISTS relation_target ON relation(target_id, kind, source_id);
            CREATE TABLE IF NOT EXISTS graph_module (
                project_id TEXT NOT NULL, file_path TEXT NOT NULL, name TEXT NOT NULL, priority INTEGER NOT NULL,
                PRIMARY KEY(project_id, name, file_path),
                FOREIGN KEY(project_id, file_path) REFERENCES indexed_file(project_id, path) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS graph_module_file ON graph_module(project_id, file_path);
            CREATE TABLE IF NOT EXISTS graph_export (
                project_id TEXT NOT NULL, file_path TEXT NOT NULL, name TEXT NOT NULL,
                unit_id TEXT NOT NULL REFERENCES unit(id) ON DELETE CASCADE, kind TEXT NOT NULL,
                type_only INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(project_id, file_path, name)
            );
            CREATE INDEX IF NOT EXISTS graph_export_unit ON graph_export(unit_id);
            CREATE TABLE IF NOT EXISTS graph_import (
                source_id TEXT NOT NULL REFERENCES unit(id) ON DELETE CASCADE, project_id TEXT NOT NULL,
                module TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL,
                PRIMARY KEY(source_id, module, name, kind, line)
            );
            CREATE INDEX IF NOT EXISTS graph_import_target ON graph_import(project_id, module, name);
            CREATE TABLE IF NOT EXISTS graph_js_member_import (
                source_id TEXT NOT NULL REFERENCES unit(id) ON DELETE CASCADE, project_id TEXT NOT NULL,
                module TEXT NOT NULL, name TEXT NOT NULL, members TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL,
                PRIMARY KEY(source_id, module, name, members, kind, line)
            );
            CREATE INDEX IF NOT EXISTS graph_js_member_import_target ON graph_js_member_import(project_id, module, name);
            CREATE TABLE IF NOT EXISTS graph_js_export_route (
                project_id TEXT NOT NULL, file_path TEXT NOT NULL, name TEXT NOT NULL,
                target_module TEXT, target_name TEXT, is_star INTEGER NOT NULL, type_only INTEGER NOT NULL,
                FOREIGN KEY(project_id, file_path) REFERENCES indexed_file(project_id, path) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS graph_js_export_route_file ON graph_js_export_route(project_id, file_path, is_star, name);
            CREATE INDEX IF NOT EXISTS graph_js_export_route_target ON graph_js_export_route(project_id, target_module);
            CREATE TABLE IF NOT EXISTS graph_js_alias_candidate (
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                name TEXT NOT NULL, priority INTEGER NOT NULL, target TEXT NOT NULL,
                PRIMARY KEY(project_id, name, priority)
            );
            CREATE TABLE IF NOT EXISTS graph_java_lookup (
                source_id TEXT NOT NULL REFERENCES unit(id) ON DELETE CASCADE, project_id TEXT NOT NULL,
                kind TEXT NOT NULL, line INTEGER NOT NULL, candidates TEXT NOT NULL,
                PRIMARY KEY(source_id, kind, line, candidates)
            );
        `);
        if (!db.prepare('PRAGMA table_info(graph_export)').all().some(column => column.name === 'type_only')) {
            db.exec('ALTER TABLE graph_export ADD COLUMN type_only INTEGER NOT NULL DEFAULT 0');
        }
        db.exec(`
            BEGIN IMMEDIATE;
            DROP VIEW IF EXISTS code_relation;
            DROP VIEW IF EXISTS graph_java_type;
            DROP VIEW IF EXISTS graph_js_relation;
            DROP VIEW IF EXISTS graph_module_choice;
            CREATE VIEW graph_module_choice AS
                SELECT m.project_id, m.name, m.file_path FROM graph_module m
                WHERE NOT EXISTS (
                    SELECT 1 FROM graph_module other
                    WHERE other.project_id = m.project_id AND other.name = m.name
                        AND other.file_path <> m.file_path AND other.priority <= m.priority
                );
            CREATE VIEW graph_js_relation AS
                WITH RECURSIVE routed_modules AS (
                    SELECT DISTINCT entry.project_id, entry.name AS module, route.name, route.is_star
                    FROM graph_js_export_route route
                    JOIN graph_module_choice entry ON entry.project_id = route.project_id AND entry.file_path = route.file_path
                    WHERE route.target_module IS NOT NULL
                ), requests AS (
                    SELECT DISTINCT i.project_id, i.module, i.name, '[]' AS members, i.source_id, i.kind, i.line
                    FROM routed_modules route JOIN graph_import i ON i.project_id = route.project_id AND i.module = route.module
                        AND (CASE route.is_star WHEN 1 THEN i.name <> 'default' ELSE route.name = i.name END)
                    UNION ALL
                    SELECT DISTINCT i.project_id, i.module, i.name, i.members, i.source_id, i.kind, i.line
                    FROM routed_modules route JOIN graph_js_member_import i ON i.project_id = route.project_id AND i.module = route.module
                        AND (CASE route.is_star WHEN 1 THEN i.name <> 'default' ELSE route.name = i.name END)
                ), forwarding(project_id, entry_module, entry_name, entry_members, module, name, members, type_only, depth) AS (
                    SELECT DISTINCT project_id, module, name, members, module, name, members, 0, 0 FROM requests
                    UNION
                    SELECT f.project_id, f.entry_module, f.entry_name, f.entry_members, route.target_module,
                        CASE WHEN route.is_star = 1 THEN f.name
                            ELSE coalesce(route.target_name, json_extract(f.members, '$[0]')) END,
                        CASE WHEN route.target_name IS NULL THEN json_remove(f.members, '$[0]') ELSE f.members END,
                        f.type_only OR route.type_only, f.depth + 1
                    FROM forwarding f
                    JOIN graph_module_choice m ON m.project_id = f.project_id AND m.name = f.module
                    JOIN graph_js_export_route route ON route.project_id = m.project_id AND route.file_path = m.file_path
                    WHERE f.depth < 12 AND route.target_module IS NOT NULL
                        AND (route.target_name IS NOT NULL OR json_array_length(f.members) > 0)
                        AND NOT EXISTS (SELECT 1 FROM graph_export e
                            WHERE e.project_id = m.project_id AND e.file_path = m.file_path AND e.name = f.name)
                        AND ((route.is_star = 0 AND route.name = f.name) OR
                            (route.is_star = 1 AND f.name <> 'default' AND NOT EXISTS (
                                SELECT 1 FROM graph_js_export_route explicit
                                WHERE explicit.project_id = m.project_id AND explicit.file_path = m.file_path
                                    AND explicit.is_star = 0 AND explicit.name = f.name)))
                ), bindings AS (
                    SELECT f.project_id, f.entry_module, f.entry_name, f.entry_members, json_array_length(f.members) AS remaining,
                        e.unit_id, f.type_only OR e.type_only AS type_only,
                        CASE WHEN e.unit_id IS NOT NULL THEN json_array('unit', e.unit_id)
                            WHEN ns.file_path IS NOT NULL THEN json_array('namespace', ns.file_path)
                            WHEN terminal.target_module IS NOT NULL THEN json_array('namespace-module', terminal.target_module)
                            ELSE json_array('opaque', m.file_path, f.name) END AS identity
                    FROM forwarding f
                    JOIN graph_module_choice m ON m.project_id = f.project_id AND m.name = f.module
                    LEFT JOIN graph_export e ON e.project_id = m.project_id AND e.file_path = m.file_path AND e.name = f.name
                    LEFT JOIN graph_js_export_route terminal ON e.unit_id IS NULL AND terminal.project_id = m.project_id
                        AND terminal.file_path = m.file_path AND terminal.is_star = 0 AND terminal.name = f.name
                        AND (terminal.target_module IS NULL OR terminal.target_name IS NULL)
                    LEFT JOIN graph_module_choice ns ON ns.project_id = m.project_id AND ns.name = terminal.target_module
                    WHERE (f.depth > 0 OR f.entry_members <> '[]') AND (e.unit_id IS NOT NULL OR terminal.name IS NOT NULL)
                ), selection AS (
                    -- Resolve each namespace before considering whether its requested member exists.
                    SELECT project_id, entry_module, entry_name, entry_members, remaining,
                        min(unit_id) AS unit_id, min(type_only) AS type_only, count(DISTINCT identity) AS candidates
                    FROM bindings GROUP BY project_id, entry_module, entry_name, entry_members, remaining
                )
                SELECT DISTINCT i.source_id, t.unit_id AS target_id, i.kind, i.line
                FROM selection t
                JOIN requests i ON i.project_id = t.project_id AND i.module = t.entry_module
                    AND i.name = t.entry_name AND i.members = t.entry_members
                JOIN unit u ON u.id = t.unit_id
                WHERE t.remaining = 0 AND t.candidates = 1
                    AND NOT EXISTS (SELECT 1 FROM selection prefix
                        WHERE prefix.project_id = t.project_id AND prefix.entry_module = t.entry_module
                            AND prefix.entry_name = t.entry_name AND prefix.entry_members = t.entry_members
                            AND prefix.remaining > 0 AND prefix.candidates > 1)
                    AND (CASE i.kind WHEN 'CALLS' THEN u.kind = 'FUNCTION' ELSE u.kind IN ('CLASS', 'INTERFACE') END)
                    AND (t.type_only = 0 OR i.kind IN ('DEFINES_TYPE', 'IMPLEMENTS') OR
                        (i.kind = 'EXTENDS' AND EXISTS (SELECT 1 FROM unit s WHERE s.id = i.source_id AND s.kind = 'INTERFACE')));
            CREATE VIEW graph_java_type AS
                SELECT m.project_id, m.file_path, m.name AS module,
                    json_extract(u.payload, '$.metadata.visibility') AS visibility
                FROM graph_module m
                JOIN graph_export e ON e.project_id = m.project_id AND e.file_path = m.file_path
                    AND e.name = substr(m.name, 7)
                JOIN unit u ON u.id = e.unit_id
                WHERE m.name GLOB '/java/*'
                    AND e.kind IN ('CLASS', 'INTERFACE', 'ENUM', 'ANNOTATION')
                    AND json_extract(u.payload, '$.parentQualifiedName') IS NULL;
            CREATE VIEW code_relation AS
                SELECT source_id, target_id, kind, line FROM relation
                UNION ALL
                SELECT CASE i.kind WHEN 'CONTAINS' THEN e.unit_id ELSE i.source_id END,
                    CASE i.kind WHEN 'CONTAINS' THEN i.source_id ELSE e.unit_id END, i.kind, i.line
                FROM graph_import i
                JOIN graph_module_choice m ON m.project_id = i.project_id AND m.name = i.module
                JOIN graph_export e ON e.project_id = m.project_id AND e.file_path = m.file_path AND e.name = i.name
                WHERE (CASE WHEN m.name GLOB '/java/*' THEN CASE i.kind
                    WHEN 'CALLS' THEN e.kind IN ('METHOD', 'CONSTRUCTOR')
                    WHEN 'OVERRIDES' THEN e.kind = 'METHOD'
                    WHEN 'EXTENDS' THEN e.kind IN ('CLASS', 'INTERFACE')
                    WHEN 'IMPLEMENTS' THEN e.kind = 'INTERFACE'
                    ELSE e.kind IN ('CLASS', 'INTERFACE', 'ENUM', 'ANNOTATION') END
                    WHEN m.name GLOB '/python/*' THEN CASE i.kind
                    WHEN 'CALLS' THEN e.kind = 'METHOD'
                    WHEN 'EXTENDS' THEN e.kind = 'CLASS'
                    ELSE e.kind IN ('CLASS', 'METHOD') END
                    WHEN m.name GLOB '/c/header/*' THEN i.kind = 'IMPORTS' AND e.kind = 'FUNCTION'
                    WHEN m.name GLOB '/c/link/*' THEN i.kind = 'CALLS' AND e.kind = 'FUNCTION' AND (
                        EXISTS (
                            SELECT 1 FROM unit caller JOIN graph_export proto
                                ON proto.project_id = caller.project_id AND proto.file_path = caller.file_path
                            JOIN unit declared ON declared.id = proto.unit_id
                            JOIN unit definition ON definition.id = e.unit_id
                            WHERE caller.id = i.source_id AND proto.name = i.name || '#decl'
                                AND json_extract(declared.payload, '$.metadata.param_types') = json_extract(definition.payload, '$.metadata.param_types')
                                AND json_extract(declared.payload, '$.metadata.return_type') = json_extract(definition.payload, '$.metadata.return_type')
                        ) OR EXISTS (
                            SELECT 1 FROM graph_import use
                            JOIN graph_module header ON header.project_id = use.project_id AND header.name = use.module
                            JOIN graph_export proto ON proto.project_id = header.project_id AND proto.file_path = header.file_path
                                AND proto.name = use.name
                            JOIN unit declared ON declared.id = proto.unit_id
                            JOIN unit definition ON definition.id = e.unit_id
                            WHERE use.source_id = i.source_id AND use.kind = 'IMPORTS'
                                AND use.module GLOB '/c/header/*' AND use.name = i.name || '#decl'
                                AND json_extract(declared.payload, '$.metadata.param_types') = json_extract(definition.payload, '$.metadata.param_types')
                                AND json_extract(declared.payload, '$.metadata.return_type') = json_extract(definition.payload, '$.metadata.return_type')
                        )
                    )
                    ELSE CASE i.kind WHEN 'CALLS' THEN e.kind = 'FUNCTION' ELSE e.kind IN ('CLASS', 'INTERFACE') END END)
                AND (e.type_only = 0 OR i.kind IN ('DEFINES_TYPE', 'IMPLEMENTS') OR
                    (i.kind = 'EXTENDS' AND EXISTS (SELECT 1 FROM unit s WHERE s.id = i.source_id AND s.kind = 'INTERFACE')))
                UNION ALL
                SELECT source_id, target_id, kind, line FROM graph_js_relation
                UNION ALL
                SELECT DISTINCT l.source_id, e.unit_id, l.kind, l.line
                FROM graph_java_lookup l
                JOIN json_each(l.candidates) candidate
                JOIN graph_java_type t ON t.project_id = l.project_id AND t.module = json_extract(candidate.value, '$.module')
                JOIN json_each(candidate.value, '$.names') wanted
                JOIN graph_export e ON e.project_id = t.project_id AND e.file_path = t.file_path AND e.name = wanted.value
                WHERE (json_extract(candidate.value, '$.publicOnly') = 0 OR t.visibility = 'public')
                AND (CASE l.kind
                    WHEN 'CALLS' THEN e.kind IN ('METHOD', 'CONSTRUCTOR')
                    WHEN 'OVERRIDES' THEN e.kind = 'METHOD'
                    WHEN 'EXTENDS' THEN e.kind IN ('CLASS', 'INTERFACE')
                    WHEN 'IMPLEMENTS' THEN e.kind = 'INTERFACE'
                    ELSE e.kind IN ('CLASS', 'INTERFACE', 'ENUM', 'ANNOTATION') END)
                AND NOT EXISTS (
                    SELECT 1 FROM json_each(l.candidates) competing
                    JOIN graph_java_type alternate ON alternate.project_id = l.project_id
                        AND alternate.module = json_extract(competing.value, '$.module')
                    WHERE json_extract(competing.value, '$.priority') <= json_extract(candidate.value, '$.priority')
                        AND (json_extract(competing.value, '$.publicOnly') = 0 OR alternate.visibility = 'public'
                            OR alternate.module = t.module)
                        AND (alternate.module <> t.module OR alternate.file_path <> t.file_path)
                );
            COMMIT;
        `);
    }

    jsAliasReferences(project: string) {
        const prefix = jsAliasPrefix + '*';
        return this.db.prepare(`
            SELECT module AS name FROM graph_import WHERE project_id = ? AND module GLOB ?
            UNION SELECT module FROM graph_js_member_import WHERE project_id = ? AND module GLOB ?
            UNION SELECT target_module FROM graph_js_export_route WHERE project_id = ? AND target_module GLOB ?
        `).all(project, prefix, project, prefix, project, prefix).map(row => String(row.name));
    }

    syncJsAliases(project: string, aliases: JsAliasTarget[]) {
        const previous = new Map<string, string[]>();
        for (const row of this.db.prepare('SELECT name, target FROM graph_js_alias_candidate WHERE project_id = ? ORDER BY name, priority')
            .iterate(project)) {
            const name = String(row.name);
            const targets = previous.get(name) ?? [];
            targets.push(String(row.target));
            previous.set(name, targets);
        }
        const remove = this.db.prepare('DELETE FROM graph_js_alias_candidate WHERE project_id = ? AND name = ?');
        const insert = this.db.prepare('INSERT INTO graph_js_alias_candidate VALUES (?, ?, ?, ?)');
        for (const { name, targets } of aliases) {
            const old = previous.get(name) ?? [];
            previous.delete(name);
            if (!targets || (targets.length === old.length && targets.every((target, index) => target === old[index]))) continue;
            remove.run(project, name);
            for (const [priority, target] of targets.entries()) insert.run(project, name, priority, target);
        }
        for (const name of previous.keys()) remove.run(project, name);
        // Publish virtual module keys alongside physical keys so probes and re-exports share the same index.
        this.db.prepare('DELETE FROM graph_module WHERE project_id = ? AND name GLOB ?').run(project, jsAliasPrefix + '*');
        this.db.prepare(`
            INSERT INTO graph_module(project_id, file_path, name, priority)
            SELECT a.project_id, physical.file_path, a.name, physical.priority
            FROM graph_js_alias_candidate a
            JOIN graph_module physical ON physical.project_id = a.project_id AND physical.name = a.target
            WHERE a.project_id = ? AND NOT EXISTS (
                    SELECT 1 FROM graph_js_alias_candidate earlier JOIN graph_module candidate
                        ON candidate.project_id = earlier.project_id AND candidate.name = earlier.target
                    WHERE earlier.project_id = a.project_id AND earlier.name = a.name AND earlier.priority < a.priority
            )
        `).run(project);
    }

    put(project: string, path: string, facts: GraphFacts) {
        const local = this.db.prepare('INSERT OR IGNORE INTO relation VALUES (?, ?, ?, ?)');
        const imported = this.db.prepare('INSERT OR IGNORE INTO graph_import VALUES (?, ?, ?, ?, ?, ?)');
        const exported = this.db.prepare('INSERT INTO graph_export VALUES (?, ?, ?, ?, ?, ?)');
        const module = this.db.prepare('INSERT INTO graph_module VALUES (?, ?, ?, ?)');
        for (const edge of facts.edges) {
            if (edge.resolved) local.run(edge.sourceId, edge.targetId, edge.kind, edge.sourceLine);
        }
        for (const key of facts.moduleKeys) module.run(project, path, key.name, key.priority);
        for (const item of facts.exports) exported.run(project, path, item.name, item.unit.id, item.unit.kind, Number(item.typeOnly === true));
        for (const link of facts.imports) imported.run(link.sourceId, project, link.module, link.name, link.kind, link.line);
        if (facts.jsMemberImports?.length) {
            const member = this.db.prepare('INSERT OR IGNORE INTO graph_js_member_import VALUES (?, ?, ?, ?, ?, ?, ?)');
            for (const link of facts.jsMemberImports) {
                member.run(link.sourceId, project, link.module, link.name, JSON.stringify(link.members), link.kind, link.line);
            }
        }
        if (facts.jsExportRoutes?.length) {
            const route = this.db.prepare('INSERT INTO graph_js_export_route VALUES (?, ?, ?, ?, ?, ?, ?)');
            for (const item of facts.jsExportRoutes) {
                route.run(project, path, item.name, item.target?.module ?? null, item.target?.name ?? null,
                    Number(item.star), Number(item.typeOnly));
            }
        }
        if (facts.javaTypeLookups?.length) {
            const lookup = this.db.prepare('INSERT OR IGNORE INTO graph_java_lookup VALUES (?, ?, ?, ?, ?)');
            for (const link of facts.javaTypeLookups) {
                lookup.run(link.sourceId, project, link.kind, link.line, JSON.stringify(link.candidates));
            }
        }
    }

    count(projectId: string, file: string | null = null) {
        return Number(this.db.prepare(`
            SELECT count(*) AS n FROM code_relation r JOIN unit u ON u.id = r.source_id WHERE u.project_id = ?
                AND (? IS NULL OR u.file_path = ?)
        `).get(projectId, file, file)?.n);
    }

    edgeDistribution(projectId: string) {
        const rows = this.db.prepare(`
            SELECT r.kind AS kind, count(*) AS n
            FROM code_relation r JOIN unit u ON u.id = r.source_id
            WHERE u.project_id = ? GROUP BY r.kind ORDER BY r.kind
        `).all(projectId);
        return Object.fromEntries(rows.map(row => [String(row.kind), Number(row.n)]));
    }

    callPairs(projectId: string) {
        return this.db.prepare(`
            SELECT DISTINCT r.source_id, r.target_id FROM code_relation r
            JOIN unit source ON source.id = r.source_id JOIN unit target ON target.id = r.target_id
            WHERE r.kind = 'CALLS' AND source.project_id = ? AND target.project_id = ?
            ORDER BY r.source_id, r.target_id
        `).iterate(projectId, projectId);
    }

    callSites(projectId: string, sourceId: string, limit: number) {
        return this.db.prepare(`
            SELECT DISTINCT r.line, r.target_id,
                json_extract(target.payload, '$.simpleName') AS name,
                json_extract(target.payload, '$.metadata.param_types') AS paramTypes
            FROM code_relation r
            JOIN unit target ON target.id = r.target_id
            WHERE r.source_id = ? AND r.kind = 'CALLS' AND target.project_id = ? AND target.kind = 'METHOD'
            ORDER BY r.line, r.target_id LIMIT ?
        `).all(sourceId, projectId, limit).map(row => ({
            line: Number(row.line), targetId: String(row.target_id), name: String(row.name), paramTypes: String(row.paramTypes ?? '')
        }));
    }

    typeParents(projectId: string) {
        return this.db.prepare(`
            SELECT r.source_id, r.target_id FROM code_relation r
            JOIN unit parent ON parent.id = r.source_id JOIN unit child ON child.id = r.target_id
            WHERE r.kind = 'CONTAINS' AND parent.project_id = ? AND child.project_id = ?
                AND parent.kind IN ('CLASS','INTERFACE','ENUM','ANNOTATION','STRUCT','UNION')
            ORDER BY r.source_id, r.target_id
        `).iterate(projectId, projectId);
    }

    traverse(seed: string, query: GraphQuery, depth: number, limit = MAX_GRAPH_UNITS, connections?: GraphConnection[], snapshotId?: string) {
        const [from, to] = query === 'callees' ? ['source_id', 'target_id'] : ['target_id', 'source_id'];
        const kinds = queryKinds[query];
        const tables = snapshotId ? { relation: 'knowledge_relation', unit: 'knowledge_unit', scope: 'r.snapshot_id = ? AND',
            join: 'AND u.snapshot_id = r.snapshot_id' } : { relation: 'code_relation', unit: 'unit', scope: '', join: '' };
        const scope = snapshotId ? [snapshotId] : [];
        const neighbors = this.db.prepare(`
            SELECT DISTINCT u.id FROM ${tables.relation} r JOIN ${tables.unit} u ON u.id = r.${to} ${tables.join}
            WHERE ${tables.scope} r.${from} = ? AND r.kind IN (${kinds.map(() => '?').join(',')})
            ORDER BY u.qualified_name, u.file_path, u.id LIMIT ?
        `);
        const load = this.unitLoader(snapshotId);

        let frontier = [seed];
        if (query === 'impact') {
            const members = this.db.prepare(`
                SELECT target_id FROM ${tables.relation} r WHERE ${tables.scope} source_id = ? AND kind = 'CONTAINS'
                ORDER BY target_id LIMIT ?
            `).all(...scope, seed, MAX_GRAPH_UNITS);
            frontier.push(...members.map(row => String(row.target_id)));
        }
        const seen = new Set(frontier);
        const units: CodeUnit[] = [];
        for (let step = 0; step < depth && frontier.length; step++) {
            const next: string[] = [];
            for (const id of frontier) {
                for (const row of neighbors.all(...scope, id, ...kinds, seen.size + limit - units.length)) {
                    const neighbor = String(row.id);
                    if (seen.has(neighbor)) continue;
                    seen.add(neighbor);
                    next.push(neighbor);
                    units.push(load(neighbor));
                    if (connections && connections.length < MAX_DIAGRAM_CONNECTIONS) {
                        const source = query === 'callees' ? id : neighbor;
                        const target = query === 'callees' ? neighbor : id;
                        connections.push({ source, target, depth: step + 1 });
                    }
                    if (units.length >= limit) return units;
                }
            }
            frontier = next;
        }
        return units;
    }

    private unitLoader(snapshotId?: string) {
        const query = snapshotId ? 'SELECT payload FROM knowledge_unit WHERE id = ? AND snapshot_id = ?' : 'SELECT payload FROM unit WHERE id = ?';
        const payload = this.db.prepare(query);
        return (id: string) => JSON.parse(String((snapshotId ? payload.get(id, snapshotId) : payload.get(id))?.payload)) as CodeUnit;
    }

    traverseView(seed: string, query: GraphQuery, depth: number, snapshotId?: string): GraphDiagram {
        const load = this.unitLoader(snapshotId);
        const root = load(seed);
        const connections: GraphConnection[] = [];
        const results = this.traverse(seed, query, depth, MAX_GRAPH_UNITS, connections, snapshotId);
        const parents = new Set(connections.map(edge => query === 'callees' ? edge.source : edge.target));
        for (const { id } of [root, ...results]) parents.delete(id);
        const members = [...parents].map(load);
        return { root, results, connections, members };
    }
}
