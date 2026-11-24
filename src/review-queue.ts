import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { FindingReport } from './external-findings.js';
import { findingPublicText } from './finding-import.js';
import { HttpError } from './http-error.js';
import type { VulnerabilityInventory } from './vulnerability-inventory.js';

const { version: toolVersion } = createRequire(import.meta.url)('../package.json') as { version: string };
export const snapshotSelection = z.object({ fingerprints: z.array(z.string().regex(/^[a-f0-9]{16}$/)).min(1).max(100) });
export const reviewAction = z.object({ reason: z.string().trim().max(500).optional(), revision: z.number().int().min(0).optional() });
export const reviewStatuses = ['PENDING', 'IN_REVIEW', 'CONFIRMED', 'REJECTED'] as const;
export type ReviewStatus = typeof reviewStatuses[number];
type FrozenReport = FindingReport;
const transitions = {
    claim: ['PENDING', 'IN_REVIEW'], return: ['IN_REVIEW', 'PENDING'],
    confirm: ['IN_REVIEW', 'CONFIRMED'], reject: ['IN_REVIEW', 'REJECTED']
} as const;
export type ReviewAction = keyof typeof transitions;

export interface ReportSnapshot {
    id: string; projectId: string; schemaVersion: string; toolVersion: string;
    codeVersion: string; ruleVersion: string; generatedAt: string; reports: FrozenReport[];
    legacyImported?: true;
}
export interface ReviewQueueEntry {
    id: string; snapshotId: string; projectId: string; fingerprint: string;
    ruleId: string; cwe: string; severity: string; verdict: string; confidence: number;
    status: ReviewStatus; claimedBy: string; claimedAt: string; updatedAt: string; revision: number; vulnerabilityId: string | null;
}
export interface ReviewEvent { id: string; entryId: string; action: string; actor: string; reason: string; occurredAt: string }
interface Filters {
    status: string | null; severity: string | null; verdict: string | null; ruleId: string | null;
    updatedAfter: string | null; updatedBefore: string | null;
}

const columns = `id, snapshot_id AS snapshotId, project_id AS projectId, fingerprint, rule_id AS ruleId,
    cwe, severity, verdict, confidence, status, claimed_by AS claimedBy, claimed_at AS claimedAt, updated_at AS updatedAt, revision,
    (SELECT finding_id FROM vulnerability_review WHERE entry_id = review_queue_entry.id) AS vulnerabilityId`;

function commonVersion(reports: FrozenReport[], key: 'codeVersion' | 'ruleVersion') {
    const values = new Set(reports.map(report => report.finding[key]));
    return values.size === 1 ? [...values][0] : '';
}

function uniqueFrozenReport(snapshot: ReportSnapshot | undefined, fingerprint: string) {
    const matches = snapshot?.reports.filter(item => item.finding.fingerprint === fingerprint);
    return matches?.length === 1 ? matches[0] : undefined;
}

export class ReviewQueue {
    constructor(private readonly db: DatabaseSync, private readonly vulnerabilities: VulnerabilityInventory) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS report_snapshot (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
                payload TEXT NOT NULL, UNIQUE(id, project_id)
            );
            CREATE TABLE IF NOT EXISTS review_queue_entry (
                id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, project_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
                rule_id TEXT NOT NULL, cwe TEXT NOT NULL, severity TEXT NOT NULL, verdict TEXT NOT NULL, confidence REAL NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('PENDING','IN_REVIEW','CONFIRMED','REJECTED')),
                claimed_by TEXT NOT NULL, claimed_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
                FOREIGN KEY(snapshot_id,project_id) REFERENCES report_snapshot(id,project_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS review_queue_project ON review_queue_entry(project_id, updated_at DESC, id);
            CREATE INDEX IF NOT EXISTS review_queue_snapshot_entries ON review_queue_entry(snapshot_id,fingerprint,id);
            CREATE INDEX IF NOT EXISTS review_queue_rule ON review_queue_entry(project_id,rule_id,fingerprint,updated_at);
            CREATE TABLE IF NOT EXISTS review_queue_audit (
                seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, entry_id TEXT NOT NULL REFERENCES review_queue_entry(id) ON DELETE CASCADE,
                action TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL, occurred_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS review_queue_audit_entry ON review_queue_audit(entry_id, seq);
        `);
        const prior = db.prepare(`SELECT ${columns} FROM review_queue_entry WHERE status = 'CONFIRMED'
            AND NOT EXISTS (SELECT 1 FROM vulnerability_review WHERE entry_id = review_queue_entry.id) ORDER BY updated_at,id`)
            .all() as unknown as ReviewQueueEntry[];
        for (const entry of prior) {
            const confirmation = this.audit(entry.id).findLast(event => event.action === 'CONFIRM');
            const frozen = this.uniqueReport(entry);
            if (confirmation && frozen) this.write(() => this.vulnerabilities.confirmInReviewTransaction(entry.projectId,
                entry.id, entry.snapshotId, frozen, confirmation.actor, confirmation.reason, confirmation.occurredAt));
        }
    }

    private write<T>(operation: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = operation();
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    private record(entryId: string, action: string, actor: string, reason: string, at: string) {
        this.db.prepare('INSERT INTO review_queue_audit(id, entry_id, action, actor, reason, occurred_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(randomUUID(), entryId, action, actor, reason, at);
    }

    private snapshotWriter() {
        const save = this.db.prepare('INSERT INTO report_snapshot VALUES (?, ?, ?)');
        return (snapshot: ReportSnapshot) => {
            const payload = JSON.stringify(snapshot);
            if (Buffer.byteLength(payload) > 12 * 1024 * 1024) throw new HttpError(413, 'REVIEW_SNAPSHOT_TOO_LARGE');
            save.run(snapshot.id, snapshot.projectId, payload);
        };
    }

    private entryWriter() {
        const save = this.db.prepare('INSERT INTO review_queue_entry VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        return (entry: ReviewQueueEntry) => save.run(entry.id, entry.snapshotId, entry.projectId, entry.fingerprint, entry.ruleId,
            entry.cwe, entry.severity, entry.verdict, entry.confidence, entry.status, entry.claimedBy, entry.claimedAt,
            entry.updatedAt, entry.revision);
    }

    restoreInMigrationTransaction(snapshots: ReportSnapshot[], entries: ReviewQueueEntry[], events: ReviewEvent[]) {
        const saveSnapshot = this.snapshotWriter();
        const saveEntry = this.entryWriter();
        const saveEvent = this.db.prepare('INSERT INTO review_queue_audit(id, entry_id, action, actor, reason, occurred_at) VALUES (?, ?, ?, ?, ?, ?)');
        for (const snapshot of snapshots) saveSnapshot(snapshot);
        for (const entry of entries) saveEntry(entry);
        for (const event of events) saveEvent.run(event.id, event.entryId, event.action, event.actor, event.reason, event.occurredAt);
        const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
        const confirmations = new Map(events.filter(event => event.action === 'CONFIRM').map(event => [event.entryId, event]));
        for (const entry of entries) {
            const confirmation = confirmations.get(entry.id);
            if (entry.status !== 'CONFIRMED' || !confirmation) continue;
            const report = uniqueFrozenReport(byId.get(entry.snapshotId), entry.fingerprint);
            if (report) this.vulnerabilities.confirmInReviewTransaction(entry.projectId, entry.id, entry.snapshotId,
                report, confirmation.actor, confirmation.reason, confirmation.occurredAt);
        }
    }

    submit(projectId: string, actor: string, reports: FrozenReport[],
        onSubmitted?: (result: { snapshotId: string; entries: ReviewQueueEntry[] }) => void) {
        const distinct = new Map<string, FrozenReport>();
        for (const report of reports) if (!distinct.has(report.finding.fingerprint)) distinct.set(report.finding.fingerprint, report);
        const frozen = [...distinct.values()];
        if (!frozen.length) throw new HttpError(400, 'NO_REVIEWABLE_FINDINGS');
        const snapshot: ReportSnapshot = { id: randomUUID(), projectId, schemaVersion: '1', toolVersion,
            codeVersion: commonVersion(frozen, 'codeVersion'), ruleVersion: commonVersion(frozen, 'ruleVersion'),
            generatedAt: new Date().toISOString(), reports: frozen };
        return this.write(() => {
            this.snapshotWriter()(snapshot);
            const insert = this.entryWriter();
            const entries = frozen.map(({ finding, verdict, confidence }) => {
                const { fingerprint, ruleId, cwe, severity } = finding;
                const entry: ReviewQueueEntry = { id: randomUUID(), snapshotId: snapshot.id, projectId, fingerprint, ruleId, cwe, severity,
                    verdict, confidence, status: 'PENDING', claimedBy: '', claimedAt: '', updatedAt: snapshot.generatedAt, revision: 0, vulnerabilityId: null };
                insert(entry);
                this.record(entry.id, 'SUBMIT', actor, '', entry.updatedAt);
                return entry;
            });
            const submitted = { snapshotId: snapshot.id, entries };
            onSubmitted?.(submitted);
            return submitted;
        });
    }

    get(id: string) {
        return this.db.prepare(`SELECT ${columns} FROM review_queue_entry WHERE id = ?`).get(id) as unknown as ReviewQueueEntry | undefined;
    }

    scopeForSnapshot(id: string) {
        const row = this.db.prepare('SELECT project_id AS projectId FROM report_snapshot WHERE id = ?').get(id);
        return row ? { projectId: String(row.projectId) } : undefined;
    }

    snapshot(id: string) {
        const row = this.db.prepare('SELECT payload FROM report_snapshot WHERE id = ?').get(id);
        return row ? JSON.parse(String(row.payload)) as ReportSnapshot : undefined;
    }

    view(snapshot: ReportSnapshot) {
        const entries = this.db.prepare(`SELECT ${columns} FROM review_queue_entry WHERE snapshot_id = ? ORDER BY fingerprint, id`)
            .all(snapshot.id) as unknown as ReviewQueueEntry[];
        const reports = new Map<string, FrozenReport[]>();
        for (const report of snapshot.reports) {
            const matches = reports.get(report.finding.fingerprint);
            if (matches) matches.push(report);
            else reports.set(report.finding.fingerprint, [report]);
        }
        return { snapshot, items: entries.map(entry => {
            const matches = reports.get(entry.fingerprint) ?? [];
            return { entry, report: matches.length === 1 ? matches[0] : null, reportMatchCount: matches.length };
        }) };
    }

    list(projectId: string, filters: Filters, page: number, size: number) {
        const { severity, verdict, status, ruleId, updatedAfter, updatedBefore } = filters;
        const condition = `FROM review_queue_entry WHERE project_id = ? AND (? IS NULL OR severity = ?) AND (? IS NULL OR verdict = ?)
            AND (? IS NULL OR status = ?) AND (? IS NULL OR rule_id = ?) AND (? IS NULL OR updated_at >= ?) AND (? IS NULL OR updated_at < ?)`;
        const args = [projectId, severity, severity, verdict, verdict, status, status, ruleId, ruleId, updatedAfter, updatedAfter, updatedBefore, updatedBefore];
        const entries = this.db.prepare(`SELECT ${columns} ${condition} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`)
            .all(...args, size, page * size) as unknown as ReviewQueueEntry[];
        const total = Number(this.db.prepare(`SELECT count(*) AS n ${condition}`).get(...args)?.n ?? 0);
        return { entries, page, size, total };
    }

    transition(id: string, action: ReviewAction, actor: string, fields: z.infer<typeof reviewAction>) {
        const [expected, next] = transitions[action];
        const reason = findingPublicText(fields.reason ?? '', 500);
        if (action !== 'claim' && !reason) throw new HttpError(400, 'REVIEW_REASON_REQUIRED');
        return this.write(() => {
            const entry = this.get(id);
            if (!entry) throw new HttpError(404, 'REVIEW_ENTRY_NOT_FOUND');
            const now = new Date().toISOString();
            const claimedBy = action === 'claim' ? actor : action === 'return' ? '' : entry.claimedBy;
            const claimedAt = action === 'claim' ? now : action === 'return' ? '' : entry.claimedAt;
            const updated = this.db.prepare(`UPDATE review_queue_entry SET status = ?, claimed_by = ?, claimed_at = ?, updated_at = ?, revision = revision + 1
                WHERE id = ? AND status = ? AND revision = ?`).run(next, claimedBy, claimedAt, now, id, expected, fields.revision ?? entry.revision);
            if (!updated.changes) throw new HttpError(409, 'REVIEW_STATE_CONFLICT');
            this.record(id, action.toUpperCase(), actor, reason, now);
            if (action === 'confirm') this.linkConfirmedFinding(entry, actor, reason, now);
            return this.get(id)!;
        });
    }

    private linkConfirmedFinding(entry: ReviewQueueEntry, actor: string, reason: string, at: string) {
        const report = this.uniqueReport(entry);
        if (!report) throw new HttpError(409, 'REVIEW_FINDING_MISSING');
        this.vulnerabilities.confirmInReviewTransaction(entry.projectId, entry.id, entry.snapshotId, report, actor, reason, at);
    }

    private uniqueReport(entry: ReviewQueueEntry) {
        return uniqueFrozenReport(this.snapshot(entry.snapshotId), entry.fingerprint);
    }

    *ruleReports(projectId: string, ruleId: string) {
        const hits = this.db.prepare(`SELECT fingerprint, snapshot_id FROM (
            SELECT fingerprint, snapshot_id, row_number() OVER (PARTITION BY fingerprint ORDER BY julianday(updated_at) DESC, rowid DESC) AS position
            FROM review_queue_entry WHERE project_id = ? AND rule_id = ?
        ) WHERE position = 1 ORDER BY snapshot_id, fingerprint`).iterate(projectId, ruleId);
        let lastId: string | undefined;
        let snapshot: ReportSnapshot | undefined;
        for (const row of hits) {
            const snapshotId = String(row.snapshot_id);
            if (lastId !== snapshotId) {
                lastId = snapshotId;
                const loaded = this.snapshot(snapshotId);
                snapshot = loaded?.projectId === projectId ? loaded : undefined;
            }
            const report = uniqueFrozenReport(snapshot, String(row.fingerprint));
            yield report?.finding.ruleId === ruleId ? report : undefined;
        }
    }

    audit(id: string) {
        return this.db.prepare(`SELECT id, entry_id AS entryId, action, actor, reason, occurred_at AS occurredAt FROM review_queue_audit
            WHERE entry_id = ? ORDER BY seq`).all(id) as unknown as ReviewEvent[];
    }
}
