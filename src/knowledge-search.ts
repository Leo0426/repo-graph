import { z } from 'zod';
import { bestCsvCell } from './csv-document.js';
import type { CsvCell } from './csv-document.js';
import { HttpError } from './http-error.js';
import type { Account } from './identity.js';
import type { RepositoryIndex } from './index.js';
import { clipExcerpt, queryExcerpt, queryTerms } from './knowledge-excerpts.js';
import { bestPdfPage } from './pdf-text.js';
import { authorizeRepositoryScope, rankScore, scopedRepository, scopedSearch, scopedSearchInput, scopedUuid } from './scoped-retrieval.js';
import type { RepositoryScope } from './scoped-retrieval.js';
import type { WikiPerspective } from './wiki-facts.js';

const repositoryInput = scopedRepository.extend({ kind: z.literal('repository') });
const wikiInput = scopedRepository.extend({ kind: z.literal('wiki'), pageId: scopedUuid, revisionId: scopedUuid.optional() });
const documentInput = z.object({ kind: z.literal('document'), spaceId: scopedUuid, documentId: scopedUuid, versionId: scopedUuid.optional() }).strict();
const spaceInput = z.object({ kind: z.literal('space'), spaceId: scopedUuid }).strict();
export const knowledgeSearchInput = scopedSearchInput.extend({
    scopes: z.array(z.discriminatedUnion('kind', [repositoryInput, wikiInput, documentInput, spaceInput])).min(1).max(8)
});
type Input = z.infer<typeof knowledgeSearchInput>;
type Status = 'MATCHED' | 'NO_MATCHES' | 'INDEX_UNAVAILABLE' | 'QUERY_FAILED';
type Location =
    { kind: 'SOURCE'; projectId: string; snapshotId: string; filePath: string; unitId: string; archiveEntry?: string; binary: boolean }
    | { kind: 'WIKI'; projectId: string; snapshotId: string; pageId: string; revisionId: string; perspective: WikiPerspective; section: number | null }
    | { kind: 'DOCUMENT'; spaceId: string; documentId: string; versionId: string; page?: number; cell?: CsvCell };
type Preview = Location & { title: string; excerpt: string; startLine: number; endLine: number; truncated: boolean;
    spaceIds: string[]; direct: boolean; score: number; methods: string[] };
type Hit = Preview & { link: string };
type Coverage = { kind: 'SOURCE' | 'WIKI' | 'DOCUMENT' | 'SPACE'; projectId?: string; snapshotId?: string | null;
    spaceIds: string[]; direct?: boolean; spaceId?: string; documentId?: string; versionId?: string; status: Status; omissions: string[] };
type Origin = { direct: boolean; spaces: Set<string> };
type DocumentRef = ReturnType<RepositoryIndex['spaces']['readableDocumentVersion']>;
type Pages = { projectId: string; snapshotId: string; origin: Origin; revisions: Map<string, Origin> };

function addOrigin(origin: Origin, spaceId?: string) {
    if (spaceId) origin.spaces.add(spaceId);
    else origin.direct = true;
}

function resultLink(item: Preview) {
    const params = new URLSearchParams({ kind: item.kind.toLowerCase() });
    if (item.kind === 'DOCUMENT') {
        params.set('spaceId', item.spaceId);
        params.set('documentId', item.documentId);
        params.set('versionId', item.versionId);
        if (item.page !== undefined) params.set('page', String(item.page));
        if (item.cell) {
            params.set('row', String(item.cell.row));
            params.set('column', String(item.cell.column));
        }
    } else {
        params.set('projectId', item.projectId);
        params.set('snapshotId', item.snapshotId);
        if (!item.direct && item.spaceIds[0]) params.set('spaceId', item.spaceIds[0]);
        if (item.kind === 'SOURCE') {
            params.set('file', item.filePath);
            params.set('unitId', item.unitId);
            if (item.archiveEntry) params.set('archiveEntry', item.archiveEntry);
        } else {
            params.set('pageId', item.pageId);
            params.set('revisionId', item.revisionId);
            if (item.section !== null) params.set('section', String(item.section));
        }
    }
    params.set('line', String(item.startLine));
    return '/api/v1/search/knowledge/open?' + params;
}

function wikiPage(repository: RepositoryIndex, actor: Account, target: z.infer<typeof wikiInput>) {
    authorizeRepositoryScope(repository, actor, target);
    const base = repository.wiki.getBase(target.pageId);
    if (!base?.knowledgeSnapshotId || base.projectId !== target.projectId
        || (target.snapshotId && target.snapshotId !== base.knowledgeSnapshotId)) throw new HttpError(404, 'WIKI_PAGE_NOT_FOUND');
    const snapshotId = authorizeRepositoryScope(repository, actor, target, base.knowledgeSnapshotId)!;
    const page = repository.wiki.pages.resolve(base, target.revisionId);
    return { page, snapshotId, revisionId: page.revision?.id ?? page.id };
}

function knowledgePlan(repository: RepositoryIndex, actor: Account, input: Input) {
    repository.identity.requireCurrent(actor);
    const verify: (() => void)[] = [];
    const sources: RepositoryScope[] = [];
    const pages = new Map<string, Pages>();
    const docs = new Map<string, DocumentRef>();
    const defaults = new Map<string, string[]>();
    const missing = new Map<string, Origin>();
    const emptySpaces = new Set<string>();
    const checkedSources = new Set<string>();

    function checkSize() {
        if (pages.size + missing.size > 8 || docs.size > 24) throw new HttpError(400, 'KNOWLEDGE_SCOPE_TOO_LARGE');
    }

    function document(ref: DocumentRef) {
        if (docs.has(ref.versionId)) return;
        docs.set(ref.versionId, ref);
        checkSize();
        verify.push(() => repository.spaces.readableDocumentVersion(actor, ref.spaceId, ref.documentId, ref.versionId));
    }

    function recordPages(scope: RepositoryScope, snapshotId: string, revisions: string[]) {
        const group = pages.get(snapshotId) ?? { projectId: scope.projectId, snapshotId,
            origin: { direct: false, spaces: new Set<string>() }, revisions: new Map<string, Origin>() };
        addOrigin(group.origin, scope.spaceId);
        pages.set(snapshotId, group);
        checkSize();
        for (const revision of revisions) {
            const origin = group.revisions.get(revision) ?? { direct: false, spaces: new Set<string>() };
            addOrigin(origin, scope.spaceId);
            group.revisions.set(revision, origin);
        }
    }

    function repo(scope: RepositoryScope) {
        const snapshotId = authorizeRepositoryScope(repository, actor, scope)
            ?? repository.knowledgeSnapshots.list(scope.projectId, 1, 0)[0]?.id;
        const key = JSON.stringify([scope.projectId, snapshotId, scope.spaceId]);
        if (checkedSources.has(key)) return;
        checkedSources.add(key);
        verify.push(() => authorizeRepositoryScope(repository, actor, scope, snapshotId));
        if (!snapshotId) {
            const group = missing.get(scope.projectId) ?? { direct: false, spaces: new Set<string>() };
            addOrigin(group, scope.spaceId);
            missing.set(scope.projectId, group);
            checkSize();
            return;
        }
        sources.push({ projectId: scope.projectId, spaceId: scope.spaceId, snapshotId });
        const revisions = defaults.get(snapshotId)
            ?? repository.wiki.pages.references(scope.projectId, snapshotId).map(item => item.revisionId);
        defaults.set(snapshotId, revisions);
        recordPages(scope, snapshotId, revisions);
    }

    for (const target of input.scopes) {
        if (target.kind === 'repository') repo(target);
        else if (target.kind === 'wiki') {
            const resolved = wikiPage(repository, actor, target);
            verify.push(() => wikiPage(repository, actor, { ...target, revisionId: resolved.revisionId }));
            recordPages(target, resolved.snapshotId, [resolved.revisionId]);
        } else if (target.kind === 'document') {
            document(repository.spaces.readableDocumentVersion(actor, target.spaceId, target.documentId, target.versionId));
        } else {
            const space = repository.spaces.get(actor, target.spaceId);
            verify.push(() => repository.spaces.get(actor, target.spaceId));
            const files = repository.spaces.readableDocuments(actor, target.spaceId, 25);
            if (!space.repositories.length && !files.length) emptySpaces.add(target.spaceId);
            for (const link of space.repositories) repo({ projectId: link.projectId, spaceId: target.spaceId, snapshotId: link.snapshotId ?? undefined });
            for (const file of files) document(file);
        }
    }
    return { verify, sources, pages, docs, missing, emptySpaces };
}

export async function searchKnowledge(repository: RepositoryIndex, actor: Account, input: Input, signal?: AbortSignal) {
    const plan = knowledgePlan(repository, actor, input);
    const hits: Preview[] = [];
    const coverage: Coverage[] = [];
    for (const [projectId, origin] of plan.missing) {
        for (const kind of ['SOURCE', 'WIKI'] as const) coverage.push({
            kind, projectId, snapshotId: null, spaceIds: [...origin.spaces].sort(), direct: origin.direct,
            status: 'INDEX_UNAVAILABLE', omissions: ['NO_PUBLISHED_SNAPSHOT']
        });
    }
    for (const spaceId of plan.emptySpaces) coverage.push({ kind: 'SPACE', spaceIds: [spaceId], status: 'NO_MATCHES', omissions: [] });

    if (plan.sources.length) {
        const result = await scopedSearch(repository, actor, { ...input, scopes: plan.sources }, signal);
        coverage.push(...result.coverage.map(item => ({ kind: 'SOURCE' as const, ...item })));
        for (const hit of result.results) {
            const { unit, projectId, snapshotId, spaceIds, direct, score, methods } = hit;
            if (!snapshotId) continue;
            const binary = unit.metadata.bytecode === 'true';
            const source = unit.rawSource || unit.signature;
            const excerpt = clipExcerpt(source);
            hits.push({ kind: 'SOURCE', projectId, snapshotId, spaceIds, direct, score, methods, excerpt, binary,
                truncated: excerpt.length !== source.length,
                unitId: unit.id, filePath: unit.filePath, archiveEntry: unit.metadata.archive_entry, title: unit.qualifiedName,
                startLine: unit.startLine, endLine: Math.min(unit.endLine, unit.startLine + (excerpt.match(/\r\n|\n|\r/g)?.length ?? 0)) });
        }
    }

    const terms = queryTerms(input.query);
    for (const group of plan.pages.values()) {
        signal?.throwIfAborted();
        const scope = { kind: 'WIKI' as const, projectId: group.projectId, snapshotId: group.snapshotId,
            spaceIds: [...group.origin.spaces].sort(), direct: group.origin.direct };
        if (!group.revisions.size) {
            coverage.push({ ...scope, status: 'INDEX_UNAVAILABLE', omissions: ['WIKI_NOT_PUBLISHED'] });
            continue;
        }
        const found: Preview[] = [];
        try {
            for (const page of repository.wiki.pages.matching(group.projectId, group.snapshotId, null, input.query, input.limit, [...group.revisions.keys()])) {
                const revisionId = page.revision?.id ?? page.id;
                const origin = group.revisions.get(revisionId)!;
                const selected = page.sections.findIndex(item => terms.some(term => (item.title + ' ' + item.body).toLowerCase().includes(term)));
                const index = selected >= 0 ? selected : page.sections.length ? 0 : null;
                const text = index === null ? '' : page.sections[index].body;
                found.push({ ...scope, pageId: page.id, revisionId, perspective: page.perspective ?? 'technical', section: index,
                    title: page.title, ...queryExcerpt(text, terms), spaceIds: [...origin.spaces].sort(),
                    direct: origin.direct, score: rankScore(found.length + 1), methods: ['KEYWORD'] });
            }
            hits.push(...found);
            coverage.push({ ...scope, status: found.length ? 'MATCHED' : 'NO_MATCHES', omissions: [] });
        } catch (error) {
            if (error instanceof HttpError) throw error;
            coverage.push({ ...scope, status: 'QUERY_FAILED', omissions: ['WIKI_RETRIEVAL_FAILED'] });
        }
    }

    if (plan.docs.size) {
        const documentHits: Preview[] = [];
        const documents = [...plan.docs.values()];
        try {
            const matched = repository.spaces.findDocumentVersions([...plan.docs.keys()], input.query, plan.docs.size);
            for (const [rank, version] of matched.entries()) {
                const ref = plan.docs.get(version)!;
                const file = repository.spaces.readDocument(actor, ref.spaceId, ref.documentId, ref.versionId);
                const page = file.pdfPages && bestPdfPage(file.pdfPages, terms);
                const pageText = page === undefined ? undefined : file.pdfPages![page - 1];
                const cell = file.csvRows && bestCsvCell(file.csvRows, terms);
                const cellText = cell ? file.csvRows?.[cell.row - 1][cell.column - 1] : undefined;
                const excerpt = queryExcerpt(cellText ?? pageText?.text ?? file.markdown, terms);
                documentHits.push({ kind: 'DOCUMENT', ...ref, spaceIds: [ref.spaceId], direct: true, title: file.name,
                    score: rankScore(rank + 1), methods: ['KEYWORD'], ...excerpt, ...(page && { page }),
                    ...(cell && { cell, startLine: cell.row, endLine: cell.row }),
                    truncated: excerpt.truncated || !!pageText?.truncated });
            }
            hits.push(...documentHits);
            for (const ref of documents) coverage.push({ kind: 'DOCUMENT', ...ref, spaceIds: [ref.spaceId], direct: true,
                status: matched.includes(ref.versionId) ? 'MATCHED' : 'NO_MATCHES', omissions: [] });
        } catch (error) {
            if (error instanceof HttpError) throw error;
            for (const ref of documents) coverage.push({ kind: 'DOCUMENT', ...ref, spaceIds: [ref.spaceId], direct: true,
                status: 'QUERY_FAILED', omissions: ['DOCUMENT_RETRIEVAL_FAILED'] });
        }
    }

    signal?.throwIfAborted();
    repository.identity.requireCurrent(actor);
    for (const check of plan.verify) check();
    const successes = coverage.filter(item => item.status === 'MATCHED' || item.status === 'NO_MATCHES').length;
    const status = !successes ? 'FAILED' : successes === coverage.length ? 'COMPLETE' : 'PARTIAL';
    const unique = new Map<string, Hit>();
    for (const preview of hits) {
        const link = resultLink(preview);
        const existing = unique.get(link);
        if (!existing || preview.score > existing.score) unique.set(link, { ...preview, link });
    }
    const results = [...unique.values()].sort((a, b) => b.score - a.score || a.link.localeCompare(b.link));
    return { status, method: input.method, coverage, results: results.slice(0, input.limit) };
}

const openRepository = scopedRepository.extend({ snapshotId: scopedUuid, line: z.coerce.number().int().nonnegative() });
export const knowledgeOpenInput = z.discriminatedUnion('kind', [
    openRepository.extend({ kind: z.literal('source'), file: z.string().min(1).max(4096), unitId: z.string().regex(/^[a-f0-9]{64}$/),
        archiveEntry: z.string().min(1).max(4096).optional() }),
    openRepository.extend({ kind: z.literal('wiki'), pageId: scopedUuid, revisionId: scopedUuid, section: z.coerce.number().int().nonnegative().optional() }),
    documentInput.extend({ versionId: scopedUuid, line: z.coerce.number().int().positive(), page: z.coerce.number().int().positive().optional(),
        row: z.coerce.number().int().positive().optional(), column: z.coerce.number().int().positive().optional() })
]);

export function openKnowledge(repository: RepositoryIndex, actor: Account, target: z.infer<typeof knowledgeOpenInput>) {
    if (target.kind === 'document') {
        const { row, column, page } = target;
        if ((row === undefined) !== (column === undefined) || (page !== undefined && row !== undefined)) {
            throw new HttpError(400, 'DOCUMENT_POSITION_INVALID');
        }
        if (page === undefined && row === undefined) repository.spaces.readableDocumentVersion(actor, target.spaceId, target.documentId, target.versionId);
        else {
            const document = repository.spaces.readDocument(actor, target.spaceId, target.documentId, target.versionId);
            if (page !== undefined && !document.pdfPages?.[page - 1]) throw new HttpError(404, 'PDF_PAGE_NOT_FOUND');
            if (row !== undefined && column !== undefined && document.csvRows?.[row - 1]?.[column - 1] === undefined) {
                throw new HttpError(404, 'CSV_CELL_NOT_FOUND');
            }
        }
        return '/?' + new URLSearchParams({ view: 'spaces', space: target.spaceId, item: target.documentId,
            revision: target.versionId, line: String(target.line), ...(page === undefined ? {} : { page: String(page) }),
            ...(row === undefined ? {} : { row: String(row), column: String(column) }) });
    }
    if (target.kind === 'wiki') {
        const { page, revisionId, snapshotId } = wikiPage(repository, actor, target);
        if (target.section !== undefined && !page.sections[target.section]) throw new HttpError(404, 'WIKI_SECTION_NOT_FOUND');
        return '/?' + new URLSearchParams({ view: 'wiki', project: target.projectId, snapshotId, document: target.pageId, revisionId,
            ...(target.section === undefined ? {} : { section: String(target.section) }), line: String(target.line) });
    }
    const snapshotId = authorizeRepositoryScope(repository, actor, target)!;
    const unit = repository.knowledgeSnapshots.readUnit(snapshotId, target.unitId);
    if (!unit || unit.filePath !== target.file || unit.metadata.archive_entry !== target.archiveEntry
        || target.line < unit.startLine || target.line > unit.endLine) throw new HttpError(404, 'SOURCE_LOCATION_NOT_FOUND');
    return '/?' + new URLSearchParams({ view: 'graph', project: target.projectId, snapshotId,
        ...(target.line > 0 ? { file: target.file, line: String(target.line), symbol: unit.qualifiedName } : { target: target.unitId }),
        ...(target.archiveEntry ? { archiveEntry: target.archiveEntry } : {}) });
}
