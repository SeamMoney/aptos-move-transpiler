import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import {
  wasmCompileCheckModules,
  isWasmCompilerAvailable,
  resetWasmCompilerCache,
} from '../../src/compiler/wasm-move-compiler.js';

// Paths to WASM assets (relative to repo root)
const WASM_PATH = resolve(__dirname, '../../..', 'blinknow/public/wasm/move-compiler-v2.wasm');
const BYTECODES_PATH = resolve(__dirname, '../../..', 'blinknow/public/wasm/framework-bytecodes.json');
const EVM_BYTECODE_PATH = resolve(__dirname, '../../src/stdlib/evm_compat_bytecode.json');

const wasmAvailable = existsSync(WASM_PATH) && existsSync(BYTECODES_PATH);
const evmBytecodeAvailable = existsSync(EVM_BYTECODE_PATH);

describe('WASM Move Compiler', () => {
  beforeEach(() => {
    resetWasmCompilerCache();
  });

  describe('isWasmCompilerAvailable', () => {
    it('should return false for non-existent paths', () => {
      expect(isWasmCompilerAvailable('/nonexistent/path.wasm', '/nonexistent/bytecodes.json')).toBe(false);
    });

    it('should return false if only one file exists', () => {
      if (!wasmAvailable) return;
      expect(isWasmCompilerAvailable(WASM_PATH, '/nonexistent/bytecodes.json')).toBe(false);
      expect(isWasmCompilerAvailable('/nonexistent/path.wasm', BYTECODES_PATH)).toBe(false);
    });

    it.runIf(wasmAvailable)('should return true when wasmtime + files exist', () => {
      expect(isWasmCompilerAvailable(WASM_PATH, BYTECODES_PATH)).toBe(true);
    });
  });

  describe('wasmCompileCheckModules', () => {
    it('should return error for missing WASM binary', async () => {
      const result = await wasmCompileCheckModules(
        [{ name: 'test', code: 'module 0x1::test {}' }],
        {
          wasmPath: '/nonexistent/move-compiler-v2.wasm',
          bytecodesPath: '/nonexistent/framework-bytecodes.json',
        }
      );
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('not found');
    });

    it.runIf(wasmAvailable)('should return structured CompileCheckResult shape', async () => {
      const result = await wasmCompileCheckModules(
        [{ name: 'test', code: 'module 0x1::test { public fun x(): u64 { 0 } }' }],
        { wasmPath: WASM_PATH, bytecodesPath: BYTECODES_PATH }
      );
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    }, 120000);
  });

  describe.runIf(wasmAvailable)('with WASM compiler available', () => {
    const baseOptions = {
      wasmPath: WASM_PATH,
      bytecodesPath: BYTECODES_PATH,
      moduleAddress: '0x1',
      packageName: 'test_pkg',
    };

    it('should compile a simple module (no framework deps)', async () => {
      const result = await wasmCompileCheckModules(
        [{
          name: 'simple',
          code: `module 0x1::simple {
    public fun add(a: u64, b: u64): u64 { a + b }
}`,
        }],
        baseOptions
      );

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    }, 120000);

    it('should compile a module using string/option (precompiled framework deps)', async () => {
      const result = await wasmCompileCheckModules(
        [{
          name: 'with_deps',
          code: `module 0x1::with_deps {
    use std::string;
    use std::option;

    public fun make_name(): string::String {
        string::utf8(b"hello")
    }

    public fun maybe_value(): option::Option<u64> {
        option::some(42)
    }
}`,
        }],
        baseOptions
      );

      if (!result.success) {
        console.log('Compile errors:', result.errors);
      }
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    }, 120000);

    it.runIf(evmBytecodeAvailable)(
      'should compile a module using evm_compat (pre-compiled bytecode)',
      async () => {
        const result = await wasmCompileCheckModules(
          [{
            name: 'uses_evm',
            code: `module 0x42::uses_evm {
    use transpiler::evm_compat;

    public fun safe_add(a: u256, b: u256): u256 {
        evm_compat::safe_add_u256(a, b)
    }
}`,
          }],
          { ...baseOptions, moduleAddress: '0x42', packageName: 'uses_evm' }
        );

        if (!result.success) {
          console.log('Compile errors:', result.errors);
        }
        expect(result.success).toBe(true);
        expect(result.errors).toHaveLength(0);
      },
      120000
    );

    it.runIf(evmBytecodeAvailable)(
      'should compile a complex DeFi contract (evm_compat + account + event + signer + string)',
      async () => {
        // This is the critical test: a typical transpiled Counter contract that uses
        // evm_compat + multiple framework modules. Previously crashed with SIGABRT
        // when using V8 WASI (~39 dep limit). Now works via wasmtime (no limit).
        const result = await wasmCompileCheckModules(
          [{
            name: 'counter',
            code: `module 0x42::counter {
    use transpiler::evm_compat;
    use std::signer;
    use std::string;
    use aptos_framework::event;
    use aptos_framework::account;

    struct State has key { count: u256, owner: address }

    public entry fun initialize(deployer: &signer) {
        let addr = signer::address_of(deployer);
        move_to(deployer, State { count: 0, owner: addr });
    }

    public entry fun increment(user: &signer) acquires State {
        let state = borrow_global_mut<State>(@0x42);
        state.count = evm_compat::safe_add_u256(state.count, 1);
    }

    public fun get_count(): u256 acquires State {
        borrow_global<State>(@0x42).count
    }
}`,
          }],
          { ...baseOptions, moduleAddress: '0x42', packageName: 'counter' }
        );

        if (!result.success) {
          console.log('Complex DeFi compile errors:', result.errors);
        }
        expect(result.success).toBe(true);
        expect(result.errors).toHaveLength(0);
      },
      120000
    );

    it.runIf(evmBytecodeAvailable)(
      'should compile an ERC-20-like contract (evm_compat + object + fungible_asset)',
      async () => {
        // ERC-20 pattern: uses object, fungible_asset, primary_fungible_store
        // These have 65+ transitive deps — impossible in V8, works in wasmtime.
        const result = await wasmCompileCheckModules(
          [{
            name: 'my_token',
            code: `module 0x42::my_token {
    use transpiler::evm_compat;
    use std::signer;
    use std::string;
    use std::option;
    use aptos_framework::event;
    use aptos_framework::object;
    use aptos_framework::fungible_asset;
    use aptos_framework::primary_fungible_store;

    struct TokenState has key { total_supply: u256 }

    public entry fun initialize(deployer: &signer) {
        let addr = signer::address_of(deployer);
        move_to(deployer, TokenState { total_supply: 0 });
    }

    public fun get_supply(): u256 acquires TokenState {
        borrow_global<TokenState>(@0x42).total_supply
    }
}`,
          }],
          { ...baseOptions, moduleAddress: '0x42', packageName: 'my_token' }
        );

        if (!result.success) {
          console.log('ERC-20 compile errors:', result.errors);
        }
        expect(result.success).toBe(true);
        expect(result.errors).toHaveLength(0);
      },
      120000
    );

    it('should return structured errors for invalid Move code', async () => {
      const result = await wasmCompileCheckModules(
        [{
          name: 'bad_types',
          code: `module 0x1::bad_types {
    public fun bad(): u64 {
        let x: bool = true;
        x + 1
    }
}`,
        }],
        baseOptions
      );

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }, 120000);

    it('should compile multiple modules together', async () => {
      const result = await wasmCompileCheckModules(
        [
          {
            name: 'math_lib',
            code: `module 0x1::math_lib {
    public fun add(a: u64, b: u64): u64 { a + b }
}`,
          },
          {
            name: 'consumer',
            code: `module 0x1::consumer {
    use 0x1::math_lib;
    public fun compute(): u64 { math_lib::add(1, 2) }
}`,
          },
        ],
        baseOptions
      );

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    }, 120000);

    it('should detect unresolved references', async () => {
      const result = await wasmCompileCheckModules(
        [{
          name: 'missing_ref',
          code: `module 0x1::missing_ref {
    public fun broken(): u64 {
        nonexistent_module::call()
    }
}`,
        }],
        baseOptions
      );

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }, 120000);
  });
});
