import { z } from 'zod';
import { redactChangeHunk, snapshotIdPattern } from './change-review.js';
import type { ChangeSnapshot } from './change-review.js';
import { findingPublicText } from './finding-import.js';
import { relativeEvidencePath } from './project-file.js';
import { isSensitiveReviewPath, redactReviewText } from './review-redaction.js';
import { digest } from './source.js';
import type { DiffHunk } from './unified-diff.js';

const id = z.string().regex(snapshotIdPattern);
const project = z.string().regex(/^[a-f0-9]{12}$/);
const status = z.enum(['COMPLETED', 'PARTIAL', 'FAILED']);
const mapping = z.enum(['MAPPED', 'UNMAPPED', 'OMITTED']);
const date = z.iso.datetime({ offset: true });
const text = z.string();
const empty = text.nullish().transform(value => value ?? '');
const nonnegative = z.number().int().min(0).max(2_147_483_647);
const positive = nonnegative.min(1);
const index = nonnegative.nullish().transform(value => value ?? null);
const names = z.array(text).nullish().transform(value => value ?? []);
const localId = text.regex(/^[a-zA-Z0-9_.:-]{1,180}$/);
const hunk = z.object({ oldStart: nonnegative, oldCount: nonnegative, newStart: nonnegative, newCount: nonnegative,
    header: text, lines: z.array(text.refine(line => !line.includes('\n'))) });
const file = z.object({ oldPath: empty, newPath: empty, kind: z.enum(['ADDED', 'MODIFIED', 'DELETED', 'RENAMED', 'BINARY']),
    hunks: z.array(hunk), errors: names, hunkCandidates: z.array(z.object({ ordinal: positive, hunkIndex: index, error: empty })).optional() });
const range = z.object({ startLine: positive, endLine: positive }).refine(item => item.endLine >= item.startLine);
const context = z.object({
    query: empty, taskType: empty, omittedReasons: names, requestedBudgetChars: nonnegative, usedBudgetChars: nonnegative,
    seedCount: nonnegative, keywordSeedCount: nonnegative.default(0), callGraphExpanded: nonnegative, impactExpanded: nonnegative,
    evidence: z.array(z.object({ citationId: localId, qualifiedName: empty, kind: empty, language: empty, filePath: empty,
        startLine: nonnegative, endLine: nonnegative, source: empty, relation: empty, finalScore: z.number(),
        excerpt: empty, truncated: z.boolean(), securitySignals: names }))
});
const unit = z.object({ unit: z.object({ id: localId, filePath: empty, hunks: z.array(hunk), estimatedChars: nonnegative }),
    status: mapping, qualifiedName: empty, contextPack: context.nullish(), externalFindingReferences: names, vulnerabilityReferences: names,
    omittedReasons: names, hunkMappings: z.array(z.object({ hunkIndex: nonnegative, status: mapping, changedRanges: z.array(range),
        qualifiedNames: names, omittedReasons: names })).default([]) });
const ledger = z.object({ fileIndex: positive, hunkOrdinal: positive, oldPath: empty, newPath: empty, parsedHunkIndex: index,
    unitId: empty, unitHunkIndex: index, disposition: z.enum(['PLANNED', 'OMITTED']), reason: empty });
const requestConfig = z.object({ maxUnits: positive, requestedBudgetChars: positive, effectiveBudgetChars: positive,
    maxHunksPerUnit: positive, maxContextReferences: positive });
const document = z.object({ id, projectId: project, status, baseVersion: empty, targetVersion: empty, source: empty, generatedAt: date,
    files: z.array(file), units: z.array(unit), omittedReasons: names, hunkLedger: z.array(ledger).nullish(), requestConfig: requestConfig.nullish() });
export const legacyChangeReview = z.object({ id, project_id: project, generated_at: date, status, payload: text.max(20_000_000) });

const publicText = (value: string) => findingPublicText(value, 1500);
const publicPath = (value: string) => findingPublicText(relativeEvidencePath(value), 4096);
const missingPath = 'LEGACY_CHANGE_PATH_UNAVAILABLE';
const noMapping = 'LEGACY_CHANGE_HUNK_MAPPING_UNAVAILABLE';
const emptyPack: NonNullable<z.infer<typeof unit>['contextPack']> = {
    query: '', taskType: 'change-review', omittedReasons: [], requestedBudgetChars: 0, usedBudgetChars: 0, seedCount: 0,
    keywordSeedCount: 0, callGraphExpanded: 0, impactExpanded: 0, evidence: []
};

function fingerprint(path: string, hunk: DiffHunk) {
    return digest(JSON.stringify([path, hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount, hunk.header, hunk.lines]));
}

function recoverLedger(input: z.infer<typeof document>, files: ChangeSnapshot['files']): ChangeSnapshot['hunkLedger'] {
    const placements = new Map<string, { unitId: string; unitHunkIndex: number } | null>();
    for (const { unit } of input.units) {
        const path = relativeEvidencePath(unit.filePath);
        if (!path) continue;
        for (const [unitHunkIndex, hunk] of unit.hunks.entries()) {
            const key = fingerprint(path, hunk);
            placements.set(key, placements.has(key) ? null : { unitId: unit.id, unitHunkIndex });
        }
    }
    const occurrences = new Map<string, number>();
    const candidates = files.flatMap((file, index) => file.hunkCandidates.map(candidate => {
        const original = input.files[index];
        const path = relativeEvidencePath(original.newPath || original.oldPath);
        const hunk = candidate.hunkIndex === null ? undefined : original.hunks[candidate.hunkIndex];
        const key = path && hunk && !candidate.error ? fingerprint(path, hunk) : '';
        if (key) occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
        return { file, index, candidate, key };
    }));
    return candidates.map(({ file, index, candidate, key }) => {
        const owner = occurrences.get(key) === 1 ? placements.get(key) : null;
        return { fileIndex: index + 1, hunkOrdinal: candidate.ordinal, oldPath: file.oldPath, newPath: file.newPath,
            parsedHunkIndex: candidate.hunkIndex, unitId: owner ? owner.unitId : '', unitHunkIndex: owner ? owner.unitHunkIndex : null,
            disposition: owner ? 'PLANNED' : 'OMITTED', reason: owner ? '' : candidate.error || noMapping };
    });
}

function restoreSnapshot(row: z.infer<typeof legacyChangeReview>, projectId: string): ChangeSnapshot {
    const input = document.parse(JSON.parse(row.payload));
    if (input.id !== row.id || input.projectId !== row.project_id || input.status !== row.status || input.generatedAt !== row.generated_at) {
        throw new Error('Legacy change review identity mismatch');
    }
    const omitted = new Set(input.omittedReasons.map(publicText));
    const sensitivePaths = new Set<string>();
    const files = input.files.map(file => {
        const oldPath = publicPath(file.oldPath), newPath = publicPath(file.newPath);
        const invalid = (!oldPath && !newPath) || (!!file.oldPath && !oldPath) || (!!file.newPath && !newPath);
        if (invalid) omitted.add(missingPath);
        const sensitive = invalid || isSensitiveReviewPath(oldPath) || isSensitiveReviewPath(newPath);
        if (sensitive) for (const path of [oldPath, newPath]) if (path) sensitivePaths.add(path);
        const candidates = file.hunkCandidates ?? file.hunks.map((_, hunkIndex) => ({ ordinal: hunkIndex + 1, hunkIndex, error: '' }));
        return { oldPath, newPath, kind: file.kind, hunks: file.hunks.map(hunk => redactChangeHunk(hunk, sensitive)),
            errors: [...file.errors.map(publicText), ...(invalid ? [missingPath] : [])],
            hunkCandidates: candidates.map(candidate => ({ ...candidate, error: publicText(candidate.error) })) };
    });
    const units = input.units.map(({ unit, contextPack, hunkMappings, status, qualifiedName, omittedReasons, ...references }) => {
        const path = publicPath(unit.filePath);
        if (!path) omitted.add(missingPath);
        const mustMask = (file: string) => !file || sensitivePaths.has(file) || isSensitiveReviewPath(file);
        const pack = contextPack ?? emptyPack;
        const evidence = pack.evidence.map(item => {
            const filePath = publicPath(item.filePath);
            if (!filePath) omitted.add(missingPath);
            return { ...item, projectId, filePath, qualifiedName: publicText(item.qualifiedName), kind: publicText(item.kind),
                language: publicText(item.language), relation: publicText(item.relation), source: publicText(item.source),
                excerpt: redactReviewText(item.excerpt, mustMask(filePath)), securitySignals: item.securitySignals.map(publicText) };
        });
        return { unit: { ...unit, filePath: path, hunks: unit.hunks.map(hunk => redactChangeHunk(hunk, mustMask(path))) },
            status, qualifiedName: publicText(qualifiedName), hunkMappings: hunkMappings.map(item => ({ ...item,
                qualifiedNames: item.qualifiedNames.map(publicText), omittedReasons: item.omittedReasons.map(publicText) })),
            contextPack: { ...pack, evidence, query: publicText(pack.query), taskType: publicText(pack.taskType),
                omittedReasons: pack.omittedReasons.map(publicText) },
            omittedReasons: omittedReasons.map(publicText), externalFindingReferences: [], vulnerabilityReferences: [],
            legacyReferences: { externalFindingFingerprints: references.externalFindingReferences.map(publicText).filter(Boolean),
                vulnerabilityIds: references.vulnerabilityReferences.map(publicText).filter(Boolean) } };
    });
    const hunkLedger = input.hunkLedger?.map(item => ({ ...item, oldPath: publicPath(item.oldPath), newPath: publicPath(item.newPath),
        unitId: publicText(item.unitId), reason: publicText(item.reason) })) ?? recoverLedger(input, files);
    if (hunkLedger.some(item => item.reason === noMapping)) omitted.add(noMapping);
    const omittedHunkCount = hunkLedger.filter(item => item.disposition === 'OMITTED').length;
    return { id: row.id, projectId, status: row.status, generatedAt: row.generated_at, schemaVersion: 1, legacyImported: true,
        baseVersion: publicText(input.baseVersion), targetVersion: publicText(input.targetVersion), source: publicText(input.source),
        files, units, hunkLedger, omittedReasons: [...omitted], omittedHunkCount, plannedHunkCount: hunkLedger.length - omittedHunkCount,
        totalHunkCount: hunkLedger.length, requestConfig: input.requestConfig ?? null, untrustedEvidence: true };
}

export function prepareLegacyChangeReviews(rows: z.infer<typeof legacyChangeReview>[], projects: ReadonlyMap<string, string>) {
    return rows.flatMap(row => {
        const projectId = projects.get(row.project_id);
        return projectId ? [restoreSnapshot(row, projectId)] : [];
    });
}
