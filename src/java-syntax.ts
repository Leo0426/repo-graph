import type { Node } from '@vscode/tree-sitter-wasm';
import { syntaxChildren as javaChildren, syntaxParser } from './syntax-tree.js';
export { sourceLine as javaLine, syntaxChildren as javaChildren } from './syntax-tree.js';

export const parseJavaSyntax = await syntaxParser('@vscode/tree-sitter-wasm/wasm/tree-sitter-java.wasm');

export function erasedJavaType(node: Node | null): string {
    if (!node) return '';
    if (node.type === 'array_type') {
        return erasedJavaType(node.childForFieldName('element')) + brackets(node.childForFieldName('dimensions'));
    }
    if (node.type === 'generic_type' || node.type === 'scoped_type_identifier' || node.type === 'annotated_type') {
        return javaChildren(node).filter(child => child.type !== 'type_arguments' && !['annotation', 'marker_annotation'].includes(child.type))
            .map(erasedJavaType).join(node.type === 'scoped_type_identifier' ? '.' : '');
    }
    return node.text.replace(/\s+/g, '');
}

export function brackets(dimensions: Node | null) { return '[]'.repeat(dimensions?.children.filter(child => child?.type === '[').length ?? 0); }
