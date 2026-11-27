import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path/posix';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { DependencyInventory } from './sbom.js';
import { dependencyInventory } from './sbom.js';
import { redactReviewText } from './review-redaction.js';
import { digest } from './source.js';

const coordinate = z.string().max(214).regex(/^[a-zA-Z0-9][\w.-]*$/);
export const dependencyAdvisory = z.object({
    id: z.string().max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    summary: z.string().trim().min(1).max(1000),
    severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN']),
    cwe: z.string().max(128),
    groupId: coordinate,
    artifactId: coordinate,
    introduced: z.string().max(180),
    fixed: z.string().max(180),
    source: z.string().trim().min(1).max(128)
});
export type DependencyAdvisory = z.infer<typeof dependencyAdvisory>;
export interface DependencyEvidence {
    coordinate: string; version: string; purl: string; manifests: string[]; advisoryId: string;
    introduced: string; fixed: string; source: string;
}
export interface DependencyMatch { advisory: DependencyAdvisory; dependency: DependencyEvidence }
export interface DependencyFindingPreview {
    id: string; advisoryId: string; coordinate: string; version: string; severity: DependencyAdvisory['severity'];
}
export interface DependencyScanResult {
    projectId: string; scannedComponents: number; unverifiedComponents: number; excludedComponents: number;
    issues: string[]; matchedFindings: number; newFindings: number; preview: DependencyFindingPreview[];
}

const qualifiers: Record<string, number> = { alpha: -5, a: -5, beta: -4, b: -4, milestone: -3, m: -3,
    rc: -2, cr: -2, snapshot: -1, final: 0, ga: 0, release: 0, sp: 1, v: 1 };

function parseVersion(raw: string) {
    const parsed = /^(\d+(?:\.\d+)*)(?:[.-]?([a-z]+)(?:[.-]?(\d+))?)?$/i.exec(raw);
    if (!parsed) return undefined;
    const [, digits, suffix, qualifierNumber] = parsed;
    const qualifier = suffix?.toLowerCase() ?? 'final';
    if (qualifier === 'jre' || qualifier === 'android') {
        if (qualifierNumber) return undefined;
        return { parts: digits.split('.').map(BigInt), rank: 0, serial: 0n, flavor: qualifier };
    }
    if (!Object.hasOwn(qualifiers, qualifier) || (qualifier === 'v' && !/^\d{8}$/.test(qualifierNumber ?? ''))) return undefined;
    return { parts: digits.split('.').map(BigInt), rank: qualifiers[qualifier], serial: BigInt(qualifierNumber ?? 0),
        flavor: qualifier === 'v' ? 'dated' : '' };
}

function compareVersion(left: NonNullable<ReturnType<typeof parseVersion>>, raw: string) {
    const right = parseVersion(raw);
    if (!right) return undefined;
    // Package variants with their own fixes are only compared against an equivalent variant.
    if (right.flavor && right.flavor !== left.flavor) return undefined;
    for (let index = 0; index < Math.max(left.parts.length, right.parts.length); index++) {
        const a = left.parts[index] ?? 0n;
        const b = right.parts[index] ?? 0n;
        if (a !== b) return a < b ? -1 : 1;
    }
    if (left.rank !== right.rank) return Math.sign(left.rank - right.rank);
    return left.serial === right.serial ? 0 : left.serial < right.serial ? -1 : 1;
}

export function restoreDependencyAdvisories(db: DatabaseSync, entries: DependencyAdvisory[]) {
    const insert = db.prepare('INSERT INTO dependency_advisory VALUES (?,?,?,?,?,?,?,?,?)');
    for (const entry of entries) insert.run(entry.id, entry.summary, entry.severity, entry.cwe,
        entry.groupId, entry.artifactId, entry.introduced, entry.fixed, entry.source);
}

const maxMatches = 5000;
const maxCatalogRowsPerPackage = 2500;
const maxComparisons = 100_000;
const maxCatalogRows = 100_000;
const maxReviewMatches = 100;

export async function captureDependencyInventory(root: string) {
    const manifests = new Map<string, string>();
    let changed = false;
    const inventory = await dependencyInventory(root, (path, bytes) => {
        const hash = digest(bytes);
        const previous = manifests.get(path);
        if (previous && previous !== hash) changed = true;
        manifests.set(path, hash);
    });
    return { inventory, manifests, changed };
}

export type DependencyReviewCheck = {
    tool: 'offline-maven-advisories';
    provenance: 'FROZEN_INDEX_INPUT' | 'UNRECORDED';
    status: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'NOT_APPLICABLE' | 'UNAVAILABLE';
    catalogDigest: string | null; manifestDigest: string | null;
    manifestCount: number; comparableComponents: number; unverifiedComponents: number;
    unsupportedComponents: number; findingCount: number; reasons: string[];
    preview: { id: string; coordinate: string; version: string; severity: DependencyAdvisory['severity']; manifests: string[] }[];
};

export function missingDependencyCheck(): DependencyReviewCheck {
    return { tool: 'offline-maven-advisories', provenance: 'UNRECORDED', status: 'UNAVAILABLE', catalogDigest: null, manifestDigest: null,
        manifestCount: 0, comparableComponents: 0, unverifiedComponents: 0, unsupportedComponents: 0, findingCount: 0,
        reasons: ['DEPENDENCY_INPUT_NOT_CAPTURED'], preview: [] };
}

export class DependencyAdvisories {
    constructor(private readonly db: DatabaseSync) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS dependency_advisory (
                id TEXT NOT NULL, summary TEXT NOT NULL, severity TEXT NOT NULL, cwe TEXT NOT NULL,
                group_id TEXT NOT NULL, artifact_id TEXT NOT NULL, introduced TEXT NOT NULL, fixed TEXT NOT NULL,
                source TEXT NOT NULL, PRIMARY KEY(id,group_id,artifact_id)
            );
            CREATE INDEX IF NOT EXISTS dependency_advisory_coordinate ON dependency_advisory(group_id,artifact_id,id);
        `);
        db.exec('BEGIN IMMEDIATE');
        try {
            if (!db.prepare('SELECT 1 FROM dependency_advisory LIMIT 1').get()) {
                const file = new URL('../resources/advisories/maven-bundled.json', import.meta.url);
                const bundled = z.array(dependencyAdvisory.omit({ source: true })).parse(JSON.parse(readFileSync(file, 'utf8')));
                restoreDependencyAdvisories(db, bundled.map(row => ({ ...row, source: 'bundled' })));
            }
            db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
    }

    reviewCheck(capture: Awaited<ReturnType<typeof captureDependencyInventory>>, previous?: DependencyReviewCheck): DependencyReviewCheck {
        const { inventory, manifests, changed } = capture;
        const recorded = { ...missingDependencyCheck(), provenance: 'FROZEN_INDEX_INPUT' as const, manifestCount: manifests.size,
            manifestDigest: digest(JSON.stringify([...manifests].sort(([a], [b]) => a < b ? -1 : 1))), reasons: [] as string[] };
        if (changed) return { ...recorded, status: 'FAILED', reasons: ['DEPENDENCY_MANIFEST_CHANGED_DURING_CAPTURE'] };
        const catalog = createHash('sha256');
        let count = 0;
        for (const row of this.db.prepare('SELECT * FROM dependency_advisory ORDER BY id,group_id,artifact_id LIMIT ?').iterate(maxCatalogRows + 1)) {
            if (++count > maxCatalogRows) return { ...recorded, status: 'UNAVAILABLE', reasons: ['ADVISORY_CATALOG_LIMIT'] };
            catalog.update(JSON.stringify(row) + '\n');
        }
        const catalogDigest = catalog.digest('hex');
        if (!count) return { ...recorded, catalogDigest, status: 'UNAVAILABLE', reasons: ['ADVISORY_CATALOG_EMPTY'] };
        if (!inventory.issues.length && previous?.status === 'COMPLETED' && previous.catalogDigest === catalogDigest
            && previous.manifestDigest === recorded.manifestDigest) return previous;
        const result = this.match(inventory);
        const unsupportedComponents = inventory.components.filter(item => item.ecosystem !== 'maven' && item.scope !== 'excluded').length;
        const issues = result.issues.slice(0, 50).map(issue => redactReviewText(issue));
        if (unsupportedComponents) issues.push('ADVISORY_ECOSYSTEM_UNSUPPORTED');
        if (result.unverifiedComponents) issues.push('DEPENDENCY_VERSION_UNVERIFIED');
        if (result.matches.length > maxReviewMatches) issues.push('ADVISORY_PREVIEW_LIMIT');
        const comparableComponents = result.scannedComponents - result.unverifiedComponents;
        const status = issues.length ? comparableComponents || result.matches.length ? 'PARTIAL'
            : unsupportedComponents && !inventory.issues.length && !result.scannedComponents ? 'UNAVAILABLE' : 'FAILED'
            : result.scannedComponents ? 'COMPLETED' : 'NOT_APPLICABLE';
        return { ...recorded, catalogDigest, status, comparableComponents, unsupportedComponents, unverifiedComponents: result.unverifiedComponents,
            findingCount: result.matches.length, reasons: issues, preview: result.matches.slice(0, maxReviewMatches).map(({ advisory, dependency }) => ({
                id: advisory.id, coordinate: dependency.coordinate, version: dependency.version, severity: advisory.severity,
                manifests: dependency.manifests.slice(0, 8).map(path => redactReviewText(path))
            })) };
    }

    match(inventory: DependencyInventory) {
        const issues = [...inventory.issues];
        const matches: DependencyMatch[] = [];
        let scannedComponents = 0;
        let unverifiedComponents = 0;
        let excludedComponents = 0;
        let comparisons = 0;
        const lookup = this.db.prepare(`
            SELECT id,summary,severity,cwe,group_id AS groupId,artifact_id AS artifactId,introduced,fixed,source
            FROM dependency_advisory WHERE group_id = ? AND artifact_id = ?
            ORDER BY id LIMIT ?
        `);
        const locked = new Map<string, Set<string>>();
        const pins = new Map<string, Set<string>>();
        for (const item of inventory.components) {
            if (item.ecosystem !== 'maven' || !item.group || !item.version) continue;
            for (const [file, scope] of item.declarations) {
                if (scope === 'excluded' || basename(file) !== 'gradle.lockfile') continue;
                const coordinate = item.group + ':' + item.name;
                const modules = locked.get(coordinate) ?? new Set<string>();
                const versionModules = pins.get(item.purl) ?? new Set<string>();
                modules.add(dirname(file));
                versionModules.add(dirname(file));
                locked.set(coordinate, modules);
                pins.set(item.purl, versionModules);
            }
        }
        for (const item of inventory.components) {
            if (item.ecosystem !== 'maven' || !item.group) continue;
            const { group, name, purl, declarations } = item;
            const coordinate = group + ':' + name;
            const lockedModules = locked.get(coordinate);
            const pinnedModules = pins.get(purl);
            const manifests = [...declarations].filter(([file, scope]) => {
                if (scope === 'excluded') return false;
                const module = dirname(file);
                return !/^build\.gradle(?:\.kts)?$/.test(basename(file)) || !lockedModules?.has(module) || pinnedModules?.has(module);
            }).map(([file]) => file);
            if (!manifests.length) {
                excludedComponents++;
                continue;
            }
            if (matches.length >= maxMatches || comparisons >= maxComparisons) {
                issues.push('advisories: SCAN_LIMIT');
                break;
            }
            scannedComponents++;
            const advisories = lookup.all(group, name, Math.min(maxCatalogRowsPerPackage, maxComparisons - comparisons) + 1) as unknown as DependencyAdvisory[];
            comparisons += advisories.length;
            if (advisories.length > maxCatalogRowsPerPackage || comparisons > maxComparisons) {
                issues.push('advisories: SCAN_LIMIT');
                unverifiedComponents++;
                continue;
            }
            const exactVersion = item.version;
            const version = exactVersion && parseVersion(exactVersion);
            if (!exactVersion || !version) { unverifiedComponents++; continue; }
            let unverified = false;
            manifests.sort((left, right) => Number(basename(right) === 'gradle.lockfile')
                - Number(basename(left) === 'gradle.lockfile') || left.localeCompare(right));
            for (const advisory of advisories) {
                const lower = advisory.introduced ? compareVersion(version, advisory.introduced) : 0;
                const upper = advisory.fixed ? compareVersion(version, advisory.fixed) : -1;
                if (lower === undefined || upper === undefined) { unverified = true; continue; }
                if (lower < 0 || upper >= 0) continue;
                if (matches.length === maxMatches) { issues.push('advisories: SCAN_LIMIT'); break; }
                matches.push({ advisory, dependency: { coordinate, version: exactVersion, purl, manifests, advisoryId: advisory.id,
                    introduced: advisory.introduced, fixed: advisory.fixed, source: advisory.source } });
            }
            if (unverified) unverifiedComponents++;
        }
        return { matches, scannedComponents, unverifiedComponents, excludedComponents, issues: [...new Set(issues)] };
    }
}
