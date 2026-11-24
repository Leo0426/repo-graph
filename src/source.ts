import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import ts from 'typescript';
import { readGraph } from './graph-source.js';
import type { GraphFacts } from './graph-source.js';
import { blockDocumentation } from './source-documentation.js';
import { heuristicSource } from './heuristic-source.js';
import { indexBytecode } from './java-bytecode.js';
import { parseJava } from './java-source.js';
import { parsePython } from './python-source.js';
import { parseNative } from './native-source.js';

export const kinds = [
    'CLASS', 'INTERFACE', 'ENUM', 'ANNOTATION', 'METHOD', 'CONSTRUCTOR', 'FIELD',
    'LOCAL_VAR', 'STRUCT', 'UNION', 'TYPEDEF', 'MACRO', 'FUNCTION', 'DOCUMENT'
] as const;

type Kind = typeof kinds[number];
export type Language = 'typescript' | 'javascript' | 'java' | 'python' | 'c' | 'cpp' | 'doc';
export type IndexLanguage = Language | 'class';
export type IndexStrategy = 'auto' | 'precise' | 'heuristic';

export interface CodeUnit {
    id: string;
    kind: Kind;
    language: Language;
    qualifiedName: string;
    simpleName: string;
    filePath: string;
    startLine: number;
    endLine: number;
    rawSource: string;
    signature: string;
    annotations: string[];
    parentQualifiedName: string | null;
    metadata: Record<string, string>;
}

const extensions: Record<string, Language> = {
    '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
    '.java': 'java', '.py': 'python', '.pyi': 'python', '.pyw': 'python',
    '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp', '.hxx': 'cpp',
    '.md': 'doc', '.markdown': 'doc'
};
export const sourceLanguages = [...new Set(Object.values(extensions))];

export function digest(value: string | Uint8Array) {
    return createHash('sha256').update(value).digest('hex');
}

export function languageOf(file: string): IndexLanguage | undefined {
    const extension = extname(file);
    if (extension === '.C') return 'cpp';
    const normalized = extension.toLowerCase();
    return normalized === '.class' || normalized === '.jar' ? 'class' : extensions[normalized];
}

export function isJar(file: string) { return extname(file).toLowerCase() === '.jar'; }

export function parse(projectId: string, filePath: string, language: Language, source: string): CodeUnit[] {
    return parseIndexedSource(projectId, filePath, language, source).units;
}

export interface IndexedSource extends GraphFacts {
    units: CodeUnit[];
    documentation?: ReadonlyMap<string, string>;
    degradedFrom?: 'SYNTAX_ERROR' | 'PARSE_TIMEOUT';
}

export type UnitFactory = (kind: Kind, simpleName: string, qualifiedName: string, startLine: number, endLine: number,
    rawSource: string, signature: string, parentQualifiedName: string | null,
    metadata: Record<string, string>, annotations?: string[], identityName?: string) => CodeUnit;

function unitFactory(projectId: string, filePath: string, language: Language): UnitFactory {
    return function unit(
        kind: Kind, simpleName: string, qualifiedName: string, startLine: number, endLine: number,
        rawSource: string, signature: string, parentQualifiedName: string | null,
        metadata: Record<string, string>, annotations: string[] = [], identityName = qualifiedName
    ): CodeUnit {
        return {
            id: digest(projectId + filePath + kind + identityName),
            kind, language, qualifiedName, simpleName, filePath, startLine, endLine,
            rawSource, signature, annotations, parentQualifiedName, metadata
        };
    };
}

export async function readIndexedFile(projectId: string, filePath: string, language: IndexLanguage, bytes: Buffer,
    strategy: IndexStrategy, allowRecovery: boolean, signal?: AbortSignal): Promise<IndexedSource> {
    if (language === 'class') return indexBytecode(bytes, unitFactory(projectId, filePath, 'java'), isJar(filePath), signal);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (language === 'doc') return parseIndexedSource(projectId, filePath, language, source);
    const heuristic = () => heuristicSource(filePath, language, source, unitFactory(projectId, filePath, language));
    if (strategy === 'heuristic') return heuristic();
    try {
        return parseIndexedSource(projectId, filePath, language, source);
    } catch (error) {
        const reason = (error as Error)?.message;
        if (strategy !== 'auto' || !allowRecovery || !(reason === 'PARSE_TIMEOUT' || (reason === 'SYNTAX_ERROR' && language !== 'java'))) {
            throw error;
        }
        signal?.throwIfAborted();
        const fallback = heuristic();
        if (!fallback.units.length) throw error;
        return { ...fallback, degradedFrom: reason };
    }
}

export function parseIndexedSource(projectId: string, filePath: string, language: Language, source: string): IndexedSource {
    const unit = unitFactory(projectId, filePath, language);

    if (language === 'java') return parseJava(filePath, source, unit);
    if (language === 'python') return parsePython(filePath, source, unit);
    if (language === 'c' || language === 'cpp') return parseNative(filePath, language, source, unit);

    if (language === 'doc') {
        const graph = { edges: [], imports: [], exports: [], moduleKeys: [] };
        if (!source.trim()) return { units: [], ...graph };
        const base = basename(filePath, extname(filePath));
        const lines = source.split(/\r\n|\n|\r/);
        if (lines.at(-1) === '') lines.pop();
        const sections: { index: number; heading: string }[] = [];
        let fence = '';
        for (const [index, line] of lines.entries()) {
            const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
            if (marker) {
                if (!fence) fence = marker[1];
                else if (marker[1].startsWith(fence) && !marker[2].trim()) fence = '';
                continue;
            }
            const heading = !fence && /^ {0,3}#{1,3}\s+(.+?)\s*#*\s*$/.exec(line);
            if (heading) sections.push({ index, heading: heading[1] });
        }
        if (sections[0]?.index !== 0) sections.unshift({ index: 0, heading: base });
        const seen = new Set<string>();
        const units = sections.map(({ index, heading }, section) => {
            let name = `${filePath}#${heading}`;
            if (seen.has(name)) name += `-L${index + 1}`;
            while (seen.has(name)) name += '-';
            seen.add(name);
            const end = sections[section + 1]?.index ?? lines.length;
            return unit('DOCUMENT', heading, name, index + 1, end,
                lines.slice(index, end).join('\n'), lines[index].trim(), null, { docFile: base });
        });
        return { units, ...graph };
    }

    const options: ts.CompilerOptions = { target: ts.ScriptTarget.Latest, noLib: true, noResolve: true, allowJs: true };
    const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    const host = ts.createCompilerHost(options);
    host.getSourceFile = name => name === filePath ? file : undefined;
    const program = ts.createProgram([filePath], options, host);
    if (program.getSyntacticDiagnostics(file).length) throw new Error('SYNTAX_ERROR');

    const units = new Map<string, CodeUnit>();
    const documentation = new Map<string, string>();
    const declarations = new Map<ts.Node, CodeUnit>();
    const isTest = /(?:^|\/)(?:__tests__|tests?)\/|\.(?:spec|test)\.[^.]+$/i.test(filePath);
    const lineAt = (offset: number) => file.getLineAndCharacterOfPosition(offset).line + 1;

    function emit(node: ts.Node, kind: Kind, name: string, parent: string | null, bodyStart = node.end) {
        const start = node.getStart(file);
        const qualified = parent ? `${parent}.${name}` : name;
        const metadata: Record<string, string> = isTest ? { is_test: 'true' } : {};
        if (ts.canHaveModifiers(node)) {
            for (const modifier of ts.getModifiers(node) ?? []) {
                const value = modifier.getText(file);
                if (['static', 'abstract'].includes(value)) metadata[`is_${value}`] = 'true';
                if (['public', 'private', 'protected'].includes(value)) metadata.visibility = value;
            }
        }
        const annotations = ts.canHaveDecorators(node)
            ? (ts.getDecorators(node) ?? []).map(item => item.getText(file))
            : [];
        const callable = ts.isVariableDeclaration(node) ? node.initializer : node;
        if (callable && ts.isFunctionLike(callable)) {
            const parameterTypes = callable.parameters.map(parameter => parameter.type?.getText(file));
            if (parameterTypes.length && parameterTypes.every(value => value !== undefined)) metadata.param_types = parameterTypes.join(',');
            if ((kind === 'FUNCTION' || kind === 'METHOD') && 'body' in callable && callable.body
                && (/^(?:main$|handle|init|start|run|serve)/.test(name) || /(?:Handler|Callback|Listener)$/.test(name))) {
                metadata.is_entry_point = 'true';
            }
        }
        const result = unit(kind, name, qualified, lineAt(start), lineAt(Math.max(start, node.end - 1)),
            source.slice(start, node.end), source.slice(start, bodyStart).trim(), parent, metadata, annotations);
        units.set(result.id, result);
        declarations.set(node, result);
        const comment = ts.getJSDocCommentsAndTags(node).findLast(ts.isJSDoc);
        if (comment) {
            const summary = blockDocumentation(comment.getText(file));
            if (summary) documentation.set(result.id, summary);
        }
        return qualified;
    }

    for (const declaration of file.statements) {
        if (ts.isFunctionDeclaration(declaration)) {
            if (declaration.name) emit(declaration, 'FUNCTION', declaration.name.text, null, declaration.body?.getStart(file));
        } else if (ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)) {
            const kind = ts.isClassDeclaration(declaration) ? 'CLASS' : 'INTERFACE';
            const parent = emit(declaration, kind, declaration.name?.text ?? 'default', null, declaration.members.pos - 1);
            for (const member of declaration.members) {
                if (ts.isConstructorDeclaration(member)) {
                    emit(member, 'CONSTRUCTOR', 'constructor', parent, member.body?.getStart(file));
                } else if (member.name) {
                    const name = member.name.getText(file);
                    if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)
                        || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
                        emit(member, 'METHOD', name, parent, ts.isMethodSignature(member) ? undefined : member.body?.getStart(file));
                    } else if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
                        const initializer = ts.isPropertyDeclaration(member) ? member.initializer : undefined;
                        emit(member, 'FIELD', name, parent, initializer?.getStart(file));
                    }
                }
            }
        } else if (ts.isEnumDeclaration(declaration)) {
            emit(declaration, 'ENUM', declaration.name.text, null, declaration.members.pos - 1);
        } else if (ts.isTypeAliasDeclaration(declaration)) {
            emit(declaration, 'TYPEDEF', declaration.name.text, null);
        } else if (ts.isVariableStatement(declaration)) {
            for (const variable of declaration.declarationList.declarations) {
                const initializer = variable.initializer;
                if (!ts.isIdentifier(variable.name) || !initializer) continue;
                if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
                    emit(variable, 'FUNCTION', variable.name.text, null, initializer.body.getStart(file));
                }
            }
        }
    }
    return { units: [...units.values()], documentation, ...readGraph(file, program.getTypeChecker(), declarations) };
}
