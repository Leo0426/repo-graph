import { join as nativeJoin } from 'node:path';
import { dirname, join, normalize } from 'node:path/posix';
import ts from 'typescript';
import { resolvePackageAlias } from './js-package-aliases.js';
import { readProjectFile } from './project-file.js';

export const jsAliasPrefix = '/js-path/';
const maxConfigBytes = 256 * 1024;
const maxRequestedConfigs = 4096;

interface PathRule {
    pattern: string;
    wildcard: number;
    targets: string[];
}

interface AliasOptions {
    baseUrl?: string;
    paths?: { directory: string; rules: PathRule[] };
    unknownInheritance?: boolean;
}

export interface JsAliasTarget {
    name: string;
    // An unreadable configuration leaves the last published targets in place.
    targets?: string[];
}

class ConfigError extends Error {
    constructor(readonly file: string, reason: string) { super(reason); }
}

function object(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function safePath(directory: string, value: string) {
    if (!value || value.length > 2048 || value.startsWith('/') || /^[a-z][\w+.-]*:/i.test(value) || /[\\\x00-\x1f]/.test(value)) return;
    const path = normalize(join(directory, value)).replace(/\/$/, '');
    return path === '..' || path.startsWith('../') ? undefined : path;
}

export function jsAliasKey(file: string, specifier: string) {
    if (!specifier || specifier.length > 2048 || /[\\\x00-\x1f:]/.test(specifier)
        || specifier.split('/').some(part => !part || part === '.' || part === '..')) return;
    return jsAliasPrefix + JSON.stringify([dirname(file), specifier]);
}

function aliasTargets(options: AliasOptions | null, specifier: string) {
    if (!options) return [];
    const rules = options.paths?.rules ?? [];
    let match = rules.find(rule => rule.wildcard === -1 && rule.pattern === specifier);
    if (!match) {
        for (const rule of rules) {
            if (rule.wildcard === -1 || (match && match.wildcard >= rule.wildcard)) continue;
            const prefix = rule.pattern.slice(0, rule.wildcard);
            const suffix = rule.pattern.slice(rule.wildcard + 1);
            if (specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix)) match = rule;
        }
    }
    const targets = new Set<string>();
    if (match && options.paths && (options.baseUrl || !options.unknownInheritance)) {
        const captured = match.wildcard === -1 ? ''
            : specifier.slice(match.wildcard, specifier.length - (match.pattern.length - match.wildcard - 1));
        for (const target of match.targets) {
            const path = safePath(options.baseUrl ?? options.paths.directory, target.replace('*', () => captured));
            if (path) targets.add(path);
        }
    }
    if (options.baseUrl && (!options.unknownInheritance || options.paths)) {
        const path = safePath(options.baseUrl, specifier);
        if (path) targets.add(path);
    }
    return [...targets];
}

function nearestFile<T>(filename: string, load: (file: string) => Promise<T | null>) {
    const cache = new Map<string, Promise<T | null>>();
    function nearest(directory: string): Promise<T | null> {
        const cached = cache.get(directory);
        if (cached) return cached;
        const pending = (async () => {
            const result = await load(join(directory, filename));
            return result ?? (directory === '.' ? null : nearest(dirname(directory)));
        })();
        cache.set(directory, pending);
        return pending;
    }
    return nearest;
}

export async function readJsAliasTargets(root: string, names: string[], signal?: AbortSignal, requestedConfig?: string) {
    const configs = new Map<string, Promise<AliasOptions | null>>();
    const packages = new Map<string, Promise<{ directory: string; manifest: Record<string, unknown> } | null>>();
    const issues = new Set<string>();
    let bytesRemaining = 8 * 1024 * 1024;

    function load(file: string, parents: string[]): Promise<AliasOptions | null> {
        if (parents.includes(file)) throw new ConfigError(file, 'TSCONFIG_EXTENDS_CYCLE');
        if (parents.length >= 16) throw new ConfigError(file, 'TSCONFIG_EXTENDS_LIMIT');
        const cached = configs.get(file);
        if (cached) return cached;
        if (configs.size >= maxRequestedConfigs) throw new ConfigError('tsconfig.json', 'TSCONFIG_LOOKUP_LIMIT');
        const pending = parse(file, [...parents, file]);
        configs.set(file, pending);
        return pending;
    }

    async function readConfig(file: string, kind: 'TSCONFIG' | 'PACKAGE_JSON') {
        signal?.throwIfAborted();
        try {
            if (bytesRemaining <= 0) throw new ConfigError(file, kind + '_BYTE_LIMIT');
            const bytes = await readProjectFile(nativeJoin(root, file), Math.min(maxConfigBytes, bytesRemaining));
            bytesRemaining -= bytes.length;
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            if (error instanceof ConfigError) throw error;
            throw new ConfigError(file, kind + '_READ_FAILED');
        }
    }

    async function parse(file: string, parents: string[]): Promise<AliasOptions | null> {
        const input = await readConfig(file, 'TSCONFIG');
        if (input === null) return null;
        const parsed = ts.parseConfigFileTextToJson(file, input);
        const config = object(parsed.config);
        if (parsed.error || !config) throw new ConfigError(file, 'TSCONFIG_INVALID');
        const directory = dirname(file);
        let options: AliasOptions = {};
        const extensions = Array.isArray(config.extends) ? config.extends : config.extends === undefined ? [] : [config.extends];
        if (extensions.length > 16) throw new ConfigError(file, 'TSCONFIG_EXTENDS_LIMIT');
        for (const extension of extensions) {
            if (typeof extension !== 'string' || !extension) throw new ConfigError(file, 'TSCONFIG_INVALID');
            if (!/^\.\.?\//.test(extension)) {
                if (extension.startsWith('/') || /^[a-z]:/i.test(extension)) throw new ConfigError(file, 'TSCONFIG_EXTENDS_OUTSIDE_ROOT');
                options = { unknownInheritance: true };
                continue;
            }
            const inheritedPath = safePath(directory, extension);
            if (!inheritedPath) throw new ConfigError(file, 'TSCONFIG_EXTENDS_OUTSIDE_ROOT');
            const inherited = await load(inheritedPath.endsWith('.json') ? inheritedPath : inheritedPath + '.json', parents);
            if (!inherited) throw new ConfigError(file, 'TSCONFIG_EXTENDS_UNAVAILABLE');
            options = { ...options, ...inherited, unknownInheritance: options.unknownInheritance || inherited.unknownInheritance };
        }
        const compilerOptions = object(config.compilerOptions);
        if (config.compilerOptions !== undefined && !compilerOptions) throw new ConfigError(file, 'TSCONFIG_INVALID');
        if (compilerOptions?.baseUrl !== undefined) {
            const baseUrl = typeof compilerOptions.baseUrl === 'string' ? safePath(directory, compilerOptions.baseUrl) : undefined;
            if (!baseUrl) throw new ConfigError(file, 'TSCONFIG_BASE_URL_INVALID');
            options.baseUrl = baseUrl;
        }
        if (compilerOptions?.paths !== undefined) {
            const paths = object(compilerOptions.paths);
            if (!paths) throw new ConfigError(file, 'TSCONFIG_INVALID');
            const rules: PathRule[] = [];
            const declarations = Object.entries(paths);
            if (declarations.length > 256) throw new ConfigError(file, 'TSCONFIG_PATH_LIMIT');
            for (const [pattern, targets] of declarations) {
                if (!jsAliasKey(file, pattern) || pattern.indexOf('*') !== pattern.lastIndexOf('*')
                    || !Array.isArray(targets) || targets.length > 32
                    || targets.some(target => typeof target !== 'string' || target.indexOf('*') !== target.lastIndexOf('*'))) {
                    throw new ConfigError(file, 'TSCONFIG_INVALID');
                }
                rules.push({ pattern, wildcard: pattern.indexOf('*'), targets: targets as string[] });
            }
            options.paths = { directory, rules };
        }
        return options;
    }

    function loadPackage(file: string) {
        const cached = packages.get(file);
        if (cached) return cached;
        if (packages.size >= maxRequestedConfigs) throw new ConfigError('package.json', 'PACKAGE_JSON_LOOKUP_LIMIT');
        const pending = (async () => {
            const input = await readConfig(file, 'PACKAGE_JSON');
            if (input === null) return null;
            try {
                const manifest = object(JSON.parse(input));
                if (manifest) return { directory: dirname(file), manifest };
            } catch {
                throw new ConfigError(file, 'PACKAGE_JSON_INVALID');
            }
            throw new ConfigError(file, 'PACKAGE_JSON_INVALID');
        })();
        packages.set(file, pending);
        return pending;
    }
    const nearestConfig = nearestFile('tsconfig.json', file => load(file, []));
    const nearestPackage = nearestFile('package.json', loadPackage);

    function report(error: unknown) {
        signal?.throwIfAborted();
        if (!(error instanceof ConfigError)) throw error;
        issues.add(error.file + ': ' + error.message);
    }

    if (requestedConfig) {
        try {
            if (requestedConfig.split('/').at(-1) === 'package.json') await loadPackage(requestedConfig);
            else await load(requestedConfig, []);
        }
        catch (error) { report(error); }
    }
    const aliases: JsAliasTarget[] = [];
    for (const name of names) {
        signal?.throwIfAborted();
        const [directory, specifier] = JSON.parse(name.slice(jsAliasPrefix.length)) as [string, string];
        try {
            const targets = aliasTargets(await nearestConfig(directory), specifier);
            const scope = await nearestPackage(directory);
            const target = scope && resolvePackageAlias(scope.directory, scope.manifest, specifier);
            if (target && !targets.includes(target)) targets.push(target);
            aliases.push({ name, targets });
        } catch (error) {
            report(error);
            aliases.push({ name });
        }
    }
    return { aliases, issues: [...issues].sort() };
}
