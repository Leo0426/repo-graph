import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { RepositoryIndex } from './index.js';
import type { ExternalFindings } from './external-findings.js';
import type { VulnerabilityInventory } from './vulnerability-inventory.js';
import { contextPack } from './retrieval.js';
import { redactReviewText, isSensitiveReviewPath } from './review-redaction.js';
import { digest } from './source.js';
import type { CodeUnit } from './source.js';
import { parseDiff } from './unified-diff.js';
import type { DiffFile, DiffHunk } from './unified-diff.js';

const MAX_DIFF_CHARS = 2_000_000;
export const maxReviewRequestBytes = MAX_DIFF_CHARS * 6 + 16_384;
export const snapshotIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_CONTEXT_REFERENCES = 24;
const MAX_INDEX_LOOKUPS = 2048;
const MAX_UNIT_LOOKUPS = 256;
const limits = (limit: number, fallback: number) => z.number().int().min(0).max(limit).nullish().transform(value => value || fallback);
const metadata = (fallback: string) => z.string().max(256).nullish().transform(value => value?.trim() || fallback);
export const changeReviewInput = z.object({
    projectId: z.string().regex(/^[0-9a-f]{12}$/),
    diff: z.string().max(MAX_DIFF_CHARS).refine(value => !value.includes('\0')),
    baseVersion: metadata('unknown'), targetVersion: metadata('unknown'), source: metadata('caller'),
    maxUnits: limits(100, 20), budgetChars: limits(100_000, 12_000), maxHunksPerUnit: limits(100, 4)
});
type Input = z.infer<typeof changeReviewInput>;

interface HunkDisposition {
    fileIndex: number; hunkOrdinal: number; oldPath: string; newPath: string; parsedHunkIndex: number | null;
    unitId: string; unitHunkIndex: number | null; disposition: 'PLANNED' | 'OMITTED'; reason: string;
}
interface PlannedUnit { id: string; filePath: string; hunks: DiffHunk[]; estimatedChars: number }
interface WorkUnit { publicUnit: PlannedUnit; path: string; originalHunks: DiffHunk[]; sensitive: boolean; ledger: HunkDisposition[] }
interface HunkMapping {
    hunkIndex: number; status: 'MAPPED' | 'UNMAPPED' | 'OMITTED'; changedRanges: { startLine: number; endLine: number }[];
    qualifiedNames: string[]; omittedReasons: string[];
}

export function redactChangeHunk(hunk: DiffHunk, sensitive: boolean) {
    const marker = hunk.header.indexOf(' @@');
    const suffix = marker < 0 ? 0 : marker + 3;
    const header = sensitive ? hunk.header.slice(0, suffix) + redactReviewText(hunk.header.slice(suffix), true) : redactReviewText(hunk.header);
    const scrubbed = redactReviewText(hunk.lines.join('\n'), sensitive, true).split('\n');
    return { ...hunk, header, lines: hunk.lines.map((line, index) => line === '\\ No newline at end of file' ? line : scrubbed[index]) };
}

function plan(input: Input, files: DiffFile[], budget: number, omitted: Set<string>) {
    const units: WorkUnit[] = [];
    const hunkLedger: HunkDisposition[] = [];
    const publicFiles = files.map((file, index) => {
        const path = file.newPath || file.oldPath;
        const sensitive = isSensitiveReviewPath(file.oldPath) || isSensitiveReviewPath(file.newPath);
        const oldPath = redactReviewText(file.oldPath);
        const newPath = redactReviewText(file.newPath);
        const publicPath = newPath || oldPath;
        const hunks = file.hunks.map(hunk => redactChangeHunk(hunk, sensitive));
        const fileProblem = !path || file.errors.includes('INVALID_DIFF_PATH') ? 'INVALID_DIFF_PATH'
            : file.kind === 'BINARY' ? 'BINARY_CHANGE_NOT_REVIEWED' : file.errors.length ? 'FILE_PARSE_INCOMPLETE' : '';
        if (fileProblem) omitted.add(fileProblem);
        else if (!file.hunkCandidates.length) omitted.add('NO_TEXT_HUNKS');
        let pending: WorkUnit | undefined;
        for (const candidate of file.hunkCandidates) {
            const item: HunkDisposition = { fileIndex: index + 1, hunkOrdinal: candidate.ordinal, oldPath, newPath,
                parsedHunkIndex: candidate.hunkIndex, disposition: 'OMITTED', unitId: '', unitHunkIndex: null,
                reason: candidate.error || fileProblem };
            hunkLedger.push(item);
            if (item.reason || candidate.hunkIndex === null) continue;
            const hunk = hunks[candidate.hunkIndex];
            const size = hunk.header.length + 1 + hunk.lines.reduce((count, line) => count + line.length + 1, 0);
            if (size > budget) { item.reason = 'HUNK_EXCEEDS_BUDGET'; continue; }
            if (!pending || pending.publicUnit.hunks.length >= input.maxHunksPerUnit || pending.publicUnit.estimatedChars + size > budget) {
                if (units.length >= input.maxUnits) { item.reason = 'MAX_UNITS_REACHED'; continue; }
                pending = { path, sensitive, originalHunks: [], ledger: [], publicUnit: { id: '', filePath: publicPath, hunks: [], estimatedChars: 0 } };
                units.push(pending);
            }
            item.unitHunkIndex = pending.publicUnit.hunks.length;
            item.disposition = 'PLANNED';
            pending.ledger.push(item);
            pending.publicUnit.hunks.push(hunk);
            pending.originalHunks.push(file.hunks[candidate.hunkIndex]);
            pending.publicUnit.estimatedChars += size;
        }
        return { ...file, oldPath, newPath, hunks };
    });
    const versions = [redactReviewText(input.baseVersion), redactReviewText(input.targetVersion)];
    for (const [sequence, { publicUnit, ledger }] of units.entries()) {
        publicUnit.id = digest(JSON.stringify([input.projectId, ...versions, publicUnit.filePath, sequence, publicUnit.hunks]));
        for (const item of ledger) item.unitId = publicUnit.id;
    }
    for (const hunk of hunkLedger) if (hunk.reason) omitted.add(hunk.reason);
    return { units, hunkLedger, publicFiles };
}

type IndexEvidence = Pick<RepositoryIndex, 'projectRoot' | 'locate' | 'graphNeighbors'>;

function review(input: Input, index: IndexEvidence, findings: ExternalFindings, vulnerabilities: VulnerabilityInventory) {
    index.projectRoot(input.projectId);
    const { files, errors } = parseDiff(input.diff);
    const omitted = new Set<string>(['INDEX_VERSION_UNVERIFIED', ...errors]);
    const budget = Math.min(input.budgetChars, 60_000);
    if (input.budgetChars > budget) omitted.add('BUDGET_CLAMPED');
    if (input.baseVersion.toLowerCase() === 'unknown') omitted.add('BASE_VERSION_UNKNOWN');
    if (input.targetVersion.toLowerCase() === 'unknown') omitted.add('TARGET_VERSION_UNKNOWN');
    const { units, hunkLedger, publicFiles } = plan(input, files, budget, omitted);
    if (units.length && !findings.available(input.projectId)) omitted.add('EXTERNAL_FINDINGS_UNAVAILABLE');
    let lookupCount = 0;

    const evidence = units.map(work => {
        const { publicUnit: unit, path, originalHunks, sensitive } = work;
        let localLookups = 0;
        const seeds = new Map<string, CodeUnit>();
        const locations = new Map<string, string[]>();
        const unitReasons = new Set<string>();
        const hunkMappings: HunkMapping[] = originalHunks.map((hunk, hunkIndex) => {
            const reasons = new Set<string>();
            const names = new Set<string>();
            const changedRanges: HunkMapping['changedRanges'] = [];
            let line = hunk.newStart;
            for (const text of hunk.lines) {
                if (text.startsWith('+')) {
                    const last = changedRanges.at(-1);
                    if (last?.endLine === line - 1) last.endLine = line;
                    else changedRanges.push({ startLine: line, endLine: line });
                    if (sensitive) reasons.add('SENSITIVE_FILE_CONTENT_MASKED');
                    else if (lookupCount >= MAX_INDEX_LOOKUPS || localLookups >= MAX_UNIT_LOOKUPS) reasons.add('INDEX_LOOKUP_LIMIT');
                    else {
                        lookupCount++;
                        localLookups++;
                        const symbol = index.locate(path, line, input.projectId);
                        if (!symbol) reasons.add('CHANGED_LINE_NOT_INDEXED');
                        else {
                            let sourceLines = locations.get(symbol.id);
                            if (!sourceLines) {
                                sourceLines = symbol.rawSource.split(/\r\n|\n|\r/);
                                locations.set(symbol.id, sourceLines);
                            }
                            // Syntax spans can begin after indentation on their first line.
                            if (sourceLines[line - symbol.startLine]?.trim() !== text.slice(1).trim()) reasons.add('INDEX_LINE_CONTENT_DIFFERS');
                            else if (!seeds.has(symbol.id) && seeds.size >= MAX_CONTEXT_REFERENCES) reasons.add('CONTEXT_REFERENCE_LIMIT');
                            else {
                                names.add(redactReviewText(symbol.qualifiedName));
                                seeds.set(symbol.id, symbol);
                            }
                        }
                    }
                }
                if (text.startsWith(' ') || text.startsWith('+')) line++;
            }
            if (!changedRanges.length) reasons.add('REMOVED_OR_CONTEXT_ONLY_LINES');
            for (const reason of reasons) unitReasons.add(reason);
            return { hunkIndex, status: names.size && !reasons.size ? 'MAPPED' : 'UNMAPPED', changedRanges,
                qualifiedNames: [...names], omittedReasons: [...reasons] };
        });

        type Ranked = Parameters<typeof contextPack>[3]['results'][number];
        const ranks = new Map<string, Ranked>();
        function add(symbol: CodeUnit, source: Ranked['source'], relation: Ranked['relation']) {
            if (ranks.has(symbol.id)) return;
            if (ranks.size >= MAX_CONTEXT_REFERENCES) { unitReasons.add('CONTEXT_REFERENCE_LIMIT'); return; }
            ranks.set(symbol.id, { projectId: input.projectId, unit: { ...symbol,
                rawSource: redactReviewText(symbol.rawSource, isSensitiveReviewPath(symbol.filePath)),
                filePath: redactReviewText(symbol.filePath), qualifiedName: redactReviewText(symbol.qualifiedName)
            }, source, relation, finalScore: source === 'CHANGE' ? 1 : 0.5, vectorScore: 0, securityScore: 0, securitySignals: [] });
        }
        for (const symbol of seeds.values()) add(symbol, 'CHANGE', 'SEED');
        for (const symbol of [...seeds.values()].slice(0, 6)) {
            for (const direction of ['callers', 'callees', 'impact'] as const) {
                const relation = direction === 'callers' ? 'CALLER' : direction === 'callees' ? 'CALLEE' : 'IMPACT';
                for (const neighbor of index.graphNeighbors(symbol.id, direction, 1, 5)) {
                    add(neighbor, direction === 'impact' ? 'IMPACT' : 'CALL_GRAPH', relation);
                }
            }
        }
        const pack = contextPack(unit.filePath, 'change-review', budget, { results: [...ranks.values()], omittedReasons: [],
            seedCount: seeds.size, keywordSeedCount: 0, callGraphExpanded: [...ranks.values()].filter(rank => rank.source === 'CALL_GRAPH').length,
            impactExpanded: [...ranks.values()].filter(rank => rank.source === 'IMPACT').length, securityHighlightCount: 0 });
        if (pack.evidence.length === 0) unitReasons.add('NO_CONTEXT_EVIDENCE');
        if (pack.omittedReasons.length) unitReasons.add('CONTEXT_BUDGET_LIMIT');
        const target = input.targetVersion.toLowerCase() === 'unknown' ? '' : redactReviewText(input.targetVersion);
        const ranges = hunkMappings.flatMap(item => item.changedRanges);
        const external = findings.references(input.projectId, path, ranges, target);
        const active = vulnerabilities.references(input.projectId, path, ranges, target);
        if (external.truncated) unitReasons.add('EXTERNAL_FINDING_REFERENCE_LIMIT');
        if (active.truncated) unitReasons.add('VULNERABILITY_REFERENCE_LIMIT');
        for (const reason of unitReasons) omitted.add(reason);
        return { unit, status: hunkMappings.every(hunk => hunk.status === 'MAPPED') && pack.evidence.length ? 'MAPPED' as const : 'UNMAPPED' as const,
            qualifiedName: pack.evidence[0]?.qualifiedName ?? '', contextPack: pack,
            externalFindingReferences: external.references, vulnerabilityReferences: active.references,
            omittedReasons: [...unitReasons], hunkMappings };
    });
    const omittedHunkCount = hunkLedger.filter(hunk => hunk.disposition === 'OMITTED').length;
    return {
        schemaVersion: 1, id: randomUUID(), projectId: input.projectId, baseVersion: redactReviewText(input.baseVersion),
        targetVersion: redactReviewText(input.targetVersion), source: redactReviewText(input.source), generatedAt: new Date().toISOString(),
        status: !evidence.length ? 'FAILED' as const : omitted.size ? 'PARTIAL' as const : 'COMPLETED' as const,
        files: publicFiles, units: evidence, hunkLedger, omittedHunkCount, omittedReasons: [...omitted],
        totalHunkCount: hunkLedger.length, plannedHunkCount: hunkLedger.length - omittedHunkCount, untrustedEvidence: true,
        requestConfig: { maxUnits: input.maxUnits, requestedBudgetChars: input.budgetChars, effectiveBudgetChars: budget,
            maxHunksPerUnit: input.maxHunksPerUnit, maxContextReferences: MAX_CONTEXT_REFERENCES }
    };
}

type CurrentSnapshot = ReturnType<typeof review>;
type CurrentUnit = CurrentSnapshot['units'][number];
type CurrentEvidence = CurrentUnit['contextPack']['evidence'][number];
type ChangeEvidence = Omit<CurrentEvidence, 'unitId' | 'kind' | 'language' | 'source' | 'relation'> & {
    unitId?: string; kind: string; language: string; source: string; relation: string;
};
type ChangeUnitEvidence = Omit<CurrentUnit, 'status' | 'contextPack'> & {
    status: HunkMapping['status'];
    contextPack: Omit<CurrentUnit['contextPack'], 'evidence'> & { evidence: ChangeEvidence[] };
    legacyReferences?: { externalFindingFingerprints: string[]; vulnerabilityIds: string[] };
};
export type ChangeSnapshot = Omit<CurrentSnapshot, 'id' | 'units' | 'requestConfig'> & {
    id: string;
    units: ChangeUnitEvidence[];
    requestConfig: CurrentSnapshot['requestConfig'] | null;
    legacyImported?: true;
};

export function writeChangeSnapshots(db: DatabaseSync, snapshots: ChangeSnapshot[]) {
    const insert = db.prepare('INSERT INTO change_review VALUES (?, ?, ?, ?)');
    for (const snapshot of snapshots) insert.run(snapshot.id, snapshot.projectId, JSON.stringify(snapshot), snapshot.generatedAt);
}

export class ChangeReviews {
    constructor(private readonly db: DatabaseSync, private readonly index: IndexEvidence, private readonly findings: ExternalFindings,
        private readonly vulnerabilities: VulnerabilityInventory) {
        db.exec(`CREATE TABLE IF NOT EXISTS change_review (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            payload TEXT NOT NULL, generated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS change_review_project ON change_review(project_id, generated_at DESC);`);
    }

    submit(input: Input) {
        const snapshot = review(input, this.index, this.findings, this.vulnerabilities);
        writeChangeSnapshots(this.db, [snapshot]);
        return snapshot;
    }

    get(id: string, projectId: string) {
        const row = this.db.prepare('SELECT payload FROM change_review WHERE id = ? AND project_id = ?').get(id, projectId);
        return row ? JSON.parse(String(row.payload)) as ChangeSnapshot : undefined;
    }
}
