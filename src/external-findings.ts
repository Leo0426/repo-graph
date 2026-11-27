import type { DatabaseSync } from 'node:sqlite';
import { findingPublicText } from './finding-import.js';
import type { ExternalFinding, normalizeFindings } from './finding-import.js';
import { findingProtection } from './finding-protection.js';
import { HttpError } from './http-error.js';
import type { RepositoryIndex } from './index.js';
import { contextPack, securitySignals } from './retrieval.js';
import type { RankedUnit } from './retrieval.js';
import { isSensitiveReviewPath, redactReviewText } from './review-redaction.js';
import { digest } from './source.js';
import type { CodeUnit } from './source.js';

const MAX_PROJECT_FINDINGS = 50_000;
const MAX_CHANGE_REFERENCES = 12;
type ReportIndex = Pick<RepositoryIndex, 'locate' | 'symbol' | 'graphNeighbors' | 'triagePolicy'>;
type FindingRow = { payload: unknown };
export type CheckVersionEvidence = 'DECLARED_VERSION' | 'VERIFIED_ARCHIVE_SOURCE';
type CheckReceiptInput = { format: string; codeVersion: string; ruleVersion: string; source?: CheckVersionEvidence;
    execution?: 'FAILED' | 'PARTIAL' | 'UNAVAILABLE' };
type ContextPack = ReturnType<typeof contextPack>;
type ReportEvidence = Omit<ContextPack['evidence'][number], 'unitId' | 'kind' | 'language' | 'source' | 'relation'> & {
    unitId?: string; kind: string; language: string; source: string; relation: string;
};
export const findingVerdicts = ['TRUE_RISK', 'LIKELY_FALSE_POSITIVE', 'NEEDS_REVIEW'] as const;
export interface FindingReport {
    finding: ExternalFinding; located: boolean; locatedQualifiedName: string; verdict: typeof findingVerdicts[number];
    confidence: number; reasons: string[]; missingInfo: string[]; remediation: string; developerSummary: string;
    pack: Omit<ContextPack, 'evidence'> & { evidence: ReportEvidence[] };
    decisionEvidence: { source: string; reference: string; summary: string; applied: boolean }[];
    scope: string;
}
const feedbackVerdicts = {
    TRUE_POSITIVE: 'TRUE_RISK', FALSE_POSITIVE: 'LIKELY_FALSE_POSITIVE', NEEDS_REVIEW: 'NEEDS_REVIEW', FIXED: 'NEEDS_REVIEW'
} as const;

interface FindingReference {
    fingerprint: string; tool: string; ruleId: string; severity: ExternalFinding['severity'];
    filePath: string; startLine: number; endLine: number; version: 'MATCHED_DECLARED_VERSION' | 'UNVERIFIED';
}

function read(row: FindingRow) { return JSON.parse(String(row.payload)) as ExternalFinding; }

function sameFingerprint(a: ExternalFinding, b: ExternalFinding) {
    return a.tool === b.tool && a.ruleId === b.ruleId && a.filePath === b.filePath && a.startLine === b.startLine;
}

export class ExternalFindings {
    constructor(private readonly db: DatabaseSync) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS external_finding (
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL,
                tool TEXT NOT NULL, severity TEXT NOT NULL, file_path TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL,
                code_version TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project_id, fingerprint)
            );
            CREATE INDEX IF NOT EXISTS external_finding_location ON external_finding(project_id, file_path, start_line, end_line);
            CREATE TABLE IF NOT EXISTS external_finding_inventory (
                project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS external_finding_receipt (
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE, digest TEXT NOT NULL,
                format TEXT NOT NULL, code_version TEXT NOT NULL, rule_version TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('ZERO_FINDINGS','COMPLETED','PARTIAL','FAILED')), reported INTEGER NOT NULL,
                accepted INTEGER NOT NULL, captured_at TEXT NOT NULL, finding_keys TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(project_id,digest)
            );
            CREATE INDEX IF NOT EXISTS external_finding_receipt_version ON external_finding_receipt(project_id,code_version,format);
            CREATE TABLE IF NOT EXISTS external_finding_version (
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE, code_version TEXT NOT NULL,
                fingerprint TEXT NOT NULL, file_path TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL,
                payload TEXT NOT NULL, PRIMARY KEY(project_id,code_version,fingerprint)
            );
            CREATE INDEX IF NOT EXISTS external_finding_version_location ON external_finding_version(project_id,code_version,file_path,start_line,end_line);
        `);
        const columns = db.prepare("SELECT 1 FROM pragma_table_info('external_finding_receipt') WHERE name = 'finding_keys'").get();
        if (!columns) db.exec("ALTER TABLE external_finding_receipt ADD COLUMN finding_keys TEXT NOT NULL DEFAULT '[]'");
        const provenance = db.prepare("SELECT name FROM pragma_table_info('external_finding_receipt') WHERE name IN ('provenance','source_outcome')").all();
        if (!provenance.some(row => row.name === 'provenance')) {
            db.exec("ALTER TABLE external_finding_receipt ADD COLUMN provenance TEXT NOT NULL DEFAULT 'DECLARED_VERSION'");
        }
        if (!provenance.some(row => row.name === 'source_outcome')) db.exec('ALTER TABLE external_finding_receipt ADD COLUMN source_outcome TEXT');
    }

    private findingWriter() {
        const save = this.db.prepare('INSERT INTO external_finding VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        return (projectId: string, finding: ExternalFinding) => {
            const { fingerprint, tool, severity, filePath, startLine, endLine, codeVersion } = finding;
            save.run(projectId, fingerprint, tool, severity, filePath, startLine, endLine, codeVersion, JSON.stringify(finding));
        };
    }

    restoreInMigrationTransaction(records: { projectId: string; finding: ExternalFinding }[]) {
        const save = this.findingWriter();
        const activate = this.db.prepare('INSERT OR IGNORE INTO external_finding_inventory(project_id) VALUES (?)');
        for (const { projectId, finding } of records) {
            save(projectId, finding);
            activate.run(projectId);
        }
    }

    import(projectId: string, input: ReturnType<typeof normalizeFindings>, declared?: CheckReceiptInput) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = this.importInTransaction(projectId, input);
            if (declared?.codeVersion) this.recordCheckInTransaction(projectId, input, declared);
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    recordCheckInTransaction(projectId: string, input: ReturnType<typeof normalizeFindings>, stamp: CheckReceiptInput) {
        const { accepted, fingerprints } = this.captureVersion(projectId, stamp.codeVersion, input.findings);
        const complete = !input.truncated && !input.skipped.length && accepted === input.findings.length;
        const status = (stamp.execution === 'FAILED' || stamp.execution === 'UNAVAILABLE') && !input.findings.length ? 'FAILED'
            : !complete || stamp.execution ? 'PARTIAL' : input.reported ? 'COMPLETED' : 'ZERO_FINDINGS';
        const fingerprint = digest(JSON.stringify([stamp, input]));
        this.db.prepare(`INSERT OR IGNORE INTO external_finding_receipt
            (project_id,digest,format,code_version,rule_version,status,reported,accepted,captured_at,finding_keys,provenance,source_outcome)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(projectId, fingerprint, stamp.format, stamp.codeVersion, stamp.ruleVersion,
                status, input.reported, accepted, new Date().toISOString(), JSON.stringify(fingerprints), stamp.source ?? 'DECLARED_VERSION',
                stamp.execution === 'UNAVAILABLE' ? stamp.execution : null);
    }

    private captureVersion(projectId: string, version: string, findings: ExternalFinding[]) {
        let total = Number(this.db.prepare('SELECT count(*) AS n FROM external_finding_version WHERE project_id = ?').get(projectId)?.n ?? 0);
        const existing = this.db.prepare('SELECT payload FROM external_finding_version WHERE project_id = ? AND code_version = ? AND fingerprint = ?');
        const insert = this.db.prepare('INSERT INTO external_finding_version VALUES (?,?,?,?,?,?,?)');
        let accepted = 0;
        const fingerprints = new Set<string>();
        for (const finding of findings) {
            const prior = existing.get(projectId, version, finding.fingerprint) as FindingRow | undefined;
            if (prior && !sameFingerprint(read(prior), finding)) continue;
            if (!prior) {
                if (total >= MAX_PROJECT_FINDINGS) continue;
                insert.run(projectId, version, finding.fingerprint, finding.filePath, finding.startLine, finding.endLine, JSON.stringify(finding));
                total++;
            }
            accepted++;
            fingerprints.add(finding.fingerprint);
        }
        return { accepted, fingerprints: [...fingerprints] };
    }

    importInTransaction(projectId: string, input: ReturnType<typeof normalizeFindings>) {
        const { findings, skipped, reported, truncated } = input;
        let total = Number(this.db.prepare('SELECT count(*) AS n FROM external_finding WHERE project_id = ?').get(projectId)?.n ?? 0);
        const find = this.db.prepare('SELECT payload FROM external_finding WHERE project_id = ? AND fingerprint = ?');
        const legacy = this.db.prepare(`SELECT 1 FROM external_finding WHERE project_id = ? AND tool = ? AND file_path = ? AND start_line = ?
            AND json_extract(payload, '$.ruleId') = ? AND json_type(payload, '$.legacyScan') = 'object' LIMIT 1`);
        const save = this.findingWriter();
        let imported = 0, duplicates = 0, omitted = 0, conflicts = 0;
        for (const finding of findings) {
            const existing = find.get(projectId, finding.fingerprint) as FindingRow | undefined;
            if (existing) {
                if (sameFingerprint(read(existing), finding)) duplicates++;
                else conflicts++;
                continue;
            }
            if (legacy.get(projectId, finding.tool, finding.filePath, finding.startLine, finding.ruleId)) {
                duplicates++;
                continue;
            }
            if (total >= MAX_PROJECT_FINDINGS) { omitted++; continue; }
            save(projectId, finding);
            imported++;
            total++;
        }
        if (imported || duplicates || reported === 0) {
            this.db.prepare('INSERT OR IGNORE INTO external_finding_inventory(project_id) VALUES (?)').run(projectId);
        }
        return { projectId, imported, duplicates, skipped, reported, truncated, omitted, conflicts };
    }

    available(projectId: string) {
        return !!this.db.prepare('SELECT 1 FROM external_finding_inventory WHERE project_id = ?').get(projectId);
    }

    reviewChecks(projectId: string, versions: readonly string[]) {
        return this.db.prepare(`SELECT format AS tool, digest AS receipt, code_version AS codeVersion, rule_version AS ruleVersion,
            coalesce(source_outcome,status) AS status, reported, accepted, captured_at AS capturedAt, provenance FROM external_finding_receipt
            WHERE rowid IN (SELECT max(rowid) FROM external_finding_receipt WHERE project_id = ?
                AND code_version IN (SELECT value FROM json_each(?)) GROUP BY format) ORDER BY format`)
            .all(projectId, JSON.stringify(versions)) as unknown as { tool: string; receipt: string; codeVersion: string; ruleVersion: string;
                status: 'ZERO_FINDINGS' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'UNAVAILABLE'; reported: number; accepted: number;
                capturedAt: string; provenance: CheckVersionEvidence }[];
    }

    reviewObservations(projectId: string, versions: readonly string[], limit: number) {
        const rows = this.db.prepare(`SELECT DISTINCT f.code_version, f.fingerprint, f.payload, r.provenance FROM external_finding_receipt r,
            json_each(r.finding_keys) ids JOIN external_finding_version f
                ON f.project_id = r.project_id AND f.code_version = r.code_version AND f.fingerprint = ids.value
            WHERE r.rowid IN (SELECT max(rowid) FROM external_finding_receipt WHERE project_id = ?
                AND code_version IN (SELECT value FROM json_each(?)) GROUP BY format)
            ORDER BY f.code_version, f.fingerprint, r.provenance DESC LIMIT ?`).all(projectId, JSON.stringify(versions), limit + 1) as
            (FindingRow & { provenance: CheckVersionEvidence })[];
        return { findings: rows.slice(0, limit).map(row => ({ ...read(row), versionEvidence: row.provenance })), truncated: rows.length > limit };
    }

    get(projectId: string, fingerprint: string) {
        const row = this.db.prepare('SELECT payload FROM external_finding WHERE project_id = ? AND fingerprint = ?')
            .get(projectId, fingerprint) as FindingRow | undefined;
        return row ? read(row) : undefined;
    }

    list(projectId: string, tool: string | null, severity: string | null, limit: number, offset: number) {
        const scope = 'WHERE project_id = ? AND (? IS NULL OR tool = ?) AND (? IS NULL OR severity = ?)';
        const args = [projectId, tool, tool, severity, severity];
        const total = Number(this.db.prepare('SELECT count(*) AS n FROM external_finding ' + scope).get(...args)?.n ?? 0);
        const rows = this.db.prepare('SELECT payload FROM external_finding ' + scope + ' ORDER BY rowid DESC LIMIT ? OFFSET ?')
            .all(...args, limit, offset) as FindingRow[];
        return { projectId, findings: rows.map(read), total, limit, offset, hasMore: offset + rows.length < total };
    }

    references(projectId: string, path: string, ranges: { startLine: number; endLine: number }[], target: string | readonly string[]) {
        if (!ranges.length) return { references: [] as FindingReference[], truncated: false };
        const intersects = `EXISTS (SELECT 1 FROM json_each(?) AS span
            WHERE f.start_line <= json_extract(span.value, '$.endLine') AND f.end_line >= json_extract(span.value, '$.startLine'))`;
        const rows = (typeof target === 'string' ? this.db.prepare(`SELECT payload FROM external_finding f
                WHERE project_id = ? AND file_path = ? AND (? = '' OR code_version = '' OR code_version = ?) AND ${intersects}
                ORDER BY (code_version = ? AND code_version <> '') DESC, start_line, fingerprint LIMIT ?`)
                .all(projectId, path, target, target, JSON.stringify(ranges), target, MAX_CHANGE_REFERENCES + 1)
            : this.db.prepare(`SELECT f.payload FROM external_finding_version f
                WHERE f.project_id = ? AND f.file_path = ? AND ${intersects}
                    AND EXISTS (SELECT 1 FROM external_finding_receipt r, json_each(r.finding_keys) ids
                        WHERE r.project_id = f.project_id AND r.code_version = f.code_version AND ids.value = f.fingerprint
                            AND r.rowid IN (SELECT max(rowid) FROM external_finding_receipt WHERE project_id = f.project_id
                                AND code_version IN (SELECT value FROM json_each(?)) GROUP BY format))
                ORDER BY f.start_line, f.fingerprint LIMIT ?`)
                .all(projectId, path, JSON.stringify(ranges), JSON.stringify(target), MAX_CHANGE_REFERENCES + 1)) as FindingRow[];
        const references = rows.slice(0, MAX_CHANGE_REFERENCES).map(row => {
            const { fingerprint, tool, ruleId, severity, filePath, startLine, endLine, codeVersion } = read(row);
            return { fingerprint, tool: findingPublicText(tool, 120), ruleId: findingPublicText(ruleId, 500), severity,
                filePath: findingPublicText(filePath, 4096), startLine, endLine,
                version: codeVersion && (typeof target === 'string' ? codeVersion === target : target.includes(codeVersion))
                    ? 'MATCHED_DECLARED_VERSION' as const : 'UNVERIFIED' as const };
        });
        return { references, truncated: rows.length > MAX_CHANGE_REFERENCES };
    }
}

export function findingContext(index: Omit<ReportIndex, 'triagePolicy'>, projectId: string, finding: ExternalFinding, budget: number) {
    const noSolidityIndex = finding.tool.toLowerCase() === 'slither';
    let unit = noSolidityIndex ? undefined : index.locate(finding.filePath, finding.startLine, projectId);
    let match = unit ? 'FILE_LINE' : 'UNLOCATED';
    if (!unit && finding.symbol && !noSolidityIndex) {
        try { unit = index.symbol(finding.symbol, projectId); }
        catch (error) { if (!(error instanceof HttpError) || error.status !== 409) throw error; }
        if (unit) match = 'SYMBOL';
    }
    const name = unit ? findingPublicText(unit.qualifiedName, 500) : '';
    const sensitive = !!unit && isSensitiveReviewPath(unit.filePath);
    const ranked: RankedUnit[] = [];
    const seen = new Set<string>();
    function cite(candidate: CodeUnit, source: RankedUnit['source'], relation: RankedUnit['relation'], finalScore: number) {
        if (seen.has(candidate.id) || isSensitiveReviewPath(candidate.filePath) || !candidate.rawSource.trim()) return;
        const rawSource = redactReviewText(candidate.rawSource.slice(0, budget + 1))
            + (candidate.rawSource.length > budget + 1 ? '…' : '');
        const excerpt = { ...candidate, qualifiedName: findingPublicText(candidate.qualifiedName, 500), rawSource };
        const signals = securitySignals(excerpt);
        ranked.push({ projectId, unit: excerpt, source, relation, finalScore, vectorScore: 0,
            securityScore: signals.score, securitySignals: signals.matches });
        seen.add(candidate.id);
    }
    const callers = unit && !sensitive ? index.graphNeighbors(unit.id, 'callers', 1, 8) : [];
    if (unit && !sensitive) {
        cite(unit, 'FINDING', 'SEED', 1);
        for (const candidate of callers) cite(candidate, 'CALL_GRAPH', 'CALLER', 0.6);
        for (const candidate of index.graphNeighbors(unit.id, 'callees', 1, 8)) cite(candidate, 'CALL_GRAPH', 'CALLEE', 0.5);
    }
    const pack = contextPack(findingPublicText(finding.filePath, 4096), 'external-finding', budget, {
        results: ranked, omittedReasons: [], seedCount: Number(ranked.some(item => item.source === 'FINDING')), keywordSeedCount: 0,
        callGraphExpanded: ranked.filter(item => item.source === 'CALL_GRAPH').length, impactExpanded: 0, securityHighlightCount: 0
    });
    const missingInfo = [unit ? null : 'FINDING_LOCATION_UNINDEXED', noSolidityIndex ? 'SOLIDITY_INDEX_UNAVAILABLE' : null,
        match === 'SYMBOL' ? 'FINDING_SYMBOL_FALLBACK' : null,
        sensitive ? 'SENSITIVE_FILE_CONTENT_MASKED' : null, 'FINDING_REPORT_VERSION_UNVERIFIED', ...pack.omittedReasons].filter(Boolean) as string[];
    return { projectId, finding, pack, missingInfo, located: !!unit, name, match, callerCount: callers.length,
        preciseSource: !!unit && unit.metadata.heuristic !== 'true' && unit.metadata.bytecode !== 'true' };
}

export function reviewFindingContext(policyStore: ReportIndex['triagePolicy'], context: ReturnType<typeof findingContext>) {
    const { projectId, finding, pack, missingInfo, located, name, match, callerCount, preciseSource } = context;
    const report: FindingReport = { finding, located, locatedQualifiedName: name, verdict: 'NEEDS_REVIEW', confidence: 0,
        reasons: [match === 'FILE_LINE' ? 'FINDING_LOCATION_MAPPED' : match === 'SYMBOL' ? 'FINDING_SYMBOL_FALLBACK' : 'FINDING_LOCATION_UNINDEXED'],
        missingInfo: [...missingInfo], remediation: '', developerSummary: 'External scan result pending human review.', pack,
        decisionEvidence: [], scope: projectId };
    const location = pack.evidence.find(item => item.source === 'FINDING');
    const protection = findingProtection(finding, pack.evidence);
    const security = location?.securitySignals.filter(signal => signal !== 'entry_point') ?? [];
    const entryPoint = location?.securitySignals.includes('entry_point') ?? false;
    const callable = pack.evidence.filter(item => item.relation === 'CALLER');
    const reachable = entryPoint || !!callable.length;
    const risk = match === 'FILE_LINE' && preciseSource && !!security.length && reachable;
    report.confidence = location ? 0.5 : 0.2;
    report.remediation = protection.remediation;
    if (finding.traceIncomplete) report.missingInfo.push('FINDING_SOURCE_SINK_TRACE_INCOMPLETE');
    else if (!finding.trace.length) report.missingInfo.push('FINDING_SOURCE_SINK_TRACE_UNAVAILABLE');
    if (risk) {
        report.reasons.push(`[${location?.citationId}] Static security signals: ${security.join(', ')}`);
        if (entryPoint) report.reasons.push(`[${location?.citationId}] Indexed framework or program entry point.`);
        if (callable.length) report.reasons.push(`Indexed callers: ${callable.map(item => '[' + item.citationId + ']').join(', ')}.`);
        if (protection.covered) {
            report.confidence = 0.75;
            report.developerSummary = 'Reported paths contain protection candidates. Verify their effect and conditions during review.';
            report.missingInfo.push('FINDING_PROTECTION_RUNTIME_UNVERIFIED');
        } else {
            report.verdict = 'TRUE_RISK';
            report.confidence = Math.min(0.9, 0.5 + 0.1 * security.length + 0.05 * callable.length);
            report.developerSummary = 'Indexed reachability and security-related code support review of this finding.';
        }
    } else if (match === 'FILE_LINE' && preciseSource && location && !location.truncated && protection.remediation
        && !finding.trace.length && !finding.traceIncomplete && !entryPoint && !callerCount && !security.length) {
        report.verdict = 'LIKELY_FALSE_POSITIVE';
        report.confidence = 0.6;
        report.developerSummary = 'The indexed code has no matching security signals or known callers. Verify reachability before dismissal.';
    }
    for (const item of protection.evidence) {
        report.decisionEvidence.push({ source: 'PATH_PROTECTION', reference: item.citationId, summary: item.summary,
            applied: risk && protection.covered && item.covered });
    }
    const { feedback, feedbackMatches, policy } = policyStore.evidence(projectId, finding);
    if (policy) {
        report.verdict = 'LIKELY_FALSE_POSITIVE';
        report.confidence = Math.max(report.confidence, 0.9);
        report.reasons.push('RULE_SUPPRESSION');
        report.developerSummary = 'An active suppression covers this finding.';
        report.decisionEvidence.push({ source: 'RULE_SUPPRESSION', reference: policy.id, applied: true,
            summary: [policy.scope, findingPublicText(policy.scopeValue, 256), policy.reason, policy.createdBy, policy.expiresAt]
                .filter(Boolean).join(' · ') });
    }
    if (feedback) {
        report.decisionEvidence.push({ source: 'HISTORICAL_FEEDBACK', reference: feedback.fingerprint, applied: feedbackMatches,
            summary: [feedback.status, feedback.reviewer, feedback.reason, feedback.codeVersion, feedback.ruleVersion].filter(Boolean).join(' · ') });
        if (feedbackMatches) {
            report.verdict = feedbackVerdicts[feedback.status];
            report.confidence = Math.max(report.confidence, feedback.status === 'TRUE_POSITIVE' ? 0.95 : 0.9);
            report.reasons.push('HISTORICAL_FEEDBACK');
            report.developerSummary = 'Human feedback matches the declared code and rule versions.';
        } else {
            report.missingInfo.push('FINDING_FEEDBACK_VERSION_MISMATCH');
        }
    }
    return report;
}

export function findingReport(index: ReportIndex, projectId: string, finding: ExternalFinding, budget: number) {
    const report = reviewFindingContext(index.triagePolicy, findingContext(index, projectId, finding, budget));
    return { fingerprint: finding.fingerprint, finding, report, markdown: findingMarkdown(report) };
}

function findingMarkdown(report: FindingReport) {
    const { finding } = report;
    const escape = (value: string) => value.replace(/[\r\n\u2028\u2029]+/g, ' ').trim().replace(/&/g, '&amp;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+!|~=-]/g, '\\$&')
        .replace(/^(\d+)\.(?=\s)/, '$1\\.');
    const bullet = (value: string) => '- ' + escape(value);
    const decisions = report.decisionEvidence.map(item =>
        [item.source, item.applied ? 'Applied' : 'Skipped', item.reference, item.summary].filter(Boolean).join(' · '));
    const citations = report.pack.evidence.map(item =>
        [item.citationId, item.qualifiedName, item.filePath + ':' + item.startLine + '–' + item.endLine,
            item.source + '/' + item.relation].join(' · '));
    return [
        '# External finding', '', bullet(finding.tool + ' · ' + finding.ruleId),
        bullet(findingPublicText(finding.filePath, 4096) + ':' + finding.startLine + '–' + finding.endLine + ' · '
            + [finding.severity, finding.cwe, report.locatedQualifiedName].filter(Boolean).join(' · ')),
        bullet(report.verdict + ' · confidence ' + report.confidence.toFixed(2)),
        '', escape(finding.message), '',
        '## Assessment', '', escape(report.developerSummary), '', ...report.reasons.map(bullet), '',
        '## Evidence', '', ...(citations.length ? citations.map(bullet) : ['No indexed evidence.']), '',
        ...(decisions.length ? ['## Decision evidence', '', ...decisions.map(bullet), ''] : []),
        ...(report.missingInfo.length ? ['## Missing information', '', ...report.missingInfo.map(bullet), ''] : []),
        ...(report.remediation ? ['## Remediation', '', escape(report.remediation), ''] : [])
    ].join('\n');
}
