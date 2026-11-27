import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { agentRunIdPattern } from './agent-runs.js';
import { ruleInput } from './detection-rules.js';
import { HttpError } from './http-error.js';
import type { Account } from './identity.js';
import type { RepositoryIndex } from './index.js';
import { digest } from './source.js';

const reference = z.strictObject({ reviewId: z.string().regex(agentRunIdPattern), findingId: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.int().positive() });
export const reviewRuleInput = z.strictObject({ rule: ruleInput, evidence: z.array(reference).min(1).max(12) }).refine(input =>
    new Set(input.evidence.map(item => item.reviewId + ':' + item.findingId)).size === input.evidence.length);
type Input = z.infer<typeof reviewRuleInput>;
type Candidate = { id: string; projectId: string; ruleId: string; version: number; createdAt: string;
    evidence: (z.infer<typeof reference> & { action: 'CONFIRM' | 'DISMISS'; tool: string; sourceRuleId: string; snapshotId: string })[] };

export class ReviewRuleProposals {
    constructor(private readonly db: DatabaseSync, private readonly repo: RepositoryIndex) {
        db.exec(`CREATE TABLE IF NOT EXISTS review_rule_proposal (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            actor_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
            rule_id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL,
            FOREIGN KEY(rule_id, version) REFERENCES detection_rule(rule_id, version),
            UNIQUE(project_id, actor_id, request_key), UNIQUE(rule_id, version)
        );
        CREATE TRIGGER IF NOT EXISTS review_rule_evidence_removed BEFORE DELETE ON review_rule_proposal BEGIN
            INSERT INTO detection_rule_event
                SELECT lower(hex(randomblob(16))), old.rule_id, old.version, 'REJECTED', 'system', 'REVIEW_RULE_PROJECT_PURGED',
                    strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM detection_rule
                WHERE rule_id = old.rule_id AND version = old.version AND status IN ('CANDIDATE','IN_REVIEW');
            UPDATE detection_rule SET status = 'REJECTED', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                WHERE rule_id = old.rule_id AND version = old.version AND status IN ('CANDIDATE','IN_REVIEW');
        END;`);
    }

    private currentEvidence(actor: Account, projectId: string, input: Input['evidence']): Candidate['evidence'] {
        return input.map(item => {
            const history = this.repo.changeReviews.findingHistory(actor, projectId, item.reviewId, item.findingId, 1);
            const { finding, revision, current } = history;
            if (revision !== item.revision || (current !== 'CONFIRM' && current !== 'DISMISS')) {
                throw new HttpError(409, 'REVIEW_RULE_EVIDENCE_CHANGED');
            }
            return { ...item, action: current, tool: finding.tool, sourceRuleId: finding.ruleId, snapshotId: finding.snapshotId };
        });
    }

    propose(actor: Account, projectId: string, key: string, input: Input) {
        const references = [...input.evidence].sort((left, right) => {
            const a = left.reviewId + left.findingId, b = right.reviewId + right.findingId;
            return a < b ? -1 : 1;
        });
        const fingerprint = digest(JSON.stringify([input.rule, references]));
        this.db.exec('BEGIN IMMEDIATE');
        try {
            this.repo.identity.requireProjectManager(actor, projectId);
            const previous = this.db.prepare(`SELECT id, fingerprint FROM review_rule_proposal WHERE project_id = ? AND actor_id = ? AND request_key = ?`)
                .get(projectId, actor.id, key);
            if (previous && previous.fingerprint !== fingerprint) throw new HttpError(409, 'REVIEW_RULE_REQUEST_CONFLICT');
            let result;
            if (previous) result = this.inspect(actor, String(previous.id));
            else {
                const evidence = this.currentEvidence(actor, projectId, references);
                if (new Set(evidence.map(item => JSON.stringify([item.tool, item.sourceRuleId]))).size !== 1) {
                    throw new HttpError(409, 'REVIEW_RULE_EVIDENCE_MISMATCH');
                }
                const rule = this.repo.detectionRules.createInTransaction(input.rule, actor.username);
                const candidate = { id: randomUUID(), projectId, ruleId: rule.ruleId, version: rule.version, createdAt: rule.createdAt, evidence };
                this.db.prepare('INSERT INTO review_rule_proposal VALUES (?,?,?,?,?,?,?,?)')
                    .run(candidate.id, projectId, actor.id, key, fingerprint, rule.ruleId, rule.version, JSON.stringify(candidate));
                this.repo.identity.record(actor.id, 'REVIEW_RULE_CANDIDATE_CREATED', projectId, candidate.id);
                result = { candidate, rule };
            }
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    inspect(actor: Account, id: string) {
        const row = this.db.prepare('SELECT payload FROM review_rule_proposal WHERE id = ?').get(id);
        if (!row) throw new HttpError(404, 'REVIEW_RULE_CANDIDATE_NOT_FOUND');
        const candidate = JSON.parse(String(row.payload)) as Candidate;
        this.repo.identity.requireProjectReader(actor, candidate.projectId);
        for (const item of candidate.evidence) if (!this.repo.changeReviews.get(item.reviewId, candidate.projectId)) {
            throw new HttpError(404, 'CHANGE_REVIEW_NOT_FOUND');
        }
        return { candidate, rule: this.repo.detectionRules.get(candidate.ruleId, candidate.version)! };
    }

    requireCurrentEvidence(actor: Account, ruleId: string, version: number) {
        const row = this.db.prepare('SELECT payload FROM review_rule_proposal WHERE rule_id = ? AND version = ?').get(ruleId, version);
        if (!row) return;
        const candidate = JSON.parse(String(row.payload)) as Candidate;
        this.repo.identity.requireProjectManager(actor, candidate.projectId);
        this.currentEvidence(actor, candidate.projectId, candidate.evidence);
    }
}
