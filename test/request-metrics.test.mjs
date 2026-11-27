import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { RequestMetrics } from '../dist/request-metrics.js';

test('request metrics retain hourly counts across restarts and retry a blocked batch without duplication', async t => {
    const root = await mkdtemp(join(tmpdir(), 'repograph-metrics-'));
    const path = join(root, 'index.db');
    let db = new DatabaseSync(path);
    let now = Date.parse('2026-11-26T12:05:00Z');
    let metrics = new RequestMetrics(db, () => now);
    t.after(async () => { metrics.close(); db.close(); await rm(root, { recursive: true, force: true }); });
    const older = now - 31 * 24 * 60 * 60 * 1000;
    db.prepare('INSERT INTO request_metric_minute VALUES (?, 99, 0, 0, 0, 0, 1, 1)').run(older);
    for (const [status, millis] of [[202, 11], [200, 5], [403, 2], [503, 18], [0, 31]]) metrics.record(status, millis);
    const competing = new DatabaseSync(path);
    try {
        competing.exec('BEGIN IMMEDIATE');
        metrics.flush();
        assert.deepEqual(metrics.status(), { available: false, bufferedMinutes: 1, droppedSinceStart: 0 });
        assert.equal(metrics.hourly(24).series.length, 0);
        competing.exec('ROLLBACK');
    } finally { competing.close(); }
    metrics.flush();
    metrics.flush();
    assert.equal(metrics.status().available, true);
    assert.equal(db.prepare('SELECT 1 FROM request_metric_minute WHERE minute = ?').get(older), undefined);
    assert.deepEqual(metrics.hourly(1).series[0], {
        hour: '2026-11-26T12:00:00.000Z', completed: 1, accepted: 1, clientErrors: 1, serverErrors: 1,
        disconnected: 1, durationMs: 67, maxDurationMs: 31
    });
    now += 65 * 60_000;
    metrics.record(201, 4);
    metrics.close();
    db.close();
    db = new DatabaseSync(path);
    metrics = new RequestMetrics(db, () => now);
    const recovered = metrics.hourly(2).series;
    assert.equal(recovered.length, 2);
    assert.equal(recovered[0].accepted, 1);
    assert.equal(recovered[1].completed, 1);
    assert.equal(recovered[1].hour, '2026-11-26T13:00:00.000Z');
});
