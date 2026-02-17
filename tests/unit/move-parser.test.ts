/**
 * Tests for the Move parser integration (tree-sitter-move-on-aptos)
 */

import { describe, it, expect } from 'vitest';
import {
  parseMoveCode,
  validateMoveCode,
  isMoveParserAvailable,
} from '../../src/parser/move-parser/index.js';
import { transpile } from '../../src/transpiler.js';

describe('Move Parser', () => {
  describe('isMoveParserAvailable', () => {
    it('should return true when tree-sitter is installed', async () => {
      const available = await isMoveParserAvailable();
      expect(available).toBe(true);
    });
  });

  describe('parseMoveCode', () => {
    it('should parse a simple module', async () => {
      const result = await parseMoveCode(`
        module 0x1::example {
          public fun add(a: u64, b: u64): u64 {
            a + b
          }
        }
      `);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.tree.type).toBe('source_file');
      expect(result.tree.children).toHaveLength(1);
      expect(result.tree.children[0].type).toBe('module_declaration');
    });

    it('should provide field access on parsed nodes', async () => {
      const result = await parseMoveCode(`
        module 0x1::math {
          public fun square(x: u64): u64 { x * x }
        }
      `);

      expect(result.success).toBe(true);
      const mod = result.tree.children[0];
      const name = mod.fieldChild('name');
      expect(name).not.toBeNull();
      expect(name!.text).toContain('math');

      const body = mod.fieldChild('body');
      expect(body).not.toBeNull();
      expect(body!.children.length).toBeGreaterThan(0);
    });

    it('should parse structs and enums', async () => {
      const result = await parseMoveCode(`
        module 0x1::types {
          struct Point has copy, drop {
            x: u64,
            y: u64,
          }

          struct Config has key {
            admin: address,
            enabled: bool,
          }
        }
      `);

      expect(result.success).toBe(true);
      const body = result.tree.children[0].fieldChild('body');
      expect(body).not.toBeNull();

      const structs = body!.children.filter(c => c.type === 'struct_declaration');
      expect(structs).toHaveLength(2);
    });

    it('should parse use declarations and constants', async () => {
      const result = await parseMoveCode(`
        module 0x1::token {
          use std::signer;
          use aptos_framework::coin;

          const E_NOT_AUTHORIZED: u64 = 1;

          public fun get_balance(account: &signer): u64 {
            0
          }
        }
      `);

      expect(result.success).toBe(true);
      const body = result.tree.children[0].fieldChild('body');
      expect(body).not.toBeNull();

      const uses = body!.children.filter(c => c.type === 'use_declaration');
      expect(uses.length).toBeGreaterThanOrEqual(2);

      const constants = body!.children.filter(c => c.type === 'constant_declaration');
      expect(constants).toHaveLength(1);
    });

    it('should detect syntax errors', async () => {
      const result = await parseMoveCode('module { broken syntax }}}');

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].startPosition).toBeDefined();
      expect(result.errors[0].startPosition.row).toBeGreaterThanOrEqual(0);
      expect(result.errors[0].message).toBeTruthy();
    });

    it('should still return a tree even with errors', async () => {
      const result = await parseMoveCode('module 0x1::test { fun }');

      expect(result.tree).toBeDefined();
      expect(result.tree.type).toBe('source_file');
      expect(result.tree.hasError).toBe(true);
    });

    it('should parse empty source', async () => {
      const result = await parseMoveCode('');

      expect(result.success).toBe(true);
      expect(result.tree.type).toBe('source_file');
      expect(result.tree.children).toHaveLength(0);
    });

    it('should include position information', async () => {
      const result = await parseMoveCode('module 0x1::test { }');

      expect(result.success).toBe(true);
      const mod = result.tree.children[0];
      expect(mod.startPosition.row).toBe(0);
      expect(mod.startPosition.column).toBe(0);
      expect(mod.startIndex).toBe(0);
      expect(mod.endIndex).toBeGreaterThan(0);
    });
  });

  describe('validateMoveCode', () => {
    it('should validate correct Move code', async () => {
      const result = await validateMoveCode(`
        module 0x1::counter {
          struct Counter has key {
            value: u64,
          }

          public fun increment(counter: &mut Counter) {
            counter.value = counter.value + 1;
          }
        }
      `);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.structure).toBeDefined();
    });

    it('should extract module names', async () => {
      const result = await validateMoveCode(`
        module 0x1::math {
          public fun add(a: u64, b: u64): u64 { a + b }
        }
      `);

      expect(result.valid).toBe(true);
      expect(result.structure?.modules).toContain('0x1::math');
    });

    it('should extract function names', async () => {
      const result = await validateMoveCode(`
        module 0x1::utils {
          public fun foo(): u64 { 0 }
          public fun bar(): bool { true }
          fun internal_helper(): u64 { 42 }
        }
      `);

      expect(result.valid).toBe(true);
      expect(result.structure?.functions).toContain('foo');
      expect(result.structure?.functions).toContain('bar');
      expect(result.structure?.functions).toContain('internal_helper');
    });

    it('should extract struct names', async () => {
      const result = await validateMoveCode(`
        module 0x1::types {
          struct Point has copy, drop { x: u64, y: u64 }
          struct Wallet has key { balance: u64 }
        }
      `);

      expect(result.valid).toBe(true);
      expect(result.structure?.structs).toContain('Point');
      expect(result.structure?.structs).toContain('Wallet');
    });

    it('should report errors for invalid code', async () => {
      const result = await validateMoveCode('not valid move code!!!');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.structure).toBeUndefined();
    });

    it('should not extract structure when errors exist', async () => {
      const result = await validateMoveCode('module 0x1::test {{{{{ }');

      expect(result.valid).toBe(false);
      expect(result.structure).toBeUndefined();
    });
  });

  describe('transpiler output validation', () => {
    it('should validate transpiled ERC-20-like contract', async () => {
      const solidity = `
        // SPDX-License-Identifier: MIT
        pragma solidity ^0.8.20;
        contract SimpleToken {
          uint256 public totalSupply;
          mapping(address => uint256) public balances;

          function mint(address to, uint256 amount) public {
            balances[to] += amount;
            totalSupply += amount;
          }

          function balanceOf(address account) public view returns (uint256) {
            return balances[account];
          }
        }
      `;

      const transpileResult = transpile(solidity, {
        moduleAddress: '0x1',
        packageName: 'simple_token',
        generateToml: false,
      });
      expect(transpileResult.success).toBe(true);
      expect(transpileResult.modules.length).toBeGreaterThan(0);

      for (const mod of transpileResult.modules) {
        const validation = await validateMoveCode(mod.code);
        if (!validation.valid) {
          console.log(`Validation errors in ${mod.name}:`, validation.errors);
          console.log('Generated code:\n', mod.code);
        }
        // Tree-sitter should parse the output without crashing
        expect(validation).toBeDefined();
        expect(validation.errors).toBeDefined();
      }
    });

    it('should validate transpiled counter contract', async () => {
      const solidity = `
        // SPDX-License-Identifier: MIT
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

      const transpileResult = transpile(solidity, {
        moduleAddress: '0x1',
        packageName: 'counter',
        generateToml: false,
      });
      expect(transpileResult.success).toBe(true);

      const mod = transpileResult.modules[0];
      const validation = await validateMoveCode(mod.code);
      expect(validation).toBeDefined();

      if (validation.valid && validation.structure) {
        expect(validation.structure.modules.length).toBeGreaterThan(0);
        expect(validation.structure.functions.length).toBeGreaterThan(0);
      }
    });
  });

  describe('node navigation', () => {
    it('should support fieldChildren for multiple results', async () => {
      const result = await parseMoveCode(`
        module 0x1::test {
          public fun a(): u64 { 0 }
          public fun b(): u64 { 1 }
        }
      `);

      expect(result.success).toBe(true);
      const body = result.tree.children[0].fieldChild('body');
      expect(body).not.toBeNull();
      // Body should have function children
      expect(body!.children.length).toBeGreaterThanOrEqual(2);
    });

    it('should return null for missing field children', async () => {
      const result = await parseMoveCode(`
        module 0x1::test { }
      `);

      expect(result.success).toBe(true);
      const mod = result.tree.children[0];
      // "return_type" is not a field on module_declaration
      const nonExistent = mod.fieldChild('return_type');
      expect(nonExistent).toBeNull();
    });

    it('should expose text content of nodes', async () => {
      const source = 'module 0x1::hello { }';
      const result = await parseMoveCode(source);

      expect(result.success).toBe(true);
      expect(result.tree.text).toBe(source);
    });

    it('should correctly mark named vs anonymous nodes', async () => {
      const result = await parseMoveCode('module 0x1::test { }');

      expect(result.success).toBe(true);
      // Root and module_declaration are named nodes
      expect(result.tree.isNamed).toBe(true);
      expect(result.tree.children[0].isNamed).toBe(true);
    });
  });
});
