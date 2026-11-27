import { zipSync } from 'fflate';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { agentRunIdPattern } from './agent-runs.js';
import { HttpError } from './http-error.js';
import { documentFont } from './pdf-font.js';
import type { ReportSnapshot } from './review-queue.js';

export const reviewFormat = z.enum(['json', 'markdown', 'pdf']);
type Format = z.infer<typeof reviewFormat>;
export const reviewBatch = z.object({ snapshotIds: z.array(z.string().regex(agentRunIdPattern)).min(1).max(100),
    format: z.string().trim().toLowerCase().pipe(reviewFormat) });
const MAX_BATCH = 32 * 1024 * 1024;

function content(snapshot: ReportSnapshot) {
    const title = '审核报告快照';
    const labels = [snapshot.id, `项目 ${snapshot.projectId}`, `Schema ${snapshot.schemaVersion} · RepoGraph ${snapshot.toolVersion}`,
        `代码版本 ${snapshot.codeVersion || '未提供'} · 规则版本 ${snapshot.ruleVersion || '未提供'}`, `生成时间 ${snapshot.generatedAt}`];
    const findings = snapshot.reports.map(report => ({
        title: `${report.finding.tool} · ${report.finding.ruleId}`,
        labels: [report.finding.fingerprint, `${report.finding.filePath}:${report.finding.startLine}–${report.finding.endLine}`,
            [report.finding.severity, report.finding.cwe, report.verdict].filter(Boolean).join(' · '), report.finding.message,
            ...(snapshot.legacyImported || report.decisionEvidence.length ? [
                `置信度 ${report.confidence}`, report.developerSummary, ...report.reasons, report.remediation,
                ...report.decisionEvidence.map(item => [item.source, item.applied ? '已采用' : '未采用', item.reference, item.summary].filter(Boolean).join(' · '))
            ].filter(Boolean) : []),
            ...report.missingInfo],
        citations: report.pack.evidence.map(value => ({ label: `${value.citationId} · ${value.qualifiedName} · ${value.filePath}:${value.startLine}–${value.endLine}`,
            excerpt: value.excerpt }))
    }));
    return { title, labels, findings };
}

function markdown(snapshot: ReportSnapshot) {
    const { title, labels, findings } = content(snapshot);
    const safe = (value: string) => value.replace(/[\r\n]/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/[\\`*_{}\[\]()#+!|~]/g, '\\$&');
    const output = ['# ' + title, '', ...labels.map(label => '- ' + safe(label)), ''];
    for (const item of findings) {
        output.push('## ' + safe(item.title), '', ...item.labels.map(label => '- ' + safe(label)), '');
        for (const citation of item.citations) {
            output.push('### ' + safe(citation.label), '', ...citation.excerpt.split(/\r?\n/).map(line => '    ' + line), '');
        }
    }
    return Buffer.from(output.join('\n'));
}

async function pdf(snapshot: ReportSnapshot) {
    const { title, labels, findings } = content(snapshot);
    const embedded = await documentFont();
    const document = new PDFDocument({ size: 'A4', margin: 42, lang: 'zh-CN', info: { Title: title, Creator: 'RepoGraph' } });
    const chunks: Buffer[] = [];
    const output = new Promise<Buffer>((resolve, reject) => {
        document.on('data', chunk => chunks.push(chunk));
        document.once('error', reject);
        document.once('end', () => resolve(Buffer.concat(chunks)));
    });
    try {
        document.font(embedded);
        document.fontSize(20).fillColor('#17202a').text(title).moveDown(0.45);
        document.fontSize(10).fillColor('#405163');
        for (const line of labels) document.text(line, { lineGap: 2 });
        for (const finding of findings) {
            document.moveDown().fontSize(15).fillColor('#17202a').text(finding.title).moveDown(0.3);
            document.fontSize(10).fillColor('#263746');
            for (const line of finding.labels) document.text(line, { lineGap: 2 });
            for (const citation of finding.citations) {
                document.moveDown(0.5).fontSize(10).fillColor('#18447a').text(citation.label);
                document.fontSize(9).fillColor('#263746');
                for (const line of citation.excerpt.split(/\r?\n/)) {
                    for (const part of line.match(/.{1,160}/gu) ?? [' ']) document.text(part.replace(/\t/g, '    '), { indent: 10, lineGap: 1 });
                }
            }
        }
        document.end();
    } catch {
        document.destroy();
        void output.catch(() => undefined);
        throw new HttpError(500, 'REVIEW_PDF_FAILED');
    }
    return output;
}

const metadata: Record<Format, [string, string]> = {
    json: ['json', 'application/json; charset=utf-8'], markdown: ['md', 'text/markdown; charset=utf-8'], pdf: ['pdf', 'application/pdf']
};

export async function exportReview(snapshot: ReportSnapshot, format: Format) {
    const [extension, type] = metadata[format];
    const payload = format === 'json' ? Buffer.from(JSON.stringify(snapshot)) : format === 'markdown' ? markdown(snapshot) : await pdf(snapshot);
    return { payload, type, extension };
}

export async function exportReviewBatch(ids: string[], format: Format, load: (id: string) => ReportSnapshot | undefined) {
    const files: Record<string, Uint8Array> = {};
    const included: { projectId: string }[] = [];
    const manifest: { snapshotId: string; status: string; file: string; reason: string }[] = [];
    let size = 0;
    for (const id of new Set(ids)) {
        const snapshot = load(id);
        if (!snapshot) { manifest.push({ snapshotId: id, status: 'missing', file: '', reason: 'SNAPSHOT_UNAVAILABLE' }); continue; }
        let artifact;
        try { artifact = await exportReview(snapshot, format); }
        catch { manifest.push({ snapshotId: id, status: 'failed', file: '', reason: 'SNAPSHOT_EXPORT_FAILED' }); continue; }
        if (size + artifact.payload.length > MAX_BATCH) {
            manifest.push({ snapshotId: id, status: 'failed', file: '', reason: 'BATCH_SIZE_LIMIT' });
            continue;
        }
        size += artifact.payload.length;
        const file = `snapshots/${id}/report.${artifact.extension}`;
        files[file] = artifact.payload;
        included.push({ projectId: snapshot.projectId });
        manifest.push({ snapshotId: id, status: 'exported', file, reason: '' });
    }
    if (!included.length) throw new HttpError(404, 'NO_REVIEW_SNAPSHOTS_EXPORTED');
    files['manifest.json'] = Buffer.from(JSON.stringify(manifest));
    return { zip: zipSync(files, { level: 1 }), included };
}
