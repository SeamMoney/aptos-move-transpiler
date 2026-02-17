/**
 * Move Code Formatter
 *
 * Wraps `aptos move fmt` (which uses movefmt under the hood) to post-process
 * generated Move source code into idiomatic, consistently formatted output.
 *
 * This is an optional enhancement — if the Aptos CLI isn't installed,
 * all functions degrade gracefully and return the original unformatted code.
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/** Result of a formatting operation. */
export interface FormatResult {
  /** The (possibly formatted) Move source code */
  code: string;
  /** Whether formatting was actually applied */
  formatted: boolean;
  /** Error message if formatting failed (code will be the original input) */
  error?: string;
}

/** Options for the formatter. */
export interface FormatOptions {
  /** Maximum line width (default: 100) */
  maxWidth?: number;
  /** Indent size in spaces (default: 4) */
  indentSize?: number;
}

// ─── Availability check ─────────────────────────────────────────────

let _formatterAvailable: boolean | null = null;

/**
 * Check if `aptos move fmt` is available on the system.
 * Result is cached after the first call.
 */
export function isFormatterAvailable(): boolean {
  if (_formatterAvailable !== null) return _formatterAvailable;

  try {
    execSync('aptos move fmt --version', {
      stdio: 'pipe',
      timeout: 5000,
    });
    _formatterAvailable = true;
  } catch {
    // --version may not be supported; try --help instead
    try {
      execSync('aptos move fmt --help', {
        stdio: 'pipe',
        timeout: 5000,
      });
      _formatterAvailable = true;
    } catch {
      _formatterAvailable = false;
    }
  }

  return _formatterAvailable;
}

/**
 * Reset the cached availability check.
 * Useful for testing.
 */
export function resetFormatterCache(): void {
  _formatterAvailable = null;
}

// ─── Formatting ──────────────────────────────────────────────────────

/**
 * Format Move source code using `aptos move fmt`.
 *
 * Writes the code to a temporary file, runs the formatter in overwrite mode,
 * reads back the formatted result, and cleans up. If the formatter isn't
 * available or fails, returns the original code with `formatted: false`.
 *
 * @param code - Move source code to format
 * @param options - Formatting options
 * @returns FormatResult with formatted code (or original on failure)
 */
export function formatMoveCode(
  code: string,
  options: FormatOptions = {}
): FormatResult {
  if (!isFormatterAvailable()) {
    return { code, formatted: false, error: 'aptos CLI not available' };
  }

  if (!code.trim()) {
    return { code, formatted: false, error: 'Empty input' };
  }

  let tempDir: string | null = null;

  try {
    // Create a temp directory and write the source file
    tempDir = mkdtempSync(join(tmpdir(), 'sol2move-fmt-'));
    const tempFile = join(tempDir, 'source.move');
    writeFileSync(tempFile, code, 'utf-8');

    // Build the command
    const configParts: string[] = [];
    if (options.maxWidth) {
      configParts.push(`max_width=${options.maxWidth}`);
    }
    if (options.indentSize) {
      configParts.push(`indent_size=${options.indentSize}`);
    }

    const configFlag = configParts.length > 0
      ? ` --config "${configParts.join(',')}"`
      : '';

    // Use overwrite mode: formats the file in place, then we read it back
    const cmd = `aptos move fmt --file-path "${tempFile}" --emit-mode overwrite${configFlag}`;

    execSync(cmd, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });

    // Read back the formatted file
    const formatted = readFileSync(tempFile, 'utf-8');

    if (formatted.trim().length === 0 && code.trim().length > 0) {
      return { code, formatted: false, error: 'Formatter returned empty output' };
    }

    return { code: formatted, formatted: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code, formatted: false, error: `Format failed: ${message}` };
  } finally {
    // Clean up temp files
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

/**
 * Format multiple Move modules. Returns results in the same order.
 */
export function formatMoveModules(
  modules: { name: string; code: string }[],
  options: FormatOptions = {}
): Map<string, FormatResult> {
  const results = new Map<string, FormatResult>();

  // Quick check: if formatter isn't available, skip all
  if (!isFormatterAvailable()) {
    for (const mod of modules) {
      results.set(mod.name, {
        code: mod.code,
        formatted: false,
        error: 'aptos CLI not available',
      });
    }
    return results;
  }

  for (const mod of modules) {
    results.set(mod.name, formatMoveCode(mod.code, options));
  }

  return results;
}
