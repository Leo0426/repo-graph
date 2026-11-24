import { spawn } from 'node:child_process';
import { delimiter, isAbsolute } from 'node:path';
import type { ArchiveFile } from './archive.js';
import type { normalizeFindings } from './finding-import.js';
import type { scannerRunStatuses } from './scan-history.js';

export interface ScannerResult {
    status: typeof scannerRunStatuses[number];
    exitCode: number;
    toolVersion: string;
    error: string;
    report?: ReturnType<typeof normalizeFindings>;
}

export interface ScannerAdapter {
    capability(): Promise<{
        capability: { scanner: string; languages: string[]; requiredCommand: string; outputFormat: string; prerequisites: string[] };
        available: boolean;
        toolVersion: string;
        error: string;
    }>;
    scan(root: string, files: ArchiveFile[], signal: AbortSignal): Promise<ScannerResult>;
}

type CommandResult = { exitCode: number; output: string; error: string };

export function runScanner(binary: string, args: string[], cwd: string, limit: number,
    signal: AbortSignal, environment: NodeJS.ProcessEnv = {}): Promise<CommandResult> {
    signal.throwIfAborted();
    const group = process.platform !== 'win32';
    const child = spawn(binary, args, {
        cwd, detached: group, stdio: ['ignore', 'pipe', 'ignore'],
        env: {
            PATH: process.env.PATH?.split(delimiter).filter(isAbsolute).join(delimiter) || '/usr/bin:/bin',
            LANG: 'C.UTF-8', PYTHONUTF8: '1', PYTHONSAFEPATH: '1',
            GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...environment
        }
    });
    return new Promise(resolve => {
        let error = '';
        let size = 0;
        const chunks: Buffer[] = [];
        const stop = (reason: string) => {
            if (error) return;
            error = reason;
            try {
                if (child.pid !== undefined && group) process.kill(-child.pid, 'SIGKILL');
                else child.kill('SIGKILL');
            } catch { /* Process exited before cancellation. */ }
        };
        const abort = () => stop(signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
            ? 'SCANNER_TIMED_OUT' : 'SCAN_CANCELLED');
        signal.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', (chunk: Buffer) => {
            if (error) return;
            size += chunk.length;
            if (size > limit) stop('SCANNER_OUTPUT_LIMIT');
            else chunks.push(chunk);
        });
        child.once('error', (failure: NodeJS.ErrnoException) => {
            error = failure.code === 'ENOENT' || failure.code === 'EACCES' ? 'SCANNER_UNAVAILABLE' : 'SCANNER_EXECUTION_FAILED';
        });
        child.once('close', code => {
            signal.removeEventListener('abort', abort);
            resolve({ exitCode: code ?? -1, output: error ? '' : Buffer.concat(chunks, size).toString('utf8'), error });
        });
    });
}
