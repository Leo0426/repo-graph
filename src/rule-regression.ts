import { Worker } from 'node:worker_threads';
import { HttpError } from './http-error.js';
import type { DetectionRule } from './detection-rules.js';

let workers = 0;

export async function assertRuleSamples(rule: DetectionRule, signal: AbortSignal) {
    const { matcherKind, pattern, positiveSamples, negativeSamples } = rule;
    if (!positiveSamples.length || !negativeSamples.length) throw new HttpError(409, 'RULE_SAMPLES_REQUIRED');
    const totalSize = Buffer.byteLength(pattern) + [...positiveSamples, ...negativeSamples].reduce((sum, item) => sum + Buffer.byteLength(item), 0);
    if (totalSize > 256 * 1024 || positiveSamples.length + negativeSamples.length > 128) throw new HttpError(409, 'RULE_SAMPLE_LIMIT');
    if (signal.aborted) throw new HttpError(409, 'RULE_REGRESSION_CANCELLED');
    if (matcherKind === 'SUBSTRING') {
        if (positiveSamples.some(item => !item.includes(pattern)) || negativeSamples.some(item => item.includes(pattern))) {
            throw new HttpError(409, 'RULE_REGRESSION_FAILED');
        }
        return;
    }

    if (workers >= 4) throw new HttpError(503, 'RULE_REGRESSION_BUSY');
    const worker = new Worker(new URL('./rule-regression-worker.js', import.meta.url), {
        workerData: { pattern, positiveSamples, negativeSamples }, resourceLimits: { maxOldGenerationSizeMb: 32, stackSizeMb: 2 }
    });
    workers++;
    try {
        const result = await new Promise<string>(resolve => {
            const done = (status: string) => {
                clearTimeout(timer);
                signal.removeEventListener('abort', cancelled);
                resolve(status);
            };
            const cancelled = () => done('RULE_REGRESSION_CANCELLED');
            const timer = setTimeout(() => done('RULE_REGRESSION_TIMED_OUT'), 1500);
            worker.once('error', () => done('RULE_REGRESSION_UNAVAILABLE'));
            worker.once('exit', () => done('RULE_REGRESSION_UNAVAILABLE'));
            worker.once('message', message => done(message === 'OK' || message === 'RULE_INVALID_PATTERN' || message === 'RULE_REGRESSION_FAILED'
                ? message : 'RULE_REGRESSION_UNAVAILABLE'));
            if (signal.aborted) cancelled();
            else signal.addEventListener('abort', cancelled, { once: true });
        });
        if (result !== 'OK') throw new HttpError(result === 'RULE_REGRESSION_UNAVAILABLE' ? 503 : 409, result);
    } finally {
        try { await worker.terminate(); } finally { workers--; }
    }
}
