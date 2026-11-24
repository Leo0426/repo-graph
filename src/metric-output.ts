import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ComplexityMetric, PackageDependency } from './code-metrics.js';

const git = promisify(execFile);

export async function gitChurn(root: string, signal: AbortSignal) {
    const counts = new Map<string, number>();
    try {
        if (await realpath(root) !== root || signal.aborted) return counts;
        const { stdout } = await git('git', [
            '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'log.showSignature=false',
            '--no-pager', '--no-replace-objects', '--literal-pathspecs', '-C', root, 'log',
            '--format=', '--name-only', '-z', '--max-count=1000', '--relative', '--no-renames', '--no-ext-diff', '--no-textconv',
            'HEAD', '--', '.'
        ], {
            timeout: 5000, maxBuffer: 4 * 1024 * 1024, signal,
            env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0',
                GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '' }
        });
        for (const path of stdout.split('\0')) if (path) counts.set(path, (counts.get(path) ?? 0) + 1);
    } catch {
        // Git history is optional. A partial subprocess response is not a complete sample.
    }
    return counts;
}

export function sourceHotspots(complexity: ComplexityMetric[], churn: Map<string, number>, limit: number) {
    const byFile = new Map<string, { totalComplexity: number; methodCount: number; churnCount: number }>();
    for (const item of complexity) {
        const churnCount = churn.get(item.filePath);
        if (!churnCount) continue;
        const entry = byFile.get(item.filePath) ?? { totalComplexity: 0, methodCount: 0, churnCount };
        entry.totalComplexity += item.complexity;
        entry.methodCount++;
        byFile.set(item.filePath, entry);
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    return [...byFile].map(([filePath, { totalComplexity, methodCount, churnCount }]) => {
        const average = totalComplexity / methodCount;
        return { filePath, churnCount, methodCount, avgComplexity: round(average), hotspotScore: round(Math.log1p(churnCount) * average) };
    }).sort((a, b) => b.hotspotScore - a.hotspotScore || a.filePath.localeCompare(b.filePath)).slice(0, limit);
}

export function packageGraph(projectId: string, edges: PackageDependency[], format: 'dot' | 'mermaid') {
    const nodes = [...new Set(edges.flatMap(({ from, to }) => [from, to]))].sort();
    const cyclic = new Set(edges.filter(edge => edge.cyclic).flatMap(({ from, to }) => [from, to]));
    if (format === 'dot') {
        const quote = (value: string) => '"' + value.replace(/[\x00-\x1f\x7f]/g, '�').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        return [
            'digraph RepoGraph {', '    rankdir=LR;', '    graph [label=' + quote(projectId) + '];', '    node [shape=box];',
            ...nodes.map(node => '    ' + quote(node) + ' [label=' + quote(node)
                + (cyclic.has(node) ? ', color=red, style=filled, fillcolor="#fff0f0"' : '') + '];'),
            ...edges.map(edge => '    ' + quote(edge.from) + ' -> ' + quote(edge.to) + ' [label="' + edge.count + '"'
                + (edge.cyclic ? ', color=red' : '') + '];'), '}', ''
        ].join('\n');
    }
    const ids = new Map(nodes.map((node, index) => [node, 'pkg' + (index + 1)]));
    const label = (name: string) => name.replace(/[^\p{L}\p{N}._\-\/ ]/gu, char => '#' + char.codePointAt(0) + ';');
    return [
        'graph LR',
        ...nodes.map(node => '    ' + ids.get(node) + '["' + label(node) + '"]' + (cyclic.has(node) ? ':::cyclic' : '')),
        ...(cyclic.size ? ['    classDef cyclic fill:#fff0f0,stroke:#cc0000,color:#660000'] : []),
        ...edges.map(edge => '    ' + ids.get(edge.from) + ' -->|' + edge.count + '| ' + ids.get(edge.to)), ''
    ].join('\n');
}
