/**
 * Sol2Move — Solidity to Aptos Move v2 Transpiler
 *
 * Library entry point. For CLI, see cli.ts.
 */

// SDK — primary interface
export { Sol2Move } from './sdk.js';
export type {
  SolidityAnalysis,
  SolidityValidation,
  ModuleValidation,
  TranspileAndValidateResult,
} from './sdk.js';

// Individual functions (backward compatible)
export { transpile, validate, analyze } from './transpiler.js';
export type { TranspileOptions, TranspileOutput } from './transpiler.js';

// Move parser (requires optional tree-sitter dependencies)
export {
  parseMoveCode,
  validateMoveCode,
  isMoveParserAvailable,
} from './parser/move-parser/index.js';
export type {
  MoveParseResult,
  MoveParseError,
  MoveValidationResult,
  MoveParseNode,
  MoveSourcePosition,
} from './parser/move-parser/index.js';

// Move formatter (requires Aptos CLI)
export {
  formatMoveCode,
  isFormatterAvailable,
  formatMoveModules,
} from './formatter/move-formatter.js';
export type {
  FormatResult,
  FormatOptions,
} from './formatter/move-formatter.js';
