import { extname } from 'node:path/posix';
import type { Node } from '@vscode/tree-sitter-wasm';
import type { GraphFacts, RelationKind } from './graph-source.js';
import type { CodeUnit, IndexedSource, UnitFactory } from './source.js';
import { documentationSummary } from './source-documentation.js';
import { sourceEndLine, sourceLine, syntaxChildren, syntaxParser } from './syntax-tree.js';

export const parsePythonSyntax = await syntaxParser('@vscode/tree-sitter-wasm/wasm/tree-sitter-python.wasm');
const identifiers = /^[\p{ID_Start}_][\p{ID_Continue}_]*(?:\.[\p{ID_Start}_][\p{ID_Continue}_]*)*$/u;
const scopeBoundaries = new Set(['function_definition', 'class_definition', 'decorated_definition', 'lambda']);

interface Definition { unit: CodeUnit; node: Node; parent: CodeUnit | null }
interface Import { module: string; name?: string; prefix?: string }

function moduleKey(path: string) { return '/python/' + path; }

export function parsePython(file: string, source: string, build: UnitFactory): IndexedSource {
    const tree = parsePythonSyntax(source);
    try {
        if (tree.rootNode.hasError) throw new Error('SYNTAX_ERROR');
        return readPythonFile(file, tree.rootNode, build);
    } finally {
        tree.delete();
    }
}

function readPythonFile(file: string, root: Node, build: UnitFactory): IndexedSource {
    const facts: GraphFacts = { edges: [], imports: [], exports: [], moduleKeys: [] };
    const definitions = new Map<string, Definition>();
    const duplicates = new Set<string>();
    const documentation = new Map<string, string>();
    const statements = syntaxChildren(root);
    const testFile = /(?:^|\/)(?:tests?|__tests__)\/|(?:^|\/)test_[^/]+\.pyi?$|_test\.pyi?$/.test(file);
    const path = file.slice(0, -extname(file).length).split('/');
    const isPackage = path.at(-1) === '__init__';
    const packagePath = path.slice(0, -1);
    const modulePath = isPackage ? packagePath : path;
    const basePriority = file.endsWith('.pyi') ? 2 : 0;
    function addModule(parts: string[], priority: number) {
        const name = parts.join('.');
        if (identifiers.test(name) || !name) facts.moduleKeys.push({ name: moduleKey(name), priority });
    }
    addModule(modulePath, basePriority + Number(!isPackage));
    if (modulePath[0] === 'src') addModule(modulePath.slice(1), 4 + basePriority + Number(!isPackage));

    function addDeclarations(block: Node, parent: CodeUnit | null, depth: number) {
        if (depth > 64) throw new Error('SYNTAX_LIMIT');
        for (const statement of syntaxChildren(block)) {
            const node = statement.type === 'decorated_definition' ? statement.childForFieldName('definition') : statement;
            if (!node || !['class_definition', 'function_definition'].includes(node.type)) continue;
            const name = node.childForFieldName('name')?.text;
            if (!name) continue;
            const isClass = node.type === 'class_definition';
            const qualified = parent ? parent.qualifiedName + (isClass ? '.' : '#') + name : name;
            const decorators = syntaxChildren(statement).filter(child => child.type === 'decorator');
            const names = decorators.flatMap(decorator => {
                const target = syntaxChildren(decorator)[0];
                const expression = target?.type === 'call' ? target.childForFieldName('function') : target;
                return expression ? ['@' + expression.text] : [];
            });
            const metadata: Record<string, string> = { visibility: 'public' };
            const params = node.childForFieldName('parameters');
            const returns = node.childForFieldName('return_type')?.text;
            const types = syntaxChildren(params).map(param => param.childForFieldName('type')?.text).filter(Boolean);
            const async = node.children.some(child => child?.type === 'async');
            if (types.length) metadata.param_types = types.join(',');
            if (returns) metadata.return_type = returns;
            if (async) metadata.is_async = 'true';
            const bases = node.childForFieldName('superclasses')?.text;
            if (bases && bases !== '()') metadata.bases = bases.slice(1, -1).trim();
            if (testFile || /^test_/.test(name) || /^Test/.test(name) && isClass) metadata.is_test = 'true';
            const template = isClass ? 'class ' + name + (bases ?? '')
                : (async ? 'async def ' : 'def ') + name + (params?.text ?? '()') + (returns ? ' -> ' + returns : '');
            const unit = build(isClass ? 'CLASS' : 'METHOD', name, qualified, sourceLine(statement), sourceEndLine(statement),
                statement.text, template, parent?.qualifiedName ?? null, metadata, names);
            if (definitions.has(qualified)) duplicates.add(qualified);
            if (definitions.size >= 10_000) throw new Error('SYNTAX_LIMIT');
            definitions.set(qualified, { unit, node, parent });
            const body = node.childForFieldName('body');
            documentation.delete(unit.id);
            const first = syntaxChildren(body)[0];
            const literal = first?.type === 'expression_statement' ? syntaxChildren(first)[0] : undefined;
            if (literal?.type === 'string') {
                const pieces = syntaxChildren(literal);
                const quote = pieces[0]?.type === 'string_start' ? pieces[0].text : '';
                if (/^[rRuU]?['"]/.test(quote)) {
                    const text = pieces.filter(piece => piece.type === 'string_content').map(piece => piece.text).join('');
                    const summary = documentationSummary(text);
                    if (summary) documentation.set(unit.id, summary);
                }
            }
            if (isClass && body) addDeclarations(body, unit, depth + 1);
        }
    }
    addDeclarations(root, null, 1);

    const imports = new Map<string, Import | null>();
    const assigned = new Set<string>();
    const direct = new Set(statements.map(node => node.id));
    let wildcard = false;
    function bind(name: string, target: Import) {
        imports.set(name, imports.has(name) ? null : target);
    }
    function plainModule(name: string) { return identifiers.test(name) ? name : undefined; }
    function fromModule(name: string) {
        const relative = /^(\.+)(.*)$/.exec(name);
        if (!relative) return plainModule(name);
        const up = relative[1].length - 1;
        if (up >= packagePath.length || relative[2] && !plainModule(relative[2])) return undefined;
        return [...packagePath.slice(0, packagePath.length - up), relative[2]].filter(Boolean).join('.');
    }
    for (const statement of statements) {
        const from = statement.childForFieldName('module_name')?.text;
        if (!['import_statement', 'import_from_statement'].includes(statement.type)) continue;
        if (syntaxChildren(statement).some(node => node.type === 'wildcard_import')) { wildcard = true; continue; }
        for (const record of statement.childrenForFieldName('name')) {
            if (!record) continue;
            const name = record.childForFieldName('name')?.text ?? record.text;
            const alias = record.childForFieldName('alias')?.text;
            if (!plainModule(name)) continue;
            if (from) {
                const base = fromModule(from);
                if (base === undefined) continue;
                bind(alias ?? name, { module: base, name, ...(from === '.' ? { prefix: base + '.' + name } : {}) });
            } else bind(alias ?? name.split('.')[0], { module: name, prefix: alias ?? name });
        }
    }

    let visited = 0;
    function inspectScope(block: Node | null, shadowed: Set<string>, visitCall?: (node: Node) => void, trackImports = true) {
        const pending = syntaxChildren(block);
        function assign(node: Node | null | undefined) {
            if (!node) return;
            if (node.type === 'identifier' || node.type === 'attribute') shadowed.add(node.text);
            else if (['tuple', 'list', 'tuple_pattern', 'list_pattern', 'pattern_list', 'list_splat_pattern'].includes(node.type)) {
                for (const child of syntaxChildren(node)) assign(child);
            }
        }
        while (pending.length) {
            const node = pending.pop()!;
            if (++visited > 150_000) throw new Error('SYNTAX_LIMIT');
            if (scopeBoundaries.has(node.type)) {
                const declaration = node.childForFieldName('definition') ?? node;
                if (trackImports || !direct.has(node.id)) assign(declaration.childForFieldName('name'));
                continue;
            }
            if (['assignment', 'augmented_assignment', 'named_expression', 'for_statement', 'for_in_clause'].includes(node.type)) {
                assign(node.childForFieldName('left') ?? node.childForFieldName('name'));
            }
            if (node.type === 'as_pattern') assign(syntaxChildren(node.childForFieldName('alias'))[0]);
            if ((trackImports || !direct.has(node.id)) && ['import_statement', 'import_from_statement'].includes(node.type)) {
                if (syntaxChildren(node).some(item => item.type === 'wildcard_import')) shadowed.add('*');
                for (const item of node.childrenForFieldName('name')) {
                    if (item) shadowed.add(item.childForFieldName('alias')?.text ?? item.text.split('.')[0]);
                }
            }
            if (node.type === 'call') visitCall?.(node);
            for (const child of syntaxChildren(node)) pending.push(child);
        }
    }
    inspectScope(root, assigned, undefined, false);

    function edge(source: CodeUnit, target: CodeUnit, kind: RelationKind, line: number) {
        facts.edges.push({ sourceId: source.id, targetId: target.id, kind, filePath: file, sourceLine: line, resolved: true });
    }

    function resolve(source: CodeUnit, expression: Node, kind: 'CALLS' | 'EXTENDS', line: number, shadowed: Set<string>) {
        const text = expression.text.replace(/\s+/g, '');
        if (!identifiers.test(text)) return;
        const [first, ...trail] = text.split('.');
        if (wildcard || shadowed.has('*') || assigned.has('*') || shadowed.has(first) || assigned.has(first) || duplicates.has(text)) return;
        const local = definitions.get(text);
        if (local && !imports.has(first)) {
            if (kind === 'CALLS' && local.unit.kind === 'METHOD' && !local.parent || kind === 'EXTENDS' && local.unit.kind === 'CLASS') {
                edge(source, local.unit, kind, line);
            }
            return;
        }
        const target = imports.get(first);
        if (!target) return;
        let module = target.module;
        let name = target.name;
        if (trail.length) {
            if (target.name && target.prefix && trail.length === 1) { module = target.prefix; name = trail[0]; }
            else if (!target.name && target.prefix && text.startsWith(target.prefix + '.')) name = text.slice(target.prefix.length + 1);
            else return;
        }
        if (!name || name.includes('.')) return;
        const ref = { sourceId: source.id, module: moduleKey(module), name, line };
        facts.imports.push({ ...ref, kind }, { ...ref, kind: 'IMPORTS' });
    }

    for (const [qualified, { unit, node, parent }] of definitions) {
        if (parent) edge(parent, unit, 'CONTAINS', unit.startLine);
        else if (!wildcard && !assigned.has('*') && !duplicates.has(qualified) && !assigned.has(qualified) && !imports.has(qualified)) {
            facts.exports.push({ name: qualified, unit });
        }
        if (duplicates.has(qualified)) continue;
        if (unit.kind === 'CLASS') {
            for (const base of syntaxChildren(node.childForFieldName('superclasses'))) {
                if (['identifier', 'attribute'].includes(base.type)) resolve(unit, base, 'EXTENDS', sourceLine(base), new Set());
            }
            continue;
        }
        const parameters = syntaxChildren(node.childForFieldName('parameters'));
        const shadowed = new Set<string>();
        for (const parameter of parameters) {
            const name = parameter.type === 'identifier' ? parameter : parameter.childForFieldName('name') ?? syntaxChildren(parameter)[0];
            if (name?.type === 'identifier') shadowed.add(name.text);
            else for (const nested of syntaxChildren(name)) if (nested.type === 'identifier') shadowed.add(nested.text);
        }
        const body = node.childForFieldName('body');
        const locals = new Set<string>();
        const calls: Node[] = [];
        inspectScope(body, locals, call => calls.push(call));
        for (const call of calls) {
            const callee = call.childForFieldName('function');
            if (!callee || !['identifier', 'attribute'].includes(callee.type)) continue;
            const receiver = callee.childForFieldName('object')?.text;
            const member = callee.childForFieldName('attribute')?.text;
            if (parent && receiver && member && ['self', 'cls'].includes(receiver) && parameters[0]?.text === receiver
                && !unit.annotations.includes('@staticmethod') && !locals.has(receiver) && !locals.has(callee.text)) {
                const name = parent.qualifiedName + '#' + member;
                const target = definitions.get(name);
                if (target && !duplicates.has(name)) edge(unit, target.unit, 'CALLS', sourceLine(call));
            } else if (!locals.has('*') && !locals.has(callee.text.split('.')[0])) resolve(unit, callee, 'CALLS', sourceLine(call), shadowed);
        }
    }

    for (const statement of statements) {
        const condition = statement.childForFieldName('condition');
        if (statement.type !== 'if_statement' || condition?.type !== 'comparison_operator') continue;
        const values = syntaxChildren(condition).map(node => node.text);
        if (values.length !== 2 || !values.includes('__name__') || !values.some(value => /^(['"])__main__\1$/.test(value))
            || !condition.children.some(child => child?.type === '==')) continue;
        const block = statement.childForFieldName('consequence');
        const called: string[] = [];
        const shadowed = new Set<string>();
        inspectScope(block, shadowed, node => {
            const callee = node.childForFieldName('function');
            if (callee?.type === 'identifier') called.push(callee.text);
        });
        for (const name of called) {
            const target = definitions.get(name);
            if (target?.unit.kind === 'METHOD' && !assigned.has(name) && !shadowed.has(name) && !duplicates.has(name) && !imports.has(name)) {
                target.unit.metadata.is_entry_point = 'true';
            }
        }
    }
    return { ...facts, units: [...definitions.values()].map(definition => definition.unit), documentation };
}
