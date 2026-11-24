import type { DatabaseSync } from 'node:sqlite';
import type { CodeGraph } from './graph.js';
import { javaChildren, parseJavaSyntax } from './java-syntax.js';
import { isSensitiveReviewPath, redactReviewText } from './review-redaction.js';
import type { CodeUnit } from './source.js';

const mappingMethods = new Map([
    ['RequestMapping', ''], ['GetMapping', 'GET'], ['PostMapping', 'POST'], ['PutMapping', 'PUT'],
    ['PatchMapping', 'PATCH'], ['DeleteMapping', 'DELETE']
]);
const authorizationAnnotations = new Set(['PreAuthorize', 'PostAuthorize', 'Secured', 'RolesAllowed', 'PermitAll', 'DenyAll']);
const httpMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']);
const policyMarkers = /\b(?:SecurityFilterChain|authorizeHttpRequests|authorizeRequests|requestMatchers|antMatchers)\b/;
const resources = [
    ['DATABASE', 'queryForObject', /\bqueryForObject\s*\(/],
    ['DATABASE', 'executeQuery', /\bexecuteQuery\s*\(/],
    ['DATABASE', 'executeUpdate', /\bexecuteUpdate\s*\(/],
    ['DATABASE', 'repository.findBy', /\b\w*repository\s*\.\s*findBy\w*\s*\(/i],
    ['DATABASE', 'repository.save', /\b\w*repository\s*\.\s*save\w*\s*\(/i],
    ['FILE', 'Files API', /\bFiles\s*\.\s*(?:read|write|copy|move|delete)\w*\s*\(/],
    ['FILE', 'file stream', /\b(?:FileInputStream|FileOutputStream)\s*\(/],
    ['NETWORK', 'HTTP client', /\b(?:RestTemplate|WebClient|HttpClient|URLConnection)\b/],
    ['DANGEROUS_SINK', 'Runtime.exec', /\bRuntime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec\s*\(/],
    ['DANGEROUS_SINK', 'ProcessBuilder', /\bnew\s+ProcessBuilder\s*\(/],
    ['DANGEROUS_SINK', 'ScriptEngine.eval', /\b\w*Engine\s*\.\s*eval\s*\(/]
] as const;
const maxVisited = 200;
type ConstraintScope = 'CLASS' | 'METHOD' | 'CONFIGURATION';
interface Constraint {
    scope: ConstraintScope;
    annotation: string;
    expression: string;
    effective: boolean;
    citation: ReturnType<typeof citation>;
}

function simpleAnnotation(annotation: string) {
    return annotation.replace(/^@/, '').split('.').at(-1)!;
}

function annotationValue(unit: CodeUnit, annotation: string) {
    return unit.metadata['ann_' + annotation.replace(/^@/, '')] ?? unit.metadata['ann_' + simpleAnnotation(annotation)];
}

function citation({ qualifiedName, filePath, startLine, endLine }: CodeUnit) {
    return { qualifiedName, filePath, startLine, endLine };
}

function pathSegment(unit: CodeUnit | undefined) {
    const annotation = unit?.annotations.find(name => mappingMethods.has(simpleAnnotation(name)));
    const value = unit && annotation ? annotationValue(unit, annotation)?.trim() ?? '' : '';
    const first = value.startsWith('{') ? value.slice(1).trim().match(/^"((?:\\.|[^"\\])*)"/)?.[1] ?? '' : value;
    return first.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

function requestMethods(unit: CodeUnit) {
    const annotations = unit.annotations.map(simpleAnnotation);
    const methods = new Set<string>();
    for (const annotation of annotations) {
        const method = mappingMethods.get(annotation);
        if (method) methods.add(method);
    }
    if (!annotations.includes('RequestMapping')) return [...methods];
    let tree;
    try {
        tree = parseJavaSyntax('class IndexedHandler {\n' + unit.rawSource + '\n}');
        const body = javaChildren(tree.rootNode)[0]?.childForFieldName('body');
        const handler = javaChildren(body).find(node => node.type === 'method_declaration');
        const modifiers = javaChildren(handler).find(node => node.type === 'modifiers');
        for (const annotation of javaChildren(modifiers)) {
            if (simpleAnnotation(annotation.childForFieldName('name')?.text ?? '') !== 'RequestMapping') continue;
            const methodArgument = javaChildren(annotation.childForFieldName('arguments'))
                .find(argument => argument.childForFieldName('key')?.text === 'method');
            const value = methodArgument?.childForFieldName('value');
            if (!value) continue;
            for (const item of value.type === 'element_value_array_initializer' ? javaChildren(value) : [value]) {
                const literal = item.type === 'identifier' ? item.text : undefined;
                const owner = item.childForFieldName('object')?.text.split('.').at(-1)?.trim();
                const name = literal ?? (owner === 'RequestMethod' ? item.childForFieldName('field')?.text : undefined);
                if (name && httpMethods.has(name)) methods.add(name);
            }
        }
    } catch (error) {
        if (!(error instanceof Error) || error.message !== 'PARSE_TIMEOUT') throw error;
    } finally {
        tree?.delete();
    }
    return [...methods];
}

function localConstraints(unit: CodeUnit, scope: 'CLASS' | 'METHOD', effective: boolean): Constraint[] {
    return unit.annotations.flatMap(fullName => {
        const annotation = simpleAnnotation(fullName);
        if (!authorizationAnnotations.has(annotation)) return [];
        const defaultValue = annotation === 'PermitAll' ? 'permitAll' : annotation === 'DenyAll' ? 'denyAll' : '';
        const value = annotationValue(unit, fullName) ?? defaultValue;
        return [{ scope, annotation, expression: redactReviewText(value), effective, citation: citation(unit) }];
    });
}

function referencesRoute(unit: CodeUnit, path: string) {
    return /\banyRequest\s*\(\s*\)/.test(unit.rawSource)
        || unit.rawSource.includes(JSON.stringify(path));
}

function resourceEvidence(graph: CodeGraph, handler: CodeUnit, depth: number) {
    const evidence = [];
    const seen = new Set([handler.id]);
    const queue = [[handler]];
    let truncated = false;
    for (const path of queue) {
        const unit = path.at(-1)!;
        const code = unit.rawSource.replace(/"""[\s\S]*?"""|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, ' ');
        for (const [kind, target, pattern] of resources) {
            if (pattern.test(code)) evidence.push({
                kind, target, callPath: path.map(node => node.qualifiedName), citations: path.map(citation)
            });
        }
        if (path.length - 1 >= depth) continue;
        for (const callee of graph.traverse(unit.id, 'callees', 1, maxVisited + 1)) {
            if (seen.has(callee.id)) continue;
            if (seen.size >= maxVisited) {
                truncated = true;
                break;
            }
            seen.add(callee.id);
            queue.push([...path, callee]);
        }
    }
    return { evidence, truncated };
}

export function springAuthorizationEvidence(db: DatabaseSync, graph: CodeGraph, projectId: string, depth: number) {
    const routes = db.prepare(`
        SELECT handler.payload AS handler, owner.payload AS owner FROM unit handler
        LEFT JOIN unit owner ON owner.project_id = handler.project_id AND owner.file_path = handler.file_path
            AND owner.qualified_name = json_extract(handler.payload, '$.parentQualifiedName')
            AND owner.kind IN ('CLASS', 'INTERFACE', 'ENUM')
        WHERE handler.project_id = ? AND handler.language = 'java' AND handler.kind = 'METHOD'
            AND json_extract(handler.payload, '$.metadata.is_entry_point') = 'true'
            AND json_extract(handler.payload, '$.metadata.bytecode') IS NOT 'true'
        ORDER BY handler.qualified_name, handler.file_path, handler.start_line
    `).all(projectId).flatMap(row => {
        const handler = JSON.parse(String(row.handler)) as CodeUnit;
        return handler.annotations.some(annotation => mappingMethods.has(simpleAnnotation(annotation)))
            ? [{ handler, owner: row.owner ? JSON.parse(String(row.owner)) as CodeUnit : undefined }] : [];
    });
    let policies: CodeUnit[] | undefined;

    return routes.map(({ handler, owner }) => {
        const path = '/' + [pathSegment(owner), pathSegment(handler)].filter(Boolean).join('/');
        const route = { path, httpMethods: requestMethods(handler), handler: handler.qualifiedName, citation: citation(handler) };
        const method = localConstraints(handler, 'METHOD', true);
        const local = [...(owner ? localConstraints(owner, 'CLASS', !method.length) : []), ...method];
        const missingInfo = [];
        let status = 'LOCAL_CONSTRAINT_CANDIDATE';
        let constraints = local;
        if (!local.length) {
            if (path !== '/') {
                policies ??= db.prepare(`
                    SELECT payload FROM unit WHERE project_id = ? AND language = 'java'
                        AND kind IN ('METHOD','CONSTRUCTOR')
                        AND json_extract(payload, '$.metadata.bytecode') IS NOT 'true'
                    ORDER BY qualified_name, file_path, start_line
                `).all(projectId).map(row => JSON.parse(String(row.payload)) as CodeUnit)
                    .filter(unit => policyMarkers.test(unit.rawSource));
                constraints = policies.filter(unit => referencesRoute(unit, path)).map(unit => {
                    const source = redactReviewText(unit.rawSource, isSensitiveReviewPath(unit.filePath)).replace(/\s+/g, ' ').trim();
                    return {
                        scope: 'CONFIGURATION', annotation: 'SecurityFilterChain', effective: false,
                        expression: source.length > 500 ? source.slice(0, 500) + '...' : source, citation: citation(unit)
                    };
                });
            }
            status = constraints.length ? 'POLICY_CANDIDATE' : 'NO_LOCAL_EVIDENCE';
            missingInfo.push(constraints.length
                ? 'Static analysis cannot confirm the security configuration route coverage'
                : 'No local authorization evidence was found');
        }
        missingInfo.push('Runtime filter, gateway, proxy and external policy behavior was not evaluated');
        const { evidence, truncated } = resourceEvidence(graph, handler, Math.min(depth, 12));
        if (truncated) missingInfo.push('Resource access analysis reached its method limit');
        return { projectId, route, status, constraints, resourceAccesses: evidence, missingInfo };
    });
}
