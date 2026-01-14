import { transpile } from '../src/transpiler.js';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const solidityCode = fs.readFileSync('tests/fixtures/defi/SimpleAMM.sol', 'utf-8');

const result = transpile(solidityCode, {
  moduleAddress: '0x1',
  packageName: 'simple_amm',
  generateToml: true,
});

console.log('Success:', result.success);
console.log('Errors:', result.errors);
console.log('Warnings:', result.warnings);

if (result.success && result.modules[0]?.code) {
  // Write to temp directory
  const dir = '/tmp/amm_compile_test';
  fs.mkdirSync(dir + '/sources', { recursive: true });
  fs.writeFileSync(dir + '/Move.toml', result.moveToml || '');
  fs.writeFileSync(dir + '/sources/simple_amm.move', result.modules[0].code);

  // Copy evm_compat module
  const evmCompatSrc = path.join(process.cwd(), 'src/stdlib/evm_compat.move');
  if (fs.existsSync(evmCompatSrc)) {
    fs.copyFileSync(evmCompatSrc, dir + '/sources/evm_compat.move');
    console.log('Copied evm_compat.move');
  }

  console.log('\n--- Generated Code (first 100 lines) ---');
  console.log(result.modules[0].code.split('\n').slice(0, 100).join('\n'));

  console.log('\n--- Attempting to compile ---');
  try {
    const output = execSync('aptos move compile --skip-fetch-latest-git-deps 2>&1', {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 120000,
    });
    console.log('COMPILE SUCCESS!');
    console.log(output);
  } catch (error: any) {
    console.log('COMPILE FAILED:');
    console.log(error.stdout || error.message);
  }
}
