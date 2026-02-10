/**
 * DLMM Eval Framework
 * Transpiles Trader Joe Liquidity Book contracts and measures quality.
 *
 * Metrics tracked per contract:
 *   - transpiles: Does the transpiler produce output without crashing?
 *   - functionCount: How many functions were transpiled?
 *   - warningCount / errorCount: Transpiler diagnostics
 *   - unsupportedCount: Number of "unsupported" or "TODO" markers in output
 *   - assemblyBlockCount: Number of inline assembly blocks that couldn't be transpiled
 *   - lineCount: Size of generated Move code
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { transpile, type TranspileOptions } from '../../src/transpiler.js';

const FIXTURES_DIR = join(__dirname, '../fixtures/dlmm');
const OUTPUT_DIR = join(__dirname, '../output/dlmm');
const EVAL_REPORT_PATH = join(__dirname, '../output/dlmm-eval-report.json');

interface EvalMetrics {
  contract: string;
  transpiles: boolean;
  functionCount: number;
  structCount: number;
  errorCount: number;
  warningCount: number;
  unsupportedCount: number;
  assemblyBlockCount: number;
  lineCount: number;
  moveCode: string;
}

interface EvalReport {
  timestamp: string;
  totalContracts: number;
  successfulTranspiles: number;
  totalFunctions: number;
  totalErrors: number;
  totalWarnings: number;
  totalUnsupported: number;
  totalAssemblyBlocks: number;
  contracts: EvalMetrics[];
}

function readFixture(...pathParts: string[]): string {
  return readFileSync(join(FIXTURES_DIR, ...pathParts), 'utf-8');
}

function transpileContract(
  source: string,
  name: string,
  options: TranspileOptions = {}
): EvalMetrics {
  const metrics: EvalMetrics = {
    contract: name,
    transpiles: false,
    functionCount: 0,
    structCount: 0,
    errorCount: 0,
    warningCount: 0,
    unsupportedCount: 0,
    assemblyBlockCount: 0,
    lineCount: 0,
    moveCode: '',
  };

  try {
    const result = transpile(source, {
      moduleAddress: '0x1',
      generateToml: true,
      packageName: name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      ...options,
    });

    metrics.errorCount = result.errors.length;
    metrics.warningCount = result.warnings.length;

    if (result.success && result.modules.length > 0) {
      metrics.transpiles = true;
      const code = result.modules[0]?.code || '';
      metrics.moveCode = code;
      metrics.lineCount = code.split('\n').length;

      // Count functions
      const funcMatches = code.match(/\bfun\s+\w+/g);
      metrics.functionCount = funcMatches?.length || 0;

      // Count structs
      const structMatches = code.match(/\bstruct\s+\w+/g);
      metrics.structCount = structMatches?.length || 0;

      // Count unsupported markers
      const unsupported = code.match(/unsupported|UNSUPPORTED|TODO|todo!/gi);
      metrics.unsupportedCount = unsupported?.length || 0;

      // Count assembly block markers
      const assembly = code.match(/assembly|ASSEMBLY|inline.?assembly/gi);
      metrics.assemblyBlockCount = assembly?.length || 0;

      // Write output for inspection
      const moduleDir = join(OUTPUT_DIR, name);
      const sourcesDir = join(moduleDir, 'sources');
      mkdirSync(sourcesDir, { recursive: true });

      if (result.moveToml) {
        writeFileSync(join(moduleDir, 'Move.toml'), result.moveToml);
      }
      for (const module of result.modules) {
        writeFileSync(join(sourcesDir, `${module.name}.move`), module.code);
      }
    }
  } catch (err: any) {
    metrics.errorCount = 1;
    metrics.moveCode = `// TRANSPILER CRASH: ${err.message}`;
  }

  return metrics;
}

// Report collector
const allMetrics: EvalMetrics[] = [];

// Clean and setup
beforeAll(() => {
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
});

// Write eval report after all tests
afterAll(() => {
  const report: EvalReport = {
    timestamp: new Date().toISOString(),
    totalContracts: allMetrics.length,
    successfulTranspiles: allMetrics.filter(m => m.transpiles).length,
    totalFunctions: allMetrics.reduce((sum, m) => sum + m.functionCount, 0),
    totalErrors: allMetrics.reduce((sum, m) => sum + m.errorCount, 0),
    totalWarnings: allMetrics.reduce((sum, m) => sum + m.warningCount, 0),
    totalUnsupported: allMetrics.reduce((sum, m) => sum + m.unsupportedCount, 0),
    totalAssemblyBlocks: allMetrics.reduce((sum, m) => sum + m.assemblyBlockCount, 0),
    contracts: allMetrics.map(({ moveCode, ...rest }) => ({ ...rest, moveCode: '' })),
  };

  writeFileSync(EVAL_REPORT_PATH, JSON.stringify(report, null, 2));

  // Print summary table
  console.log('\n=== DLMM Eval Report ===');
  console.log(`Contracts: ${report.successfulTranspiles}/${report.totalContracts} transpile successfully`);
  console.log(`Functions: ${report.totalFunctions} total`);
  console.log(`Errors: ${report.totalErrors} | Warnings: ${report.totalWarnings}`);
  console.log(`Unsupported markers: ${report.totalUnsupported}`);
  console.log(`Assembly blocks: ${report.totalAssemblyBlocks}`);
  console.log('\nPer-contract:');
  for (const m of allMetrics) {
    const status = m.transpiles ? 'OK' : 'FAIL';
    console.log(`  [${status}] ${m.contract.padEnd(30)} ${m.functionCount} fns, ${m.lineCount} lines, ${m.unsupportedCount} unsupported, ${m.errorCount} errors`);
  }
});

describe('DLMM Eval - Math Libraries', () => {
  it('Constants.sol', () => {
    const source = readFixture('libraries', 'Constants.sol');
    const metrics = transpileContract(source, 'constants');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('SafeCast.sol', () => {
    const source = readFixture('libraries', 'math', 'SafeCast.sol');
    const metrics = transpileContract(source, 'safe_cast');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('BitMath.sol', () => {
    const source = readFixture('libraries', 'math', 'BitMath.sol');
    const metrics = transpileContract(source, 'bit_math');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('Encoded.sol', () => {
    const source = readFixture('libraries', 'math', 'Encoded.sol');
    const metrics = transpileContract(source, 'encoded');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('PackedUint128Math.sol', () => {
    const source = readFixture('libraries', 'math', 'PackedUint128Math.sol');
    const metrics = transpileContract(source, 'packed_uint128_math');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('Uint128x128Math.sol', () => {
    const source = readFixture('libraries', 'math', 'Uint128x128Math.sol');
    const metrics = transpileContract(source, 'uint128x128_math');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('Uint256x256Math.sol', () => {
    const source = readFixture('libraries', 'math', 'Uint256x256Math.sol');
    const metrics = transpileContract(source, 'uint256x256_math');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('SampleMath.sol', () => {
    const source = readFixture('libraries', 'math', 'SampleMath.sol');
    const metrics = transpileContract(source, 'sample_math');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('TreeMath.sol', () => {
    const source = readFixture('libraries', 'math', 'TreeMath.sol');
    const metrics = transpileContract(source, 'tree_math');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('LiquidityConfigurations.sol', () => {
    const source = readFixture('libraries', 'math', 'LiquidityConfigurations.sol');
    const metrics = transpileContract(source, 'liquidity_configurations');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });
});

describe('DLMM Eval - Helper Libraries', () => {
  it('FeeHelper.sol', () => {
    const source = readFixture('libraries', 'FeeHelper.sol');
    const metrics = transpileContract(source, 'fee_helper');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('PriceHelper.sol', () => {
    const source = readFixture('libraries', 'PriceHelper.sol');
    const metrics = transpileContract(source, 'price_helper');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('BinHelper.sol', () => {
    const source = readFixture('libraries', 'BinHelper.sol');
    const metrics = transpileContract(source, 'bin_helper');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('PairParameterHelper.sol', () => {
    const source = readFixture('libraries', 'PairParameterHelper.sol');
    const metrics = transpileContract(source, 'pair_parameter_helper');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('OracleHelper.sol', () => {
    const source = readFixture('libraries', 'OracleHelper.sol');
    const metrics = transpileContract(source, 'oracle_helper');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('Hooks.sol', () => {
    const source = readFixture('libraries', 'Hooks.sol');
    const metrics = transpileContract(source, 'hooks');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('TokenHelper.sol', () => {
    const source = readFixture('libraries', 'TokenHelper.sol');
    const metrics = transpileContract(source, 'token_helper');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('ReentrancyGuardUpgradeable.sol', () => {
    const source = readFixture('libraries', 'ReentrancyGuardUpgradeable.sol');
    const metrics = transpileContract(source, 'reentrancy_guard');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });
});

describe('DLMM Eval - Core Contracts', () => {
  it('LBToken.sol', () => {
    const source = readFixture('LBToken.sol');
    const metrics = transpileContract(source, 'lb_token');
    allMetrics.push(metrics);
    expect(metrics.transpiles).toBe(true);
  });

  it('LBPair.sol', () => {
    const source = readFixture('LBPair.sol');
    const metrics = transpileContract(source, 'lb_pair');
    allMetrics.push(metrics);
    // This is the hardest contract - may not transpile initially
    // Track metrics even if it fails
  });

  it('LBFactory.sol', () => {
    const source = readFixture('LBFactory.sol');
    const metrics = transpileContract(source, 'lb_factory');
    allMetrics.push(metrics);
    // May fail initially due to complex patterns
  });

  it('LBRouter.sol', () => {
    const source = readFixture('LBRouter.sol');
    const metrics = transpileContract(source, 'lb_router');
    allMetrics.push(metrics);
    // May fail initially due to complex patterns
  });
});
