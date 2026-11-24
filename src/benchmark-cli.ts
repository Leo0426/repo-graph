import { createHash } from 'node:crypto';
import { mkdir, mkdtempDisposable, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { benchmarkCorpus, benchmarkEmbedding, benchmarkEmbeddingHeader, benchmarkResult, benchmarkResultsPath,
    benchmarkSection, benchmarkSnapshot, readBenchmarkFile, retrievalRankLimit } from './benchmark.js';
import { findingPublicText } from './finding-import.js';

const usage = 'Usage: npm run benchmark -- --project PROJECT_ID [--cases FILE] [--output FILE]';
const defaultCases = fileURLToPath(new URL('../resources/benchmark-cases.json', import.meta.url));
const project = z.object({ projectId: z.string(), projectName: z.string(), indexedAt: z.string(), nodeCount: z.int() });
const resultsPage = z.object({ results: z.array(z.object({
    projectId: z.string(), score: z.number(), unit: z.object({ qualifiedName: z.string() })
})).max(retrievalRankLimit) });

async function main() {
    const { values } = parseArgs({ options: { cases: { type: 'string' }, project: { type: 'string' },
        output: { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) { console.log(usage); return; }
    const projectId = values.project ?? '';
    if (!/^[0-9a-f]{12}$/.test(projectId)) throw new Error(usage);
    const token = process.env.REPOGRAPH_ACCESS_TOKEN;
    if (!token || !/^[A-Za-z0-9._~-]{24,256}$/.test(token)) throw new Error('BENCHMARK_ACCESS_TOKEN_REQUIRED');
    const app = new URL(process.env.REPOGRAPH_BASE_URL ?? 'http://127.0.0.1:8080');
    if (!['127.0.0.1', '[::1]'].includes(app.hostname) || !['http:', 'https:'].includes(app.protocol)
        || app.username || app.password || app.search || app.hash || app.pathname !== '/') throw new Error('BENCHMARK_LOCAL_URL_REQUIRED');
    const database = resolve(process.env.REPOGRAPH_DB_PATH ?? join(homedir(), '.repograph', 'typescript', 'index.db'));
    const output = benchmarkResultsPath(database, values.output || process.env.REPOGRAPH_BENCHMARK_RESULTS);
    const input = values.cases === undefined ? defaultCases : resolve(values.cases);
    if (output === input || output === database) throw new Error('INVALID_BENCHMARK_OUTPUT');
    const corpus = benchmarkCorpus.safeParse(await readBenchmarkFile(input));
    if (!corpus.success) throw new Error('INVALID_BENCHMARK_CORPUS');
    const deadline = AbortSignal.timeout(10 * 60_000);
    async function request(path: string, args: Record<string, string> = {}) {
        const url = new URL('/api/v1' + path, app);
        url.search = new URLSearchParams(args).toString();
        const response = await fetch(url, {
            headers: { Authorization: 'Bearer ' + token }, redirect: 'error',
            signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)])
        });
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error('BENCHMARK_REQUEST_FAILED_HTTP_' + response.status);
        }
        return response;
    }
    async function getProject() {
        const response = await request('/projects');
        return z.array(project).parse(await response.json()).find(row => row.projectId === projectId);
    }
    const source = await getProject();
    if (!source?.indexedAt || !source.nodeCount) throw new Error('BENCHMARK_PROJECT_NOT_INDEXED');
    const sections = {} as Record<'semantic' | 'code', ReturnType<typeof benchmarkSection>>;
    let observedEmbeddingHeader: string | null | undefined;
    for (const mode of ['semantic', 'code'] as const) {
        const cases = [];
        for (const query of corpus.data[mode]) {
            const response = await request('/search/' + mode, {
                projectId, [mode === 'semantic' ? 'q' : 'snippet']: query.query, limit: String(retrievalRankLimit)
            });
            const profile = response.headers.get(benchmarkEmbeddingHeader);
            if (observedEmbeddingHeader !== undefined && observedEmbeddingHeader !== profile) {
                await response.body?.cancel();
                throw new Error('BENCHMARK_EMBEDDING_CHANGED');
            }
            observedEmbeddingHeader = profile;
            const page = resultsPage.parse(await response.json());
            if (page.results.some(hit => hit.projectId !== projectId)) throw new Error('BENCHMARK_WRONG_PROJECT');
            const result = benchmarkResult(query, page.results.map(({ unit, score }) => ({ qualifiedName: unit.qualifiedName, score })));
            cases.push({ ...result, description: findingPublicText(result.description, 1000) || result.id,
                topResult: findingPublicText(result.topResult, 1000) });
        }
        sections[mode] = benchmarkSection(mode, cases);
    }
    const current = await getProject();
    if (source.indexedAt !== current?.indexedAt || source.nodeCount !== current.nodeCount) throw new Error('BENCHMARK_INDEX_CHANGED');
    const report = benchmarkSnapshot.parse({
        projectId, projectLabel: findingPublicText(source.projectName, 270) + ' [' + projectId + ']',
        corpusDigest: createHash('sha256').update(JSON.stringify(corpus.data)).digest('hex'),
        embedding: observedEmbeddingHeader ? benchmarkEmbedding.parse(JSON.parse(decodeURIComponent(observedEmbeddingHeader))) : undefined,
        generatedAt: new Date().toISOString(), ...sections
    });
    const parent = dirname(output);
    await mkdir(parent, { mode: 0o700, recursive: true });
    const staging = await mkdtempDisposable(join(parent, '.benchmark-'));
    try {
        const staged = join(staging.path, 'report.json');
        await writeFile(staged, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
        await rename(staged, output);
    } finally { await staging.remove(); }
    console.log(JSON.stringify({ projectId, semanticHit10: sections.semantic.hit10Rate, codeHit10: sections.code.hit10Rate, output }));
    if (!sections.semantic.passed || !sections.code.passed) process.exitCode = 1;
}

main().catch(error => {
    const message = (error as Error).message;
    console.error(/^(?:INVALID_BENCHMARK_|BENCHMARK_|Usage:)/.test(message) ? message : 'BENCHMARK_FAILED');
    process.exitCode = 2;
});
