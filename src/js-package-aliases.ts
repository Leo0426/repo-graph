import { join } from 'node:path/posix';

const importConditions = new Set(['node', 'node-addons', 'import', 'module-sync', 'default']);
const invalidTarget = Symbol('invalid package target');
const externalTarget = Symbol('external package target');
type Target = string | null | undefined | typeof invalidTarget | typeof externalTarget;

function mapping(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function matchSubpath(entries: Record<string, unknown>, subpath: string) {
    if (!subpath.includes('*') && Object.hasOwn(entries, subpath)) return { value: entries[subpath], capture: undefined };
    let best: { key: string; wildcard: number; capture: string } | undefined;
    for (const key of Object.keys(entries)) {
        const wildcard = key.indexOf('*');
        if (wildcard < 0 || wildcard !== key.lastIndexOf('*') || subpath.length < key.length) continue;
        const suffix = key.slice(wildcard + 1);
        if (!subpath.startsWith(key.slice(0, wildcard)) || !subpath.endsWith(suffix)) continue;
        if (best && (best.wildcard > wildcard || (best.wildcard === wildcard && best.key.length >= key.length))) continue;
        best = { key, wildcard, capture: subpath.slice(wildcard, subpath.length - suffix.length) };
    }
    return best ? { value: entries[best.key], capture: best.capture } : undefined;
}

function localSegments(path: string): string[] | undefined {
    if (!path || /[\\\x00-\x1f?#]/.test(path)) return;
    try {
        const parts = path.split('/').map(part => decodeURIComponent(part));
        if (parts.some(part => !part || /[\\/\x00-\x1f]/.test(part) || /^(?:\.{1,2}|node_modules)$/i.test(part))) return;
        return parts;
    } catch {
        return undefined;
    }
}

function resolveTarget(directory: string, value: unknown, capture: string | undefined, internal: boolean, depth = 0): Target {
    if (depth >= 16) return invalidTarget;
    if (typeof value === 'string') {
        if (value.length > 2048 || (capture !== undefined &&
            value.length + (value.match(/\*/g)?.length ?? 0) * (capture.length - 1) > 2048)) return invalidTarget;
        const target = capture === undefined ? value : value.replaceAll('*', () => capture);
        if (target.startsWith('./')) {
            const parts = localSegments(target.slice(2));
            return parts ? join(directory, ...parts) : invalidTarget;
        }
        if (internal && target && !target.startsWith('.') && !target.startsWith('/') && !/[:\\\x00-\x1f]/.test(target)) return externalTarget;
        return invalidTarget;
    }
    if (value === null) return null;
    if (value === undefined) return undefined;
    if (Array.isArray(value)) {
        if (!value.length) return null;
        let fallback: Target;
        for (const item of value) {
            const resolved = resolveTarget(directory, item, capture, internal, depth + 1);
            if (typeof resolved === 'string' || resolved === externalTarget) return resolved;
            if (resolved !== undefined) fallback = resolved;
        }
        return fallback;
    }
    const conditions = mapping(value);
    if (!conditions) return invalidTarget;
    const entries = Object.entries(conditions);
    if (entries.some(([condition]) => /^(?:0|[1-9]\d*)$/.test(condition) && Number(condition) < 0xffffffff)) return invalidTarget;
    for (const [condition, target] of entries) {
        if (!importConditions.has(condition)) continue;
        const resolved = resolveTarget(directory, target, capture, internal, depth + 1);
        if (resolved !== undefined) return resolved;
    }
    return undefined;
}

export function resolvePackageAlias(directory: string, manifest: Record<string, unknown>, specifier: string) {
    const internal = specifier.startsWith('#');
    let matched: { value: unknown; capture: string | undefined } | undefined;
    if (internal) {
        const entries = mapping(manifest.imports);
        if (entries && specifier !== '#') matched = matchSubpath(entries, specifier);
    } else {
        const name = manifest.name;
        if (typeof name !== 'string' || !name || (specifier !== name && !specifier.startsWith(name + '/'))) return;
        const subpath = specifier === name ? '.' : '.' + specifier.slice(name.length);
        const entries = mapping(manifest.exports);
        const keys = Object.keys(entries ?? {});
        if (entries && keys.some(key => key.startsWith('.'))) {
            if (keys.every(key => key.startsWith('.'))) matched = matchSubpath(entries, subpath);
        } else if (subpath === '.') {
            matched = { value: manifest.exports, capture: undefined };
        }
    }
    if (!matched) return;
    if (matched.capture !== undefined && !localSegments(matched.capture)) return;
    const target = resolveTarget(directory, matched.value, matched.capture, internal);
    return typeof target === 'string' ? target : undefined;
}
