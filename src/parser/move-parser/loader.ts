/**
 * Lazy loader for tree-sitter and tree-sitter-move-on-aptos.
 * Uses createRequire for CJS native addon interop from ESM.
 * Caches the parser as a singleton for reuse.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedParser: any = null;
let loadAttempted = false;
let loadError: Error | null = null;

/**
 * Check whether the tree-sitter Move parser is available in this environment.
 * Returns false if native addons are not installed or failed to build.
 * Never throws.
 */
export async function isMoveParserAvailable(): Promise<boolean> {
  if (loadAttempted) return cachedParser !== null;
  try {
    await getMoveParser();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a configured tree-sitter Parser instance with the Move language loaded.
 * The parser is cached as a singleton — safe to call repeatedly.
 *
 * @throws Error if tree-sitter or tree-sitter-move-on-aptos is not available
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getMoveParser(): Promise<any> {
  if (cachedParser) return cachedParser;
  if (loadAttempted && loadError) throw loadError;

  loadAttempted = true;
  try {
    // tree-sitter and tree-sitter-move-on-aptos are CJS native addons.
    // Use createRequire to load them from ESM context.
    const require = createRequire(import.meta.url);

    const Parser = require('tree-sitter');
    // The move-on-aptos package's "main" field points to a non-existent root index.js.
    // The actual entry is at bindings/node/index.js.
    const MoveLanguage = require('tree-sitter-move-on-aptos/bindings/node');

    const parser = new Parser();
    parser.setLanguage(MoveLanguage);

    cachedParser = parser;
    return parser;
  } catch (err) {
    loadError = new Error(
      'tree-sitter-move-on-aptos is not available. ' +
      'Install with: npm install tree-sitter tree-sitter-move-on-aptos@github:aptos-labs/tree-sitter-move-on-aptos\n' +
      `Original error: ${err instanceof Error ? err.message : String(err)}`
    );
    throw loadError;
  }
}

/**
 * Reset the cached parser. Primarily for testing.
 */
export function resetMoveParser(): void {
  cachedParser = null;
  loadAttempted = false;
  loadError = null;
}
