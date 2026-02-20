/**
 * Tests for the unified Sol2Move SDK
 */

import { describe, it, expect, vi } from 'vitest';
import { Sol2Move } from '../../src/sdk.js';

const COUNTER_SOL = `
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

const VALID_MOVE = `
  module 0x1::counter {
    struct State has key {
      count: u64,
    }

    public fun increment(state: &mut State) {
      state.count = state.count + 1;
    }

    public fun get_count(state: &State): u64 {
      state.count
    }
  }
`;

describe('Sol2Move SDK', () => {
  describe('constructor', () => {
    it('should create an instance with default options', () => {
      const sdk = new Sol2Move();
      expect(sdk).toBeInstanceOf(Sol2Move);
    });

    it('should accept configuration options', () => {
      const sdk = new Sol2Move({
        moduleAddress: '0xCAFE',
        packageName: 'my_project',
        generateToml: true,
      });
      expect(sdk).toBeInstanceOf(Sol2Move);
    });
  });

  describe('Solidity tools', () => {
    const sdk = new Sol2Move();

    it('validateSolidity — valid source', () => {
      const result = sdk.validateSolidity(COUNTER_SOL);
      expect(result.valid).toBe(true);
      expect(result.contracts).toContain('Counter');
      expect(result.errors).toHaveLength(0);
    });

    it('validateSolidity — invalid source', () => {
      // The Solidity parser is tolerant, so use something that definitely fails
      const result = sdk.validateSolidity('contract { function ( }');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('analyzeSolidity — extracts structure', () => {
      const result = sdk.analyzeSolidity(COUNTER_SOL);
      expect(result.valid).toBe(true);
      expect(result.contracts).toHaveLength(1);

      const counter = result.contracts[0];
      expect(counter.name).toBe('Counter');
      expect(counter.kind).toBe('contract');
      expect(counter.functions).toContain('increment');
      expect(counter.functions).toContain('decrement');
      expect(counter.functions).toContain('getCount');
      expect(counter.stateVariables).toContain('count');
    });

    it('analyzeSolidity — invalid source returns errors', () => {
      const result = sdk.analyzeSolidity('broken!!!');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('transpile', () => {
    it('should transpile with SDK default options', () => {
      const sdk = new Sol2Move({ moduleAddress: '0x1', packageName: 'counter' });
      const result = sdk.transpile(COUNTER_SOL);

      expect(result.success).toBe(true);
      expect(result.modules.length).toBeGreaterThan(0);
      expect(result.modules[0].code).toContain('module');
      expect(result.modules[0].ast).toBeDefined();
    });

    it('should allow per-call overrides', () => {
      const sdk = new Sol2Move({ moduleAddress: '0x1', packageName: 'default_name' });
      const result = sdk.transpile(COUNTER_SOL, { packageName: 'override_name' });

      expect(result.success).toBe(true);
    });

    it('should generate Move.toml when configured', () => {
      const sdk = new Sol2Move({ moduleAddress: '0x1', generateToml: true, packageName: 'counter' });
      const result = sdk.transpile(COUNTER_SOL);

      expect(result.moveToml).toBeDefined();
      expect(result.moveToml).toContain('[package]');
    });

    it('should skip Move.toml when configured', () => {
      const sdk = new Sol2Move({ generateToml: false });
      const result = sdk.transpile(COUNTER_SOL);

      expect(result.moveToml).toBeUndefined();
    });

    it('should report errors for invalid source', () => {
      const sdk = new Sol2Move();
      const result = sdk.transpile('not solidity');

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Move tools', () => {
    const sdk = new Sol2Move();

    it('isMoveParserAvailable — returns true', async () => {
      const available = await sdk.isMoveParserAvailable();
      expect(available).toBe(true);
    });

    it('parseMove — valid code', async () => {
      const result = await sdk.parseMove(VALID_MOVE);
      expect(result.success).toBe(true);
      expect(result.tree.type).toBe('source_file');
      expect(result.tree.children.length).toBeGreaterThan(0);
    });

    it('parseMove — invalid code', async () => {
      const result = await sdk.parseMove('module { broken }}}');
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('validateMove — valid code', async () => {
      const result = await sdk.validateMove(VALID_MOVE);
      expect(result.valid).toBe(true);
      expect(result.structure).toBeDefined();
      expect(result.structure?.modules).toContain('0x1::counter');
      expect(result.structure?.functions).toContain('increment');
      expect(result.structure?.functions).toContain('get_count');
      expect(result.structure?.structs).toContain('State');
    });

    it('validateMove — invalid code', async () => {
      const result = await sdk.validateMove('not move code');
      expect(result.valid).toBe(false);
      expect(result.structure).toBeUndefined();
    });

    it('generateMove — produces source from AST', () => {
      const sdk2 = new Sol2Move({ moduleAddress: '0x1', packageName: 'test' });
      const transpileResult = sdk2.transpile(COUNTER_SOL);
      expect(transpileResult.success).toBe(true);

      const ast = transpileResult.modules[0].ast;
      const code = sdk2.generateMove(ast);

      expect(code).toContain('module');
      expect(code).toContain('fun');
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
    });
  });

  describe('transpileAndValidate', () => {
    it('should transpile and validate in one call', async () => {
      const sdk = new Sol2Move({ moduleAddress: '0x1', packageName: 'counter', generateToml: false });
      const result = await sdk.transpileAndValidate(COUNTER_SOL);

      expect(result.transpile.success).toBe(true);
      expect(result.moveValidation).not.toBeNull();
      expect(result.moveValidation!.length).toBeGreaterThan(0);

      for (const mod of result.moveValidation!) {
        expect(mod.name).toBeTruthy();
        expect(typeof mod.valid).toBe('boolean');
        expect(mod.errors).toBeDefined();
      }
    });

    it('should return allValid flag', async () => {
      const sdk = new Sol2Move({ moduleAddress: '0x1', packageName: 'counter', generateToml: false });
      const result = await sdk.transpileAndValidate(COUNTER_SOL);

      expect(typeof result.allValid).toBe('boolean');
    });

    it('should handle transpilation failure gracefully', async () => {
      const sdk = new Sol2Move();
      const result = await sdk.transpileAndValidate('not solidity');

      expect(result.transpile.success).toBe(false);
      expect(result.moveValidation).toBeNull();
      expect(result.allValid).toBe(false);
    });

    it('should keep allValid true when parser is unavailable but transpilation succeeds', async () => {
      const sdk = new Sol2Move({ moduleAddress: '0x1', generateToml: false });
      const parserSpy = vi.spyOn(sdk, 'isMoveParserAvailable').mockResolvedValue(false);

      const result = await sdk.transpileAndValidate(COUNTER_SOL);

      expect(result.transpile.success).toBe(true);
      expect(result.moveValidation).toBeNull();
      expect(result.allValid).toBe(true);

      parserSpy.mockRestore();
    });

    it('should validate multiple modules from a multi-contract source', async () => {
      const multiContract = `
        // SPDX-License-Identifier: MIT
        pragma solidity ^0.8.20;

        contract TokenA {
          uint256 public supply;
          function mint() public { supply += 1; }
        }

        contract TokenB {
          uint256 public balance;
          function deposit() public { balance += 1; }
        }
      `;

      const sdk = new Sol2Move({ moduleAddress: '0x1', generateToml: false });
      const result = await sdk.transpileAndValidate(multiContract);

      expect(result.transpile.success).toBe(true);
      expect(result.transpile.modules.length).toBe(2);
      expect(result.moveValidation).not.toBeNull();
      expect(result.moveValidation!.length).toBe(2);
    });
  });
});
