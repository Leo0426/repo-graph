import type { Node } from '@vscode/tree-sitter-wasm';
import type { GraphFacts, RelationKind } from './graph-source.js';
import { explicitExpressionType, javaBodyBindings } from './java-bindings.js';
import { erasedJavaType, javaChildren, javaLine } from './java-syntax.js';
import type { JavaDeclaration, JavaType } from './java-source.js';
import type { CodeUnit } from './source.js';

const primitive = new Set(['boolean', 'byte', 'short', 'int', 'long', 'char', 'float', 'double', 'void']);
const javaName = /^[\p{ID_Start}$_][\p{ID_Continue}$_]*(?:\.[\p{ID_Start}$_][\p{ID_Continue}$_]*)*$/u;
const integerLiterals = new Set(['decimal_integer_literal', 'hex_integer_literal', 'octal_integer_literal', 'binary_integer_literal']);
const floatingLiterals = new Set(['decimal_floating_point_literal', 'hex_floating_point_literal']);
const objectMethods = new Set(['clone', 'equals', 'finalize', 'getClass', 'hashCode', 'notify', 'notifyAll', 'toString', 'wait']);
const implicitJavaLangTypes = new Set([
    'Appendable', 'AutoCloseable', 'Boolean', 'Byte', 'CharSequence', 'Character', 'Class', 'ClassLoader',
    'Cloneable', 'Comparable', 'Double', 'Enum', 'Error', 'Exception', 'Float', 'Integer', 'Iterable',
    'Long', 'Math', 'Module', 'Number', 'Object', 'Record', 'Runnable', 'RuntimeException', 'Short',
    'StackTraceElement', 'String', 'StringBuffer', 'StringBuilder', 'System', 'Thread', 'Throwable', 'Void'
]);

export type JavaTypeName = string | { candidates: { name: string; priority: number; publicOnly: boolean }[] };

type CallTarget =
    | { unit: CodeUnit }
    | { owner: JavaTypeName; name: string; args: string[]; qualifiers: readonly string[] };

// JS/TS module keys are repository-relative paths.
function moduleName(type: string) { return '/java/' + type; }
function memberName(owner: string, name: string, args: string[], qualifier: string) {
    return qualifier + ':' + owner + '#' + name + '(' + args.join(',') + ')';
}
const typeExport = (name: string) => [name];
function isReceiver(type: JavaTypeName | undefined): type is JavaTypeName {
    return type !== undefined && (typeof type !== 'string' || (javaName.test(type) && !primitive.has(type)));
}

export function javaGraph(packageName: string, header: Node[], types: JavaType[]): GraphFacts {
    const javaTypeLookups: NonNullable<GraphFacts['javaTypeLookups']> = [];
    const facts: GraphFacts = { edges: [], imports: [], exports: [], moduleKeys: [], javaTypeLookups };
    const byName = new Map(types.map(type => [type.syntaxName, type]));
    const names = new Map<string, string | null>();
    const staticImports = new Map<string, Set<string>>();
    const staticWildcards = new Set<string>();
    const importNodes: { owner: string; line: number }[] = [];
    const wildcardPackages = new Set<string>();
    for (const node of header) {
        if (node.type !== 'import_declaration') continue;
        const target = javaChildren(node).find(child => child.type === 'scoped_identifier' || child.type === 'identifier')?.text
            .replace(/\s+/g, '');
        if (!target || !javaName.test(target)) continue;
        const onDemand = node.children.some(child => child?.type === 'asterisk');
        const isStatic = node.children.some(child => child?.type === 'static');
        if (onDemand) {
            if (isStatic) {
                staticWildcards.add(target);
                importNodes.push({ owner: target, line: javaLine(node) });
            } else wildcardPackages.add(target);
            continue;
        }
        const parts = target.split('.');
        const leaf = parts.pop()!;
        if (isStatic) {
            if (!parts.length) continue;
            const owner = parts.join('.');
            const owners = staticImports.get(leaf) ?? new Set<string>();
            owners.add(owner);
            staticImports.set(leaf, owners);
            importNodes.push({ owner, line: javaLine(node) });
        } else {
            names.set(leaf, names.has(leaf) && names.get(leaf) !== target ? null : target);
            importNodes.push({ owner: target, line: javaLine(node) });
        }
    }

    function local(name: string) { return [packageName, name].filter(Boolean).join('.'); }

    function typeName(raw: string, type: JavaType, method?: JavaDeclaration): JavaTypeName | undefined {
        const value = raw.replace(/(?:\[\]|\.\.\.)+$/, '');
        if (primitive.has(value) || !javaName.test(value)) return undefined;
        const [head, ...rest] = value.split('.');
        if (method?.typeParameters.includes(head)) return undefined;
        for (let scope: JavaType | undefined = type; scope; scope = enclosing(scope)) {
            if (scope.typeParameters.includes(head)) return undefined;
            const nested = scope.syntaxName + '.' + value;
            if (byName.has(nested)) return nested;
        }
        if (byName.has(local(value))) return local(value);
        if (names.has(head)) {
            const imported = names.get(head);
            return imported ? [imported, ...rest].join('.') : undefined;
        }
        if (rest.length && (byName.has(value) || /^\p{Ll}/u.test(head))) return value;
        if (!wildcardPackages.size) return local(value);
        if (rest.length || wildcardPackages.size > 32) return undefined;
        const onDemand = implicitJavaLangTypes.has(value) ? [] : [...wildcardPackages];
        return { candidates: [
            { name: local(value), priority: 0, publicOnly: false },
            ...onDemand.filter(candidate => candidate !== packageName).map(candidate => ({
                name: candidate + '.' + value, priority: 1, publicOnly: true
            }))
        ] };
    }

    function enclosing(type: JavaType) {
        return type.unit.parentQualifiedName ? byName.get(type.syntaxName.slice(0, type.syntaxName.lastIndexOf('.'))) : undefined;
    }

    function typeVisibility(type: JavaType) {
        let visibility: 'public' | 'package' = 'public';
        for (let scope: JavaType | undefined = type; scope; scope = enclosing(scope)) {
            if (scope.unit.metadata.visibility === 'private') return 'private';
            if (scope.unit.metadata.visibility !== 'public') visibility = 'package';
        }
        return visibility;
    }

    function canonical(raw: string, type: JavaType, method: JavaDeclaration) {
        const base = raw.replace(/(?:\[\]|\.\.\.)+$/, '');
        const normalized = primitive.has(base) ? base : typeName(base, type, method);
        const suffix = raw.slice(base.length).replace('...', '[]');
        return typeof normalized === 'string' ? normalized + suffix : suffix ? undefined : normalized;
    }

    function edge(source: CodeUnit, target: CodeUnit, kind: RelationKind, line: number) {
        if (source.id !== target.id || kind === 'CALLS') facts.edges.push({ sourceId: source.id, targetId: target.id,
            kind, filePath: source.filePath, sourceLine: line, resolved: true });
    }

    function reference(source: CodeUnit, owner: JavaTypeName, names: (qualified: string) => string[], kind: RelationKind, line: number) {
        if (typeof owner === 'string') {
            for (const name of names(owner)) facts.imports.push({ sourceId: source.id, module: moduleName(owner), name, kind, line });
        } else {
            javaTypeLookups.push({ sourceId: source.id, kind, line, candidates: owner.candidates.map(candidate => ({
                module: moduleName(candidate.name), priority: candidate.priority, publicOnly: candidate.publicOnly, names: names(candidate.name)
            })) });
        }
    }

    const memberKeys = new Map<JavaType, Map<string, CodeUnit | null>>();
    const returnTypes = new Map<string, JavaTypeName>();
    for (const type of types) {
        facts.moduleKeys.push({ name: moduleName(type.syntaxName), priority: 0 });
        facts.exports.push({ name: type.syntaxName, unit: type.unit });
        const owner = enclosing(type);
        if (owner) edge(owner.unit, type.unit, 'CONTAINS', type.unit.startLine);
        else for (const target of importNodes) reference(type.unit, target.owner, typeExport, 'IMPORTS', target.line);

        const members = new Map<string, CodeUnit | null>();
        memberKeys.set(type, members);
        const access = typeVisibility(type);
        function register(name: string, unit: CodeUnit) { members.set(name, members.has(name) ? null : unit); }
        for (const decl of type.declarations) {
            const { unit } = decl;
            const staticMethod = unit.metadata.is_static === 'true';
            const name = unit.simpleName;
            edge(type.unit, unit, 'CONTAINS', unit.startLine);
            if (unit.kind === 'METHOD' && decl.returnType) {
                const returned = canonical(decl.returnType, type, decl);
                if (returned) returnTypes.set(unit.id, returned);
            }
            if (unit.kind === 'METHOD' && !type.parents.length && !objectMethods.has(name)) {
                register(memberName(type.syntaxName, name, [], 'local-reference'), unit);
                if (!staticMethod) register(memberName(type.syntaxName, name, [], 'local-reference-instance'), unit);
                if (unit.metadata.visibility !== 'private') {
                    register(memberName(type.syntaxName, name, [], 'reference'), unit);
                    if (!staticMethod) register(memberName(type.syntaxName, name, [], 'reference-instance'), unit);
                }
            }
            const args = decl.signatureTypes.map(raw => canonical(raw, type, decl));
            if (unit.kind === 'FIELD' || !args.every((arg): arg is string => typeof arg === 'string')) continue;
            const params = args;
            register(memberName(type.syntaxName, name, params, unit.kind === 'CONSTRUCTOR' ? 'local-new' : 'local'), unit);
            if (unit.kind === 'METHOD' && staticMethod && access !== 'private' && unit.metadata.visibility !== 'private') {
                const scope = unit.metadata.visibility === 'public' && access === 'public' ? 'static' : 'static-package:' + packageName;
                register(memberName(type.syntaxName, name, params, scope), unit);
            }
            if (unit.kind === 'CONSTRUCTOR' && unit.metadata.visibility === 'public') register(memberName(type.syntaxName, name, params, 'new'), unit);
            if (unit.kind === 'METHOD' && !staticMethod) {
                register(memberName(type.syntaxName, name, params, 'local-instance'), unit);
                if (access !== 'private' && unit.metadata.visibility !== 'private') {
                    const scope = unit.metadata.visibility === 'public' && access === 'public' ? 'instance' : 'instance-package:' + packageName;
                    register(memberName(type.syntaxName, name, params, scope), unit);
                    if (unit.metadata.is_abstract !== 'true' && (type.unit.kind !== 'INTERFACE' || decl.body)) {
                        const accessible = access === 'public' && ['public', 'protected'].includes(unit.metadata.visibility);
                        register(memberName(type.syntaxName, name, params, accessible ? 'super' : 'super-package:' + packageName), unit);
                    }
                }
            }
            if (unit.kind === 'METHOD' && !staticMethod && unit.metadata.is_final !== 'true' && unit.metadata.visibility !== 'private') {
                const scope = unit.metadata.visibility === 'package' ? 'override-package' : 'override';
                register(memberName(type.syntaxName, name, params, scope), unit);
            }
        }
        for (const [name, unit] of members) {
            if (!unit || name.startsWith('local')) continue;
            const isReference = name.startsWith('reference:') || name.startsWith('reference-instance:');
            if (isReference && (access !== 'public' || unit.metadata.visibility !== 'public')) continue;
            facts.exports.push({ name, unit });
        }
    }

    function memberReference(source: CodeUnit, owner: JavaTypeName, name: string, args: string[], qualifiers: readonly string[],
        kind: RelationKind, line: number) {
        reference(source, owner, qualified => qualifiers.map(qualifier => memberName(qualified, name, args, qualifier)), kind, line);
    }

    const staticQualifiers = ['static', 'static-package:' + packageName];
    const instanceQualifiers = ['instance', 'instance-package:' + packageName];
    const superQualifiers = ['super', 'super-package:' + packageName];

    function memberInvocation(owner: JavaTypeName, name: string, args: string[], qualifiers: readonly string[]): CallTarget | undefined {
        if (typeof owner !== 'string') return { owner, name, args, qualifiers };
        const declared = byName.get(owner);
        const members = declared && memberKeys.get(declared);
        if (!members) return { owner, name, args, qualifiers };
        let declaration: CodeUnit | undefined;
        for (const qualifier of qualifiers) {
            const candidate = members.get(memberName(owner, name, args, qualifier));
            if (candidate === null || (candidate && declaration)) return undefined;
            if (candidate) declaration = candidate;
        }
        return declaration && { unit: declaration };
    }

    const methodNames = new Map(types.map(type => [type, new Set(type.declarations.flatMap(declaration =>
        declaration.unit.kind === 'METHOD' ? [declaration.unit.simpleName] : []))]));

    function localMember(owner: JavaType, name: string, args: string[]) {
        return memberKeys.get(owner)?.get(memberName(owner.syntaxName, name, args, 'local'));
    }

    function inheritedInFile(type: JavaType, name: string, args: string[], staticContext: boolean) {
        const seen = new Set<string>([type.syntaxName]);
        for (let owner = type; owner.unit.kind === 'CLASS' && seen.size <= 64;) {
            const parent = owner.parents.find(candidate => candidate.kind === 'EXTENDS');
            const target = parent && typeName(parent.name, owner);
            const ancestor = typeof target === 'string' ? byName.get(target) : undefined;
            if (!ancestor || seen.has(ancestor.syntaxName)) return undefined;
            seen.add(ancestor.syntaxName);
            const method = localMember(ancestor, name, args);
            if (method) {
                return method.metadata.visibility !== 'private' && (!staticContext || method.metadata.is_static === 'true') ? method : undefined;
            }
            if (methodNames.get(ancestor)?.has(name)) return undefined;
            owner = ancestor;
        }
        return undefined;
    }

    let visited = 0;
    for (const type of types) {
        const parents = type.parents.flatMap(parent => {
            const target = typeName(parent.name, type);
            if (!target || target === type.syntaxName) return [];
            reference(type.unit, target, typeExport, parent.kind, parent.line);
            return [{ target, kind: parent.kind }];
        });
        const superclass = type.unit.kind === 'CLASS' ? parents.find(parent => parent.kind === 'EXTENDS')?.target : undefined;
        const fields = new Map<string, { type: JavaTypeName | undefined }>();
        const ownFields = new Map<string, { type: JavaTypeName | undefined }>();
        for (let owner: JavaType | undefined = type; owner; owner = enclosing(owner)) {
            for (const field of owner.declarations) {
                const name = field.unit.simpleName;
                if (field.unit.kind !== 'FIELD' || fields.has(name)) continue;
                const binding = { type: field.returnType ? canonical(field.returnType, owner, field) : undefined };
                fields.set(name, binding);
                if (owner === type) ownFields.set(name, binding);
            }
        }
        for (const decl of type.declarations) {
            const { unit, body, parameters, signatureTypes } = decl;
            const referencedTypes = new Set(decl.returnType ? [...signatureTypes, decl.returnType] : signatureTypes);
            for (const raw of referencedTypes) {
                const target = typeName(raw, type, decl);
                if (target) reference(unit, target, typeExport, 'DEFINES_TYPE', unit.startLine);
            }
            if (unit.kind === 'METHOD' && unit.metadata.is_static !== 'true' && unit.metadata.visibility !== 'private') {
                const args = signatureTypes.map(raw => canonical(raw, type, decl));
                if (args.every((arg): arg is string => typeof arg === 'string')) {
                    for (const { target: parent } of parents) {
                        reference(unit, parent, qualified => {
                            const scopes = ['override'];
                            if (qualified.slice(0, qualified.lastIndexOf('.')) === packageName || byName.has(qualified)) {
                                scopes.push('override-package');
                            }
                            return scopes.map(scope => memberName(qualified, unit.simpleName, args, scope));
                        }, 'OVERRIDES', unit.startLine);
                    }
                }
            }
            if (!body) continue;

            const { calls, bindingFor, typeFor } = javaBodyBindings(body, raw => canonical(raw, type, decl), () => {
                if (++visited > 150_000) throw new Error('SYNTAX_LIMIT');
            });

            const byParameter = new Map(parameters.map(param => [param.name, { type: canonical(param.type, type, decl) }]));
            function variable(name: string, position: Node) {
                return bindingFor(name, position) ?? byParameter.get(name) ?? fields.get(name);
            }

            function expressionType(node: Node, depth = 0): JavaTypeName | undefined {
                if (depth === 24) return undefined;
                if (integerLiterals.has(node.type)) return /[lL]$/.test(node.text) ? 'long' : 'int';
                if (floatingLiterals.has(node.type)) return /[fF]$/.test(node.text) ? 'float' : 'double';
                switch (node.type) {
                    case 'true': case 'false': return 'boolean';
                    case 'character_literal': return 'char';
                    case 'string_literal': return 'java.lang.String';
                    case 'this': return type.syntaxName;
                    case 'identifier': return variable(node.text, node)?.type;
                    case 'field_access': {
                        const name = node.childForFieldName('field')?.text;
                        return name && node.childForFieldName('object')?.type === 'this' ? ownFields.get(name)?.type : undefined;
                    }
                    case 'parenthesized_expression': {
                        const inner = javaChildren(node)[0];
                        return inner && expressionType(inner, depth + 1);
                    }
                    case 'method_invocation': {
                        const target = methodInvocation(node, depth + 1);
                        // A deferred cross-file reference does not supply a return type during this parse.
                        return target && 'unit' in target ? returnTypes.get(target.unit.id) : undefined;
                    }
                    default: return typeFor(explicitExpressionType(node), node);
                }
            }

            function argumentTypes(call: Node, depth: number) {
                const list = call.childForFieldName('arguments');
                if (!list) return undefined;
                const args = javaChildren(list).map(argument => expressionType(argument, depth));
                return args.every((arg): arg is string => typeof arg === 'string') ? args : undefined;
            }

            function methodInvocation(call: Node, depth: number): CallTarget | undefined {
                if (depth >= 24) return undefined;
                const name = call.childForFieldName('name')?.text;
                const args = argumentTypes(call, depth);
                if (!name || !args) return undefined;
                const object = call.childForFieldName('object');
                if (!object || object.type === 'this') {
                    const own = localMember(type, name, args);
                    if (own) return { unit: own };
                    if (methodNames.get(type)?.has(name)) return undefined;
                    const inherited = inheritedInFile(type, name, args, unit.metadata.is_static === 'true');
                    if (inherited) return { unit: inherited };
                    if (object || type.parents.length || enclosing(type) || objectMethods.has(name)
                        || type.unit.kind !== 'CLASS' || type.unit.metadata.is_record === 'true') return undefined;
                    const imports = staticImports.get(name) ?? staticWildcards;
                    return imports.size === 1 ? memberInvocation([...imports][0], name, args, staticQualifiers) : undefined;
                }
                if (object.type === 'super' || call.children.some(child => child?.type === 'super')) {
                    const qualified = object.type === 'super' ? undefined : typeFor(object.text.replace(/\s+/g, ''), object);
                    const owner = object.type === 'super' ? superclass : parents.find(({ target, kind }) => {
                        if (kind !== 'IMPLEMENTS' && type.unit.kind !== 'INTERFACE') return false;
                        if (typeof target === 'string' || typeof qualified === 'string' || !qualified) return target === qualified;
                        return target.candidates[0].name === qualified.candidates[0].name;
                    })?.target;
                    return owner ? memberInvocation(owner, name, args, superQualifiers) : undefined;
                }
                const receiverType = expressionType(object, depth);
                if (isReceiver(receiverType)) {
                    if (receiverType === type.syntaxName) {
                        const match = memberKeys.get(type)?.get(memberName(receiverType, name, args, 'local-instance'));
                        return match ? { unit: match } : undefined;
                    }
                    return memberInvocation(receiverType, name, args, instanceQualifiers);
                }
                if (object.type === 'identifier' || object.type === 'field_access') {
                    const receiver = object.text.replace(/\s+/g, '');
                    const first = receiver.split('.')[0];
                    if (first === 'this' || first === 'super' || variable(first, object)) return undefined;
                    const owner = typeFor(receiver, object);
                    return owner ? memberInvocation(owner, name, args, staticQualifiers) : undefined;
                }
                return undefined;
            }

            function referencedMethod(call: Node): CallTarget | undefined {
                const parts = javaChildren(call);
                const receiver = parts[0];
                const identifier = parts.at(-1);
                if (!receiver || receiver === identifier || identifier?.type !== 'identifier') return undefined;
                const name = identifier.text;
                const boundType = expressionType(receiver);
                let owner = boundType;
                if (!owner) {
                    const candidate = erasedJavaType(receiver);
                    const first = candidate.split('.')[0];
                    if (first === 'this' || first === 'super' || variable(first, receiver)) return undefined;
                    owner = typeFor(candidate, receiver);
                }
                if (!isReceiver(owner)) return undefined;
                const qualifier = boundType ? 'reference-instance' : 'reference';
                if (typeof owner !== 'string') return { owner, name, args: [], qualifiers: [qualifier] };
                const declaringType = byName.get(owner);
                if (!declaringType) return { owner, name, args: [], qualifiers: [qualifier] };
                const declaration = memberKeys.get(declaringType)?.get(memberName(owner, name, [], 'local-' + qualifier));
                if (!declaration || (declaration.metadata.visibility === 'private' && declaringType !== type)) return undefined;
                return { unit: declaration };
            }

            for (const call of calls) {
                const line = javaLine(call);
                if (call.type === 'method_invocation' || call.type === 'method_reference') {
                    const target = call.type === 'method_reference' ? referencedMethod(call) : methodInvocation(call, 0);
                    if (!target) continue;
                    if ('unit' in target) edge(unit, target.unit, 'CALLS', line);
                    else {
                        memberReference(unit, target.owner, target.name, target.args, target.qualifiers, 'CALLS', line);
                    }
                    continue;
                }
                const args = argumentTypes(call, 0);
                if (!args) continue;
                const isThis = call.type === 'explicit_constructor_invocation';
                if (isThis && call.childForFieldName('constructor')?.type !== 'this') continue;
                const rawType = erasedJavaType(call.childForFieldName('type'));
                const target = isThis ? type.syntaxName : typeFor(rawType, call);
                if (!target) continue;
                const name = (typeof target === 'string' ? target : rawType).split('.').at(-1)!;
                const localConstructor = typeof target === 'string' ? memberKeys.get(type)?.get(
                    memberName(target, name, args, 'local-new')) : undefined;
                if (localConstructor) edge(unit, localConstructor, 'CALLS', line);
                else if (!isThis && name) memberReference(unit, target, name, args, ['new'], 'CALLS', line);
            }
        }
    }
    return facts;
}
