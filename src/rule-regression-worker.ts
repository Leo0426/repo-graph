import { parentPort, workerData } from 'node:worker_threads';

const { pattern, positiveSamples, negativeSamples } = workerData as { pattern: string; positiveSamples: string[]; negativeSamples: string[] };
let matcher: RegExp | undefined;
try { matcher = new RegExp(pattern, 's'); } catch { /* The caller receives a stable error code. */ }
parentPort?.postMessage(!matcher ? 'RULE_INVALID_PATTERN'
    : positiveSamples.every(item => matcher.test(item)) && negativeSamples.every(item => !matcher.test(item)) ? 'OK' : 'RULE_REGRESSION_FAILED');
