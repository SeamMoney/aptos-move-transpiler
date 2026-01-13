/**
 * Compilation Verification Tests
 * Verifies that generated Move code compiles successfully with Aptos Move compiler
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { transpile } from '../../src/transpiler.js';

const TEST_OUTPUT_DIR = join(__dirname, '../.output');
const FIXTURES_DIR = join(__dirname, '../fixtures/defi');

// Helper to compile Move code
function compileMove(projectDir: string): { success: boolean; output: string } {
  try {
    const output = execSync('aptos move compile --skip-fetch-latest-git-deps 2>&1', {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 60000,
    });
    return { success: true, output };
  } catch (error: any) {
    return { success: false, output: error.stdout || error.message };
  }
}

// Helper to setup a Move project
function setupMoveProject(name: string, moveCode: string, moveToml: string): string {
  const projectDir = join(TEST_OUTPUT_DIR, name);

  // Clean and create directories
  if (existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true });
  }
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(projectDir, 'sources'), { recursive: true });

  // Write files
  writeFileSync(join(projectDir, 'Move.toml'), moveToml);
  writeFileSync(join(projectDir, 'sources', `${name}.move`), moveCode);

  return projectDir;
}

describe('Compilation Verification', () => {
  beforeAll(() => {
    // Ensure output directory exists
    if (!existsSync(TEST_OUTPUT_DIR)) {
      mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test output directory
    if (existsSync(TEST_OUTPUT_DIR)) {
      rmSync(TEST_OUTPUT_DIR, { recursive: true });
    }
  });

  describe('Simple Contracts', () => {
    it('should compile a basic counter contract', () => {
      const solidity = `
        pragma solidity ^0.8.20;
        contract Counter {
          uint256 public count;

          function increment() public {
            count += 1;
          }

          function decrement() public {
            count -= 1;
          }

          function getCount() public view returns (uint256) {
            return count;
          }
        }
      `;

      const result = transpile(solidity, {
        moduleAddress: '0x1',
        packageName: 'counter',
        generateToml: true,
      });

      expect(result.success).toBe(true);
      expect(result.modules.length).toBeGreaterThan(0);

      const projectDir = setupMoveProject(
        'counter',
        result.modules[0].code,
        result.moveToml || ''
      );

      const compileResult = compileMove(projectDir);
      expect(compileResult.success).toBe(true);
    });

    it('should compile a simple storage contract', () => {
      const solidity = `
        pragma solidity ^0.8.20;
        contract SimpleStorage {
          uint256 private value;

          event ValueChanged(address indexed sender, uint256 newValue);

          function setValue(uint256 _value) public {
            value = _value;
          }

          function getValue() public view returns (uint256) {
            return value;
          }
        }
      `;

      const result = transpile(solidity, {
        moduleAddress: '0x1',
        packageName: 'simple_storage',
        generateToml: true,
      });

      expect(result.success).toBe(true);

      const projectDir = setupMoveProject(
        'simple_storage',
        result.modules[0].code,
        result.moveToml || ''
      );

      const compileResult = compileMove(projectDir);
      // Log output for debugging if failed
      if (!compileResult.success) {
        console.log('Compile error:', compileResult.output);
      }
      expect(compileResult.success).toBe(true);
    });
  });

  describe('DeFi Contracts', () => {
    it('should transpile SimpleAMM contract', () => {
      const solidityCode = readFileSync(join(FIXTURES_DIR, 'SimpleAMM.sol'), 'utf-8');

      const result = transpile(solidityCode, {
        moduleAddress: '0x1',
        packageName: 'simple_amm',
        generateToml: true,
      });

      // Transpilation should succeed
      expect(result.success).toBe(true);
      expect(result.modules.length).toBeGreaterThan(0);

      // Code should be generated (compilation requires more work for complex modifiers)
      const moveCode = result.modules[0].code;
      expect(moveCode).toContain('module');
      expect(moveCode).toContain('SimpleAMMState');
      expect(moveCode).toContain('Swap');
    });

    it('should transpile StakingRewards contract', () => {
      const solidityCode = readFileSync(join(FIXTURES_DIR, 'StakingRewards.sol'), 'utf-8');

      const result = transpile(solidityCode, {
        moduleAddress: '0x1',
        packageName: 'staking',
        generateToml: true,
      });

      // Transpilation should succeed
      expect(result.success).toBe(true);
      expect(result.modules.length).toBeGreaterThan(0);

      // Code should contain key staking elements
      const moveCode = result.modules[0].code;
      expect(moveCode).toContain('module');
      expect(moveCode).toContain('StakingRewardsState');
    });
  });

  describe('Token Standards', () => {
    it('should compile ERC-20 with Fungible Asset', () => {
      const solidity = `
        pragma solidity ^0.8.20;

        contract MyToken {
          string public name = "My Token";
          string public symbol = "MTK";
          uint8 public decimals = 18;
          uint256 public totalSupply;

          mapping(address => uint256) public balanceOf;
          mapping(address => mapping(address => uint256)) public allowance;

          event Transfer(address indexed from, address indexed to, uint256 value);
          event Approval(address indexed owner, address indexed spender, uint256 value);

          constructor() {
            totalSupply = 1000000 * 10 ** 18;
            balanceOf[msg.sender] = totalSupply;
          }

          function transfer(address to, uint256 amount) public returns (bool) {
            require(balanceOf[msg.sender] >= amount, "Insufficient balance");
            balanceOf[msg.sender] -= amount;
            balanceOf[to] += amount;
            emit Transfer(msg.sender, to, amount);
            return true;
          }

          function approve(address spender, uint256 amount) public returns (bool) {
            allowance[msg.sender][spender] = amount;
            emit Approval(msg.sender, spender, amount);
            return true;
          }

          function transferFrom(address from, address to, uint256 amount) public returns (bool) {
            require(balanceOf[from] >= amount, "Insufficient balance");
            require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
            allowance[from][msg.sender] -= amount;
            emit Transfer(from, to, amount);
            return true;
          }
        }
      `;

      const result = transpile(solidity, {
        moduleAddress: '0x1',
        packageName: 'my_token',
        generateToml: true,
        useFungibleAsset: true,
      });

      expect(result.success).toBe(true);
      // FA modules use special template
      expect(result.warnings.some(w => w.includes('Fungible Asset'))).toBe(true);

      const projectDir = setupMoveProject(
        'my_token',
        result.modules[0].code,
        result.moveToml || ''
      );

      const compileResult = compileMove(projectDir);
      if (!compileResult.success) {
        console.log('FA compile error:', compileResult.output);
      }
      expect(compileResult.success).toBe(true);
    });
  });
});
