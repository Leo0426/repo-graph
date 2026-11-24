import { realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { readProjectFile } from './project-file.js';

const projectId = z.string().regex(/^[0-9a-f]{12}$/);
const caseId = z.string().min(1).max(100);
const description = z.string().min(1).max(1000);
const nullableScore = z.number().nullable();
const rate = z.number().min(0).max(1);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const benchmarkEmbeddingHeader = 'X-RepoGraph-Embedding';
export const benchmarkEmbedding = z.object({
    model: z.string().min(1).max(512), dimensions: z.int().min(1).max(8192), profile: fingerprint
});
const benchmarkCaseResult = z.object({
    id: caseId, description, rank: z.int().min(0).max(10), topScore: nullableScore, hitScore: nullableScore,
    hit1: z.boolean(), hit3: z.boolean(), hit5: z.boolean(), hit10: z.boolean(), topResult: z.string().max(1000)
});
const section = z.object({
    title: z.string().min(1).max(120), total: z.int().min(0).max(500), threshold: rate, hit1Rate: rate, hit3Rate: rate,
    hit5Rate: rate, hit10Rate: rate, mrr10: rate, passed: z.boolean(), cases: z.array(benchmarkCaseResult).max(500)
}).refine(value => value.total === value.cases.length);
export const benchmarkSnapshot = z.object({
    projectId: projectId.optional(), projectLabel: z.string().min(1).max(300), generatedAt: z.string().min(1).max(64),
    corpusDigest: fingerprint.optional(), embedding: benchmarkEmbedding.optional(),
    semantic: section.optional(), code: section.optional()
}).refine(value => Boolean(value.semantic || value.code));

const benchmarkQuery = z.object({
    id: caseId, description, query: z.string().trim().min(1).max(4096),
    expectedPatterns: z.array(z.string().trim().min(1).max(500)).min(1).max(30)
});
const queries = z.array(benchmarkQuery).min(1).max(500).refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length);
export const benchmarkCorpus = z.object({ semantic: queries, code: queries });
export type BenchmarkSnapshot = z.infer<typeof benchmarkSnapshot>;
export type BenchmarkSuite = z.infer<typeof section>;
export type BenchmarkResult = z.infer<typeof benchmarkCaseResult>;
export const retrievalRankLimit = 10;

export function benchmarkResultsPath(database: string, configured = process.env.REPOGRAPH_BENCHMARK_RESULTS) {
    return resolve(configured || join(dirname(database), 'benchmark-latest.json'));
}

export async function readBenchmarkFile(path: string): Promise<unknown> {
    const contents = await readProjectFile(await realpath(path), 2 * 1024 * 1024);
    return JSON.parse(contents.toString('utf8'));
}

export function benchmarkResult(query: z.infer<typeof benchmarkQuery>, hits: { qualifiedName: string; score: number }[]): BenchmarkResult {
    const expected = query.expectedPatterns.map(pattern => pattern.toLowerCase());
    const index = hits.findIndex(hit => expected.some(pattern => hit.qualifiedName.toLowerCase().includes(pattern)));
    const rank = index + 1;
    return {
        id: query.id, description: query.description, rank, topScore: hits[0]?.score ?? null, hitScore: hits[index]?.score ?? null,
        hit1: rank === 1, hit3: rank > 0 && rank <= 3, hit5: rank > 0 && rank <= 5, hit10: rank > 0 && rank <= 10,
        topResult: hits[0]?.qualifiedName ?? ''
    };
}

export function benchmarkSection(mode: 'semantic' | 'code', cases: BenchmarkResult[]): BenchmarkSuite {
    const total = cases.length;
    const threshold = mode === 'semantic' ? .65 : .75;
    const hitRate = (key: 'hit1' | 'hit3' | 'hit5' | 'hit10') => total ? cases.filter(result => result[key]).length / total : 0;
    const hit10Rate = hitRate('hit10');
    return {
        title: mode === 'semantic' ? 'SEMANTIC SEARCH' : 'CODE SEARCH', total, threshold,
        hit1Rate: hitRate('hit1'), hit3Rate: hitRate('hit3'), hit5Rate: hitRate('hit5'), hit10Rate,
        mrr10: total ? cases.reduce((sum, result) => sum + (result.rank === 0 ? 0 : 1 / result.rank), 0) / total : 0,
        passed: total > 0 && hit10Rate >= threshold, cases
    };
}
