import { readFile } from 'node:fs/promises';

let embedded: Promise<Buffer> | undefined;

export function documentFont() {
    embedded ??= readFile(new URL('../resources/fonts/NotoSansSC-Regular.ttf', import.meta.url)).catch(error => {
        embedded = undefined;
        throw error;
    });
    return embedded;
}
