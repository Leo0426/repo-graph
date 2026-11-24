import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';

export function relativeEvidencePath(value: string) {
    const path = value.replaceAll('\\', '/');
    if (path.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(path) || path.length > 4096 || /[\x00-\x1f\x7f-\x9f]/.test(path)) return '';
    const components = path.split('/');
    if (components.includes('..')) return '';
    return components.filter(part => part && part !== '.').join('/');
}

export async function readProjectFile(absolute: string, maxBytes: number) {
    if (await realpath(absolute) !== absolute) throw new Error('PATH_CHANGED');
    const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || before.size > maxBytes) throw new Error('FILE_TOO_LARGE');
        const bytes = Buffer.alloc(Number(before.size) + 1);
        let offset = 0;
        while (offset < bytes.length) {
            const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
            if (!bytesRead) break;
            offset += bytesRead;
        }
        if (await realpath(absolute) !== absolute) throw new Error('PATH_CHANGED');
        const after = await lstat(absolute, { bigint: true });
        if (before.ino !== after.ino || before.dev !== after.dev || before.mtimeNs !== after.mtimeNs
            || before.ctimeNs !== after.ctimeNs || offset !== Number(before.size)) {
            throw new Error('FILE_CHANGED');
        }
        return bytes.subarray(0, offset);
    } finally {
        await handle.close();
    }
}
