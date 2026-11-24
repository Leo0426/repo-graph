import { dirname, join, normalize } from 'node:path/posix';
import { SaxesParser } from 'saxes';
import { parse as parseToml } from 'smol-toml';
import { relativeEvidencePath } from './project-file.js';

type Scope = 'required' | 'optional' | 'excluded';
type Ecosystem = 'maven' | 'npm' | 'pypi';

export interface PackageIdentity { ecosystem: Ecosystem; group?: string; name: string; version?: string }
export interface Dependency extends PackageIdentity { scope: Scope; source: string; constraint?: string; definitionOnly?: boolean }
interface ManifestReader { (name: string): Promise<string | undefined> }
type WorkspaceFinder = (patterns: readonly unknown[]) => Promise<{ manifests: ReadonlyMap<string, string>; issues: string[] }>;
interface ManifestResult { project?: PackageIdentity; dependencies: Dependency[]; issues?: string[] }

const npmExact = /^(?:v)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;
const npmName = /^(?:@[\w.-]+\/)?[\w.-]+$/;
const jvmPart = /^[a-zA-Z0-9][\w.-]*$/;
const maxPythonDeclarations = 20_000;
const maxGradleProjects = 128;

function table(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function get(value: unknown, key: string) {
    const fields = table(value);
    return Object.hasOwn(fields, key) ? fields[key] : undefined;
}

function str(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }

function versionFields(raw: string, exact: boolean) {
    if (raw.length > 180) return {};
    if (exact) return { version: raw };
    // Retain version selectors without exposing repository URLs or local paths.
    const safeSelector = /^[\w. \t\[\](),<>=~^*+!|$\{\}-]+$/;
    return raw && safeSelector.test(raw) ? { constraint: raw } : {};
}

function jvmVersion(raw: string) {
    const version = /^\[\s*([a-zA-Z0-9][\w.-]*)\s*\]$/.exec(raw)?.[1] ?? raw;
    return versionFields(version, /^[a-zA-Z0-9][\w.-]*$/.test(version) && !/^(?:latest(?:\..*)?|release)$/i.test(version));
}

function npmPackage(coordinate: string, raw: string) {
    const [group, name] = coordinate.includes('/') ? coordinate.split('/') : [undefined, coordinate];
    return { ecosystem: 'npm' as const, group, name, ...versionFields(raw, npmExact.test(raw)) };
}

function jsonManifest(input: string) {
    const parsed: unknown = JSON.parse(input);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON manifest');
    return table(parsed);
}

export async function npmManifest(input: string, read: ManifestReader, findWorkspaces: WorkspaceFinder): Promise<ManifestResult> {
    const manifest = jsonManifest(input);
    const lockName = 'npm-shrinkwrap.json';
    const shrinkwrap = await read(lockName);
    const source = shrinkwrap === undefined ? 'package-lock.json' : lockName;
    const lock = shrinkwrap ?? await read(source);
    const issues: string[] = [];
    let locked: Record<string, unknown> = {};
    if (lock !== undefined) {
        try { locked = jsonManifest(lock); }
        catch { issues.push(source + ': PARSE_FAILED'); }
    }
    const packages = table(locked.packages);
    const workspaces = new Map<string, Record<string, unknown>>([['', manifest]]);
    const declaredWorkspaces = Array.isArray(manifest.workspaces) ? manifest.workspaces : get(manifest.workspaces, 'packages');
    if (Array.isArray(declaredWorkspaces)) {
        const found = await findWorkspaces(declaredWorkspaces);
        for (const issue of found.issues) issues.push(issue);
        for (const [path, content] of found.manifests) {
            try { workspaces.set(path, jsonManifest(content)); }
            catch { issues.push(path + '/package.json: PARSE_FAILED'); }
        }
    }
    const installed = new Map<string, Dependency>();
    const dependencies: Dependency[] = [];

    function addLocked(coordinate: string, record: unknown) {
        const name = str(get(record, 'name')) || coordinate;
        const version = str(get(record, 'version'));
        if (!npmName.test(name) || !npmExact.test(version) || get(record, 'link') === true) return;
        const scope = get(record, 'dev') === true ? 'excluded' : get(record, 'optional') === true ? 'optional' : 'required';
        const entry = { ...npmPackage(name, version), scope, source } as const;
        dependencies.push(entry);
        return entry;
    }

    if (locked.packages !== undefined) {
        for (const [path, record] of Object.entries(packages)) {
            if (relativeEvidencePath(path) !== path) continue;
            const match = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(path);
            if (!match) continue;
            const entry = addLocked(match[1], record);
            if (entry) installed.set(path, entry);
        }
    } else if (locked.lockfileVersion === 1) {
        const pending = [{ entries: table(locked.dependencies), root: true }];
        while (pending.length) {
            const frame = pending.pop()!;
            for (const [name, record] of Object.entries(frame.entries)) {
                const entry = addLocked(name, record);
                if (entry && frame.root) installed.set('node_modules/' + name, entry);
                const nested = get(record, 'dependencies');
                if (nested) pending.push({ entries: table(nested), root: false });
            }
        }
    }

    // optionalDependencies overrides dependencies when both describe the same package.
    const scopes = [['dependencies', 'required'], ['optionalDependencies', 'optional'],
        ['peerDependencies', 'optional'], ['devDependencies', 'excluded']] as const;
    for (const [folder, workspace] of workspaces) {
        const manifestPath = join(folder, 'package.json');
        const recorded = get(packages, folder);
        const lookup = [folder];
        while (lookup.at(-1)) {
            const parent = dirname(lookup.at(-1)!);
            lookup.push(parent === '.' ? '' : parent);
        }
        for (const [field, scope] of scopes) {
            for (const [coordinate, declaration] of Object.entries(table(workspace[field]))) {
                if (field === 'dependencies' && get(workspace.optionalDependencies, coordinate) !== undefined) continue;
                if (!npmName.test(coordinate) || typeof declaration !== 'string') continue;
                const selector = declaration.trim();
                const path = lookup.map(location => join(location, 'node_modules', coordinate))
                    .find(candidate => installed.has(candidate) || get(packages, candidate) !== undefined);
                const record = path ? get(packages, path) : undefined;
                const entry = path ? installed.get(path) : undefined;
                const sameDeclaration = declaration === get(get(recorded, field), coordinate);
                const fileReference = selector.startsWith('file:') ? selector.slice(5) : '';
                const fileTarget = fileReference && !fileReference.startsWith('/') && !fileReference.includes('\\')
                    ? normalize(join(folder, fileReference)) : '';
                const linkTarget = get(record, 'link') === true && sameDeclaration ? str(get(record, 'resolved')) : '';
                const localTarget = workspaces.get(fileTarget || linkTarget);
                if ((fileTarget || linkTarget) && get(localTarget, 'name') === coordinate) continue;
                if (entry && (sameDeclaration || selector === entry.version) && (!folder || locked.packages !== undefined)) {
                    dependencies.push({ ...entry, scope, source: manifestPath });
                } else {
                    dependencies.push({ ...npmPackage(coordinate, selector), scope, source: manifestPath });
                }
            }
        }
    }
    const name = str(manifest.name);
    return { dependencies, issues, project: npmName.test(name) ? npmPackage(name, str(manifest.version)) : undefined };
}

interface XmlElement { name: string; children: XmlElement[]; value: string }

function xmlRoot(input: string) {
    const parser = new SaxesParser({ xmlns: true });
    const root: XmlElement = { name: '', children: [], value: '' };
    const stack = [root];
    parser.on('doctype', () => { throw new Error('DOCTYPE not supported'); });
    parser.on('opentag', tag => {
        if (stack.length > 64) throw new Error('XML depth exceeded');
        const node = { name: tag.local, children: [], value: '' };
        stack.at(-1)!.children.push(node);
        stack.push(node);
    });
    parser.on('closetag', () => { stack.pop(); });
    const text = (value: string) => { stack.at(-1)!.value += value; };
    parser.on('text', text);
    parser.on('cdata', text);
    parser.write(input).close();
    if (root.children[0]?.name !== 'project') throw new Error('Expected Maven project');
    return root.children[0];
}

function element(node: XmlElement | undefined, name: string) { return node?.children.find(child => child.name === name); }
function field(node: XmlElement | undefined, name: string) { return element(node, name)?.value.trim() ?? ''; }
function declared(node: XmlElement | undefined) {
    return element(node, 'dependencies')?.children.filter(child => child.name === 'dependency') ?? [];
}

type PomProperties = ReadonlyMap<string, string>;
interface PomDependency { node: XmlElement; source: string }
interface PomModel {
    identity: { group: string; name: string; version: string };
    properties: PomProperties;
    management: PomDependency[];
    declarations: PomDependency[];
    cyclic: boolean;
}

const maxPomFiles = 128;
const maxPomDependencyRows = 20_000;

function expandPom(value: string, properties: PomProperties) {
    for (let iteration = 0; iteration < 8 && value.includes('${') && value.length <= 512; iteration++) {
        const updated = value.replace(/\$\{([\w.-]+)\}/g, (original, key: string) => properties.get(key) ?? original);
        if (updated === value) break;
        value = updated;
    }
    return value.length <= 512 ? value : '';
}

function pomProperties(root: XmlElement, inherited?: PomProperties) {
    const properties = new Map(inherited);
    for (const child of element(root, 'properties')?.children ?? []) {
        const value = child.value.trim();
        if (value.length <= 512) properties.set(child.name, value);
    }
    return properties;
}

function pomLocation(from: string, reference: string) {
    if (!reference || reference.length > 4096 || reference.startsWith('/') || /^[a-z][\w+.-]*:/i.test(reference)
        || /[\\\u0000-\u001f]/.test(reference) || reference.includes('${')) return undefined;
    const path = normalize(join(dirname(from), reference)).replace(/\/$/, '');
    if (path === '..' || path.startsWith('../') || path.length > 4088) return undefined;
    return path.endsWith('.xml') ? path : join(path, 'pom.xml');
}

function pomModel(root: XmlElement, source: string, inherited: PomModel | undefined, cyclic: boolean): PomModel {
    const parent = element(root, 'parent');
    const properties = pomProperties(root, inherited?.properties);
    const group = field(root, 'groupId') || field(parent, 'groupId');
    const name = field(root, 'artifactId');
    const version = field(root, 'version') || field(parent, 'version');
    properties.set('project.groupId', group).set('project.artifactId', name).set('project.version', version);
    properties.set('pom.groupId', group).set('pom.artifactId', name).set('pom.version', version);
    return {
        identity: { group: expandPom(group, properties), name: expandPom(name, properties), version: expandPom(version, properties) },
        properties,
        management: [...(inherited?.management ?? []), ...declared(element(root, 'dependencyManagement')).map(node => ({ node, source }))],
        declarations: [...(inherited?.declarations ?? []), ...declared(root).map(node => ({ node, source }))],
        cyclic
    };
}

function pomDependencies(root: XmlElement, model: PomModel, source: string) {
    const expand = (value: string) => expandPom(value, model.properties);
    const coordinate = (node: XmlElement) => [expand(field(node, 'groupId')), expand(field(node, 'artifactId'))];
    const key = ({ node }: PomDependency) => [...coordinate(node), expand(field(node, 'type')) || 'jar', expand(field(node, 'classifier'))].join(':');
    const management = new Map(model.management.map(entry => [key(entry), entry]));
    // Keep duplicate declarations within one POM and apply overrides between POMs.
    const declarationFiles = new Map(model.declarations.map(entry => [key(entry), entry.source]));
    const dependencies: Dependency[] = [];
    function add(entry: PomDependency, inProfile: boolean) {
        const [group, name] = coordinate(entry.node);
        if (!jvmPart.test(group) || !jvmPart.test(name)) return;
        const managed = management.get(key(entry));
        const mavenScope = expand(field(entry.node, 'scope') || field(managed?.node, 'scope'));
        const scope = mavenScope === 'test' ? 'excluded' : inProfile || ['provided', 'system'].includes(mavenScope)
            || expand(field(entry.node, 'optional') || field(managed?.node, 'optional')) === 'true' ? 'optional' : 'required';
        const chosen = field(entry.node, 'version');
        const version = chosen || field(managed?.node, 'version');
        const dependency: Dependency = { ecosystem: 'maven', group, name, ...jvmVersion(expand(version)), scope, source: entry.source };
        dependencies.push(dependency);
        if (entry.source !== source) dependencies.push({ ...dependency, source, definitionOnly: true });
        if (!chosen && version && managed && managed.source !== entry.source && managed.source !== source) {
            dependencies.push({ ...dependency, source: managed.source, definitionOnly: true });
        }
    }
    for (const entry of model.declarations) {
        if (declarationFiles.get(key(entry)) === entry.source) add(entry, false);
    }
    for (const profile of element(root, 'profiles')?.children ?? []) {
        if (profile.name === 'profile') for (const node of declared(profile)) add({ node, source }, true);
    }
    return dependencies;
}

export async function mavenManifest(input: string, read: ManifestReader): Promise<ManifestResult> {
    const rootPath = 'pom.xml';
    const documents = new Map<string, XmlElement | undefined>([[rootPath, xmlRoot(input)]]);
    const models = new Map<string, PomModel>();
    const resolving = new Set<string>();
    const issues = new Set<string>();

    async function load(path: string) {
        if (!documents.has(path)) {
            if (documents.size >= maxPomFiles) {
                issues.add('maven: POM_LIMIT');
                return undefined;
            }
            const content = await read(path);
            documents.set(path, undefined);
            if (content !== undefined) {
                try { documents.set(path, xmlRoot(content)); }
                catch { issues.add(path + ': PARSE_FAILED'); }
            }
        }
        return documents.get(path);
    }

    async function resolveModel(path: string): Promise<PomModel | undefined> {
        if (models.has(path)) return models.get(path);
        const root = await load(path);
        if (!root) return undefined;
        if (resolving.has(path)) {
            issues.add(path + ': PARENT_CYCLE');
            return pomModel(root, path, undefined, true);
        }
        if (resolving.size >= 24) {
            issues.add(path + ': PARENT_DEPTH_LIMIT');
            return undefined;
        }
        resolving.add(path);
        try {
            const parent = element(root, 'parent');
            const relative = element(parent, 'relativePath');
            const reference = relative ? relative.value.trim() : '../pom.xml';
            const parentPath = parent && reference ? pomLocation(path, reference) : undefined;
            const candidate = parentPath ? await resolveModel(parentPath) : undefined;
            let inherited: PomModel | undefined;
            if (candidate && !candidate.cyclic) {
                const properties = pomProperties(root, candidate.properties);
                const identity = candidate.identity;
                if (jvmPart.test(identity.group) && jvmPart.test(identity.name) && identity.version && !identity.version.includes('${')
                    && expandPom(field(parent, 'groupId'), properties) === identity.group
                    && expandPom(field(parent, 'artifactId'), properties) === identity.name
                    && expandPom(field(parent, 'version'), properties) === identity.version) inherited = candidate;
            }
            if (parent && !inherited) issues.add(path + ': PARENT_UNRESOLVED');
            const model = pomModel(root, path, inherited, candidate?.cyclic === true);
            models.set(path, model);
            return model;
        } finally {
            resolving.delete(path);
        }
    }

    const dependencies: Dependency[] = [];
    const modulePaths = new Set([rootPath]);
    for (const path of modulePaths) {
        const root = await load(path);
        const model = root && await resolveModel(path);
        if (!root || !model) {
            issues.add(path + ': MODULE_UNAVAILABLE');
            continue;
        }
        const found = pomDependencies(root, model, path);
        if (dependencies.length + found.length > maxPomDependencyRows) issues.add('maven: DEPENDENCY_LIMIT');
        for (const dependency of found.slice(0, Math.max(0, maxPomDependencyRows - dependencies.length))) dependencies.push(dependency);
        for (const module of element(root, 'modules')?.children ?? []) {
            if (module.name !== 'module') continue;
            const child = pomLocation(path, expandPom(module.value.trim(), model.properties));
            if (!child) issues.add(path + ': MODULE_PATH_UNRESOLVED');
            else if (modulePaths.size < maxPomFiles) modulePaths.add(child);
            else if (!modulePaths.has(child)) issues.add('maven: POM_LIMIT');
        }
    }
    const identity = models.get(rootPath)?.identity;
    return { dependencies, issues: [...issues], project: identity?.name ? { ecosystem: 'maven', group: identity.group,
        name: identity.name, version: jvmVersion(identity.version).version } : undefined };
}

function gradleScope(configuration: string): Scope {
    return /test/i.test(configuration) ? 'excluded' : /compileonly/i.test(configuration) ? 'optional' : 'required';
}

function gradleVersion(value: unknown) {
    return str(value) || str(get(value, 'strictly')) || str(get(value, 'require'));
}

export function gradleProjectPaths(input: string) {
    const names = new Set<string>();
    const issues = new Set<string>();
    const settings = input.replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*')|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
        (text, literal?: string) => literal && !literal.startsWith('"""') && !literal.startsWith("'''") ? literal : text.replace(/[^\r\n]/g, ' '));
    for (const match of settings.matchAll(/^[ \t]*include\b[ \t]*(?:\(([^()]*)\)|([^\r\n;]+))/gm)) {
        const argumentsText = (match[1] ?? match[2]).trim().replace(/,$/, '');
        for (const argument of argumentsText.split(',')) {
            const project = /^(["'])(:?[\w.-]+(?::[\w.-]+)*)\1$/.exec(argument.trim())?.[2];
            const parts = project && project.length <= 4096 ? project.replace(/^:/, '').split(':') : undefined;
            if (!parts || parts.length > 32 || parts.some(part => part === '.' || part === '..')) {
                issues.add('gradle: UNRESOLVED_SUBPROJECT');
                continue;
            }
            for (let count = 1; count <= parts.length; count++) {
                const name = parts.slice(0, count).join(':');
                if (names.has(name)) continue;
                if (names.size >= maxGradleProjects) {
                    issues.add('gradle: SUBPROJECT_LIMIT');
                    break;
                }
                names.add(name);
            }
        }
    }
    const overrides = new Map<string, string>();
    const assignment = /^[ \t]*project[ \t]*\([ \t]*(["'])([^"'\r\n]+)\1[ \t]*\)[ \t]*\.[ \t]*projectDir[ \t]*=[ \t]*([^;\r\n]*)/gm;
    for (const [, , literalName, value] of settings.matchAll(assignment)) {
        const name = literalName.replace(/^:/, '');
        if (!names.has(name)) continue;
        const literal = /^file\s*\(\s*(["'])([\w./-]+)\1\s*\)$/.exec(value.trim())?.[2];
        const parts = literal?.split('/');
        const directory = parts?.every(part => part && part !== '..') ? parts.filter(part => part !== '.').join('/') : '';
        const valid = directory.length > 0 && directory.length <= 4096;
        overrides.set(name, valid ? directory : '');
        if (!valid) issues.add('gradle: UNRESOLVED_SUBPROJECT');
    }
    const directories = new Map([['', '']]);
    for (const name of [...names].sort()) {
        const separator = name.lastIndexOf(':');
        const parent = directories.get(separator === -1 ? '' : name.slice(0, separator));
        const directory = overrides.get(name) ?? (parent === undefined ? '' : [parent, name.slice(separator + 1)].filter(Boolean).join('/'));
        if (directory && directory.length <= 4096) directories.set(name, directory);
        else issues.add('gradle: UNRESOLVED_SUBPROJECT');
    }
    return { paths: [...new Set(directories.values())].filter(Boolean).sort(), issues };
}

export function gradleManifest(inputs: Map<string, string>): ManifestResult {
    const catalogPath = 'gradle/libs.versions.toml';
    let catalog: unknown;
    const issues: string[] = [];
    const catalogSource = inputs.get(catalogPath);
    if (catalogSource !== undefined) {
        try { catalog = parseToml(catalogSource); }
        catch { issues.push(catalogPath + ': PARSE_FAILED'); }
    }
    if (issues.length && inputs.size === 1) throw new Error('Invalid Gradle catalog');
    const scopes = new Map<string, Map<string, Scope>>();
    const dependencies: Dependency[] = [];
    function add(coordinate: string, scope: Scope, source: string, definitionOnly = false) {
        const [group, name, version = ''] = coordinate.split(':');
        if (jvmPart.test(group) && jvmPart.test(name ?? '')) {
            dependencies.push({ ecosystem: 'maven', group, name, ...jvmVersion(version), scope, source, definitionOnly });
        }
    }
    for (const [path, content] of inputs) {
        if (!/(?:^|\/)build\.gradle(?:\.kts)?$/.test(path)) continue;
        const script = content.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '');
        const declaration = /(?:^|[\n;{])\s*((?:\w+)?(?:api|implementation|compileOnly|runtimeOnly|annotationProcessor|kapt|classpath))\s*\(?\s*(?:(?:platform|enforcedPlatform|testFixtures)\s*\(\s*)?(?:(["'])([^"'\r\n]+)\2|libs\.([\w.]+))/gi;
        for (const match of script.matchAll(declaration)) {
            const scope = gradleScope(match[1]);
            if (match[3]) add(match[3], scope, path);
            if (match[4]) {
                const files = scopes.get(match[4]) ?? new Map<string, Scope>();
                const previous = files.get(path);
                if (scope === 'required' || !previous || previous === 'excluded') files.set(path, scope);
                scopes.set(match[4], files);
            }
        }
    }
    for (const [alias, spec] of Object.entries(table(get(catalog, 'libraries')))) {
        const module = str(get(spec, 'module')) || [str(get(spec, 'group')), str(get(spec, 'name'))].join(':');
        const specVersion = get(spec, 'version');
        const reference = str(get(specVersion, 'ref'));
        const version = gradleVersion(reference ? get(get(catalog, 'versions'), reference) : specVersion);
        const coordinate = str(spec) || module + ':' + version;
        add(coordinate, 'required', catalogPath, true);
        for (const [path, scope] of scopes.get(alias.replace(/[-_]/g, '.')) ?? []) add(coordinate, scope, path);
    }
    for (const [path, content] of inputs) {
        if (!/(?:^|\/)gradle\.lockfile$/.test(path)) continue;
        for (const line of content.split(/\r?\n/)) {
            const [coordinate, configs] = line.split('=', 2);
            if (coordinate.startsWith('#') || !configs) continue;
            const mapped = configs.split(',').map(gradleScope);
            const scope = mapped.includes('required') ? 'required' : mapped.includes('optional') ? 'optional' : 'excluded';
            add(coordinate.trim(), scope, path);
        }
    }
    const settings = inputs.get('settings.gradle.kts') ?? inputs.get('settings.gradle') ?? '';
    const rootName = /^\s*rootProject\.name\s*=\s*["']([\w.-]+)["']/m.exec(settings)?.[1];
    return { dependencies, issues, project: rootName ? { ecosystem: 'maven', name: rootName } : undefined };
}

function pypiName(name: string) { return name.toLowerCase().replace(/[-_.]+/g, '-'); }

export function pythonManifest(inputs: Map<string, string>): ManifestResult {
    const pyproject = 'pyproject.toml';
    let project: unknown;
    const issues: string[] = [];
    const configuration = inputs.get(pyproject);
    if (configuration !== undefined) {
        try { project = get(parseToml(configuration), 'project'); }
        catch {
            if (inputs.size === 1) throw new Error('Invalid pyproject.toml');
            issues.push(pyproject + ': PARSE_FAILED');
        }
    }
    const dependencies: Dependency[] = [];
    function add(spec: unknown, scope: Scope, source: string) {
        if (typeof spec !== 'string') return;
        if (dependencies.length >= maxPythonDeclarations) return;
        const requirement = /^\s*([a-z0-9][\w.-]*)(?:\s*\[[^\]\r\n]*\])?\s*([^;]*?)(?:;|$)/i.exec(spec);
        if (!requirement) return;
        const name = pypiName(requirement[1]);
        const raw = requirement[2].trim().replace(/^\((.+)\)$/, '$1').trim();
        const pin = /^===?\s*([a-z0-9][a-z0-9.!+_-]*)$/i.exec(raw)?.[1];
        dependencies.push({ ecosystem: 'pypi', name, ...versionFields(pin ?? raw, pin !== undefined), scope, source });
    }
    const required = get(project, 'dependencies');
    if (Array.isArray(required)) for (const spec of required) add(spec, 'required', pyproject);
    for (const group of Object.values(table(get(project, 'optional-dependencies')))) {
        if (Array.isArray(group)) for (const spec of group) add(spec, 'optional', pyproject);
    }
    for (const [path, content] of inputs) {
        if (path === pyproject) continue;
        const scope = /dev|test/i.test(path.slice('requirements'.length)) ? 'excluded' : 'required';
        for (const line of content.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
            add(line.replace(/\s*(?:\s#|\s--hash=).*$/, ''), scope, path);
        }
    }
    if (dependencies.length >= maxPythonDeclarations) issues.push('pip: DECLARATION_LIMIT');
    const name = str(get(project, 'name'));
    const version = str(get(project, 'version'));
    return { dependencies, issues, project: /^[a-z0-9][\w.-]*$/i.test(name) ? { ecosystem: 'pypi', name: pypiName(name),
        version: /^[a-z0-9][a-z0-9.!+_-]*$/i.test(version) ? version : undefined } : undefined };
}
