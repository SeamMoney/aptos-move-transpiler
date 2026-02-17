/**
 * Converts tree-sitter SyntaxNode trees into our MoveParseNode abstraction.
 * Consumers never need to interact with raw tree-sitter types.
 */

import type { MoveParseNode, MoveParseError } from './types.js';

/**
 * Convert a tree-sitter SyntaxNode into a MoveParseNode.
 * Named children are eagerly converted; field access is lazy via closure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function convertNode(tsNode: any): MoveParseNode {
  const children: MoveParseNode[] = [];
  for (let i = 0; i < tsNode.namedChildCount; i++) {
    children.push(convertNode(tsNode.namedChild(i)));
  }

  return {
    type: tsNode.type,
    text: tsNode.text,
    isNamed: tsNode.isNamed,
    hasError: tsNode.hasError,
    startPosition: { row: tsNode.startPosition.row, column: tsNode.startPosition.column },
    endPosition: { row: tsNode.endPosition.row, column: tsNode.endPosition.column },
    startIndex: tsNode.startIndex,
    endIndex: tsNode.endIndex,
    children,

    // Lazy field access — delegates to the original tree-sitter node
    // so we don't eagerly build field maps for every node.
    fieldChild(fieldName: string): MoveParseNode | null {
      const child = tsNode.childForFieldName(fieldName);
      return child ? convertNode(child) : null;
    },
    fieldChildren(fieldName: string): MoveParseNode[] {
      const nodes = tsNode.childrenForFieldName(fieldName);
      return nodes ? nodes.map(convertNode) : [];
    },
  };
}

/**
 * Walk the tree-sitter tree and extract all ERROR and MISSING nodes
 * as MoveParseError objects.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractErrors(tsNode: any): MoveParseError[] {
  const errors: MoveParseError[] = [];
  collectErrors(tsNode, errors);
  return errors;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectErrors(node: any, errors: MoveParseError[]): void {
  if (node.type === 'ERROR' || node.isMissing) {
    errors.push({
      message: node.isMissing
        ? `Missing expected syntax: ${node.type}`
        : `Unexpected syntax: ${node.text.slice(0, 80)}`,
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
      text: node.text.slice(0, 200),
    });
    return; // Don't recurse into ERROR nodes (children are unreliable)
  }

  for (let i = 0; i < node.childCount; i++) {
    collectErrors(node.child(i), errors);
  }
}
