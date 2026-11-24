import type { Node } from '@vscode/tree-sitter-wasm';
import type { CodeUnit, IndexedSource, UnitFactory } from './source.js';
import { javaGraph } from './java-graph.js';
import { brackets, erasedJavaType, javaChildren, javaLine, parseJavaSyntax } from './java-syntax.js';
import { precedingDocumentation } from './source-documentation.js';

const typeKinds = new Map<string, CodeUnit['kind']>([
    ['class_declaration', 'CLASS'], ['record_declaration', 'CLASS'], ['interface_declaration', 'INTERFACE'],
    ['enum_declaration', 'ENUM'], ['annotation_type_declaration', 'ANNOTATION']
]);
const methodKinds = new Map<string, CodeUnit['kind']>([
    ['method_declaration', 'METHOD'], ['annotation_type_element_declaration', 'METHOD'],
    ['constructor_declaration', 'CONSTRUCTOR'], ['compact_constructor_declaration', 'CONSTRUCTOR']
]);
const annotationsByFramework = [
    ['spring', new Set(['Controller', 'RestController', 'Service', 'Repository', 'Component', 'Bean', 'Entity',
        'RequestMapping', 'GetMapping', 'PostMapping', 'PutMapping', 'PatchMapping', 'DeleteMapping', 'Transactional', 'Autowired'])],
    ['mybatis', new Set(['Mapper', 'Select', 'Insert', 'Update', 'Delete', 'Results'])],
    ['jaxrs', new Set(['Path', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'Produces', 'Consumes'])]
] as const;
const entryAnnotations = new Set(['Controller', 'RestController', 'RequestMapping', 'GetMapping', 'PostMapping', 'PutMapping',
    'PatchMapping', 'DeleteMapping', 'Path', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
const testAnnotations = new Set(['Test', 'ParameterizedTest', 'RepeatedTest', 'TestFactory', 'TestTemplate']);
const callbackInterfaces = new Set(['Filter', 'HandlerInterceptor', 'AuthenticationProvider', 'AuthenticationEntryPoint',
    'AuthenticationFailureHandler', 'AuthenticationSuccessHandler', 'AccessDeniedHandler', 'LogoutHandler',
    'LogoutSuccessHandler', 'UserDetailsService', 'AuthenticationManager', 'ContainerRequestFilter', 'ContainerResponseFilter', 'ExceptionMapper']);
const annotations = new Set(['annotation', 'marker_annotation']);
const typeRelationNodes = new Set(['superclass', 'super_interfaces', 'extends_interfaces']);

export interface JavaParameter { name: string; type: string; display: string }
export interface JavaDeclaration {
    unit: CodeUnit;
    body: Node | null;
    signatureTypes: string[];
    parameters: JavaParameter[];
    typeParameters: string[];
    returnType?: string;
}
export interface JavaType {
    unit: CodeUnit;
    syntaxName: string;
    typeParameters: string[];
    parents: { name: string; kind: 'EXTENDS' | 'IMPLEMENTS'; line: number }[];
    declarations: JavaDeclaration[];
}

export function javaParameters(node: Node | null): JavaParameter[] {
    if (!node) return [];
    return javaChildren(node).flatMap(parameter => {
        const variable = parameter.type === 'spread_parameter' ? javaChildren(parameter).find(child => child.type === 'variable_declarator') : null;
        const type = variable ? javaChildren(parameter).find(child => child.type !== 'modifiers' && child.type !== 'variable_declarator')
            : parameter.childForFieldName('type');
        const name = (variable ?? parameter).childForFieldName('name')?.text;
        if (!type || !name || parameter.type === 'receiver_parameter') return [];
        const suffix = variable ? '...' : brackets(parameter.childForFieldName('dimensions'));
        return [{ name, type: erasedJavaType(type) + suffix, display: type.text + suffix + ' ' + name }];
    });
}

function declarationAttributes(node: Node, isTestFile: boolean) {
    const modifiers = javaChildren(node).find(child => child.type === 'modifiers');
    const keywords = modifiers?.children.flatMap(child => child && !child.isNamed ? [child.type] : []) ?? [];
    const names: string[] = [];
    const simple = new Set<string>();
    const metadata: Record<string, string> = {
        visibility: keywords.find(modifier => ['public', 'private', 'protected'].includes(modifier)) ?? 'package'
    };
    for (const modifier of ['static', 'final', 'abstract']) if (keywords.includes(modifier)) metadata['is_' + modifier] = 'true';
    for (const annotation of javaChildren(modifiers)) {
        if (!annotations.has(annotation.type)) continue;
        const fullName = annotation.childForFieldName('name')?.text;
        if (!fullName) continue;
        const name = fullName.split('.').at(-1)!;
        names.push('@' + fullName);
        simple.add(name);
        const argumentsNode = annotation.childForFieldName('arguments');
        const argument = argumentsNode && javaChildren(argumentsNode).find(child => child.type !== 'element_value_pair'
            || ['value', 'path'].includes(child.childForFieldName('key')?.text ?? ''));
        const value = argument?.type === 'element_value_pair' ? argument.childForFieldName('value') : argument;
        if (value) metadata['ann_' + fullName] = value.type === 'string_literal' ? value.text.slice(1, -1) : value.text;
    }
    for (const [framework, registered] of annotationsByFramework) {
        if ([...simple].some(name => registered.has(name))) { metadata.framework = framework; break; }
    }
    if ([...simple].some(name => entryAnnotations.has(name))) metadata.is_entry_point = 'true';
    if (isTestFile || [...simple].some(name => testAnnotations.has(name))) metadata.is_test = 'true';
    return { metadata, names, simple, keywords: keywords.length ? keywords.join(' ') + ' ' : '' };
}

export function parseJava(file: string, source: string, unit: UnitFactory): IndexedSource {
    const tree = parseJavaSyntax(source);
    try {
        const root = tree.rootNode;
        if (root.hasError) throw new Error('SYNTAX_ERROR');
        return readCompilationUnit(file, root, unit);
    } finally {
        tree.delete();
    }
}

function readCompilationUnit(file: string, root: Node, build: UnitFactory): IndexedSource {
    const units = new Map<string, CodeUnit>();
    const documentation = new Map<string, string>();
    const types: JavaType[] = [];
    const header = javaChildren(root);
    const pkg = header.find(node => node.type === 'package_declaration');
    const packageName = javaChildren(pkg).find(node => node.type === 'identifier' || node.type === 'scoped_identifier')?.text
        .replace(/\s+/g, '') ?? '';
    const testFile = /(?:^|\/)(?:test|tests)\/|(?:Test|Tests|Spec)\.java$/.test(file);

    function emit(node: Node, kind: CodeUnit['kind'], name: string, qualified: string, signature: string,
        owner: JavaType | null, metadata: Record<string, string>, names: string[], docNode = node) {
        if (units.size >= 10_000) throw new Error('SYNTAX_LIMIT');
        const value = build(kind, name, qualified, javaLine(node), node.endPosition.row + (node.endPosition.column ? 1 : 0),
            node.text, signature, owner?.unit.qualifiedName ?? null, metadata, names);
        if (units.has(value.id)) throw new Error('SYNTAX_ERROR');
        units.set(value.id, value);
        const summary = precedingDocumentation(docNode);
        if (summary) documentation.set(value.id, summary);
        return value;
    }

    function readType(node: Node, owner: JavaType | null, depth: number) {
        if (depth > 64) throw new Error('SYNTAX_LIMIT');
        const kind = typeKinds.get(node.type);
        const name = node.childForFieldName('name')?.text;
        const body = node.childForFieldName('body');
        if (!kind || !name || !body) return;
        const qualified = owner ? owner.unit.qualifiedName + '$' + name : [packageName, name].filter(Boolean).join('.');
        const syntaxName = owner ? owner.syntaxName + '.' + name : qualified;
        const { metadata, names, keywords } = declarationAttributes(node, testFile);
        if (node.type === 'record_declaration') metadata.is_record = 'true';
        const parents: JavaType['parents'] = [];
        const clauses = javaChildren(node).filter(child => typeRelationNodes.has(child.type));
        for (const clause of clauses) {
            const list = javaChildren(clause).find(child => child.type === 'type_list') ?? clause;
            const relation = clause.type === 'super_interfaces' ? 'IMPLEMENTS' : 'EXTENDS';
            for (const reference of javaChildren(list)) parents.push({ name: erasedJavaType(reference), kind: relation, line: javaLine(reference) });
        }
        const header = [name, node.childForFieldName('type_parameters')?.text, node.childForFieldName('parameters')?.text,
            ...clauses.map(clause => clause.text)].filter(Boolean).join(' ');
        const keyword = node.type === 'annotation_type_declaration' ? '@interface' : node.type.split('_')[0];
        const type: JavaType = {
            unit: emit(node, kind, name, qualified, keywords + keyword + ' ' + header, owner, metadata, names),
            syntaxName, parents, declarations: [],
            typeParameters: typeParameterNames(node)
        };
        types.push(type);

        for (const member of javaChildren(body).flatMap(child => child.type === 'enum_body_declarations' ? javaChildren(child) : [child])) {
            if (typeKinds.has(member.type)) readType(member, type, depth + 1);
            else if (methodKinds.has(member.type)) readMethod(member, type, node);
            else if (['field_declaration', 'constant_declaration', 'enum_constant'].includes(member.type)) readFields(member, type);
        }
    }

    function readMethod(node: Node, owner: JavaType, typeNode: Node) {
        const name = node.childForFieldName('name')?.text;
        const kind = methodKinds.get(node.type);
        if (!name || !kind) return;
        const args = javaParameters((node.type === 'compact_constructor_declaration' ? typeNode : node).childForFieldName('parameters'));
        const signatureTypes = args.map(arg => arg.type);
        const returnNode = node.childForFieldName('type');
        const suffix = brackets(node.childForFieldName('dimensions'));
        const { metadata, names, simple, keywords } = declarationAttributes(node, testFile);
        if ((owner.unit.kind === 'INTERFACE' || owner.unit.kind === 'ANNOTATION') && metadata.visibility === 'package') {
            metadata.visibility = 'public';
        }
        if (returnNode) metadata.return_type = returnNode.text + suffix;
        if (signatureTypes.length) metadata.param_types = signatureTypes.join(',');
        if (simple.has('Override') && owner.parents.some(parent => parent.kind === 'IMPLEMENTS'
            && callbackInterfaces.has(parent.name.split('.').at(-1)!))) metadata.is_entry_point = 'true';
        if (name === 'main' && metadata.visibility === 'public' && metadata.is_static === 'true' && metadata.return_type === 'void'
            && /^(?:java\.lang\.)?String(?:\[\]|\.\.\.)$/.test(metadata.param_types ?? '')) metadata.is_entry_point = 'true';
        const signature = keywords + (returnNode ? returnNode.text + suffix + ' ' : '') + name + '(' + args.map(arg => arg.display).join(', ') + ')';
        const thrown = javaChildren(node).find(child => child.type === 'throws')?.text;
        const qualified = owner.unit.qualifiedName + '#' + name + '(' + signatureTypes.join(',') + ')';
        const body = node.childForFieldName('body');
        owner.declarations.push({ unit: emit(node, kind, name, qualified, thrown ? signature + ' ' + thrown : signature, owner, metadata, names),
            body, signatureTypes, parameters: args, typeParameters: typeParameterNames(node),
            returnType: returnNode ? erasedJavaType(returnNode) + suffix : undefined });
    }

    function readFields(node: Node, owner: JavaType) {
        const { metadata, names, keywords } = declarationAttributes(node, testFile);
        const type = node.childForFieldName('type');
        const variables = node.type === 'enum_constant' ? [node] : node.childrenForFieldName('declarator');
        for (const variable of variables) {
            if (!variable) continue;
            const name = variable.childForFieldName('name')?.text;
            if (!name) continue;
            const suffix = brackets(variable.childForFieldName('dimensions'));
            const display = type ? type.text + suffix : owner.unit.simpleName;
            const signature = [keywords.trim(), display, name].filter(Boolean).join(' ');
            const field = emit(variable, 'FIELD', name, owner.unit.qualifiedName + '.' + name, signature, owner, { ...metadata }, names, node);
            owner.declarations.push({ unit: field, body: variable.childForFieldName('value'),
                signatureTypes: [], parameters: [], typeParameters: [], returnType: type ? erasedJavaType(type) + suffix : undefined });
        }
    }

    for (const node of header) if (typeKinds.has(node.type)) readType(node, null, 1);
    return { units: [...units.values()], documentation, ...javaGraph(packageName, header, types) };
}

function typeParameterNames(node: Node) {
    return javaChildren(node.childForFieldName('type_parameters')).flatMap(parameter => {
        const name = javaChildren(parameter).find(child => child.type === 'type_identifier')?.text;
        return name ? [name] : [];
    });
}
