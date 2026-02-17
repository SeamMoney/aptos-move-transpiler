/**
 * Move Parser — public API
 *
 * Provides Move source code parsing and validation using tree-sitter,
 * abstracted so consumers don't need tree-sitter knowledge.
 *
 * Requires optional dependencies: tree-sitter, tree-sitter-move-on-aptos
 * Check availability with isMoveParserAvailable() before calling parse/validate.
 */

import { getMoveParser, isMoveParserAvailable as checkAvailable } from './loader.js';
import { convertNode, extractErrors } from './node-converter.js';
import type { MoveParseResult, MoveValidationResult } from './types.js';

// Re-export types
export type {
  MoveParseResult,
  MoveParseError,
  MoveValidationResult,
  MoveParseNode,
  MoveSourcePosition,
} from './types.js';

// Re-export loader utilities
export { resetMoveParser } from './loader.js';

/**
 * Check if the tree-sitter Move parser is available in this environment.
 * Returns false if native addons are not installed. Never throws.
 */
export const isMoveParserAvailable = checkAvailable;

/**
 * Parse Move source code into a full syntax tree.
 *
 * @param source - Move source code string
 * @returns Parse result with tree and any errors
 * @throws Error if tree-sitter is not available (check with isMoveParserAvailable first)
 *
 * @example
 * ```ts
 * import { parseMoveCode } from 'sol2move';
 *
 * const result = await parseMoveCode(`
 *   module 0x1::example {
 *     public fun add(a: u64, b: u64): u64 { a + b }
 *   }
 * `);
 *
 * if (result.success) {
 *   console.log(result.tree.type); // "source_file"
 *   const mod = result.tree.children[0];
 *   console.log(mod.fieldChild('name')?.text); // "0x1::example"
 * }
 * ```
 */
export async function parseMoveCode(source: string): Promise<MoveParseResult> {
  const parser = await getMoveParser();
  const tree = parser.parse(source);
  const rootNode = tree.rootNode;
  const errors = extractErrors(rootNode);

  return {
    success: errors.length === 0,
    tree: convertNode(rootNode),
    errors,
  };
}

/**
 * Validate Move source code for syntactic correctness.
 * Lighter than parseMoveCode — returns pass/fail, errors, and a structure summary.
 *
 * @param source - Move source code string
 * @returns Validation result with errors and optional structure info
 * @throws Error if tree-sitter is not available
 *
 * @example
 * ```ts
 * import { transpile, validateMoveCode } from 'sol2move';
 *
 * const result = transpile(soliditySource);
 * for (const mod of result.modules) {
 *   const validation = await validateMoveCode(mod.code);
 *   if (!validation.valid) {
 *     console.log(`${mod.name}: syntax errors`, validation.errors);
 *   } else {
 *     console.log(`${mod.name}: OK`, validation.structure);
 *   }
 * }
 * ```
 */
export async function validateMoveCode(source: string): Promise<MoveValidationResult> {
  const parser = await getMoveParser();
  const tree = parser.parse(source);
  const rootNode = tree.rootNode;
  const errors = extractErrors(rootNode);

  let structure: MoveValidationResult['structure'] = undefined;
  if (errors.length === 0) {
    structure = extractStructure(rootNode);
  }

  return {
    valid: errors.length === 0,
    errors,
    structure,
  };
}

/**
 * Extract high-level structure (module/function/struct names) from a parsed tree.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractStructure(rootNode: any): NonNullable<MoveValidationResult['structure']> {
  const modules: string[] = [];
  const functions: string[] = [];
  const structs: string[] = [];

  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const child = rootNode.namedChild(i);
    if (child.type === 'module_declaration') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) modules.push(nameNode.text);

      const bodyNode = child.childForFieldName('body');
      if (bodyNode) {
        for (let j = 0; j < bodyNode.namedChildCount; j++) {
          const item = bodyNode.namedChild(j);
          if (item.type === 'function_declaration') {
            const fn = item.childForFieldName('name');
            if (fn) functions.push(fn.text);
          } else if (item.type === 'struct_declaration') {
            const sn = item.childForFieldName('name');
            if (sn) structs.push(sn.text);
          }
        }
      }
    }
  }

  return { modules, functions, structs };
}
