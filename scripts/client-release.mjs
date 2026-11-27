import { execFile } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const installer = fileURLToPath(import.meta.url);
const repository = resolve(dirname(installer), '..');
const versionPattern = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const maxManifestBytes = 8192;
const maxArchiveBytes = 256 * 1024 * 1024;

function originOf(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('RELEASE_SOURCE_INVALID');
    }
    return url.origin;
}

function fileName(version, platform, arch) { return `repograph-client-${version}-${platform}-${arch}.tgz`; }

function byVersion(a, b) {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    return (right[0] - left[0]) || (right[1] - left[1]) || (right[2] - left[2]);
}

async function activeVersion(versions) {
    const entries = await readdir(versions, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory() && versionPattern.test(entry.name)).map(entry => entry.name).sort(byVersion)[0];
}

function launcher(entry) {
    return `import { readdir } from 'node:fs/promises';\n`
        + `const versionPattern = ${versionPattern};\n`
        + `${byVersion}\n${activeVersion}\n`
        + `const versions = new URL('./versions/', import.meta.url);\n`
        + `const version = await activeVersion(versions);\n`
        + `if (!version) throw new Error('CLIENT_RELEASE_NOT_INSTALLED');\n`
        + (entry === 'cli' ? `if (process.argv[2] === '--version') console.log(version);\nelse ` : '')
        + `await import(new URL(version + '/dist/${entry}.js', versions));\n`;
}

async function sha256(path) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
}

async function regularFile(path, limit) {
    const info = await lstat(path);
    if (!info.isFile() || info.size === 0 || info.size > limit) throw new Error('RELEASE_FILE_INVALID');
    return info.size;
}

async function smoke(directory) {
    const env = { ...process.env, NODE_OPTIONS: undefined, NODE_PATH: undefined, REPOGRAPH_BASE_URL: 'http://127.0.0.1:8080',
        REPOGRAPH_ACCESS_TOKEN: randomBytes(24).toString('hex'), REPOGRAPH_USERNAME: undefined, REPOGRAPH_PASSWORD: undefined };
    await execute(process.execPath, [join(directory, 'dist', 'cli.js'), '--help'], { cwd: directory, env, timeout: 10_000 });
    // Import the stdio entry with no messages. Loading checks its runtime dependencies without making service calls.
    const mcpEntry = pathToFileURL(join(directory, 'dist', 'mcp.js')).href;
    const source = `process.stdin.destroy(); await import(${JSON.stringify(mcpEntry)});`;
    await execute(process.execPath, ['--input-type=module', '-e', source], { cwd: directory, env, timeout: 10_000 });
}

async function build(outputPath, source, signingKey, override) {
    const origin = originOf(source);
    const key = createPrivateKey(await readFile(signingKey));
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('RELEASE_SIGNING_KEY_INVALID');
    const pkg = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
    const version = override ?? pkg.version;
    if (!versionPattern.test(version)) throw new Error('RELEASE_VERSION_INVALID');
    const npm = process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ['npm'];
    const stage = await mkdtemp(join(tmpdir(), 'repograph-client-package-'));
    const output = resolve(outputPath);
    try {
        await execute(npm[0], [...npm.slice(1), 'run', 'build', '--', '--outDir', join(stage, 'dist')], { cwd: repository, timeout: 120_000 });
        await copyFile(join(repository, 'package.json'), join(stage, 'package.json'));
        await copyFile(join(repository, 'package-lock.json'), join(stage, 'package-lock.json'));
        await execute(npm[0], [...npm.slice(1), 'ci', '--omit=dev', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund'],
            { cwd: stage, timeout: 180_000 });
        await writeFile(join(stage, 'package.json'), JSON.stringify({ name: 'repograph-client', version, type: 'module' }));
        await smoke(stage);
        const { platform, arch } = process;
        const file = fileName(version, platform, arch);
        const archive = join(stage, file);
        const { create } = await import('tar');
        await create({ cwd: stage, file: archive, gzip: true, portable: true, noMtime: true,
            filter: name => !name.replaceAll('\\', '/').split('/').includes('.bin') }, ['package.json', 'dist', 'node_modules']);
        const bytes = await regularFile(archive, maxArchiveBytes);
        const manifest = Buffer.from(JSON.stringify({ schema: 1, version, platform, arch, origin, file, bytes, sha256: await sha256(archive) }, null, 2) + '\n');
        await mkdir(output, { mode: 0o700 });
        try {
            await copyFile(archive, join(output, file), constants.COPYFILE_EXCL);
            await writeFile(join(output, 'manifest.ed25519'), sign(null, manifest, key));
            await writeFile(join(output, 'manifest.json'), manifest);
        } catch (error) {
            await rm(output, { recursive: true, force: true });
            throw error;
        }
        return { output, version, platform, arch, bytes };
    } finally {
        await rm(stage, { recursive: true, force: true });
    }
}

async function signedManifest(release, trustedOrigin, publicKey) {
    const manifestPath = join(release, 'manifest.json');
    const signaturePath = join(release, 'manifest.ed25519');
    await regularFile(manifestPath, maxManifestBytes);
    if (await regularFile(signaturePath, 64) !== 64) throw new Error('RELEASE_SIGNATURE_INVALID');
    const manifestBytes = await readFile(manifestPath);
    const key = createPublicKey(await readFile(publicKey));
    if (manifestBytes.length > maxManifestBytes || key.asymmetricKeyType !== 'ed25519'
        || !verify(null, manifestBytes, key, await readFile(signaturePath))) throw new Error('RELEASE_SIGNATURE_INVALID');
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (!manifest || manifest.schema !== 1 || typeof manifest.version !== 'string' || !versionPattern.test(manifest.version)) {
        throw new Error('RELEASE_VERSION_INVALID');
    }
    if (manifest.origin !== originOf(trustedOrigin)) throw new Error('RELEASE_SOURCE_MISMATCH');
    if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('RELEASE_PLATFORM_MISMATCH');
    if (manifest.file !== fileName(manifest.version, manifest.platform, manifest.arch) || !/^[a-f0-9]{64}$/.test(manifest.sha256 ?? '')
        || !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 || manifest.bytes > maxArchiveBytes) throw new Error('RELEASE_MANIFEST_INVALID');
    return manifest;
}

async function install(root, release, origin, publicKey) {
    const manifest = await signedManifest(release, origin, publicKey);
    const source = join(release, manifest.file);
    if (await regularFile(source, maxArchiveBytes) !== manifest.bytes) throw new Error('RELEASE_DIGEST_MISMATCH');
    const versions = join(root, 'versions');
    await mkdir(versions, { recursive: true, mode: 0o700 });
    const current = await activeVersion(versions);
    if (current && byVersion(manifest.version, current) > 0) throw new Error('RELEASE_DOWNGRADE_REFUSED');
    const working = await mkdtemp(join(versions, '.staging-'));
    try {
        const archive = join(working, 'verified.tgz');
        await copyFile(source, archive, constants.COPYFILE_EXCL);
        if (await regularFile(archive, maxArchiveBytes) !== manifest.bytes || await sha256(archive) !== manifest.sha256) {
            throw new Error('RELEASE_DIGEST_MISMATCH');
        }
        const { stdout } = await execute('tar', ['-tf', archive], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
        const entries = stdout.split('\n').filter(Boolean).map(entry => entry.replace(/\/$/, ''));
        if (entries.some(name => !['package.json', 'dist', 'node_modules'].includes(name) && !/^(dist|node_modules)\//.test(name)
            || /[\\\x00-\x1f\x7f]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..'))) {
            throw new Error('RELEASE_ARCHIVE_INVALID');
        }
        const pending = join(working, 'release');
        await mkdir(pending, { mode: 0o700 });
        await execute('tar', ['-xf', archive, '-C', pending, '--no-same-owner', '--no-same-permissions'], { timeout: 60_000 });
        const pkgPath = join(pending, 'package.json');
        await regularFile(pkgPath, maxManifestBytes);
        const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
        if (pkg.name !== 'repograph-client' || pkg.version !== manifest.version || pkg.type !== 'module') throw new Error('RELEASE_PACKAGE_INVALID');
        await smoke(pending);
        const receiptName = 'installed-release.json';
        await writeFile(join(pending, receiptName), JSON.stringify(manifest), { flag: 'wx' });
        for (const entry of ['cli', 'mcp']) {
            try { await writeFile(join(root, entry + '.mjs'), launcher(entry), { flag: 'wx', mode: 0o600 }); }
            catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
        const published = join(versions, manifest.version);
        try { await rename(pending, published); }
        catch (error) {
            if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
            const installed = JSON.parse(await readFile(join(published, receiptName), 'utf8'));
            if (installed.sha256 !== manifest.sha256 || installed.origin !== manifest.origin) throw new Error('RELEASE_VERSION_CONFLICT');
        }
        return { installed: manifest.version, active: await activeVersion(versions) };
    } finally {
        await rm(working, { recursive: true, force: true });
    }
}

try {
    const [command, target, source, key, version, ...extra] = process.argv.slice(2);
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('CLIENT_RELEASE_NODE_24_REQUIRED');
    if (!target || !source || !key || extra.length || !['build', 'install'].includes(command) || (command === 'install' && !version)) {
        throw new Error('Usage: client-release.mjs build <output> <https-origin> <private-key.pem> [version]\n'
            + '       client-release.mjs install <directory> <release-directory> <https-origin> <public-key.pem>');
    }
    const result = command === 'build' ? await build(target, source, key, version)
        : await install(resolve(target), resolve(source), key, version);
    console.log(JSON.stringify(result));
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
