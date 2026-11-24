import type { Node } from '@vscode/tree-sitter-wasm';
import { FlowData } from './flow-data.js';
import type { FlowAccess } from './flow-data.js';
import { withFlowProcedure } from './flow-source.js';
import type { FlowProcedure } from './flow-source.js';
import { HttpError } from './http-error.js';
import { isSensitiveReviewPath, redactReviewText } from './review-redaction.js';
import type { CodeUnit } from './source.js';
import { sourceLine, syntaxChildren } from './syntax-tree.js';

type NodeKind = 'ENTRY' | 'EXIT' | 'STATEMENT' | 'CONDITION' | 'RETURN' | 'THROW' | 'CATCH' | 'FINALLY';
type EdgeKind = 'NEXT' | 'TRUE_BRANCH' | 'FALSE_BRANCH' | 'LOOP_BACK' | 'CASE_BRANCH' | 'EXCEPTION_BRANCH'
    | 'DATA_DEPENDENCY' | 'CONTROL_DEPENDENCY';
interface FlowNode { id: string; kind: NodeKind; label: string; line: number }
interface FlowEdge { sourceId: string; targetId: string; kind: EdgeKind; symbol: string }
interface Destination { id: string; kind: EdgeKind }
interface Scope {
    controllers: string[]; breakTo?: Destination; continueTo?: Destination;
    returnTo: Destination; throwsTo: Destination[]; depth: number;
}
export type FlowAnalysis = NonNullable<ReturnType<typeof analyzeFlow>>;

const blocks = new Set(['block', 'compound_statement', 'constructor_body', 'else_clause']);
const loops = new Set(['for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement']);
const terminalReturns = new Set(['return_statement']);
const terminalThrows = new Set(['throw_statement', 'raise_statement']);
const unsupportedControl = new Set(['goto_statement', 'yield_statement', 'match_statement', 'yield_expression']);

export function analyzeFlow(unit: CodeUnit, fields: ReadonlySet<string>) {
    return withFlowProcedure(unit, procedure => new ProcedureFlow(unit, procedure, fields).analyze());
}

const destination = (id: string, kind: EdgeKind = 'NEXT'): Destination => ({ id, kind });

class ProcedureFlow {
    private readonly nodes: FlowNode[] = [];
    private readonly edges: FlowEdge[] = [];
    private readonly controls: FlowEdge[] = [];
    private readonly access = new Map<string, FlowAccess>();
    private readonly limitations = new Set<string>();
    private readonly facts: FlowData;
    private readonly sensitive: boolean;

    constructor(private readonly unit: CodeUnit, private readonly procedure: FlowProcedure, fields: ReadonlySet<string>) {
        this.facts = new FlowData(procedure, fields);
        this.sensitive = isSensitiveReviewPath(unit.filePath);
    }

    analyze() {
        const entry = this.add('ENTRY', null, [], 'ENTRY', this.unit.startLine);
        this.access.set(entry, this.facts.entry);
        const exit = this.add('EXIT', null, [], 'EXIT', this.unit.endLine);
        const end = destination(exit);
        const scope = { controllers: [], returnTo: end, throwsTo: [end], depth: 0 };
        this.edge(entry, this.build(this.procedure.body, end, scope));
        const nodes = [this.nodes[0], ...this.nodes.slice(2).sort((a, b) => a.line - b.line), this.nodes[1]];
        const programDependenceGraph = this.procedure.language === 'java'
            ? { nodes, edges: [...this.controls, ...this.reachingDefinitions(entry)] } : null;
        const precise = this.procedure.language === 'java' && !this.limitations.size;
        return {
            target: this.unit.qualifiedName, language: this.procedure.language, filePath: this.unit.filePath, unitId: this.unit.id,
            summary: this.facts.summary(), controlFlowGraph: { nodes, edges: this.edges },
            programDependenceGraph, precise, limitations: [...this.limitations]
        };
    }

    private add(kind: NodeKind, syntax: Node | null, controllers: string[], label?: string, line?: number, writeOnly = false) {
        if (this.nodes.length >= 500) throw new HttpError(413, 'FLOW_ANALYSIS_LIMIT');
        const id = 'n' + this.nodes.length;
        const inlineControl = syntax?.descendantsOfType(
            ['switch_expression', 'ternary_expression', 'conditional_expression', 'yield_expression', 'boolean_operator', 'binary_expression']
        ).some(node => node && (node.type !== 'binary_expression'
            || node.children.some(child => child?.type === '&&' || child?.type === '||')));
        if (inlineControl) {
            this.limitations.add('EXPRESSION_LEVEL_CONTROL_NOT_EXPANDED');
        }
        const preview = label ?? (syntax ? redactReviewText(syntax.text, this.sensitive).replace(/\s+/g, ' ').trim() : '');
        this.nodes.push({ id, kind, label: preview.length > 140 ? preview.slice(0, 139) + '…' : preview,
            line: line ?? (syntax ? sourceLine(syntax) + this.procedure.lineOffset : this.unit.startLine) });
        if (syntax) this.access.set(id, this.facts.access(syntax, kind === 'RETURN', writeOnly));
        for (const sourceId of controllers) this.controls.push({ sourceId, targetId: id, kind: 'CONTROL_DEPENDENCY', symbol: '' });
        return id;
    }

    private edge(sourceId: string, next: Destination, kind = next.kind) {
        this.edges.push({ sourceId, targetId: next.id, kind, symbol: '' });
    }

    private controlled(scope: Scope, id: string): Scope {
        return { ...scope, controllers: [...scope.controllers, id] };
    }

    private sequence(stmts: Node[], next: Destination, scope: Scope) {
        for (let index = stmts.length - 1; index >= 0; index--) next = this.build(stmts[index], next, scope);
        return next;
    }

    private build(statement: Node | null, next: Destination, scope: Scope): Destination {
        if (!statement) return next;
        if (scope.depth >= 64) throw new HttpError(413, 'FLOW_ANALYSIS_LIMIT');
        const context = { ...scope, depth: scope.depth + 1 };
        const kind = statement.type;
        if (blocks.has(kind)) return this.sequence(syntaxChildren(statement), next, context);
        if (kind === 'if_statement' || kind === 'elif_clause') return this.branch(statement, next, context);
        if (loops.has(kind)) return this.loop(statement, next, context);
        if (kind === 'try_statement' || kind === 'try_with_resources_statement') return this.tryBlock(statement, next, context);
        if (kind === 'switch_statement' || kind === 'switch_expression') return this.switchBlock(statement, next, context);
        if (kind === 'synchronized_statement' || kind === 'with_statement') {
            const body = statement.childForFieldName('body');
            const expression = syntaxChildren(statement).find(node => node.id !== body?.id) ?? null;
            const id = this.add('STATEMENT', expression, scope.controllers, undefined, sourceLine(statement) + this.procedure.lineOffset);
            this.edge(id, this.build(body, next, context));
            if (kind === 'with_statement') this.limitations.add('CONTEXT_MANAGER_CLEANUP_NOT_MODELED');
            return destination(id);
        }

        const finish = terminalReturns.has(kind) || terminalThrows.has(kind);
        const node = this.add(terminalReturns.has(kind) ? 'RETURN' : terminalThrows.has(kind) ? 'THROW' : 'STATEMENT',
            statement, scope.controllers);
        if (finish) {
            for (const target of terminalReturns.has(kind) ? [scope.returnTo] : scope.throwsTo) this.edge(node, target);
        } else if (kind === 'break_statement' || kind === 'continue_statement') {
            const label = syntaxChildren(statement).length > 0;
            const jump = kind === 'break_statement' ? scope.breakTo : scope.continueTo;
            if (label || !jump) this.limitations.add('UNRESOLVED_CONTROL_TRANSFER');
            this.edge(node, !label && jump ? jump : scope.returnTo);
        } else if (unsupportedControl.has(kind) || kind === 'labeled_statement' || kind === 'labeled_expression') {
            this.limitations.add('UNSUPPORTED_CONTROL_SYNTAX');
            if (kind === 'goto_statement') this.limitations.add('UNRESOLVED_CONTROL_TRANSFER');
            else this.edge(node, next);
        } else {
            this.edge(node, next);
        }
        return destination(node);
    }

    private branch(statement: Node, next: Destination, scope: Scope, otherwise = next) {
        const condition = statement.childForFieldName('condition');
        const id = this.add('CONDITION', condition, scope.controllers, undefined, sourceLine(statement) + this.procedure.lineOffset);
        const branchScope = this.controlled(scope, id);
        const alternatives = statement.childrenForFieldName('alternative');
        for (let index = alternatives.length - 1; index >= 0; index--) {
            const child = alternatives[index];
            if (child?.type === 'elif_clause') otherwise = this.branch(child, next, branchScope, otherwise);
            else if (child) otherwise = this.build(child, next, branchScope);
        }
        const yes = this.build(statement.childForFieldName('consequence'), next, branchScope);
        this.edge(id, yes, 'TRUE_BRANCH');
        this.edge(id, otherwise, 'FALSE_BRANCH');
        return destination(id);
    }

    private loop(statement: Node, next: Destination, scope: Scope) {
        const field = (name: string) => statement.childForFieldName(name);
        const foreach = statement.type === 'enhanced_for_statement' || (this.procedure.language === 'python' && statement.type === 'for_statement');
        const condition = field('condition') ?? (foreach ? (field('value') ?? field('right')) : null);
        const id = this.add('CONDITION', condition, scope.controllers, condition ? undefined : 'for (;;)',
            sourceLine(statement) + this.procedure.lineOffset);
        const bodyScope = this.controlled(scope, id);
        const back = destination(id, 'LOOP_BACK');
        const update = this.sequence(statement.childrenForFieldName('update').filter((node): node is Node => !!node), back, bodyScope);
        const body = this.build(field('body'), update, { ...bodyScope, breakTo: next, continueTo: update });
        const iteration = foreach ? (field('name') ?? field('left')) : null;
        let first = body;
        if (iteration) {
            first = destination(this.add('STATEMENT', iteration, bodyScope.controllers, undefined, undefined, true));
            this.edge(first.id, body);
        }
        this.edge(id, first, statement.type === 'do_statement' ? 'LOOP_BACK' : 'TRUE_BRANCH');
        if (condition) this.edge(id, this.build(field('alternative'), next, bodyScope), 'FALSE_BRANCH');
        if (statement.type === 'do_statement') return body;
        const initializers = ['init', 'initializer'].flatMap(name => statement.childrenForFieldName(name)).filter((node): node is Node => !!node);
        return this.sequence(initializers, destination(id), scope);
    }

    private switchBlock(statement: Node, next: Destination, scope: Scope) {
        const selector = statement.childForFieldName('condition');
        const id = this.add('CONDITION', selector, scope.controllers, undefined, sourceLine(statement) + this.procedure.lineOffset);
        const cases = syntaxChildren(statement.childForFieldName('body'));
        let following = next;
        let hasDefault = false;
        for (const item of cases.toReversed()) {
            const clauses = syntaxChildren(item);
            const isC = item.type === 'case_statement';
            const label = isC ? item.childForFieldName('value') : clauses.find(node => node.type === 'switch_label') ?? null;
            if (!isC && !label) {
                this.limitations.add('UNSUPPORTED_SWITCH_CASE');
                continue;
            }
            const fallback = isC ? !label : /^default\b/.test(label?.text ?? '');
            hasDefault ||= fallback;
            const branch = this.add('CONDITION', label, [...scope.controllers, id], fallback ? 'default' : undefined,
                sourceLine(item) + this.procedure.lineOffset);
            const statements = clauses.filter(node => node.id !== label?.id);
            const caseScope = { ...this.controlled(this.controlled(scope, id), branch), breakTo: next };
            const rest = this.sequence(statements, item.type === 'switch_rule' ? next : following, caseScope);
            this.edge(branch, rest);
            this.edge(id, destination(branch), 'CASE_BRANCH');
            following = destination(branch);
        }
        if (!hasDefault) this.edge(id, next, 'FALSE_BRANCH');
        return destination(id);
    }

    private tryBlock(statement: Node, next: Destination, scope: Scope) {
        const line = sourceLine(statement) + this.procedure.lineOffset;
        const clauses = syntaxChildren(statement);
        const finallyClause = clauses.find(clause => clause.type === 'finally_clause');
        const finalBody = finallyClause ? syntaxChildren(finallyClause).at(-1) ?? null : null;
        const routes = new Map<string, Destination>();
        const throughFinally = (target: Destination) => {
            if (!finallyClause || !finalBody) return target;
            const key = target.id + ':' + target.kind;
            const saved = routes.get(key);
            if (saved) return saved;
            const id = this.add('FINALLY', null, scope.controllers, 'finally', sourceLine(finallyClause) + this.procedure.lineOffset);
            const wrapped = destination(id);
            routes.set(key, wrapped);
            this.edge(id, this.build(finalBody, target, scope));
            return wrapped;
        };
        const exit = throughFinally(next);
        const outer = { ...scope, returnTo: throughFinally(scope.returnTo), throwsTo: scope.throwsTo.map(throughFinally),
            breakTo: scope.breakTo && throughFinally(scope.breakTo), continueTo: scope.continueTo && throughFinally(scope.continueTo) };
        const dispatch = this.add('STATEMENT', null, scope.controllers, 'try', line);
        const catchTargets = [];
        for (const clause of clauses.filter(node => node.type === 'catch_clause' || node.type === 'except_clause')) {
            const parts = syntaxChildren(clause);
            const body = clause.childForFieldName('body') ?? parts.findLast(node => blocks.has(node.type)) ?? null;
            const parameter = parts.find(node => node.type === 'catch_formal_parameter') ?? clause.childForFieldName('value');
            const catchId = this.add('CATCH', parameter, [...scope.controllers, dispatch], parameter ? undefined : 'catch',
                sourceLine(clause) + this.procedure.lineOffset);
            this.edge(catchId, this.build(body, exit, this.controlled(outer, catchId)));
            catchTargets.push(destination(catchId, 'EXCEPTION_BRANCH'));
        }
        for (const target of catchTargets) this.edge(dispatch, target);
        const normal = this.build(clauses.find(part => part.type === 'else_clause') ?? null, exit, outer);
        const body = this.build(statement.childForFieldName('body'), normal, { ...outer, throwsTo: [...catchTargets, ...outer.throwsTo] });
        this.edge(dispatch, body);
        const resources = clauses.find(part => part.type === 'resource_specification');
        if (resources) this.limitations.add('RESOURCE_CLEANUP_NOT_MODELED');
        return this.sequence(syntaxChildren(resources), destination(dispatch), scope);
    }

    private reachingDefinitions(entry: string) {
        type State = Map<string, Set<string>>;
        const incoming = new Map<string, State>([[entry, new Map()]]);
        const successors = new Map<string, Set<string>>();
        for (const edge of this.edges) {
            const targets = successors.get(edge.sourceId) ?? new Set();
            targets.add(edge.targetId);
            successors.set(edge.sourceId, targets);
        }
        const queued = new Set([entry]);
        let visited = 0;
        while (queued.size) {
            const id = queued.values().next().value!;
            queued.delete(id);
            const output = new Map(incoming.get(id)!);
            for (const key of this.access.get(id)?.writes.keys() ?? []) output.set(key, new Set([id]));
            for (const target of successors.get(id) ?? []) {
                const previous = incoming.get(target);
                const state = previous ?? new Map();
                let changed = !previous;
                for (const [key, definitions] of output) {
                    const known = state.get(key) ?? new Set();
                    for (const definition of definitions) {
                        if (++visited > 300_000) throw new HttpError(413, 'FLOW_ANALYSIS_LIMIT');
                        if (!known.has(definition)) { known.add(definition); changed = true; }
                    }
                    state.set(key, known);
                }
                if (changed) { incoming.set(target, state); queued.add(target); }
            }
        }
        const edges: FlowEdge[] = [];
        for (const [targetId, state] of incoming) {
            for (const { key, name } of this.access.get(targetId)?.reads.values() ?? []) {
                for (const sourceId of state.get(key) ?? []) {
                    if (edges.length >= 20_000) throw new HttpError(413, 'FLOW_ANALYSIS_LIMIT');
                    edges.push({ sourceId, targetId, kind: 'DATA_DEPENDENCY', symbol: name });
                }
            }
        }
        return edges;
    }
}
