import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { reviewFindings } from './change-review-findings.js';
import type { ReviewFindingDecision } from './change-review-findings.js';
import { missingDependencyCheck } from './dependency-advisories.js';
import type { DependencyReviewCheck } from './dependency-advisories.js';
import { HttpError } from './http-error.js';
import type { RepositoryIndex } from './index.js';
import type { ExternalFindings } from './external-findings.js';
import type { Account } from './identity.js';
import type { VulnerabilityInventory } from './vulnerability-inventory.js';
import { contextPack } from './retrieval.js';
import { lineExcerpt } from './knowledge-excerpts.js';
import { redactReviewText, isSensitiveReviewPath } from './review-redaction.js';
import { captureWorkingCopy, overlayPath } from './review-working-copy.js';
import { digest, languageOf, parse } from './source.js';
import type { CodeUnit } from './source.js';
import { capturedText, snapshotDiff, workingCopyDiff } from './snapshot-diff.js';
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
export const compareChangeInput = changeReviewInput.pick({ projectId: true, maxUnits: true, budgetChars: true, maxHunksPerUnit: true })
    .extend({ baseSnapshotId: z.string().regex(snapshotIdPattern).nullable().optional(),
        targetSnapshotId: z.string().regex(snapshotIdPattern) }).strict();
type ComparisonInput = z.infer<typeof compareChangeInput>;
export const workingReviewInput = compareChangeInput.omit({ targetSnapshotId: true, baseSnapshotId: true }).extend({
    baseSnapshotId: z.string().regex(snapshotIdPattern), paths: z.array(overlayPath).min(1).max(24)
        .refine(paths => new Set(paths).size === paths.length) });
type WorkingReviewInput = z.infer<typeof workingReviewInput>;
const contextReference = z.strictObject({ path: z.string().min(1).max(4096).refine(path =>
    path.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\\x00-\x1f\x7f]/.test(part))), line: z.int().min(1).max(2_000_000) });
const contextScope = z.strictObject({ projectId: changeReviewInput.shape.projectId, snapshotId: z.string().regex(snapshotIdPattern),
    references: z.array(contextReference).max(8).default([]) });
export const compareChangeScopeInput = z.strictObject({ targets: z.array(compareChangeInput).min(1).max(4),
    background: z.array(contextScope).max(4).default([]) }).refine(scope => {
    const projects = [...scope.targets, ...scope.background].map(item => item.projectId);
    return new Set(projects).size === projects.length;
});
type ComparisonScopeInput = z.infer<typeof compareChangeScopeInput>;
type BackgroundEvidence = { path: string; line: number; status: 'READABLE' | 'BINARY' | 'SOURCE_UNAVAILABLE' | 'LINE_OUT_OF_RANGE';
    excerpt?: string; startLine?: number; endLine?: number };
type ReviewScope = { id: string; createdAt: string; reports: { projectId: string; reviewId: string }[];
    background: { projectId: string; snapshotId: string; evidence: BackgroundEvidence[] }[] };
type PublishedComparison = { baseSnapshotId: string | null; targetSnapshotId: string; scope: 'PUBLISHED_INDEXED_SOURCE';
    mode: 'INCREMENTAL' | 'FULL'; baselineReason: 'EXPLICIT' | 'PREVIOUS_REVIEW' | 'FULL_REQUESTED' | 'NO_PREVIOUS_REVIEW'
        | 'PREVIOUS_BASELINE_UNAVAILABLE'; totalFiles: number };
type WorkingComparison = { scope: 'WORKING_COPY_OVERLAY'; baseSnapshotId: string; targetSnapshotId: null; baseCommit: string;
    mode: 'INCREMENTAL'; baselineReason: 'EXPLICIT'; totalFiles: number; selectedPaths: number; overlayDigest: string };
type ComparisonProvenance = PublishedComparison | WorkingComparison;

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

function plan(input: Input, files: DiffFile[], budget: number, omitted: Set<string>, verified: boolean) {
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
        else if (!file.hunkCandidates.length && (!verified || file.kind !== 'RENAMED')) omitted.add('NO_TEXT_HUNKS');
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

function review(input: Input, index: IndexEvidence, findings: ExternalFindings, vulnerabilities: VulnerabilityInventory,
    comparison?: { parsed: ReturnType<typeof snapshotDiff>; provenance: ComparisonProvenance; versionKeys: string[];
        dependencyCheck?: DependencyReviewCheck }) {
    index.projectRoot(input.projectId);
    const { files, errors } = comparison?.parsed ?? parseDiff(input.diff);
    const omitted = new Set<string>(comparison ? errors : ['INDEX_VERSION_UNVERIFIED', ...errors]);
    const budget = Math.min(input.budgetChars, 60_000);
    if (input.budgetChars > budget) omitted.add('BUDGET_CLAMPED');
    if (input.baseVersion.toLowerCase() === 'unknown') omitted.add('BASE_VERSION_UNKNOWN');
    if (input.targetVersion.toLowerCase() === 'unknown') omitted.add('TARGET_VERSION_UNKNOWN');
    const { units, hunkLedger, publicFiles } = plan(input, files, budget, omitted, Boolean(comparison));
    const externalChecks = comparison ? (comparison.parsed.totalFiles ? findings.reviewChecks(input.projectId, comparison.versionKeys) : []) : undefined;
    const checkCoverage = externalChecks ? externalChecks.length ? externalChecks
        : [{ tool: 'external', status: !comparison?.parsed.totalFiles ? 'NOT_APPLICABLE' as const : 'UNAVAILABLE' as const,
            provenance: 'UNRECORDED' as const }] : undefined;
    if (units.length && !(externalChecks ? externalChecks.length : findings.available(input.projectId))) omitted.add('EXTERNAL_FINDINGS_UNAVAILABLE');
    if (externalChecks?.some(check => check.status === 'PARTIAL' || check.status === 'FAILED')) omitted.add('EXTERNAL_CHECKS_INCOMPLETE');
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
        const target = comparison?.versionKeys ?? (input.targetVersion.toLowerCase() === 'unknown' ? '' : redactReviewText(input.targetVersion));
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
    if (comparison?.provenance.scope === 'WORKING_COPY_OVERLAY' && files.length) omitted.add('OVERLAY_GRAPH_UNAVAILABLE');
    const observations = comparison?.provenance.scope === 'PUBLISHED_INDEXED_SOURCE' && findings.reviewObservations(input.projectId, comparison.versionKeys, 500);
    if (observations && observations.truncated) omitted.add('REVIEW_FINDINGS_TRUNCATED');
    const structuredFindings = comparison?.provenance.scope === 'PUBLISHED_INDEXED_SOURCE' && observations
        ? reviewFindings(input.projectId, comparison.provenance.targetSnapshotId, evidence, observations.findings) : undefined;
    return {
        schemaVersion: 1, id: randomUUID(), projectId: input.projectId, baseVersion: redactReviewText(input.baseVersion),
        targetVersion: redactReviewText(input.targetVersion), source: redactReviewText(input.source), generatedAt: new Date().toISOString(),
        status: !evidence.length && !comparison ? 'FAILED' as const : omitted.size ? 'PARTIAL' as const : 'COMPLETED' as const,
        ...(comparison && { provenance: comparison.provenance }),
        ...(checkCoverage && { checkCoverage }),
        ...(comparison?.dependencyCheck && { dependencyCheck: comparison.dependencyCheck }),
        ...(structuredFindings && { structuredFindings }),
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
    constructor(private readonly db: DatabaseSync, private readonly index: IndexEvidence & Pick<RepositoryIndex,
        'knowledgeSnapshots' | 'identity' | 'assets' | 'gitSources'>, private readonly findings: ExternalFindings,
        private readonly vulnerabilities: VulnerabilityInventory) {
        db.exec(`CREATE TABLE IF NOT EXISTS change_review (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            payload TEXT NOT NULL, generated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS change_review_project ON change_review(project_id, generated_at DESC);
        CREATE TABLE IF NOT EXISTS change_review_request (
            project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            actor_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
            review_id TEXT NOT NULL REFERENCES change_review(id) ON DELETE CASCADE,
            PRIMARY KEY (project_id, actor_id, request_key)
        );
        CREATE TABLE IF NOT EXISTS change_review_scope (
            id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL,
            UNIQUE(actor_id, request_key)
        );
        CREATE TABLE IF NOT EXISTS change_review_finding_decision (
            review_id TEXT NOT NULL REFERENCES change_review(id) ON DELETE CASCADE, finding_id TEXT NOT NULL,
            revision INTEGER NOT NULL, actor_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
            action TEXT NOT NULL, reason TEXT NOT NULL, decided_at TEXT NOT NULL,
            PRIMARY KEY(review_id, finding_id, revision), UNIQUE(review_id, finding_id, actor_id, request_key)
        );
        CREATE TABLE IF NOT EXISTS change_review_overlay_file (
            review_id TEXT NOT NULL REFERENCES change_review(id) ON DELETE CASCADE, path TEXT NOT NULL,
            base_digest TEXT, content BLOB, digest TEXT, PRIMARY KEY(review_id, path)
        );`);
    }

    submit(input: Input) {
        const snapshot = review(input, this.index, this.findings, this.vulnerabilities);
        writeChangeSnapshots(this.db, [snapshot]);
        return snapshot;
    }

    compare(actorId: string, key: string, input: ComparisonInput) {
        const fingerprint = digest(JSON.stringify(input));
        return this.transaction(() => {
            const previous = this.db.prepare(`SELECT fingerprint, review_id FROM change_review_request
                WHERE project_id = ? AND actor_id = ? AND request_key = ?`).get(input.projectId, actorId, key);
            if (previous && previous.fingerprint !== fingerprint) throw new HttpError(409, 'CHANGE_REVIEW_REQUEST_CONFLICT');
            const snapshot = previous ? this.get(String(previous.review_id), input.projectId) : this.comparePublished(input);
            if (!snapshot) throw new HttpError(404, 'SNAPSHOT_NOT_FOUND');
            if (!previous) this.db.prepare('INSERT INTO change_review_request VALUES (?, ?, ?, ?, ?)')
                .run(input.projectId, actorId, key, fingerprint, snapshot.id);
            return snapshot;
        });
    }

    async compareWorking(actor: Account, key: string, input: WorkingReviewInput, requestSignal: AbortSignal) {
        const { projectId, baseSnapshotId } = input;
        const paths = [...input.paths].sort();
        const fingerprint = digest(JSON.stringify(['overlay', { ...input, paths }]));
        const find = () => {
            const previous = this.db.prepare(`SELECT fingerprint, review_id FROM change_review_request
                WHERE project_id = ? AND actor_id = ? AND request_key = ?`).get(projectId, actor.id, key);
            if (!previous) return undefined;
            if (previous.fingerprint !== fingerprint) throw new HttpError(409, 'CHANGE_REVIEW_REQUEST_CONFLICT');
            const saved = this.get(String(previous.review_id), projectId);
            if (!saved) throw new HttpError(404, 'SNAPSHOT_NOT_FOUND');
            return saved;
        };
        const authorized = () => {
            this.index.identity.requireProjectEditor(actor, projectId);
            this.requireSnapshot(projectId, baseSnapshotId);
            if (this.index.assets.forProject(projectId) || this.index.gitSources.name(projectId)) {
                throw new HttpError(409, 'OVERLAY_LOCAL_WORKING_COPY_REQUIRED');
            }
            return this.index.projectRoot(projectId);
        };
        const root = authorized();
        const previous = find();
        if (previous) return previous;
        const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(12_000)]);
        const captured = await captureWorkingCopy(root, paths, path => this.index.knowledgeSnapshots.sourceBytes(baseSnapshotId, path), signal)
            .catch(error => {
                if (signal.aborted && !requestSignal.aborted) throw new HttpError(409, 'OVERLAY_CAPTURE_TIMEOUT');
                throw error;
            });
        signal.throwIfAborted();
        const parsed = workingCopyDiff(captured.files);
        const units = new Map<string, CodeUnit[]>();
        for (const file of captured.files) {
            const language = languageOf(file.path);
            const text = file.target && capturedText(file.target);
            if (text !== null && language && language !== 'class') units.set(file.path, parse(projectId, file.path, language, text));
        }
        const overlayIndex: IndexEvidence = { projectRoot: () => root, graphNeighbors: () => [],
            locate: (path, line) => units.get(path)?.filter(unit => unit.startLine <= line && unit.endLine >= line)
                .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0] };
        const targetVersion = 'overlay:' + captured.digest;
        return this.transaction(() => {
            signal.throwIfAborted();
            if (authorized() !== root) throw new HttpError(409, 'OVERLAY_SOURCE_PATH_CHANGED');
            const existing = find();
            if (existing) return existing;
            const result = review({ ...input, diff: '', baseVersion: captured.baseCommit, targetVersion, source: 'local-working-copy' },
                overlayIndex, this.findings, this.vulnerabilities, { parsed, versionKeys: [], provenance: {
                    scope: 'WORKING_COPY_OVERLAY', baseSnapshotId, targetSnapshotId: null, baseCommit: captured.baseCommit,
                    totalFiles: parsed.totalFiles, selectedPaths: paths.length, overlayDigest: captured.digest, mode: 'INCREMENTAL', baselineReason: 'EXPLICIT'
                } });
            writeChangeSnapshots(this.db, [result]);
            const save = this.db.prepare('INSERT INTO change_review_overlay_file VALUES (?,?,?,?,?)');
            for (const file of captured.files) save.run(result.id, file.path, file.base && digest(file.base), file.target, file.target && digest(file.target));
            this.db.prepare('INSERT INTO change_review_request VALUES (?, ?, ?, ?, ?)').run(projectId, actor.id, key, fingerprint, result.id);
            return result;
        });
    }

    overlaySource(actor: Account, projectId: string, reviewId: string, path: string) {
        this.index.identity.requireProjectReader(actor, projectId);
        const report = this.get(reviewId, projectId);
        if (report?.provenance?.scope !== 'WORKING_COPY_OVERLAY') throw new HttpError(404, 'OVERLAY_SOURCE_NOT_FOUND');
        const file = this.db.prepare(`SELECT base_digest AS baseDigest, content, digest FROM change_review_overlay_file WHERE review_id = ? AND path = ?`)
            .get(reviewId, path);
        if (!file) throw new HttpError(404, 'OVERLAY_SOURCE_NOT_FOUND');
        const bytes = file.content as Uint8Array | null;
        const text = bytes ? capturedText(bytes) : null;
        return { reviewId, path: redactReviewText(path), baseDigest: file.baseDigest, digest: file.digest, size: bytes?.byteLength ?? 0,
            deleted: bytes === null, binary: bytes !== null && text === null, text: text === null ? null : redactReviewText(text, isSensitiveReviewPath(path)) };
    }

    compareScope(actor: Account, key: string, input: ComparisonScopeInput) {
        const fingerprint = digest(JSON.stringify(input));
        return this.transaction(() => {
            for (const item of input.targets) this.index.identity.requireProjectEditor(actor, item.projectId);
            for (const item of input.background) this.index.identity.requireProjectReader(actor, item.projectId);
            const previous = this.db.prepare('SELECT id, fingerprint FROM change_review_scope WHERE actor_id = ? AND request_key = ?')
                .get(actor.id, key);
            if (previous) {
                if (previous.fingerprint !== fingerprint) throw new HttpError(409, 'CHANGE_REVIEW_REQUEST_CONFLICT');
                return this.readScope(actor, String(previous.id));
            }
            const background = input.background.map(({ projectId, snapshotId, references }) => {
                this.requireSnapshot(projectId, snapshotId);
                const evidence = references.map(reference => this.backgroundEvidence(snapshotId, reference));
                return { projectId, snapshotId, evidence };
            });
            const reports = input.targets.map(target => {
                const report = this.comparePublished(target);
                return { projectId: report.projectId, reviewId: report.id };
            });
            const record: ReviewScope = { id: randomUUID(), createdAt: new Date().toISOString(), reports, background };
            this.db.prepare('INSERT INTO change_review_scope VALUES (?, ?, ?, ?, ?)').run(record.id, actor.id, key, fingerprint, JSON.stringify(record));
            return this.readScope(actor, record.id);
        });
    }

    readScope(actor: Account, id: string) {
        const unavailable = () => new HttpError(404, 'CHANGE_REVIEW_SCOPE_NOT_FOUND');
        this.index.identity.requireCurrent(actor);
        const row = this.db.prepare('SELECT payload FROM change_review_scope WHERE id = ?').get(id);
        if (!row) throw unavailable();
        const record = JSON.parse(String(row.payload)) as ReviewScope;
        try {
            for (const context of record.background) {
                this.index.identity.requireProjectReader(actor, context.projectId);
                this.requireSnapshot(context.projectId, context.snapshotId);
            }
            const reports = record.reports.map(({ projectId, reviewId }) => {
                this.index.identity.requireProjectReader(actor, projectId);
                const report = this.get(reviewId, projectId);
                if (!report) throw unavailable();
                return report;
            });
            return { ...record, reports };
        } catch (error) {
            if (error instanceof HttpError && (error.status === 403 || error.status === 404)) throw unavailable();
            throw error;
        }
    }

    private requireSnapshot(projectId: string, snapshotId: string) {
        const source = this.index.knowledgeSnapshots.get(snapshotId);
        if (source?.projectId !== projectId) throw new HttpError(404, 'SNAPSHOT_NOT_FOUND');
        return source;
    }

    private finding(projectId: string, reviewId: string, findingId: string) {
        const finding = this.get(reviewId, projectId)?.structuredFindings?.find(item => item.id === findingId);
        if (!finding) throw new HttpError(404, 'CHANGE_REVIEW_FINDING_NOT_FOUND');
        return finding;
    }

    findingHistory(actor: Account, projectId: string, reviewId: string, findingId: string, limit = 50, offset = 0) {
        this.index.identity.requireProjectReader(actor, projectId);
        const finding = this.finding(projectId, reviewId, findingId);
        const latest = this.lastFindingDecision(reviewId, findingId);
        const entries = this.db.prepare(`SELECT revision, actor_id AS actorId, action, reason, decided_at AS decidedAt
            FROM change_review_finding_decision WHERE review_id = ? AND finding_id = ? ORDER BY revision DESC LIMIT ? OFFSET ?`)
            .all(reviewId, findingId, limit + 1, offset);
        return { finding, revision: Number(latest?.revision ?? 0), current: latest?.action ?? 'UNREVIEWED', entries: entries.slice(0, limit),
            hasMore: entries.length > limit, offset, editable: this.index.identity.projectCapabilities(actor, projectId).canEdit };
    }

    private lastFindingDecision(reviewId: string, findingId: string) {
        return this.db.prepare(`SELECT revision, action FROM change_review_finding_decision WHERE review_id = ? AND finding_id = ?
            ORDER BY revision DESC LIMIT 1`).get(reviewId, findingId);
    }

    decideFinding(actor: Account, projectId: string, reviewId: string, findingId: string, key: string, decision: ReviewFindingDecision) {
        return this.transaction(() => {
            this.index.identity.requireProjectEditor(actor, projectId);
            const finding = this.finding(projectId, reviewId, findingId);
            const fingerprint = digest(JSON.stringify(decision));
            const prior = this.db.prepare(`SELECT revision, fingerprint FROM change_review_finding_decision
                WHERE review_id = ? AND finding_id = ? AND actor_id = ? AND request_key = ?`).get(reviewId, findingId, actor.id, key);
            if (prior && fingerprint !== prior.fingerprint) throw new HttpError(409, 'CHANGE_REVIEW_REQUEST_CONFLICT');
            if (!prior) {
                const latest = this.lastFindingDecision(reviewId, findingId);
                if (Number(latest?.revision ?? 0) !== decision.revision) throw new HttpError(409, 'CHANGE_REVIEW_FINDING_CHANGED');
                if (decision.action === 'APPEAL' && latest?.action !== 'CONFIRM' && latest?.action !== 'DISMISS') {
                    throw new HttpError(409, 'CHANGE_REVIEW_APPEAL_UNAVAILABLE');
                }
                this.db.prepare('INSERT INTO change_review_finding_decision VALUES (?,?,?,?,?,?,?,?,?)').run(reviewId, findingId,
                    decision.revision + 1, actor.id, key, fingerprint, decision.action, redactReviewText(decision.reason), new Date().toISOString());
                this.index.identity.record(actor.id, 'CHANGE_REVIEW_FINDING_' + decision.action, reviewId, finding.id);
            }
            const revision = Number(prior?.revision ?? decision.revision + 1);
            const entry = this.db.prepare(`SELECT revision, actor_id AS actorId, action, reason, decided_at AS decidedAt
                FROM change_review_finding_decision WHERE review_id = ? AND finding_id = ? AND revision = ?`).get(reviewId, findingId, revision);
            return { finding, entry };
        });
    }

    private backgroundEvidence(snapshotId: string, reference: z.infer<typeof contextReference>): BackgroundEvidence {
        const source = this.index.knowledgeSnapshots.source(snapshotId, reference.path);
        const safe = { path: redactReviewText(reference.path), line: reference.line };
        if (!source) return { ...safe, status: 'SOURCE_UNAVAILABLE' };
        if (source.text === null) return { ...safe, status: 'BINARY' };
        try {
            const excerpt = lineExcerpt(source.text, reference.line);
            return { ...safe, status: 'READABLE', startLine: excerpt.startLine, endLine: excerpt.endLine,
                excerpt: redactReviewText(excerpt.excerpt, isSensitiveReviewPath(reference.path)) };
        } catch (error) {
            if (error instanceof HttpError && error.message === 'ASK_CONTEXT_LINE_OUT_OF_RANGE') return { ...safe, status: 'LINE_OUT_OF_RANGE' };
            throw error;
        }
    }

    private transaction<T>(action: () => T) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = action();
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    private comparePublished(input: ComparisonInput) {
        const snapshots = this.index.knowledgeSnapshots;
        const target = this.requireSnapshot(input.projectId, input.targetSnapshotId);
        const prior = input.baseSnapshotId === undefined ? this.db.prepare(`SELECT json_extract(payload, '$.provenance.targetSnapshotId') AS target
            FROM change_review WHERE project_id = ? AND json_type(payload, '$.provenance.targetSnapshotId') = 'text'
            ORDER BY rowid DESC LIMIT 1`).get(input.projectId) : undefined;
        const candidate = input.baseSnapshotId ?? (prior?.target ? String(prior.target) : undefined);
        const base = candidate ? snapshots.get(candidate) : undefined;
        if (input.baseSnapshotId && base?.projectId !== input.projectId) throw new HttpError(404, 'SNAPSHOT_NOT_FOUND');
        const verifiedBase = base?.projectId === input.projectId ? base : undefined;
        const baselineReason = input.baseSnapshotId === null ? 'FULL_REQUESTED' : input.baseSnapshotId ? 'EXPLICIT'
            : verifiedBase ? 'PREVIOUS_REVIEW' : candidate ? 'PREVIOUS_BASELINE_UNAVAILABLE' : 'NO_PREVIOUS_REVIEW';
        const parsed = snapshotDiff(snapshots, verifiedBase?.id ?? null, target.id);
        const frozenIndex: IndexEvidence = {
            projectRoot: id => this.index.projectRoot(id),
            locate: (path, line) => snapshots.locate(target.id, path, line, null, null),
            graphNeighbors: (id, query, depth, limit) => this.index.graphNeighbors(id, query, depth, limit, target.id)
        };
        const version = (snapshot: typeof target) => snapshot.source?.type === 'GIT' ? snapshot.source.gitCommit : snapshot.id;
        const versionKeys = [...new Set([target.id, version(target), ...(target.source?.type === 'ARCHIVE' ? [target.source.sha256] : [])])];
        const dependencyCheck = snapshots.dependencyCheck(target.id) ?? missingDependencyCheck();
        const snapshot = review({ ...input, diff: '', baseVersion: verifiedBase ? version(verifiedBase) : 'empty', targetVersion: version(target),
            source: 'published-snapshots' }, frozenIndex, this.findings, this.vulnerabilities, { parsed, versionKeys, dependencyCheck, provenance: {
            baseSnapshotId: verifiedBase?.id ?? null, targetSnapshotId: target.id, scope: 'PUBLISHED_INDEXED_SOURCE',
            mode: verifiedBase ? 'INCREMENTAL' : 'FULL', baselineReason, totalFiles: parsed.totalFiles
        } });
        writeChangeSnapshots(this.db, [snapshot]);
        return snapshot;
    }

    get(id: string, projectId: string) {
        const row = this.db.prepare('SELECT payload FROM change_review WHERE id = ? AND project_id = ?').get(id, projectId);
        if (!row) return undefined;
        const snapshot = JSON.parse(String(row.payload)) as ChangeSnapshot;
        const source = snapshot.provenance;
        if (source && (source.targetSnapshotId && this.index.knowledgeSnapshots.get(source.targetSnapshotId)?.projectId !== projectId
            || source.baseSnapshotId && this.index.knowledgeSnapshots.get(source.baseSnapshotId)?.projectId !== projectId)) return undefined;
        return snapshot;
    }
}
