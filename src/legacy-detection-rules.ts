import { z } from 'zod';
import { matcherKinds, ruleActions, ruleEvaluationSchema, ruleIdSchema, ruleSeverities, ruleStatuses } from './detection-rules.js';
import type { DetectionRule, RuleAudit } from './detection-rules.js';
import { findingPublicText } from './finding-import.js';

const version = z.number().int().min(1).max(2_147_483_647);
const id = z.string().min(1).max(128);
const date = z.iso.datetime({ offset: true });
const text = z.string();
const identity = { rule_id: ruleIdSchema, version };
const ordered = { ...identity, item_index: z.number().int().min(0) };
export const legacyDetectionRule = z.object({
    ...identity, source: text, cwe: text, severity: z.enum(ruleSeverities), title: text, matcher_kind: z.enum(matcherKinds), pattern: text,
    status: z.enum(ruleStatuses), change_notes: text, active: z.literal([0, 1]), created_at: date, updated_at: date
});
export const legacyRuleLanguage = z.object({ ...ordered, language: text });
export const legacyRuleFramework = z.object({ ...ordered, framework: text });
export const legacyRuleSample = z.object({ ...ordered, sample_type: z.enum(['POSITIVE', 'NEGATIVE']), content: text });
export const legacyRuleAudit = z.object({ ...identity, id, action: z.enum(ruleActions), actor: text, reason: text, occurred_at: date });
export const legacyRuleEvaluation = z.object({ ...identity, id, project_id: z.string().regex(/^[0-9a-f]{12}$/),
    report_json: z.string().max(2_000_000), generated_at: date });

type RuleRows = {
    versions: z.infer<typeof legacyDetectionRule>[]; languages: z.infer<typeof legacyRuleLanguage>[];
    frameworks: z.infer<typeof legacyRuleFramework>[]; samples: z.infer<typeof legacyRuleSample>[];
    events: z.infer<typeof legacyRuleAudit>[]; evaluations: z.infer<typeof legacyRuleEvaluation>[];
};

export function prepareLegacyDetectionRules(rows: RuleRows, projects: ReadonlyMap<string, string>) {
    const key = (row: { rule_id: string; version: number }) => JSON.stringify([row.rule_id, row.version]);
    const indexed = new Map<string, DetectionRule>();
    for (const row of rows.versions) {
        const { rule_id, version, source, cwe, severity, title, matcher_kind, pattern, status, change_notes, active, created_at, updated_at } = row;
        indexed.set(key(row), { ruleId: rule_id, version, source: findingPublicText(source, 256), cwe: findingPublicText(cwe, 100),
            severity, title: findingPublicText(title, 500), matcherKind: matcher_kind, pattern, status, active: active === 1,
            ...(matcher_kind === 'REGEX' ? { regexEngine: 'JAVA' } : {}),
            changeNotes: findingPublicText(change_notes, 1000), createdAt: created_at, updatedAt: updated_at,
            languages: [], frameworks: [], positiveSamples: [], negativeSamples: [] });
    }
    const orderedByPosition = <T extends { item_index: number }>(items: T[]) => items.slice().sort((a, b) => a.item_index - b.item_index);
    for (const row of orderedByPosition(rows.languages)) indexed.get(key(row))?.languages.push(findingPublicText(row.language, 120));
    for (const row of orderedByPosition(rows.frameworks)) indexed.get(key(row))?.frameworks.push(findingPublicText(row.framework, 120));
    for (const row of orderedByPosition(rows.samples)) {
        const rule = indexed.get(key(row));
        if (rule) (row.sample_type === 'POSITIVE' ? rule.positiveSamples : rule.negativeSamples).push(row.content);
    }
    const events: RuleAudit[] = rows.events.slice().sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)
        || a.id.localeCompare(b.id)).flatMap(row => indexed.has(key(row)) ? [{
            id: row.id, ruleId: row.rule_id, version: row.version, action: row.action, actor: findingPublicText(row.actor, 128),
            reason: findingPublicText(row.reason, 500), occurredAt: row.occurred_at
        }] : []);
    const evaluations = rows.evaluations.flatMap(row => {
        const projectId = projects.get(row.project_id);
        if (!projectId) return [];
        const report = ruleEvaluationSchema.parse(JSON.parse(row.report_json));
        if (report.projectId !== row.project_id || report.ruleId !== row.rule_id || report.version !== row.version
            || report.generatedAt !== row.generated_at) throw new Error('Legacy rule evaluation identity mismatch');
        return [{ id: row.id, report: { ...report, projectId,
            omittedReasons: report.omittedReasons.map(value => findingPublicText(value, 1500)),
            regression: report.regression.map(value => ({ ...value, metric: findingPublicText(value.metric, 128) })) } }];
    });
    const rules = [...indexed.values()];
    return { rules, events, evaluations, languages: rules.reduce((total, rule) => total + rule.languages.length, 0),
        frameworks: rules.reduce((total, rule) => total + rule.frameworks.length, 0),
        samples: rules.reduce((total, rule) => total + rule.positiveSamples.length + rule.negativeSamples.length, 0) };
}
