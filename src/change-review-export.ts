import type { ChangeSnapshot } from './change-review.js';

function inline(value: string) {
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/[\\`*_{}\[\]()#+!|~]/g, '\\$&');
}

function code(text: string) { return text.split('\n').map(line => '    ' + line.replace(/\r/g, '')).join('\n'); }

export function reviewMarkdown(snapshot: ChangeSnapshot) {
    const lines = [
        '# Change Review', '',
        '- Snapshot ' + snapshot.id, '- Project ' + snapshot.projectId, '- Status ' + snapshot.status,
        '- Base version ' + inline(snapshot.baseVersion), '- Target version ' + inline(snapshot.targetVersion),
        '- Source ' + inline(snapshot.source), '- Generated ' + snapshot.generatedAt,
        ...(snapshot.legacyImported ? ['- Snapshot migrated from the legacy instance'] : []),
        '- Hunks ' + snapshot.plannedHunkCount + ' planned, ' + snapshot.omittedHunkCount + ' omitted, ' + snapshot.totalHunkCount + ' total',
        '', 'Evidence comes from the captured index. Version labels are caller-provided.', '', '## Hunk Ledger', ''
    ];
    for (const item of snapshot.hunkLedger) {
        const location = inline(item.oldPath || '∅') + ' → ' + inline(item.newPath || '∅');
        lines.push('- File ' + item.fileIndex + ' / hunk ' + item.hunkOrdinal + ' · ' + location + ' · ' + item.disposition
            + (item.reason ? ' · ' + inline(item.reason) : ''));
    }
    lines.push('', '## Changes', '');
    for (const file of snapshot.files) {
        lines.push('### ' + inline(file.oldPath || '∅') + ' → ' + inline(file.newPath || '∅'), '', file.kind, '');
        for (const hunk of file.hunks) lines.push(code([hunk.header, ...hunk.lines].join('\n')), '');
        for (const error of file.errors) lines.push('- ' + inline(error));
        lines.push('');
    }
    lines.push('## Index evidence', '');
    for (const entry of snapshot.units) {
        lines.push('### ' + inline(entry.unit.filePath), '', 'Unit ' + entry.unit.id + ' · ' + entry.status, '');
        for (const mapping of entry.hunkMappings) {
            lines.push('- Hunk ' + (mapping.hunkIndex + 1) + ' · ' + mapping.status + ' · '
                + mapping.changedRanges.map(range => range.startLine + '–' + range.endLine).join(', '));
            for (const reason of mapping.omittedReasons) lines.push('  - ' + inline(reason));
        }
        lines.push('');
        for (const item of entry.contextPack.evidence) {
            lines.push(inline(item.citationId) + ' · ' + inline(item.qualifiedName) + ' · ' + inline(item.filePath) + ' · ' + item.startLine
                + '–' + item.endLine + ' · ' + inline(item.relation), '', code(item.excerpt), '');
        }
        if (entry.externalFindingReferences.length) {
            lines.push('#### Imported findings', '');
            for (const finding of entry.externalFindingReferences) lines.push('- ' + finding.fingerprint + ' · ' + inline(finding.tool)
                + ' · ' + inline(finding.ruleId) + ' · ' + inline(finding.filePath) + ':' + finding.startLine + ' · ' + finding.version);
            lines.push('');
        }
        if (entry.vulnerabilityReferences.length) {
            lines.push('#### Vulnerability inventory', '');
            for (const finding of entry.vulnerabilityReferences) lines.push('- ' + finding.id + ' · ' + inline(finding.ruleId)
                + ' · ' + inline(finding.filePath) + ':' + finding.startLine + ' · ' + finding.status + ' · ' + finding.version);
            lines.push('');
        }
        for (const [label, ids] of [['Legacy finding fingerprints', entry.legacyReferences?.externalFindingFingerprints],
            ['Legacy vulnerability IDs', entry.legacyReferences?.vulnerabilityIds]] as const) {
            if (ids?.length) lines.push('#### ' + label, '', ...ids.map(id => '- ' + inline(id)), '');
        }
    }
    lines.push('## Omissions', '', ...snapshot.omittedReasons.map(reason => '- ' + inline(reason)), '');
    return lines.join('\n');
}
