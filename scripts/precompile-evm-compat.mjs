#!/usr/bin/env node
/**
 * Pre-compile evm_compat.move using wasmtime.
 *
 * V8's WASM stack limit (~39 deps) is too small for evm_compat's 68 transitive
 * framework deps. This script uses wasmtime (no stack limit) to compile evm_compat
 * offline, producing a bytecode blob that can be used as a precompiled_dep at runtime.
 *
 * Requires:
 *   - wasmtime CLI
 *   - blinknow/public/wasm/move-compiler-v2.wasm
 *   - blinknow/public/wasm/framework-bytecodes.json
 *
 * Usage:
 *   node scripts/precompile-evm-compat.mjs
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BLINKNOW = join(ROOT, '..', 'blinknow');

const WASM_PATH = join(BLINKNOW, 'public/wasm/move-compiler-v2.wasm');
const BYTECODES_PATH = join(BLINKNOW, 'public/wasm/framework-bytecodes.json');
const EVM_COMPAT_PATH = join(ROOT, 'src/stdlib/evm_compat.move');
const OUTPUT_PATH = join(ROOT, 'src/stdlib/evm_compat_bytecode.json');

// Read inputs
const evmCompat = readFileSync(EVM_COMPAT_PATH, 'utf-8');
const bytecodes = JSON.parse(readFileSync(BYTECODES_PATH, 'utf-8'));

// Build full precompiled deps map
const allDeps = {};
for (const [addr, { modules }] of Object.entries(bytecodes.addresses)) {
  for (const [name, b64] of Object.entries(modules)) {
    allDeps[`${addr}::${name}`] = b64;
  }
}

const input = {
  sources: { 'sources/evm_compat.move': evmCompat },
  precompiled_deps: allDeps,
  named_addresses: {
    std: '0x1',
    aptos_std: '0x1',
    aptos_framework: '0x1',
    aptos_token: '0x3',
    aptos_token_objects: '0x4',
    transpiler: '0x42',
  },
  package_name: 'transpiler',
  output_encoding: 'base64',
};

const tempDir = mkdtempSync(join(tmpdir(), 'evm-compat-'));
const inputPath = join(tempDir, 'input.json');
const outputPath = join(tempDir, 'output.json');

writeFileSync(inputPath, JSON.stringify(input));

console.log('Compiling evm_compat.move via wasmtime...');

try {
  execSync(
    `wasmtime run --dir=/tmp "${WASM_PATH}" < "${inputPath}" > "${outputPath}"`,
    { stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 }
  );

  const result = JSON.parse(readFileSync(outputPath, 'utf-8'));

  if (result.success && result.modules?.evm_compat) {
    const bytecode = result.modules.evm_compat;
    writeFileSync(OUTPUT_PATH, JSON.stringify({ '0x42::evm_compat': bytecode }, null, 2) + '\n');
    console.log(`Written: ${OUTPUT_PATH}`);
    console.log(`  bytecode: ${bytecode.length} chars (base64)`);
  } else {
    console.error('Compilation failed:', result.diagnostics?.slice(0, 3));
    process.exit(1);
  }
} catch (e) {
  console.error('ERROR:', e.stderr?.toString().slice(0, 500) || e.message);
  process.exit(1);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
