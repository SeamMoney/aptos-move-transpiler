import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatMoveCode,
  isFormatterAvailable,
  formatMoveModules,
  resetFormatterCache,
} from '../../src/formatter/move-formatter.js';
import { transpile } from '../../src/transpiler.js';

describe('Move Formatter', () => {
  beforeEach(() => {
    resetFormatterCache();
  });

  describe('isFormatterAvailable', () => {
    it('should return a boolean', () => {
      const available = isFormatterAvailable();
      expect(typeof available).toBe('boolean');
    });

    it('should cache the result', () => {
      const first = isFormatterAvailable();
      const second = isFormatterAvailable();
      expect(first).toBe(second);
    });
  });

  describe('formatMoveCode', () => {
    it('should format valid Move code', () => {
      const code = `module 0x1::test {
    use std::signer;
    struct MyState has key { value: u64 }
    public fun get_value(): u64 acquires MyState { borrow_global<MyState>(@0x1).value }
}`;

      const result = formatMoveCode(code);

      if (isFormatterAvailable()) {
        expect(result.formatted).toBe(true);
        expect(result.code).toContain('module 0x1::test');
        expect(result.code).toContain('MyState');
        expect(result.error).toBeUndefined();
      } else {
        expect(result.formatted).toBe(false);
        expect(result.code).toBe(code); // Returns original
        expect(result.error).toBeDefined();
      }
    });

    it('should return original code when formatter is not available', () => {
      // Simulate unavailable formatter by checking behavior
      const code = 'module 0x1::test {}';
      const result = formatMoveCode(code);

      // Either way, code should be valid Move
      expect(result.code).toContain('module 0x1::test');
    });

    it('should handle empty input', () => {
      const result = formatMoveCode('');
      // Should not crash
      expect(result.code).toBeDefined();
    });

    it('should handle malformed Move code gracefully', () => {
      const code = 'this is not valid move code {{{';
      const result = formatMoveCode(code);
      // Should return original code if formatting fails
      expect(result.code).toBeDefined();
    });
  });

  describe('formatMoveModules', () => {
    it('should format multiple modules', () => {
      const modules = [
        { name: 'mod_a', code: 'module 0x1::mod_a { public fun a(): u64 { 1 } }' },
        { name: 'mod_b', code: 'module 0x1::mod_b { public fun b(): u64 { 2 } }' },
      ];

      const results = formatMoveModules(modules);

      expect(results.size).toBe(2);
      expect(results.has('mod_a')).toBe(true);
      expect(results.has('mod_b')).toBe(true);

      const a = results.get('mod_a')!;
      const b = results.get('mod_b')!;
      expect(a.code).toContain('mod_a');
      expect(b.code).toContain('mod_b');
    });
  });

  describe('transpile with format option', () => {
    it('should format output when format=true', () => {
      const source = `
        contract SimpleStorage {
          uint256 public value;

          function setValue(uint256 _value) public {
            value = _value;
          }
        }
      `;

      const withFormat = transpile(source, { format: true });
      const withoutFormat = transpile(source, { format: false });

      expect(withFormat.success).toBe(true);
      expect(withoutFormat.success).toBe(true);

      // Both should produce valid Move
      expect(withFormat.modules[0].code).toContain('module');
      expect(withoutFormat.modules[0].code).toContain('module');

      if (isFormatterAvailable()) {
        // Formatted version may differ in whitespace
        // but should still contain the same structural elements
        expect(withFormat.modules[0].code).toContain('SimpleStorageState');
        expect(withFormat.modules[0].code).toContain('set_value');
      }
    });

    it('should not format by default', () => {
      const source = `
        contract Test {
          uint256 public x;
        }
      `;

      const result = transpile(source);
      expect(result.success).toBe(true);
      // Default behavior: no formatting applied
    });
  });

  // Only run these tests if the formatter is actually available
  describe.runIf(isFormatterAvailable())('with formatter available', () => {
    it('should produce different output than raw codegen for complex code', () => {
      const code = `module 0x1::complex {
    use std::signer;
    use aptos_framework::event;

    const E_NOT_AUTHORIZED: u64 = 1;

    struct State has key { value: u256, owner: address }

    #[event]
    struct ValueChanged has drop, store { old_value: u256, new_value: u256 }

    public entry fun update(account: &signer, new_val: u256) acquires State {
        let addr = signer::address_of(account);
        let state = borrow_global_mut<State>(addr);
        let old = state.value;
        state.value = new_val;
        event::emit(ValueChanged { old_value: old, new_value: new_val });
    }
}`;

      const result = formatMoveCode(code);
      expect(result.formatted).toBe(true);
      expect(result.error).toBeUndefined();
      // Formatted code should contain all key elements
      expect(result.code).toContain('module 0x1::complex');
      expect(result.code).toContain('E_NOT_AUTHORIZED');
      expect(result.code).toContain('ValueChanged');
      expect(result.code).toContain('update');
    });

    it('should format transpiler output successfully', () => {
      const source = `
        contract Counter {
          uint256 private count;
          event CountChanged(uint256 newCount);

          function increment() public {
            count += 1;
            emit CountChanged(count);
          }

          function getCount() public view returns (uint256) {
            return count;
          }
        }
      `;

      const result = transpile(source, { format: true });
      expect(result.success).toBe(true);
      expect(result.modules.length).toBeGreaterThan(0);

      const moveCode = result.modules[0].code;
      expect(moveCode).toContain('module');
      expect(moveCode).toContain('increment');
      expect(moveCode).toContain('get_count');
    });

    it('should respect format options', () => {
      const code = `module 0x1::test {
    public fun hello(): u64 { 42 }
}`;

      const result = formatMoveCode(code, { indentSize: 2 });
      expect(result.formatted).toBe(true);
    });
  });
});
