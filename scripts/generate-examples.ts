/**
 * Generate Examples
 * Transpiles Solidity sources and writes side-by-side input/output pairs to examples/.
 * Run: npm run generate:examples
 */

import { transpile, type TranspileOptions } from '../src/transpiler.js';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXAMPLES_DIR = join(ROOT, 'examples');

interface ExampleConfig {
  name: string;
  solFile: string; // relative to ROOT
  category: 'basic' | 'defi';
  description: string;
  options?: Partial<TranspileOptions>;
}

const EXAMPLES: ExampleConfig[] = [
  // Basic
  {
    name: 'simple-storage',
    solFile: 'examples/basic/simple-storage/SimpleStorage.sol',
    category: 'basic',
    description: 'Basic key-value storage with events',
  },
  {
    name: 'erc20-token',
    solFile: 'examples/basic/erc20-token/ERC20Token.sol',
    category: 'basic',
    description: 'ERC-20 fungible token with transfer and approval',
  },
  {
    name: 'erc721-token',
    solFile: 'examples/basic/erc721-token/ERC721Token.sol',
    category: 'basic',
    description: 'ERC-721 NFT collection with mint, burn, and approval',
  },
  // DeFi
  {
    name: 'amm',
    solFile: 'tests/fixtures/defi/SimpleAMM.sol',
    category: 'defi',
    description: 'Uniswap-style AMM with constant product formula and LP tokens',
  },
  {
    name: 'lending',
    solFile: 'tests/fixtures/defi/SimpleLending.sol',
    category: 'defi',
    description: 'Aave/Compound-style lending with interest rates and liquidation',
  },
  {
    name: 'staking',
    solFile: 'tests/fixtures/defi/StakingRewards.sol',
    category: 'defi',
    description: 'Synthetix-style staking with reward distribution',
  },
  {
    name: 'vault',
    solFile: 'tests/fixtures/defi/Vault.sol',
    category: 'defi',
    description: 'ERC-4626 yield vault with strategy management',
  },
  {
    name: 'multisig',
    solFile: 'tests/fixtures/defi/MultiSig.sol',
    category: 'defi',
    description: 'Gnosis Safe-style multisig wallet',
  },
  {
    name: 'nova-dex',
    solFile: 'tests/fixtures/defi/NovaDEX.sol',
    category: 'defi',
    description: 'Full-featured DEX with staking, governance, flash loans, and TWAP oracles',
  },
];

interface ExampleResult {
  name: string;
  category: string;
  description: string;
  solLines: number;
  moveLines: number;
  functionCount: number;
  structCount: number;
  eventCount: number;
  errors: number;
  warnings: number;
  modules: number;
}

const results: ExampleResult[] = [];

for (const example of EXAMPLES) {
  const solPath = join(ROOT, example.solFile);
  if (!existsSync(solPath)) {
    console.error(`SKIP: ${example.name} — source not found: ${solPath}`);
    continue;
  }

  const source = readFileSync(solPath, 'utf-8');
  const result = transpile(source, {
    moduleAddress: '0x1',
    generateToml: true,
    packageName: example.name.replace(/-/g, '_'),
    ...example.options,
  });

  if (!result.success) {
    console.error(`FAIL: ${example.name} — ${result.errors.join(', ')}`);
    continue;
  }

  const outDir = join(EXAMPLES_DIR, example.category, example.name, 'output');
  const sourcesDir = join(outDir, 'sources');
  mkdirSync(sourcesDir, { recursive: true });

  if (result.moveToml) {
    writeFileSync(join(outDir, 'Move.toml'), result.moveToml);
  }

  let totalMoveLines = 0;
  let totalFunctions = 0;
  let totalStructs = 0;
  let totalEvents = 0;

  for (const mod of result.modules) {
    writeFileSync(join(sourcesDir, `${mod.name}.move`), mod.code);
    const lines = mod.code.split('\n').length;
    totalMoveLines += lines;
    totalFunctions += (mod.code.match(/\bfun\s+\w+/g) || []).length;
    totalStructs += (mod.code.match(/\bstruct\s+\w+/g) || []).length;
    totalEvents += (mod.code.match(/#\[event\]/g) || []).length;
  }

  const solLines = source.split('\n').length;

  results.push({
    name: example.name,
    category: example.category,
    description: example.description,
    solLines,
    moveLines: totalMoveLines,
    functionCount: totalFunctions,
    structCount: totalStructs,
    eventCount: totalEvents,
    errors: result.errors.length,
    warnings: result.warnings.length,
    modules: result.modules.length,
  });

  console.log(`  OK  ${example.category}/${example.name} — ${solLines} sol → ${totalMoveLines} move (${totalFunctions} fns, ${totalStructs} structs)`);
}

// Write summary
writeFileSync(
  join(EXAMPLES_DIR, 'summary.json'),
  JSON.stringify({ generated: new Date().toISOString(), examples: results }, null, 2)
);

console.log(`\nGenerated ${results.length} examples to examples/`);
