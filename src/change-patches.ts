import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import { agentRunIdPattern } from './agent-runs.js';
import { redactChangeHunk } from './change-review.js';
import { HttpError } from './http-error.js';
import type { Account } from './identity.js';
import type { RepositoryIndex } from './index.js';
import { readProjectFile } from './project-file.js';
import { isSensitiveReviewPath, redactReviewText } from './review-redaction.js';
import { overlayPath } from './review-working-copy.js';
import { capturedText, workingCopyDiff } from './snapshot-diff.js';
import { digest } from './source.js';

const maxFile = 192 * 1024;
const maxPatchBytes = 512 * 1024;
const identifier = z.string().regex(agentRunIdPattern);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const proposeChangePatch = z.strictObject({ files: z.array(z.strictObject({ path: overlayPath, baseDigest: hash,
    content: z.string().max(maxFile).refine(text => !text.includes('\0')) })).min(1).max(12)
    .refine(files => new Set(files.map(file => file.path)).size === files.length) });
export const decideChangePatch = z.strictObject({ action: z.enum(['ACCEPT', 'DISCARD']), revision: z.int().nonnegative(), verificationRunId: identifier.optional() })
    .refine(input => input.action === 'ACCEPT' || input.verificationRunId === undefined);
type Proposal = z.infer<typeof proposeChangePatch>;
type Decision = z.infer<typeof decideChangePatch>;
type Preview = ReturnType<typeof workingCopyDiff>['files'];
type Patch = { id: string; projectId: string; reviewId: string; snapshotId: string; digest: string; createdAt: string;
    files: { path: string; baseDigest: string; digest: string }[]; changes: Preview };
type Status = 'DRAFT' | 'ACCEPTED' | 'DISCARDED';
type Row = { payload: string; status: Status; revision: number; artifact: string; fingerprint: string };

export class ChangePatches {
    constructor(private readonly db: DatabaseSync, private readonly repo: RepositoryIndex) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS change_patch (
                id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES change_review(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE, actor_id TEXT NOT NULL,
                request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, artifact TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('DRAFT','ACCEPTED','DISCARDED')), revision INTEGER NOT NULL,
                UNIQUE(review_id, actor_id, request_key)
            );
            CREATE TABLE IF NOT EXISTS change_patch_source (
                patch_id TEXT NOT NULL REFERENCES change_patch(id) ON DELETE CASCADE, path TEXT NOT NULL, content BLOB NOT NULL,
                PRIMARY KEY(patch_id,path)
            );
            CREATE TABLE IF NOT EXISTS change_patch_decision (
                patch_id TEXT PRIMARY KEY REFERENCES change_patch(id) ON DELETE CASCADE, actor_id TEXT NOT NULL,
                request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, verification_run_id TEXT, decided_at TEXT NOT NULL
            );
        `);
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

    private authorized(actor: Account, projectId: string, reviewId: string, write: boolean) {
        if (write) this.repo.identity.requireProjectEditor(actor, projectId);
        else this.repo.identity.requireProjectReader(actor, projectId);
        const review = this.repo.changeReviews.get(reviewId, projectId);
        if (!review) throw new HttpError(404, 'CHANGE_REVIEW_NOT_FOUND');
        if (review.provenance?.scope !== 'PUBLISHED_INDEXED_SOURCE') throw new HttpError(409, 'PATCH_REQUIRES_PUBLISHED_TARGET');
        return { review, snapshotId: review.provenance.targetSnapshotId };
    }

    private row(id: string) { return this.db.prepare('SELECT payload, status, revision, artifact, fingerprint FROM change_patch WHERE id = ?')
        .get(id) as Row | undefined; }

    private read(actor: Account, id: string, write: boolean) {
        const row = this.row(id);
        if (!row) throw new HttpError(404, 'PATCH_NOT_FOUND');
        const stored = JSON.parse(row.payload) as Patch;
        this.authorized(actor, stored.projectId, stored.reviewId, write);
        return { ...row, patch: stored };
    }

    private public(row: Row) {
        const patch = JSON.parse(row.payload) as Patch;
        const decision = this.db.prepare(`SELECT actor_id AS actorId, verification_run_id AS verificationRunId, decided_at AS decidedAt
            FROM change_patch_decision WHERE patch_id = ?`).get(patch.id);
        return { ...patch, status: row.status, revision: row.revision, decision: decision ?? null };
    }

    propose(actor: Account, projectId: string, reviewId: string, key: string, input: Proposal) {
        if (input.files.reduce((total, item) => total + Buffer.byteLength(item.content), 0) > maxPatchBytes) throw new HttpError(413, 'PATCH_TOO_LARGE');
        const files = [...input.files].sort((a, b) => a.path < b.path ? -1 : 1);
        const fingerprint = digest(JSON.stringify(files));
        return this.transaction(() => {
            const { review, snapshotId } = this.authorized(actor, projectId, reviewId, true);
            const receipt = this.db.prepare('SELECT id FROM change_patch WHERE review_id = ? AND actor_id = ? AND request_key = ?')
                .get(reviewId, actor.id, key);
            if (receipt) {
                const previous = this.row(String(receipt.id))!;
                if (previous.fingerprint !== fingerprint) throw new HttpError(409, 'PATCH_REQUEST_CONFLICT');
                return this.public(previous);
            }
            const allowed = new Set(review.files.filter(file => file.kind !== 'BINARY').map(file => file.newPath));
            const replacements = files.map(file => {
                if (!allowed.has(file.path) || isSensitiveReviewPath(file.path)) throw new HttpError(403, 'PATCH_PATH_OUTSIDE_REVIEW');
                const base = this.repo.knowledgeSnapshots.sourceBytes(snapshotId, file.path);
                if (!base || digest(base) !== file.baseDigest) throw new HttpError(409, 'PATCH_BASE_CHANGED');
                const target = Buffer.from(file.content);
                if (base.length > maxFile || target.length > maxFile) throw new HttpError(413, 'PATCH_TOO_LARGE');
                if (capturedText(base) === null || target.toString('utf8') !== file.content) throw new HttpError(400, 'PATCH_UTF8_REQUIRED');
                return { path: file.path, base: Buffer.from(base), target };
            });
            const diff = workingCopyDiff(replacements);
            if (diff.errors.length) throw new HttpError(409, 'PATCH_COMPARISON_INCOMPLETE');
            if (diff.totalFiles !== files.length) throw new HttpError(400, 'PATCH_NO_CHANGE');
            const parts = replacements.map(({ path, base, target }) => createTwoFilesPatch('a/' + path, 'b/' + path,
                base.toString('utf8'), target.toString('utf8'), undefined, undefined, { context: 3, timeout: 35, maxEditLength: 4000 }));
            if (parts.some(part => !part)) throw new HttpError(409, 'PATCH_COMPARISON_INCOMPLETE');
            const artifact = parts.join('');
            if (Buffer.byteLength(artifact) > maxPatchBytes) throw new HttpError(413, 'PATCH_TOO_LARGE');
            const patch: Patch = { id: randomUUID(), projectId, reviewId, snapshotId, digest: digest(artifact), createdAt: new Date().toISOString(),
                files: replacements.map(file => ({ path: file.path, baseDigest: digest(file.base), digest: digest(file.target) })),
                changes: diff.files.map(file => ({ ...file, oldPath: redactReviewText(file.oldPath), newPath: redactReviewText(file.newPath),
                    hunks: file.hunks.map(hunk => redactChangeHunk(hunk, false)) })) };
            const payload = JSON.stringify(patch);
            this.db.prepare(`INSERT INTO change_patch VALUES (?,?,?,?,?,?,?,?,'DRAFT',0)`)
                .run(patch.id, reviewId, projectId, actor.id, key, fingerprint, payload, artifact);
            const save = this.db.prepare('INSERT INTO change_patch_source VALUES (?,?,?)');
            for (const file of replacements) save.run(patch.id, file.path, file.target);
            return this.public({ payload, artifact, fingerprint, status: 'DRAFT', revision: 0 });
        });
    }

    inspect(actor: Account, id: string) { return this.public(this.read(actor, id, false)); }

    artifact(actor: Account, id: string) {
        const row = this.read(actor, id, true);
        return { bytes: Buffer.from(row.artifact), digest: row.patch.digest };
    }

    requireScope(actor: Account, projectId: string, snapshotId: string, id: string) {
        const row = this.read(actor, id, true);
        if (row.patch.projectId !== projectId || row.patch.snapshotId !== snapshotId || row.status === 'DISCARDED') {
            throw new HttpError(409, 'PATCH_SCOPE_CHANGED');
        }
        return row.patch;
    }

    sources(actor: Account, projectId: string, snapshotId: string, id: string) {
        this.requireScope(actor, projectId, snapshotId, id);
        return this.db.prepare('SELECT path, content FROM change_patch_source WHERE patch_id = ? ORDER BY path').all(id) as unknown as
            { path: string; content: Uint8Array }[];
    }

    private requireCurrentTarget(patch: Patch) {
        const latest = this.repo.knowledgeSnapshots.list(patch.projectId, 1, 0)[0];
        if (latest?.id !== patch.snapshotId || latest.source?.type === 'GIT'
            && this.repo.gitSources.origin(patch.projectId)?.gitCommit !== latest.source.gitCommit) throw new HttpError(409, 'PATCH_TARGET_CHANGED');
        return this.repo.projectRoot(patch.projectId);
    }

    async decide(actor: Account, id: string, key: string, input: Decision, signal?: AbortSignal) {
        const initial = this.read(actor, id, true);
        const fingerprint = digest(JSON.stringify(input));
        const replay = (row: Row) => {
            const decision = this.db.prepare('SELECT actor_id AS actorId, request_key AS key, fingerprint FROM change_patch_decision WHERE patch_id = ?').get(id);
            if (!decision) return undefined;
            if (decision.actorId === actor.id && decision.key === key && decision.fingerprint === fingerprint) return this.public(row);
            throw new HttpError(409, 'PATCH_DECISION_CHANGED');
        };
        const previous = replay(initial);
        if (previous) return previous;
        if (initial.revision !== input.revision || initial.status !== 'DRAFT') throw new HttpError(409, 'PATCH_DECISION_CHANGED');
        let root: string | undefined;
        if (input.action === 'ACCEPT') {
            root = this.requireCurrentTarget(initial.patch);
            for (const file of initial.patch.files) {
                signal?.throwIfAborted();
                const source = await readProjectFile(join(root, file.path), maxFile).catch(() => undefined);
                if (!source || digest(source) !== file.baseDigest) throw new HttpError(409, 'PATCH_TARGET_CHANGED');
            }
        }
        return this.transaction(() => {
            signal?.throwIfAborted();
            const current = this.read(actor, id, true);
            const saved = replay(current);
            if (saved) return saved;
            if (current.revision !== input.revision || current.status !== 'DRAFT') throw new HttpError(409, 'PATCH_DECISION_CHANGED');
            if (root && this.requireCurrentTarget(current.patch) !== root) throw new HttpError(409, 'PATCH_TARGET_CHANGED');
            if (input.verificationRunId) {
                const verified = this.repo.verifications.inspect(actor, input.verificationRunId).result;
                if (verified?.patchId !== id || verified?.status !== 'PASSED' || verified.snapshotId !== current.patch.snapshotId) {
                    throw new HttpError(409, 'PATCH_VERIFICATION_MISMATCH');
                }
            }
            this.db.prepare('UPDATE change_patch SET status = ?, revision = revision + 1 WHERE id = ?')
                .run(input.action === 'ACCEPT' ? 'ACCEPTED' : 'DISCARDED', id);
            this.db.prepare('INSERT INTO change_patch_decision VALUES (?,?,?,?,?,?)')
                .run(id, actor.id, key, fingerprint, input.verificationRunId ?? null, new Date().toISOString());
            this.repo.identity.record(actor.id, 'CHANGE_PATCH_' + input.action, current.patch.reviewId, id);
            return this.public(this.row(id)!);
        });
    }
}
