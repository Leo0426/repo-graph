import { opendir, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { matchesGlob } from 'node:path/posix';
import { PackageURL } from 'packageurl-js';
import { readProjectFile, relativeEvidencePath } from './project-file.js';
import { gradleManifest, gradleProjectPaths, mavenManifest, npmManifest, pythonManifest } from './sbom-manifests.js';
import type { Dependency, PackageIdentity } from './sbom-manifests.js';

const MIB = 1024 * 1024;
export const requirementsName = /^requirements[\w.-]*\.txt$/;
const dependencyManifestNames = /^(?:pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|gradle\.lockfile|libs\.versions\.toml|package\.json|package-lock\.json|npm-shrinkwrap\.json|pyproject\.toml)$/;
export function isDependencyManifest(file: string) {
    const name = basename(file);
    return dependencyManifestNames.test(name) || requirementsName.test(name);
}
const maxRequirements = 32;
const maxRootEntries = 50_000;
const maxComponents = 10_000;
const gradleProjectFiles = ['build.gradle.kts', 'build.gradle', 'gradle.lockfile'];
const scopeOrder = { excluded: 0, optional: 1, required: 2 };
const skippedWorkspaceDirs = new Set(['.git', 'node_modules']);

async function npmWorkspaces(root: string, patterns: readonly unknown[], read: (path: string) => Promise<string | undefined>) {
    const workspaceLimit = 128;
    const directories = new Map<string, string[]>();
    const manifests = new Map<string, string>();
    const checked = new Set<string>();
    const issues = new Set<string>();
    let entries = 0;
    let steps = 0;

    async function children(path: string) {
        const known = directories.get(path);
        if (known) return known;
        const found: string[] = [];
        if (directories.size >= 4096 || entries >= maxRootEntries) {
            issues.add('npm: WORKSPACE_SCAN_LIMIT');
            return found;
        }
        directories.set(path, found);
        const absolute = join(root, path);
        try {
            if (await realpath(absolute) !== absolute) throw new Error('PATH_CHANGED');
            for await (const entry of await opendir(absolute)) {
                if (entries++ >= maxRootEntries) {
                    issues.add('npm: WORKSPACE_SCAN_LIMIT');
                    break;
                }
                if (entry.isDirectory() && !skippedWorkspaceDirs.has(entry.name)) found.push(entry.name);
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') issues.add((path || 'npm') + ': WORKSPACE_READ_FAILED');
        }
        return found.sort();
    }

    if (patterns.length > workspaceLimit) issues.add('npm: WORKSPACE_PATTERN_LIMIT');
    const selectors = patterns.slice(0, workspaceLimit).flatMap(raw => {
        const negative = typeof raw === 'string' && raw.startsWith('!');
        const value = typeof raw === 'string' ? raw.slice(negative ? 1 : 0) : '';
        const normalized = value.length <= 512 && !value.includes('\\') ? relativeEvidencePath(value) : '';
        const parts = normalized.split('/');
        if (!normalized || parts.length > 32 || parts.some(part => /[{}[\]!()]/.test(part) || skippedWorkspaceDirs.has(part))) {
            issues.add('npm: UNSUPPORTED_WORKSPACE_PATTERN');
            return [];
        }
        return [{ negative, normalized, parts }];
    });

    for (const { negative, parts } of selectors) {
        if (negative) continue;
        const visited = new Set<string>();
        async function expand(path: string, segment: number) {
            if (path.split('/').length > 32 || path.length > 4096) return;
            if (++steps > 2 * maxRootEntries) {
                issues.add('npm: WORKSPACE_SCAN_LIMIT');
                return;
            }
            const key = segment + ':' + path;
            if (visited.has(key)) return;
            visited.add(key);
            if (segment === parts.length) {
                if (!path || checked.has(path)) return;
                checked.add(path);
                if (selectors.findLast(selector => matchesGlob(path, selector.normalized))?.negative) return;
                const content = await read(path + '/package.json');
                if (content === undefined) return;
                if (manifests.size < workspaceLimit) manifests.set(path, content);
                else issues.add('npm: WORKSPACE_LIMIT');
                return;
            }
            const pattern = parts[segment];
            const childPath = (name: string) => path ? path + '/' + name : name;
            if (!pattern.includes('*') && !pattern.includes('?')) {
                await expand(childPath(pattern), segment + 1);
                return;
            }
            if (pattern === '**') await expand(path, segment + 1);
            for (const name of await children(path)) {
                if (!matchesGlob(name, pattern)) continue;
                await expand(childPath(name), pattern === '**' ? segment : segment + 1);
            }
        }
        await expand('', 0);
    }
    const ordered = new Map([...manifests].sort(([left], [right]) => left.localeCompare(right)));
    return { manifests: ordered, issues: [...issues] };
}

interface Component extends PackageIdentity {
    purl: string;
    scope: Dependency['scope'];
    sources: string[];
    declarations: Map<string, Dependency['scope']>;
    constraints: string[];
}

function purl(identity: PackageIdentity) {
    if (identity.ecosystem === 'maven' && !identity.group) return undefined;
    if (identity.name.length > 214 || (identity.group?.length ?? 0) > 214) return undefined;
    try {
        return new PackageURL(identity.ecosystem, identity.group, identity.name, identity.version).toString();
    } catch {
        return undefined;
    }
}

export async function dependencyInventory(root: string, observe?: (path: string, bytes: Uint8Array) => void) {
    const components = new Map<string, Component>();
    const issues = new Set<string>();
    const dependencies: Dependency[] = [];
    let project: PackageIdentity | undefined;
    let supported = false;
    let available = false;
    let remainingBytes = 12 * MIB;

    async function read(path: string) {
        try {
            const budget = /(?:lock|shrinkwrap)/.test(path) ? 4 * MIB : MIB;
            const bytes = await readProjectFile(join(root, path), Math.min(budget, remainingBytes));
            remainingBytes -= bytes.length;
            observe?.(path, bytes);
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') issues.add(path + ': READ_FAILED');
            return undefined;
        }
    }

    async function collect(paths: string[]) {
        const found = new Map<string, string>();
        for (const path of paths) {
            const content = await read(path);
            if (content !== undefined) found.set(path, content);
        }
        return found;
    }

    async function include(label: string, parse: () => Awaited<ReturnType<typeof mavenManifest>> | ReturnType<typeof mavenManifest>) {
        supported = true;
        try {
            const result = await parse();
            project ??= result.project;
            for (const dependency of result.dependencies) dependencies.push(dependency);
            for (const issue of result.issues ?? []) issues.add(issue);
            available = true;
        } catch {
            issues.add(label + ': PARSE_FAILED');
        }
    }

    const requirements: string[] = [];
    try {
        if (await realpath(root) !== root) throw new Error('PATH_CHANGED');
        let entries = 0;
        for await (const entry of await opendir(root)) {
            if (++entries > maxRootEntries) {
                issues.add('project: DIRECTORY_LIMIT');
                break;
            }
            if (!entry.isFile() || !requirementsName.test(entry.name)) continue;
            if (requirements.length >= maxRequirements) {
                issues.add('pip: MANIFEST_LIMIT');
                break;
            }
            requirements.push(entry.name);
        }
        requirements.sort();
    } catch {
        issues.add('project: READ_FAILED');
    }

    const pom = await read('pom.xml');
    if (pom !== undefined) await include('pom.xml', () => mavenManifest(pom, read));
    const gradle = await collect([...gradleProjectFiles, 'gradle/libs.versions.toml', 'settings.gradle.kts', 'settings.gradle']);
    if (gradle.size) {
        const subprojects = gradleProjectPaths(gradle.get('settings.gradle.kts') ?? gradle.get('settings.gradle') ?? '');
        for (const issue of subprojects.issues) issues.add(issue);
        for (const projectPath of subprojects.paths) {
            for (const [path, content] of await collect(gradleProjectFiles.map(path => projectPath + '/' + path))) gradle.set(path, content);
        }
        await include('gradle', () => gradleManifest(gradle));
    }
    const packageJson = await read('package.json');
    if (packageJson !== undefined) await include('package.json', () => npmManifest(packageJson, read, patterns => npmWorkspaces(root, patterns, read)));
    const python = await collect(['pyproject.toml', ...requirements]);
    if (python.size) await include('pip', () => pythonManifest(python));

    for (const { source, constraint, scope, definitionOnly, ...identity } of dependencies) {
        const url = purl(identity);
        if (!url) continue;
        let component = components.get(url);
        if (!component) {
            if (components.size >= maxComponents) {
                issues.add('project: COMPONENT_LIMIT');
                continue;
            }
            component = { ...identity, purl: url, scope, sources: [], declarations: new Map(), constraints: [] };
            components.set(url, component);
        }
        if (!component.sources.includes(source)) component.sources.push(source);
        const hasDeclarations = component.declarations.size > 0;
        if ((!definitionOnly && !hasDeclarations)
            || ((!definitionOnly || !hasDeclarations) && scopeOrder[scope] > scopeOrder[component.scope])) component.scope = scope;
        if (!definitionOnly) {
            const previous = component.declarations.get(source);
            if (!previous || scopeOrder[scope] > scopeOrder[previous]) component.declarations.set(source, scope);
        }
        if (constraint && !component.constraints.includes(constraint) && component.constraints.length < 32) {
            component.constraints.push(constraint);
        }
    }

    const list = [...components.values()].sort((a, b) => a.purl.localeCompare(b.purl));
    return { project, components: list, supported, available, issues: [...issues].sort() };
}

export type DependencyInventory = Awaited<ReturnType<typeof dependencyInventory>>;

export function dependencyAssets(inventory: DependencyInventory) {
    return inventory.components.map(component => ({
        coordinate: component.group ? component.group + (component.ecosystem === 'npm' ? '/' : ':') + component.name : component.name,
        version: component.version ?? '', scope: component.scope, purl: component.purl, sources: component.sources,
        constraints: component.constraints
    }));
}

export function cyclonedx(root: string, inventory: DependencyInventory) {
    const identity = inventory.project;
    const rootUrl = identity && purl(identity);
    const metadata = {
        component: { type: 'application', name: identity?.name || basename(root) || 'project',
            ...(identity?.group ? { group: identity.group } : {}), ...(identity?.version ? { version: identity.version } : {}),
            ...(rootUrl ? { purl: rootUrl } : {}) },
        ...(inventory.issues.length ? { properties: inventory.issues.map(value => ({ name: 'repograph:inventoryIssue', value })) } : {})
    };
    return {
        $schema: 'http://cyclonedx.org/schema/bom-1.4.schema.json', bomFormat: 'CycloneDX', specVersion: '1.4', version: 1,
        metadata,
        components: inventory.components.map(component => ({
            type: 'library', 'bom-ref': component.purl, name: component.name, group: component.group,
            version: component.version, scope: component.scope, purl: component.purl,
            properties: [
                ...component.sources.map(value => ({ name: 'repograph:manifest', value })),
                ...component.constraints.map(value => ({ name: 'repograph:versionConstraint', value }))
            ]
        }))
    };
}
