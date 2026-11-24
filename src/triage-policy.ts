import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { findingPublicText } from './finding-import.js';
import type { ExternalFinding } from './finding-import.js';
import { HttpError } from './http-error.js';
import { relativeEvidencePath } from './project-file.js';

export const feedbackStatus = z.enum(['TRUE_POSITIVE', 'FALSE_POSITIVE', 'NEEDS_REVIEW', 'FIXED']);
const projectId = z.string().regex(/^[a-f0-9]{12}$/).optional();
const reason = z.string().trim().min(1).max(500).transform(value => findingPublicText(value, 500)).pipe(z.string().min(1));
const expiresAt = z.iso.datetime({ offset: true });
const version = z.string().trim().max(256).refine(value => value === findingPublicText(value, 256));
export function declaredFindingVersion(value: string | null) {
    const parsed = version.safeParse(value ?? '');
    return parsed.success ? parsed.data : '';
}

export const feedbackInput = z.object({
    projectId, fingerprint: z.string().regex(/^[a-f0-9]{16}$/),
    status: z.string().trim().toUpperCase().pipe(feedbackStatus),
    reason: z.string().trim().max(500).transform(value => findingPublicText(value, 500)).default(''),
    codeVersion: version.default(''), ruleVersion: version.default('')
});
export const suppressionInput = z.object({
    projectId, ruleId: z.string().trim().min(1).max(500).refine(value => value === findingPublicText(value, 500)),
    scope: z.string().trim().toUpperCase().pipe(z.enum(['PROJECT', 'FILE_GLOB'])),
    scopeValue: z.string().trim().max(256).default(''), reason, expiresAt
});
export const suppressionRevoke = z.object({ reason });
export const suppressionId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

type Feedback = Omit<z.infer<typeof feedbackInput>, 'projectId'> & { projectId: string; reviewer: string; updatedAt: string };
type Suppression = Omit<z.infer<typeof suppressionInput>, 'projectId'> & {
    id: string; projectId: string; createdBy: string; createdAt: string; active: boolean;
};
type SuppressionRow = Omit<Suppression, 'active'> & { active: number };
type AuditEvent = { id: string; suppressionId: string; action: 'CREATED' | 'REVOKED'; actor: string; reason: string; occurredAt: string };

const feedbackColumns = `fingerprint, project_id AS projectId, status, reviewer, reason,
    code_version AS codeVersion, rule_version AS ruleVersion, updated_at AS updatedAt`;
const suppressionColumns = `id, project_id AS projectId, rule_id AS ruleId, scope, scope_value AS scopeValue,
    reason, created_by AS createdBy, created_at AS createdAt, expires_at AS expiresAt, active`;

function suppressionValue(row: SuppressionRow): Suppression { return { ...row, active: row.active === 1 }; }

// Preserve the legacy glob dialect with one pass per pattern token and no regex backtracking.
function matchesGlob(pattern: string, path: string) {
    const characters = Array.from(path);
    const tokens = Array.from(pattern);
    let matches = new Uint8Array(characters.length + 1);
    let next = new Uint8Array(matches.length);
    matches[0] = 1;
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        next.fill(0);
        if (token === '*') {
            const double = tokens[index + 1] === '*';
            if (double) index++;
            next[0] = matches[0];
            for (let end = 1; end <= characters.length; end++) {
                next[end] = matches[end] || ((double || characters[end - 1] !== '/') ? next[end - 1] : 0);
            }
        } else {
            for (let end = 1; end <= characters.length; end++) {
                if (token === characters[end - 1] || (token === '?' && characters[end - 1] !== '/')) next[end] = matches[end - 1];
            }
        }
        [matches, next] = [next, matches];
    }
    return matches[characters.length] === 1;
}

export class TriagePolicy {
    constructor(private readonly db: DatabaseSync) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS triage_feedback (
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL,
                status TEXT NOT NULL, reviewer TEXT NOT NULL, reason TEXT NOT NULL,
                code_version TEXT NOT NULL, rule_version TEXT NOT NULL, updated_at TEXT NOT NULL,
                PRIMARY KEY(project_id, fingerprint)
            );
            CREATE TABLE IF NOT EXISTS rule_suppression (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                rule_id TEXT NOT NULL, scope TEXT NOT NULL, scope_value TEXT NOT NULL, reason TEXT NOT NULL,
                created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, active INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS rule_suppression_project ON rule_suppression(project_id, rule_id, active, created_at);
            CREATE TABLE IF NOT EXISTS rule_suppression_event (
                id TEXT PRIMARY KEY, suppression_id TEXT NOT NULL REFERENCES rule_suppression(id) ON DELETE CASCADE,
                action TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL, occurred_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS rule_suppression_event_scope ON rule_suppression_event(suppression_id);
        `);
    }

    record(projectId: string, reviewer: string, input: z.infer<typeof feedbackInput>) {
        const feedback: Feedback = { ...input, projectId, reviewer, updatedAt: new Date().toISOString() };
        this.writeFeedback(feedback);
        return feedback;
    }

    listFeedback(projectId: string, status: z.infer<typeof feedbackStatus> | null) {
        return this.db.prepare(`SELECT ${feedbackColumns} FROM triage_feedback WHERE project_id = ? AND (? IS NULL OR status = ?)
            ORDER BY updated_at DESC, fingerprint`).all(projectId, status, status) as Feedback[];
    }

    create(projectId: string, actor: string, input: z.infer<typeof suppressionInput>) {
        const scopeValue = input.scope === 'FILE_GLOB' ? relativeEvidencePath(input.scopeValue) : '';
        if (input.scope === 'FILE_GLOB' && !scopeValue) throw new HttpError(400, 'INVALID_SUPPRESSION_GLOB');
        const expiry = new Date(input.expiresAt);
        const now = new Date();
        if (!(expiry.getTime() > now.getTime())) throw new HttpError(400, 'INVALID_SUPPRESSION_EXPIRY');
        const policy: Suppression = { ...input, projectId, scopeValue, id: randomUUID(), createdBy: actor,
            createdAt: now.toISOString(), expiresAt: expiry.toISOString(), active: true };
        return this.transaction(() => {
            this.writeSuppression(policy);
            this.writeAudit({ id: randomUUID(), suppressionId: policy.id, action: 'CREATED', actor, reason: policy.reason, occurredAt: policy.createdAt });
            return policy;
        });
    }

    listSuppressions(projectId: string, ruleId: string | null) {
        return (this.db.prepare(`SELECT ${suppressionColumns} FROM rule_suppression WHERE project_id = ? AND (? IS NULL OR rule_id = ?)
            ORDER BY created_at DESC, rowid DESC`).all(projectId, ruleId, ruleId) as SuppressionRow[]).map(suppressionValue);
    }

    scope(id: string) {
        return this.db.prepare('SELECT project_id AS projectId FROM rule_suppression WHERE id = ?').get(id) as { projectId: string } | undefined;
    }

    revoke(id: string, projectId: string, actor: string, reason: string) {
        return this.transaction(() => {
            const result = this.db.prepare('UPDATE rule_suppression SET active = 0 WHERE id = ? AND project_id = ? AND active = 1')
                .run(id, projectId);
            if (!result.changes) throw new HttpError(404, 'SUPPRESSION_NOT_FOUND');
            this.writeAudit({ id: randomUUID(), suppressionId: id, action: 'REVOKED', actor, reason, occurredAt: new Date().toISOString() });
            return { id, status: 'REVOKED' as const };
        });
    }

    audit(id: string) {
        return this.db.prepare(`SELECT id, suppression_id AS suppressionId, action, actor, reason, occurred_at AS occurredAt
            FROM rule_suppression_event WHERE suppression_id = ? ORDER BY occurred_at, rowid`).all(id) as AuditEvent[];
    }

    restoreInMigrationTransaction(data: { feedback: Feedback[]; suppressions: Suppression[]; events: AuditEvent[] }) {
        for (const item of data.feedback) this.writeFeedback(item);
        for (const item of data.suppressions) this.writeSuppression(item);
        for (const item of data.events) this.writeAudit(item);
    }

    evidence(projectId: string, finding: ExternalFinding, now = new Date().toISOString()) {
        const feedback = this.db.prepare(`SELECT ${feedbackColumns} FROM triage_feedback WHERE project_id = ? AND fingerprint = ?`)
            .get(projectId, finding.fingerprint) as Feedback | undefined;
        const feedbackMatches = !!feedback && !!finding.codeVersion && !!finding.ruleVersion
            && finding.codeVersion === feedback.codeVersion && finding.ruleVersion === feedback.ruleVersion;
        const policies = this.db.prepare(`SELECT ${suppressionColumns} FROM rule_suppression
            WHERE project_id = ? AND rule_id = ? AND active = 1 AND expires_at > ? ORDER BY created_at DESC, rowid DESC`)
            .iterate(projectId, finding.ruleId, now);
        for (const row of policies) {
            const policy = suppressionValue(row as SuppressionRow);
            if (policy.scope === 'PROJECT' || matchesGlob(policy.scopeValue, finding.filePath)) return { feedback, feedbackMatches, policy };
        }
        return { feedback, feedbackMatches, policy: undefined };
    }

    private writeFeedback(value: Feedback) {
        this.db.prepare(`INSERT INTO triage_feedback VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, fingerprint) DO UPDATE SET status = excluded.status, reviewer = excluded.reviewer,
            reason = excluded.reason, code_version = excluded.code_version, rule_version = excluded.rule_version, updated_at = excluded.updated_at`)
            .run(value.projectId, value.fingerprint, value.status, value.reviewer, value.reason, value.codeVersion, value.ruleVersion, value.updatedAt);
    }

    private writeSuppression(value: Suppression) {
        this.db.prepare('INSERT INTO rule_suppression VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(value.id, value.projectId, value.ruleId, value.scope, value.scopeValue, value.reason,
                value.createdBy, value.createdAt, value.expiresAt, Number(value.active));
    }

    private writeAudit(value: AuditEvent) {
        this.db.prepare('INSERT INTO rule_suppression_event VALUES (?, ?, ?, ?, ?, ?)')
            .run(value.id, value.suppressionId, value.action, value.actor, value.reason, value.occurredAt);
    }

    private transaction<T>(write: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = write();
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
}
