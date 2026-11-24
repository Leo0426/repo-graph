import type { Node } from '@vscode/tree-sitter-wasm';
import type { FlowProcedure } from './flow-source.js';
import { HttpError } from './http-error.js';
import { syntaxChildren } from './syntax-tree.js';

interface Reference { key: string; name: string; field: boolean }
export interface FlowAccess { reads: Map<string, Reference>; writes: Map<string, Reference> }

interface Binding { reference: Reference; start: number; end: number; declaration: number }
const javaScopes = new Set(['block', 'constructor_body', 'for_statement', 'enhanced_for_statement', 'switch_block', 'catch_clause']);
export const nestedFlowBodies = new Set(['lambda_expression', 'lambda', 'class_declaration', 'record_declaration', 'interface_declaration',
    'enum_declaration', 'class_body', 'class_definition', 'function_definition', 'decorated_definition', 'method_declaration']);

export class FlowData {
    readonly fieldReads = new Set<string>();
    readonly fieldWrites = new Set<string>();
    readonly returnSources = new Set<string>();
    readonly entry: FlowAccess = { reads: new Map(), writes: new Map() };
    private readonly bindings = new Map<string, Binding[]>();
    private visited = 0;

    constructor(private readonly procedure: FlowProcedure, private readonly fields: ReadonlySet<string>) {
        const { body, parameters, language } = procedure;
        for (const name of parameters) {
            const reference = this.bind(name, body.startIndex, body.endIndex);
            this.entry.writes.set(reference.key, reference);
        }
        if (language !== 'java') return;
        const scan = (node: Node, scope: Node, depth: number) => {
            this.check(depth);
            if (nestedFlowBodies.has(node.type)) return;
            if (javaScopes.has(node.type)) scope = node;
            if (['variable_declarator', 'enhanced_for_statement', 'catch_formal_parameter'].includes(node.type)) {
                const name = node.childForFieldName('name');
                if (name) {
                    const start = node.type === 'enhanced_for_statement' ? node.childForFieldName('body')?.startIndex : name.startIndex;
                    this.bind(name.text, start ?? name.startIndex, scope.endIndex, name.startIndex);
                }
            }
            for (const child of syntaxChildren(node)) scan(child, scope, depth + 1);
        };
        scan(body, body, 0);
    }

    private check(depth: number) {
        if (++this.visited > 35_000 || depth > 128) throw new HttpError(413, 'FLOW_ANALYSIS_LIMIT');
    }

    private bind(name: string, start: number, end: number, declaration = start) {
        const reference = { key: `var:${declaration}:${name}`, name, field: false };
        const collection = this.bindings.get(name) ?? [];
        collection.push({ reference, start, end, declaration });
        this.bindings.set(name, collection);
        return reference;
    }

    private field(name: string) { return { key: 'field:' + name, name, field: true }; }

    private reference(node: Node) {
        if (node.type === 'field_access') {
            const receiver = node.childForFieldName('object');
            const field = node.childForFieldName('field');
            if (field && (receiver?.type === 'this' || receiver?.type === 'super'
                || receiver?.text.endsWith('.this') || receiver?.text.endsWith('.super'))) return this.field(field.text);
        }
        if (node.type !== 'identifier') return undefined;
        const name = node.text;
        const position = node.startIndex;
        const binding = this.bindings.get(name)?.findLast(item =>
            item.declaration === position || (item.start <= position && position < item.end));
        if (binding) return binding.reference;
        return this.procedure.language === 'java' && this.fields.has(name)
            ? this.field(name) : { key: 'name:' + name, name, field: false };
    }

    access(syntax: Node | null, readReturn = false, writeOnly = false): FlowAccess {
        const access: FlowAccess = { reads: new Map(), writes: new Map() };
        const record = (reference: Reference, read: boolean, write: boolean) => {
            if (read) {
                access.reads.set(reference.key, reference);
                if (reference.field) this.fieldReads.add(reference.name);
                if (readReturn) this.returnSources.add(reference.name);
            }
            if (write) {
                access.writes.set(reference.key, reference);
                if (reference.field) this.fieldWrites.add(reference.name);
            }
        };
        const visit = (node: Node | null, read: boolean, write: boolean, depth: number) => {
            if (!node) return;
            this.check(depth);
            if (nestedFlowBodies.has(node.type)) return;
            const reference = this.reference(node);
            if (reference) { record(reference, read, write); return; }
            const child = (name: string) => node.childForFieldName(name);
            const evaluate = (expression: Node | null) => visit(expression, true, false, depth + 1);
            const define = (expression: Node | null, readTarget = false) => {
                if (expression) visit(expression, readTarget, true, depth + 1);
            };
            switch (node.type) {
                case 'assignment_expression':
                case 'assignment':
                case 'augmented_assignment': {
                    const operator = child('operator')?.type ?? node.children.find(token => token?.type.endsWith('='))?.type;
                    evaluate(child('right'));
                    define(child('left'), node.type === 'augmented_assignment' || (operator !== undefined && operator !== '='));
                    return;
                }
                case 'update_expression':
                    define(child('argument') ?? syntaxChildren(node)[0] ?? null, true);
                    return;
                case 'variable_declarator':
                case 'init_declarator':
                    evaluate(child('value'));
                    define(child('name') ?? child('declarator'));
                    return;
                case 'catch_formal_parameter': define(child('name')); return;
                case 'field_access': case 'attribute': case 'field_expression':
                    evaluate(child('object') ?? child('argument'));
                    return;
                case 'method_invocation':
                    evaluate(child('object'));
                    evaluate(child('arguments'));
                    return;
                case 'call_expression': case 'call': {
                    const callable = child('function');
                    if (callable?.type !== 'identifier' || this.bindings.has(callable.text)) evaluate(callable);
                    evaluate(child('arguments'));
                    return;
                }
                case 'type_identifier': case 'generic_type': case 'type_arguments': case 'scoped_type_identifier':
                case 'string_literal': case 'string': case 'character_literal': case 'char_literal':
                    return;
                default:
                    for (const item of syntaxChildren(node)) {
                        const destructure = write && ['pattern_list', 'tuple_pattern', 'list_pattern', 'parenthesized_expression'].includes(node.type);
                        visit(item, destructure ? read : true, destructure, depth + 1);
                    }
            }
        };
        visit(syntax, !writeOnly, writeOnly, 0);
        return access;
    }

    summary() {
        return { parameters: this.procedure.parameters, fieldReads: [...this.fieldReads].sort(),
            fieldWrites: [...this.fieldWrites].sort(), returnSources: [...this.returnSources].sort() };
    }
}
