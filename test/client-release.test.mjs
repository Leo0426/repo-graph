import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { create } from 'tar';

const run = promisify(execFile);
const installer = fileURLToPath(new URL('../scripts/client-release.mjs', import.meta.url));

test('client releases activate only after signature, origin, platform, digest and startup checks', { timeout: 15_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'repograph-client-install-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const trustedKey = join(root, 'publisher.pem');
    await writeFile(trustedKey, publicKey.export({ format: 'pem', type: 'spki' }));
    const origin = 'https://releases.example.test';
    const target = join(root, 'installation space');
    async function packageRelease(version, { name = version, arch = process.arch, broken = false, signedBy = privateKey } = {}) {
        const staged = join(root, 'stage-' + name);
        const release = join(root, 'release-' + name);
        await mkdir(join(staged, 'dist'), { recursive: true });
        await mkdir(join(staged, 'node_modules'));
        await mkdir(release);
        await writeFile(join(staged, 'package.json'), JSON.stringify({ name: 'repograph-client', version, type: 'module' }));
        await writeFile(join(staged, 'dist', 'cli.js'), broken ? 'invalid script (' : 'console.log("fixture works");\n');
        await writeFile(join(staged, 'dist', 'mcp.js'), 'process.stdin.unref?.();\n');
        const file = `repograph-client-${version}-${process.platform}-${arch}.tgz`;
        const archive = join(release, file);
        await create({ file: archive, cwd: staged, gzip: true, portable: true }, ['package.json', 'dist', 'node_modules']);
        const bytes = await readFile(archive);
        const manifest = Buffer.from(JSON.stringify({ schema: 1, version, platform: process.platform, arch, origin,
            file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
        await writeFile(join(release, 'manifest.json'), manifest);
        await writeFile(join(release, 'manifest.ed25519'), sign(null, manifest, signedBy));
        return { release, archive };
    }
    const install = (release, expectedOrigin = origin) => run(process.execPath, [installer, 'install', target, release, expectedOrigin, trustedKey]);
    const active = async () => (await run(process.execPath, [join(target, 'cli.mjs'), '--version'])).stdout.trim();
    const initial = await packageRelease('0.1.0');
    assert.equal(JSON.parse((await install(initial.release)).stdout).active, '0.1.0');
    assert.equal(await active(), '0.1.0');

    const valid = await packageRelease('0.2.0');
    await assert.rejects(install(valid.release, 'https://untrusted.example.test'), /RELEASE_SOURCE_MISMATCH/);
    const wrongPlatform = await packageRelease('0.2.1', { arch: 'different' });
    await assert.rejects(install(wrongPlatform.release), /RELEASE_PLATFORM_MISMATCH/);
    const foreign = generateKeyPairSync('ed25519');
    const impostor = await packageRelease('0.2.2', { signedBy: foreign.privateKey });
    await assert.rejects(install(impostor.release), /RELEASE_SIGNATURE_INVALID/);
    const damaged = await packageRelease('0.2.3');
    const changed = await readFile(damaged.archive);
    changed[10] ^= 1;
    await writeFile(damaged.archive, changed);
    await assert.rejects(install(damaged.release), /RELEASE_DIGEST_MISMATCH/);
    const broken = await packageRelease('0.2.4', { broken: true });
    await assert.rejects(install(broken.release), /SyntaxError/);
    assert.equal(await active(), '0.1.0');

    const competing = await Promise.all([install(valid.release), install(valid.release)]);
    assert.ok(competing.every(result => JSON.parse(result.stdout).active === '0.2.0'));
    assert.equal(await active(), '0.2.0');
    assert.equal((await stat(join(target, 'versions', '0.1.0', 'dist', 'cli.js'))).isFile(), true);
    await assert.rejects(install(initial.release), /RELEASE_DOWNGRADE_REFUSED/);
});
