import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, constants, fchmodSync, fstatSync, linkSync, openSync, readSync, unlinkSync, writeFileSync } from 'node:fs';

function parseKey(value: string) {
    const text = value.trim();
    if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) throw new Error('Invalid provider encryption key');
    const key = Buffer.from(text, 'base64');
    if (key.toString('base64') !== text) throw new Error('Invalid provider encryption key');
    return key;
}

function loadKey(path: string, required: boolean): Buffer {
    let file: number;
    try { file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || required) throw error;
        const temporary = path + '-' + randomUUID() + '.tmp';
        writeFileSync(temporary, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 });
        try { linkSync(temporary, path); }
        catch (publishError) {
            if ((publishError as NodeJS.ErrnoException).code !== 'EEXIST') throw publishError;
        } finally { unlinkSync(temporary); }
        return loadKey(path, true);
    }
    try {
        const stat = fstatSync(file);
        if (!stat.isFile() || stat.size > 128) throw new Error('Invalid provider key file');
        fchmodSync(file, 0o600);
        const contents = Buffer.alloc(129);
        const length = readSync(file, contents);
        if (length >= contents.length) throw new Error('Invalid provider key file');
        return parseKey(contents.subarray(0, length).toString('utf8'));
    } finally { closeSync(file); }
}

export class ProviderSecrets {
    #key: Buffer;

    constructor(path: string | null, configured: string | undefined, required: boolean) {
        try { this.#key = configured !== undefined ? parseKey(configured) : path ? loadKey(path, required) : randomBytes(32); }
        catch { throw new Error('Cannot load provider encryption key. Restore the original key.'); }
    }

    encrypt(binding: string, value: string) {
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.#key, nonce);
        cipher.setAAD(Buffer.from(binding));
        const encoded = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return Buffer.concat([nonce, cipher.getAuthTag(), encoded]).toString('base64');
    }

    decrypt(binding: string, value: string) {
        try {
            const raw = Buffer.from(value, 'base64');
            if (raw.length <= 28) throw new Error('Invalid encrypted provider credential');
            const decipher = createDecipheriv('aes-256-gcm', this.#key, raw.subarray(0, 12));
            decipher.setAAD(Buffer.from(binding));
            decipher.setAuthTag(raw.subarray(12, 28));
            return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
        } catch { throw new Error('Cannot decrypt provider credentials. Restore the original key.'); }
    }
}
