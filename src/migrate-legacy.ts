import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, realpath, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AgentRuns, agentRunIdPattern } from './agent-runs.js';
import { indexLanguages } from './assets.js';
import { writeChangeSnapshots } from './change-review.js';
import { dependencyAdvisory, restoreDependencyAdvisories } from './dependency-advisories.js';
import { DetectionRules } from './detection-rules.js';
import type { DependencyAdvisory } from './dependency-advisories.js';
import { ExternalFindings } from './external-findings.js';
import { ADMIN_ID, legacyPasswordHash } from './identity.js';
import { RepositoryIndex } from './index.js';
import { legacyAgentReference, legacyAgentResult, legacyAgentRun, legacyAgentStep, prepareLegacyAgentRuns } from './legacy-agent-runs.js';
import { copyLegacyAsset, legacyAssetRow, planLegacyAssets } from './legacy-assets.js';
import { legacyChangeReview, prepareLegacyChangeReviews } from './legacy-change-reviews.js';
import { legacyDetectionRule, legacyRuleAudit, legacyRuleEvaluation, legacyRuleFramework, legacyRuleLanguage, legacyRuleSample,
    prepareLegacyDetectionRules } from './legacy-detection-rules.js';
import { legacyExternalRow, legacyReviewEntryRow, legacyReviewEventRow, legacySnapshotRow, prepareLegacyReviews } from './legacy-reviews.js';
import { legacyScannerRun, legacyScanTask, prepareLegacyScanHistory } from './legacy-scan-history.js';
import { legacyFeedback, legacySuppression, legacySuppressionEvent, prepareLegacyTriage } from './legacy-triage.js';
import { legacyVulnerabilityEvidence, legacyVulnerabilityFinding, prepareLegacyVulnerabilities } from './legacy-vulnerabilities.js';
import { legacyWikiDocument, prepareLegacyWikiDocuments } from './legacy-wiki.js';
import { DEFAULT_PROVIDER, normalizeEndpoint, providerBinding, providerInput } from './model-providers.js';
import { readProjectFile } from './project-file.js';
import { ProviderSecrets } from './provider-secrets.js';
import { ReviewQueue } from './review-queue.js';
import { ScanHistory } from './scan-history.js';
import { TriagePolicy } from './triage-policy.js';
import { VulnerabilityInventory } from './vulnerability-inventory.js';
import { restoreWikiDocuments } from './wiki.js';

const migrationUsage = 'node dist/migrate-legacy.js --output NEW_DIRECTORY --projects-root DIRECTORY [--source FILE] [--legacy-key-file FILE] [--legacy-assets-root DIRECTORY] [--dry-run]';
const enabled = z.literal([0, 1]);
const id = z.string().min(1).max(128);
const date = z.string().refine(value => Number.isFinite(Date.parse(value)));
const account = z.object({
    id, username: z.string().regex(/^[a-z0-9][a-z0-9_.-]{2,63}$/), display_name: z.string(), email: z.string(),
    password_hash: z.string().regex(legacyPasswordHash), role: z.enum(['ADMIN', 'USER']),
    status: z.enum(['PENDING', 'ACTIVE', 'REJECTED', 'DISABLED']),
    credential_version: z.number().int().min(1), created_at: date
});
const organization = z.object({ id, name: z.string().min(1), active: enabled, created_at: date });
const membership = z.object({ organization_id: id, account_id: id });
const owner = z.object({ project_id: id, owner_type: z.enum(['PERSONAL', 'ORGANIZATION']), owner_id: id, updated_at: date });
type OwnerEvidence = z.infer<typeof owner>;
type OwnershipReview = { projectId: string; reason: 'MISSING_OWNER_EVIDENCE' | 'CONFLICTING_OWNER_EVIDENCE' | 'UNKNOWN_LEGACY_OWNER'
    | 'LEGACY_PROJECT_UNAVAILABLE' };
const audit = z.object({ id: z.number().int().min(1), actor_id: id, action: z.string(), target_id: z.string(),
    reason: z.string(), created_at: date });
const legacyProject = z.object({ project_root: z.string(), indexed_at: date });
const legacyProvider = z.object({
    id: id.refine(value => value === DEFAULT_PROVIDER || agentRunIdPattern.test(value)), name: z.string(), protocol: z.string(),
    base_url: z.string(), model: z.string(), enabled, selected: enabled, encrypted_key: z.string().max(12_000),
    timeout_millis: z.number(), max_output_tokens: z.number(), updated_at: date,
    input_usd_per_million: z.number().nullish(), output_usd_per_million: z.number().nullish()
});
const oldOllama = z.object({ id, enabled, base_url: z.string(), model: z.string(), updated_at: date });
const oldDependencyAdvisory = z.object({
    id: z.string(), summary: z.string(), severity: z.string(), cwe: z.string().nullish(), group_id: z.string(),
    artifact_id: z.string(), introduced: z.string().nullish(), fixed: z.string().nullish(), source: z.string().nullish()
}).transform(({ group_id, artifact_id, cwe, introduced, fixed, source, ...row }) => ({
    ...row, groupId: group_id, artifactId: artifact_id, cwe: cwe ?? '', introduced: introduced ?? '', fixed: fixed ?? '', source: source || 'imported'
})).pipe(dependencyAdvisory);
const reportedLegacyTables = [
    'file_cache', 'llm_advisory_settings', 'pending_project_deletions', 'summary_generation_cache'
];

class MigrationError extends Error {}
function fail(code: string): never { throw new MigrationError(code); }
function missing(error: unknown) { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function projectId(path: string) { return createHash('sha256').update(path).digest('hex').slice(0, 12); }

function rows<T>(db: DatabaseSync, table: string, schema: z.ZodType<T>) {
    const parsed = z.array(schema).safeParse(db.prepare(`SELECT * FROM ${table}`).all());
    if (!parsed.success) fail(`INVALID_LEGACY_DATA (${table})`);
    return parsed.data;
}

async function readProviders(db: DatabaseSync, tables: ReadonlySet<string>, keyPath: string) {
    const configured = tables.has('model_providers') ? rows(db, 'model_providers', legacyProvider) : [];
    if (!configured.length && tables.has('llm_advisory_settings')) {
        const old = rows(db, 'llm_advisory_settings', oldOllama).find(row => row.id === 'default');
        if (old) configured.push({ ...old, id: DEFAULT_PROVIDER, name: 'Ollama', protocol: 'OLLAMA', selected: 1,
            encrypted_key: '', timeout_millis: 180_000, max_output_tokens: 4096, input_usd_per_million: 0, output_usd_per_million: 0 });
    }
    if (configured.length && configured.filter(row => row.selected).length !== 1) fail('INVALID_LEGACY_PROVIDER_SELECTION');
    let secrets: ProviderSecrets | undefined;
    if (configured.some(row => row.encrypted_key)) {
        try {
            const key = process.env.REPOGRAPH_LEGACY_PROVIDER_ENCRYPTION_KEY
                ?? (await readProjectFile(keyPath, 128)).toString('utf8');
            secrets = new ProviderSecrets(null, key, true);
        } catch { fail('LEGACY_PROVIDER_KEY_INVALID'); }
    }
    return configured.map(row => {
        let apiKey = '';
        if (row.encrypted_key) {
            try {
                // Java stores nonce, ciphertext, then GCM tag. The current envelope places the tag before the ciphertext.
                const raw = Buffer.from(row.encrypted_key, 'base64');
                if (raw.length <= 28 || raw.toString('base64') !== row.encrypted_key) fail('LEGACY_PROVIDER_KEY_INVALID');
                const compatible = Buffer.concat([raw.subarray(0, 12), raw.subarray(-16), raw.subarray(12, -16)]);
                apiKey = secrets!.decrypt(row.id, compatible.toString('base64'));
            } catch { fail('LEGACY_PROVIDER_KEY_INVALID'); }
        }
        const pricesAbsent = row.input_usd_per_million === undefined && row.output_usd_per_million === undefined;
        const priceDefault = pricesAbsent && row.protocol === 'OLLAMA' ? 0 : null;
        const parsed = providerInput.safeParse({
            name: row.name, protocol: row.protocol, baseUrl: row.base_url, model: row.model, enabled: !!row.enabled,
            timeoutMillis: row.timeout_millis, maxOutputTokens: row.max_output_tokens, apiKey,
            inputUsdPerMillionTokens: row.input_usd_per_million ?? priceDefault,
            outputUsdPerMillionTokens: row.output_usd_per_million ?? priceDefault
        });
        if (!parsed.success || parsed.data.apiKey !== apiKey) fail('INVALID_LEGACY_PROVIDER_CONFIGURATION');
        const { apiKey: secret, clearApiKey: _clearApiKey, ...fields } = parsed.data;
        let baseUrl;
        try { baseUrl = normalizeEndpoint(fields.baseUrl); }
        catch { fail('INVALID_LEGACY_PROVIDER_CONFIGURATION'); }
        return { config: { ...fields, baseUrl, id: row.id, updatedAt: row.updated_at }, selected: row.selected, apiKey: secret };
    });
}

async function migrationData(source: string, projectsRoot: string, keyPath: string, legacyAssets: string, destinationAssets: string) {
    const db = new DatabaseSync(source, { readOnly: true });
    try {
        db.exec('PRAGMA trusted_schema=OFF; BEGIN');
        const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map(row => String(row.name)));
        const required = ['enterprise_accounts', 'enterprise_organizations', 'enterprise_memberships', 'enterprise_project_owners', 'enterprise_audit'];
        if (tables.has('enterprise_account') || required.some(table => !tables.has(table))) fail('UNSUPPORTED_LEGACY_DATABASE');
        const accounts = rows(db, 'enterprise_accounts', account);
        const organizations = rows(db, 'enterprise_organizations', organization);
        const memberships = rows(db, 'enterprise_memberships', membership);
        const owners = rows(db, 'enterprise_project_owners', owner);
        const audits = rows(db, 'enterprise_audit', audit);
        const providers = await readProviders(db, tables, keyPath);
        const advisories: DependencyAdvisory[] = tables.has('advisories') ? rows(db, 'advisories', oldDependencyAdvisory) : [];
        const history = tables.has('index_history') ? rows(db, 'index_history', legacyProject) : [];
        const deleting = new Set(tables.has('pending_project_deletions')
            ? db.prepare('SELECT project_id FROM pending_project_deletions').all().map(row => String(row.project_id)) : []);
        const assetRows = tables.has('imported_assets') ? rows(db, 'imported_assets', legacyAssetRow) : [];
        const managed = new Set(assetRows.map(row => row.project_id));
        const assetPlan = await planLegacyAssets(assetRows, legacyAssets, destinationAssets, deleting);
        const skipped = Object.fromEntries(reportedLegacyTables.filter(table => tables.has(table))
            .map(table => [table, Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n)]).filter(([, count]) => count));
        if (assetRows.length > assetPlan.assets.length) skipped.imported_assets = assetRows.length - assetPlan.assets.length;

        const administrator = accounts.find(entry => entry.id === ADMIN_ID);
        if (accounts.length && (administrator?.username !== 'admin' || administrator.status !== 'ACTIVE' || administrator.role !== 'ADMIN')) {
            fail('INVALID_LEGACY_ADMIN');
        }
        const accountsById = new Set(accounts.map(row => row.id));
        const organizationsById = new Set(organizations.map(row => row.id));
        if (memberships.some(row => !accountsById.has(row.account_id) || !organizationsById.has(row.organization_id))) {
            fail('INVALID_LEGACY_OWNERSHIP');
        }

        const projects = new Map<string, { id: string; root: string }>();
        const mapping = new Map<string, string>();
        for (const asset of assetPlan.assets) {
            if (projects.has(asset.projectId) || mapping.has(asset.oldProjectId)) fail('LEGACY_PROJECT_ROOT_CONFLICT');
            projects.set(asset.projectId, { id: asset.projectId, root: asset.projectRoot });
            mapping.set(asset.oldProjectId, asset.projectId);
        }
        const projectSkips = { unavailable: 0, outsideProjectsRoot: 0, pendingDeletion: 0, managedArchive: 0 };
        for (const { project_root } of history) {
            if (!isAbsolute(project_root) || project_root.includes('\0')) fail('INVALID_LEGACY_PROJECT_ROOT');
            const path = resolve(project_root);
            const oldId = projectId(path);
            if (deleting.has(oldId)) { projectSkips.pendingDeletion++; continue; }
            if (managed.has(oldId)) {
                if (!mapping.has(oldId)) projectSkips.managedArchive++;
                continue;
            }
            let root: string;
            try {
                root = await realpath(path);
                if (!(await stat(root)).isDirectory()) { projectSkips.unavailable++; continue; }
            } catch (error) {
                if (!missing(error) && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error;
                projectSkips.unavailable++;
                continue;
            }
            const subpath = relative(projectsRoot, root);
            if (isAbsolute(subpath) || subpath === '..' || subpath.startsWith(`..${sep}`)) {
                projectSkips.outsideProjectsRoot++;
                continue;
            }
            const newId = projectId(root);
            if (projects.has(newId)) fail('LEGACY_PROJECT_ROOT_CONFLICT');
            projects.set(newId, { id: newId, root });
            mapping.set(oldId, newId);
        }
        const claims = new Map<string, OwnerEvidence[]>();
        const unmappedOwners = new Set<string>();
        for (const entry of owners) {
            const target = mapping.get(entry.project_id);
            if (!target) { unmappedOwners.add(entry.project_id); continue; }
            const candidates = claims.get(target) ?? [];
            candidates.push({ ...entry, project_id: target });
            claims.set(target, candidates);
        }
        const ownershipReview: OwnershipReview[] = [...unmappedOwners].map(projectId => ({ projectId, reason: 'LEGACY_PROJECT_UNAVAILABLE' }));
        const projectOwners: OwnerEvidence[] = [];
        for (const projectId of projects.keys()) {
            const candidates = claims.get(projectId) ?? [];
            const distinct = new Set(candidates.map(row => JSON.stringify([row.owner_type, row.owner_id])));
            const unknown = candidates.some(row => !(row.owner_type === 'PERSONAL' ? accountsById : organizationsById).has(row.owner_id));
            if (!candidates.length) ownershipReview.push({ projectId, reason: 'MISSING_OWNER_EVIDENCE' });
            else if (distinct.size > 1) ownershipReview.push({ projectId, reason: 'CONFLICTING_OWNER_EVIDENCE' });
            else if (unknown) ownershipReview.push({ projectId, reason: 'UNKNOWN_LEGACY_OWNER' });
            else projectOwners.push(candidates.reduce((latest, row) => Date.parse(row.updated_at) > Date.parse(latest.updated_at) ? row : latest));
        }
        ownershipReview.sort((left, right) => left.projectId < right.projectId ? -1 : left.projectId > right.projectId ? 1 : 0);
        const oldVulnerabilities = tables.has('vuln_findings') ? rows(db, 'vuln_findings', legacyVulnerabilityFinding) : [];
        const oldEvidence = tables.has('vuln_taint_evidence') ? rows(db, 'vuln_taint_evidence', legacyVulnerabilityEvidence) : [];
        const vulnerabilities = prepareLegacyVulnerabilities(oldVulnerabilities, oldEvidence, mapping);
        if (vulnerabilities.records.length < oldVulnerabilities.length) skipped.vuln_findings = oldVulnerabilities.length - vulnerabilities.records.length;
        if (vulnerabilities.evidenceSteps < oldEvidence.length) skipped.vuln_taint_evidence = oldEvidence.length - vulnerabilities.evidenceSteps;
        const externalRows = tables.has('external_findings') ? rows(db, 'external_findings', legacyExternalRow) : [];
        const snapshotRows = tables.has('report_snapshots') ? rows(db, 'report_snapshots', legacySnapshotRow) : [];
        const entryRows = tables.has('review_queue_entries') ? rows(db, 'review_queue_entries', legacyReviewEntryRow) : [];
        const eventRows = tables.has('review_queue_audit') ? rows(db, 'review_queue_audit', legacyReviewEventRow) : [];
        let reviews: ReturnType<typeof prepareLegacyReviews>;
        try { reviews = prepareLegacyReviews(externalRows, snapshotRows, entryRows, eventRows, mapping); }
        catch { fail('INVALID_LEGACY_REVIEW_DATA'); }
        const scanTaskRows = tables.has('scan_tasks') ? rows(db, 'scan_tasks', legacyScanTask) : [];
        const scannerRunRows = tables.has('scanner_runs') ? rows(db, 'scanner_runs', legacyScannerRun) : [];
        let scanHistory: ReturnType<typeof prepareLegacyScanHistory>;
        try {
            const assets = new Map(assetPlan.assets.map(asset => [asset.id, asset.projectId]));
            scanHistory = prepareLegacyScanHistory(scannerRunRows, scanTaskRows, mapping, assets);
        } catch { fail('INVALID_LEGACY_SCAN_HISTORY'); }
        for (const { projectId, finding } of reviews.findings) {
            const legacy = finding.legacyScan;
            if (legacy && scanHistory.runs.get(legacy.scanId)?.projectId === projectId) legacy.hasArchivedRun = true;
        }
        const feedbackRows = tables.has('triage_feedback') ? rows(db, 'triage_feedback', legacyFeedback) : [];
        const suppressionRows = tables.has('rule_suppressions') ? rows(db, 'rule_suppressions', legacySuppression) : [];
        const suppressionEventRows = tables.has('rule_suppression_audit') ? rows(db, 'rule_suppression_audit', legacySuppressionEvent) : [];
        const triage = prepareLegacyTriage(feedbackRows, suppressionRows, suppressionEventRows, mapping);
        const agentRows = {
            runs: tables.has('agent_runs') ? rows(db, 'agent_runs', legacyAgentRun) : [],
            steps: tables.has('agent_steps') ? rows(db, 'agent_steps', legacyAgentStep) : [],
            references: tables.has('agent_step_references') ? rows(db, 'agent_step_references', legacyAgentReference) : [],
            results: tables.has('agent_step_results') ? rows(db, 'agent_step_results', legacyAgentResult) : []
        };
        const changeRows = tables.has('change_review_snapshots') ? rows(db, 'change_review_snapshots', legacyChangeReview) : [];
        let changeReviews: ReturnType<typeof prepareLegacyChangeReviews>;
        try { changeReviews = prepareLegacyChangeReviews(changeRows, mapping); }
        catch { fail('INVALID_LEGACY_CHANGE_REVIEW_DATA'); }
        const wikiRows = tables.has('summaries') ? rows(db, 'summaries', legacyWikiDocument) : [];
        let wiki: ReturnType<typeof prepareLegacyWikiDocuments>;
        try { wiki = prepareLegacyWikiDocuments(wikiRows, mapping); }
        catch { fail('INVALID_LEGACY_WIKI_DATA'); }
        const agents = prepareLegacyAgentRuns(agentRows, mapping, reviews.snapshots, changeReviews, new Set(wiki.map(doc => doc.projectId)));
        const ruleRows = {
            versions: tables.has('detection_rule_versions') ? rows(db, 'detection_rule_versions', legacyDetectionRule) : [],
            languages: tables.has('rule_languages') ? rows(db, 'rule_languages', legacyRuleLanguage) : [],
            frameworks: tables.has('rule_frameworks') ? rows(db, 'rule_frameworks', legacyRuleFramework) : [],
            samples: tables.has('rule_regression_samples') ? rows(db, 'rule_regression_samples', legacyRuleSample) : [],
            events: tables.has('detection_rule_audit') ? rows(db, 'detection_rule_audit', legacyRuleAudit) : [],
            evaluations: tables.has('rule_evaluations') ? rows(db, 'rule_evaluations', legacyRuleEvaluation) : []
        };
        let detectionRules: ReturnType<typeof prepareLegacyDetectionRules>;
        try { detectionRules = prepareLegacyDetectionRules(ruleRows, mapping); }
        catch { fail('INVALID_LEGACY_DETECTION_RULE_DATA'); }
        const unlinkedReviewRows = {
            scan_tasks: scanTaskRows.length - scanHistory.tasks.length,
            scanner_runs: scannerRunRows.length - scanHistory.storedRuns,
            external_findings: externalRows.length - reviews.findings.length,
            report_snapshots: snapshotRows.length - reviews.snapshots.length,
            review_queue_entries: entryRows.length - reviews.entries.length,
            review_queue_audit: eventRows.length - reviews.events.length,
            triage_feedback: feedbackRows.length - triage.feedback.length,
            rule_suppressions: suppressionRows.length - triage.suppressions.length,
            rule_suppression_audit: suppressionEventRows.length - triage.events.length,
            agent_runs: agentRows.runs.length - agents.histories.length,
            agent_steps: agentRows.steps.length - agents.steps,
            agent_step_references: agentRows.references.length - agents.references,
            agent_step_results: agentRows.results.length - agents.results,
            change_review_snapshots: changeRows.length - changeReviews.length,
            summaries: wikiRows.length - wiki.length,
            rule_languages: ruleRows.languages.length - detectionRules.languages,
            rule_frameworks: ruleRows.frameworks.length - detectionRules.frameworks,
            rule_regression_samples: ruleRows.samples.length - detectionRules.samples,
            detection_rule_audit: ruleRows.events.length - detectionRules.events.length,
            rule_evaluations: ruleRows.evaluations.length - detectionRules.evaluations.length
        };
        for (const [table, count] of Object.entries(unlinkedReviewRows)) if (count) skipped[table] = count;
        return {
            accounts, organizations, memberships, projects: [...projects.values()], projectOwners, audits, providers, advisories,
            vulnerabilities: vulnerabilities.records, reviews, triage, changeReviews, wiki, detectionRules, scanHistory,
            agentRuns: agents.histories, assets: assetPlan.assets,
            report: {
                migrated: { accounts: accounts.length, organizations: organizations.length, memberships: memberships.length,
                    projects: projects.size, projectOwners: projectOwners.length, auditEvents: audits.length,
                    modelProviders: providers.length, dependencyAdvisories: advisories.length,
                    vulnerabilityFindings: vulnerabilities.records.length, vulnerabilityEvidenceSteps: vulnerabilities.evidenceSteps,
                    externalFindings: reviews.findings.length, reviewSnapshots: reviews.snapshots.length,
                    scanTasks: scanHistory.tasks.length, scannerRuns: scanHistory.storedRuns, embeddedScannerRuns: scanHistory.embeddedRuns,
                    reviewEntries: reviews.entries.length, reviewEvents: reviews.events.length,
                    changeReviewSnapshots: changeReviews.length, wikiDocuments: wiki.length, agentRuns: agents.histories.length, agentSteps: agents.steps,
                    agentStepReferences: agents.references, agentStepResults: agents.results,
                    detectionRuleVersions: detectionRules.rules.length, detectionRuleAudit: detectionRules.events.length,
                    ruleLanguages: detectionRules.languages, ruleFrameworks: detectionRules.frameworks,
                    ruleRegressionSamples: detectionRules.samples, ruleEvaluations: detectionRules.evaluations.length,
                    triageFeedback: triage.feedback.length, ruleSuppressions: triage.suppressions.length,
                    ruleSuppressionEvents: triage.events.length, managedAssets: assetPlan.assets.length },
                skipped, projectsSkipped: projectSkips, assetsSkipped: assetPlan.skipped,
                unmappedProjectOwners: owners.filter(row => !mapping.has(row.project_id)).length,
                ownershipReview
            }
        };
    } finally { db.close(); }
}

type MigrationData = Awaited<ReturnType<typeof migrationData>>;

function writeData(target: string, data: MigrationData) {
    const db = new DatabaseSync(target, { enableForeignKeyConstraints: true });
    try {
        db.exec('BEGIN IMMEDIATE');
        const account = db.prepare(`
            INSERT INTO enterprise_account(id,username,display_name,email,role,status,credential_version,created_at,password_hash)
            VALUES (?,?,?,?,?,?,?,?,?)`);
        for (const row of data.accounts) account.run(row.id, row.username, row.display_name, row.email, row.role, row.status,
            row.credential_version, row.created_at, row.password_hash);
        const org = db.prepare('INSERT INTO enterprise_organization VALUES (?,?,?,?)');
        for (const row of data.organizations) org.run(row.id, row.name, row.active, row.created_at);
        const membership = db.prepare('INSERT INTO enterprise_membership VALUES (?,?)');
        for (const row of data.memberships) membership.run(row.organization_id, row.account_id);
        const project = db.prepare('INSERT INTO project(id,root) VALUES (?,?)');
        for (const row of data.projects) project.run(row.id, row.root);
        const asset = db.prepare(`INSERT INTO managed_asset(id,project_id,source_root,filename,archive_type,manifest,created_at)
            VALUES (?,?,?,?,?,?,?)`);
        for (const row of data.assets) asset.run(row.id, row.projectId, row.projectRoot, row.filename, row.archiveType,
            JSON.stringify(row.files.map(({ path, sizeBytes }) => ({ path, sizeBytes }))), row.createdAt);
        const owner = db.prepare('INSERT INTO enterprise_project_owner VALUES (?,?,?,?)');
        for (const row of data.projectOwners) owner.run(row.project_id, row.owner_type, row.owner_id, row.updated_at);
        const audit = db.prepare('INSERT INTO enterprise_audit VALUES (?,?,?,?,?,?)');
        for (const row of data.audits) audit.run(row.id, row.actor_id, row.action, row.target_id, row.reason, row.created_at);
        const reviewAudit = db.prepare(`INSERT INTO enterprise_audit(actor_id,action,target_id,reason,created_at)
            VALUES (?,'LEGACY_OWNER_REVIEW_REQUIRED',?,?,?)`);
        const reviewedAt = new Date().toISOString();
        for (const entry of data.report.ownershipReview) reviewAudit.run(ADMIN_ID, entry.projectId, entry.reason, reviewedAt);
        if (data.providers.length) {
            const secrets = new ProviderSecrets(target + '-provider-key', process.env.REPOGRAPH_PROVIDER_ENCRYPTION_KEY, true);
            db.exec('DELETE FROM model_provider');
            const insert = db.prepare('INSERT INTO model_provider VALUES (?,?,?,?,?)');
            for (const { config, apiKey, selected } of data.providers) {
                const credential = apiKey ? secrets.encrypt(providerBinding(config), apiKey) : '';
                insert.run(config.id, config.name, selected, credential, JSON.stringify(config));
            }
        }
        if (data.advisories.length) {
            db.exec('DELETE FROM dependency_advisory');
            restoreDependencyAdvisories(db, data.advisories);
        }
        if (data.reviews.findings.length) new ExternalFindings(db).restoreInMigrationTransaction(data.reviews.findings);
        if (data.scanHistory.tasks.length || data.scanHistory.runs.size) {
            new ScanHistory(db).restoreInMigrationTransaction(data.scanHistory.tasks, [...data.scanHistory.runs.values()]);
        }
        if (data.triage.feedback.length || data.triage.suppressions.length) new TriagePolicy(db).restoreInMigrationTransaction(data.triage);
        if (data.vulnerabilities.length || data.reviews.snapshots.length) {
            const inventory = new VulnerabilityInventory(db);
            inventory.restoreInMigrationTransaction(data.vulnerabilities, new Date().toISOString());
            const { snapshots, entries, events } = data.reviews;
            if (snapshots.length) new ReviewQueue(db, inventory).restoreInMigrationTransaction(snapshots, entries, events);
        }
        if (data.changeReviews.length) writeChangeSnapshots(db, data.changeReviews);
        if (data.wiki.length) restoreWikiDocuments(db, data.wiki);
        const rules = data.detectionRules;
        if (rules.rules.length || rules.evaluations.length) new DetectionRules(db).restoreInMigrationTransaction(rules.rules, rules.events, rules.evaluations);
        if (data.agentRuns.length) new AgentRuns(db).restoreInMigrationTransaction(data.agentRuns);
        db.exec('COMMIT');
    } finally { db.close(); }
}

function sealDatabase(target: string) {
    const db = new DatabaseSync(target);
    try {
        if (db.prepare('PRAGMA foreign_key_check').get()) fail('CONVERTED_DATABASE_INTEGRITY_FAILED');
        const checks = db.prepare('PRAGMA quick_check').all();
        if (checks.length !== 1 || checks[0].quick_check !== 'ok') fail('CONVERTED_DATABASE_INTEGRITY_FAILED');
        db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE');
    } finally { db.close(); }
}

async function publish(output: string, root: string, data: MigrationData) {
    try { await mkdir(output, { mode: 0o700 }); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('DESTINATION_EXISTS');
        throw error;
    }
    let stage: string | undefined;
    let createdAssetStorage = false;
    let publishedKey = false;
    let published = false;
    const destination = join(output, 'index.db');
    const assetRoot = destination + '-assets';
    const assetIndex = { ready: 0, partial: 0, failed: 0 };
    try {
        stage = await mkdtemp(join(output, '.migration-'));
        const target = join(stage, 'index.db');
        await writeFile(target, '', { flag: 'wx', mode: 0o600 });
        if (data.assets.length) {
            await mkdir(assetRoot, { mode: 0o700 });
            createdAssetStorage = true;
            for (const item of data.assets) {
                try { await copyLegacyAsset(item); }
                catch { fail('LEGACY_ASSET_COPY_FAILED'); }
            }
        }
        const storage = createdAssetStorage ? assetRoot : undefined;
        const repository = await RepositoryIndex.open(target, root, undefined, storage);
        await repository.close();
        writeData(target, data);
        if (data.assets.length) {
            const migrated = await RepositoryIndex.open(target, root, undefined, storage);
            try {
                for (const item of data.assets) {
                    const job = await migrated.assets.reindex(item.id, indexLanguages(), () => {});
                    await job.completion;
                    const asset = migrated.assets.find(item.id);
                    if (asset.status !== 'READY') assetIndex.failed++;
                    else if (asset.indexResult?.errors?.length) assetIndex.partial++;
                    else assetIndex.ready++;
                }
            } finally { await migrated.close(); }
        }
        sealDatabase(target);
        if (process.env.REPOGRAPH_PROVIDER_ENCRYPTION_KEY === undefined) {
            await link(target + '-provider-key', destination + '-provider-key');
            publishedKey = true;
        }
        await link(target, destination);
        published = true;
    } finally {
        if (stage) await rm(stage, { recursive: true, force: true });
        if (!published) {
            if (publishedKey) await rm(destination + '-provider-key');
            if (createdAssetStorage) await rm(assetRoot, { recursive: true, force: true });
            await rmdir(output);
        }
    }
    return { database: destination, assetIndex };
}

async function main() {
    const { values } = parseArgs({ options: { source: { type: 'string' }, output: { type: 'string' }, 'legacy-key-file': { type: 'string' },
        'projects-root': { type: 'string' }, 'legacy-assets-root': { type: 'string' },
        'dry-run': { type: 'boolean' }, help: { type: 'boolean' } } });
    if (values.help) { console.log(migrationUsage); return; }
    const root = values['projects-root'] ?? process.env.REPOGRAPH_PROJECTS_ROOT;
    if (!values.output || !root) fail('OUTPUT_AND_PROJECTS_ROOT_REQUIRED');
    const outputPath = resolve(values.output);
    const output = join(await realpath(dirname(outputPath)), basename(outputPath));
    try { await lstat(output); fail('DESTINATION_EXISTS'); }
    catch (error) { if (!missing(error)) throw error; }
    const projectsRoot = await realpath(root);
    if (!(await stat(projectsRoot)).isDirectory()) fail('INVALID_PROJECTS_ROOT');
    const source = await realpath(values.source ?? join(homedir(), '.repograph', 'index.db'));
    if (!(await stat(source)).isFile()) fail('INVALID_LEGACY_DATABASE');
    const key = values['legacy-key-file'];
    const keyPath = key ? await realpath(key) : join(dirname(source), 'provider-encryption-key');
    const assets = values['legacy-assets-root'] ?? join(homedir(), '.repograph', 'assets');
    const data = await migrationData(source, projectsRoot, keyPath, assets, join(output, 'index.db-assets'));
    const result = values['dry-run'] ? { database: null, assetIndex: null } : await publish(output, projectsRoot, data);
    console.log(JSON.stringify({ dryRun: !!values['dry-run'], ...result, ...data.report }, null, 2));
}

try { await main(); }
catch (error) {
    console.error(error instanceof MigrationError ? error.message : 'MIGRATION_FAILED');
    process.exitCode = 1;
}
