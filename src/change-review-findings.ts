import { z } from 'zod';
import type { ExternalFinding } from './finding-import.js';
import type { CheckVersionEvidence } from './external-findings.js';
import { redactReviewText } from './review-redaction.js';
import { digest } from './source.js';
import type { VulnerabilityInventory } from './vulnerability-inventory.js';

const actions = ['CONFIRM', 'DISMISS', 'REQUEST_REVIEW', 'APPEAL'] as const;
export const reviewFindingDecision = z.strictObject({ revision: z.int().nonnegative(), action: z.enum(actions),
    reason: z.string().trim().min(1).max(2000).refine(value => !value.includes('\0')) });
export type ReviewFindingDecision = z.infer<typeof reviewFindingDecision>;
export type ReviewFinding = { id: string; source: 'IMPORTED_SCAN' | 'VULNERABILITY_INVENTORY'; sourceId: string; projectId: string;
    snapshotId: string; tool: string; ruleId: string; severity: string; location: { path: string; startLine: number; endLine: number };
    publishability: 'CHANGED_LINE' | 'REPORT_ONLY'; evidence: { unitId: string; hunkIndex: number }[];
    versionEvidence: CheckVersionEvidence };
type FindingUnit = { unit: { filePath: string; id: string };
    hunkMappings: { hunkIndex: number; changedRanges: { startLine: number; endLine: number }[] }[];
    vulnerabilityReferences: ReturnType<VulnerabilityInventory['references']>['references'] };

export function reviewFindings(projectId: string, snapshotId: string, units: FindingUnit[],
    external: (ExternalFinding & { versionEvidence: CheckVersionEvidence })[]) {
    const changes = new Map<string, { unitId: string; hunkIndex: number; startLine: number; endLine: number }[]>();
    for (const entry of units) {
        const path = entry.unit.filePath;
        const ranges = changes.get(path) ?? [];
        for (const item of entry.hunkMappings) for (const range of item.changedRanges) {
            ranges.push({ ...range, unitId: entry.unit.id, hunkIndex: item.hunkIndex });
        }
        changes.set(path, ranges);
    }
    const findings = new Map<string, ReviewFinding>();
    function record(source: ReviewFinding['source'], sourceId: string, tool: string, ruleId: string, severity: string,
        file: string, startLine: number, endLine: number, versionEvidence: CheckVersionEvidence = 'DECLARED_VERSION') {
        const path = redactReviewText(file);
        const id = digest(JSON.stringify([projectId, snapshotId, source, sourceId, path, startLine, endLine]));
        if (findings.has(id)) return;
        const ranges = changes.get(path) ?? [];
        const evidence = ranges.filter(range => range.startLine <= endLine && range.endLine >= startLine)
            .map(({ unitId, hunkIndex }) => ({ unitId, hunkIndex }));
        findings.set(id, { id, source, sourceId, projectId, snapshotId, tool: redactReviewText(tool), ruleId: redactReviewText(ruleId),
            severity, location: { path, startLine, endLine }, publishability: ranges.some(range => range.startLine <= startLine && range.endLine >= startLine)
                ? 'CHANGED_LINE' : 'REPORT_ONLY', evidence, versionEvidence });
    }
    for (const item of external) record('IMPORTED_SCAN', item.fingerprint, item.tool, item.ruleId, item.severity,
        item.filePath, item.startLine, item.endLine, item.versionEvidence);
    for (const unit of units) for (const item of unit.vulnerabilityReferences) record('VULNERABILITY_INVENTORY', item.id, 'inventory',
        item.ruleId, item.severity, item.filePath, item.startLine, item.endLine);
    return [...findings.values()];
}
