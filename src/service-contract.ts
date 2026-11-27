import { z } from 'zod';
import { askSessionInput, askTurnInput } from './ask-evidence.js';
import { decideChangePatch, proposeChangePatch } from './change-patches.js';
import { compareChangeInput, compareChangeScopeInput, workingReviewInput } from './change-review.js';
import { reviewFindingDecision } from './change-review-findings.js';
import { csvEdits } from './csv-document.js';
import { knowledgeSearchInput } from './knowledge-search.js';
import { verificationInput } from './isolated-verifications.js';
import { spaceDocumentGeneration, spaceItemName, spaceItemPlacement, spaceLinkInput, spaceMemberInput,
    spaceProjectId, spaceRevision, spaceTransferInput, spaceUpdateInput, spaceUuid } from './project-space-input.js';
import { projectLifecycleInput } from './project-retirement.js';
import { overlayPath } from './review-working-copy.js';
import { reviewRuleInput } from './review-rule-proposals.js';
import { startScanInput } from './scan-tasks.js';
import { maxTriageFindings } from './sast-triage-agent.js';
import { scopedSearchInput, scopedUuid } from './scoped-retrieval.js';
import { wikiArtifactFormats } from './wiki-export.js';

export const serviceFeatures = ['knowledgeSnapshots', 'snapshotManagement', 'wikiRevisions', 'scopedSearch', 'durableWiki',
    'projectSpaces', 'ask', 'askAttachments', 'wikiArtifacts', 'knowledgeSearch', 'spaceDocumentGeneration', 'spaceAdministration',
    'projectRetirement', 'askContext', 'pdfSpaceDocuments', 'askPdfAttachments', 'verifiedChangeReview', 'spaceCsvDocuments',
    'isolatedVerification', 'verificationHistory', 'scopedChangeReview', 'structuredChangeFindings', 'workingCopyReview', 'reviewPatches',
    'durableChangeReview', 'wikiDocxArtifacts', 'reviewRuleCandidates', 'askChangeReview', 'durableSastTriage', 'durableArchiveScans'] as const;
type ServiceFeature = typeof serviceFeatures[number];
export type ServiceQuery = Record<string, string | number | boolean | undefined>;
type ServiceRequest = { path: string; query?: ServiceQuery; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown; idempotencyKey?: string; feature?: ServiceFeature };
type ServiceOperation = { feature: ServiceFeature; description: string; input: z.ZodType; request: (input: unknown) => ServiceRequest };
const project = z.object({ projectId: z.string().regex(/^[a-f0-9]{12}$/) }).strict();
const released = project.extend({ snapshotId: scopedUuid });
const page = released.extend({ pageId: scopedUuid, revisionId: scopedUuid.optional() });
const run = project.extend({ runId: scopedUuid });
const listing = project.extend({ limit: z.int().min(1).max(100).optional(), offset: z.int().nonnegative().optional() });
const requestKey = z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/);
const session = z.object({ sessionId: scopedUuid }).strict();
const turn = session.extend({ turnId: scopedUuid });
const attachment = session.extend({ attachmentId: scopedUuid });
const space = z.object({ spaceId: spaceUuid }).strict();
const spaceRepository = space.extend({ projectId: spaceProjectId, revision: spaceRevision });
const spaceTrash = space.extend({ batchId: spaceUuid });

function operation<T>(feature: ServiceFeature, description: string, input: z.ZodType<T>,
    request: (parameters: T) => ServiceRequest): ServiceOperation {
    return { feature, description, input, request: value => request(input.parse(value)) };
}

export const serviceOperations = {
    list_trashed_projects: operation('projectRetirement', 'List recoverable repositories and storage cleanup in progress.',
        z.object({ limit: z.int().min(1).max(100).optional(), offset: z.int().nonnegative().optional() }).strict(),
        query => ({ path: '/projects/trash', query })),
    inspect_project_lifecycle: operation('projectRetirement', 'Read a repository’s current lifecycle and revision.', project,
        ({ projectId }) => ({ path: `/projects/${projectId}/lifecycle` })),
    change_project_lifecycle: operation('projectRetirement', 'Move a repository to trash, restore it, or request guarded permanent cleanup.',
        projectLifecycleInput.extend({ projectId: project.shape.projectId, key: requestKey }),
        ({ projectId, key, ...body }) => ({ path: `/projects/${projectId}/lifecycle`, method: 'POST', body, idempotencyKey: key })),
    list_knowledge_snapshots: operation('knowledgeSnapshots', 'List published knowledge snapshots for a repository.', listing,
        query => ({ path: '/knowledge-snapshots', query })),
    read_snapshot_source: operation('knowledgeSnapshots', 'Read a file from an exact published knowledge snapshot.',
        released.extend({ file: z.string().min(1).max(4096) }),
        ({ snapshotId, ...query }) => ({ path: `/knowledge-snapshots/${snapshotId}/source`, query })),
    read_snapshot_manifest: operation('knowledgeSnapshots', 'Read the verification receipt for an exact published knowledge snapshot.', released,
        ({ snapshotId, ...query }) => ({ path: `/knowledge-snapshots/${snapshotId}/manifest`, query })),
    list_retired_snapshots: operation('snapshotManagement', 'List retired snapshots manageable by the current identity.', listing,
        query => ({ path: '/knowledge-snapshots/retired', query })),
    inspect_snapshot_lifecycle: operation('snapshotManagement', 'Read lifecycle state and optimistic revision of a manageable snapshot.', released,
        ({ snapshotId, ...query }) => ({ path: `/knowledge-snapshots/${snapshotId}/lifecycle`, query })),
    change_snapshot_lifecycle: operation('snapshotManagement', 'Retire, restore or collect a manageable snapshot with its expected revision.',
        released.extend({ action: z.enum(['retire', 'restore', 'purge']), revision: z.int().nonnegative(), key: requestKey }),
        ({ projectId, snapshotId, key, ...body }) => ({ path: `/knowledge-snapshots/${snapshotId}/lifecycle`,
            method: 'POST', query: { projectId }, body, idempotencyKey: key })),
    list_wiki_pages: operation('wikiRevisions', 'List Wiki pages of one perspective in an exact published snapshot.',
        released.extend({ perspective: z.enum(['technical', 'business']).default('technical') }),
        query => ({ path: '/summaries/tree', query })),
    read_wiki_page: operation('wikiRevisions', 'Read a Wiki page in a published snapshot, optionally pinned to one editorial revision.', page,
        ({ pageId, ...query }) => ({ path: `/summaries/${pageId}`, query })),
    prepare_wiki_export: operation('wikiArtifacts', 'Generate a repository attachment for an exact Wiki revision and optional section.',
        page.extend({ revisionId: scopedUuid, format: z.enum(wikiArtifactFormats), section: z.int().nonnegative().optional() }),
        ({ projectId, snapshotId, pageId, ...body }) => ({ path: `/summaries/${pageId}/exports`, method: 'POST',
            query: { projectId, snapshotId }, body, ...(body.format === 'docx' && { feature: 'wikiDocxArtifacts' }) })),
    list_wiki_exports: operation('wikiArtifacts', 'List generated attachments for an exact Wiki revision.',
        page.extend({ revisionId: scopedUuid, offset: z.int().nonnegative().optional() }),
        ({ pageId, ...query }) => ({ path: `/summaries/${pageId}/exports`, query })),
    search_scoped: operation('scopedSearch', 'Search up to eight explicit published repository and project-space scopes.', scopedSearchInput,
        body => ({ path: '/search/scoped', method: 'POST', body })),
    search_knowledge: operation('knowledgeSearch', 'Search authorized published code, Wiki revisions and space document versions with exact citations.',
        knowledgeSearchInput, body => ({ path: '/search/knowledge', method: 'POST', body })),
    edit_space_csv: operation('spaceCsvDocuments', 'Save cell replacements against a CSV document revision.',
        z.strictObject({ spaceId: spaceUuid, documentId: spaceUuid, baseVersionId: spaceUuid, key: requestKey, edits: csvEdits }),
        ({ spaceId, documentId, ...body }) => ({ path: `/spaces/${spaceId}/documents/${documentId}/cells`, method: 'PATCH', body })),
    compare_change_snapshots: operation('verifiedChangeReview', 'Create a review against the indexed source of authorized published snapshots.',
        compareChangeInput.extend({ key: requestKey }),
        ({ key, ...body }) => ({ path: '/change-reviews/compare', method: 'POST', body, idempotencyKey: key })),
    compare_change_scope: operation('scopedChangeReview', 'Compare each selected repository separately and attach exact background references.',
        compareChangeScopeInput.safeExtend({ key: requestKey }),
        ({ key, ...body }) => ({ path: '/change-reviews/compare-scope', method: 'POST', body, idempotencyKey: key })),
    compare_working_copy: operation('workingCopyReview', 'Capture selected local Git paths against a verified committed baseline.',
        workingReviewInput.extend({ key: requestKey }),
        ({ key, ...body }) => ({ path: '/change-reviews/working-copy', method: 'POST', body, idempotencyKey: key })),
    read_change_overlay_source: operation('workingCopyReview', 'Read one redacted source file captured in a working-copy review.',
        project.extend({ reviewId: scopedUuid, file: overlayPath }),
        ({ reviewId, ...query }) => ({ path: `/change-reviews/${reviewId}/overlay-source`, query })),
    propose_change_patch: operation('reviewPatches', 'Prepare a detached patch for retained paths in the frozen review target.',
        proposeChangePatch.safeExtend({ projectId: project.shape.projectId, reviewId: scopedUuid, key: requestKey }),
        ({ projectId, reviewId, key, ...body }) => ({ path: `/change-reviews/${reviewId}/patches`, method: 'POST',
            query: { projectId }, body, idempotencyKey: key })),
    inspect_change_patch: operation('reviewPatches', 'Read a patch preview and human decision recorded against an exact review.',
        z.strictObject({ patchId: scopedUuid }), ({ patchId }) => ({ path: `/change-patches/${patchId}` })),
    decide_change_patch: operation('reviewPatches', 'Accept or discard a detached patch with the expected revision.',
        decideChangePatch.safeExtend({ patchId: scopedUuid, key: requestKey }),
        ({ patchId, key, ...body }) => ({ path: `/change-patches/${patchId}/decision`, method: 'POST', body, idempotencyKey: key })),
    submit_change_review: operation('durableChangeReview', 'Queue model review of a frozen change report with a caller-chosen key.',
        project.extend({ reviewId: scopedUuid, key: requestKey }),
        ({ projectId, reviewId, key }) => ({ path: '/agent-runs/change-review', method: 'POST', body: { projectId, snapshotId: reviewId }, idempotencyKey: key })),
    submit_sast_triage: operation('durableSastTriage', 'Queue triage of selected imported findings with a caller-chosen key.',
        project.extend({ fingerprints: z.array(z.string().regex(/^[a-f0-9]{16}$/)).min(1).max(maxTriageFindings), key: requestKey }),
        ({ projectId, key, ...body }) => ({ path: '/agent-runs/sast-triage', query: { projectId }, method: 'POST', body, idempotencyKey: key })),
    submit_archive_scan: operation('durableArchiveScans', 'Queue a scan of a managed archive and return its persistent task ID.',
        startScanInput.unwrap().extend({ assetId: scopedUuid, key: requestKey }),
        ({ assetId, key, ...body }) => ({ path: `/assets/${assetId}/scan-tasks`, method: 'POST', body, idempotencyKey: key })),
    inspect_archive_scan: operation('durableArchiveScans', 'Read a managed archive scan state and its execution attempts.',
        z.strictObject({ taskId: scopedUuid }), ({ taskId }) => ({ path: `/scan-tasks/${taskId}/execution` })),
    control_archive_scan: operation('durableArchiveScans', 'Pause, resume, cancel or reprioritize a managed archive scan.',
        z.strictObject({ taskId: scopedUuid, revision: z.int().nonnegative(), action: z.enum(['pause', 'resume', 'cancel', 'prioritize']),
            priority: z.int().min(-10).max(10).optional() }),
        ({ taskId, ...body }) => ({ path: `/scan-tasks/${taskId}/execution`, method: 'POST', body })),
    propose_review_rule: operation('reviewRuleCandidates', 'Create a rule candidate with human decisions from exact repository reviews.',
        reviewRuleInput.safeExtend({ projectId: project.shape.projectId, key: requestKey }),
        ({ projectId, key, ...body }) => ({ path: '/change-rule-candidates', query: { projectId }, method: 'POST', body, idempotencyKey: key })),
    inspect_review_rule_candidate: operation('reviewRuleCandidates', 'Read a rule candidate and its authorized review decision references.',
        z.strictObject({ candidateId: scopedUuid }), ({ candidateId }) => ({ path: `/change-rule-candidates/${candidateId}` })),
    inspect_change_scope: operation('scopedChangeReview', 'Read an authorized set of repository reports by scope ID.',
        z.strictObject({ scopeId: scopedUuid }), ({ scopeId }) => ({ path: `/change-reviews/scopes/${scopeId}` })),
    read_change_finding_history: operation('structuredChangeFindings', 'Read decisions for a finding on a frozen report.',
        project.extend({ reviewId: scopedUuid, findingId: z.string().regex(/^[a-f0-9]{64}$/), offset: z.int().nonnegative().optional() }),
        ({ reviewId, findingId, ...query }) => ({ path: `/change-reviews/${reviewId}/findings/${findingId}`, query })),
    decide_change_finding: operation('structuredChangeFindings', 'Record a human disposition on one frozen report finding.',
        reviewFindingDecision.extend({ projectId: project.shape.projectId, reviewId: scopedUuid,
            findingId: z.string().regex(/^[a-f0-9]{64}$/), key: requestKey }),
        ({ projectId, reviewId, findingId, key, ...body }) => ({ path: `/change-reviews/${reviewId}/findings/${findingId}`,
            query: { projectId }, method: 'POST', body, idempotencyKey: key })),
    submit_isolated_verification: operation('isolatedVerification', 'Run selected Node test files from a frozen snapshot in the configured isolated worker.',
        verificationInput.extend({ key: requestKey }),
        ({ key, ...body }) => ({ path: '/verifications', method: 'POST', body, idempotencyKey: key })),
    inspect_isolated_verification: operation('verificationHistory', 'Read an authorized verifier run and receipt by ID.',
        z.strictObject({ runId: scopedUuid }), ({ runId }) => ({ path: `/verifications/${runId}` })),
    submit_wiki: operation('durableWiki', 'Queue Wiki generation using a caller-chosen idempotency key.',
        project.extend({ key: requestKey, mode: z.enum(['incremental', 'full']).optional(),
            notBefore: z.iso.datetime({ offset: true }).optional() }),
        ({ key, ...query }) => ({ path: '/summaries/generate', method: 'POST', query, idempotencyKey: key })),
    inspect_run: operation('durableWiki', 'Read a repository run by ID.', run,
        ({ runId, ...query }) => ({ path: `/agent-runs/${runId}`, query })),
    inspect_run_execution: operation('durableWiki', 'Read the revision and execution state of a durable Wiki or Git sync run.', run,
        ({ runId, ...query }) => ({ path: `/agent-runs/${runId}/execution`, query })),
    list_run_attempts: operation('durableWiki', 'Read claimed and completed attempts of an authorized durable repository run.', run,
        ({ runId, ...query }) => ({ path: `/agent-runs/${runId}/execution/attempts`, query })),
    control_run_execution: operation('durableWiki', 'Pause, resume, cancel or reprioritize an authorized durable run.',
        run.extend({ action: z.enum(['pause', 'resume', 'cancel', 'prioritize']), revision: z.int().nonnegative(),
            priority: z.int().min(-10).max(10).optional() }),
        ({ projectId, runId, ...body }) => ({ path: `/agent-runs/${runId}/execution`, query: { projectId }, method: 'POST', body })),
    list_project_spaces: operation('projectSpaces', 'List project spaces visible to the current identity.', z.object({}).strict(),
        () => ({ path: '/spaces' })),
    create_project_space: operation('spaceAdministration', 'Create a space owned by the caller.', z.object({ name: spaceItemName }).strict(),
        body => ({ path: '/spaces', method: 'POST', body })),
    inspect_project_space: operation('spaceAdministration', 'Read a space’s current settings and visible repository links.', space,
        ({ spaceId }) => ({ path: `/spaces/${spaceId}` })),
    list_deleted_spaces: operation('spaceAdministration', 'List deleted spaces the current identity can restore.', z.object({}).strict(),
        () => ({ path: '/spaces', query: { deleted: true } })),
    update_project_space: operation('spaceAdministration', 'Update a space’s limits, name or lifecycle with its expected revision.',
        spaceUpdateInput.extend({ spaceId: spaceUuid }), ({ spaceId, ...body }) => ({ path: `/spaces/${spaceId}`, method: 'PATCH', body })),
    list_space_members: operation('spaceAdministration', 'Read the authorized space member roster.', space,
        ({ spaceId }) => ({ path: `/spaces/${spaceId}/members`, query: { details: true } })),
    set_space_member: operation('spaceAdministration', 'Grant or revoke a space role by account ID or exact username with the expected revision.',
        space.extend({ change: spaceMemberInput }), ({ spaceId, change }) => ({ path: `/spaces/${spaceId}/members`, method: 'PUT', body: change })),
    transfer_space_ownership: operation('spaceAdministration', 'Transfer ownership to an active account using the expected space revision.',
        spaceTransferInput.extend({ spaceId: spaceUuid }), ({ spaceId, ...body }) => ({ path: `/spaces/${spaceId}/transfer`, method: 'POST', body })),
    list_space_items: operation('spaceAdministration', 'List documents and folders at the root or in an authorized parent folder.',
        space.extend({ parentId: spaceUuid.optional() }), ({ spaceId, ...query }) => ({ path: `/spaces/${spaceId}/items`, query })),
    move_space_item: operation('spaceAdministration', 'Rename or move a space document or folder while retaining its ID and versions.',
        spaceItemPlacement.extend({ spaceId: spaceUuid, itemId: spaceUuid }), ({ spaceId, itemId, ...body }) => ({
            path: `/spaces/${spaceId}/items/${itemId}`, method: 'PATCH', body
        })),
    link_space_repository: operation('spaceAdministration', 'Link a repository or its exact published snapshot to a space.',
        spaceLinkInput.extend({ spaceId: spaceUuid }), ({ spaceId, ...body }) => ({ path: `/spaces/${spaceId}/repositories`, method: 'POST', body })),
    unlink_space_repository: operation('spaceAdministration', 'Detach a repository link using the expected space revision.', spaceRepository,
        ({ spaceId, projectId, revision }) => ({ path: `/spaces/${spaceId}/repositories/${projectId}`, method: 'DELETE', query: { revision } })),
    list_detached_space_repositories: operation('spaceAdministration', 'List detached repository links available to the space editor.', space,
        ({ spaceId }) => ({ path: `/spaces/${spaceId}/repositories/detached` })),
    restore_space_repository: operation('spaceAdministration', 'Restore a detached repository link with its previous snapshot selection.', spaceRepository,
        ({ spaceId, projectId, revision }) => ({ path: `/spaces/${spaceId}/repositories/${projectId}/restore`, method: 'POST', body: { revision } })),
    list_space_trash: operation('spaceAdministration', 'List recoverable deletion batches in a writable space.', space,
        ({ spaceId }) => ({ path: `/spaces/${spaceId}/trash` })),
    trash_space_item: operation('spaceAdministration', 'Move a space document or folder to the recoverable trash.',
        space.extend({ itemId: spaceUuid }), ({ spaceId, itemId }) => ({ path: `/spaces/${spaceId}/items/${itemId}`, method: 'DELETE' })),
    restore_space_trash: operation('spaceAdministration', 'Restore a space deletion batch, optionally under a new name.',
        spaceTrash.extend({ name: spaceItemName.optional() }), ({ spaceId, batchId, ...body }) => ({
            path: `/spaces/${spaceId}/trash/${batchId}/restore`, method: 'POST', body
        })),
    purge_space_trash: operation('spaceAdministration', 'Permanently remove a space deletion batch and its versions.', spaceTrash,
        ({ spaceId, batchId }) => ({ path: `/spaces/${spaceId}/trash/${batchId}`, method: 'DELETE' })),
    generate_space_document: operation('spaceDocumentGeneration', 'Explicitly authorize generation of a new space Markdown document or revision.',
        spaceDocumentGeneration.extend({ spaceId: scopedUuid }), ({ spaceId, ...body }) => ({
            path: `/spaces/${spaceId}/documents/generate`, method: 'POST', body
        })),
    create_ask_session: operation('ask', 'Start a private Ask session with explicit frozen scopes or private attachments.',
        askSessionInput.safeExtend({ key: requestKey.optional() }),
        ({ key, ...body }) => ({ path: '/ask/sessions', method: 'POST', body, idempotencyKey: key,
            feature: body.review ? 'askChangeReview' : body.attachments?.some(item => 'pdfBase64' in item) ? 'askPdfAttachments'
                : body.attachments?.length ? 'askAttachments' : undefined })),
    submit_ask_turn: operation('ask', 'Submit an idempotent Ask turn to a private session.',
        askTurnInput.extend({ sessionId: scopedUuid, key: requestKey }),
        ({ sessionId, key, ...body }) => ({ path: `/ask/sessions/${sessionId}/turns`, method: 'POST', body, idempotencyKey: key,
            feature: body.context.some(item => 'attachmentId' in item && item.page !== undefined) ? 'askPdfAttachments'
                : body.context.some(item => 'page' in item && item.page !== undefined) ? 'pdfSpaceDocuments'
                : body.context.some(item => 'attachmentId' in item) ? 'askAttachments' : undefined })),
    read_ask_context: operation('askContext', 'Read the bounded history and verified citations carried by a private Ask session.', session,
        ({ sessionId }) => ({ path: `/ask/sessions/${sessionId}/context` })),
    list_ask_attachments: operation('askAttachments', 'List private attachment versions and removal states for a conversation.', session,
        ({ sessionId }) => ({ path: `/ask/sessions/${sessionId}/attachments` })),
    read_ask_attachment: operation('askAttachments', 'Read text or indexed PDF pages for an exact private attachment version.',
        attachment.extend({ versionId: scopedUuid }),
        ({ sessionId, attachmentId, versionId }) => ({ path: `/ask/sessions/${sessionId}/attachments/${attachmentId}`, query: { versionId } })),
    change_ask_attachment: operation('askAttachments', 'Remove or restore a private attachment with its revision.',
        attachment.extend({ key: requestKey, action: z.enum(['remove', 'restore']), revision: z.int().nonnegative() }),
        ({ sessionId, attachmentId, key, ...body }) => ({ path: `/ask/sessions/${sessionId}/attachments/${attachmentId}`, method: 'POST',
            body, idempotencyKey: key })),
    read_ask_events: operation('ask', 'Read private Ask events after a saved cursor.',
        session.extend({ after: z.int().nonnegative().optional(), limit: z.int().min(1).max(100).optional() }),
        ({ sessionId, ...query }) => ({ path: `/ask/sessions/${sessionId}/events`, query })),
    cancel_ask_turn: operation('ask', 'Cancel a turn in your private Ask session.', turn,
        ({ sessionId, turnId }) => ({ path: `/ask/sessions/${sessionId}/turns/${turnId}/cancel`, method: 'POST' })),
    list_ask_turn_attempts: operation('ask', 'Read attempt history for a turn in your private Ask session.', turn,
        ({ sessionId, turnId }) => ({ path: `/ask/sessions/${sessionId}/turns/${turnId}/attempts` }))
};

export function serviceContract(vectorSearch: boolean, { deviceAuthorization = false, mcpHttp = false,
    collaborationIngress = false, externalIdentity = false, isolatedVerification = false } = {}) {
    return {
        service: 'repograph', apiVersion: 1, transports: ['rest', 'mcp-stdio', ...(mcpHttp ? ['mcp-http'] : [])],
        scopes: ['repository', 'publishedSnapshot', 'projectSpace', 'wikiRevision', 'documentVersion'],
        features: { ...Object.fromEntries(serviceFeatures.map(feature => [feature, true])), vectorSearch,
            deviceAuthorization, mcpHttp, collaborationIngress, externalIdentity, isolatedVerification },
        operations: Object.fromEntries(Object.entries(serviceOperations).map(([name, spec]) => [name, { feature: spec.feature }])),
        limits: { repositorySearchScopes: 8, knowledgeSearchScopes: 8, knowledgeSearchDocumentVersions: 24, askContextItems: 4 }
    };
}

export const serviceContractShape = z.object({ service: z.literal('repograph'), apiVersion: z.literal(1),
    features: z.record(z.string(), z.boolean()) });
