import type { DatabaseSync } from 'node:sqlite';

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const retentionHours = 30 * 24;
const maxPendingMinutes = 1440;
type Bucket = { completed: number; accepted: number; clientErrors: number; serverErrors: number; disconnected: number;
    durationMs: number; maxDurationMs: number };

export class RequestMetrics {
    private readonly pending = new Map<number, Bucket>();
    private readonly timer: NodeJS.Timeout;
    private lastPurge = 0;
    private lastFlushOk = true;
    private dropped = 0;

    constructor(private readonly db: DatabaseSync, private readonly now = Date.now) {
        db.exec(`CREATE TABLE IF NOT EXISTS request_metric_minute (
            minute INTEGER PRIMARY KEY, completed INTEGER NOT NULL, accepted INTEGER NOT NULL, client_errors INTEGER NOT NULL,
            server_errors INTEGER NOT NULL, disconnected INTEGER NOT NULL, duration_ms INTEGER NOT NULL, max_duration_ms INTEGER NOT NULL
        )`);
        this.timer = setInterval(() => this.flush(), 1000).unref();
    }

    record(status: number, milliseconds: number) {
        const minute = Math.floor(this.now() / minuteMs) * minuteMs;
        let bucket = this.pending.get(minute);
        if (!bucket) {
            if (this.pending.size >= maxPendingMinutes) { this.dropped++; return; }
            bucket = { completed: 0, accepted: 0, clientErrors: 0, serverErrors: 0, disconnected: 0, durationMs: 0, maxDurationMs: 0 };
            this.pending.set(minute, bucket);
        }
        if (!status) bucket.disconnected++;
        else if (status === 202) bucket.accepted++;
        else if (status >= 500) bucket.serverErrors++;
        else if (status >= 400) bucket.clientErrors++;
        else bucket.completed++;
        const duration = Math.max(0, Math.round(milliseconds));
        bucket.durationMs += duration;
        bucket.maxDurationMs = Math.max(bucket.maxDurationMs, duration);
    }

    status() {
        return { available: this.lastFlushOk, bufferedMinutes: this.pending.size, droppedSinceStart: this.dropped };
    }

    flush() {
        const moment = this.now();
        const prune = moment - this.lastPurge >= hourMs;
        if (!this.pending.size && !prune) return;
        let transaction = false;
        try {
            this.db.exec('BEGIN IMMEDIATE');
            transaction = true;
            const merge = this.db.prepare(`INSERT INTO request_metric_minute VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(minute) DO UPDATE SET completed = completed + excluded.completed, accepted = accepted + excluded.accepted,
                    client_errors = client_errors + excluded.client_errors, server_errors = server_errors + excluded.server_errors,
                    disconnected = disconnected + excluded.disconnected, duration_ms = duration_ms + excluded.duration_ms,
                    max_duration_ms = max(max_duration_ms, excluded.max_duration_ms)`);
            for (const [minute, row] of this.pending) merge.run(minute, row.completed, row.accepted, row.clientErrors, row.serverErrors,
                row.disconnected, row.durationMs, row.maxDurationMs);
            if (prune) this.db.prepare('DELETE FROM request_metric_minute WHERE minute < ?')
                .run(Math.floor(moment / hourMs) * hourMs - (retentionHours - 1) * hourMs);
            this.db.exec('COMMIT');
            this.pending.clear();
            if (prune) this.lastPurge = moment;
            this.lastFlushOk = true;
        } catch {
            try { if (transaction && this.db.isTransaction) this.db.exec('ROLLBACK'); }
            catch { /* Retry on the next flush without losing the buffered samples. */ }
            this.lastFlushOk = false;
        }
    }

    hourly(hours: number) {
        const moment = this.now();
        const through = Math.floor(moment / hourMs) * hourMs;
        const from = through - (Math.min(retentionHours, hours) - 1) * hourMs;
        const series = this.db.prepare(`SELECT CAST(minute / ? AS INTEGER) * ? AS hour,
            sum(completed) AS completed, sum(accepted) AS accepted, sum(client_errors) AS clientErrors,
            sum(server_errors) AS serverErrors, sum(disconnected) AS disconnected, sum(duration_ms) AS durationMs,
            max(max_duration_ms) AS maxDurationMs FROM request_metric_minute
            WHERE minute >= ? AND minute <= ? GROUP BY hour ORDER BY hour`)
            .all(hourMs, hourMs, from, moment).map(row => ({ ...row, hour: new Date(Number(row.hour)).toISOString() }));
        return { interval: 'hour', from: new Date(from).toISOString(), through: new Date(moment).toISOString(), retentionHours,
            persistence: this.status(), series };
    }

    close() {
        clearInterval(this.timer);
        this.flush();
    }
}
