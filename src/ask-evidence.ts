import { z } from 'zod';
import { askAttachmentInput, askAttachmentLimits } from './ask-attachments.js';
import type { AskAttachments, FrozenAttachment } from './ask-attachments.js';
import { bestCsvCell, csvCell } from './csv-document.js';
import type { CsvCell } from './csv-document.js';
import { HttpError } from './http-error.js';
import type { Account } from './identity.js';
import type { RepositoryIndex } from './index.js';
import { clipExcerpt, lineExcerpt, matchedLine, queryTerms } from './knowledge-excerpts.js';
import { bestPdfPage } from './pdf-text.js';
import type { PdfPageText } from './pdf-text.js';
import { authorizeRepositoryScope, scopedRepository, scopedSearch, scopedUuid } from './scoped-retrieval.js';
import type { RepositoryScope } from './scoped-retrieval.js';
import type { SummaryDocument } from './wiki.js';

const maxRepositories = 8;
const maxDocuments = 24;
const maxEvidence = 14;
const projectId = scopedRepository.shape.projectId;
const path = z.string().max(4096).refine(value => value === '' || value.split('/').every(part =>
    !!part && part !== '.' && part !== '..' && !/[\\\x00-\x1f\x7f]/.test(part)));
const reviewRef = z.strictObject({ projectId, reviewId: scopedUuid, findingId: z.string().regex(/^[a-f0-9]{64}$/).optional() });
type ReviewRef = z.infer<typeof reviewRef>;

export const askSessionInput = z.object({
    scopes: z.array(z.union([scopedRepository, z.object({ spaceId: scopedUuid }).strict(),
        z.object({ spaceId: scopedUuid, documentId: scopedUuid, versionId: scopedUuid.optional() }).strict()])).max(8).default([]),
    attachments: z.array(askAttachmentInput).max(askAttachmentLimits.files).optional(),
    review: reviewRef.optional(),
    allowPartialSpaces: z.boolean().default(false), lifetimeDays: z.int().min(1).max(30).default(14),
    title: z.string().trim().min(1).max(150).optional()
}).strict().refine(value => value.review ? !value.scopes.length && !value.attachments?.length : value.scopes.length > 0 || Boolean(value.attachments?.length));

export const askTurnInput = z.object({
    question: z.string().trim().min(1).max(4096).refine(value => !value.includes('\0')),
    context: z.array(z.union([
        z.object({ projectId, snapshotId: scopedUuid.optional(), path, directory: z.boolean().default(false),
            line: z.int().min(1).max(2_000_000).default(1) }).strict(),
        z.object({ projectId, snapshotId: scopedUuid.optional(), wikiId: scopedUuid, revisionId: scopedUuid.optional() }).strict(),
        z.object({ spaceId: scopedUuid, documentId: scopedUuid, versionId: scopedUuid.optional(),
            line: z.int().min(1).max(2_000_000).default(1), page: z.int().min(1).max(180).optional(), cell: csvCell.optional() })
            .strict().refine(ref => ref.page === undefined || !ref.cell),
        z.object({ attachmentId: scopedUuid, versionId: scopedUuid,
            line: z.int().min(1).max(2_000_000).default(1), page: z.int().min(1).max(180).optional() }).strict()
    ])).max(4).default([]),
    timeoutMs: z.int().min(1000).max(120_000).default(90_000)
}).strict();

export type AskSessionInput = z.infer<typeof askSessionInput>;
export type AskTurnInput = z.infer<typeof askTurnInput>;
type FrozenRepository = RepositoryScope & { snapshotId: string };
type FrozenDocument = { spaceId: string; documentId: string; versionId: string };
export type AskScope = { repositories: FrozenRepository[]; documents: FrozenDocument[]; spaces: string[]; omittedSpaces: number;
    unavailableRepositories: number; wikiRevisions?: Record<string, { pageId: string; revisionId: string }[]>;
    attachments?: FrozenAttachment[]; review?: ReviewRef };
type AttachmentScope = { sessionId: string; store: AskAttachments };

type CitationSource = { kind: 'SOURCE'; projectId: string; snapshotId: string; path: string; archiveEntry?: string; symbol?: string } |
    { kind: 'DOCUMENT'; spaceId: string; documentId: string; versionId: string; page?: number; cell?: CsvCell } |
    { kind: 'ATTACHMENT'; attachmentId: string; versionId: string; page?: number } |
    ({ kind: 'CHANGE_REVIEW'; anchor: string } & ReviewRef) |
    { kind: 'WIKI'; projectId: string; snapshotId: string; wikiId: string; revision: number; revisionId: string; section: string };
type Excerpt = CitationSource & { title: string; excerpt: string; startLine: number; endLine: number; spaceIds?: string[] };
export type AskCitation = Excerpt & { id: string };

export function freezeAskScope(repository: RepositoryIndex, actor: Account, input: AskSessionInput): AskScope {
    if (input.review) {
        readReview(repository, actor, input.review);
        return { repositories: [], documents: [], spaces: [], omittedSpaces: 0, unavailableRepositories: 0, review: input.review };
    }
    const repositories = new Map<string, FrozenRepository>();
    const documents = new Map<string, FrozenDocument>();
    const spaces = new Set<string>();
    let omittedSpaces = 0;
    let unavailableRepositories = 0;
    function addRepo(ref: RepositoryScope, optional: boolean) {
        const snapshotId = authorizeRepositoryScope(repository, actor, ref) ?? repository.knowledgeSnapshots.list(ref.projectId, 1, 0)[0]?.id;
        if (!snapshotId) {
            if (!optional) throw new HttpError(409, 'ASK_PUBLISHED_SNAPSHOT_REQUIRED');
            unavailableRepositories++;
            return;
        }
        repositories.set(JSON.stringify([ref.projectId, snapshotId, ref.spaceId]), { ...ref, snapshotId });
    }
    for (const ref of input.scopes) {
        if ('projectId' in ref) { addRepo(ref, false); continue; }
        if ('documentId' in ref) {
            const document = repository.spaces.readableDocumentVersion(actor, ref.spaceId, ref.documentId, ref.versionId);
            documents.set(document.versionId, document);
            continue;
        }
        let space: ReturnType<RepositoryIndex['spaces']['get']>;
        try { space = repository.spaces.get(actor, ref.spaceId); }
        catch (error) {
            if (!input.allowPartialSpaces || !(error instanceof HttpError) || ![403, 404].includes(error.status)) throw error;
            omittedSpaces++;
            continue;
        }
        spaces.add(ref.spaceId);
        for (const link of space.repositories) addRepo({ projectId: link.projectId, spaceId: ref.spaceId, snapshotId: link.snapshotId ?? undefined }, true);
        for (const document of repository.spaces.readableDocuments(actor, ref.spaceId, maxDocuments + 1)) documents.set(document.versionId, document);
    }
    if (repositories.size > maxRepositories || documents.size > maxDocuments) throw new HttpError(400, 'ASK_SCOPE_TOO_LARGE');
    if (!repositories.size && !documents.size && !input.attachments?.length) throw new HttpError(409, 'ASK_SCOPE_EMPTY');
    const wikiRevisions: NonNullable<AskScope['wikiRevisions']> = {};
    for (const ref of repositories.values()) {
        wikiRevisions[ref.snapshotId] ??= repository.wiki.pages.references(ref.projectId, ref.snapshotId);
    }
    return { repositories: [...repositories.values()], documents: [...documents.values()], spaces: [...spaces], omittedSpaces,
        unavailableRepositories, wikiRevisions };
}

export function authorizeAskScope(repository: RepositoryIndex, actor: Account, scope: AskScope) {
    if (scope.review) readReview(repository, actor, scope.review);
    for (const id of scope.spaces) repository.spaces.get(actor, id);
    for (const ref of scope.repositories) authorizeRepositoryScope(repository, actor, ref);
    for (const ref of scope.documents) repository.spaces.readableDocumentVersion(actor, ref.spaceId, ref.documentId, ref.versionId);
}

export function askProjectIds(scope: AskScope) {
    return scope.review ? [scope.review.projectId] : [...new Set(scope.repositories.map(item => item.projectId))];
}

function readReview(repository: RepositoryIndex, actor: Account, ref: ReviewRef) {
    repository.identity.requireProjectReader(actor, ref.projectId);
    const report = repository.changeReviews.get(ref.reviewId, ref.projectId);
    if (!report) throw new HttpError(404, 'CHANGE_REVIEW_NOT_FOUND');
    const finding = ref.findingId ? report.structuredFindings?.find(item => item.id === ref.findingId) : undefined;
    if (ref.findingId && !finding) throw new HttpError(404, 'CHANGE_REVIEW_FINDING_NOT_FOUND');
    return { report, finding };
}

function reviewEvidence(repository: RepositoryIndex, actor: Account, ref: ReviewRef, question: string) {
    const { report, finding } = readReview(repository, actor, ref);
    const excerpt = (anchor: string, title: string, text: string, startLine: number, endLine: number): Excerpt =>
        ({ kind: 'CHANGE_REVIEW', ...ref, anchor, title, excerpt: clipExcerpt(text), startLine, endLine });
    const source = report.provenance;
    const prefix = ['Review ' + report.id, 'Status ' + report.status, 'Scope ' + (source?.scope ?? 'UNVERIFIED'),
        'Base ' + (source?.baseSnapshotId ?? report.baseVersion), 'Target ' + (source?.targetSnapshotId ?? report.targetVersion),
        ...(source?.scope === 'WORKING_COPY_OVERLAY' ? ['Overlay ' + source.overlayDigest] : [])];
    const evidence = [excerpt('report', 'Change review', [...prefix,
        `Planned hunks ${report.plannedHunkCount} of ${report.totalHunkCount}`,
        ...report.omittedReasons.map(reason => 'Omitted ' + reason)].join('\n'), 1, 1)];
    if (finding) evidence.push(excerpt('finding', finding.ruleId,
        [finding.tool, finding.ruleId, finding.severity, finding.versionEvidence, finding.snapshotId, finding.publishability,
            `${finding.location.path}:${finding.location.startLine}-${finding.location.endLine}`].join('\n'), finding.location.startLine, finding.location.endLine));
    const unitIds = new Set(finding?.evidence.map(item => item.unitId) ?? []);
    const terms = queryTerms(question);
    const candidates = report.units.filter(item => !finding || unitIds.has(item.unit.id));
    const matches = candidates.filter(({ unit }) => terms.some(term => unit.filePath.toLowerCase().includes(term)));
    for (const item of (matches.length ? matches : candidates).slice(0, 4)) {
        const references = item.contextPack.evidence.filter(candidate => candidate.projectId === ref.projectId).slice(0, 2);
        for (const candidate of references) evidence.push(excerpt(`${item.unit.id}:${candidate.citationId}`, candidate.filePath,
            candidate.excerpt, candidate.startLine, candidate.endLine));
    }
    return evidence;
}

function references(scope: AskScope, id: string, snapshotId?: string) {
    const matches = scope.repositories.filter(ref => ref.projectId === id && (!snapshotId || ref.snapshotId === snapshotId));
    if (!matches.length) throw new HttpError(403, 'ASK_CONTEXT_OUTSIDE_SCOPE');
    if (new Set(matches.map(ref => ref.snapshotId)).size !== 1) throw new HttpError(409, 'ASK_CONTEXT_VERSION_REQUIRED');
    return { snapshotId: matches[0].snapshotId, spaceIds: [...new Set(matches.flatMap(ref => ref.spaceId ? [ref.spaceId] : []))].sort() };
}

function wikiSections(doc: SummaryDocument, spaceIds: string[]): Excerpt[] {
    const { title, projectId, id: wikiId, knowledgeSnapshotId: snapshotId } = doc;
    if (!snapshotId) return [];
    return doc.sections.map(section => ({ kind: 'WIKI', title, projectId, snapshotId, wikiId,
        section: section.title, revision: doc.revision?.number ?? 1, revisionId: doc.revision?.id ?? doc.id,
        spaceIds, ...lineExcerpt(section.body, 1) }));
}

function documentEvidence(repository: RepositoryIndex, actor: Account, ref: FrozenDocument, line: number, query?: string,
    page?: number, requestedCell?: CsvCell): Excerpt {
    const document = repository.spaces.readDocument(actor, ref.spaceId, ref.documentId, ref.versionId);
    if (requestedCell || document.csvRows && page === undefined) {
        const rows = document.csvRows ?? [];
        const cell = requestedCell ?? (query ? bestCsvCell(rows, queryTerms(query)) : (rows[line - 1] ? { row: line, column: 1 } : undefined));
        const value = cell && rows[cell.row - 1]?.[cell.column - 1];
        if (requestedCell && value === undefined) throw new HttpError(400, 'ASK_CONTEXT_CELL_OUT_OF_RANGE');
        if (cell && value !== undefined) return { kind: 'DOCUMENT', ...ref, title: document.name,
            cell, startLine: cell.row, endLine: cell.row, excerpt: clipExcerpt(value) };
    }
    return { kind: 'DOCUMENT', ...ref, title: document.name, ...textEvidence(document.markdown, document.pdfPages, line, query, page) };
}

function textEvidence(text: string, pages: PdfPageText[] | undefined, line: number, query?: string, page?: number) {
    page ??= pages && bestPdfPage(pages, query ? queryTerms(query) : []);
    const pdfPage = page === undefined ? undefined : pages?.[page - 1];
    if (page !== undefined && !pdfPage) throw new HttpError(400, 'ASK_CONTEXT_PAGE_OUT_OF_RANGE');
    const source = pdfPage?.text ?? text;
    if (query) line = matchedLine(source, query);
    return { ...(page !== undefined && { page }), ...lineExcerpt(source, line) };
}

export function readAskContext(repository: RepositoryIndex, actor: Account, scope: AskScope, input: AskTurnInput['context'],
    attachments: AttachmentScope) {
    return input.flatMap((ref): Excerpt[] => {
        if ('attachmentId' in ref) {
            if (!scope.attachments?.some(item => item.attachmentId === ref.attachmentId && item.versionId === ref.versionId)) {
                throw new HttpError(403, 'ASK_CONTEXT_OUTSIDE_SCOPE');
            }
            const file = attachments.store.read(attachments.sessionId, ref.attachmentId, ref.versionId);
            return [{ kind: 'ATTACHMENT', attachmentId: file.attachmentId, versionId: file.versionId,
                title: file.name, ...textEvidence(file.text, file.pdfPages, ref.line, undefined, ref.page) }];
        }
        if ('documentId' in ref) {
            const matching = scope.documents.filter(doc => doc.spaceId === ref.spaceId && doc.documentId === ref.documentId
                && (!ref.versionId || ref.versionId === doc.versionId));
            if (!matching.length) throw new HttpError(403, 'ASK_CONTEXT_OUTSIDE_SCOPE');
            if (matching.length > 1) throw new HttpError(409, 'ASK_CONTEXT_VERSION_REQUIRED');
            return [documentEvidence(repository, actor, matching[0], ref.line, undefined, ref.page, ref.cell)];
        }
        const doc = 'wikiId' in ref ? repository.wiki.getBase(ref.wikiId) : undefined;
        const source = references(scope, ref.projectId, ref.snapshotId ?? doc?.knowledgeSnapshotId);
        if ('wikiId' in ref) {
            if (!doc || doc.projectId !== ref.projectId || doc.knowledgeSnapshotId !== source.snapshotId) {
                throw new HttpError(403, 'ASK_CONTEXT_OUTSIDE_SCOPE');
            }
            const frozen = scope.wikiRevisions?.[source.snapshotId]?.find(item => item.pageId === doc.id);
            if (scope.wikiRevisions && !frozen) throw new HttpError(403, 'ASK_CONTEXT_OUTSIDE_SCOPE');
            const revisionId = frozen?.revisionId ?? doc.id;
            if (ref.revisionId && ref.revisionId !== revisionId) throw new HttpError(403, 'ASK_CONTEXT_OUTSIDE_SCOPE');
            return wikiSections(repository.wiki.pages.resolve(doc, revisionId), source.spaceIds).slice(0, 3);
        }
        if (!ref.path && !ref.directory) throw new HttpError(400, 'ASK_CONTEXT_PATH_REQUIRED');
        const paths = ref.directory ? repository.knowledgeSnapshots.sourcePaths(source.snapshotId, ref.path, 4) : [ref.path];
        if (!paths.length) throw new HttpError(404, 'ASK_CONTEXT_NOT_FOUND');
        return paths.flatMap(file => {
            const entry = repository.knowledgeSnapshots.source(source.snapshotId, file);
            if (!entry) throw new HttpError(404, 'ASK_CONTEXT_NOT_FOUND');
            if (entry.text === null) {
                if (!ref.directory) throw new HttpError(409, 'ASK_CONTEXT_BINARY');
                return [];
            }
            return [{ kind: 'SOURCE', projectId: ref.projectId, ...source, path: file, title: file,
                ...lineExcerpt(entry.text, ref.directory ? 1 : ref.line) }];
        });
    });
}

function evidenceKey(item: Excerpt) {
    if (item.kind === 'SOURCE') return JSON.stringify([item.kind, item.projectId, item.snapshotId, item.path, item.archiveEntry,
        item.startLine, item.endLine]);
    if (item.kind === 'WIKI') return JSON.stringify([item.kind, item.wikiId, item.section, item.revisionId]);
    if (item.kind === 'ATTACHMENT') return JSON.stringify([item.kind, item.attachmentId, item.versionId, item.page, item.startLine, item.endLine]);
    if (item.kind === 'CHANGE_REVIEW') return JSON.stringify([item.kind, item.reviewId, item.findingId, item.anchor]);
    return JSON.stringify([item.kind, item.spaceId, item.documentId, item.versionId, item.page, item.cell, item.startLine, item.endLine]);
}

export async function retrieveAskEvidence(repository: RepositoryIndex, actor: Account, scope: AskScope, input: AskTurnInput, signal: AbortSignal,
    attachments: AttachmentScope, priorEvidence?: AskCitation[]) {
    const reserved = readAskContext(repository, actor, scope, input.context, attachments);
    const review = scope.review && reviewEvidence(repository, actor, scope.review, input.question);
    const search = scope.repositories.length ? await scopedSearch(repository, actor, {
        query: input.question, scopes: scope.repositories, method: 'hybrid', noTest: true, limit: 10
    }, signal) : undefined;
    signal.throwIfAborted();
    const code: Excerpt[] = (search?.results ?? []).flatMap(item => {
        if (!item.snapshotId || item.unit.startLine <= 0 || !item.unit.rawSource.trim()) return [];
        const excerpt = clipExcerpt(item.unit.rawSource);
        const endLine = Math.min(item.unit.endLine, item.unit.startLine + (excerpt.match(/\r\n|\n|\r/g)?.length ?? 0));
        return [{ kind: 'SOURCE', projectId: item.projectId, snapshotId: item.snapshotId, title: item.unit.qualifiedName,
            path: item.unit.filePath, archiveEntry: item.unit.metadata.archive_entry, symbol: item.unit.qualifiedName,
            spaceIds: item.spaceIds, startLine: item.unit.startLine, endLine, excerpt }];
    });
    const documentIds = repository.spaces.findDocumentVersions(scope.documents.map(item => item.versionId), input.question, 5);
    const docs = documentIds.map(id => documentEvidence(repository, actor, scope.documents.find(item => item.versionId === id)!, 1, input.question));
    const matches: Excerpt[] = scope.attachments?.length ? attachments.store.matching(attachments.sessionId, input.question, 5)
        .filter(file => scope.attachments?.some(ref => ref.attachmentId === file.attachmentId && ref.versionId === file.versionId))
        .map(file => ({ kind: 'ATTACHMENT', attachmentId: file.attachmentId, versionId: file.versionId, title: file.name,
            ...textEvidence(file.text, file.pdfPages, 1, input.question) })) : [];
    const wikis: Excerpt[] = [];
    const searched = new Set<string>();
    for (const ref of scope.repositories) {
        if (searched.has(ref.snapshotId)) continue;
        searched.add(ref.snapshotId);
        const spaceIds = scope.repositories.filter(item => item.snapshotId === ref.snapshotId).flatMap(item => item.spaceId ? [item.spaceId] : []);
        const frozen = scope.wikiRevisions?.[ref.snapshotId] ?? repository.wiki.pages.references(ref.projectId, ref.snapshotId, true);
        const pages = repository.wiki.pages.search(ref.projectId, ref.snapshotId, null, input.question, 3, frozen.map(item => item.revisionId));
        const terms = input.question.toLowerCase().match(/[\p{L}\p{N}_]+/gu)?.filter(term => term.length > 2).slice(0, 12) ?? [];
        for (const page of pages) {
            const sections = wikiSections(page, spaceIds);
            const matching = sections.filter(item =>
                terms.some(term => (item.title + ' ' + item.excerpt).toLowerCase().includes(term)));
            wikis.push(...(matching.length ? matching : sections).slice(0, 2));
            if (wikis.length >= 4) break;
        }
        if (wikis.length >= 4) break;
    }
    const selected = new Map<string, Excerpt>();
    for (const item of [...reserved, ...(review ?? []), ...matches, ...docs, ...wikis.slice(0, 4), ...code]) {
        if (item.excerpt.trim() && !selected.has(evidenceKey(item))) selected.set(evidenceKey(item), item);
        if (selected.size >= maxEvidence) break;
    }
    let carriedCitations = 0;
    if (!selected.size && !input.context.length && priorEvidence?.length) {
        authorizeAskScope(repository, actor, scope);
        attachments.store.requireFrozen(attachments.sessionId, scope.attachments ?? []);
        for (const item of priorEvidence) {
            if (item.excerpt.trim()) selected.set(evidenceKey(item), item);
        }
        carriedCitations = selected.size;
    }
    return { citations: [...selected.values()].map((item, index) => ({ ...item, id: 'E' + (index + 1) })),
        coverage: { repositories: search?.coverage ?? [], documents: scope.documents.length, documentMatches: docs.length,
            ...(scope.review ? { reviewId: scope.review.reviewId } : {}),
            ...(scope.attachments?.length ? { attachments: scope.attachments.length, attachmentMatches: matches.length } : {}),
            ...(carriedCitations ? { carriedCitations } : {}),
            omittedSpaces: scope.omittedSpaces, unavailableRepositories: scope.unavailableRepositories },
        partial: Boolean(scope.omittedSpaces || scope.unavailableRepositories || (search && search.status !== 'COMPLETE')) };
}
