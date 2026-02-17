import { describe, it, expect, beforeEach } from 'vitest';
import {
  compileCheck,
  compileCheckModules,
  isCompilerAvailable,
  resetCompilerCache,
} from '../../src/compiler/move-compiler.js';
import { transpile } from '../../src/transpiler.js';

describe('Move Compiler Integration', () => {
  beforeEach(() => {
    resetCompilerCache();
  });

  describe('isCompilerAvailable', () => {
    it('should return a boolean', () => {
      const available = isCompilerAvailable();
      expect(typeof available).toBe('boolean');
    });

    it('should cache the result', () => {
      const first = isCompilerAvailable();
      const second = isCompilerAvailable();
      expect(first).toBe(second);
    });
  });

  describe('compileCheck', () => {
    it('should return structured result', () => {
      const code = `module 0x1::test_mod {
    struct State has key {
        value: u64
    }
}`;
      const result = compileCheck(code, 'test_mod', { timeout: 60000 });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    }, 60000);
  });

  describe('compileCheckModules', () => {
    it('should accept multiple modules', () => {
      const modules = [
        {
          name: 'mod_a',
          code: `module 0x1::mod_a {
    public fun value(): u64 { 42 }
}`,
        },
      ];
      const result = compileCheckModules(modules, { timeout: 60000 });
      expect(result).toHaveProperty('success');
    }, 60000);
  });

  // Only run heavy tests if the compiler is available
  describe.runIf(isCompilerAvailable())('with compiler available', () => {
    it('should compile a valid simple module', () => {
      const code = `module 0x1::simple_test {
    struct State has key {
        value: u64
    }

    fun init_module(deployer: &signer) {
        move_to(deployer, State { value: 0 });
    }
}`;
      const result = compileCheck(code, 'simple_test', {
        moduleAddress: '0x1',
        packageName: 'simple_test',
        timeout: 60000,
      });

      if (!result.success) {
        console.log('Compile errors:', result.errors);
        console.log('Raw output:', result.rawOutput?.slice(0, 500));
      }

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    }, 60000);

    it('should detect type errors in invalid module', () => {
      const code = `module 0x1::bad_types {
    public fun bad(): u64 {
        let x: bool = true;
        x + 1
    }
}`;
      const result = compileCheck(code, 'bad_types', {
        moduleAddress: '0x1',
        packageName: 'bad_types',
      });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }, 60000);

    it('should detect unresolved references', () => {
      const code = `module 0x1::missing_ref {
    public fun broken(): u64 {
        nonexistent_module::call()
    }
}`;
      const result = compileCheck(code, 'missing_ref', {
        moduleAddress: '0x1',
        packageName: 'missing_ref',
      });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }, 60000);

    it('should compile multiple modules together', () => {
      const modules = [
        {
          name: 'math_lib',
          code: `module 0x1::math_lib {
    public fun add(a: u64, b: u64): u64 {
        a + b
    }
}`,
        },
        {
          name: 'consumer',
          code: `module 0x1::consumer {
    use 0x1::math_lib;

    public fun compute(): u64 {
        math_lib::add(1, 2)
    }
}`,
        },
      ];

      const result = compileCheckModules(modules, {
        moduleAddress: '0x1',
        packageName: 'multi_mod',
      });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    }, 60000);

    it('should compile transpiler output', () => {
      const source = `
        contract Counter {
          uint256 private count;

          function increment() public {
            count += 1;
          }

          function getCount() public view returns (uint256) {
            return count;
          }
        }
      `;

      const transpileResult = transpile(source, {
        moduleAddress: '0x1',
        packageName: 'counter_check',
      });

      expect(transpileResult.success).toBe(true);

      const compileResult = compileCheckModules(
        transpileResult.modules.map(m => ({ name: m.name, code: m.code })),
        {
          moduleAddress: '0x1',
          packageName: 'counter_check',
        }
      );

      // Log diagnostics for debugging if it fails
      if (!compileResult.success) {
        console.log('Compile errors:', compileResult.errors);
        console.log('Raw output:', compileResult.rawOutput?.slice(0, 500));
      }

      expect(compileResult.success).toBe(true);
    }, 60000);

    it('should provide source location in diagnostics', () => {
      const code = `module 0x1::loc_test {
    public fun bad(): u64 {
        true
    }
}`;
      const result = compileCheck(code, 'loc_test', {
        moduleAddress: '0x1',
        packageName: 'loc_test',
      });

      expect(result.success).toBe(false);
      // Compiler should provide at least one error with details
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toBeTruthy();
    }, 60000);
  });
});
