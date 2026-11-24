import ts from 'typescript';
import { basename, dirname, extname, join } from 'node:path/posix';
import type { CodeUnit } from './source.js';
import { jsAliasKey } from './js-path-aliases.js';

export type RelationKind = 'CALLS' | 'CONTAINS' | 'IMPORTS' | 'EXTENDS' | 'IMPLEMENTS' | 'DEFINES_TYPE' | 'OVERRIDES';

export interface RelationEdge {
    sourceId: string;
    targetId: string;
    kind: RelationKind;
    resolved: boolean;
    filePath: string;
    sourceLine: number;
}

interface ImportedSymbol {
    module: string;
    name: string;
}

interface ImportRelation {
    sourceId: string;
    kind: RelationKind;
    line: number;
}

export interface GraphFacts {
    edges: RelationEdge[];
    imports: (ImportedSymbol & ImportRelation)[];
    exports: { name: string; unit: CodeUnit; typeOnly?: boolean }[];
    moduleKeys: { name: string; priority: number }[];
    jsExportRoutes?: { name: string; target: { module: string; name: string | null } | null; star: boolean; typeOnly: boolean }[];
    jsMemberImports?: (ImportedSymbol & ImportRelation & { members: string[] })[];
    javaTypeLookups?: {
        sourceId: string;
        kind: RelationKind;
        line: number;
        candidates: { module: string; priority: number; publicOnly: boolean; names: string[] }[];
    }[];
}

function moduleKeys(file: string): GraphFacts['moduleKeys'] {
    const extension = extname(file);
    const stem = file.slice(0, -extension.length);
    const keys = [{ name: file, priority: 0 }, { name: stem, priority: 1 }];
    if (extension === '.ts' || extension === '.tsx') keys.push({ name: `${stem}.js`, priority: 1 });
    if (extension === '.mts') keys.push({ name: `${stem}.mjs`, priority: 1 });
    if (extension === '.cts') keys.push({ name: `${stem}.cjs`, priority: 1 });
    if (basename(stem) === 'index') keys.push({ name: dirname(stem), priority: 2 });
    return keys;
}

function moduleReference(specifier: ts.Expression | undefined, file: ts.SourceFile) {
    if (!specifier || !ts.isStringLiteral(specifier) || /[\\\0]/.test(specifier.text)) return;
    if (!/^\.\.?\//.test(specifier.text)) return jsAliasKey(file.fileName, specifier.text);
    const module = join(dirname(file.fileName), specifier.text).replace(/\/$/, '');
    return module === '..' || module.startsWith('../') ? undefined : module;
}

type ReferenceName = ts.Expression | ts.QualifiedName;

function importedSymbol(expression: ReferenceName, checker: ts.TypeChecker, file: ts.SourceFile, allowTypeImport: boolean) {
    const members: string[] = [];
    let root = expression;
    while (!ts.isIdentifier(root)) {
        if (members.length >= 12) return;
        if (ts.isPropertyAccessExpression(root)) {
            members.unshift(root.name.text);
            root = root.expression;
        } else if (ts.isQualifiedName(root)) {
            members.unshift(root.right.text);
            root = root.left;
        } else if (ts.isElementAccessExpression(root) && ts.isStringLiteral(root.argumentExpression)) {
            members.unshift(root.argumentExpression.text);
            root = root.expression;
        } else return;
    }
    const declarations = checker.getSymbolAtLocation(root)?.declarations;
    if (declarations?.length !== 1) return;
    const binding = importedBinding(declarations[0], file);
    if (!binding || (!allowTypeImport && binding.typeOnly)) return;
    const name = binding.name ?? members.shift();
    return name === undefined ? undefined : { module: binding.module, name, members };
}

function importedBinding(declaration: ts.Declaration, file: ts.SourceFile) {
    let clause: ts.ImportClause;
    let name: string | null;
    let typeOnly = false;
    if (ts.isNamespaceImport(declaration)) {
        clause = declaration.parent;
        name = null;
    } else if (ts.isImportSpecifier(declaration)) {
        clause = declaration.parent.parent;
        name = (declaration.propertyName ?? declaration.name).text;
        typeOnly = declaration.isTypeOnly;
    } else if (ts.isImportClause(declaration)) {
        clause = declaration;
        name = 'default';
    } else return;
    const module = moduleReference(clause.parent.moduleSpecifier, file);
    return module ? { module, name, typeOnly: typeOnly || clause.isTypeOnly } : undefined;
}

export function readGraph(file: ts.SourceFile, checker: ts.TypeChecker, declarations: Map<ts.Node, CodeUnit>): GraphFacts {
    const edges: RelationEdge[] = [];
    const imports: GraphFacts['imports'] = [];
    const exports: GraphFacts['exports'] = [];
    const jsExportRoutes: NonNullable<GraphFacts['jsExportRoutes']> = [];
    const jsMemberImports: NonNullable<GraphFacts['jsMemberImports']> = [];
    const lineAt = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    const unitFor = (symbol: ts.Symbol | undefined) =>
        symbol?.declarations?.map(item => declarations.get(item)).find(item => item !== undefined);

    function edge(source: CodeUnit, target: CodeUnit, kind: RelationKind, node: ts.Node) {
        edges.push({
            sourceId: source.id, targetId: target.id, kind, resolved: true, filePath: source.filePath, sourceLine: lineAt(node)
        });
    }

    function reference(source: CodeUnit, expression: ReferenceName, kind: RelationKind, allowTypeImport: boolean) {
        const symbol = importedSymbol(expression, checker, file, allowTypeImport);
        if (!symbol) return;
        const { module, name, members } = symbol;
        const link = { module, name, sourceId: source.id, kind, line: lineAt(expression) };
        if (members.length) jsMemberImports.push({ ...link, members });
        else imports.push(link);
    }

    function typeEdge(source: CodeUnit, expression: ReferenceName, kind: RelationKind, allowTypeImport: boolean) {
        const target = unitFor(checker.getSymbolAtLocation(expression));
        if (target?.kind === 'CLASS' || target?.kind === 'INTERFACE') edge(source, target, kind, expression);
        else reference(source, expression, kind, allowTypeImport);
    }

    const module = checker.getSymbolAtLocation(file);
    if (module) {
        const explicit = new Set<string>();
        for (const statement of file.statements) {
            if (!ts.isExportDeclaration(statement)) continue;
            const targetModule = moduleReference(statement.moduleSpecifier, file);
            const clause = statement.exportClause;
            if (!clause) {
                if (targetModule) jsExportRoutes.push({
                    name: '', target: { module: targetModule, name: '' }, star: true, typeOnly: statement.isTypeOnly
                });
            } else if (ts.isNamedExports(clause)) {
                for (const exported of clause.elements) {
                    const name = exported.name.text;
                    let typeOnly = statement.isTypeOnly || exported.isTypeOnly;
                    let target: { module: string; name: string | null } | undefined;
                    if (targetModule) {
                        target = { module: targetModule, name: (exported.propertyName ?? exported.name).text };
                    } else if (!statement.moduleSpecifier) {
                        const aliases = checker.getExportSpecifierLocalTargetSymbol(exported)?.declarations;
                        if (aliases?.length === 1) {
                            const binding = importedBinding(aliases[0], file);
                            if (binding) {
                                target = { module: binding.module, name: binding.name };
                                typeOnly ||= binding.typeOnly;
                            }
                        }
                    }
                    explicit.add(name);
                    jsExportRoutes.push({ name, target: target ?? null, star: false, typeOnly });
                }
            } else {
                explicit.add(clause.name.text);
                jsExportRoutes.push({
                    name: clause.name.text,
                    target: targetModule ? { module: targetModule, name: null } : null,
                    star: false,
                    typeOnly: statement.isTypeOnly
                });
            }
        }
        for (const exported of checker.getExportsOfModule(module)) {
            const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
            const unit = unitFor(symbol);
            if (unit) {
                const typeOnly = exported.declarations?.some(declaration => ts.isExportSpecifier(declaration)
                    && (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly)) ?? false;
                exports.push({ name: exported.name, unit, typeOnly });
            } else if (!explicit.has(exported.name)) {
                jsExportRoutes.push({ name: exported.name, target: null, star: false, typeOnly: false });
            }
        }
    }

    for (const [node, source] of declarations) {
        const parent = declarations.get(node.parent);
        if (parent) edge(parent, source, 'CONTAINS', node);
        if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
            for (const clause of node.heritageClauses ?? []) {
                const kind = clause.token === ts.SyntaxKind.ImplementsKeyword ? 'IMPLEMENTS' : 'EXTENDS';
                for (const heritage of clause.types) {
                    typeEdge(source, heritage.expression, kind, kind === 'IMPLEMENTS' || ts.isInterfaceDeclaration(node));
                }
            }
        }
        if ((ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) && node.type && ts.isTypeReferenceNode(node.type)) {
            typeEdge(source, node.type.typeName, 'DEFINES_TYPE', true);
        }
        if (ts.isMethodDeclaration(node) && ts.isClassDeclaration(node.parent)) {
            const isStatic = ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword);
            if (!isStatic && ts.isIdentifier(node.name)) {
                for (const baseType of checker.getBaseTypes(checker.getTypeAtLocation(node.parent) as ts.InterfaceType) ?? []) {
                    const target = unitFor(checker.getPropertyOfType(baseType, node.name.text));
                    if (target?.kind === 'METHOD') edge(source, target, 'OVERRIDES', node);
                }
            }
        }

        const callable = ts.isVariableDeclaration(node) ? node.initializer : node;
        if (!callable || !ts.isFunctionLike(callable) || !('body' in callable) || !callable.body) continue;

        function visit(child: ts.Node) {
            if (ts.isFunctionLike(child) || ts.isClassLike(child)) return;
            if (ts.isCallExpression(child) || ts.isNewExpression(child)) {
                const declaration = checker.getResolvedSignature(child)?.declaration;
                const target = declaration && (declarations.get(declaration)
                    ?? (ts.isVariableDeclaration(declaration.parent) ? declarations.get(declaration.parent) : undefined));
                if (target) edge(source, target, 'CALLS', child);
                else if (ts.isCallExpression(child)) reference(source, child.expression, 'CALLS', false);
            }
            ts.forEachChild(child, visit);
        }

        visit(callable.body);
    }
    return { edges, imports, exports, moduleKeys: moduleKeys(file.fileName), jsExportRoutes, jsMemberImports };
}
