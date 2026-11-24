import type { Node } from '@vscode/tree-sitter-wasm';
import type { JavaTypeName } from './java-graph.js';
import { brackets, erasedJavaType, javaChildren } from './java-syntax.js';

const nestedTypeBodies = new Set(['class_body', 'interface_body', 'enum_body', 'annotation_type_body']);
const localTypes = new Set(['class_declaration', 'record_declaration', 'enum_declaration', 'interface_declaration']);
const patternBindings = new Set(['instanceof_expression', 'type_pattern', 'record_pattern_component']);
const callNodes = new Set(['method_invocation', 'object_creation_expression', 'explicit_constructor_invocation', 'method_reference']);
interface Binding { from: number; to: number; raw: string; declaration: Node }

const nameOf = (node: Node) => node.childForFieldName('name');
const typeOf = (node: Node) => erasedJavaType(node.childForFieldName('type'));
const declaringScope = (parent: Node | null) => parent?.type === 'switch_block_statement_group' ? parent.parent : parent;

export function explicitExpressionType(node: Node | null, depth = 0): string {
    if (!node || depth === 24) return '';
    if (node.type === 'parenthesized_expression') return explicitExpressionType(javaChildren(node)[0] ?? null, depth + 1);
    if (node.type === 'object_creation_expression' && javaChildren(node).some(child => child.type === 'class_body')) return '';
    if (node.type === 'cast_expression' && node.childrenForFieldName('type').length !== 1) return '';
    return node.type === 'object_creation_expression' || node.type === 'cast_expression' ? typeOf(node) : '';
}

export function javaBodyBindings(body: Node, canonical: (raw: string) => JavaTypeName | undefined, visit: () => void) {
    const scopes = new Map<number, Map<string, Binding>>();
    const unknownPatterns = new Set<string>();
    const calls: Node[] = [];
    const pending = [body];

    function bind(scope: Node | null, name: Node | null, raw: string, from = name?.startIndex, to = scope?.endIndex, prefix = '') {
        if (!scope || !name || from === undefined || to === undefined) return;
        let names = scopes.get(scope.id);
        if (!names) { names = new Map(); scopes.set(scope.id, names); }
        const key = prefix + name.text;
        const previous = names.get(key);
        names.set(key, previous
            ? { from: Math.min(previous.from, from), to: Math.max(previous.to, to), raw: '', declaration: name }
            : { from, to, raw, declaration: name });
    }

    while (pending.length) {
        visit();
        const node = pending.pop()!;
        if (nestedTypeBodies.has(node.type)) continue;
        if (node.type === 'local_variable_declaration') {
            const type = typeOf(node);
            for (const variable of node.childrenForFieldName('declarator')) {
                if (!variable) continue;
                const declared = type === 'var' ? explicitExpressionType(variable.childForFieldName('value'))
                    : type + brackets(variable.childForFieldName('dimensions'));
                bind(declaringScope(node.parent), nameOf(variable), declared);
            }
        } else if (node.type === 'enhanced_for_statement') {
            const loop = node.childForFieldName('body');
            bind(loop, nameOf(node), typeOf(node) + brackets(node.childForFieldName('dimensions')), loop?.startIndex);
        } else if (node.type === 'resource') {
            const type = typeOf(node);
            const name = nameOf(node);
            const owner = node.parent?.parent;
            bind(owner ?? null, name, type === 'var' ? explicitExpressionType(node.childForFieldName('value')) : type,
                name?.startIndex, owner?.childForFieldName('body')?.endIndex);
        } else if (node.type === 'catch_formal_parameter') {
            const alternatives = javaChildren(javaChildren(node).find(child => child.type === 'catch_type'));
            bind(node.parent, nameOf(node), alternatives.length === 1 ? erasedJavaType(alternatives[0]) : '');
        } else if (localTypes.has(node.type)) {
            const scope = declaringScope(node.parent);
            bind(scope, nameOf(node), '', node.startIndex, scope?.endIndex, 'type:');
        } else if (node.type === 'lambda_expression') {
            const parameters = node.childForFieldName('parameters');
            for (const parameter of parameters?.type === 'identifier' ? [parameters] : javaChildren(parameters)) {
                if (parameter.type === 'identifier') bind(node, parameter, '');
                else if (parameter.type === 'spread_parameter') {
                    const variable = javaChildren(parameter).find(child => child.type === 'variable_declarator');
                    const raw = javaChildren(parameter).find(child => child.type !== 'modifiers' && child.type !== 'variable_declarator');
                    bind(node, variable?.childForFieldName('name') ?? null, erasedJavaType(raw ?? null) + '...');
                } else bind(node, nameOf(parameter), typeOf(parameter) + brackets(parameter.childForFieldName('dimensions')));
            }
        } else if (patternBindings.has(node.type)) {
            // Pattern scope can depend on control flow. Do not treat a possible binding as a type qualifier.
            const binding = nameOf(node) ?? (node.type === 'instanceof_expression' ? null : javaChildren(node).findLast(child => child.type === 'identifier'));
            if (binding) unknownPatterns.add(binding.text);
        }
        if (callNodes.has(node.type)) calls.push(node);
        for (const child of javaChildren(node)) pending.push(child);
    }

    function scopedBinding(name: string, position: Node) {
        for (let scope: Node | null = position; scope; scope = scope.parent) {
            const binding = scopes.get(scope.id)?.get(name);
            if (binding && position.startIndex >= binding.from && position.startIndex < binding.to) return binding;
            if (scope.id === body.id) break;
        }
        return undefined;
    }

    function typeFor(raw: string, position: Node) {
        if (!raw || scopedBinding('type:' + raw.split(/[.\[]/, 1)[0], position)) return undefined;
        return canonical(raw);
    }

    function bindingFor(name: string, position: Node) {
        if (unknownPatterns.has(name)) return { type: undefined };
        const binding = scopedBinding(name, position);
        return binding && { type: typeFor(binding.raw, binding.declaration) };
    }
    return { calls, bindingFor, typeFor };
}
