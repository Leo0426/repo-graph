import { findingPublicText } from './finding-import.js';
import { withFlowProcedure } from './flow-source.js';
import { parameterSinkRules } from './parameter-flow.js';
import type { ParameterFlowSlot, traceParameterFlow } from './parameter-flow.js';
import { isSensitiveReviewPath, redactReviewText } from './review-redaction.js';
import type { CodeUnit } from './source.js';
import { syntaxChildren } from './syntax-tree.js';
import type { VulnerabilityEvidenceStep } from './vulnerability-inventory.js';

type SinkRule = NonNullable<ReturnType<typeof parameterSinkRules.get>>;
type Trace = NonNullable<ReturnType<typeof traceParameterFlow>>;
export type TaintMatch = SinkRule & {
    unit: Pick<CodeUnit, 'id' | 'filePath' | 'qualifiedName' | 'startLine' | 'endLine'>;
    parameter: number;
    sink: string;
    evidence: VulnerabilityEvidenceStep[];
};
const routeAnnotations = new Set(['RequestMapping', 'GetMapping', 'PostMapping', 'PutMapping', 'DeleteMapping', 'PatchMapping']);
const requestAnnotations = new Set(['RequestParam', 'PathVariable', 'RequestBody', 'RequestHeader', 'MatrixVariable', 'ModelAttribute']);
const requestTypes = new Set(['HttpServletRequest', 'ServletRequest', 'MultipartFile', 'MultipartRequest', 'ServerWebExchange', 'ServletWebExchange']);
const contextTypes = new Set(['HttpServletResponse', 'ServletResponse', 'Model', 'ModelAndView', 'BindingResult', 'Errors',
    'RedirectAttributes', 'SessionStatus']);
const declarationTypes = new Set(['formal_parameter', 'spread_parameter']);

export function requestParameters(unit: CodeUnit) {
    if (!unit.annotations.some(name => routeAnnotations.has(name.replace(/^@/, '').split('.').at(-1) ?? ''))) return undefined;
    return withFlowProcedure(unit, ({ declaration }) => {
        const parameters = syntaxChildren(declaration.childForFieldName('parameters')).filter(node => declarationTypes.has(node.type));
        const explicit: number[] = [], defaults: number[] = [];
        for (const [index, parameter] of parameters.entries()) {
            const type = parameter.childForFieldName('type') ?? syntaxChildren(parameter)
                .find(node => node.type !== 'modifiers' && node.type !== 'variable_declarator');
            const name = type?.text.split(/[<\[]/, 1)[0].split('.').at(-1)?.trim() ?? '';
            if (contextTypes.has(name)) continue;
            const accepted = parameter.descendantsOfType(['annotation', 'marker_annotation']).some(annotation => {
                const annotationName = annotation?.childForFieldName('name')?.text.split('.').at(-1) ?? '';
                return requestAnnotations.has(annotationName);
            });
            if (accepted || requestTypes.has(name)) explicit.push(index);
            defaults.push(index);
        }
        return explicit.length ? explicit : defaults;
    });
}

function slotLabel(slot: ParameterFlowSlot) {
    if (slot.kind === 'PARAM') return `param[${slot.index}]`;
    if (slot.kind === 'RETURN') return 'return';
    return (slot.kind === 'SINK' ? 'SINK:' : '') + `${slot.calleeHint}.arg[${slot.index}]`;
}

export function taintMatches(entry: CodeUnit, trace: Trace, findUnit: (id: string) => CodeUnit | undefined) {
    const matched = new Set<string>();
    const location = (unit: CodeUnit, sequence: number, role: VulnerabilityEvidenceStep['role'],
        fromSlot: string, toSlot: string): VulnerabilityEvidenceStep => ({
        sequence, role, fromSlot, toSlot, methodQn: findingPublicText(unit.qualifiedName, 1000), filePath: unit.filePath,
        startLine: unit.startLine, endLine: unit.endLine,
        sourceExcerpt: redactReviewText(unit.rawSource, isSensitiveReviewPath(unit.filePath)).slice(0, 1000)
    });
    const hits: TaintMatch[] = [];
    for (const path of trace.paths) {
        const last = path.hops.at(-1);
        const sink = last?.to.calleeHint;
        if (!path.reachesSink || !sink || matched.has(sink)) continue;
        const rule = parameterSinkRules.get(sink);
        if (!rule) continue;
        matched.add(sink);
        const first = path.hops[0];
        const evidence = [location(entry, 1, 'SOURCE', slotLabel(first.from), slotLabel(first.to))];
        for (const hop of path.hops) {
            const unit = hop.unitId === entry.id ? entry : findUnit(hop.unitId);
            if (!unit) continue;
            evidence.push(location(unit, evidence.length + 1, hop.to.kind === 'SINK' ? 'SINK' : 'PROPAGATION',
                slotLabel(hop.from), slotLabel(hop.to)));
        }
        hits.push({ ...rule, unit: entry, parameter: trace.sourceParamIndex, sink, evidence });
    }
    return hits;
}
