import { z } from 'zod';

export const maxSpaceDocumentBytes = 2 * 1024 * 1024;
export const spaceRoles = ['VIEWER', 'EDITOR', 'ADMIN'] as const;
export const spaceUuid = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
export const spaceProjectId = z.string().regex(/^[a-f0-9]{12}$/);
export const spaceItemName = z.string().trim().min(1).max(200)
    .refine(value => !/[\u0000-\u001f\u007f/\\]/.test(value) && value !== '.' && value !== '..');
export const spaceRequestKey = z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/);
export const spaceItemPlacement = z.object({ parentId: spaceUuid.nullable().default(null), name: spaceItemName }).strict();
export const spaceRevision = z.int().nonnegative();
export const spaceUpdateInput = z.object({ revision: spaceRevision, name: spaceItemName.optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED', 'DELETED']).optional(), maxRepositories: z.int().min(0).max(500).optional(),
    maxFileBytes: z.int().min(0).max(maxSpaceDocumentBytes).optional(), maxBytes: z.int().min(0).max(1024 * 1024 * 1024).optional() }).strict();
const accountId = z.union([spaceUuid, z.literal('builtin-admin')]);
const memberChange = z.object({ role: z.enum(spaceRoles).nullable(), revision: spaceRevision }).strict();
export const spaceMemberInput = z.union([memberChange.extend({ accountId }), memberChange.extend({
    username: z.string().trim().regex(/^[a-z0-9][a-z0-9_.-]{2,63}$/i)
})]);
export const spaceTransferInput = z.object({ accountId, revision: spaceRevision }).strict();
export const spaceLinkInput = z.object({ projectId: spaceProjectId, revision: spaceRevision, snapshotId: spaceUuid.optional() }).strict();
export const spaceDocumentGeneration = z.object({
    target: z.union([spaceItemPlacement, z.object({ itemId: spaceUuid, baseVersionId: spaceUuid }).strict()]),
    instruction: z.string().trim().min(1).max(4000).refine(value => !value.includes('\0')),
    key: spaceRequestKey
}).strict();
