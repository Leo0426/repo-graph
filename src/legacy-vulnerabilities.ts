import { PackageURL } from 'packageurl-js';
import { z } from 'zod';
import type { DependencyEvidence } from './dependency-advisories.js';
import { findingPublicText } from './finding-import.js';
import { relativeEvidencePath } from './project-file.js';
import { isSensitiveReviewPath, redactReviewText } from './review-redaction.js';
import { dependencyVulnerabilityFingerprint, dependencyVulnerabilityRule, vulnerabilityStatuses } from './vulnerability-inventory.js';
import type { LegacyVulnerability } from './vulnerability-inventory.js';

const findingId = z.string().regex(/^[a-f0-9]{16}$/);
const line = z.number().int().min(0).max(2_147_483_647);

export const legacyVulnerabilityFinding = z.object({
    id: findingId,
    project_id: z.string().regex(/^[a-f0-9]{12}$/),
    rule_id: z.string().min(1),
    cwe: z.string(),
    severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN']),
    status: z.enum(vulnerabilityStatuses),
    unit_id: z.string(),
    qual_name: z.string(),
    file_path: z.string(),
    start_line: line.nullish(),
    title: z.string(),
    detail: z.string().nullish(),
    found_at: z.string().refine(date => Number.isFinite(Date.parse(date)))
});

export const legacyVulnerabilityEvidence = z.object({
    finding_id: findingId,
    sequence_no: z.number().int().min(1),
    role: z.enum(['SOURCE', 'PROPAGATION', 'SINK']),
    method_qn: z.string(),
    from_slot: z.string(),
    to_slot: z.string(),
    file_path: z.string(),
    start_line: line,
    end_line: line,
    source_excerpt: z.string()
}).refine(row => row.end_line >= row.start_line);

function legacyDependency(unitId: string, filePath: string): DependencyEvidence | undefined {
    const match = /^dep:([a-z\d][\w.-]{0,213}):([a-z\d][\w.-]{0,213}):([a-z\d][\w.-]{0,179}):([a-z\d][\w.-]{0,79})$/i.exec(unitId);
    if (!match) return undefined;
    const [, group, name, version, advisoryId] = match;
    return {
        coordinate: group + ':' + name, version, advisoryId,
        purl: new PackageURL('maven', group, name, version).toString(),
        manifests: filePath ? [filePath] : [], introduced: '', fixed: '', source: 'legacy'
    };
}

export function prepareLegacyVulnerabilities(
    findings: z.infer<typeof legacyVulnerabilityFinding>[],
    steps: z.infer<typeof legacyVulnerabilityEvidence>[],
    projects: ReadonlyMap<string, string>
) {
    const records = new Map<string, LegacyVulnerability>();
    let evidenceSteps = 0;
    for (const row of findings) {
        const projectId = projects.get(row.project_id);
        if (!projectId) continue;
        const filePath = relativeEvidencePath(row.file_path);
        const startLine = filePath ? row.start_line ?? 0 : 0;
        const dependency = row.rule_id === dependencyVulnerabilityRule ? legacyDependency(row.unit_id, filePath) : undefined;
        const detail = row.detail ?? '';
        const hiddenLocation = !filePath || isSensitiveReviewPath(filePath);
        records.set(row.id, { status: row.status, evidence: [], facts: {
            id: row.id, projectId, ruleId: findingPublicText(row.rule_id, 500), cwe: findingPublicText(row.cwe, 128),
            severity: row.severity, unitId: row.unit_id, qualifiedName: findingPublicText(row.qual_name, 1000),
            filePath, startLine, endLine: startLine, title: findingPublicText(row.title, 1000),
            detail: findingPublicText(redactReviewText(detail, hiddenLocation), 4000), foundAt: row.found_at,
            fingerprint: dependency ? dependencyVulnerabilityFingerprint(projectId, row.unit_id) : row.id,
            codeVersion: '', ruleVersion: '', legacyImported: true, ...(dependency ? { dependency } : {})
        } });
    }
    for (const row of steps) {
        const owner = records.get(row.finding_id);
        if (!owner) continue;
        const filePath = relativeEvidencePath(row.file_path);
        const sensitive = !filePath || isSensitiveReviewPath(filePath);
        owner.evidence.push({
            sequence: row.sequence_no, role: row.role, methodQn: findingPublicText(row.method_qn, 1000),
            fromSlot: findingPublicText(row.from_slot, 500), toSlot: findingPublicText(row.to_slot, 500),
            filePath, startLine: filePath ? row.start_line : 0, endLine: filePath ? row.end_line : 0,
            sourceExcerpt: redactReviewText(row.source_excerpt, sensitive).slice(0, 2000)
        });
        evidenceSteps++;
    }
    return { records: [...records.values()], evidenceSteps };
}
