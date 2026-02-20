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
import { generateSpecs, renderSpecs } from './codegen/spec-generator.js';
import type { MoveSpecBlock, MoveSpecCondition } from './types/move-ast.js';
import { analyzeContract, buildResourcePlan } from './analyzer/state-analyzer.js';
import { contractToIR } from './transformer/contract-transformer.js';
import { parseSolidity, extractContracts } from './parser/solidity-parser.js';
import type { ContractAccessProfile } from './types/optimization.js';

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
export type {
  MoveSpecBlock,
  MoveSpecCondition,
} from './types/move-ast.js';
export type {
  ContractAccessProfile,
  ResourceGroup,
  StateVariableAnalysis,
  FunctionAccessProfile,
  ResourcePlan,
  OptimizationLevel,
} from './types/optimization.js';

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

  // ─── Specification Generation ───────────────────────────────────

  /**
   * Generate Move Specification Language (MSL) spec blocks for a Move module AST.
   *
   * Extracts formal specifications from the module's code:
   * - `aborts_if` conditions from `assert!()` / `require()`
   * - `modifies` declarations from mutable state access
   * - `aborts_if !exists<T>()` from resource acquisition
   * - Struct invariants for numeric field bounds
   *
   * @example
   * ```ts
   * const result = sdk.transpile(soliditySource, { generateSpecs: true });
   * // Specs are included in the generated code
   *
   * // Or generate specs separately for an existing AST:
   * const specs = sdk.generateSpecs(result.modules[0].ast);
   * ```
   */
  generateSpecs(ast: MoveModule): MoveSpecBlock[] {
    return generateSpecs(ast);
  }

  /**
   * Render MSL spec blocks to Move source code lines.
   * Useful for custom code generation workflows.
   */
  renderSpecs(specs: MoveSpecBlock[]): string[] {
    return renderSpecs(specs);
  }

  // ─── Parallelization Analysis ────────────────────────────────

  /**
   * Analyze a Solidity contract's state variable access patterns for
   * parallelization optimization. Returns variable classifications,
   * resource grouping suggestions, and a parallelization score.
   *
   * This runs the analysis phase only — no code generation.
   *
   * @example
   * ```ts
   * const profile = sdk.analyzeParallelism(soliditySource);
   * console.log(`Score: ${profile.parallelizationScore}/100`);
   * profile.recommendations.forEach(r => console.log(r));
   * ```
   */
  analyzeParallelism(source: string): ContractAccessProfile[] {
    const parseResult = parseSolidity(source);
    if (!parseResult.success || !parseResult.ast) {
      return [];
    }

    const contracts = extractContracts(parseResult.ast);
    const profiles: ContractAccessProfile[] = [];

    for (const contract of contracts) {
      if (contract.kind === 'interface') continue;
      try {
        const ir = contractToIR(contract);
        profiles.push(analyzeContract(ir));
      } catch {
        // Skip contracts that fail to parse to IR
      }
    }

    return profiles;
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

    if (!transpileResult.success) {
      return {
        transpile: transpileResult,
        moveValidation: null,
        allValid: false,
      };
    }

    if (!(await this.isMoveParserAvailable())) {
      return {
        transpile: transpileResult,
        moveValidation: null,
        allValid: true,
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
