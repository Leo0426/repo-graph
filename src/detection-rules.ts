import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { findingPublicText } from './finding-import.js';
import { HttpError } from './http-error.js';
import type { ReviewQueue } from './review-queue.js';
import { assertRuleSamples } from './rule-regression.js';
import type { TriagePolicy } from './triage-policy.js';

export const matcherKinds = ['REGEX', 'SUBSTRING'] as const;
export const ruleStatuses = ['CANDIDATE', 'IN_REVIEW', 'PUBLISHED', 'REJECTED', 'ROLLED_BACK'] as const;
export const ruleSeverities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN'] as const;
export const ruleActions = ['CREATED', 'SUBMITTED_FOR_REVIEW', 'SUPERSEDED', 'PUBLISHED', 'REJECTED', 'ROLLED_BACK', 'RESTORED'] as const;
const ruleText = (size: number) => z.string().trim().min(1).max(size).refine(value => !/[\x00-\x1f\x7f-\x9f]/.test(value));
export const ruleIdSchema = ruleText(500);
const reasonInput = z.string().trim().min(1).max(500).transform(value => findingPublicText(value, 500)).pipe(z.string().min(1));
const sample = z.string().min(1).max(4096).refine(value => !value.includes('\0'));
export const ruleInput = z.object({
    ruleId: ruleIdSchema, source: ruleText(256), cwe: ruleText(100), title: ruleText(500), severity: z.enum(ruleSeverities),
    matcherKind: z.enum(matcherKinds), pattern: z.string().trim().min(1).max(4096).refine(value => !value.includes('\0')),
    languages: z.array(ruleText(120)).min(1).max(32), frameworks: z.array(ruleText(120)).max(32).default([]),
    positiveSamples: z.array(sample).min(1).max(32), negativeSamples: z.array(sample).min(1).max(32),
    changeNotes: ruleText(1000), reason: reasonInput
});
export const ruleAction = z.object({ reason: reasonInput });
type Draft = Omit<z.infer<typeof ruleInput>, 'reason'>;
export interface DetectionRule extends Draft {
    version: number; status: typeof ruleStatuses[number]; active: boolean; createdAt: string; updatedAt: string;
    regexEngine?: 'JAVA' | 'ECMASCRIPT';
}
export interface RuleAudit {
    id: string; ruleId: string; version: number; action: typeof ruleActions[number]; actor: string; reason: string; occurredAt: string;
}
const count = z.number().int().min(0);
const rate = z.number().min(0).max(1).nullable();
export const ruleMetricSchema = z.object({ hits: count, confirmed: count, falsePositives: count, needsReview: count,
    confirmationRate: rate, falsePositiveRate: rate, suppressionRate: rate, noContextRate: rate });
export const ruleEvaluationSchema = z.object({
    ruleId: ruleIdSchema, version: z.number().int().positive(), projectId: z.string().regex(/^[a-f0-9]{12}$/),
    metrics: ruleMetricSchema, regression: z.array(z.object({ metric: z.string(), previous: z.number().nullable(),
        current: z.number().nullable(), delta: z.number().nullable() })),
    omittedReasons: z.array(z.string()), generatedAt: z.iso.datetime({ offset: true })
});
export type RuleEvaluation = z.infer<typeof ruleEvaluationSchema>;

type StateRow = { payload: string; status: DetectionRule['status']; active: number; updated_at: string };
function fromRow(row: StateRow | undefined) {
    return row ? { ...(JSON.parse(row.payload) as DetectionRule), status: row.status, active: row.active === 1, updatedAt: row.updated_at } : undefined;
}

export class DetectionRules {
    constructor(private readonly db: DatabaseSync) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS detection_rule (
                rule_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0, 1)),
                updated_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(rule_id, version), CHECK(active = 0 OR status = 'PUBLISHED')
            );
            CREATE UNIQUE INDEX IF NOT EXISTS detection_rule_active ON detection_rule(rule_id) WHERE active = 1;
            CREATE TABLE IF NOT EXISTS detection_rule_event (
                id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, version INTEGER NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL,
                reason TEXT NOT NULL, occurred_at TEXT NOT NULL, FOREIGN KEY(rule_id, version) REFERENCES detection_rule(rule_id, version)
            );
            CREATE INDEX IF NOT EXISTS detection_rule_event_scope ON detection_rule_event(rule_id);
            CREATE TABLE IF NOT EXISTS detection_rule_evaluation (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                rule_id TEXT NOT NULL, version INTEGER NOT NULL, generated_at TEXT NOT NULL, payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS detection_rule_evaluation_scope ON detection_rule_evaluation(project_id, rule_id, generated_at DESC);
        `);
    }

    create(input: z.infer<typeof ruleInput>, actor: string) {
        const { reason, ...draft } = input;
        return this.write(() => {
            const prev = Number(this.db.prepare('SELECT max(version) AS current FROM detection_rule WHERE rule_id = ?').get(draft.ruleId)?.current ?? 0);
            if (prev >= 2_147_483_647) throw new HttpError(409, 'RULE_VERSION_LIMIT');
            const now = new Date().toISOString();
            const rule: DetectionRule = { ...draft, version: prev + 1, status: 'CANDIDATE', active: false, createdAt: now, updatedAt: now };
            this.addRule(rule);
            this.record(rule, 'CREATED', actor, reason, now);
            return rule;
        });
    }

    get(ruleId: string, version: number) {
        return fromRow(this.db.prepare('SELECT * FROM detection_rule WHERE rule_id = ? AND version = ?').get(ruleId, version) as StateRow | undefined);
    }

    active(ruleId: string) {
        return fromRow(this.db.prepare('SELECT * FROM detection_rule WHERE rule_id = ? AND active = 1').get(ruleId) as StateRow | undefined);
    }

    list(ruleId: string | null, limit: number, offset: number) {
        return (this.db.prepare('SELECT * FROM detection_rule WHERE (? IS NULL OR rule_id = ?) ORDER BY rule_id, version DESC LIMIT ? OFFSET ?')
            .all(ruleId, ruleId, limit, offset) as StateRow[]).map(row => fromRow(row)!);
    }

    audit(ruleId: string, limit: number, offset: number) {
        return this.db.prepare(`SELECT id, rule_id AS ruleId, version, action, actor, reason, occurred_at AS occurredAt
            FROM detection_rule_event WHERE rule_id = ? ORDER BY rowid LIMIT ? OFFSET ?`).all(ruleId, limit, offset);
    }

    evaluations(projectId: string, ruleId: string, limit: number, offset: number) {
        return this.db.prepare(`SELECT payload FROM detection_rule_evaluation WHERE project_id = ? AND rule_id = ?
            ORDER BY julianday(generated_at) DESC, rowid DESC LIMIT ? OFFSET ?`).all(projectId, ruleId, limit, offset)
            .map(row => JSON.parse(String(row.payload)) as RuleEvaluation);
    }

    evaluate(projectId: string, ruleId: string, queue: Pick<ReviewQueue, 'ruleReports'>, triage: Pick<TriagePolicy, 'evidence'>) {
        return this.write(() => {
            const active = this.active(ruleId);
            const rule = active ?? this.list(ruleId, 1, 0)[0];
            if (!rule) throw new HttpError(404, 'RULE_NOT_FOUND');
            const generatedAt = new Date().toISOString();
            const omissions = new Set<string>();
            if (!active) omissions.add('RULE_EVALUATION_NO_ACTIVE_VERSION');
            let hits = 0, confirmed = 0, falsePositives = 0, needsReview = 0, suppressed = 0, noContext = 0;
            for (const report of queue.ruleReports(projectId, ruleId)) {
                hits++;
                if (!report) { omissions.add('RULE_EVALUATION_REPORT_UNAVAILABLE'); continue; }
                const { feedback, feedbackMatches, policy } = triage.evidence(projectId, report.finding, generatedAt);
                if (report.finding.filePath && policy) suppressed++;
                if (!report.located) noContext++;
                if (feedback && !feedbackMatches) omissions.add('RULE_EVALUATION_FEEDBACK_VERSION_MISMATCH');
                if (!feedbackMatches) continue;
                if (feedback?.status === 'TRUE_POSITIVE' || feedback?.status === 'FIXED') confirmed++;
                if (feedback?.status === 'FALSE_POSITIVE') falsePositives++;
                if (feedback?.status === 'NEEDS_REVIEW') needsReview++;
            }
            if (hits === 0) omissions.add('RULE_EVALUATION_NO_HITS');
            const reviewed = confirmed + falsePositives;
            const metrics = { hits, confirmed, falsePositives, needsReview, confirmationRate: reviewed ? confirmed / reviewed : null,
                falsePositiveRate: reviewed ? falsePositives / reviewed : null, suppressionRate: hits ? suppressed / hits : null,
                noContextRate: hits ? noContext / hits : null };
            const previous = this.evaluations(projectId, ruleId, 1, 0)[0]?.metrics;
            const regression = previous ? (Object.keys(metrics) as (keyof typeof metrics)[]).map(metric => {
                const before = previous[metric], current = metrics[metric];
                return { metric, previous: before, current, delta: before === null || current === null ? null : current - before };
            }) : [];
            const report = { ruleId, version: rule.version, projectId, generatedAt, metrics, regression, omittedReasons: [...omissions] };
            this.evaluationWriter()(randomUUID(), report);
            return report;
        });
    }

    transition(ruleId: string, version: number, action: 'review' | 'reject', actor: string, reason: string) {
        return this.write(() => {
            const rule = this.requireStatus(ruleId, version, action === 'review' ? 'CANDIDATE' : 'IN_REVIEW');
            const now = new Date().toISOString();
            this.change(rule, action === 'review' ? 'IN_REVIEW' : 'REJECTED', false, now);
            this.record(rule, action === 'review' ? 'SUBMITTED_FOR_REVIEW' : 'REJECTED', actor, reason, now);
            return this.get(ruleId, version)!;
        });
    }

    async publish(ruleId: string, version: number, actor: string, reason: string, signal: AbortSignal, authorize: () => void) {
        const draft = this.requireStatus(ruleId, version, 'IN_REVIEW');
        await assertRuleSamples(draft, signal);
        if (signal.aborted) throw new HttpError(409, 'RULE_REGRESSION_CANCELLED');
        authorize();
        return this.write(() => {
            const rule = this.requireStatus(ruleId, version, 'IN_REVIEW');
            const now = new Date().toISOString();
            const previous = this.active(ruleId);
            if (previous) {
                this.change(previous, 'PUBLISHED', false, previous.updatedAt);
                this.record(previous, 'SUPERSEDED', actor, reason, now);
            }
            this.change(rule, 'PUBLISHED', true, now);
            this.record(rule, 'PUBLISHED', actor, reason, now);
            return this.get(ruleId, version)!;
        });
    }

    rollback(ruleId: string, actor: string, reason: string) {
        return this.write(() => {
            const current = this.active(ruleId);
            if (!current) throw new HttpError(409, 'ACTIVE_RULE_REQUIRED');
            const previous = fromRow(this.db.prepare(`SELECT * FROM detection_rule WHERE rule_id = ? AND version < ?
                AND status = 'PUBLISHED' ORDER BY version DESC LIMIT 1`).get(ruleId, current.version) as StateRow | undefined);
            if (!previous) throw new HttpError(409, 'PREVIOUS_RULE_REQUIRED');
            const now = new Date().toISOString();
            this.change(current, 'ROLLED_BACK', false, now);
            this.change(previous, 'PUBLISHED', true, now);
            this.record(current, 'ROLLED_BACK', actor, reason, now);
            this.record(previous, 'RESTORED', actor, reason, now);
            return this.get(ruleId, previous.version)!;
        });
    }

    restoreInMigrationTransaction(rules: DetectionRule[], events: RuleAudit[], evaluations: { id: string; report: RuleEvaluation }[]) {
        for (const rule of rules) this.addRule(rule);
        for (const event of events) this.addEvent(event);
        const save = this.evaluationWriter();
        for (const { id, report } of evaluations) save(id, report);
    }

    private evaluationWriter() {
        const save = this.db.prepare('INSERT INTO detection_rule_evaluation VALUES (?, ?, ?, ?, ?, ?)');
        return (id: string, report: RuleEvaluation) => save.run(id, report.projectId, report.ruleId, report.version, report.generatedAt, JSON.stringify(report));
    }

    private requireStatus(ruleId: string, version: number, expected: DetectionRule['status']) {
        const rule = this.get(ruleId, version);
        if (!rule) throw new HttpError(404, 'RULE_NOT_FOUND');
        if (rule.status !== expected) throw new HttpError(409, 'RULE_STATE_CONFLICT');
        return rule;
    }

    private addRule(rule: DetectionRule) {
        this.db.prepare('INSERT INTO detection_rule VALUES (?, ?, ?, ?, ?, ?)')
            .run(rule.ruleId, rule.version, rule.status, Number(rule.active), rule.updatedAt, JSON.stringify(rule));
    }

    private addEvent(event: RuleAudit) {
        this.db.prepare('INSERT INTO detection_rule_event VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(event.id, event.ruleId, event.version, event.action, event.actor, event.reason, event.occurredAt);
    }

    private record(rule: DetectionRule, action: RuleAudit['action'], actor: string, reason: string, occurredAt: string) {
        this.addEvent({ id: randomUUID(), ruleId: rule.ruleId, version: rule.version, action, actor, reason, occurredAt });
    }

    private change(rule: DetectionRule, status: DetectionRule['status'], active: boolean, updatedAt: string) {
        this.db.prepare('UPDATE detection_rule SET status = ?, active = ?, updated_at = ? WHERE rule_id = ? AND version = ?')
            .run(status, Number(active), updatedAt, rule.ruleId, rule.version);
    }

    private write<T>(operation: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = operation();
            this.db.exec('COMMIT');
            return result;
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
}
