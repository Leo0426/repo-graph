import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import { maxFindingBody, maxFindingRows, normalizeFindings } from './finding-import.js';
import type { ArchiveFile } from './archive.js';
import { runScanner } from './scanner-process.js';
import type { ScannerAdapter, ScannerResult } from './scanner-process.js';

export const semgrepLanguages = [
    'java', 'kotlin', 'c', 'cpp', 'python', 'javascript', 'typescript', 'go', 'php', 'ruby', 'solidity'
];
const scanFlags = [
    '--json', '--metrics=off', '--disable-version-check', '--no-git-ignore', '--no-rewrite-rule-ids',
    // An uploaded archive can contain its own target-selection files.
    '--x-ignore-semgrepignore-files', '--jobs=1'
];

function environment(cwd: string) {
    return {
        SEMGREP_SETTINGS_FILE: join(cwd, 'settings.yml'), SEMGREP_SEND_METRICS: 'off', SEMGREP_ENABLE_VERSION_CHECK: '0'
    };
}

export class Semgrep implements ScannerAdapter {
    private readonly binary = process.env.REPOGRAPH_SEMGREP_BINARY?.trim() || 'semgrep';
    private readonly rules = process.env.REPOGRAPH_SEMGREP_RULES?.trim();

    constructor(private readonly managedRoot: string) {}

    private async rulesPath() {
        if (!this.rules || !isAbsolute(this.rules) || (this.binary !== 'semgrep' && !isAbsolute(this.binary))) return;
        try {
            const rules = await realpath(this.rules);
            if (rules === this.managedRoot || rules.startsWith(this.managedRoot + sep)) return;
            if ((await lstat(rules)).isFile()) return rules;
        } catch { /* Invalid operator configuration is reported as unavailable. */ }
        return undefined;
    }

    private async version(cwd: string, signal: AbortSignal) {
        const result = await runScanner(this.binary, ['--version'], cwd, 8192, signal, environment(cwd));
        const version = result.output.split(/\r?\n/, 1)[0].trim();
        if (result.exitCode === 0 && /^\d+\.\d+\.\d+[a-z\d.+-]{0,50}$/i.test(version)) return version;
        return '';
    }

    async capability() {
        const capability = { scanner: 'SEMGREP', languages: semgrepLanguages, requiredCommand: 'semgrep',
            outputFormat: 'semgrep-json', prerequisites: ['Readable managed source', 'Server-local Semgrep executable and rules file'] };
        if (!await this.rulesPath()) return { capability, available: false, toolVersion: '', error: 'SCANNER_NOT_CONFIGURED' };
        const work = await mkdtemp(join(tmpdir(), 'repograph-semgrep-'));
        try {
            const toolVersion = await this.version(work, AbortSignal.timeout(5000));
            return { capability, available: !!toolVersion, toolVersion, error: toolVersion ? '' : 'SCANNER_UNAVAILABLE' };
        } finally { await rm(work, { recursive: true, force: true }); }
    }

    async scan(root: string, _files: ArchiveFile[], signal: AbortSignal): Promise<ScannerResult> {
        const rules = await this.rulesPath();
        if (!rules) return { status: 'UNAVAILABLE', exitCode: -1, toolVersion: '', error: 'SCANNER_NOT_CONFIGURED' };
        const work = await mkdtemp(join(tmpdir(), 'repograph-semgrep-'));
        try {
            const toolVersion = await this.version(work, AbortSignal.any([signal, AbortSignal.timeout(5000)]));
            if (!toolVersion) return { status: 'UNAVAILABLE', exitCode: -1, toolVersion, error: 'SCANNER_UNAVAILABLE' };
            signal.throwIfAborted();
            const { exitCode, output, error } = await runScanner(this.binary,
                ['scan', '--config', rules, ...scanFlags, '--project-root', root, root], work, maxFindingBody, signal, environment(work));
            if (error === 'SCANNER_TIMED_OUT') return { status: 'TIMED_OUT', exitCode, toolVersion, error };
            if (error || (exitCode !== 0 && exitCode !== 1)) {
                return { status: 'FAILED', exitCode, toolVersion, error: error || 'SCANNER_EXIT_FAILED' };
            }
            try {
                const body = JSON.parse(output);
                const report = normalizeFindings('semgrep', body, root, maxFindingRows, { codeVersion: '', ruleVersion: '' });
                const partial = report.truncated || report.skipped.length > 0 || (Array.isArray(body.errors) && body.errors.length > 0);
                return { status: partial ? 'PARTIAL' : 'SUCCEEDED', exitCode, toolVersion,
                    error: partial ? 'SCANNER_INCOMPLETE_REPORT' : '', report };
            } catch { return { status: 'FAILED', exitCode, toolVersion, error: 'INVALID_SCANNER_REPORT' }; }
        } finally { await rm(work, { recursive: true, force: true }); }
    }
}
