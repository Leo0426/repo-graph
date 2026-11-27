import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, sep } from 'node:path';
import type { ArchiveFile } from './archive.js';
import { maxFindingBody, maxFindingRows, normalizeFindings } from './finding-import.js';
import { readProjectFile, relativeEvidencePath } from './project-file.js';
import { runScanner, scannerWorkPrefix } from './scanner-process.js';
import type { ScannerAdapter, ScannerResult } from './scanner-process.js';

const languageGroups = [
    { extractor: 'javascript-typescript', languages: ['javascript', 'typescript'],
        extensions: new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']) },
    { extractor: 'java-kotlin', languages: ['java'], extensions: new Set(['.java']) },
    { extractor: 'python', languages: ['python'], extensions: new Set(['.py']) },
    { extractor: 'csharp', languages: ['csharp'], extensions: new Set(['.cs']) },
    { extractor: 'ruby', languages: ['ruby'], extensions: new Set(['.rb']) }
];
export const codeqlLanguages = languageGroups.flatMap(group => group.languages);
const maxSnapshotBytes = 128 * 1024 * 1024;
const maxSourceBytes = 4 * 1024 * 1024;
const maxSnapshotFiles = 20_000;
const ignoredDirectory = /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|__pycache__|\.git)\//i;

type Report = ReturnType<typeof normalizeFindings>;

async function stageSources(source: string, files: ArchiveFile[], target: string, signal: AbortSignal) {
    const staged = new Set<string>();
    const extractors = new Set<string>();
    let incomplete = false;
    let remaining = maxSnapshotBytes;
    await mkdir(target);
    for (const file of files) {
        signal.throwIfAborted();
        const path = relativeEvidencePath(file.path);
        if (path !== file.path || !path || ignoredDirectory.test(path) || /\.min\.js$/i.test(path)) continue;
        const extension = extname(path).toLowerCase();
        const group = languageGroups.find(candidate => candidate.extensions.has(extension));
        if (!group) continue;
        if (staged.size >= maxSnapshotFiles) {
            incomplete = true;
            break;
        }
        const limit = Math.min(remaining, maxSourceBytes);
        if (file.sizeBytes > limit) {
            incomplete = true;
            continue;
        }
        const bytes = await readProjectFile(join(source, path), limit).catch(() => undefined);
        if (!bytes) {
            incomplete = true;
            continue;
        }
        const destination = join(target, path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, bytes, { flag: 'wx', signal });
        remaining -= bytes.length;
        staged.add(path);
        extractors.add(group.extractor);
    }
    return { extractors, staged, incomplete };
}

export class CodeQl implements ScannerAdapter {
    private readonly binary = process.env.REPOGRAPH_CODEQL_BINARY?.trim();

    constructor(private readonly managedRoot: string) {}

    private async executablePath() {
        if (!this.binary || !isAbsolute(this.binary)) return undefined;
        try {
            const binary = await realpath(this.binary);
            if (!binary.startsWith(this.managedRoot + sep) && (await lstat(binary)).isFile()) return binary;
        } catch { /* Invalid operator configuration is reported as unavailable. */ }
        return undefined;
    }

    private async version(binary: string, work: string, signal: AbortSignal) {
        const result = await runScanner(binary, ['version', '--format=json'], work, 8192, signal);
        if (result.exitCode !== 0 || result.error) return '';
        try {
            const version = JSON.parse(result.output)?.version;
            return typeof version === 'string' && /^\d+\.\d+\.\d+[a-z\d.+-]{0,50}$/i.test(version) ? version : '';
        } catch { return ''; }
    }

    async capability() {
        const capability = { scanner: 'CODEQL', languages: codeqlLanguages, requiredCommand: 'codeql',
            outputFormat: 'sarif-2.1.0', prerequisites: ['Server-local CodeQL CLI bundle', 'One supported source language'] };
        const binary = await this.executablePath();
        if (!binary) return { capability, available: false, toolVersion: '', error: 'CODEQL_NOT_CONFIGURED' };
        const work = await mkdtemp(scannerWorkPrefix(await realpath(tmpdir()), 'repograph-codeql-'));
        try {
            const toolVersion = await this.version(binary, work, AbortSignal.timeout(5000));
            return { capability, available: !!toolVersion, toolVersion, error: toolVersion ? '' : 'SCANNER_UNAVAILABLE' };
        } finally { await rm(work, { recursive: true, force: true }); }
    }

    async scan(root: string, files: ArchiveFile[], signal: AbortSignal): Promise<ScannerResult> {
        const binary = await this.executablePath();
        if (!binary) return { status: 'UNAVAILABLE', exitCode: -1, toolVersion: '', error: 'CODEQL_NOT_CONFIGURED' };
        const work = await mkdtemp(scannerWorkPrefix(await realpath(tmpdir()), 'repograph-codeql-'));
        try {
            const toolVersion = await this.version(binary, work, AbortSignal.any([signal, AbortSignal.timeout(5000)]));
            if (!toolVersion) return { status: 'UNAVAILABLE', exitCode: -1, toolVersion, error: 'SCANNER_UNAVAILABLE' };
            const source = join(work, 'source');
            const { extractors, staged, incomplete } = await stageSources(root, files, source, signal);
            if (!extractors.size) return { status: 'FAILED', exitCode: -1, toolVersion,
                error: incomplete ? 'CODEQL_SOURCE_INCOMPLETE' : 'CODEQL_NO_SUPPORTED_SOURCE' };
            const report: Report = { findings: [], skipped: [], reported: 0, truncated: false };
            const failures: string[] = [];
            let completed = 0;
            let exitCode = 0;
            for (const extractor of extractors) {
                if (signal.aborted) break;
                const result = await this.analyze(binary, work, source, extractor, maxFindingRows - report.findings.length, signal);
                if (result.error || !result.report) {
                    failures.push(extractor + ': ' + result.error);
                    exitCode = result.exitCode;
                    continue;
                }
                completed++;
                const { findings, reported, skipped, truncated } = result.report;
                const scoped = findings.filter(finding => staged.has(finding.filePath));
                report.findings.push(...scoped);
                report.reported += reported;
                report.skipped.push(...skipped);
                report.truncated ||= truncated || scoped.length < findings.length;
            }
            if (!completed) return { status: 'FAILED', exitCode, toolVersion, error: failures.join(', ') };
            const partial = completed < extractors.size || incomplete || report.truncated || report.skipped.length > 0;
            return { status: partial ? 'PARTIAL' : 'SUCCEEDED', exitCode, toolVersion, report,
                error: failures.length ? failures.join(', ') : partial ? 'SCANNER_INCOMPLETE_REPORT' : '' };
        } finally { await rm(work, { recursive: true, force: true }); }
    }

    private async analyze(binary: string, work: string, source: string, extractor: string, limit: number, signal: AbortSignal) {
        const database = join(work, 'database-' + extractor);
        const output = join(work, 'report-' + extractor + '.sarif');
        const resourceOptions = ['--threads=1', '--ram=2048', '--common-caches=' + join(work, 'cache')];
        const environment: NodeJS.ProcessEnv = { TMPDIR: work };
        if (extractor === 'python') {
            // The bundled extractor imports sibling modules while Python's safe-path mode excludes the script directory.
            environment.PYTHONPATH = join(dirname(binary), 'python', 'tools');
        }
        const create = await runScanner(binary, ['database', 'create', '--language=' + extractor, '--build-mode=none',
            '--source-root=' + source, '--no-run-unnecessary-builds', ...resourceOptions, database], work, 256 * 1024, signal, environment);
        if (create.exitCode !== 0 || create.error) {
            return { exitCode: create.exitCode, error: create.error || 'CODEQL_DATABASE_FAILED' };
        }
        if (signal.aborted) return { exitCode: -1, error: 'SCANNER_INTERRUPTED' };
        const analyze = await runScanner(binary, ['database', 'analyze', '--format=sarifv2.1.0', '--output=' + output,
            '--no-download', '--no-sarif-add-file-contents', '--max-disk-cache=512', ...resourceOptions, database],
        work, 256 * 1024, signal, environment);
        if (analyze.exitCode !== 0 || analyze.error) {
            return { exitCode: analyze.exitCode, error: analyze.error || 'CODEQL_ANALYSIS_FAILED' };
        }
        try {
            if ((await lstat(output)).size > maxFindingBody) return { exitCode: 0, error: 'SCANNER_OUTPUT_LIMIT' };
            const bytes = await readProjectFile(output, maxFindingBody);
            const body = JSON.parse(bytes.toString('utf8'));
            const report = normalizeFindings('codeql', body, source, limit, { codeVersion: '', ruleVersion: '' });
            return { exitCode: 0, error: '', report };
        } catch { return { exitCode: 0, error: 'INVALID_SCANNER_REPORT' }; }
    }
}
