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
        '', ...(snapshot.provenance?.scope === 'WORKING_COPY_OVERLAY' ? [
            'Evidence comes from selected paths captured from the working copy.', '',
            '- Base snapshot ' + snapshot.provenance.baseSnapshotId, '- Base commit ' + snapshot.provenance.baseCommit,
            '- Overlay digest ' + snapshot.provenance.overlayDigest,
            '- Selected paths ' + snapshot.provenance.selectedPaths
        ] : snapshot.provenance ? [
            'Evidence comes from the published indexed source.', '',
            '- Base snapshot ' + (snapshot.provenance.baseSnapshotId ?? '∅'),
            '- Target snapshot ' + snapshot.provenance.targetSnapshotId,
            '- Comparison ' + snapshot.provenance.mode + ' · ' + snapshot.provenance.baselineReason
        ] : ['Evidence comes from the captured index. Version labels are caller-provided.']), ''
    ];
    if (snapshot.checkCoverage?.length) {
        lines.push('## Check coverage', '');
        for (const check of snapshot.checkCoverage) {
            lines.push('- ' + inline(check.tool) + ' · ' + check.status + ' · ' + check.provenance
                + ('receipt' in check ? ' · ' + check.accepted + '/' + check.reported + ' · ' + check.receipt : ''));
        }
        lines.push('');
    }
    if (snapshot.dependencyCheck) {
        const check = snapshot.dependencyCheck;
        lines.push('## Offline dependency check', '', check.tool + ' · ' + check.status + ' · ' + check.provenance,
            '- Findings ' + check.findingCount + ' · Comparable components ' + check.comparableComponents
                + ' · Unverified ' + check.unverifiedComponents + ' · Unsupported ' + check.unsupportedComponents,
            ...(check.manifestDigest ? ['- Manifest digest ' + check.manifestDigest] : []),
            ...(check.catalogDigest ? ['- Advisory catalog digest ' + check.catalogDigest] : []),
            ...check.reasons.map(reason => '- ' + inline(reason)),
            ...check.preview.map(finding => '- ' + inline(finding.id) + ' · ' + inline(finding.coordinate) + ' @ ' + inline(finding.version)
                + ' · ' + finding.severity + ' · ' + finding.manifests.map(inline).join(', ')), '');
    }
    if (snapshot.structuredFindings?.length) {
        lines.push('## Structured findings', '');
        for (const finding of snapshot.structuredFindings) {
            lines.push('- ' + finding.id + ' · ' + inline(finding.tool) + ' · ' + inline(finding.ruleId) + ' · '
                + inline(finding.location.path) + ':' + finding.location.startLine + ' · ' + finding.publishability + ' · '
                + finding.snapshotId);
        }
        lines.push('');
    }
    lines.push('## Hunk Ledger', '');
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
