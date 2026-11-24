import { dirname, join } from 'node:path/posix';
import type { Node } from '@vscode/tree-sitter-wasm';
import type { GraphFacts, RelationKind } from './graph-source.js';
import type { CodeUnit, IndexedSource, UnitFactory } from './source.js';
import { precedingDocumentation } from './source-documentation.js';
import { sourceEndLine, sourceLine, syntaxChildren, syntaxParser } from './syntax-tree.js';

export const parseCSyntax = await syntaxParser('tree-sitter-c/tree-sitter-c.wasm');
const cppParser = await syntaxParser('@vscode/tree-sitter-wasm/wasm/tree-sitter-cpp.wasm');
const namedDeclarators = new Set(['identifier', 'field_identifier', 'type_identifier', 'qualified_identifier',
    'destructor_name', 'operator_name', 'template_function', 'template_method']);
const nativeTypes = new Map<string, CodeUnit['kind']>([['class_specifier', 'CLASS'], ['struct_specifier', 'STRUCT'],
    ['union_specifier', 'UNION'], ['enum_specifier', 'ENUM']]);
const containers = new Set(['declaration_list', 'linkage_specification', 'template_declaration', 'preproc_if',
    'preproc_ifdef', 'preproc_else', 'preproc_elif', 'preproc_elifdef', 'export_declaration']);
const codePattern = /^[\p{ID_Start}_][\p{ID_Continue}_]*(?:::[\p{ID_Start}_][\p{ID_Continue}_]*)*$/u;

interface Procedure {
    unit: CodeUnit; key: string; scope: string; body: Node | null; parameters: Node[]; conditional: boolean;
}
interface TypeEvidence { source: CodeUnit; target: string; scope: string; kind: 'EXTENDS' | 'DEFINES_TYPE'; point: number }

function declaratorChild(node: Node) {
    return node.childForFieldName('declarator') ?? (['parenthesized_declarator', 'attributed_declarator'].includes(node.type)
        ? syntaxChildren(node)[0] : undefined);
}

function nameNode(node: Node | undefined | null) {
    for (let current = node; current; current = declaratorChild(current)) {
        if (namedDeclarators.has(current.type)) return current;
    }
    return undefined;
}

function procedureDeclarator(node: Node) {
    for (let current: Node | undefined | null = node; current; current = declaratorChild(current)) {
        const child = declaratorChild(current);
        if (current.type === 'function_declarator' && child && namedDeclarators.has(child.type)) return current;
    }
    return undefined;
}

function functionName(node: Node) {
    const raw = node.text.trim();
    if (node.type === 'operator_name') return raw.replace(/^operator\s+/, 'operator ');
    if (node.type === 'qualified_identifier') return raw.replace(/\s*::\s*/g, '::');
    return raw;
}

function typedName(node: Node | null) {
    if (!node) return undefined;
    if (nativeTypes.has(node.type)) return node.childForFieldName('name')?.text;
    if (['qualified_identifier', 'type_identifier', 'template_type'].includes(node.type)) {
        return (node.childForFieldName('name')?.text && node.type === 'template_type' ? node.childForFieldName('name')!.text : node.text)
            .replace(/\s*::\s*/g, '::');
    }
    return undefined;
}

function includeGuard(node: Node) {
    if (node.childForFieldName('alternative')) return false;
    const name = node.children[0]?.type === '#ifndef' ? node.childForFieldName('name')?.text
        : /^!\s*defined\s*\(\s*([\w]+)\s*\)$/.exec(node.childForFieldName('condition')?.text ?? '')?.[1];
    const define = syntaxChildren(node).find(child => child.type === 'preproc_def');
    return !!name && define?.childForFieldName('name')?.text === name
        && syntaxChildren(node).slice(1)[0]?.id === define.id;
}

export function parseNative(file: string, language: 'c' | 'cpp', source: string, build: UnitFactory): IndexedSource {
    const tree = (language === 'c' ? parseCSyntax : cppParser)(source);
    try {
        if (tree.rootNode.hasError) throw new Error('SYNTAX_ERROR');
        return readTranslationUnit(file, language, tree.rootNode, build);
    } finally {
        tree.delete();
    }
}

function readTranslationUnit(file: string, language: 'c' | 'cpp', root: Node, build: UnitFactory): IndexedSource {
    const c = language === 'c';
    const facts: GraphFacts = { edges: [], imports: [], exports: [], moduleKeys: [] };
    const units = new Map<string, CodeUnit>();
    const documentation = new Map<string, string>();
    const procedures: Procedure[] = [];
    const pendingParents: { key: string; unit: CodeUnit }[] = [];
    const typeEvidence: TypeEvidence[] = [];
    const definitions = new Map<string, CodeUnit>();
    const typedefs = new Map<string, CodeUnit>();
    const includes = new Set<string>();
    const externDeclarations = new Map<string, CodeUnit | null>();
    const macroNames = new Set<string>();
    const globalVariables = new Set<string>();
    const topLevel = syntaxChildren(root);
    const guard = /\.h$/i.test(file) && topLevel.length === 1 && includeGuard(topLevel[0]) ? topLevel[0].id : undefined;
    const testFile = /(?:^|\/)(?:tests?|__tests__)\/|(?:^|\/)test_[^/]+\.[^.]+$|_test\.[^.]+$/.test(file);

    function attach(source: CodeUnit, target: CodeUnit, kind: RelationKind, line: number) {
        facts.edges.push({ sourceId: source.id, targetId: target.id, kind, resolved: true, filePath: file, sourceLine: line });
    }

    function emit(kind: CodeUnit['kind'], node: Node, name: string, qualified: string, parent: CodeUnit | null,
        signature: string, metadata: Record<string, string>, identity = qualified) {
        if (units.size >= 10_000) throw new Error('SYNTAX_LIMIT');
        if (testFile) metadata.is_test = 'true';
        const unit = build(kind, name, qualified, sourceLine(node), sourceEndLine(node), node.text, signature,
            parent?.qualifiedName ?? null, metadata, [], identity);
        const existing = units.get(unit.id);
        if (existing) return existing;
        units.set(unit.id, unit);
        const summary = precedingDocumentation(node);
        if (summary) documentation.set(unit.id, summary);
        if (parent) attach(parent, unit, 'CONTAINS', unit.startLine);
        return unit;
    }

    function qualify(scope: string, name: string) { return scope ? scope + '::' + name : name; }
    function typeRef(source: CodeUnit, reference: Node | null, scope: string, kind: TypeEvidence['kind'] = 'DEFINES_TYPE') {
        const target = typedName(reference);
        if (target && reference) typeEvidence.push({ source, target, scope, kind, point: sourceLine(reference) });
    }

    function visit(node: Node, namespace: string, scope: string, parent: CodeUnit | null, conditional: boolean, depth: number, access = 'public') {
        if (depth > 64) throw new Error('SYNTAX_LIMIT');
        if (node.type === 'namespace_definition') {
            const name = node.childForFieldName('name')?.text.replace(/\s*::\s*/g, '::');
            const next = qualify(namespace, name ?? '(anonymous)');
            for (const child of syntaxChildren(node.childForFieldName('body'))) visit(child, next, next, null, conditional, depth + 1);
            return;
        }
        if (containers.has(node.type)) {
            if (node.type === 'template_declaration') {
                const child = syntaxChildren(node).findLast(item => item.type !== 'template_parameter_list');
                if (child) visit(child, namespace, scope, parent, conditional, depth + 1, access);
            } else for (const child of syntaxChildren(node)) {
                const unknownBranch = node.type.startsWith('preproc_') && node.id !== guard;
                visit(child, namespace, scope, parent, conditional || unknownBranch, depth + 1, access);
            }
            return;
        }
        if (node.type === 'preproc_include') {
            const path = node.childForFieldName('path');
            if (c && !conditional && path?.type === 'string_literal') {
                const relative = path.text.slice(1, -1);
                const target = join(dirname(file), relative);
                if (relative && !/[\\\x00-\x1f]/.test(relative) && !relative.startsWith('/') && !/^\.\.(?:\/|$)/.test(target)) {
                    if (includes.size >= 256 && !includes.has(target)) throw new Error('SYNTAX_LIMIT');
                    includes.add(target);
                }
            }
            return;
        }
        if (node.type === 'preproc_def' || node.type === 'preproc_function_def') {
            const name = node.childForFieldName('name')?.text;
            if (name) {
                macroNames.add(name);
                emit('MACRO', node, name, name, null, '#define ' + name + (node.childForFieldName('parameters')?.text ?? ''), {});
            }
            return;
        }

        const type = node.childForFieldName('type');
        const specifier = nativeTypes.has(node.type) ? node : type;
        if (specifier && nativeTypes.has(specifier.type) && specifier.childForFieldName('body')) {
            const body = specifier.childForFieldName('body')!;
            const alias = node.type === 'type_definition' ? nameNode(node.childForFieldName('declarator'))?.text : undefined;
            const name = specifier.childForFieldName('name')?.text ?? alias;
            if (name) {
                const qualified = qualify(scope, name);
                const keyword = specifier.type.split('_')[0];
                const unit = emit(nativeTypes.get(specifier.type)!, specifier, name, qualified, parent, keyword + ' ' + name, { visibility: access });
                if (!definitions.has(qualified)) definitions.set(qualified, unit);
                else definitions.delete(qualified);
                const bases = syntaxChildren(specifier).find(child => child.type === 'base_class_clause');
                for (const base of syntaxChildren(bases)) typeRef(unit, base, scope, 'EXTENDS');
                let memberAccess = specifier.type === 'class_specifier' ? 'private' : 'public';
                for (const member of syntaxChildren(body)) {
                    if (member.type === 'access_specifier') memberAccess = member.text;
                    else visit(member, namespace, c ? scope : qualified, unit, conditional, depth + 1, memberAccess);
                }
            }
        }

        if (node.type === 'type_definition' || node.type === 'alias_declaration') {
            const declarators = node.type === 'alias_declaration' ? node.childrenForFieldName('name') : node.childrenForFieldName('declarator');
            for (const declarator of declarators) {
                const name = nameNode(declarator)?.text;
                if (!name) continue;
                const qualified = qualify(scope, name);
                const unit = emit('TYPEDEF', node, name, qualified, parent, node.text.trim(), { visibility: access });
                typedefs.set(qualified, unit);
                typeRef(unit, type, scope);
            }
            return;
        }

        if (!['function_definition', 'declaration', 'field_declaration'].includes(node.type)) return;
        for (const declarator of node.childrenForFieldName('declarator')) {
            if (!declarator) continue;
            const functionNode = procedureDeclarator(declarator);
            const named = nameNode(functionNode ?? declarator);
            if (!named) continue;
            const rawName = functionName(named);
            if (!functionNode) {
                if (node.type === 'field_declaration' && parent) {
                    const qualified = parent.qualifiedName + (c ? '.' : '::') + rawName;
                    const field = emit('FIELD', declarator, rawName, qualified, parent,
                        [type?.text, declarator.text].filter(Boolean).join(' '), { visibility: access });
                    typeRef(field, type, scope);
                } else if (node.type === 'declaration') globalVariables.add(qualify(scope, rawName));
                continue;
            }
            const parameters = syntaxChildren(functionNode.childForFieldName('parameters'));
            const parameterTypes = parameters.flatMap(parameter => {
                if (parameter.type === 'variadic_parameter') return ['...'];
                const paramType = parameter.childForFieldName('type');
                if (!paramType) return [];
                const name = nameNode(parameter.childForFieldName('declarator'));
                const defaults = parameter.childForFieldName('default_value');
                const text = parameter.text.slice(0, defaults ? defaults.startIndex - parameter.startIndex : undefined).replace(/=\s*$/, '').trim();
                if (!name) return [text];
                const offset = name.startIndex - parameter.startIndex;
                return [(text.slice(0, offset) + text.slice(offset + name.text.length)).trim()];
            });
            if (parameterTypes.length === 1 && parameterTypes[0] === 'void') parameterTypes.length = 0;
            const paramList = parameterTypes.map(value => value.replace(/\s+/g, ' ').replace(/\s*([*&<>:,])\s*/g, '$1')).join(',');
            const qn = qualify(scope, rawName);
            const fromScope = qn.includes('::') ? qn.slice(0, qn.lastIndexOf('::')) : '';
            const name = rawName.split('::').at(-1)!;
            const declared = node.type !== 'function_definition';
            const isStatic = syntaxChildren(node).some(child => child.type === 'storage_class_specifier' && child.text === 'static');
            const owner = parent ?? definitions.get(fromScope) ?? null;
            const parsedKind = !c && owner ? name === owner.simpleName ? 'CONSTRUCTOR' : 'METHOD' : 'FUNCTION';
            const suffix = syntaxChildren(functionNode).filter(child => ['type_qualifier', 'ref_qualifier'].includes(child.type)).map(child => child.text);
            const qualified = c ? qn : qn + '(' + paramList + ')' + (suffix.length ? ' ' + suffix.join(' ') : '');
            const modifiers = syntaxChildren(node).filter(child => child.type === 'type_qualifier' && child.startIndex < declarator.startIndex);
            const prefix = declarator.text.slice(0, functionNode.startIndex - declarator.startIndex).trim();
            const returnType = [...modifiers.map(modifier => modifier.text), type?.text, /^[*&]+$/.test(prefix) && prefix]
                .filter(Boolean).join(' ');
            const meta: Record<string, string> = { visibility: isStatic && !owner ? 'file-local' : access,
                is_static: String(isStatic), return_type: returnType, param_types: paramList };
            if (declared) meta.is_declaration = 'true';
            else if (!owner && !fromScope && (name === 'main' || c && /^(?:init|start|run|cmd|server|client|handle)_|_(?:init|start|run|open|close|handler|callback)$/.test(name))) {
                meta.is_entry_point = 'true';
            }
            const header = [returnType, name + '(' + paramList + ')', ...suffix].filter(Boolean).join(' ');
            const unit = emit(parsedKind, node, name, qualified, owner, header, meta, declared ? qualified + '#decl' : qualified);
            if (!owner && !c && rawName.includes('::')) pendingParents.push({ key: fromScope, unit });
            procedures.push({ unit, key: qn, scope: fromScope, body: node.childForFieldName('body'), parameters, conditional });
            if (c && declared && !isStatic && !conditional) {
                const previous = externDeclarations.get(qn);
                const compatible = previous === undefined || previous !== null && previous.metadata.param_types === paramList
                    && previous.metadata.return_type === returnType;
                externDeclarations.set(qn, compatible ? unit : null);
            }
            typeRef(unit, type, scope);
            for (const param of parameters) typeRef(unit, param.childForFieldName('type'), scope);
        }
    }
    for (const node of topLevel) visit(node, '', '', null, false, 1);

    function candidates(scope: string, name: string) {
        const possibilities = [];
        for (let owner = scope; owner; owner = owner.includes('::') ? owner.slice(0, owner.lastIndexOf('::')) : '') {
            possibilities.push(qualify(owner, name));
        }
        return [...possibilities, name];
    }
    for (const { key, unit } of pendingParents) {
        const owner = definitions.get(key);
        if (owner) attach(owner, unit, 'CONTAINS', unit.startLine);
    }
    for (const evidence of typeEvidence) {
        const { source, target, scope, kind, point } = evidence;
        for (const key of candidates(scope, target)) {
            const possible = definitions.get(key) ?? (kind === 'DEFINES_TYPE' ? typedefs.get(key) : undefined);
            if (possible) {
                if (possible.id !== source.id) attach(source, possible, kind, point);
                break;
            }
        }
    }

    const callTargets = new Map<string, Procedure | null>();
    for (const definition of procedures) {
        if (definition.body) callTargets.set(definition.key, callTargets.has(definition.key) ? null : definition);
    }
    if (c) {
        facts.moduleKeys.push({ name: '/c/header/' + file, priority: 0 });
        for (const [name, unit] of externDeclarations) if (unit) facts.exports.push({ name: name + '#decl', unit });
        for (const [name, proc] of callTargets) {
            if (!proc || proc.conditional || proc.unit.metadata.is_static === 'true') continue;
            facts.moduleKeys.push({ name: '/c/link/' + name, priority: 0 });
            facts.exports.push({ name, unit: proc.unit });
        }
    }

    let visited = 0;
    for (const proc of procedures) {
        if (!proc.body || proc.conditional) continue;
        const variables = new Set<string>();
        const importedNames = new Set<string>();
        for (const parameter of proc.parameters) {
            const name = nameNode(parameter.childForFieldName('declarator'))?.text;
            if (name) variables.add(name);
        }
        const calls: Node[] = [];
        const work = syntaxChildren(proc.body);
        while (work.length) {
            const node = work.pop()!;
            if (++visited > 150_000) throw new Error('SYNTAX_LIMIT');
            if (['function_definition', 'lambda_expression', 'class_specifier', 'struct_specifier'].includes(node.type) || node.type.startsWith('preproc_')) continue;
            if (node.type === 'declaration' || node.type === 'condition_clause') {
                for (const declaration of node.childrenForFieldName('declarator')) {
                    const name = nameNode(declaration)?.text;
                    if (name) variables.add(name);
                }
            }
            if (node.type === 'call_expression') calls.push(node);
            for (const child of syntaxChildren(node)) work.push(child);
        }
        for (const call of calls) {
            const callee = call.childForFieldName('function');
            if (!callee || !['identifier', 'qualified_identifier'].includes(callee.type)) continue;
            const name = functionName(callee);
            if (!codePattern.test(name) || variables.has(name) || macroNames.has(name)) continue;
            const keys = candidates(proc.scope, name);
            if (keys.some(key => globalVariables.has(key))) continue;
            const known = keys.find(key => callTargets.has(key));
            if (known) {
                const target = callTargets.get(known);
                if (target && !target.conditional) attach(proc.unit, target.unit, 'CALLS', sourceLine(call));
            } else if (c && (externDeclarations.get(name) || includes.size)) {
                const entry = { sourceId: proc.unit.id, name, line: sourceLine(call) };
                facts.imports.push({ ...entry, kind: 'CALLS', module: '/c/link/' + name });
                if (!importedNames.has(name)) {
                    importedNames.add(name);
                    for (const path of includes) facts.imports.push({ ...entry, name: name + '#decl', kind: 'IMPORTS', module: '/c/header/' + path });
                }
                if (facts.imports.length > 50_000) throw new Error('SYNTAX_LIMIT');
            }
        }
    }
    return { ...facts, units: [...units.values()], documentation };
}
