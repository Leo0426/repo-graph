import type { Node, Tree } from '@vscode/tree-sitter-wasm';
import { HttpError } from './http-error.js';
import { javaParameters } from './java-source.js';
import { parseJavaSyntax } from './java-syntax.js';
import { parseCSyntax } from './native-source.js';
import { parsePythonSyntax } from './python-source.js';
import { syntaxChildren } from './syntax-tree.js';
import type { CodeUnit } from './source.js';

export type FlowLanguage = 'java' | 'c' | 'python';
export interface FlowProcedure {
    declaration: Node;
    body: Node;
    parameters: string[];
    language: FlowLanguage;
    lineOffset: number;
}

function cDeclarationName(declaration: Node | null): string | undefined {
    for (let current = declaration; current; current = current.childForFieldName('declarator')
        ?? (current.type === 'parenthesized_declarator' ? syntaxChildren(current)[0] : null)) {
        if (current.type === 'identifier') return current.text;
    }
    return undefined;
}

function pythonParameterName(node: Node): string | undefined {
    if (node.type === 'identifier') return node.text;
    const named = node.childForFieldName('name');
    if (named?.type === 'identifier') return named.text;
    if (!['typed_parameter', 'list_splat_pattern', 'dictionary_splat_pattern'].includes(node.type)) return undefined;
    const first = syntaxChildren(node)[0];
    return first ? pythonParameterName(first) : undefined;
}

const javaDeclarations = new Set(['method_declaration', 'constructor_declaration', 'compact_constructor_declaration']);

export function withFlowProcedure<T>(unit: CodeUnit, analyze: (procedure: FlowProcedure) => T) {
    const { language, kind, rawSource } = unit;
    if (unit.metadata.bytecode === 'true' || unit.metadata.is_declaration === 'true' || !rawSource.trim()) return undefined;
    if ((language === 'java' && !['METHOD', 'CONSTRUCTOR'].includes(kind))
        || (language === 'c' && kind !== 'FUNCTION') || (language === 'python' && kind !== 'METHOD')
        || (language !== 'java' && language !== 'c' && language !== 'python')) return undefined;
    if (Buffer.byteLength(rawSource) > 128 * 1024) throw new HttpError(413, 'FLOW_ANALYSIS_LIMIT');

    let tree: Tree;
    let lineOffset = unit.startLine - 1;
    try {
        if (language === 'java') {
            const parent = unit.parentQualifiedName?.split(/[.$]/).at(-1) || 'FlowSubject';
            const owner = /^[\p{ID_Start}$_][\p{ID_Continue}$_]*$/u.test(parent) ? parent : 'FlowSubject';
            const compact = kind === 'CONSTRUCTOR' && !unit.rawSource.split('{', 1)[0].includes('(');
            tree = parseJavaSyntax(`${compact ? 'record ' + owner + '()' : 'class ' + owner} {\n${rawSource}\n}`);
            lineOffset--;
        } else if (language === 'python') {
            const declaration = rawSource.split(/\r?\n/).find(line => /^\s*(?:async\s+)?def\s+/.test(line));
            const indent = declaration?.match(/^[ \t]*/)?.[0] ?? '';
            tree = parsePythonSyntax(indent ? 'if True:\n' + indent + rawSource + '\n' : rawSource);
            if (indent) lineOffset--;
        } else tree = parseCSyntax(rawSource);
    } catch (error) {
        if (error instanceof Error && error.message === 'PARSE_TIMEOUT') throw new HttpError(413, 'FLOW_ANALYSIS_LIMIT');
        throw error;
    }
    try {
        const root = tree.rootNode;
        if (root.hasError) return undefined;
        let declaration: Node | undefined;
        if (language === 'java') {
            declaration = syntaxChildren(syntaxChildren(root)[0]?.childForFieldName('body'))
                .find(node => javaDeclarations.has(node.type));
        } else if (language === 'python') {
            const statement = syntaxChildren(root)[0];
            const candidate = statement?.type === 'if_statement'
                ? syntaxChildren(statement.childForFieldName('consequence'))[0] : statement;
            declaration = candidate?.type === 'decorated_definition'
                ? candidate.childForFieldName('definition') ?? undefined : candidate;
            if (declaration?.type !== 'function_definition') return undefined;
        } else declaration = syntaxChildren(root).find(node => node.type === 'function_definition');

        const body = declaration?.childForFieldName('body');
        if (!declaration || !body) return undefined;
        let parameters: string[] = [];
        if (language === 'java') {
            parameters = javaParameters(declaration.childForFieldName('parameters')).map(parameter => parameter.name);
        } else if (language === 'python') {
            parameters = syntaxChildren(declaration.childForFieldName('parameters')).flatMap(node => pythonParameterName(node) ?? []);
        } else for (let current = declaration.childForFieldName('declarator'); current; current = current.childForFieldName('declarator')) {
            const list = current.childForFieldName('parameters');
            if (!list) continue;
            parameters = syntaxChildren(list).flatMap(node => cDeclarationName(node.childForFieldName('declarator')) ?? []);
            break;
        }
        return analyze({ declaration, body, parameters, language, lineOffset });
    } finally { tree.delete(); }
}
