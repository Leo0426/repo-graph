import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { HttpError } from './http-error.js';
import { redactReviewText } from './review-redaction.js';

const command = promisify(execFile);
const imagePattern = /^[a-z0-9][a-z0-9._:/-]{0,255}@sha256:[a-f0-9]{64}$/;
const containerName = /^repograph-worker-[a-f0-9-]{36}(?:-[1-9][0-9]*)?$/;
const ownershipLabel = 'org.repograph.verifier';
const ownershipValue = 'node-test-v1';
const daemonTimeout = 5_000;
const probeLifetime = 30_000;
const outputLimit = 32 * 1024;
export const verifierSourceLimit = 8 * 1024 * 1024;
export const verifierFileLimit = 256;
export const verifierFile = z.string().min(1).max(4096)
    .refine(path => path.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\\x00-\x1f\x7f]/.test(part)));
const probeScript = `const fs = require('node:fs'), assert = require('node:assert/strict'), os = require('node:os');
assert.equal(process.getuid(), 65534);
assert.equal(fs.readFileSync('/source/worker-probe', 'utf8'), 'frozen');
assert.throws(() => fs.writeFileSync('/source/worker-probe', 'changed'));
assert.throws(() => fs.writeFileSync('/tmp/readonly-probe', 'changed'));
assert.deepEqual(Object.keys(os.networkInterfaces()), ['lo']);
assert.equal(process.env.REPOGRAPH_ACCESS_TOKEN, undefined);
fs.writeFileSync('/work/worker-probe', 'scratch');
console.log('isolation-ok');`;

type Result = { status: 'PASSED' | 'FAILED' | 'UNAVAILABLE' | 'TIMED_OUT' | 'CANCELLED' | 'OUTPUT_LIMIT' | 'RECONCILIATION_REQUIRED';
    output: string; exitCode: number | null };
type Scope = { source: string; config: string };
type Runtime = { endpoint: string; scope: Scope };
type FrozenFile = { path: string; content: Uint8Array | string };

export class DockerVerifier {
    private probe: { until: number; result: Promise<boolean> } | undefined;

    static fromEnvironment(env: NodeJS.ProcessEnv, spool?: string) {
        const image = env.REPOGRAPH_VERIFIER_IMAGE;
        if (!image) return undefined;
        if (!imagePattern.test(image)) throw new Error('REPOGRAPH_VERIFIER_IMAGE must pin an image digest');
        return new DockerVerifier(image, spool);
    }

    constructor(readonly image: string, private readonly spool?: string) {
        if (!imagePattern.test(image)) throw new Error('Verifier image must pin an immutable digest');
    }

    available() {
        if (this.probe && this.probe.until > Date.now()) return this.probe.result;
        const result = this.workspace([{ path: 'worker-probe', content: 'frozen' }], async runtime => {
            const outcome = await this.run(runtime, 'repograph-worker-' + randomUUID(), ['-e', probeScript], 6500);
            return outcome.status === 'PASSED' && outcome.output.trim() === 'isolation-ok';
        }).catch(() => false);
        this.probe = { until: Date.now() + probeLifetime, result };
        return result;
    }

    async test(name: string, files: readonly FrozenFile[], testPaths: readonly string[], timeoutMs: number,
        signal?: AbortSignal, assertAllowed?: () => void): Promise<Result> {
        if (!containerName.test(name)) throw new Error('Invalid verifier container name');
        if (!testPaths.length || testPaths.some(path => !verifierFile.safeParse(path).success || !files.some(file => file.path === path))) {
            throw new HttpError(400, 'VERIFIER_TEST_SOURCE_NOT_FOUND');
        }
        if (!await this.available()) return { status: 'UNAVAILABLE', exitCode: null, output: '' };
        const args = ['--test', '--test-concurrency=1', '--test-reporter=tap', ...testPaths.map(path => '/source/' + path)];
        if (signal?.aborted) return { status: 'CANCELLED', exitCode: null, output: '' };
        const result = await this.workspace(files, runtime => this.run(runtime, name, args, timeoutMs, signal, assertAllowed), name);
        if (result.status === 'UNAVAILABLE') this.probe = undefined;
        return result;
    }

    async reconcile(name: string) {
        if (!containerName.test(name)) throw new Error('Invalid verifier container name');
        try {
            if (!await this.workspace([], runtime => this.remove(runtime, name))) return false;
            if (this.spool) await rm(join(await this.spoolPath(this.spool), name), { recursive: true, force: true });
            return true;
        } catch { return false; }
    }

    private async spoolPath(path: string) {
        await mkdir(path, { recursive: true, mode: 0o700 });
        const stat = await lstat(path);
        if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error('Verifier workspace is not private');
        return realpath(path);
    }

    private async workspace<T>(files: readonly FrozenFile[], action: (runtime: Runtime) => Promise<T>, name?: string) {
        const root = name && this.spool ? join(await this.spoolPath(this.spool), name)
            : await realpath(await mkdtemp(join(tmpdir(), 'repograph-worker-')));
        if (name && this.spool) await mkdir(root, { mode: 0o700 });
        try {
            if (files.length > verifierFileLimit || files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0) > verifierSourceLimit) {
                throw new HttpError(413, 'VERIFIER_SOURCE_TOO_LARGE');
            }
            const scope: Scope = { source: join(root, 'source'), config: join(root, 'docker') };
            await mkdir(scope.config, { mode: 0o700 });
            await mkdir(scope.source, { mode: 0o755 });
            for (const file of files) {
                if (!verifierFile.safeParse(file.path).success) throw new HttpError(400, 'VERIFIER_SOURCE_PATH_INVALID');
                const destination = join(scope.source, file.path);
                await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
                await writeFile(destination, file.content, { flag: 'wx', mode: 0o644 });
            }
            const endpoint = await this.endpoint();
            return await action({ scope, endpoint });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }

    private async endpoint() {
        const { stdout } = await command('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { timeout: daemonTimeout });
        const endpoint = stdout.trim();
        if (!/^unix:\/\/\/[^\u0000-\u001f\u007f]+$/u.test(endpoint)) throw new Error('Docker must use a local Unix socket');
        return endpoint;
    }

    private docker(runtime: Runtime, args: string[], timeout: number, signal?: AbortSignal, maxBuffer = outputLimit) {
        const env = { ...process.env, DOCKER_CONTEXT: undefined, DOCKER_HOST: undefined, DOCKER_CONFIG: undefined,
            DOCKER_TLS: undefined, DOCKER_TLS_VERIFY: undefined, DOCKER_CERT_PATH: undefined };
        return command('docker', ['--config', runtime.scope.config, '--host', runtime.endpoint, 'container', ...args],
            { env, signal, timeout, maxBuffer, encoding: 'utf8' });
    }

    private async remove(runtime: Runtime, name: string) {
        const list = async () => (await this.docker(runtime, ['ls', '--all', '--quiet', '--no-trunc',
            '--filter', 'name=^/' + name + '$', '--filter', 'label=' + ownershipLabel + '=' + ownershipValue], daemonTimeout)).stdout.trim();
        try {
            const id = await list();
            if (!id) return true;
            if (!/^[a-f0-9]{64}$/.test(id)) return false;
            await this.docker(runtime, ['rm', '--force', '--volumes', id], daemonTimeout);
            return !await list();
        } catch { return false; }
    }

    private async run(runtime: Runtime, name: string, args: string[], timeoutMs: number, signal?: AbortSignal,
        assertAllowed?: () => void): Promise<Result> {
        const time = AbortSignal.timeout(timeoutMs);
        const stopped = signal ? AbortSignal.any([signal, time]) : time;
        const { source } = runtime.scope;
        if (/[,\r\n]/.test(source)) return { status: 'UNAVAILABLE', exitCode: null, output: '' };
        let output = '';
        let exitCode: number | null = null;
        let status: Result['status'] = 'UNAVAILABLE';
        try {
            stopped.throwIfAborted();
            assertAllowed?.();
            const result = await this.docker(runtime, ['create', '--name', name, '--label', `${ownershipLabel}=${ownershipValue}`,
                '--pull=never', '--read-only', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true',
                '--pids-limit', '32', '--cpus', '1', '--memory', '256m', '--memory-swap', '256m', '--user', '65534:65534',
                '--workdir', '/work', '--tmpfs', '/work:rw,noexec,nosuid,nodev,size=16m,mode=1777', '--mount',
                `type=bind,source=${source},target=/source,readonly,bind-recursive=disabled`, '--env', 'HOME=/work',
                '--no-healthcheck', '--log-driver', 'none', '--entrypoint', '/usr/local/bin/node', this.image, ...args], daemonTimeout);
            const id = result.stdout.trim();
            if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Missing verifier container ID');
            stopped.throwIfAborted();
            assertAllowed?.();
            const execution = await this.docker(runtime, ['start', '--attach', id], 0, stopped).catch((error: unknown) => {
                if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'number' && !stopped.aborted) {
                    return { stdout: 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '',
                        stderr: 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '' };
                }
                throw error;
            });
            const { stdout } = await this.docker(runtime, ['inspect', '--format', '{{.State.Status}} {{.State.ExitCode}}', id], daemonTimeout);
            const exit = /^exited (\d{1,3})\s*$/.exec(stdout);
            if (exit) {
                exitCode = Number(exit[1]);
                output = redactReviewText((execution.stdout + '\n' + execution.stderr).trim()).slice(0, outputLimit);
                status = exitCode ? 'FAILED' : 'PASSED';
            }
        } catch (error) {
            status = signal?.aborted ? 'CANCELLED' : time.aborted ? 'TIMED_OUT'
                : error && typeof error === 'object' && 'code' in error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'OUTPUT_LIMIT' : 'UNAVAILABLE';
        }
        if (!await this.remove(runtime, name)) return { status: 'RECONCILIATION_REQUIRED', exitCode: null, output: '' };
        return { status, exitCode, output };
    }
}
