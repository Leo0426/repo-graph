import type { RepositoryIndex } from './index.js';
import type { CodeUnit } from './source.js';
import { EmbeddingUnavailable } from './vector.js';
import { HttpError } from './http-error.js';

export interface GraphRagOptions {
    projectId: string | null;
    snapshotId?: string;
    allowedProjects?: () => readonly string[] | null;
    language: string | null;
    noTest: boolean;
    limit: number;
    depth: number;
    callGraph: boolean;
    impactExpansion: boolean;
    rerank: boolean;
    trackIndexRanks?: boolean;
}

export interface RankedUnit {
    projectId: string;
    snapshotId?: string;
    unit: CodeUnit;
    vectorScore: number;
    securityScore: number;
    finalScore: number;
    source: 'VECTOR' | 'KEYWORD' | 'CALL_GRAPH' | 'IMPACT' | 'CHANGE' | 'FINDING';
    relation: 'SEED' | 'CALLER' | 'CALLEE' | 'IMPACT';
    securitySignals: string[];
    indexRanks?: Partial<Record<'KEYWORD' | 'VECTOR', number>>;
}

const MAX_RESULTS = 60;
const SIGNALS: [string, RegExp, number][] = [
    ['access_control', /authenticat|authoriz|permission|csrf|preauthorize/i, 0.3],
    ['sql_operation', /\b(?:executeQuery|executeUpdate|prepareStatement)\b/, 0.3],
    ['command_execution', /\b(?:child_process|ProcessBuilder|Runtime\.getRuntime)\b/, 0.3],
    ['crypto_operation', /encrypt|decrypt|createCipheriv|createDecipheriv/i, 0.2]
];

export function securitySignals(unit: CodeUnit) {
    const matches: string[] = [];
    let score = 0;
    if (unit.metadata.is_entry_point === 'true') {
        matches.push('entry_point');
        score += 0.1;
    }
    const text = `${unit.qualifiedName}\n${unit.annotations.join('\n')}\n${unit.rawSource}`;
    for (const [label, pattern, weight] of SIGNALS) {
        if (!pattern.test(text)) continue;
        matches.push(label);
        score += weight;
    }
    return { matches, score: Math.min(1, score) };
}

export async function graphRag(repository: RepositoryIndex, query: string, options: GraphRagOptions, signal?: AbortSignal) {
    const { projectId, snapshotId, language, noTest, limit, depth, rerank } = options;
    const omittedReasons: string[] = [];
    const candidates = new Map<string, RankedUnit>();
    const securityWeight = rerank ? 0.5 : 0;

    function add(
        unit: CodeUnit, project: string, source: RankedUnit['source'], relation: RankedUnit['relation'],
        vectorScore: number, relevance: number, extraSignals: string[] = []
    ) {
        if (candidates.has(unit.id) || candidates.size >= MAX_RESULTS) return false;
        if ((language && language !== unit.language) || (noTest && unit.metadata.is_test === 'true')) return false;
        const security = securitySignals(unit);
        if (source === 'IMPACT' && !security.score) return false;
        candidates.set(unit.id, {
            unit, projectId: project, source, relation, vectorScore, securityScore: security.score,
            ...(snapshotId ? { snapshotId } : {}),
            finalScore: relevance + security.score * securityWeight,
            securitySignals: [...security.matches, ...extraSignals]
        });
        return true;
    }

    let seedCount = 0;
    try {
        const page = await repository.vectorSearch('semantic', query, {
            projectId, snapshotId, language, noTest, limit, kind: null, entryOnly: false, offset: 0,
            allowedProjects: options.allowedProjects
        }, signal);
        seedCount = page.results.length;
        for (const [index, result] of page.results.entries()) {
            if (add(result.unit, result.projectId, 'VECTOR', 'SEED', result.score, result.score) && options.trackIndexRanks) {
                candidates.get(result.unit.id)!.indexRanks = { VECTOR: index + 1 };
            }
        }
    } catch (error) {
        if (signal?.aborted) throw error;
        if (error instanceof EmbeddingUnavailable) omittedReasons.push(error.code);
        else if (snapshotId && error instanceof HttpError && error.message === 'SNAPSHOT_VECTOR_INDEX_UNAVAILABLE') {
            omittedReasons.push(error.message);
        } else throw error;
    }
    const allowed = options.allowedProjects?.() ?? null;
    if (allowed !== null) {
        const scope = new Set(allowed);
        for (const [id, candidate] of candidates) {
            if (!scope.has(candidate.projectId)) candidates.delete(id);
        }
        seedCount = candidates.size;
    }
    const keywords = repository.search(query, projectId, language, null, limit, noTest, allowed, snapshotId);
    for (const [index, result] of keywords.entries()) {
        const relevance = 0.70 / (1 + index * 0.10);
        const keywordSignals = result.matchedTerms.map(term => `keyword:${term}`);
        const existing = candidates.get(result.unit.id);
        if (existing) {
            if (rerank) {
                existing.finalScore = Math.max(existing.finalScore, relevance + existing.securityScore * securityWeight);
            }
            existing.securitySignals.push(...keywordSignals);
            if (options.trackIndexRanks) existing.indexRanks = { ...existing.indexRanks, KEYWORD: index + 1 };
        } else {
            if (add(result.unit, result.projectId, 'KEYWORD', 'SEED', 0, relevance, keywordSignals) && options.trackIndexRanks) {
                candidates.get(result.unit.id)!.indexRanks = { KEYWORD: index + 1 };
            }
        }
    }

    const seeds = [...candidates.values()];
    if (rerank) seeds.sort(compareRank);
    let callGraphExpanded = 0;
    let impactExpanded = 0;
    for (const seed of seeds) {
        if (candidates.size >= MAX_RESULTS) break;
        if (options.callGraph) {
            for (const [direction, relation] of [['callers', 'CALLER'], ['callees', 'CALLEE']] as const) {
                for (const neighbor of repository.graphNeighbors(seed.unit.id, direction, depth, 12, snapshotId)) {
                    if (add(neighbor, seed.projectId, 'CALL_GRAPH', relation, 0, seed.finalScore * 0.65)) callGraphExpanded++;
                }
            }
        }
        if (options.impactExpansion) {
            for (const neighbor of repository.graphNeighbors(seed.unit.id, 'impact', depth, 12, snapshotId)) {
                if (add(neighbor, seed.projectId, 'IMPACT', 'IMPACT', 0, seed.finalScore * 0.5)) impactExpanded++;
            }
        }
    }

    const results = [...candidates.values()];
    if (rerank) results.sort(compareRank);
    if (!results.length) omittedReasons.push('NO_MATCHING_EVIDENCE');
    if (results.length === MAX_RESULTS) omittedReasons.push('CANDIDATE_LIMIT_REACHED');
    return {
        results, seedCount, keywordSeedCount: keywords.length, callGraphExpanded, impactExpanded, ...(snapshotId ? { snapshotId } : {}),
        securityHighlightCount: results.filter(item => item.securityScore > 0.3).length, omittedReasons
    };
}

function compareRank(a: RankedUnit, b: RankedUnit) {
    return b.finalScore - a.finalScore || a.unit.id.localeCompare(b.unit.id);
}

export function contextPack(
    query: string, taskType: string, budget: number, retrieval: Awaited<ReturnType<typeof graphRag>>
) {
    const { results, seedCount, keywordSeedCount, callGraphExpanded, impactExpanded } = retrieval;
    const omittedReasons = [...retrieval.omittedReasons];
    const usable = results.filter(item => item.unit.rawSource.trim()).length;
    const share = Math.floor(budget / Math.max(1, Math.min(usable, 4)));
    let used = 0;
    const evidence = [];
    for (const item of results) {
        const { id, qualifiedName, kind, language, filePath, startLine, endLine, rawSource } = item.unit;
        const source = rawSource.trimEnd();
        const available = Math.min(share, budget - used);
        const excerpt = source.slice(0, available).replace(/[\uD800-\uDBFF]$/, '').trimEnd();
        if (!excerpt.trim()) {
            omittedReasons.push(`${qualifiedName}: ${!source ? 'empty rawSource' : 'budget exhausted'}`);
            continue;
        }
        const truncated = excerpt.length < source.length;
        if (truncated) omittedReasons.push(`${qualifiedName}: excerpt truncated by budget`);
        used += excerpt.length;
        evidence.push({
            citationId: `C${evidence.length + 1}`, unitId: id, projectId: item.projectId, qualifiedName,
            ...(item.snapshotId ? { snapshotId: item.snapshotId } : {}),
            kind, language, filePath, startLine, endLine, source: item.source, relation: item.relation,
            ...(item.unit.metadata.archive_entry ? { archiveEntry: item.unit.metadata.archive_entry } : {}),
            ...(item.unit.metadata.bytecode === 'true' ? { bytecode: true } : {}),
            finalScore: item.finalScore, excerpt, truncated, securitySignals: item.securitySignals
        });
    }
    return {
        query, taskType: taskType.trim() || 'detail', evidence, omittedReasons, ...(retrieval.snapshotId ? { snapshotId: retrieval.snapshotId } : {}),
        requestedBudgetChars: budget, usedBudgetChars: used, seedCount, keywordSeedCount, callGraphExpanded, impactExpanded
    };
}
