import { basename, extname } from 'node:path/posix';
import type { ArchiveFile } from './archive.js';
import { codeqlLanguages } from './codeql.js';
import { dependencyAssets, requirementsName } from './sbom.js';
import type { DependencyInventory } from './sbom.js';

const buildSystems: Record<string, string> = {
    'package.json': 'NPM', 'pom.xml': 'MAVEN', 'build.gradle': 'GRADLE', 'build.gradle.kts': 'GRADLE',
    'pyproject.toml': 'PYTHON', 'gradle.lockfile': 'GRADLE', 'libs.versions.toml': 'GRADLE', 'go.mod': 'GO', 'Cargo.toml': 'CARGO'
};

function buildSystem(name: string) {
    return requirementsName.test(name) ? 'PYTHON' : Object.hasOwn(buildSystems, name) ? buildSystems[name] : undefined;
}
const languages: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.md': 'markdown', '.markdown': 'markdown', '.rst': 'text', '.txt': 'text',
    '.java': 'java', '.kt': 'kotlin', '.py': 'python', '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp',
    '.go': 'go', '.rs': 'rust', '.cs': 'csharp', '.sol': 'solidity', '.rb': 'ruby', '.swift': 'swift',
    '.json': 'json', '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.xml': 'xml'
};
const sourceLanguages = new Set([
    'typescript', 'javascript', 'java', 'kotlin', 'python', 'c', 'cpp', 'go', 'rust', 'csharp', 'solidity', 'ruby', 'swift'
]);
const codeqlSourceLanguages = new Set(codeqlLanguages);

export function archiveLanguage(path: string) { return languages[extname(path).toLowerCase()] ?? ''; }

function classify(file: ArchiveFile) {
    const language = archiveLanguage(file.path);
    const name = basename(file.path);
    const result = (category: string, reason: string) => ({ ...file, category, reason, language });
    if (/(^|\/)(?:node_modules|vendor|dist|build|coverage|__pycache__|\.git)(?:\/|$)/i.test(file.path)
        || /\.(?:class|min\.js|pyc)$/i.test(name)) return result('GENERATED', 'generated_or_dependency');
    if (/(^|\/)(?:tests?|__tests__|spec)(?:\/|$)/i.test(file.path)
        || /(?:^test_|[._](?:test|spec)\.|Tests?\.java$)/i.test(name)) return result('TEST', 'test_path_or_name');
    if (['markdown', 'text'].includes(language) && !buildSystem(name)
        || /^(?:readme|license|changelog)(?:\.|$)/i.test(name)) return result('DOCUMENTATION', 'documentation_file');
    if (buildSystem(name) || sourceLanguages.has(language) || /^\.env(?:\.|$)/i.test(name)
        || /\.(?:ya?ml|toml|json|xml|properties)$/i.test(name)) return result('BUSINESS', 'source_or_configuration');
    return result('UNKNOWN', 'unrecognized_path');
}

function distribution(values: string[]) {
    const counts = new Map<string, number>();
    for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

export function assetProfile(
    asset: { assetId: string; projectId: string; projectRoot: string }, manifest: ArchiveFile[],
    includes: string[], excludes: string[], frameworks: Record<string, number>, inventory: DependencyInventory,
    vulnerabilityCounts: Record<string, number>
) {
    const files = manifest.map(classify);
    const active = files.filter(file => file.category === 'BUSINESS' || file.category === 'TEST');
    const languageSet = new Set(active.map(file => file.language));
    const systems = [...new Set(active.flatMap(file => {
        const system = buildSystem(basename(file.path));
        return system ? [system] : [];
    }))].sort();
    const include = new Set(includes.map(name => name.trim().toUpperCase()));
    const exclude = new Set(excludes.map(name => name.trim().toUpperCase()));
    const rules = [
        ['REPOGRAPH', [...languageSet].some(language => sourceLanguages.has(language)), 'Source files detected'],
        ['SEMGREP', [...languageSet].some(language => sourceLanguages.has(language)), 'Source files detected'],
        ['CODEQL', [...languageSet].some(language => codeqlSourceLanguages.has(language)), 'Language supports analysis without building the project'],
        ['SLITHER', languageSet.has('solidity'), 'Solidity files detected']
    ] as const;
    const scannerPlan = rules.map(([scanner, recommended, reason]) => ({
        scanner, selected: !exclude.has(scanner) && (include.has(scanner) || recommended),
        source: exclude.has(scanner) || include.has(scanner) ? 'MANUAL' : 'AUTO',
        reason: exclude.has(scanner) ? 'Excluded by request' : include.has(scanner) ? 'Included by request'
            : recommended ? reason : 'No applicable files detected'
    }));
    const sensitive = files.filter(file => file.category !== 'GENERATED' &&
        /^(?:\.env(?:\.|$)|secrets?(?:\.|$)|credentials(?:\.|$)|id_(?:rsa|ed25519)(?:$|\.))/i.test(basename(file.path)));
    return {
        ...asset, generatedAt: new Date().toISOString(), totalFiles: files.length, files,
        categoryDistribution: distribution(files.map(file => file.category)),
        languageDistribution: distribution(files.map(file => file.language)),
        frameworks: Object.keys(frameworks), buildSystems: systems, dependencies: dependencyAssets(inventory),
        dependencyIssues: inventory.issues, vulnerabilityCounts,
        riskSignals: sensitive.length ? [{
            type: 'SENSITIVE_CONFIGURATION_PATH', severity: 'INFO', count: sensitive.length,
            evidence: sensitive.slice(0, 100).map(file => file.path), reason: 'File name suggests sensitive configuration'
        }] : [],
        scannerPlan,
        omittedReasons: [...(inventory.available ? [] : ['DEPENDENCY_INVENTORY_UNAVAILABLE']),
            'SOURCE_HOTSPOTS_UNAVAILABLE']
    };
}
