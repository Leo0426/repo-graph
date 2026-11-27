import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { DurableJobs } from '../dist/durable-jobs.js';

test('expired attempts cannot renew or publish after a durable job is claimed again', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec("PRAGMA foreign_keys=ON; CREATE TABLE project(id TEXT PRIMARY KEY); CREATE TABLE agent_run(id TEXT PRIMARY KEY); INSERT INTO project VALUES ('sample'); INSERT INTO agent_run VALUES ('run');");
        let now = 1000;
        const queue = new DurableJobs(db, () => now);
        queue.enqueue({ id: 'run', projectId: 'sample', kind: 'test', actorId: 'alice', key: 'one', fingerprint: 'initial',
            input: { chapter: 'proof' }, availableAt: 1000, budgetMs: 5000 });
        const other = new DurableJobs(db, () => now);
        const first = queue.claim('test', 1, 1000);
        assert.equal(first.id, 'run');
        assert.equal(first.attempt, 1);
        assert.equal(other.claim('test', 1, 1000), undefined);
        assert.deepEqual({ ...queue.history('run')[0] }, {
            number: 1, claimedAt: 1000, startedAt: null, finishedAt: null, outcome: null, resultHash: null
        });
        now = 2000;
        const next = other.claim('test', 1, 1000);
        assert.equal(next.id, 'run');
        assert.equal(next.attempt, 2);
        assert.equal(next.deadline, 6000);
        assert.deepEqual(next.input, { chapter: 'proof' });
        assert.equal(queue.renew(first, 1000), undefined);
        assert.throws(() => queue.begin(first), /JOB_LEASE_LOST/);
        assert.throws(() => queue.finish(first, 'FINISHED'), /JOB_LEASE_LOST/);
        assert.equal(queue.history('run')[0].outcome, 'LEASE_EXPIRED');
        other.begin(next);
        now = 2100;
        other.begin(next);
        assert.equal(queue.history('run')[1].startedAt, 2000);
        queue.change('run', next.revision, 'pause');
        assert.throws(() => other.finish(next, 'FINISHED'), /JOB_STOP_REQUESTED/);
        const paused = other.finish(next, 'QUEUED');
        assert.equal(paused.state, 'PAUSED');
        queue.change('run', paused.revision, 'resume');
        const last = queue.claim('test', 1, 1000);
        queue.begin(last);
        const hash = 'a'.repeat(64);
        const receipt = other.finish(last, 'FINISHED', hash);
        now = 4000;
        assert.deepEqual(other.finish(last, 'FINISHED', hash), receipt);
        assert.throws(() => other.finish(last, 'FINISHED', 'b'.repeat(64)), /JOB_RESULT_CONFLICT/);
        assert.throws(() => other.finish(first, 'FINISHED', hash), /JOB_LEASE_LOST/);
        assert.deepEqual(queue.history('run').map(attempt => attempt.outcome), ['LEASE_EXPIRED', 'PAUSED', 'FINISHED']);
        assert.equal(queue.history('run').at(-1).resultHash, hash);
        assert.equal(queue.get('run').state, 'FINISHED');
        assert.equal(queue.claim('test', 1, 1000), undefined);

        db.prepare("INSERT INTO agent_run VALUES ('deadline')").run();
        queue.enqueue({ id: 'deadline', projectId: 'sample', kind: 'test', actorId: 'alice', fingerprint: 'deadline',
            input: {}, availableAt: 4000, budgetMs: 200 });
        const expiring = queue.claim('test', 1, 1000);
        now = 4200;
        assert.equal(queue.renew(expiring, 1000), undefined);
        assert.throws(() => queue.finish(expiring, 'FINISHED', hash), /JOB_DEADLINE_EXPIRED/);
        assert.equal(queue.finish(expiring, 'FAILED').state, 'FAILED');
    } finally { db.close(); }
});

test('external execution waits for verified exit before reclaim and retains the remaining deadline', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec("PRAGMA foreign_keys=ON; CREATE TABLE project(id TEXT PRIMARY KEY); CREATE TABLE agent_run(id TEXT PRIMARY KEY); INSERT INTO project VALUES ('sample'); INSERT INTO agent_run VALUES ('isolated');");
        let now = 1000;
        const queue = new DurableJobs(db, () => now);
        queue.enqueue({ id: 'isolated', projectId: 'sample', kind: 'isolated', actorId: 'alice', fingerprint: 'initial',
            input: { test: 'stable' }, availableAt: now, budgetMs: 5_000 });
        const first = queue.claim('isolated', 1, 1000, [], false);
        queue.begin(first);
        now = 2200;
        assert.equal(queue.claim('isolated', 1, 1000, [], false), undefined);
        const expired = queue.expired('isolated');
        assert.deepEqual({ ...expired }, { id: first.id, leaseId: first.leaseId, deadline: first.deadline, attempt: first.attempt });
        assert.equal(queue.recoverAfterExit(expired).state, 'QUEUED');
        assert.equal(queue.recoverAfterExit(expired), undefined);
        const second = queue.claim('isolated', 1, 1000, [], false);
        assert.equal(second.attempt, 2);
        assert.equal(second.deadline, 6000);
        assert.equal(queue.history('isolated')[0].outcome, 'LEASE_EXPIRED');
        assert.throws(() => queue.begin(first), /JOB_LEASE_LOST/);
    } finally { db.close(); }
});
