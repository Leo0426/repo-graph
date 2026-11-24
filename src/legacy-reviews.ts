import { z } from 'zod';
import { agentRunIdPattern } from './agent-runs.js';
import { findingVerdicts } from './external-findings.js';
import type { FindingReport } from './external-findings.js';
import { findingPublicText } from './finding-import.js';
import type { ExternalFinding } from './finding-import.js';
import { relativeEvidencePath } from './project-file.js';
import { reviewStatuses } from './review-queue.js';
import type { ReportSnapshot, ReviewEvent, ReviewQueueEntry } from './review-queue.js';
import { isSensitiveReviewPath, redactReviewText } from './review-redaction.js';
import { digest } from './source.js';

const uuid = z.string().regex(agentRunIdPattern);
const projectId = z.string().regex(/^[a-f0-9]{12}$/);
const fingerprint = z.string().regex(/^[a-f0-9]{16}$/);
const date = z.string().refine(value => Number.isFinite(Date.parse(value)));
const severity = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN']);
const verdict = z.enum(findingVerdicts);
const confidence = z.number().min(0).max(1);
const text = z.string();
const optionalText = text.nullish().transform(value => value ?? '');
const integer = z.number().int().min(0).max(2_147_483_647);
const location = { filePath: text, startLine: integer, endLine: integer };
const reportText = (value: string) => findingPublicText(value, 4000);

export const legacyExternalRow = z.object({
    project_id: projectId, fingerprint, scanner: text, scan_id: text, finding_json: text,
    first_seen_at: date, last_seen_at: date
});
export const legacySnapshotRow = z.object({
    id: uuid, project_id: projectId, schema_version: text, tool_version: text, code_version: optionalText,
    rule_version: optionalText, generated_at: date, reports_json: text
});
export const legacyReviewEntryRow = z.object({
    id: uuid, snapshot_id: uuid, project_id: projectId, fingerprint, rule_id: text, cwe: optionalText, severity, verdict, confidence,
    status: z.enum(reviewStatuses), claimed_by: optionalText, claimed_at: optionalText, updated_at: date
});
const actions = { SUBMITTED: 'SUBMIT', CLAIMED: 'CLAIM', RETURNED: 'RETURN', CONFIRMED: 'CONFIRM', REJECTED: 'REJECT' } as const;
export const legacyReviewEventRow = z.object({
    id: uuid, entry_id: uuid, action: z.enum(['SUBMITTED', 'CLAIMED', 'RETURNED', 'CONFIRMED', 'REJECTED']),
    actor: text, reason: optionalText, occurred_at: date
});

export const legacyFindingSchema = z.object({
    ...location, tool: text.min(1), ruleId: text.min(1), severity, cwe: optionalText, message: text, symbol: optionalText,
    trace: z.array(z.object({ ...location, kind: optionalText, symbol: optionalText, message: optionalText })).nullish()
});
const evidence = z.object({
    ...location, citationId: text.min(1), qualifiedName: text, kind: text, language: text, source: text,
    relation: text, finalScore: z.number(), excerpt: text, truncated: z.boolean(), securitySignals: z.array(text).default([])
});
const pack = z.object({
    query: text, taskType: text, evidence: z.array(evidence), omittedReasons: z.array(text),
    requestedBudgetChars: integer, usedBudgetChars: integer, seedCount: integer, keywordSeedCount: integer.default(0),
    callGraphExpanded: integer, impactExpanded: integer
});
const report = z.object({
    finding: legacyFindingSchema, located: z.boolean(), locatedQualifiedName: optionalText, verdict, confidence,
    reasons: z.array(text), missingInfo: z.array(text), remediation: optionalText, developerSummary: optionalText, pack,
    decisionEvidence: z.array(z.object({ source: text, reference: text, summary: text, applied: z.boolean() })).default([])
});
const reports = z.array(report);

export function formatLegacyFinding(input: z.infer<typeof legacyFindingSchema>, codeVersion: string, ruleVersion: string): ExternalFinding {
    const { tool, ruleId, startLine, endLine, cwe, message, symbol } = input;
    if (!startLine || endLine < startLine) throw new Error('Invalid legacy finding range');
    const filePath = relativeEvidencePath(input.filePath);
    const fingerprint = digest([tool, ruleId, input.filePath, startLine].join('|')).slice(0, 16);
    return {
        filePath, startLine, endLine, tool: findingPublicText(tool, 120), ruleId: findingPublicText(ruleId, 500),
        cwe: findingPublicText(cwe, 128), severity: input.severity, fingerprint, codeVersion, ruleVersion,
        message: findingPublicText(redactReviewText(message, !filePath || isSensitiveReviewPath(filePath)), 1500),
        symbol: findingPublicText(symbol, 500),
        trace: (input.trace ?? []).map(step => ({
            filePath: relativeEvidencePath(step.filePath), startLine: step.startLine, endLine: step.endLine,
            kind: step.kind === 'source' || step.kind === 'call' || step.kind === 'sink' || step.kind === 'note' ? step.kind : 'flow',
            ...(step.kind && step.kind !== 'flow' && !['source', 'call', 'sink', 'note'].includes(step.kind)
                ? { legacyKind: findingPublicText(step.kind, 100) } : {}),
            ...(step.symbol ? { symbol: findingPublicText(step.symbol, 500) } : {}),
            ...(step.message ? { message: reportText(step.message) } : {})
        }))
    };
}

function formatReport(input: z.infer<typeof report>, snapshot: Pick<ReportSnapshot, 'projectId' | 'codeVersion' | 'ruleVersion'>): FindingReport {
    return {
        finding: formatLegacyFinding(input.finding, snapshot.codeVersion, snapshot.ruleVersion),
        located: input.located, locatedQualifiedName: findingPublicText(input.locatedQualifiedName, 1000),
        verdict: input.verdict, confidence: input.confidence, reasons: input.reasons.map(reportText),
        missingInfo: input.missingInfo.map(reportText), remediation: reportText(input.remediation),
        developerSummary: reportText(input.developerSummary), scope: snapshot.projectId,
        decisionEvidence: input.decisionEvidence.map(({ source, reference, summary, applied }) => ({
            source: findingPublicText(source, 300), reference: findingPublicText(reference, 500), summary: reportText(summary), applied
        })),
        pack: {
            ...input.pack, query: reportText(input.pack.query), taskType: findingPublicText(input.pack.taskType, 100),
            omittedReasons: input.pack.omittedReasons.map(reportText),
            evidence: input.pack.evidence.map(item => {
                const filePath = relativeEvidencePath(item.filePath);
                return {
                    ...item, projectId: snapshot.projectId, filePath, citationId: findingPublicText(item.citationId, 100),
                    qualifiedName: findingPublicText(item.qualifiedName, 1000), kind: findingPublicText(item.kind, 100),
                    language: findingPublicText(item.language, 100), source: findingPublicText(item.source, 100),
                    relation: findingPublicText(item.relation, 100), securitySignals: item.securitySignals.map(reportText),
                    excerpt: redactReviewText(item.excerpt, !filePath || isSensitiveReviewPath(filePath))
                };
            })
        }
    };
}

function timeOrder(a: string, b: string) {
    const remainder = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0');
    return Date.parse(a) - Date.parse(b) || remainder(a).localeCompare(remainder(b));
}

export function prepareLegacyReviews(
    externalRows: z.infer<typeof legacyExternalRow>[], snapshotRows: z.infer<typeof legacySnapshotRow>[],
    entryRows: z.infer<typeof legacyReviewEntryRow>[], eventRows: z.infer<typeof legacyReviewEventRow>[],
    projects: ReadonlyMap<string, string>
) {
    const findings = externalRows.slice().sort((a, b) => timeOrder(a.last_seen_at, b.last_seen_at) || b.fingerprint.localeCompare(a.fingerprint))
        .flatMap(row => {
            const projectId = projects.get(row.project_id);
            if (!projectId) return [];
            const finding = formatLegacyFinding(legacyFindingSchema.parse(JSON.parse(row.finding_json)), '', '');
            if (finding.fingerprint !== row.fingerprint) throw new Error('Invalid legacy finding fingerprint');
            finding.legacyScan = { scanner: findingPublicText(row.scanner, 120), scanId: findingPublicText(row.scan_id, 200),
                firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at };
            return [{ projectId, finding }];
        });
    const snapshots = new Map<string, { projectId: string; originalProject: string }>();
    const frozen: ReportSnapshot[] = [];
    for (const row of snapshotRows) {
        const projectId = projects.get(row.project_id);
        if (!projectId) continue;
        const snapshot = { id: row.id, projectId, schemaVersion: findingPublicText(row.schema_version, 100),
            toolVersion: findingPublicText(row.tool_version, 100), codeVersion: findingPublicText(row.code_version, 256),
            ruleVersion: findingPublicText(row.rule_version, 256), generatedAt: row.generated_at, legacyImported: true as const };
        snapshots.set(row.id, { projectId, originalProject: row.project_id });
        frozen.push({ ...snapshot, reports: reports.parse(JSON.parse(row.reports_json)).map(value => formatReport(value, snapshot)) });
    }
    const entries = new Map<string, ReviewQueueEntry>();
    for (const row of entryRows) {
        const snapshot = snapshots.get(row.snapshot_id);
        if (!snapshot || snapshot.originalProject !== row.project_id) continue;
        entries.set(row.id, {
            id: row.id, snapshotId: row.snapshot_id, projectId: snapshot.projectId, fingerprint: row.fingerprint,
            ruleId: findingPublicText(row.rule_id, 500), cwe: findingPublicText(row.cwe, 128), severity: row.severity,
            verdict: row.verdict, confidence: row.confidence, status: row.status, claimedBy: findingPublicText(row.claimed_by, 120),
            claimedAt: row.claimed_at, updatedAt: row.updated_at, revision: 0, vulnerabilityId: null
        });
    }
    const events: ReviewEvent[] = [];
    for (const row of eventRows.slice().sort((a, b) => timeOrder(a.occurred_at, b.occurred_at) || a.id.localeCompare(b.id))) {
        const entry = entries.get(row.entry_id);
        if (!entry) continue;
        const action = actions[row.action];
        if (action !== 'SUBMIT') entry.revision++;
        events.push({ id: row.id, entryId: row.entry_id, action,
            actor: findingPublicText(row.actor, 120), reason: reportText(row.reason), occurredAt: row.occurred_at });
    }
    return { findings, snapshots: frozen, entries: [...entries.values()], events };
}
