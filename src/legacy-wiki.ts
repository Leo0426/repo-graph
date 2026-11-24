import { z } from 'zod';
import { agentRunIdPattern } from './agent-runs.js';
import { findingPublicText } from './finding-import.js';
import { relativeEvidencePath } from './project-file.js';
import { isSensitiveReviewPath, redactReviewText } from './review-redaction.js';
import type { SummaryDocument } from './wiki.js';

const id = z.string().regex(agentRunIdPattern);
const project = z.string().regex(/^[a-f0-9]{12}$/);
const level = z.enum(['PROJECT', 'PACKAGE']);
const version = z.number().int().positive().max(2_147_483_647);
const text = z.string().nullish().transform(value => value ?? '');
const date = z.iso.datetime({ offset: true });
const sectionSource = z.enum(['facts', 'llm', '']).nullish().transform(value => value || 'facts');
const section = z.object({ title: text, body: text, source: sectionSource });
const citation = z.object({ qualifiedName: text, filePath: text, startLine: z.number().int(), endLine: z.number().int() });
const document = z.object({ id, projectId: project, level, scopeId: z.string(), title: text, docVersion: version, generatedAt: date,
    status: z.enum(['COMPLETED', 'PARTIAL']), model: text, sections: z.array(section).nullish(), citations: z.array(citation).nullish(),
    missingInfo: z.array(z.string()).nullish() });

export const legacyWikiDocument = z.object({ id, project_id: project, level, scope_id: z.string(), doc_version: version,
    generated_at: date, document_json: z.string().max(8_000_000) });

export function prepareLegacyWikiDocuments(rows: z.infer<typeof legacyWikiDocument>[], projects: ReadonlyMap<string, string>) {
    return rows.flatMap(row => {
        const projectId = projects.get(row.project_id);
        if (!projectId) return [];
        const input = document.parse(JSON.parse(row.document_json));
        if (input.id !== row.id || input.projectId !== row.project_id || input.level !== row.level || input.scopeId !== row.scope_id
            || input.docVersion !== row.doc_version || input.generatedAt !== row.generated_at) throw new Error('Legacy Wiki identity mismatch');
        const missingInfo = (input.missingInfo ?? []).map(item => findingPublicText(item, 1500)).filter(Boolean);
        const originalCitations = input.citations ?? [];
        const citations = originalCitations.flatMap(({ qualifiedName, filePath, startLine, endLine }) => {
            const path = relativeEvidencePath(filePath);
            if (!path || path !== findingPublicText(path, 4096) || isSensitiveReviewPath(path)
                || startLine < 1 || endLine < startLine || endLine > 2_147_483_647) return [];
            return [{ qualifiedName: findingPublicText(qualifiedName, 1000), filePath: path, startLine, endLine }];
        });
        if (citations.length < originalCitations.length) missingInfo.push('LEGACY_WIKI_CITATION_UNAVAILABLE');
        const summary: SummaryDocument = { id: row.id, projectId, level: input.level, title: findingPublicText(input.title, 1000),
            scopeId: findingPublicText(input.scopeId, 512), docVersion: input.docVersion, generatedAt: input.generatedAt, status: input.status,
            model: findingPublicText(input.model, 200) || null, missingInfo, citations, factsHash: null, legacyImported: true,
            sections: (input.sections ?? []).map(section => ({ title: findingPublicText(section.title, 1000),
                body: redactReviewText(section.body).replaceAll('\0', ''), source: section.source })) };
        return [summary];
    });
}
