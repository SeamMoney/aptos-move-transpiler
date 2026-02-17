/**
 * Sol2Move SDK
 *
 * Unified interface for Solidity→Move transpilation, analysis, and validation.
 * Designed for both developers and AI agents.
 *
 * @example
 * ```ts
 * import { Sol2Move } from 'sol2move';
 *
 * const sdk = new Sol2Move({ moduleAddress: '0x1', packageName: 'my_project' });
 *
 * // Analyze Solidity
 * const analysis = sdk.analyzeSolidity(soliditySource);
 *
 * // Transpile Solidity → Move
 * const result = sdk.transpile(soliditySource);
 *
 * // Validate generated Move
 * const validation = await sdk.validateMove(result.modules[0].code);
 *
 * // Full pipeline: transpile + validate all output
 * const full = await sdk.transpileAndValidate(soliditySource);
 * ```
 */

import { transpile, validate, analyze } from './transpiler.js';
import type { TranspileOptions, TranspileOutput } from './transpiler.js';
import { generateMoveCode } from './codegen/move-generator.js';
import type { MoveModule } from './types/move-ast.js';
import {
  parseMoveCode,
  validateMoveCode,
  isMoveParserAvailable,
} from './parser/move-parser/index.js';
import type {
  MoveParseResult,
  MoveValidationResult,
  MoveParseError,
} from './parser/move-parser/index.js';
import {
  formatMoveCode,
  isFormatterAvailable,
  formatMoveModules,
} from './formatter/move-formatter.js';
import type { FormatResult, FormatOptions } from './formatter/move-formatter.js';
import {
  compileCheck,
  compileCheckModules,
  isCompilerAvailable,
} from './compiler/move-compiler.js';
import type {
  CompileCheckResult,
  CompileCheckOptions,
  CompileDiagnostic,
} from './compiler/move-compiler.js';

// Re-export types that consumers will interact with
export type { TranspileOptions, TranspileOutput } from './transpiler.js';
export type {
  MoveParseResult,
  MoveParseError,
  MoveValidationResult,
  MoveParseNode,
  MoveSourcePosition,
} from './parser/move-parser/index.js';
export type { MoveModule } from './types/move-ast.js';
export type { FormatResult, FormatOptions } from './formatter/move-formatter.js';
export type {
  CompileCheckResult,
  CompileCheckOptions,
  CompileDiagnostic,
} from './compiler/move-compiler.js';

/**
 * Result of analyzing Solidity source code.
 */
export interface SolidityAnalysis {
  valid: boolean;
  contracts: {
    name: string;
    kind: string;
    functions: string[];
    events: string[];
    stateVariables: string[];
  }[];
  errors: string[];
}

/**
 * Result of validating Solidity source code.
 */
export interface SolidityValidation {
  valid: boolean;
  contracts: string[];
  errors: string[];
}

/**
 * Validation result for a single transpiled module.
 */
export interface ModuleValidation {
  /** Module name */
  name: string;
  /** Whether the generated Move code is syntactically valid */
  valid: boolean;
  /** Syntax errors found (empty if valid) */
  errors: MoveParseError[];
  /** High-level structure if valid */
  structure?: {
    modules: string[];
    functions: string[];
    structs: string[];
  };
}

/**
 * Result of transpile + validate pipeline.
 */
export interface TranspileAndValidateResult {
  /** The transpilation result */
  transpile: TranspileOutput;
  /** Per-module Move syntax validation (null if parser unavailable) */
  moveValidation: ModuleValidation[] | null;
  /** Whether all modules passed syntax validation */
  allValid: boolean;
}

/**
 * Unified SDK for Solidity→Move transpilation.
 *
 * Provides a single entry point for all transpiler capabilities:
 * - Solidity analysis and validation
 * - Solidity→Move transpilation
 * - Move code parsing and validation
 * - Full pipeline (transpile + validate)
 * - Move AST→source code generation
 */
export class Sol2Move {
  private options: TranspileOptions;

  /**
   * Create a new Sol2Move SDK instance.
   *
   * @param options - Default transpilation options applied to all operations.
   *                  Can be overridden per-call.
   *
   * @example
   * ```ts
   * const sdk = new Sol2Move({
   *   moduleAddress: '0x1',
   *   packageName: 'my_dapp',
   *   generateToml: true,
   * });
   * ```
   */
  constructor(options: TranspileOptions = {}) {
    this.options = options;
  }

  // ─── Solidity ─────────────────────────────────────────────────

  /**
   * Validate Solidity source code without transpiling.
   * Checks that the source parses correctly and identifies contract names.
   */
  validateSolidity(source: string): SolidityValidation {
    return validate(source);
  }

  /**
   * Analyze Solidity source code structure.
   * Returns contract names, function names, events, and state variables.
   */
  analyzeSolidity(source: string): SolidityAnalysis {
    return analyze(source);
  }

  // ─── Transpile ────────────────────────────────────────────────

  /**
   * Transpile Solidity source code to Move.
   *
   * @param source - Solidity source code
   * @param overrides - Options that override the SDK defaults for this call
   * @returns Transpilation result with generated modules, Move.toml, errors, warnings
   *
   * @example
   * ```ts
   * const result = sdk.transpile(soliditySource);
   * for (const mod of result.modules) {
   *   console.log(mod.name, mod.code);
   * }
   * ```
   */
  transpile(source: string, overrides: Partial<TranspileOptions> = {}): TranspileOutput {
    return transpile(source, { ...this.options, ...overrides });
  }

  // ─── Move ─────────────────────────────────────────────────────

  /**
   * Check if the Move parser (tree-sitter) is available.
   * Returns false if the optional native dependencies aren't installed.
   */
  isMoveParserAvailable(): Promise<boolean> {
    return isMoveParserAvailable();
  }

  /**
   * Parse Move source code into a full syntax tree.
   * Returns a tree of MoveParseNode objects for traversal and inspection.
   *
   * Requires tree-sitter to be installed. Check with `isMoveParserAvailable()` first.
   *
   * @example
   * ```ts
   * const result = await sdk.parseMove(moveSource);
   * if (result.success) {
   *   const mod = result.tree.children[0];
   *   console.log(mod.fieldChild('name')?.text);
   * }
   * ```
   */
  parseMove(source: string): Promise<MoveParseResult> {
    return parseMoveCode(source);
  }

  /**
   * Validate Move source code for syntactic correctness.
   * Returns pass/fail, errors, and a structure summary (module/function/struct names).
   *
   * @example
   * ```ts
   * const result = await sdk.validateMove(moveSource);
   * if (result.valid) {
   *   console.log('Functions:', result.structure?.functions);
   * } else {
   *   console.log('Errors:', result.errors);
   * }
   * ```
   */
  validateMove(source: string): Promise<MoveValidationResult> {
    return validateMoveCode(source);
  }

  /**
   * Generate Move source code from a MoveModule AST.
   * Useful for programmatically constructing or modifying Move modules.
   */
  generateMove(ast: MoveModule): string {
    return generateMoveCode(ast);
  }

  // ─── Formatter ──────────────────────────────────────────────────

  /**
   * Check if the Move code formatter (`aptos move fmt`) is available.
   * Result is cached after the first call.
   */
  isFormatterAvailable(): boolean {
    return isFormatterAvailable();
  }

  /**
   * Format Move source code using `aptos move fmt` (movefmt).
   *
   * Requires the Aptos CLI to be installed. If unavailable, returns the
   * original code with `formatted: false`.
   *
   * @example
   * ```ts
   * const result = sdk.formatMove(moveSource);
   * if (result.formatted) {
   *   console.log(result.code); // Formatted Move code
   * }
   * ```
   */
  formatMove(source: string, options?: FormatOptions): FormatResult {
    return formatMoveCode(source, options);
  }

  // ─── Compiler ──────────────────────────────────────────────────

  /**
   * Check if the Move compiler (`aptos move compile`) is available.
   * Result is cached after the first call.
   */
  isCompilerAvailable(): boolean {
    return isCompilerAvailable();
  }

  /**
   * Compile-check a single Move module using `aptos move compile`.
   *
   * Creates a temporary Move package, runs the full compiler, and returns
   * structured diagnostics (errors, warnings, source locations).
   *
   * This is the deepest validation tier — catches type errors, unresolved
   * references, missing dependencies, and other semantic issues that
   * tree-sitter parsing cannot detect.
   *
   * @example
   * ```ts
   * const result = sdk.compileCheck(moveSource, 'my_module');
   * if (result.success) {
   *   console.log('Module compiles successfully');
   * } else {
   *   for (const err of result.errors) {
   *     console.log(`${err.source}:${err.line}: ${err.message}`);
   *   }
   * }
   * ```
   */
  compileCheck(
    code: string,
    moduleName: string,
    options?: CompileCheckOptions
  ): CompileCheckResult {
    const mergedOptions: CompileCheckOptions = {
      moduleAddress: this.options.moduleAddress,
      packageName: this.options.packageName,
      ...options,
    };
    return compileCheck(code, moduleName, mergedOptions);
  }

  /**
   * Compile-check multiple Move modules together as a single package.
   *
   * Use this when modules depend on each other — they'll be compiled
   * together so cross-module references resolve correctly.
   *
   * @example
   * ```ts
   * const result = sdk.compileCheckModules([
   *   { name: 'math_lib', code: mathSource },
   *   { name: 'token', code: tokenSource },
   * ]);
   * ```
   */
  compileCheckModules(
    modules: { name: string; code: string }[],
    options?: CompileCheckOptions
  ): CompileCheckResult {
    const mergedOptions: CompileCheckOptions = {
      moduleAddress: this.options.moduleAddress,
      packageName: this.options.packageName,
      ...options,
    };
    return compileCheckModules(modules, mergedOptions);
  }

  // ─── Pipeline ─────────────────────────────────────────────────

  /**
   * Full pipeline: transpile Solidity→Move, then validate all generated Move modules.
   *
   * If the Move parser isn't available, transpilation still succeeds but
   * `moveValidation` will be `null`.
   *
   * @example
   * ```ts
   * const result = await sdk.transpileAndValidate(soliditySource);
   *
   * if (result.transpile.success) {
   *   console.log(`Transpiled ${result.transpile.modules.length} modules`);
   * }
   *
   * if (result.moveValidation) {
   *   for (const mod of result.moveValidation) {
   *     console.log(`${mod.name}: ${mod.valid ? 'OK' : 'ERRORS'}`);
   *   }
   * }
   * ```
   */
  async transpileAndValidate(
    source: string,
    overrides: Partial<TranspileOptions> = {}
  ): Promise<TranspileAndValidateResult> {
    const transpileResult = this.transpile(source, overrides);

    if (!transpileResult.success || !(await this.isMoveParserAvailable())) {
      return {
        transpile: transpileResult,
        moveValidation: transpileResult.success ? null : null,
        allValid: false,
      };
    }

    const validations: ModuleValidation[] = [];
    for (const mod of transpileResult.modules) {
      const validation = await this.validateMove(mod.code);
      validations.push({
        name: mod.name,
        valid: validation.valid,
        errors: validation.errors,
        structure: validation.structure,
      });
    }

    return {
      transpile: transpileResult,
      moveValidation: validations,
      allValid: validations.every(v => v.valid),
    };
  }
}
