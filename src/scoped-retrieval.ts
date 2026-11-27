import { z } from 'zod';
import { HttpError } from './http-error.js';
import type { Account } from './identity.js';
import type { RepositoryIndex } from './index.js';
import { graphRag } from './retrieval.js';
import type { CodeUnit } from './source.js';

export const scopedUuid = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
export const scopedRepository = z.object({
    projectId: z.string().regex(/^[a-f0-9]{12}$/),
    spaceId: scopedUuid.optional(),
    snapshotId: scopedUuid.optional()
}).strict();
export const scopedSearchInput = z.object({
    query: z.string().trim().min(1).max(4096).refine(value => !value.includes('\0')),
    scopes: z.array(scopedRepository).min(1).max(8),
    method: z.enum(['keyword', 'hybrid']).default('hybrid'),
    language: z.string().trim().min(1).max(32).transform(value => value.toLowerCase()).optional(),
    noTest: z.boolean().default(true),
    limit: z.int().min(1).max(50).default(20)
}).strict();

export type RepositoryScope = z.infer<typeof scopedRepository>;
type Scope = RepositoryScope;
type SearchInput = z.infer<typeof scopedSearchInput>;
type Method = 'KEYWORD' | 'VECTOR' | 'CALL_GRAPH' | 'IMPACT' | 'CHANGE' | 'FINDING';
type ScopeCoverage = { projectId: string; snapshotId: string | null; spaceIds: string[]; direct: boolean };
type Hit = { unit: CodeUnit; methods: Method[]; score: number };
type Result = Hit & ScopeCoverage;
type Outcome =
    { status: 'MATCHED' | 'NO_MATCHES'; hits: Hit[]; omissions: string[] }
    | { status: 'INDEX_UNAVAILABLE' | 'QUERY_FAILED'; hits: []; omissions: string[] };
const concurrency = 3;
const rankConstant = 60;

export function rankScore(rank: number) { return 1 / (rankConstant + rank); }

export function authorizeRepositoryScope(repository: RepositoryIndex, actor: Account, target: Scope, frozenId?: string) {
    const linked = target.spaceId ? repository.spaces.repository(actor, target.spaceId, target.projectId) : undefined;
    repository.identity.requireProjectReader(actor, target.projectId);
    repository.projectRoot(target.projectId);
    const id = frozenId ?? target.snapshotId ?? linked?.snapshotId;
    if (id && linked?.snapshotId && id !== linked.snapshotId) throw new HttpError(403, 'SNAPSHOT_OUTSIDE_SPACE_LINK');
    if (!id) return undefined;
    const snapshot = repository.knowledgeSnapshots.get(id);
    if (snapshot?.projectId !== target.projectId) throw new HttpError(404, 'SNAPSHOT_NOT_FOUND');
    return snapshot.id;
}

async function queryTarget(repository: RepositoryIndex, input: SearchInput, source: ScopeCoverage,
    ensureReadable: () => void, signal?: AbortSignal): Promise<Outcome> {
    const { projectId, snapshotId } = source;
    if (!snapshotId) return { status: 'INDEX_UNAVAILABLE', hits: [], omissions: ['NO_PUBLISHED_SNAPSHOT'] };
    signal?.throwIfAborted();
    try {
        if (input.method === 'keyword') {
            const hits = repository.search(input.query, projectId, input.language ?? null, null, input.limit, input.noTest, null, snapshotId)
                .map(({ unit }, index) => ({ unit, methods: ['KEYWORD' as const], score: rankScore(index + 1) }));
            return { status: hits.length ? 'MATCHED' : 'NO_MATCHES', hits, omissions: [] };
        }
        const retrieval = await graphRag(repository, input.query, {
            projectId, snapshotId, language: input.language ?? null, noTest: input.noTest, limit: input.limit,
            depth: 1, callGraph: true, impactExpansion: true, rerank: true, trackIndexRanks: true,
            allowedProjects: () => { ensureReadable(); return null; }
        }, signal);
        const hits = retrieval.results.map((item, index) => {
            const ranks = item.indexRanks;
            const methods: Method[] = [];
            let score = 0;
            for (const method of ['KEYWORD', 'VECTOR'] as const) {
                if (!ranks?.[method]) continue;
                methods.push(method);
                score += rankScore(ranks[method]);
            }
            if (!methods.length) {
                methods.push(item.source);
                score = rankScore(input.limit + index + 1);
            }
            return { unit: item.unit, methods, score };
        });
        return { status: hits.length ? 'MATCHED' : 'NO_MATCHES', hits, omissions: retrieval.omittedReasons };
    } catch (error) {
        if (signal?.aborted || error instanceof HttpError) throw error;
        return { status: 'QUERY_FAILED', hits: [], omissions: ['RETRIEVAL_FAILED'] };
    }
}

export async function scopedSearch(repository: RepositoryIndex, actor: Account, input: SearchInput, signal?: AbortSignal) {
    const groups = new Map<string, { source: ScopeCoverage; verify: (() => void)[] }>();
    for (const target of input.scopes) {
        const snapshotId = authorizeRepositoryScope(repository, actor, target)
            ?? repository.knowledgeSnapshots.list(target.projectId, 1, 0)[0]?.id ?? null;
        const key = target.projectId + '/' + (snapshotId ?? '');
        const group = groups.get(key) ?? {
            source: { projectId: target.projectId, snapshotId, spaceIds: [], direct: false }, verify: []
        };
        if (!target.spaceId) group.source.direct = true;
        else if (!group.source.spaceIds.includes(target.spaceId)) group.source.spaceIds.push(target.spaceId);
        group.verify.push(() => authorizeRepositoryScope(repository, actor, target, snapshotId ?? undefined));
        groups.set(key, group);
    }
    const targets = [...groups.values()];
    const coverage = [];
    const results: Result[] = [];
    let successes = 0;
    for (let offset = 0; offset < targets.length; offset += concurrency) {
        const batch = targets.slice(offset, offset + concurrency);
        const pages = await Promise.all(batch.map(({ source, verify }) =>
            queryTarget(repository, input, source, () => verify.forEach(check => check()), signal)));
        for (const [index, page] of pages.entries()) {
            const { source } = batch[index];
            source.spaceIds.sort();
            if (page.status === 'MATCHED' || page.status === 'NO_MATCHES') {
                successes++;
                for (const hit of page.hits) results.push({ ...source, ...hit });
            }
            coverage.push({ ...source, status: page.status, omissions: page.omissions });
        }
    }
    signal?.throwIfAborted();
    for (const group of targets) group.verify.forEach(check => check());
    results.sort((left, right) => right.score - left.score
        || left.projectId.localeCompare(right.projectId) || (left.snapshotId ?? '').localeCompare(right.snapshotId ?? '')
        || left.unit.id.localeCompare(right.unit.id));
    const status = successes === 0 ? 'FAILED' : successes < targets.length ? 'PARTIAL' : 'COMPLETE';
    return { status, method: input.method, results: results.slice(0, input.limit), coverage };
}
