import { z } from 'zod';
import { findingPublicText } from './finding-import.js';
import { relativeEvidencePath } from './project-file.js';
import { declaredFindingVersion, feedbackStatus, suppressionId } from './triage-policy.js';

const text = z.string();
const optionalText = text.nullish().transform(value => value ?? '');
const uuid = text.regex(suppressionId);
const project = text.regex(/^[a-f0-9]{12}$/);
const timestamp = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());

export const legacyFeedback = z.object({
    fingerprint: text.regex(/^[a-f0-9]{16}$/), project_id: project, status: feedbackStatus, reviewer: optionalText,
    reason: optionalText, code_version: optionalText, rule_version: optionalText, updated_at: timestamp
});
export const legacySuppression = z.object({
    id: uuid, project_id: project, rule_id: text.min(1).max(500), scope: z.enum(['PROJECT', 'FILE_GLOB']), scope_value: optionalText,
    reason: text, created_by: text, created_at: timestamp, expires_at: timestamp, active: z.literal([0, 1])
});
export const legacySuppressionEvent = z.object({
    id: uuid, suppression_id: uuid, action: z.enum(['CREATED', 'REVOKED']), actor: text, reason: text, occurred_at: timestamp
});

export function prepareLegacyTriage(
    feedbackRows: z.infer<typeof legacyFeedback>[], suppressionRows: z.infer<typeof legacySuppression>[],
    eventRows: z.infer<typeof legacySuppressionEvent>[], projects: ReadonlyMap<string, string>
) {
    const feedback = feedbackRows.flatMap(row => {
        const projectId = projects.get(row.project_id);
        return projectId ? [{ projectId, fingerprint: row.fingerprint, status: row.status, reviewer: findingPublicText(row.reviewer, 128),
            reason: findingPublicText(row.reason, 500), codeVersion: declaredFindingVersion(row.code_version),
            ruleVersion: declaredFindingVersion(row.rule_version), updatedAt: row.updated_at }] : [];
    });
    const suppressions = suppressionRows.flatMap(row => {
        const projectId = projects.get(row.project_id);
        const scopeValue = row.scope === 'FILE_GLOB' ? row.scope_value.replaceAll('\\', '/') : '';
        if (!projectId || (row.scope === 'FILE_GLOB' && (!relativeEvidencePath(scopeValue) || scopeValue.length > 256))
            || row.rule_id !== findingPublicText(row.rule_id, 500)) return [];
        return [{ id: row.id, projectId, ruleId: row.rule_id, scope: row.scope, scopeValue, reason: findingPublicText(row.reason, 500),
            createdBy: findingPublicText(row.created_by, 128), createdAt: row.created_at, expiresAt: row.expires_at, active: row.active === 1 }];
    });
    const keys = new Set(suppressions.map(item => item.id));
    const events = eventRows.filter(row => keys.has(row.suppression_id)).map(row => ({
        id: row.id, suppressionId: row.suppression_id, action: row.action, actor: findingPublicText(row.actor, 128),
        reason: findingPublicText(row.reason, 500), occurredAt: row.occurred_at
    })).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)
        || left.action.localeCompare(right.action) || left.id.localeCompare(right.id));
    return { feedback, suppressions, events };
}
