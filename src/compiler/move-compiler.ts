/**
 * Move Compiler Integration
 *
 * Wraps `aptos move compile` to provide full semantic validation of generated
 * Move code: type checking, reference resolution, dependency verification, etc.
 *
 * Validation tiers (from lightest to heaviest):
 *   1. tree-sitter parse   → syntax only (in-process, ~1ms)
 *   2. aptos move compile  → full semantic check (~2-5s, requires Aptos CLI)
 *
 * This is an optional enhancement — degrades gracefully if Aptos CLI is absent.
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateMoveToml } from '../codegen/move-generator.js';

// ─── Types ───────────────────────────────────────────────────────────

/** A single diagnostic from the Move compiler. */
export interface CompileDiagnostic {
  /** The diagnostic message */
  message: string;
  /** Severity level */
  severity: 'error' | 'warning';
  /** Source file or module that produced the diagnostic */
  source?: string;
  /** Line number (1-based) if extractable */
  line?: number;
  /** Column number (1-based) if extractable */
  column?: number;
}

/** Result of a compilation check. */
export interface CompileCheckResult {
  /** Whether compilation succeeded with no errors */
  success: boolean;
  /** Compiler errors */
  errors: CompileDiagnostic[];
  /** Compiler warnings */
  warnings: CompileDiagnostic[];
  /** Raw compiler output (stderr + stdout) for debugging */
  rawOutput?: string;
}

/** Options for compilation checking. */
export interface CompileCheckOptions {
  /** Module address for named addresses (default: '0x1') */
  moduleAddress?: string;
  /** Package name for Move.toml (default: 'validation_check') */
  packageName?: string;
  /** Language version (default: '2.3') */
  languageVersion?: string;
  /** Skip fetching git dependencies (default: true for speed) */
  skipFetchDeps?: boolean;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Include token objects dependency in Move.toml */
  includeTokenObjects?: boolean;
}

// ─── Availability check ─────────────────────────────────────────────

let _compilerAvailable: boolean | null = null;

/**
 * Check if `aptos move compile` is available on the system.
 * Result is cached after the first call.
 */
export function isCompilerAvailable(): boolean {
  if (_compilerAvailable !== null) return _compilerAvailable;

  try {
    execSync('aptos move compile --help', {
      stdio: 'pipe',
      timeout: 5000,
    });
    _compilerAvailable = true;
  } catch {
    _compilerAvailable = false;
  }

  return _compilerAvailable;
}

/**
 * Reset the cached availability check. Useful for testing.
 */
export function resetCompilerCache(): void {
  _compilerAvailable = null;
}

// ─── Compilation check ──────────────────────────────────────────────

/**
 * Compile-check a single Move module.
 *
 * Creates a temporary Move package, writes the source, runs
 * `aptos move compile`, and parses the output for diagnostics.
 */
export function compileCheck(
  code: string,
  moduleName: string,
  options: CompileCheckOptions = {}
): CompileCheckResult {
  return compileCheckModules(
    [{ name: moduleName, code }],
    options
  );
}

/**
 * Compile-check multiple Move modules together as a single package.
 *
 * This is the primary validation function. It creates a temporary Move
 * package containing all provided modules and runs the compiler on it.
 *
 * @param modules - Array of { name, code } pairs to compile together
 * @param options - Compilation options
 * @returns CompileCheckResult with success/failure and diagnostics
 */
export function compileCheckModules(
  modules: { name: string; code: string }[],
  options: CompileCheckOptions = {}
): CompileCheckResult {
  if (!isCompilerAvailable()) {
    return {
      success: false,
      errors: [{ message: 'Aptos CLI not available', severity: 'error' }],
      warnings: [],
    };
  }

  const {
    moduleAddress = '0x1',
    packageName = 'validation_check',
    languageVersion = '2.3',
    skipFetchDeps = true,
    timeout = 30000,
    includeTokenObjects = false,
  } = options;

  let tempDir: string | null = null;

  try {
    // Create a temp Move package structure
    tempDir = mkdtempSync(join(tmpdir(), 'sol2move-compile-'));
    const sourcesDir = join(tempDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    // Generate Move.toml
    const moveToml = generateMoveToml(packageName, moduleAddress, {
      includeTokenObjects,
    });
    writeFileSync(join(tempDir, 'Move.toml'), moveToml, 'utf-8');

    // Write all module source files
    for (const mod of modules) {
      const filePath = join(sourcesDir, `${mod.name}.move`);
      writeFileSync(filePath, mod.code, 'utf-8');
    }

    // Build the compile command
    const flags: string[] = [
      `--package-dir "${tempDir}"`,
      `--language-version ${languageVersion}`,
    ];

    if (skipFetchDeps) {
      flags.push('--skip-fetch-latest-git-deps');
    }

    // Map the module address as a named address
    // Extract named address from Move.toml: the module address maps to the package name
    const namedAddr = `${packageName}=${moduleAddress}`;
    flags.push(`--named-addresses ${namedAddr}`);

    const cmd = `aptos move compile ${flags.join(' ')}`;

    const stdout = execSync(cmd, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      encoding: 'utf-8',
    });

    // If we reach here, compilation succeeded
    const warnings = parseCompilerWarnings(stdout as string);

    return {
      success: true,
      errors: [],
      warnings,
    };
  } catch (error: unknown) {
    // Compilation failed — parse the error output
    const execError = error as { stderr?: string; stdout?: string; message?: string };
    const stderr = execError.stderr || '';
    const stdout = execError.stdout || '';
    const rawOutput = `${stderr}\n${stdout}`.trim();

    const diagnostics = parseCompilerOutput(rawOutput);

    return {
      success: false,
      errors: diagnostics.filter(d => d.severity === 'error'),
      warnings: diagnostics.filter(d => d.severity === 'warning'),
      rawOutput,
    };
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

// ─── Output parsing ─────────────────────────────────────────────────

/**
 * Parse compiler output (usually stderr) into structured diagnostics.
 */
function parseCompilerOutput(output: string): CompileDiagnostic[] {
  const diagnostics: CompileDiagnostic[] = [];

  if (!output.trim()) {
    diagnostics.push({
      message: 'Compilation failed with no output',
      severity: 'error',
    });
    return diagnostics;
  }

  // Match Move compiler error format:
  //   error[E...]: message
  //     ┌─ source_file.move:line:col
  const errorPattern = /error\[E\d+\]:\s*(.+?)(?:\n\s*[┌│├└].*?)*/g;
  const warningPattern = /warning\[W\d+\]:\s*(.+?)(?:\n\s*[┌│├└].*?)*/g;

  // Also match simpler error lines from the Aptos CLI wrapper
  const simpleErrorPattern = /(?:^|\n)\s*Error:\s*(.+)/gi;

  let match: RegExpExecArray | null;

  // Parse structured errors
  match = errorPattern.exec(output);
  while (match) {
    const diagnostic = parseSingleDiagnostic(match[0], 'error');
    diagnostics.push(diagnostic);
    match = errorPattern.exec(output);
  }

  // Parse structured warnings
  match = warningPattern.exec(output);
  while (match) {
    const diagnostic = parseSingleDiagnostic(match[0], 'warning');
    diagnostics.push(diagnostic);
    match = warningPattern.exec(output);
  }

  // If no structured errors found, try simple format
  if (diagnostics.length === 0) {
    match = simpleErrorPattern.exec(output);
    while (match) {
      diagnostics.push({
        message: match[1].trim(),
        severity: 'error',
      });
      match = simpleErrorPattern.exec(output);
    }
  }

  // If still nothing, treat entire output as a single error
  if (diagnostics.length === 0) {
    // Trim long output and clean ANSI codes
    const clean = output.replace(/\x1b\[[0-9;]*m/g, '').trim();
    const truncated = clean.length > 500 ? clean.slice(0, 500) + '...' : clean;
    diagnostics.push({
      message: truncated,
      severity: 'error',
    });
  }

  return diagnostics;
}

/**
 * Parse a single diagnostic block into a CompileDiagnostic.
 */
function parseSingleDiagnostic(
  block: string,
  severity: 'error' | 'warning'
): CompileDiagnostic {
  // Extract message from the first line
  const messageMatch = block.match(/(?:error|warning)\[.\d+\]:\s*(.+)/);
  const message = messageMatch ? messageMatch[1].trim() : block.trim();

  // Extract source location: ┌─ filename.move:line:col
  const locationMatch = block.match(/[┌─]+\s+(.+?):(\d+):(\d+)/);
  const source = locationMatch ? locationMatch[1] : undefined;
  const line = locationMatch ? parseInt(locationMatch[2], 10) : undefined;
  const column = locationMatch ? parseInt(locationMatch[3], 10) : undefined;

  return { message, severity, source, line, column };
}

/**
 * Parse warnings from successful compilation output.
 */
function parseCompilerWarnings(output: string): CompileDiagnostic[] {
  const warnings: CompileDiagnostic[] = [];
  const warningPattern = /warning\[W\d+\]:\s*(.+?)(?:\n\s*[┌│├└].*?)*/g;

  let match = warningPattern.exec(output);
  while (match) {
    warnings.push(parseSingleDiagnostic(match[0], 'warning'));
    match = warningPattern.exec(output);
  }

  return warnings;
}
