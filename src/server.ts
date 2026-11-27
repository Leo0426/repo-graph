import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { deviceRouteAllowed } from './device-authorization.js';
import { agentRunIdPattern } from './agent-runs.js';
import { handleAsk } from './ask-http.js';
import { architectureReview } from './architecture-review.js';
import { assetIdPattern, indexLanguages, indexStrategy } from './assets.js';
import { benchmarkEmbeddingHeader, benchmarkResultsPath, benchmarkSnapshot, readBenchmarkFile } from './benchmark.js';
import { configAudit, configAuditRequest } from './config-audit.js';
import { maxHostReportBytes } from './host-report-input.js';
import { threatReport, threatReportRequest } from './threat-report.js';
import type { GraphQuery } from './graph.js';
import { githubPullRequest, publishGithubTriage } from './github-comments.js';
import { changeReviewInput, compareChangeInput, compareChangeScopeInput, maxReviewRequestBytes, snapshotIdPattern, workingReviewInput } from './change-review.js';
import { changeReviewPlaybook, startChangeReviewInput } from './change-review-agent.js';
import { reviewFindingDecision } from './change-review-findings.js';
import { handleCollaboration, handleCollaborationAdmin } from './collaboration-http.js';
import type { DependencyScanResult } from './dependency-advisories.js';
import { ruleAction, ruleIdSchema, ruleInput } from './detection-rules.js';
import { scanHistoryId } from './scan-history.js';
import { startScanInput } from './scan-tasks.js';
import { reviewMarkdown } from './change-review-export.js';
import { readPayload } from './http-body.js';
import { handleGitEvent, handleGitSources } from './git-source-http.js';
import { findingReport } from './external-findings.js';
import type { FindingReport } from './external-findings.js';
import { findingBody, findingIntakeStatus, findingPublicText, isFindingFormat, maxFindingBody, maxFindingRows, normalizeFindings } from './finding-import.js';
import { exportReview, exportReviewBatch, reviewBatch, reviewFormat } from './review-export.js';
import { reviewAction, reviewStatuses, snapshotSelection } from './review-queue.js';
import type { ReviewAction } from './review-queue.js';
import { maxTriageFindings, sastTriagePlaybook } from './sast-triage-agent.js';
import { reviewFinding } from './triage-advisory.js';
import { declaredFindingVersion, feedbackInput, feedbackStatus, suppressionId, suppressionInput, suppressionRevoke } from './triage-policy.js';
import { vulnerabilityStatuses } from './vulnerability-inventory.js';
import { z } from 'zod';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { RepositoryIndex } from './index.js';
import { HttpError, send } from './http-error.js';
import { decideChangePatch, proposeChangePatch } from './change-patches.js';
import { entitlementSnapshot } from './hosted-entitlements.js';
import { IdentityHttp, requireAdmin } from './identity-http.js';
import { projectGrantRoles } from './identity.js';
import { isolatedVerificationPlaybook, isolatedVerificationReference, verificationInput } from './isolated-verifications.js';
import { knowledgeOpenInput, knowledgeSearchInput, openKnowledge, searchKnowledge } from './knowledge-search.js';
import { localIndexPlaybook } from './local-index-jobs.js';
import { modelUsageEvidence } from './model-usage.js';
import { gitChurn, packageGraph, sourceHotspots } from './metric-output.js';
import { handleMcpHttp, mcpHttpEnabled } from './mcp-http.js';
import { diagnosticReport } from './operability.js';
import { handleProviders } from './provider-http.js';
import { handleProjectSpaces } from './project-space-http.js';
import { projectLifecycleInput } from './project-retirement.js';
import { contextPack, graphRag } from './retrieval.js';
import { overlayPath } from './review-working-copy.js';
import { reviewRuleInput } from './review-rule-proposals.js';
import { scopedSearch, scopedSearchInput } from './scoped-retrieval.js';
import { cyclonedx, dependencyInventory } from './sbom.js';
import { serviceContract } from './service-contract.js';
import { kinds } from './source.js';
import { EmbeddingUnavailable, OllamaEmbedding } from './vector.js';
import { webAsset } from './web.js';
import { handleWikiPage } from './wiki-page-http.js';

const prefix = '/api/v1';
const vulnerabilitySeed = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{16}$/) });
const advisoryInput = vulnerabilitySeed.extend({ snapshotId: z.string().regex(agentRunIdPattern).optional() });
const jobActionInput = z.object({ action: z.enum(['pause', 'resume', 'cancel', 'prioritize']), revision: z.int().nonnegative(),
    priority: z.int().min(-10).max(10).optional() }).strict();
const snapshotAction = z.object({ action: z.enum(['retire', 'restore', 'purge']), revision: z.int().nonnegative() }).strict();
const assetDisplayName = z.string().trim().min(1).max(255).regex(/^[^\u0000-\u001f\u007f]+$/u);
const triageSelection = z.object({ fingerprints: z.array(vulnerabilitySeed.shape.fingerprint).min(1).max(maxTriageFindings) });
const vulnerabilityDecision = z.object({ status: z.enum(vulnerabilityStatuses), reason: z.string().max(500).optional(),
    revision: z.number().int().min(0).optional() });
const token = process.env.REPOGRAPH_ACCESS_TOKEN;
const projectsRoot = process.env.REPOGRAPH_PROJECTS_ROOT;
const port = Number(process.env.REPOGRAPH_PORT ?? '8080');

if (token !== undefined && !/^[A-Za-z0-9._~-]{24,256}$/.test(token)) {
    throw new Error('REPOGRAPH_ACCESS_TOKEN must contain 24–256 URL-safe characters');
}
if (!projectsRoot) throw new Error('REPOGRAPH_PROJECTS_ROOT is required');
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Invalid REPOGRAPH_PORT');

const database = resolve(process.env.REPOGRAPH_DB_PATH ?? join(homedir(), '.repograph', 'typescript', 'index.db'));
const benchmarkPath = benchmarkResultsPath(database);
const embedding = OllamaEmbedding.fromEnvironment(process.env);
const repository = await RepositoryIndex.open(database, projectsRoot, embedding,
    resolve(process.env.REPOGRAPH_ASSETS_ROOT ?? `${database}-assets`));
const hasAdminPassword = await repository.identity.initializeAdmin(process.env.REPOGRAPH_ADMIN_PASSWORD);
if (!token && !hasAdminPassword) throw new Error('Configure REPOGRAPH_ACCESS_TOKEN or REPOGRAPH_ADMIN_PASSWORD');
const auth = new IdentityHttp(repository.identity, token, repository.devices);
repository.wiki.start();
repository.changeReviewAgent.start();
repository.sastTriageAgent.start();
repository.gitSources.start();
repository.assets.startRecovery();
repository.snapshotRetirement.start();
repository.projectRetirement.start();
repository.ask.start();
repository.verifications.start();
repository.scans.start();
repository.localIndexes.start();
let stopping = false;

function value(query: URLSearchParams, key: string, required: true): string;
function value(query: URLSearchParams, key: string, required?: false): string | null;
function value(query: URLSearchParams, key: string, required = false) {
    const result = query.get(key);
    if ((result !== null && (result.length > 4096 || result.includes('\0')))
        || (required && !result?.trim())) throw new HttpError(400, `INVALID_${key.toUpperCase()}`);
    return result;
}

function int(query: URLSearchParams, key: string, fallback?: number, minimum = 1) {
    const raw = value(query, key);
    if (raw === null && fallback !== undefined) return fallback;
    const number = Number(raw);
    if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(number) || number < minimum) {
        throw new HttpError(400, `INVALID_${key.toUpperCase()}`);
    }
    return number;
}

function flag(query: URLSearchParams, key: string, fallback: boolean) {
    const raw = value(query, key);
    if (raw === null) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new HttpError(400, `INVALID_${key.toUpperCase()}`);
}

function projectId(query: URLSearchParams) {
    const id = value(query, 'projectId');
    if (id !== null && !/^[0-9a-f]{12}$/.test(id)) throw new HttpError(400, 'INVALID_PROJECT_ID');
    return id;
}

function cancelOnClose(response: ServerResponse) {
    const cancellation = new AbortController();
    response.once('close', () => cancellation.abort());
    return cancellation.signal;
}

function idempotencyKey(request: IncomingMessage) {
    const key = request.headers['idempotency-key'];
    if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9._~-]{1,128}$/.test(key))) {
        throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY');
    }
    return key;
}

function attachment(response: ServerResponse, type: string, filename: string, payload: Uint8Array) {
    response.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(payload);
}

async function handleHttpRequest(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && (url.pathname === '/livez' || url.pathname === '/readyz')) {
        const ready = url.pathname === '/livez' || (!stopping && repository.storageAvailable());
        send(response, ready ? 200 : 503, { status: ready ? 'ok' : 'unavailable' });
        return;
    }
    if (await webAsset(request, response, url)) return;
    if (await handleMcpHttp(request, response, url.pathname, auth, repository.identity)) return;
    if (await handleGitEvent(request, response, url, repository.gitSources, () => cancelOnClose(response))) return;
    if (await handleCollaboration(request, response, url, repository.collaboration)) return;
    if (await auth.authenticateRoute(request, response, url.pathname)) return;
    const principal = auth.principal(request);
    if (!principal) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        send(response, 401, { error: 'AUTHENTICATION_REQUIRED' });
        return;
    }
    auth.requireWrite(request, principal);
    const account = principal.account;
    if (account.deviceCredentialId && !deviceRouteAllowed(request.method, url.pathname)) throw new HttpError(403, 'DEVICE_SCOPE_DENIED');
    if (await auth.accountRoute(request, response, url, account, repository)) return;
    if (await handleProjectSpaces(request, response, url, account, repository, () => cancelOnClose(response))) return;
    if (await handleAsk(request, response, url, account, repository.ask, () => cancelOnClose(response))) return;
    if (await handleGitSources(request, response, url, account, repository.gitSources, () => cancelOnClose(response))) return;
    const visible = () => repository.identity.visibleProjects(account);
    const authorizeAdmin = () => requireAdmin(repository.identity.requireCurrent(account));
    if (await handleCollaborationAdmin(request, response, url, account, authorizeAdmin, repository.collaboration)) return;
    if (await handleProviders(request, response, url.pathname, repository.modelProviders, repository.generation, account.id,
        authorizeAdmin, () => cancelOnClose(response))) return;

    function requireProject(id: string | null) {
        if (id) repository.identity.requireAvailableProject(id);
        if (repository.identity.requireCurrent(account).role === 'ADMIN') return;
        const allowed = visible();
        if (allowed === null) return;
        if (!id) throw new HttpError(403, 'PROJECT_SCOPE_REQUIRED');
        if (!allowed.includes(id)) throw new HttpError(403, 'ACCESS_DENIED');
    }

    const query = url.searchParams;
    const authorizedSearch = url.pathname.startsWith(`${prefix}/search/authorized/`);
    const normalizedPath = authorizedSearch ? url.pathname.replace('/search/authorized/', '/search/') : url.pathname;
    const route = `${request.method} ${normalizedPath}`;
    function scopedProject() {
        const id = projectId(query);
        requireProject(id);
        return id;
    }
    function entryPoints(id: string | null) {
        requireProject(id);
        const offset = int(query, 'offset', 0, 0);
        if (offset > 20_000) throw new HttpError(400, 'INVALID_OFFSET');
        const language = value(query, 'lang')?.trim().toLowerCase() || null;
        return repository.entryPoints(id, language, Math.min(int(query, 'limit', 500), 500), offset);
    }
    function requestedProject() {
        const id = projectId(query);
        if (!id) throw new HttpError(400, 'INVALID_PROJECT_ID');
        requireProject(id);
        return id;
    }
    function editableProject(id = requestedProject()) {
        repository.identity.requireProjectEditor(account, id);
        return id;
    }
    function policyProject(bodyProjectId?: string) {
        const queryProjectId = projectId(query);
        if (queryProjectId && bodyProjectId && queryProjectId !== bodyProjectId) throw new HttpError(400, 'INVALID_PROJECT_ID');
        const id = queryProjectId ?? bodyProjectId;
        if (!id) throw new HttpError(400, 'INVALID_PROJECT_ID');
        requireProject(id);
        repository.projectRoot(id);
        return id;
    }
    function projectGuard(id: string, write = false) {
        const root = repository.projectRoot(id);
        return () => {
            if (write) editableProject(id);
            else requireProject(id);
            if (repository.projectRoot(id) !== root) throw new HttpError(409, 'PROJECT_ROOT_CHANGED');
        };
    }
    function canReadResource(resource: { projectId: string }) {
        const id = projectId(query);
        const allowed = visible();
        return repository.identity.projectAvailable(resource.projectId)
            && (!id || id === resource.projectId) && (allowed === null || allowed.includes(resource.projectId));
    }
    function canReadRun(run: { projectId: string; inputReference: string }) {
        const prefix = 'verified-change-review:';
        return canReadResource(run) && (!run.inputReference?.startsWith(prefix)
            || Boolean(repository.changeReviews.get(run.inputReference.slice(prefix.length), run.projectId)))
            && (!run.inputReference?.startsWith(isolatedVerificationReference) || repository.knowledgeSnapshots.get(
                run.inputReference.slice(isolatedVerificationReference.length))?.projectId === run.projectId);
    }
    function knowledgeSnapshot(id: string) {
        const snapshot = agentRunIdPattern.test(id) ? repository.knowledgeSnapshots.get(id) : undefined;
        if (!snapshot || !canReadResource(snapshot)) throw new HttpError(404, 'NOT_FOUND');
        return snapshot;
    }
    function requestedKnowledgeSnapshot() {
        return query.has('snapshotId') ? knowledgeSnapshot(value(query, 'snapshotId', true)) : undefined;
    }
    function wikiPerspective() {
        const perspective = value(query, 'perspective') ?? 'technical';
        if (perspective !== 'technical' && perspective !== 'business') throw new HttpError(400, 'WIKI_INVALID_PERSPECTIVE');
        return perspective;
    }
    function wikiPage(id: string) {
        const page = repository.wiki.getBase(id);
        if (!page || !canReadResource(page)) throw new HttpError(404, 'NOT_FOUND');
        const snapshot = requestedKnowledgeSnapshot();
        if (snapshot && page.knowledgeSnapshotId !== snapshot.id) throw new HttpError(404, 'NOT_FOUND');
        if (page.knowledgeSnapshotId && !snapshot) knowledgeSnapshot(page.knowledgeSnapshotId);
        if (query.has('perspective') && (page.perspective ?? 'technical') !== wikiPerspective()) throw new HttpError(404, 'NOT_FOUND');
        return page;
    }
    function wikiRevision() {
        const id = value(query, 'revisionId');
        if (id && !agentRunIdPattern.test(id)) throw new HttpError(400, 'WIKI_INVALID_REVISION');
        return id ?? undefined;
    }
    function visibleSnapshot(id: string) {
        const scope = repository.reviewQueue.scopeForSnapshot(id);
        return scope && canReadResource(scope) ? repository.reviewQueue.snapshot(id) : undefined;
    }
    function scanPage() {
        const bounded = (key: string, fallback: number, min: number, max: number) => {
            const raw = value(query, key);
            if (!raw) return fallback;
            const parsed = Number(raw);
            if (!/^[+-]?\d+$/.test(raw) || !Number.isSafeInteger(parsed)) throw new HttpError(400, 'INVALID_' + key.toUpperCase());
            return Math.min(Math.max(parsed, min), max);
        };
        return { page: bounded('page', 0, 0, 2_147_483_647), size: bounded('size', 50, 1, 200) };
    }
    async function readScan(id: string, format: string, limit: number) {
        if (!isFindingFormat(format)) throw new HttpError(400, 'UNSUPPORTED_FINDING_FORMAT');
        const body = await readPayload(request, findingBody, maxFindingBody, { allowSarif: format === 'sarif' || format === 'codeql' });
        if (response.destroyed) return;
        requireProject(id);
        const versions = { codeVersion: declaredFindingVersion(value(query, 'codeVersion')), ruleVersion: declaredFindingVersion(value(query, 'ruleVersion')) };
        return { parsed: normalizeFindings(format, body, repository.projectRoot(id), limit, versions),
            declared: { ...versions, format, execution: findingIntakeStatus(format, body) } };
    }
    function retrievalScope(snapshot?: NonNullable<ReturnType<RepositoryIndex['knowledgeSnapshots']['get']>>) {
        if (snapshot) return { id: snapshot.projectId, allowedProjects: () => { knowledgeSnapshot(snapshot.id); return null; } };
        const id = authorizedSearch ? null : scopedProject();
        return {
            id,
            allowedProjects: authorizedSearch ? visible : () => {
                requireProject(id);
                return id ? null : visible();
            }
        };
    }
    if (await handleWikiPage(request, response, url, account, repository.wiki.pages, wikiPage,
        () => idempotencyKey(request), () => cancelOnClose(response))) return;
    const usageEvidence = /^\/api\/v1\/admin\/entitlements\/([^/]+)\/model-invocations\/([^/]+)\/evidence$/.exec(url.pathname);
    if (repository.entitlements.enabled && usageEvidence && request.method === 'POST') {
        authorizeAdmin();
        const [, organizationId, invocationId] = usageEvidence;
        if (!agentRunIdPattern.test(organizationId) || !agentRunIdPattern.test(invocationId)) throw new HttpError(400, 'INVALID_MODEL_INVOCATION_ID');
        const input = await readPayload(request, modelUsageEvidence, 4096);
        if (response.destroyed) return;
        authorizeAdmin();
        send(response, 200, repository.modelUsage.reconcile(organizationId, invocationId, account.id, input));
        return;
    }
    const entitlementAdmin = /^\/api\/v1\/admin\/entitlements\/([^/]+)(?:\/tasks\/([^/]+)\/void)?$/.exec(url.pathname);
    if (repository.entitlements.enabled && entitlementAdmin && (entitlementAdmin[2] ? request.method === 'POST'
        : request.method === 'GET' || request.method === 'PUT')) {
        authorizeAdmin();
        const [, organizationId, taskId] = entitlementAdmin;
        if (!agentRunIdPattern.test(organizationId)) throw new HttpError(400, 'INVALID_ORGANIZATION_ID');
        if (taskId) {
            if (!agentRunIdPattern.test(taskId)) throw new HttpError(400, 'INVALID_RUN_ID');
            send(response, 200, repository.entitlements.voidPurgedTask(organizationId, taskId, account.id));
        } else if (request.method === 'GET') {
            send(response, 200, repository.entitlements.report(organizationId, Math.min(int(query, 'limit', 50), 200), int(query, 'offset', 0, 0)));
        } else {
            const input = await readPayload(request, entitlementSnapshot, 32_768);
            if (response.destroyed) return;
            authorizeAdmin();
            send(response, 200, repository.entitlements.publish(organizationId, account.id, input));
        }
        return;
    }
    switch (route) {
        case `GET ${prefix}/scanners/capabilities`: {
            const capabilities = await repository.scans.capabilities();
            if (response.destroyed) return;
            repository.identity.requireCurrent(account);
            send(response, 200, capabilities);
            return;
        }
        case `GET ${prefix}/health`: {
            const sqlite = repository.storageAvailable() ? 'ok' : 'error';
            const ollama = embedding ? (await embedding.available(cancelOnClose(response)) ? 'ok' : 'error') : 'disabled';
            if (response.destroyed) return;
            if (sqlite === 'ok') repository.identity.requireCurrent(account);
            const healthy = sqlite === 'ok' && ollama !== 'error';
            send(response, healthy ? 200 : 207, { status: healthy ? 'ok' : 'degraded', sqlite, ollama });
            return;
        }
        case `GET ${prefix}/admin/diagnostics`: {
            authorizeAdmin();
            const report = await diagnosticReport(repository, embedding, cancelOnClose(response));
            if (response.destroyed) return;
            authorizeAdmin();
            send(response, 200, report);
            return;
        }
        case `GET ${prefix}/admin/metrics`: {
            authorizeAdmin();
            send(response, 200, repository.operations.metrics.hourly(int(query, 'hours', 24)));
            return;
        }
        case `GET ${prefix}/admin/model-usage`: {
            authorizeAdmin();
            const runId = value(query, 'runId') ?? undefined;
            const organizationId = value(query, 'organizationId') ?? undefined;
            if (runId && !agentRunIdPattern.test(runId)) throw new HttpError(400, 'INVALID_RUN_ID');
            if (organizationId && !agentRunIdPattern.test(organizationId)) throw new HttpError(400, 'INVALID_ORGANIZATION_ID');
            send(response, 200, repository.modelUsage.list(Math.min(int(query, 'limit', 50), 200), int(query, 'offset', 0, 0),
                runId, organizationId));
            return;
        }
        case `POST ${prefix}/config-audit/reports`: {
            const input = await readPayload(request, configAuditRequest, maxHostReportBytes);
            if (response.destroyed) return;
            repository.identity.requireCurrent(account);
            send(response, 200, configAudit(input));
            return;
        }
        case `POST ${prefix}/threat-detection/reports`: {
            const input = await readPayload(request, threatReportRequest, maxHostReportBytes);
            if (response.destroyed) return;
            repository.identity.requireCurrent(account);
            send(response, 200, threatReport(input));
            return;
        }
        case `GET ${prefix}/benchmark/results`: {
            let document: unknown;
            try { document = await readBenchmarkFile(benchmarkPath); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'BENCHMARK_RESULTS_NOT_FOUND');
                throw new HttpError(500, 'INVALID_BENCHMARK_RESULTS');
            }
            const snapshot = benchmarkSnapshot.safeParse(document);
            if (!snapshot.success) throw new HttpError(500, 'INVALID_BENCHMARK_RESULTS');
            repository.identity.requireCurrent(account);
            const allowed = visible();
            if ((snapshot.data.projectId && (!repository.identity.projectAvailable(snapshot.data.projectId)
                || (allowed && !allowed.includes(snapshot.data.projectId)))) || (!snapshot.data.projectId && account.role !== 'ADMIN')) {
                throw new HttpError(404, 'BENCHMARK_RESULTS_NOT_FOUND');
            }
            send(response, 200, snapshot.data);
            return;
        }
        case `GET ${prefix}/flow/analyze`: {
            const result = repository.flow(value(query, 'target', true), scopedProject());
            if (!result) throw new HttpError(404, 'FLOW_TARGET_UNAVAILABLE');
            send(response, 200, result);
            return;
        }
        case `GET ${prefix}/flow/taint`: {
            const result = repository.traceTaint(value(query, 'source', true), scopedProject(),
                int(query, 'paramIndex', 0, 0), Math.min(int(query, 'maxDepth', 6), 15));
            if (!result) throw new HttpError(404, 'FLOW_TARGET_UNAVAILABLE');
            send(response, 200, result);
            return;
        }
        case `GET ${prefix}/projects`: {
            const summary = flag(query, 'summary', false);
            const projects = repository.projects(visible(), summary);
            send(response, 200, summary ? projects.map(project => ({ ...project,
                canManage: repository.identity.projectCapabilities(account, project.projectId).canManage })) : projects);
            return;
        }
        case `GET ${prefix}/projects/trash`:
            send(response, 200, repository.projectRetirement.list(account, Math.min(int(query, 'limit', 50, 1), 100), int(query, 'offset', 0, 0)));
            return;
        case `GET ${prefix}/capabilities`: {
            const verifier = await repository.verifications.capability();
            if (response.destroyed) return;
            repository.identity.requireCurrent(account);
            send(response, 200, serviceContract(embedding !== undefined, { deviceAuthorization: !!repository.devices,
                mcpHttp: mcpHttpEnabled, collaborationIngress: !!repository.collaboration, externalIdentity: repository.identity.external.enabled,
                isolatedVerification: verifier.available }));
            return;
        }
        case `GET ${prefix}/verifications/capability`: {
            const capability = await repository.verifications.capability();
            if (response.destroyed) return;
            repository.identity.requireCurrent(account);
            send(response, 200, capability);
            return;
        }
        case `POST ${prefix}/verifications`: {
            const key = idempotencyKey(request);
            if (!key) throw new HttpError(400, 'VERIFICATION_IDEMPOTENCY_KEY_REQUIRED');
            const input = await readPayload(request, verificationInput, 96 * 1024);
            if (response.destroyed) return;
            const task = await repository.verifications.submit(account, key, input, cancelOnClose(response));
            if (response.destroyed) return;
            response.setHeader('Location', task.pollVia);
            send(response, 202, task);
            return;
        }
        case `GET ${prefix}/knowledge-snapshots`:
            send(response, 200, repository.knowledgeSnapshots.list(requestedProject(),
                Math.min(int(query, 'limit', 50), 100), int(query, 'offset', 0, 0)));
            return;
        case `GET ${prefix}/knowledge-snapshots/retired`:
            send(response, 200, repository.snapshotRetirement.retired(account, requestedProject(),
                Math.min(int(query, 'limit', 50), 100), int(query, 'offset', 0, 0)));
            return;
        case `POST ${prefix}/summaries/generate`: {
            const id = editableProject();
            const name = repository.gitSources.name(id) ?? (basename(repository.projectRoot(id)) || id);
            const key = idempotencyKey(request);
            const notBefore = value(query, 'notBefore');
            const date = notBefore === null ? undefined : z.iso.datetime({ offset: true }).safeParse(notBefore);
            const availableAt = date?.success ? Date.parse(date.data) : undefined;
            if (date && (availableAt === undefined || !Number.isSafeInteger(availableAt))) throw new HttpError(400, 'INVALID_NOT_BEFORE');
            const mode = value(query, 'mode') ?? 'incremental';
            if (mode !== 'full' && mode !== 'incremental') throw new HttpError(400, 'INVALID_SNAPSHOT_MODE');
            const task = repository.wiki.submit(id, name, account, key, availableAt, mode);
            response.setHeader('Location', task.pollVia);
            send(response, 202, task);
            return;
        }
        case `GET ${prefix}/summaries`:
        case `GET ${prefix}/summaries/tree`: {
            const snapshot = requestedKnowledgeSnapshot();
            const id = snapshot?.projectId ?? requestedProject();
            const perspective = wikiPerspective();
            send(response, 200, url.pathname.endsWith('/tree')
                ? repository.wiki.tree(id, snapshot?.runId, perspective)
                : repository.wiki.latest(id, snapshot?.runId, perspective));
            return;
        }
        case `GET ${prefix}/summaries/search`: {
            const snapshot = requestedKnowledgeSnapshot();
            const id = snapshot?.projectId ?? requestedProject();
            const release = snapshot ?? repository.knowledgeSnapshots.list(id, 1, 0)[0];
            const perspective = wikiPerspective();
            const text = value(query, 'q', true);
            const found = release ? repository.wiki.pages.search(id, release.id, perspective, text, Math.min(int(query, 'limit', 12), 30)) : [];
            send(response, 200, flag(query, 'compact', false) ? found.map(({ id, title, revision, perspective, knowledgeSnapshotId }) =>
                ({ id, title, revision, perspective, knowledgeSnapshotId })) : found);
            return;
        }
        case `GET ${prefix}/agent-runs`:
            send(response, 200, repository.agentRuns.list(requestedProject(), Math.min(int(query, 'limit', 20), 100), value(query, 'playbook'))
                .filter(canReadRun));
            return;
        case `GET ${prefix}/rules`: {
            const filter = value(query, 'ruleId')?.trim() || null;
            if (filter && !ruleIdSchema.safeParse(filter).success) throw new HttpError(400, 'INVALID_RULE_ID');
            send(response, 200, repository.detectionRules.list(filter, Math.min(int(query, 'limit', 100), 500), int(query, 'offset', 0, 0)));
            return;
        }
        case `POST ${prefix}/rules`: {
            authorizeAdmin();
            const input = await readPayload(request, ruleInput, 512 * 1024);
            if (response.destroyed) return;
            authorizeAdmin();
            send(response, 200, repository.detectionRules.create(input, account.username));
            return;
        }
        case `POST ${prefix}/change-rule-candidates`: {
            authorizeAdmin();
            const id = requestedProject();
            const key = idempotencyKey(request);
            if (!key) throw new HttpError(400, 'REVIEW_RULE_IDEMPOTENCY_KEY_REQUIRED');
            const input = await readPayload(request, reviewRuleInput, 512 * 1024);
            if (response.destroyed) return;
            authorizeAdmin();
            send(response, 200, repository.reviewRuleProposals.propose(account, id, key, input));
            return;
        }
        case `POST ${prefix}/agent-runs/sast-triage`: {
            const id = editableProject();
            const authorize = projectGuard(id, true);
            const common = { projectId: id, budgetChars: Math.min(int(query, 'budgetChars', 12_000), 60_000) };
            const key = idempotencyKey(request);
            const format = value(query, 'format')?.trim().toLowerCase();
            if (format) {
                if (!isFindingFormat(format)) throw new HttpError(400, 'UNSUPPORTED_FINDING_FORMAT');
                const scan = (await readScan(id, format, Math.min(int(query, 'maxFindings', 10), maxTriageFindings)))?.parsed;
                if (!scan) return;
                authorize();
                send(response, 202, repository.sastTriageAgent.submit({ ...common, source: { capability: 'IMPORT_FINDINGS', format, scan } }, account, key));
            } else {
                const input = await readPayload(request, triageSelection, 4096);
                if (response.destroyed) return;
                authorize();
                const findings = [...new Set(input.fingerprints)].map(fingerprint => {
                    const finding = repository.externalFindings.get(id, fingerprint);
                    if (!finding) throw new HttpError(404, 'EXTERNAL_FINDING_NOT_FOUND');
                    return finding;
                });
                send(response, 202, repository.sastTriageAgent.submit({ ...common, source: { capability: 'LOAD_FINDINGS', findings } }, account, key));
            }
            return;
        }
        case `POST ${prefix}/agent-runs/vulnerability-triage`: {
            const id = value(query, 'vulnerabilityId', true);
            const vulnerability = /^[a-f0-9]{16}$/.test(id) ? repository.vulnerabilities.get(id) : undefined;
            if (!vulnerability || !canReadResource(vulnerability)) throw new HttpError(404, 'VULNERABILITY_NOT_FOUND');
            const { projectId } = vulnerability;
            editableProject(projectId);
            const codeVersion = declaredFindingVersion(value(query, 'codeVersion') ?? vulnerability.codeVersion);
            const ruleVersion = declaredFindingVersion(value(query, 'ruleVersion') ?? vulnerability.ruleVersion);
            send(response, 202, repository.sastTriageAgent.submit({ projectId,
                budgetChars: Math.min(int(query, 'budgetChars', 12_000), 60_000), source: {
                    capability: 'LOAD_VULNERABILITY', vulnerability, codeVersion, ruleVersion
                } }, account, idempotencyKey(request)));
            return;
        }
        case `GET ${prefix}/vulns`: {
            const id = requestedProject();
            const severity = value(query, 'severity')?.trim().toUpperCase() || null;
            const status = value(query, 'status')?.trim().toUpperCase() || null;
            if (status && !vulnerabilityStatuses.some(candidate => candidate === status)) throw new HttpError(400, 'INVALID_VULNERABILITY_STATUS');
            if (severity && !['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN'].includes(severity)) throw new HttpError(400, 'INVALID_FINDING_SEVERITY');
            send(response, 200, repository.vulnerabilities.list(id, severity, status, Math.min(int(query, 'limit', 100), 500),
                Math.min(int(query, 'offset', 0, 0), 50_000)));
            return;
        }
        case `POST ${prefix}/vulns/from-finding`: {
            const id = editableProject();
            const input = await readPayload(request, vulnerabilitySeed, 4096);
            if (response.destroyed) return;
            editableProject(id);
            const finding = repository.externalFindings.get(id, input.fingerprint);
            if (!finding) throw new HttpError(404, 'EXTERNAL_FINDING_NOT_FOUND');
            repository.projectRoot(id);
            const evidence = findingReport(repository, id, finding, 4000).report;
            send(response, 200, repository.vulnerabilities.addSuspected(id, evidence, account.username));
            return;
        }
        case `POST ${prefix}/vulns/scan/code`:
        case `POST ${prefix}/vulns/scan/taint`: {
            const id = editableProject();
            const indexVersion = value(query, 'indexVersion');
            if (indexVersion !== null && !/^[a-f0-9]{64}$/.test(indexVersion)) throw new HttpError(400, 'INVALID_INDEX_VERSION');
            const offset = int(query, 'offset', 0, 0);
            const result = route.endsWith('/taint') ? repository.scanTaint(id, offset, indexVersion, account.username)
                : repository.scanCode(id, offset, indexVersion, account.username);
            send(response, 200, result);
            return;
        }
        case `POST ${prefix}/vulns/scan/deps`: {
            const id = editableProject();
            const root = repository.projectRoot(id);
            const suppliedRoot = value(query, 'projectRoot');
            if (suppliedRoot !== null && suppliedRoot !== root) throw new HttpError(400, 'PROJECT_ROOT_MISMATCH');
            const inventory = await dependencyInventory(root);
            if (response.destroyed) return;
            editableProject(id);
            if (repository.projectRoot(id) !== root) throw new HttpError(409, 'PROJECT_ROOT_CHANGED');
            if (!inventory.available) throw new HttpError(400, inventory.supported || inventory.issues.length
                ? 'DEPENDENCY_INVENTORY_UNAVAILABLE' : 'NO_SUPPORTED_MANIFEST');
            const { matches, ...summary } = repository.dependencyAdvisories.match(inventory);
            const recorded = repository.vulnerabilities.recordDependencyMatches(id, matches, account.username);
            send(response, 200, { projectId: id, ...summary, ...recorded, matchedFindings: matches.length } satisfies DependencyScanResult);
            return;
        }
        case `GET ${prefix}/scan-tasks`:
        case `GET ${prefix}/scans`: {
            const id = requestedProject();
            const { page, size } = scanPage();
            const history = repository.scanHistory;
            send(response, 200, route === `GET ${prefix}/scan-tasks` ? history.listTasks(id, page, size) : history.listRuns(id, page, size));
            return;
        }
        case `GET ${prefix}/review-queue`: {
            const id = requestedProject();
            const page = Math.min(int(query, 'page', 0, 0), 100_000);
            const size = Math.min(int(query, 'size', 100), 500);
            const status = value(query, 'status')?.trim().toUpperCase() || null;
            if (status && !reviewStatuses.some(value => value === status)) throw new HttpError(400, 'INVALID_REVIEW_STATUS');
            const timestamp = (key: string) => {
                const raw = value(query, key);
                if (!raw) return null;
                const millis = Date.parse(raw);
                if (!Number.isFinite(millis)) throw new HttpError(400, 'INVALID_REVIEW_TIMESTAMP');
                return new Date(millis).toISOString();
            };
            send(response, 200, repository.reviewQueue.list(id, { status, severity: value(query, 'severity')?.toUpperCase() || null,
                verdict: value(query, 'verdict')?.toUpperCase() || null, ruleId: value(query, 'ruleId'),
                updatedAfter: timestamp('updatedAfter'), updatedBefore: timestamp('updatedBefore') }, page, size));
            return;
        }
        case `POST ${prefix}/review-queue/snapshots`: {
            const id = editableProject();
            const format = value(query, 'format')?.trim().toLowerCase();
            const budget = Math.min(int(query, 'budgetChars', 12_000), 60_000);
            let findings;
            if (format) {
                const scan = (await readScan(id, format, Math.min(int(query, 'maxFindings', 10), 100)))?.parsed;
                if (!scan) return;
                findings = scan.findings;
            } else {
                const selected = await readPayload(request, snapshotSelection, 16_384);
                if (response.destroyed) return;
                requireProject(id);
                repository.projectRoot(id);
                findings = [...new Set(selected.fingerprints)].map(fingerprint => {
                    const finding = repository.externalFindings.get(id, fingerprint);
                    if (!finding) throw new HttpError(404, 'EXTERNAL_FINDING_NOT_FOUND');
                    return finding;
                });
            }
            const reports = findings.map(finding => findingReport(repository, id, finding, budget).report);
            editableProject(id);
            send(response, 200, repository.reviewQueue.submit(id, account.username, reports));
            return;
        }
        case `POST ${prefix}/review-queue/snapshots/export-batch`: {
            const input = await readPayload(request, reviewBatch, 16_384);
            if (response.destroyed) return;
            const { zip, included } = await exportReviewBatch(input.snapshotIds, input.format, visibleSnapshot);
            if (response.destroyed) return;
            if (included.some(scope => !canReadResource(scope))) throw new HttpError(403, 'ACCESS_DENIED');
            attachment(response, 'application/zip', 'snapshots-export.zip', zip);
            return;
        }
        case `POST ${prefix}/triage/feedback`: {
            const input = await readPayload(request, feedbackInput, 8192);
            if (response.destroyed) return;
            send(response, 200, repository.triagePolicy.record(editableProject(policyProject(input.projectId)), account.username, input));
            return;
        }
        case `GET ${prefix}/triage/feedback`: {
            const id = policyProject();
            const status = value(query, 'status')?.trim().toUpperCase() || null;
            const filter = feedbackStatus.safeParse(status);
            if (status && !filter.success) throw new HttpError(400, 'INVALID_FEEDBACK_STATUS');
            send(response, 200, repository.triagePolicy.listFeedback(id, filter.success ? filter.data : null));
            return;
        }
        case `POST ${prefix}/triage/suppressions`: {
            const input = await readPayload(request, suppressionInput, 8192);
            if (response.destroyed) return;
            send(response, 200, repository.triagePolicy.create(editableProject(policyProject(input.projectId)), account.username, input));
            return;
        }
        case `GET ${prefix}/triage/suppressions`: {
            send(response, 200, repository.triagePolicy.listSuppressions(policyProject(), value(query, 'ruleId')?.trim() || null));
            return;
        }
        case `POST ${prefix}/triage/findings/import`:
        case `POST ${prefix}/triage/report`:
        case `POST ${prefix}/triage/report/pr`: {
            const id = requestedProject();
            const format = value(query, 'format', true).trim().toLowerCase();
            const importing = url.pathname.endsWith('/import');
            const publishing = url.pathname.endsWith('/pr');
            if (importing) editableProject(id);
            if (publishing) authorizeAdmin();
            const authorize = publishing ? projectGuard(id) : undefined;
            const target = publishing ? githubPullRequest(value(query, 'owner', true), value(query, 'repo', true), int(query, 'prNumber')) : undefined;
            const limit = importing ? Math.min(int(query, 'maxFindings', maxFindingRows), maxFindingRows)
                : Math.min(int(query, 'maxFindings', 10), 100);
            const report = await readScan(id, format, limit);
            if (!report) return;
            const { parsed, declared } = report;
            if (importing) send(response, 200, repository.externalFindings.import(editableProject(id), parsed, declared));
            else {
                const budget = Math.min(int(query, 'budgetChars', 12_000), 60_000);
                const reports = parsed.findings.map(finding => findingReport(repository, id, finding, budget));
                if (!target) send(response, 200, reports);
                else {
                    const authorizePublish = () => { authorizeAdmin(); authorize?.(); };
                    authorizePublish();
                    const commentUrl = await publishGithubTriage(target, reports, authorizePublish, cancelOnClose(response));
                    if (!response.destroyed) send(response, 200, { commentUrl, findingsCount: reports.length, reports });
                }
            }
            return;
        }
        case `GET ${prefix}/triage/variants`: {
            const id = requestedProject();
            const result = repository.vulnerabilityVariants(id, Math.min(int(query, 'limit', 100, 0), 500));
            if (result.truncated) response.setHeader('X-RepoGraph-Variant-Partial', 'true');
            send(response, 200, result.candidates);
            return;
        }
        case `GET ${prefix}/triage/findings`: {
            const id = requestedProject();
            const offset = Math.min(int(query, 'offset', 0, 0), 50_000);
            const severity = value(query, 'severity')?.toUpperCase() || null;
            if (severity && !['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN'].includes(severity)) {
                throw new HttpError(400, 'INVALID_FINDING_SEVERITY');
            }
            send(response, 200, repository.externalFindings.list(id, value(query, 'tool')?.trim() || null, severity,
                Math.min(int(query, 'limit', 25), 100), offset));
            return;
        }
        case `POST ${prefix}/triage/advisory`: {
            const id = requestedProject();
            const authorize = projectGuard(id);
            const format = value(query, 'format')?.trim().toLowerCase();
            const budget = Math.min(int(query, 'budgetChars', 12_000), 60_000);
            let baseline: FindingReport;
            let frozenId: string | undefined;
            if (format) {
                const scan = (await readScan(id, format, 1))?.parsed;
                if (!scan) return;
                if (scan.reported !== 1 || scan.findings.length !== 1) throw new HttpError(400, 'ADVISORY_SINGLE_FINDING_REQUIRED');
                baseline = findingReport(repository, id, scan.findings[0], budget).report;
            } else {
                const input = await readPayload(request, advisoryInput, 4096);
                if (response.destroyed) return;
                requireProject(id);
                frozenId = input.snapshotId;
                if (frozenId) {
                    const snapshot = visibleSnapshot(frozenId);
                    if (!snapshot) throw new HttpError(404, 'REVIEW_SNAPSHOT_NOT_FOUND');
                    const reports = snapshot.reports.filter(report => report.finding.fingerprint === input.fingerprint);
                    if (reports.length !== 1) throw new HttpError(409, 'REVIEW_FINDING_MISSING');
                    [baseline] = reports;
                } else {
                    const finding = repository.externalFindings.get(id, input.fingerprint);
                    if (!finding) throw new HttpError(404, 'EXTERNAL_FINDING_NOT_FOUND');
                    baseline = findingReport(repository, id, finding, budget).report;
                }
            }
            authorize();
            const advisory = await reviewFinding(() => repository.generation.session(), baseline, cancelOnClose(response), undefined,
                { projectId: id, actorId: account.id });
            if (response.destroyed) return;
            authorize();
            if (frozenId && !visibleSnapshot(frozenId)) throw new HttpError(404, 'REVIEW_SNAPSHOT_NOT_FOUND');
            send(response, 200, advisory);
            return;
        }
        case `POST ${prefix}/architecture/reviews`:
        case `GET ${prefix}/architecture/reviews/stream`: {
            const id = requestedProject();
            const signal = cancelOnClose(response);
            const stream = request.method === 'GET';
            const event = (name: string, data: unknown) => response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
            try {
                const result = await architectureReview(repository, repository.generation, id, signal, () => requireProject(id),
                    stream ? () => {
                        if (response.destroyed) return;
                        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
                            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
                        event('phase', { phase: 'EVIDENCE_READY' });
                    } : undefined, account.id);
                if (response.destroyed) return;
                if (!stream) send(response, 200, result);
                else {
                    for (const candidate of result.candidates) event('delta', candidate);
                    event('result', result);
                    event('complete', { status: result.status });
                    response.end();
                }
            } catch (error) {
                if (response.destroyed) return;
                if (!response.headersSent) throw error;
                event('stream-error', { message: error instanceof HttpError ? error.message : 'ARCHITECTURE_STREAM_FAILED' });
                response.end();
            }
            return;
        }
        case `POST ${prefix}/change-reviews/compare`: {
            const input = await readPayload(request, compareChangeInput, 8192);
            if (response.destroyed) return;
            editableProject(input.projectId);
            const requested = projectId(query);
            if (requested !== null && requested !== input.projectId) throw new HttpError(400, 'PROJECT_ID_MISMATCH');
            const key = idempotencyKey(request);
            if (!key) throw new HttpError(400, 'CHANGE_REVIEW_IDEMPOTENCY_KEY_REQUIRED');
            send(response, 200, repository.changeReviews.compare(account.id, key, input));
            return;
        }
        case `POST ${prefix}/change-reviews/compare-scope`: {
            const key = idempotencyKey(request);
            if (!key) throw new HttpError(400, 'CHANGE_REVIEW_IDEMPOTENCY_KEY_REQUIRED');
            const input = await readPayload(request, compareChangeScopeInput, 256 * 1024);
            if (!response.destroyed) send(response, 200, repository.changeReviews.compareScope(account, key, input));
            return;
        }
        case `POST ${prefix}/change-reviews/working-copy`: {
            const key = idempotencyKey(request);
            if (!key) throw new HttpError(400, 'CHANGE_REVIEW_IDEMPOTENCY_KEY_REQUIRED');
            const input = await readPayload(request, workingReviewInput, 128 * 1024);
            if (response.destroyed) return;
            const snapshot = await repository.changeReviews.compareWorking(account, key, input, cancelOnClose(response));
            if (!response.destroyed) send(response, 200, snapshot);
            return;
        }
        case `POST ${prefix}/change-reviews`: {
            const input = await readPayload(request, changeReviewInput, maxReviewRequestBytes);
            if (response.destroyed) return;
            editableProject(input.projectId);
            const requested = projectId(query);
            if (requested !== null && requested !== input.projectId) throw new HttpError(400, 'PROJECT_ID_MISMATCH');
            send(response, 200, repository.changeReviews.submit(input));
            return;
        }
        case `POST ${prefix}/agent-runs/change-review`: {
            const input = await readPayload(request, startChangeReviewInput, maxReviewRequestBytes);
            if (response.destroyed) return;
            editableProject(input.projectId);
            const requested = projectId(query);
            if (requested !== null && requested !== input.projectId) throw new HttpError(400, 'PROJECT_ID_MISMATCH');
            const run = repository.changeReviewAgent.submit(account, input, idempotencyKey(request));
            send(response, 202, run);
            return;
        }
        case `GET ${prefix}/watch`:
            send(response, 200, repository.watches.list(visible()));
            return;
        case `POST ${prefix}/watch`: {
            requireAdmin(account);
            const id = projectId(query);
            if (!id) throw new HttpError(400, 'INVALID_PROJECT_ID');
            await repository.startWatch(id, value(query, 'root', true), authorizeAdmin);
            send(response, 200, { status: 'watching', projectId: id });
            return;
        }
        case `GET ${prefix}/graph/symbols`: {
            const name = value(query, 'q', true).trim();
            send(response, 200, repository.graphSymbols(name, scopedProject(), Math.min(int(query, 'limit', 10), 50)));
            return;
        }
        case `GET ${prefix}/graph/entrypoints`:
            send(response, 200, entryPoints(projectId(query)));
            return;
        case `GET ${prefix}/graph/deadcode`:
        case `GET ${prefix}/graph/testgaps`: {
            const id = requestedProject();
            const limit = Math.min(int(query, 'limit', 200), 500);
            const offset = int(query, 'offset', 0, 0);
            send(response, 200, repository.metrics.diagnostics(id, url.pathname.endsWith('/deadcode') ? 'deadCode' : 'testGaps', limit, offset));
            return;
        }
        case `GET ${prefix}/metrics/complexity`:
            send(response, 200, repository.metrics.complexity(requestedProject(), Math.min(int(query, 'limit', 20), 100)));
            return;
        case `GET ${prefix}/metrics/coupling`: {
            const id = requestedProject();
            const sort = value(query, 'sort')?.toLowerCase() ?? 'fanout';
            if (sort !== 'fanin' && sort !== 'fanout') throw new HttpError(400, 'INVALID_METRIC_SORT');
            const { coupling } = repository.metrics.dependencies(id);
            const direction = sort === 'fanin' ? 'fanIn' : 'fanOut';
            const secondary = direction === 'fanIn' ? 'fanOut' : 'fanIn';
            coupling.sort((a, b) => b[direction] - a[direction] || b[secondary] - a[secondary]
                || a.classQualifiedName.localeCompare(b.classQualifiedName) || a.filePath.localeCompare(b.filePath));
            send(response, 200, coupling.slice(0, Math.min(int(query, 'limit', 20), 100)));
            return;
        }
        case `GET ${prefix}/metrics/cycles`:
            send(response, 200, repository.metrics.dependencies(requestedProject()).cycles);
            return;
        case `GET ${prefix}/metrics/report`: {
            const id = requestedProject();
            repository.projectRoot(id);
            send(response, 200, repository.metrics.report(id, repository.projectStats(id)));
            return;
        }
        case `GET ${prefix}/metrics/hotspots`: {
            const id = requestedProject();
            const limit = Math.min(int(query, 'limit', 10), 50);
            const root = repository.projectRoot(id);
            const churn = (repository.assets.forProject(id) || repository.gitSources.name(id)) ? new Map<string, number>()
                : await gitChurn(root, cancelOnClose(response));
            if (response.destroyed) return;
            requireProject(id);
            if (repository.projectRoot(id) !== root) throw new HttpError(409, 'PROJECT_ROOT_CHANGED');
            send(response, 200, churn.size ? sourceHotspots(repository.metrics.complexity(id), churn, limit) : []);
            return;
        }
        case `GET ${prefix}/export/graph`: {
            const id = requestedProject();
            const format = value(query, 'format')?.toLowerCase() ?? 'dot';
            if (format !== 'dot' && format !== 'mermaid') throw new HttpError(400, 'INVALID_GRAPH_FORMAT');
            const { edges } = repository.metrics.dependencies(id);
            response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff' }).end(packageGraph(id, edges, format));
            return;
        }
        case `GET ${prefix}/graph/callers`:
        case `GET ${prefix}/graph/callees`:
        case `GET ${prefix}/graph/impact`:
        case `GET ${prefix}/graph/subtypes`: {
            const operation = url.pathname.slice(`${prefix}/graph/`.length) as GraphQuery;
            const requestedDepth = value(query, 'depth') === '0' ? 0 : Math.min(int(query, 'depth', 3), 12);
            const depth = operation === 'subtypes' ? 1 : operation === 'impact' ? 12 : requestedDepth;
            const target = value(query, 'target', true);
            const snapshot = requestedKnowledgeSnapshot();
            const project = snapshot ? snapshot.projectId : scopedProject();
            send(response, 200, flag(query, 'diagram', false)
                ? repository.traverseView(target, project, operation, depth, snapshot?.id)
                : repository.traverse(target, project, operation, depth, snapshot?.id));
            return;
        }
        case `POST ${prefix}/index/project`: {
            requireAdmin(account);
            const root = value(query, 'projectRoot', true);
            const languages = indexLanguages(value(query, 'lang'), flag(query, 'includeBytecode', false));
            const submitted = await repository.submitIndex(root, languages, !flag(query, 'noIncremental', false), indexStrategy(value(query, 'strategy')),
                account, idempotencyKey(request), cancelOnClose(response));
            const pollUrl = `${prefix}/index/project/status?${new URLSearchParams({ projectRoot: submitted.root })}`;
            if (!response.destroyed) send(response, 202, { status: 'running', message: 'Indexing started in background', pollUrl,
                projectId: submitted.projectId, agentRunId: submitted.agentRunId });
            return;
        }
        case `POST ${prefix}/index/file`: {
            requireAdmin(account);
            const result = await repository.indexFile(value(query, 'projectRoot', true), value(query, 'file', true),
                !flag(query, 'noIncremental', false), authorizeAdmin, indexStrategy(value(query, 'strategy')));
            authorizeAdmin();
            send(response, 200, result);
            return;
        }
        case `POST ${prefix}/assets/import`: {
            authorizeAdmin();
            const asset = await repository.assets.importArchive(request, value(query, 'strategy'), value(query, 'lang'),
                flag(query, 'includeBytecode', false), { accountId: account.id, key: idempotencyKey(request),
                    authorize: authorizeAdmin, signal: cancelOnClose(response) });
            if (response.destroyed) return;
            send(response, 202, asset);
            return;
        }
        case `GET ${prefix}/index/project/status`:
            send(response, 200, await repository.status(value(query, 'projectRoot', true), requireProject));
            return;
        case `DELETE ${prefix}/index/project`: {
            requireAdmin(account);
            const id = projectId(query);
            if (!id) throw new HttpError(400, 'INVALID_PROJECT_ID');
            await repository.trashProject(account, id, value(query, 'projectRoot'));
            send(response, 200, { status: 'deleted', projectId: id });
            return;
        }
        case `POST ${prefix}/search/knowledge`: {
            const input = await readPayload(request, knowledgeSearchInput, 28_000);
            if (response.destroyed) return;
            const result = await searchKnowledge(repository, account, input, cancelOnClose(response));
            if (response.destroyed) return;
            if (result.status === 'FAILED') send(response, 503, { ...result, error: 'KNOWLEDGE_SEARCH_UNAVAILABLE' });
            else send(response, 200, result);
            return;
        }
        case `GET ${prefix}/search/knowledge/open`: {
            const input = knowledgeOpenInput.safeParse(Object.fromEntries(query));
            if (!input.success) throw new HttpError(400, 'INVALID_INPUT');
            const location = openKnowledge(repository, account, input.data);
            response.writeHead(303, { Location: location, 'Cache-Control': 'no-store' }).end();
            return;
        }
        case `POST ${prefix}/search/scoped`: {
            const input = await readPayload(request, scopedSearchInput, 28_000);
            if (response.destroyed) return;
            const result = await scopedSearch(repository, account, input, cancelOnClose(response));
            if (response.destroyed) return;
            send(response, result.status === 'FAILED' ? 503 : 200, result);
            return;
        }
        case `GET ${prefix}/search/keyword`: {
            const language = value(query, 'lang')?.toLowerCase() ?? null;
            const kind = value(query, 'kind')?.toUpperCase() ?? null;
            if (kind && !kinds.some(candidate => candidate === kind)) throw new HttpError(400, 'INVALID_KIND');
            const snapshot = requestedKnowledgeSnapshot();
            const scope = snapshot ? undefined : retrievalScope();
            const results = repository.search(value(query, 'q', true), snapshot?.projectId ?? scope?.id ?? null, language, kind,
                Math.min(int(query, 'limit', 10), 50), flag(query, 'noTest', true), scope?.allowedProjects() ?? null, snapshot?.id);
            send(response, 200, results);
            return;
        }
        case `GET ${prefix}/search/semantic`:
        case `GET ${prefix}/search/code`: {
            const snapshot = requestedKnowledgeSnapshot();
            const mode = url.pathname.endsWith('/semantic') ? 'semantic' : 'code';
            const text = value(query, mode === 'semantic' ? 'q' : 'snippet', true);
            const language = value(query, 'lang')?.toLowerCase() ?? null;
            const kind = value(query, 'kind')?.toUpperCase() ?? null;
            if (kind && !kinds.some(candidate => candidate === kind)) throw new HttpError(400, 'INVALID_KIND');
            const offset = int(query, 'offset', 0, 0);
            if (offset > 10_000) throw new HttpError(400, 'INVALID_OFFSET');
            const scope = retrievalScope(snapshot);
            const results = await repository.vectorSearch(mode, text, {
                projectId: scope.id, snapshotId: snapshot?.id, allowedProjects: scope.allowedProjects, language, kind, offset,
                limit: Math.min(int(query, 'limit', 10), 100),
                noTest: flag(query, 'noTest', false), entryOnly: flag(query, 'entryOnly', false)
            }, cancelOnClose(response));
            if (response.destroyed) return;
            if (embedding) response.setHeader(benchmarkEmbeddingHeader, encodeURIComponent(JSON.stringify(embedding.retrievalProfile)));
            send(response, 200, results);
            return;
        }
        case `GET ${prefix}/search/graphrag`:
        case `GET ${prefix}/context/pack`: {
            const snapshot = requestedKnowledgeSnapshot();
            const text = value(query, 'q', true);
            const isPack = url.pathname.endsWith('/pack');
            const budget = isPack ? Math.max(1000, Math.min(int(query, 'budgetChars', 12_000), 60_000)) : 0;
            const taskType = isPack ? value(query, 'taskType') ?? 'detail' : '';
            const scope = retrievalScope(snapshot);
            const retrieval = await graphRag(repository, text, {
                projectId: scope.id, snapshotId: snapshot?.id, allowedProjects: scope.allowedProjects, language: value(query, 'lang')?.toLowerCase() ?? null,
                limit: Math.min(int(query, 'limit', 10), 20), depth: Math.min(int(query, 'depth', 1), 3),
                callGraph: flag(query, 'callGraph', true), noTest: flag(query, 'noTest', true),
                impactExpansion: query.has('impactExpansion')
                    ? flag(query, 'impactExpansion', true) : flag(query, 'dataFlow', true),
                rerank: flag(query, 'rerank', true)
            }, cancelOnClose(response));
            if (response.destroyed) return;
            if (snapshot) knowledgeSnapshot(snapshot.id);
            send(response, 200, isPack ? contextPack(text, taskType, budget, retrieval) : retrieval);
            return;
        }
        case `GET ${prefix}/locate`: {
            const file = value(query, 'file', true);
            const archiveEntry = value(query, 'archiveEntry') ?? null;
            if ([file, ...(archiveEntry === null ? [] : [archiveEntry])].some(path =>
                path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..'))) {
                throw new HttpError(400, 'INVALID_RELATIVE_FILE_PATH');
            }
            const line = int(query, 'line');
            const snapshot = requestedKnowledgeSnapshot();
            const result = snapshot
                ? repository.knowledgeSnapshots.locate(snapshot.id,
                    file, line, archiveEntry, value(query, 'symbol'))
                : repository.locate(file, line, scopedProject(), archiveEntry);
            send(response, result ? 200 : 404, result ?? { error: 'NOT_FOUND' });
            return;
        }
        default: {
            const projectLifecycle = /^\/api\/v1\/projects\/([a-f0-9]{12})\/lifecycle$/.exec(url.pathname);
            if (projectLifecycle && (request.method === 'GET' || request.method === 'POST')) {
                const id = projectLifecycle[1];
                if (request.method === 'GET') send(response, 200, repository.projectRetirement.describe(account, id));
                else {
                    const key = idempotencyKey(request);
                    if (!key) throw new HttpError(400, 'PROJECT_LIFECYCLE_KEY_REQUIRED');
                    const input = await readPayload(request, projectLifecycleInput, 2048);
                    if (!response.destroyed) {
                        const result = repository.projectRetirement.change(account, id, input.action, input.revision, key);
                        send(response, result.state === 'PURGING' ? 202 : 200, result);
                    }
                }
                return;
            }
            const diagnostic = /^\/api\/v1\/admin\/diagnostics\/(requests|runs)\/([^/]+)$/.exec(url.pathname);
            if (request.method === 'GET' && diagnostic && agentRunIdPattern.test(diagnostic[2])) {
                authorizeAdmin();
                send(response, 200, diagnostic[1] === 'requests' ? repository.operations.request(diagnostic[2])
                    : repository.operations.run(diagnostic[2]));
                return;
            }
            const projectCapabilities = /^\/api\/v1\/projects\/([a-f0-9]{12})\/capabilities$/.exec(url.pathname);
            if (request.method === 'GET' && projectCapabilities) {
                send(response, 200, repository.identity.projectCapabilities(account, projectCapabilities[1]));
                return;
            }
            const projectAccess = /^\/api\/v1\/projects\/([a-f0-9]{12})\/access$/.exec(url.pathname);
            if (projectAccess && (request.method === 'GET' || request.method === 'PUT')) {
                const id = projectAccess[1];
                if (request.method === 'GET') send(response, 200, repository.identity.projectAccess(account, id));
                else {
                    const input = await readPayload(request, z.object({
                        accountId: z.string().min(1).max(80), role: z.enum(projectGrantRoles).nullable(), revision: z.int().nonnegative()
                    }).strict(), 8 * 1024);
                    if (response.destroyed) return;
                    send(response, 200, repository.identity.setProjectGrant(account, id, input.accountId, input.role, input.revision));
                }
                return;
            }
            const transfer = /^\/api\/v1\/projects\/([a-f0-9]{12})\/access\/transfer$/.exec(url.pathname);
            if (request.method === 'POST' && transfer) {
                const input = await readPayload(request, z.object({
                    accountId: z.string().min(1).max(80), revision: z.int().nonnegative()
                }).strict(), 8 * 1024);
                if (response.destroyed) return;
                send(response, 200, repository.identity.transferPersonalProject(account, transfer[1], input.accountId, input.revision));
                return;
            }
            const lifecycle = /^\/api\/v1\/knowledge-snapshots\/([a-f0-9-]{36})\/lifecycle$/.exec(url.pathname);
            if (lifecycle && agentRunIdPattern.test(lifecycle[1]) && (request.method === 'GET' || request.method === 'POST')) {
                const id = requestedProject();
                if (request.method === 'GET') send(response, 200, repository.snapshotRetirement.describe(account, id, lifecycle[1]));
                else {
                    const key = idempotencyKey(request);
                    if (!key) throw new HttpError(400, 'SNAPSHOT_IDEMPOTENCY_KEY_REQUIRED');
                    repository.identity.requireProjectManager(account, id);
                    const input = await readPayload(request, snapshotAction, 2048);
                    if (!response.destroyed) send(response, 200,
                        repository.snapshotRetirement.change(account, id, lifecycle[1], input.action, input.revision, key));
                }
                return;
            }
            const knowledge = /^\/api\/v1\/knowledge-snapshots\/([a-f0-9-]{36})(?:\/(source|changes|manifest))?$/.exec(url.pathname);
            if (request.method === 'GET' && knowledge) {
                const snapshot = knowledgeSnapshot(knowledge[1]);
                if (!knowledge[2]) {
                    send(response, 200, snapshot);
                    return;
                }
                if (knowledge[2] === 'manifest') {
                    send(response, 200, repository.knowledgeSnapshots.receipt(snapshot.id));
                    return;
                }
                if (knowledge[2] === 'changes') {
                    const delta = repository.knowledgeSnapshots.changes(snapshot.id,
                        Math.min(int(query, 'limit', 100), 500), int(query, 'offset', 0, 0));
                    send(response, 200, { mode: snapshot.mode, parentSnapshotId: snapshot.parentSnapshotId, ...delta });
                    return;
                }
                const file = value(query, 'file', true);
                if (file.includes('\\') || file.split('/').some(part => !part || part === '.' || part === '..')) {
                    throw new HttpError(400, 'INVALID_RELATIVE_FILE_PATH');
                }
                const source = repository.knowledgeSnapshots.source(snapshot.id, file);
                if (!source) throw new HttpError(404, 'NOT_FOUND');
                send(response, 200, source);
                return;
            }
            const ruleRoute = /^\/api\/v1\/rules\/([^/]+)\/(?:(active|audit|evaluation|evaluations|rollback)|versions\/(\d+)(?:\/(review|publish|reject))?)$/.exec(url.pathname);
            if (ruleRoute) {
                let id: string;
                try { id = decodeURIComponent(ruleRoute[1]); } catch { throw new HttpError(400, 'INVALID_RULE_ID'); }
                if (!ruleIdSchema.safeParse(id).success) throw new HttpError(400, 'INVALID_RULE_ID');
                const [, , route, versionText, action] = ruleRoute;
                const version = Number(versionText);
                if (versionText && (!Number.isInteger(version) || version < 1 || version > 2_147_483_647)) throw new HttpError(400, 'INVALID_RULE_VERSION');
                const rules = repository.detectionRules;
                if (request.method === 'GET' && !action && route !== 'rollback') {
                    if (route === 'evaluation') {
                        const projectId = requestedProject();
                        repository.projectRoot(projectId);
                        send(response, 200, rules.evaluate(projectId, id, repository.reviewQueue, repository.triagePolicy));
                    } else if (route === 'audit' || route === 'evaluations') {
                        const limit = Math.min(int(query, 'limit', 100), 500), offset = int(query, 'offset', 0, 0);
                        send(response, 200, route === 'audit' ? rules.audit(id, limit, offset) : rules.evaluations(requestedProject(), id, limit, offset));
                    } else {
                        const rule = route === 'active' ? rules.active(id) : rules.get(id, version);
                        if (!rule) throw new HttpError(404, 'RULE_NOT_FOUND');
                        send(response, 200, rule);
                    }
                    return;
                }
                if (request.method !== 'POST' || (!action && route !== 'rollback')) throw new HttpError(404, 'NOT_FOUND');
                authorizeAdmin();
                const { reason } = await readPayload(request, ruleAction, 4096);
                if (response.destroyed) return;
                authorizeAdmin();
                let updated;
                if (route === 'rollback') updated = rules.rollback(id, account.username, reason);
                else if (action === 'publish') updated = await rules.publish(id, version, account.username, reason, cancelOnClose(response), () => {
                    authorizeAdmin();
                    repository.reviewRuleProposals.requireCurrentEvidence(account, id, version);
                });
                else if (action === 'review' || action === 'reject') updated = rules.transition(id, version, action, account.username, reason);
                else throw new HttpError(404, 'NOT_FOUND');
                if (!response.destroyed) send(response, 200, updated);
                return;
            }
            const vulnReport = /^\/api\/v1\/vulns\/report\/([a-f0-9]{12})$/.exec(url.pathname);
            if (request.method === 'GET' && vulnReport) {
                const id = vulnReport[1];
                requireProject(id);
                send(response, 200, repository.vulnerabilities.report(id, Math.min(int(query, 'limit', 100), 500),
                    Math.min(int(query, 'offset', 0, 0), 50_000)));
                return;
            }
            const vuln = /^\/api\/v1\/vulns\/([a-f0-9]{16})(?:\/(status|impact|taint-evidence))?$/.exec(url.pathname);
            if (vuln) {
                const finding = repository.vulnerabilities.get(vuln[1]);
                if (!finding || !canReadResource(finding)) throw new HttpError(404, 'VULNERABILITY_NOT_FOUND');
                const operation = vuln[2];
                if (request.method === 'PUT' && operation === 'status') {
                    const target = value(query, 'status')?.trim().toUpperCase();
                    const input = target === undefined ? await readPayload(request, vulnerabilityDecision, 4096) : {
                        status: vulnerabilityStatuses.find(candidate => candidate === target),
                        revision: query.has('revision') ? int(query, 'revision', undefined, 0) : undefined, reason: value(query, 'reason') };
                    if (!input.status) throw new HttpError(400, 'INVALID_VULNERABILITY_STATUS');
                    if (response.destroyed) return;
                    if (!canReadResource(finding)) throw new HttpError(404, 'VULNERABILITY_NOT_FOUND');
                    editableProject(finding.projectId);
                    send(response, 200, repository.vulnerabilities.changeStatus(finding.id, input.status, account.username,
                        findingPublicText(input.reason ?? '', 500), input.revision));
                } else if (request.method === 'GET' && !operation) send(response, 200, repository.vulnerabilities.detail(finding));
                else if (request.method === 'GET' && operation === 'impact') {
                    const depth = Math.min(int(query, 'depth', 2), 12);
                    const current = finding.legacyImported && finding.filePath && finding.startLine > 0
                        ? repository.locate(finding.filePath, finding.startLine, finding.projectId) : undefined;
                    const target = current && current.qualifiedName === finding.qualifiedName ? current.id : finding.unitId;
                    send(response, 200, target && !finding.dependency ? repository.traverse(target, finding.projectId, 'impact', depth) : []);
                } else if (request.method === 'GET' && operation === 'taint-evidence') {
                    send(response, 200, repository.vulnerabilities.taintEvidence(finding.id));
                }
                else throw new HttpError(404, 'NOT_FOUND');
                return;
            }
            const snapshotRoute = /^\/api\/v1\/review-queue\/snapshots\/([^/]+)\/(review|export)$/.exec(url.pathname);
            if (request.method === 'GET' && snapshotRoute && agentRunIdPattern.test(snapshotRoute[1])) {
                const snapshot = visibleSnapshot(snapshotRoute[1]);
                if (!snapshot) throw new HttpError(404, 'REVIEW_SNAPSHOT_NOT_FOUND');
                if (snapshotRoute[2] === 'review') send(response, 200, repository.reviewQueue.view(snapshot));
                else {
                    const format = reviewFormat.safeParse(value(query, 'format', true).trim().toLowerCase());
                    if (!format.success) throw new HttpError(400, 'INVALID_REVIEW_EXPORT_FORMAT');
                    const { payload, type, extension } = await exportReview(snapshot, format.data);
                    if (response.destroyed) return;
                    if (!canReadResource(snapshot)) throw new HttpError(404, 'REVIEW_SNAPSHOT_NOT_FOUND');
                    attachment(response, type, 'review-' + snapshot.id + '.' + extension, payload);
                }
                return;
            }
            const reviewEntry = /^\/api\/v1\/review-queue\/([^/]+)\/(claim|return|confirm|reject|audit)$/.exec(url.pathname);
            if (reviewEntry && agentRunIdPattern.test(reviewEntry[1])) {
                const entry = repository.reviewQueue.get(reviewEntry[1]);
                if (!entry || !canReadResource(entry)) throw new HttpError(404, 'REVIEW_ENTRY_NOT_FOUND');
                const action = reviewEntry[2];
                if (action === 'audit' && request.method === 'GET') send(response, 200, repository.reviewQueue.audit(entry.id));
                else if (action !== 'audit' && request.method === 'POST') {
                    const input = await readPayload(request, reviewAction, 4096);
                    if (response.destroyed) return;
                    if (!canReadResource(entry)) throw new HttpError(404, 'REVIEW_ENTRY_NOT_FOUND');
                    editableProject(entry.projectId);
                    send(response, 200, repository.reviewQueue.transition(entry.id, action as ReviewAction, account.username, input));
                } else throw new HttpError(404, 'NOT_FOUND');
                return;
            }
            const suppression = /^\/api\/v1\/triage\/suppressions\/([^/]+)\/(audit|revoke)$/.exec(url.pathname);
            if (suppression && suppressionId.test(suppression[1])) {
                const [, id, action] = suppression;
                const scope = repository.triagePolicy.scope(id);
                if (!scope || !canReadResource(scope)) throw new HttpError(404, 'SUPPRESSION_NOT_FOUND');
                if (action === 'audit' && request.method === 'GET') send(response, 200, repository.triagePolicy.audit(id));
                else if (action === 'revoke' && request.method === 'POST') {
                    const input = await readPayload(request, suppressionRevoke, 8192);
                    if (response.destroyed) return;
                    if (!canReadResource(scope)) throw new HttpError(404, 'SUPPRESSION_NOT_FOUND');
                    editableProject(scope.projectId);
                    send(response, 200, repository.triagePolicy.revoke(id, scope.projectId, account.username, input.reason));
                } else throw new HttpError(404, 'NOT_FOUND');
                return;
            }
            const externalFinding = /^\/api\/v1\/triage\/findings\/([a-f0-9]{16})$/.exec(url.pathname);
            if (request.method === 'GET' && externalFinding) {
                const id = requestedProject();
                const finding = repository.externalFindings.get(id, externalFinding[1]);
                if (!finding) throw new HttpError(404, 'EXTERNAL_FINDING_NOT_FOUND');
                send(response, 200, findingReport(repository, id, finding, Math.min(int(query, 'budgetChars', 12_000), 60_000)));
                return;
            }
            const scanTask = /^\/api\/v1\/scan-tasks\/([^/]+)(?:\/(findings|cancel|retry|execution))?$/.exec(url.pathname);
            if (scanTask && scanHistoryId.test(scanTask[1])) {
                const [, id, action] = scanTask;
                const task = repository.scanHistory.task(id);
                if (!task || !canReadResource(task)) throw new HttpError(404, 'SCAN_TASK_NOT_FOUND');
                if (request.method === 'GET' && action === 'findings') {
                    const { page, size } = scanPage();
                    send(response, 200, repository.scanHistory.findings(task, page, size));
                } else if (request.method === 'GET' && action === 'execution') {
                    const execution = repository.scans.execution(task.id);
                    if (!execution) throw new HttpError(404, 'SCAN_EXECUTION_NOT_FOUND');
                    send(response, 200, execution);
                } else if (request.method === 'POST' && action === 'execution') {
                    const input = await readPayload(request, jobActionInput, 2048);
                    if (!response.destroyed) send(response, 200, repository.scans.control(task, account, input.action, input.revision, input.priority));
                } else if (request.method === 'GET' && !action) send(response, 200, { ...task, taskId: task.id });
                else if (request.method === 'POST' && action === 'cancel') {
                    editableProject(task.projectId);
                    const cancelled = await repository.scans.cancel(task, account);
                    if (response.destroyed) return;
                    if (!canReadResource(cancelled)) throw new HttpError(404, 'SCAN_TASK_NOT_FOUND');
                    send(response, 200, { taskId: id, status: cancelled.status });
                } else if (request.method === 'POST' && action === 'retry') {
                    const restarted = await repository.scans.retry(task, account, idempotencyKey(request), cancelOnClose(response));
                    if (!response.destroyed) send(response, 200, { taskId: id, status: restarted.status });
                } else throw new HttpError(404, 'NOT_FOUND');
                return;
            }
            const archivedRun = /^\/api\/v1\/scans\/([^/]+)$/.exec(url.pathname);
            if (request.method === 'GET' && archivedRun && scanHistoryId.test(archivedRun[1])) {
                const run = repository.scanHistory.runSummary(archivedRun[1]);
                if (!run || !canReadResource(run)) throw new HttpError(404, 'SCAN_RUN_NOT_FOUND');
                send(response, 200, { ...run, findings: repository.scanHistory.runFindings(run.scanId) });
                return;
            }
            const cancel = /^\/api\/v1\/agent-runs\/([^/]+)\/cancel$/.exec(url.pathname);
            if (request.method === 'POST' && cancel && agentRunIdPattern.test(cancel[1])) {
                const run = repository.agentRuns.get(cancel[1]);
                if (!run || !canReadRun(run)) throw new HttpError(404, 'NOT_FOUND');
                editableProject(run.projectId);
                if (run.playbook === 'WIKI_SUMMARY') {
                    repository.wiki.control(run, account, 'cancel');
                    send(response, 200, repository.agentRuns.get(run.id));
                } else if (run.playbook === 'GIT_SYNC') {
                    const job = repository.gitSources.execution(run);
                    if (!job) throw new HttpError(404, 'JOB_NOT_FOUND');
                    repository.gitSources.control(account, run, 'cancel', job.revision);
                    send(response, 200, repository.agentRuns.get(run.id));
                } else if (run.playbook === isolatedVerificationPlaybook) {
                    const job = repository.verifications.execution(run.id);
                    if (!job) throw new HttpError(404, 'JOB_NOT_FOUND');
                    repository.verifications.control(account, run.id, 'cancel', job.revision);
                    send(response, 200, repository.agentRuns.get(run.id));
                } else if (run.playbook === localIndexPlaybook) {
                    const job = repository.localIndexes.execution(run.id);
                    if (!job) throw new HttpError(404, 'JOB_NOT_FOUND');
                    repository.localIndexes.control(account, run.id, 'cancel', job.revision);
                    send(response, 200, repository.agentRuns.get(run.id));
                } else send(response, 200, run.playbook === sastTriagePlaybook
                    ? await repository.sastTriageAgent.cancel(run, account) : await repository.changeReviewAgent.cancel(run, account));
                return;
            }
            const verification = /^\/api\/v1\/verifications\/([^/]+)$/.exec(url.pathname);
            if (request.method === 'GET' && verification && agentRunIdPattern.test(verification[1])) {
                send(response, 200, repository.verifications.inspect(account, verification[1]));
                return;
            }
            const execution = /^\/api\/v1\/agent-runs\/([^/]+)\/execution(?:\/(attempts))?$/.exec(url.pathname);
            if (execution && agentRunIdPattern.test(execution[1]) && (request.method === 'GET' || (!execution[2] && request.method === 'POST'))) {
                const run = repository.agentRuns.get(execution[1]);
                if (!run || !canReadRun(run) || !['WIKI_SUMMARY', 'GIT_SYNC', isolatedVerificationPlaybook,
                    changeReviewPlaybook, sastTriagePlaybook, localIndexPlaybook].includes(run.playbook)) {
                    throw new HttpError(404, 'NOT_FOUND');
                }
                const wiki = run.playbook === 'WIKI_SUMMARY';
                const verify = run.playbook === isolatedVerificationPlaybook;
                const review = run.playbook === changeReviewPlaybook;
                const triage = run.playbook === sastTriagePlaybook;
                const index = run.playbook === localIndexPlaybook;
                if (request.method === 'GET') {
                    const job = wiki ? repository.wiki.execution(run.id) : verify ? repository.verifications.execution(run.id)
                        : review ? repository.changeReviewAgent.execution(run.id) : triage ? repository.sastTriageAgent.execution(run.id)
                        : index ? repository.localIndexes.execution(run.id) : repository.gitSources.execution(run);
                    if (!job) throw new HttpError(404, 'JOB_NOT_FOUND');
                    const attempts = () => wiki ? repository.wiki.attempts(run.id) : verify ? repository.verifications.attempts(run.id)
                        : review ? repository.changeReviewAgent.attempts(run.id) : triage ? repository.sastTriageAgent.attempts(run.id)
                        : index ? repository.localIndexes.attempts(run.id) : repository.gitSources.attempts(run.id);
                    send(response, 200, execution[2] ? attempts() : job);
                } else {
                    const input = await readPayload(request, jobActionInput, 2048);
                    if (response.destroyed) return;
                    const job = wiki ? repository.wiki.control(run, account, input.action, input.revision, input.priority)
                        : verify ? repository.verifications.control(account, run.id, input.action, input.revision, input.priority)
                        : review ? repository.changeReviewAgent.control(run, account, input.action, input.revision, input.priority)
                        : triage ? repository.sastTriageAgent.control(run, account, input.action, input.revision, input.priority)
                        : index ? repository.localIndexes.control(account, run.id, input.action, input.revision, input.priority)
                        : repository.gitSources.control(account, run, input.action, input.revision, input.priority);
                    send(response, 200, job);
                }
                return;
            }
            const runExport = /^\/api\/v1\/agent-runs\/([^/]+)\/export$/.exec(url.pathname);
            if (request.method === 'GET' && runExport && agentRunIdPattern.test(runExport[1])) {
                const run = repository.agentRuns.get(runExport[1]);
                if (!run || !canReadRun(run)) throw new HttpError(404, 'NOT_FOUND');
                attachment(response, 'application/json; charset=utf-8', 'run-' + run.id + '.json', Buffer.from(JSON.stringify(run)));
                return;
            }
            const wikiExport = /^\/api\/v1\/summaries\/([^/]+)\/export$/.exec(url.pathname);
            if (request.method === 'GET' && wikiExport && agentRunIdPattern.test(wikiExport[1])) {
                const page = repository.wiki.pages.resolve(wikiPage(wikiExport[1]), wikiRevision());
                const format = value(query, 'format') ?? 'markdown';
                if (format !== 'markdown') throw new HttpError(400, 'WIKI_EXPORT_FORMAT_UNSUPPORTED');
                const section = query.has('section') ? int(query, 'section', undefined, 0) : undefined;
                attachment(response, 'text/markdown; charset=utf-8', 'wiki-' + page.id + '.md', repository.wiki.pages.export(page, section));
                return;
            }
            const wikiResource = /^\/api\/v1\/(summaries|agent-runs)\/([^/]+)$/.exec(url.pathname);
            if (request.method === 'GET' && wikiResource && agentRunIdPattern.test(wikiResource[2])) {
                const [, kind, id] = wikiResource;
                if (kind === 'summaries') {
                    const page = repository.wiki.pages.resolve(wikiPage(id), wikiRevision());
                    if (flag(query, 'permissions', false)) {
                        const permissions = repository.identity.projectCapabilities(account, page.projectId);
                        send(response, 200, { ...page, canEdit: permissions.canEdit && Boolean(page.knowledgeSnapshotId) });
                    } else send(response, 200, page);
                    return;
                }
                const resource = repository.agentRuns.get(id);
                if (!resource || !canReadRun(resource)) throw new HttpError(404, 'NOT_FOUND');
                send(response, 200, resource);
                return;
            }
            const reviewScope = /^\/api\/v1\/change-reviews\/scopes\/([^/]+)$/.exec(url.pathname);
            if (request.method === 'GET' && reviewScope && agentRunIdPattern.test(reviewScope[1])) {
                send(response, 200, repository.changeReviews.readScope(account, reviewScope[1]));
                return;
            }
            const overlaySource = /^\/api\/v1\/change-reviews\/([^/]+)\/overlay-source$/.exec(url.pathname);
            if (request.method === 'GET' && overlaySource && agentRunIdPattern.test(overlaySource[1])) {
                const path = overlayPath.safeParse(value(query, 'file', true));
                if (!path.success) throw new HttpError(400, 'INVALID_FILE');
                send(response, 200, repository.changeReviews.overlaySource(account, requestedProject(), overlaySource[1], path.data));
                return;
            }
            const patchProposal = /^\/api\/v1\/change-reviews\/([^/]+)\/patches$/.exec(url.pathname);
            if (request.method === 'POST' && patchProposal && agentRunIdPattern.test(patchProposal[1])) {
                const key = idempotencyKey(request);
                if (!key) throw new HttpError(400, 'CHANGE_PATCH_IDEMPOTENCY_KEY_REQUIRED');
                const id = requestedProject();
                const input = await readPayload(request, proposeChangePatch, 4 * 1024 * 1024);
                if (!response.destroyed) send(response, 200, repository.changePatches.propose(account, id, patchProposal[1], key, input));
                return;
            }
            const changePatch = /^\/api\/v1\/change-patches\/([^/]+)(?:\/(artifact|decision))?$/.exec(url.pathname);
            if (changePatch && agentRunIdPattern.test(changePatch[1])) {
                const [, id, action] = changePatch;
                if (request.method === 'GET' && !action) {
                    send(response, 200, repository.changePatches.inspect(account, id));
                    return;
                }
                if (request.method === 'GET' && action === 'artifact') {
                    const artifact = repository.changePatches.artifact(account, id);
                    response.setHeader('ETag', '"' + artifact.digest + '"');
                    attachment(response, 'text/x-diff; charset=utf-8', 'change-' + id + '.patch', artifact.bytes);
                    return;
                }
                if (request.method === 'POST' && action === 'decision') {
                    const key = idempotencyKey(request);
                    if (!key) throw new HttpError(400, 'CHANGE_PATCH_IDEMPOTENCY_KEY_REQUIRED');
                    const input = await readPayload(request, decideChangePatch, 4096);
                    if (response.destroyed) return;
                    const result = await repository.changePatches.decide(account, id, key, input, cancelOnClose(response));
                    if (!response.destroyed) send(response, 200, result);
                    return;
                }
            }
            const reviewFinding = /^\/api\/v1\/change-reviews\/([^/]+)\/findings\/([a-f0-9]{64})$/.exec(url.pathname);
            if (reviewFinding && agentRunIdPattern.test(reviewFinding[1]) && (request.method === 'GET' || request.method === 'POST')) {
                const [, reviewId, findingId] = reviewFinding;
                const id = requestedProject();
                if (request.method === 'GET') {
                    send(response, 200, repository.changeReviews.findingHistory(account, id, reviewId, findingId,
                        Math.min(int(query, 'limit', 50), 100), int(query, 'offset', 0, 0)));
                } else {
                    const key = idempotencyKey(request);
                    if (!key) throw new HttpError(400, 'CHANGE_REVIEW_IDEMPOTENCY_KEY_REQUIRED');
                    const input = await readPayload(request, reviewFindingDecision, 16 * 1024);
                    if (!response.destroyed) send(response, 200, repository.changeReviews.decideFinding(account, id, reviewId, findingId, key, input));
                }
                return;
            }
            const ruleCandidate = /^\/api\/v1\/change-rule-candidates\/([^/]+)$/.exec(url.pathname);
            if (request.method === 'GET' && ruleCandidate && agentRunIdPattern.test(ruleCandidate[1])) {
                send(response, 200, repository.reviewRuleProposals.inspect(account, ruleCandidate[1]));
                return;
            }
            const review = /^\/api\/v1\/change-reviews\/([^/]+)(\/export)?$/.exec(url.pathname);
            if (request.method === 'GET' && review && snapshotIdPattern.test(review[1])) {
                const id = requestedProject();
                const snapshot = repository.changeReviews.get(review[1], id);
                if (!snapshot) throw new HttpError(404, 'CHANGE_REVIEW_NOT_FOUND');
                if (!review[2]) { send(response, 200, snapshot); return; }
                const format = value(query, 'format') ?? 'markdown';
                if (format !== 'json' && format !== 'markdown') throw new HttpError(400, 'INVALID_CHANGE_REVIEW_FORMAT');
                response.setHeader('Content-Disposition', 'attachment; filename=change-review.' + (format === 'json' ? 'json' : 'md'));
                if (format === 'json') send(response, 200, snapshot);
                else response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff' }).end(reviewMarkdown(snapshot));
                return;
            }
            const watched = /^\/api\/v1\/watch\/([a-f0-9]{12})$/.exec(url.pathname);
            if (watched) {
                const id = watched[1];
                if (request.method === 'GET') {
                    requireProject(id);
                    send(response, 200, { projectId: id, watching: repository.watches.has(id) });
                    return;
                }
                if (request.method === 'DELETE') {
                    authorizeAdmin();
                    requireProject(id);
                    await repository.watches.stop(id);
                    response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
                    return;
                }
            }
            const asset = /^\/api\/v1\/assets\/([^/]+)(?:\/(profile|reindex|reuse|scans|scan-tasks|external-findings|authorization-evidence))?$/.exec(url.pathname);
            if (asset && assetIdPattern.test(asset[1])) {
                const id = asset[1];
                if (request.method === 'GET' && (asset[2] === 'scans' || asset[2] === 'external-findings')) {
                    const record = repository.assets.find(id, requireProject);
                    if (!canReadResource(record)) throw new HttpError(404, 'ASSET_NOT_FOUND');
                    const result = asset[2] === 'scans' ? repository.scanHistory.allRuns(record.projectId)
                        : repository.externalFindings.list(record.projectId, null, null, 10_000, 0).findings;
                    send(response, 200, result);
                    return;
                }
                if (request.method === 'POST' && (asset[2] === 'scans' || asset[2] === 'scan-tasks')) {
                    repository.assets.find(id, editableProject);
                    const input = request.headers['content-length'] === '0' || (!request.headers['content-length']
                        && !request.headers['transfer-encoding']) ? null : await readPayload(request, startScanInput, 4096);
                    if (response.destroyed) return;
                    let scanners = input?.scanners ?? [];
                    if (!scanners.length) {
                        const profile = await repository.assets.profile(id, [], [], editableProject);
                        scanners = profile.scannerPlan.filter(item => item.selected && repository.scans.supports(item.scanner))
                            .map(item => item.scanner);
                    }
                    if (response.destroyed) return;
                    const current = repository.assets.find(id, editableProject);
                    const signal = cancelOnClose(response);
                    const task = await repository.scans.submit(current, scanners, input?.timeoutSeconds, account, idempotencyKey(request), signal);
                    if (response.destroyed) return;
                    const pollUrl = `${prefix}/scan-tasks/${task.id}`;
                    if (asset[2] === 'scan-tasks') {
                        response.setHeader('Location', pollUrl);
                        send(response, 202, { taskId: task.id, status: task.status, pollUrl });
                    } else {
                        const result = await repository.scans.wait(task, signal);
                        if (response.destroyed) return;
                        requireProject(result.projectId);
                        repository.assets.find(id);
                        const runs = result.scanners.map(run => ({ ...run, findings: repository.scanHistory.runFindings(run.scanId) }));
                        send(response, 200, { batchId: result.batchId, projectId: result.projectId, status: result.batchStatus ?? 'FAILED', runs });
                    }
                    return;
                }
                if (request.method === 'GET' && asset[2] === 'authorization-evidence') {
                    const record = repository.assets.find(id, requireProject);
                    if (record.status !== 'READY') throw new HttpError(409, 'ASSET_NOT_READY');
                    send(response, 200, repository.authorizationEvidence(record.projectId, int(query, 'depth', 6, 0)));
                    return;
                }
                if (request.method === 'GET' && (asset[2] === undefined || asset[2] === 'profile')) {
                    if (asset[2]) send(response, 200, await repository.assets.profile(id, query.getAll('includeScanner'),
                        query.getAll('excludeScanner'), requireProject));
                    else {
                        const record = repository.assets.find(id, requireProject);
                        send(response, 200, { ...record, ...repository.identity.projectCapabilities(account, record.projectId) });
                    }
                    return;
                }
                if (request.method === 'POST' && asset[2] === 'reindex') {
                    authorizeAdmin();
                    const record = repository.assets.find(id, requireProject);
                    const strategy = value(query, 'strategy');
                    const languages = indexLanguages(value(query, 'lang'), flag(query, 'includeBytecode', false));
                    const { asset: started } = await repository.assets.reindex(id, languages, () => {
                        authorizeAdmin();
                        requireProject(record.projectId);
                    },
                        strategy === null ? undefined : indexStrategy(strategy));
                    send(response, 202, started);
                    return;
                }
                if (request.method === 'POST' && asset[2] === 'reuse') {
                    authorizeAdmin();
                    const input = await readPayload(request, z.object({ displayName: assetDisplayName.optional() }).strict(), 4096);
                    if (response.destroyed) return;
                    const record = await repository.assets.reuse(id, input.displayName, value(query, 'strategy'), value(query, 'lang'),
                        flag(query, 'includeBytecode', false), requireProject, { accountId: account.id, key: idempotencyKey(request),
                            authorize: authorizeAdmin, signal: cancelOnClose(response) });
                    if (!response.destroyed) send(response, 202, record);
                    return;
                }
                if (request.method === 'PATCH' && !asset[2]) {
                    const input = await readPayload(request, z.object({ displayName: assetDisplayName, revision: z.int().nonnegative() }).strict(), 4096);
                    if (!response.destroyed) send(response, 200, repository.assets.rename(id, input.displayName, input.revision, editableProject));
                    return;
                }
                if (request.method === 'DELETE' && !asset[2]) {
                    requireAdmin(account);
                    const asset = repository.assets.find(id);
                    await repository.trashProject(account, asset.projectId);
                    send(response, 200, { status: 'deleted', assetId: id });
                    return;
                }
            }
            const sbom = /^\/api\/v1\/sbom\/([a-f0-9]{12})$/.exec(url.pathname);
            if (request.method === 'GET' && sbom) {
                const id = sbom[1];
                requireProject(id);
                const root = repository.projectRoot(id);
                const suppliedRoot = value(query, 'projectRoot');
                if (suppliedRoot !== null && suppliedRoot !== root) throw new HttpError(400, 'PROJECT_ROOT_MISMATCH');
                const format = value(query, 'format') ?? 'cyclonedx';
                if (format !== 'cyclonedx') throw new HttpError(400, 'UNSUPPORTED_SBOM_FORMAT');
                const inventory = await dependencyInventory(root);
                requireProject(id);
                if (repository.projectRoot(id) !== root) throw new HttpError(409, 'PROJECT_ROOT_CHANGED');
                if (!inventory.available) throw new HttpError(400, inventory.supported || inventory.issues.length
                    ? 'DEPENDENCY_INVENTORY_UNAVAILABLE' : 'NO_SUPPORTED_MANIFEST');
                send(response, 200, cyclonedx(root, inventory));
                return;
            }
            const stats = /^\/api\/v1\/projects\/([a-f0-9]{12})\/stats$/.exec(url.pathname);
            if (request.method === 'GET' && stats) {
                requireProject(stats[1]);
                send(response, 200, repository.projectStats(stats[1]));
                return;
            }
            const frameworks = /^\/api\/v1\/frameworks\/([a-f0-9]{12})$/.exec(url.pathname);
            if (request.method === 'GET' && frameworks) {
                send(response, 200, entryPoints(frameworks[1]));
                return;
            }
            const symbolPath = `${prefix}/symbol/`;
            if (request.method === 'GET' && url.pathname.startsWith(symbolPath)) {
                const name = decodeURIComponent(url.pathname.slice(symbolPath.length));
                if (!name || name.length > 4096 || name.includes('\0')) throw new HttpError(400, 'INVALID_SYMBOL');
                const result = repository.symbol(name, scopedProject());
                send(response, result ? 200 : 404, result ?? { error: 'NOT_FOUND' });
                return;
            }
            send(response, 404, { error: 'NOT_FOUND' });
        }
    }
}

const server = createServer((request, response) => {
    const requestId = randomUUID();
    const started = performance.now();
    response.setHeader('X-Request-Id', requestId);
    response.once('close', () => repository.operations.finishRequest(requestId,
        response.writableFinished ? response.statusCode : 0, performance.now() - started, response.getHeader('Location')));
    void handleHttpRequest(request, response).catch(error => {
        if (response.destroyed) return;
        if (error instanceof EmbeddingUnavailable) {
            send(response, 503, { error: error.code });
            return;
        }
        if (error instanceof HttpError) {
            send(response, error.status, error.status === 409 && error.message === 'INDEX_ALREADY_RUNNING'
                ? { status: 'running', error: error.message } : { error: error.message });
        } else if (error instanceof URIError) {
            send(response, 400, { error: 'INVALID_URL' });
        } else {
            console.error('Request failed:', requestId, error instanceof Error ? error.name : 'Error');
            send(response, 500, { error: 'INTERNAL_ERROR' });
        }
    });
});
server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address) console.error(`RepoGraph listening on http://127.0.0.1:${address.port}`);
});
function stop() {
    stopping = true;
    server.close(() => void repository.close());
    void repository.scans.close().catch(() => console.error('Unable to stop scan tasks cleanly'));
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
