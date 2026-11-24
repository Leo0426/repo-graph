import { createRequire } from 'node:module';
import treeSitter from '@vscode/tree-sitter-wasm';
import type { Node } from '@vscode/tree-sitter-wasm';

const { Parser, Language } = treeSitter;
const require = createRequire(import.meta.url);
await Parser.init();

export async function syntaxParser(grammar: string) {
    const language = await Language.load(require.resolve(grammar));
    const parser = new Parser().setLanguage(language);
    parser.setTimeoutMicros(500_000);
    return (source: string) => {
        const tree = parser.parse(source);
        if (!tree) {
            parser.reset();
            throw new Error('PARSE_TIMEOUT');
        }
        return tree;
    };
}

export function sourceLine(node: Node) { return node.startPosition.row + 1; }
export function sourceEndLine(node: Node) { return Math.max(sourceLine(node), node.endPosition.row + Number(node.endPosition.column > 0)); }
export function syntaxChildren(node: Node | null | undefined) {
    return node?.namedChildren.filter((child): child is Node => child !== null
        && !['comment', 'line_comment', 'block_comment'].includes(child.type)) ?? [];
}
