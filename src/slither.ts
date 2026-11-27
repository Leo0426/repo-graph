import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import type { ArchiveFile } from './archive.js';
import { maxFindingBody, maxFindingRows, normalizeFindings } from './finding-import.js';
import { readProjectFile, relativeEvidencePath } from './project-file.js';
import { runScanner, scannerWorkPrefix } from './scanner-process.js';
import type { ScannerAdapter, ScannerResult } from './scanner-process.js';

const maxSources = 2_000;
const maxSourceBytes = 2 * 1024 * 1024;
const maxSnapshotBytes = 64 * 1024 * 1024;

async function stageSolidity(root: string, files: ArchiveFile[], source: string, signal: AbortSignal) {
    const staged = new Set<string>();
    let remaining = maxSnapshotBytes;
    let incomplete = false;
    await mkdir(source);
    for (const file of files) {
        signal.throwIfAborted();
        if (!/\.sol$/i.test(file.path)) continue;
        const path = relativeEvidencePath(file.path);
        const limit = Math.min(remaining, maxSourceBytes);
        if (staged.size >= maxSources || path !== file.path || file.sizeBytes > limit) {
            incomplete = true;
            continue;
        }
        const bytes = await readProjectFile(join(root, path), limit).catch(() => undefined);
        if (!bytes) {
            incomplete = true;
            continue;
        }
        if (basename(path).startsWith('._') && bytes.length >= 8 && bytes.readUInt32BE(0) === 0x00051607) continue;
        const destination = join(source, path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, bytes, { flag: 'wx', signal });
        remaining -= bytes.length;
        staged.add(path);
    }
    return { staged, incomplete };
}

function solidityImport(path: string) {
    return './' + path.replace(/[^\x20-\x7e]|["\\]/gu, char =>
        [...Buffer.from(char)].map(byte => '\\x' + byte.toString(16).padStart(2, '0')).join(''));
}

export class Slither implements ScannerAdapter {
    private readonly slither = process.env.REPOGRAPH_SLITHER_BINARY?.trim();
    private readonly solc = process.env.REPOGRAPH_SOLC_BINARY?.trim();

    constructor(private readonly managedRoot: string) {}

    private async executable(path?: string) {
        if (!path || !isAbsolute(path)) return;
        try {
            const file = await realpath(path);
            if (file !== this.managedRoot && !file.startsWith(this.managedRoot + sep) && (await lstat(file)).isFile()) return file;
        } catch { /* Operator configuration is unavailable. */ }
        return undefined;
    }

    private async versions(slither: string, solc: string, work: string, signal: AbortSignal) {
        const [scanner, compiler] = await Promise.all([runScanner(slither, ['--version'], work, 8192, signal),
            runScanner(solc, ['--version'], work, 8192, signal)]);
        const toolVersion = scanner.exitCode === 0 ? scanner.output.trim().match(/^\d+\.\d+\.\d+[a-z\d.+-]{0,50}$/i)?.[0] ?? '' : '';
        const compilerVersion = compiler.exitCode === 0 ? compiler.output.match(/^Version:\s*(\d+\.\d+\.\d+)(?=[+\s]|$)/m)?.[1] ?? '' : '';
        return { toolVersion, compilerVersion };
    }

    async capability() {
        const capability = { scanner: 'SLITHER', languages: ['solidity'], requiredCommand: 'slither',
            outputFormat: 'slither-json', prerequisites: ['Server-local Slither and Solidity compiler', 'Self-contained Solidity sources'] };
        const [slither, solc] = await Promise.all([this.executable(this.slither), this.executable(this.solc)]);
        if (!slither || !solc) return { capability, available: false, toolVersion: '', error: 'SLITHER_NOT_CONFIGURED' };
        const work = await mkdtemp(scannerWorkPrefix(await realpath(tmpdir()), 'repograph-slither-'));
        try {
            const { toolVersion, compilerVersion } = await this.versions(slither, solc, work, AbortSignal.timeout(5000));
            const available = !!(toolVersion && compilerVersion);
            return { capability, available, toolVersion, error: available ? '' : 'SCANNER_UNAVAILABLE' };
        } finally { await rm(work, { recursive: true, force: true }); }
    }

    async scan(root: string, files: ArchiveFile[], signal: AbortSignal): Promise<ScannerResult> {
        const [slither, solc] = await Promise.all([this.executable(this.slither), this.executable(this.solc)]);
        if (!slither || !solc) return { status: 'UNAVAILABLE', exitCode: -1, toolVersion: '', error: 'SLITHER_NOT_CONFIGURED' };
        const work = await mkdtemp(scannerWorkPrefix(await realpath(tmpdir()), 'repograph-slither-'));
        try {
            const { toolVersion, compilerVersion } = await this.versions(slither, solc, work, AbortSignal.any([signal, AbortSignal.timeout(5000)]));
            if (!toolVersion || !compilerVersion) return { status: 'UNAVAILABLE', exitCode: -1, toolVersion, error: 'SCANNER_UNAVAILABLE' };
            const source = join(work, 'source');
            const { staged, incomplete } = await stageSolidity(root, files, source, signal);
            if (!staged.size) return { status: 'FAILED', exitCode: -1, toolVersion,
                error: incomplete ? 'SLITHER_SOURCE_INCOMPLETE' : 'SLITHER_NO_SUPPORTED_SOURCE' };

            // A namespaced import for each source keeps one compilation within the staged tree.
            let entry = '.repograph-review.sol';
            while (staged.has(entry)) entry = '_' + entry;
            const imports = [...staged].map((path, index) => `import * as ReviewSource${index} from "${solidityImport(path)}";`);
            await writeFile(join(source, entry), ['// SPDX-License-Identifier: UNLICENSED',
                `pragma solidity =${compilerVersion};`, ...imports, ''].join('\n'), { flag: 'wx', signal });
            const entryFilter = '(^|/)' + entry.replaceAll('.', '\\.') + '$';
            const { exitCode, output, error } = await runScanner(slither, [
                entry, '--compile-force-framework', 'solc', '--solc', solc,
                '--solc-args=--base-path . --allow-paths .', '--filter-paths', entryFilter, '--json', '-'
            ], source, maxFindingBody, signal, { TMPDIR: work });
            if (error) return { status: error === 'SCANNER_TIMED_OUT' ? 'TIMED_OUT' : 'FAILED', exitCode, toolVersion, error };
            try {
                const body = JSON.parse(output);
                if (body?.success === false) return { status: 'FAILED', exitCode, toolVersion, error: 'SLITHER_ANALYSIS_FAILED' };
                const report = normalizeFindings('slither', body, source, maxFindingRows, { codeVersion: '', ruleVersion: '' });
                const scoped = report.findings.filter(finding => staged.has(finding.filePath));
                const partial = incomplete || report.truncated || !!report.skipped.length || scoped.length < report.findings.length;
                return { status: partial ? 'PARTIAL' : 'SUCCEEDED', exitCode, toolVersion,
                    error: partial ? 'SCANNER_INCOMPLETE_REPORT' : '', report: { ...report, findings: scoped } };
            } catch {
                return { status: 'FAILED', exitCode, toolVersion, error: exitCode ? 'SLITHER_ANALYSIS_FAILED' : 'INVALID_SCANNER_REPORT' };
            }
        } finally { await rm(work, { recursive: true, force: true }); }
    }
}
