import { structuredPatch } from 'diff';
import { sourceChanges } from './knowledge-snapshots.js';
import type { KnowledgeSnapshots, SourceChange } from './knowledge-snapshots.js';
import type { WorkingFile } from './review-working-copy.js';
import { digest } from './source.js';
import type { DiffFile } from './unified-diff.js';

const maxFiles = 512;
const maxText = 256 * 1024;
const maxReviewText = 2_000_000;

export function snapshotDiff(snapshots: KnowledgeSnapshots, baseId: string | null, targetId: string) {
    return compareSources(snapshots.compareSources(baseId, targetId), path => baseId ? snapshots.source(baseId, path) : undefined,
        path => snapshots.source(targetId, path));
}

export function capturedText(bytes: Uint8Array) {
    try {
        const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        return value.includes('\0') ? null : value;
    } catch { return null; }
}

export function workingCopyDiff(files: WorkingFile[]) {
    const manifest = (side: 'base' | 'target') => files.flatMap(file => file[side]
        ? [{ path: file.path, hash: digest(file[side]), indexHash: '' }] : []);
    const byPath = new Map(files.map(file => [file.path, file]));
    const source = (path: string, side: 'base' | 'target') => {
        const bytes = byPath.get(path)?.[side];
        if (!bytes) return undefined;
        const text = capturedText(bytes);
        return { text, size: bytes.length, binary: text === null };
    };
    return compareSources(sourceChanges(manifest('base'), manifest('target')), path => source(path, 'base'), path => source(path, 'target'));
}

type Source = { text: string | null; size: number; binary: boolean } | undefined;
function compareSources(changesWithIndex: SourceChange[], before: (path: string) => Source, after: (path: string) => Source) {
    const changes = changesWithIndex.filter(item => item.kind !== 'REINDEXED');
    const files: DiffFile[] = [];
    const errors = new Set<string>();
    const deadline = performance.now() + 900;
    let remaining = maxReviewText;
    if (changes.length > maxFiles) errors.add('DIFF_FILE_LIMIT');
    for (const item of changes.slice(0, maxFiles)) {
        if (item.kind === 'REINDEXED') continue;
        const oldPath = item.kind === 'ADDED' ? '' : item.previousPath ?? item.path;
        const newPath = item.kind === 'DELETED' ? '' : item.path;
        const kind: DiffFile['kind'] = item.kind === 'MOVED' ? 'RENAMED' : item.kind;
        const file: DiffFile = { oldPath, newPath, kind, hunks: [], errors: [], hunkCandidates: [] };
        files.push(file);
        if (kind === 'RENAMED') continue;
        const time = Math.min(30, Math.floor(deadline - performance.now()));
        if (time <= 0 || remaining <= 0) {
            file.errors.push('DIFF_COMPARISON_BUDGET');
            errors.add('DIFF_COMPARISON_BUDGET');
            continue;
        }
        const old = oldPath ? before(oldPath) : undefined;
        const next = newPath ? after(newPath) : undefined;
        if (oldPath && !old || newPath && !next) {
            file.errors.push('DIFF_SOURCE_UNAVAILABLE');
            errors.add('DIFF_SOURCE_UNAVAILABLE');
            continue;
        }
        if (old?.binary || next?.binary || old?.text?.includes('\0') || next?.text?.includes('\0')) {
            file.kind = 'BINARY';
            continue;
        }
        if ((old?.size ?? 0) + (next?.size ?? 0) > maxText) {
            file.errors.push('DIFF_FILE_BYTE_LIMIT');
            errors.add('DIFF_FILE_BYTE_LIMIT');
            continue;
        }
        const patch = structuredPatch(oldPath, newPath, old?.text ?? '', next?.text ?? '', undefined, undefined, {
            context: 3, timeout: time, maxEditLength: 4000
        });
        const size = patch?.hunks.reduce((count, hunk) => count + hunk.lines.reduce((total, line) => total + line.length + 1, 0), 0);
        if (!patch || size === undefined || size > remaining) {
            file.errors.push('DIFF_COMPARISON_BUDGET');
            errors.add('DIFF_COMPARISON_BUDGET');
            continue;
        }
        remaining -= size;
        file.hunks = patch.hunks.map(hunk => {
            const oldStart = hunk.oldLines ? hunk.oldStart : hunk.oldStart - 1;
            const newStart = hunk.newLines ? hunk.newStart : hunk.newStart - 1;
            return { oldStart, newStart, oldCount: hunk.oldLines, newCount: hunk.newLines,
                header: `@@ -${oldStart},${hunk.oldLines} +${newStart},${hunk.newLines} @@`, lines: hunk.lines };
        });
        file.hunkCandidates = file.hunks.map((_, index) => ({ ordinal: index + 1, hunkIndex: index, error: '' }));
    }
    return { files, errors: [...errors], totalFiles: changes.length };
}
