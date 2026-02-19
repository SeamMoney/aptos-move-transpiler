/**
 * Unit Tests for Tier 1 Transpilation Flags
 * Tests: strictMode, reentrancyPattern, stringType, useInlineFunctions,
 *        emitSourceComments, viewFunctionBehavior, errorStyle
 */

import { describe, it, expect } from 'vitest';
import { transpile } from '../../src/transpiler.js';

// ─── Helper ───────────────────────────────────────────────

function transpileWith(source: string, flags: Record<string, any>) {
  return transpile(source, {
    moduleAddress: '0x1',
    generateToml: false,
    ...flags,
  });
}

const SIMPLE_CONTRACT = `
pragma solidity ^0.8.0;
contract Simple {
    uint256 public value;
    function setValue(uint256 _value) public {
        value = _value;
    }
    function getValue() public view returns (uint256) {
        return value;
    }
}
`;

const REQUIRE_CONTRACT = `
pragma solidity ^0.8.0;
contract WithRequire {
    uint256 public balance;
    function withdraw(uint256 amount) public {
        require(amount > 0, "Amount must be positive");
        require(amount <= balance, "Insufficient balance");
        balance -= amount;
    }
}
`;

const REENTRANCY_CONTRACT = `
pragma solidity ^0.8.0;
contract WithReentrancy {
    uint256 public value;
    modifier nonReentrant() {
        _;
    }
    function doSomething() public nonReentrant {
        value = 1;
    }
}
`;

const STRING_CONTRACT = `
pragma solidity ^0.8.0;
contract WithStrings {
    string public name;
    function setName(string memory _name) public {
        name = _name;
    }
}
`;

const VIEW_CONTRACT = `
pragma solidity ^0.8.0;
contract WithView {
    uint256 public counter;
    function getCounter() public view returns (uint256) {
        return counter;
    }
    function increment() public {
        counter += 1;
    }
}
`;

const PRIVATE_HELPERS_CONTRACT = `
pragma solidity ^0.8.0;
contract WithHelpers {
    uint256 public value;
    function add(uint256 a, uint256 b) private pure returns (uint256) {
        return a + b;
    }
    function multiply(uint256 a, uint256 b) private pure returns (uint256) {
        return a * b;
    }
    function setValue(uint256 v) public {
        value = v;
    }
}
`;

const UNSUPPORTED_CONTRACT = `
pragma solidity ^0.8.0;
contract WithUnsupported {
    uint256 public value;
    function test() public {
        uint256 gas = gasleft();
        value = gas;
    }
}
`;

// ─── Tests ────────────────────────────────────────────────

describe('Tier 1 Flags', () => {

  describe('strictMode', () => {
    it('should succeed with warnings when strictMode is off (default)', () => {
      const result = transpileWith(UNSUPPORTED_CONTRACT, { strictMode: false });
      expect(result.success).toBe(true);
      expect(result.warnings.some(w => w.includes('gasleft'))).toBe(true);
    });

    it('should fail with errors when strictMode is on', () => {
      const result = transpileWith(UNSUPPORTED_CONTRACT, { strictMode: true });
      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.includes('gasleft'))).toBe(true);
    });

    it('should not affect supported patterns', () => {
      const result = transpileWith(SIMPLE_CONTRACT, { strictMode: true });
      expect(result.success).toBe(true);
    });
  });

  describe('reentrancyPattern', () => {
    it('should emit reentrancy guard with mutex pattern (default)', () => {
      const result = transpileWith(REENTRANCY_CONTRACT, { reentrancyPattern: 'mutex' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('reentrancy_status');
      expect(code).toContain('E_REENTRANCY');
    });

    it('should skip reentrancy guard with none pattern', () => {
      const result = transpileWith(REENTRANCY_CONTRACT, { reentrancyPattern: 'none' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Should not contain reentrancy guard check/set logic in function body
      expect(code).not.toContain('reentrancy_status');
      expect(code).not.toContain('assert!(state.reentrancy');
    });
  });

  describe('stringType', () => {
    it('should use string::String by default', () => {
      const result = transpileWith(STRING_CONTRACT, { stringType: 'string' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('string::String');
    });

    it('should use vector<u8> in bytes mode', () => {
      const result = transpileWith(STRING_CONTRACT, { stringType: 'bytes' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('vector<u8>');
    });
  });

  describe('useInlineFunctions', () => {
    it('should not add inline keyword by default', () => {
      const result = transpileWith(PRIVATE_HELPERS_CONTRACT, { useInlineFunctions: false });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).not.toContain('inline fun');
    });

    it('should add inline keyword to private pure functions', () => {
      const result = transpileWith(PRIVATE_HELPERS_CONTRACT, { useInlineFunctions: true });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('inline fun');
    });

    it('should not inline public functions', () => {
      const result = transpileWith(SIMPLE_CONTRACT, { useInlineFunctions: true });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // setValue and getValue are public, should not be inlined
      expect(code).not.toContain('public inline');
    });
  });

  describe('emitSourceComments', () => {
    it('should not include source comments by default', () => {
      const result = transpileWith(SIMPLE_CONTRACT, { emitSourceComments: false });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).not.toContain('// Solidity:');
    });

    it('should include source comments when enabled', () => {
      const result = transpileWith(SIMPLE_CONTRACT, { emitSourceComments: true });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('// Solidity: setValue');
      expect(code).toContain('// Solidity: getValue');
    });
  });

  describe('viewFunctionBehavior', () => {
    it('should emit #[view] attribute by default', () => {
      const result = transpileWith(VIEW_CONTRACT, { viewFunctionBehavior: 'annotate' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('#[view]');
    });

    it('should skip #[view] attribute when set to skip', () => {
      const result = transpileWith(VIEW_CONTRACT, { viewFunctionBehavior: 'skip' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).not.toContain('#[view]');
    });
  });

  describe('errorStyle', () => {
    it('should use abort codes by default', () => {
      const result = transpileWith(REQUIRE_CONTRACT, { errorStyle: 'abort-codes' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('assert!');
      // Should not have inline comments with original messages
      expect(code).not.toContain('// require:');
    });

    it('should include verbose error messages when enabled', () => {
      const result = transpileWith(REQUIRE_CONTRACT, { errorStyle: 'abort-verbose' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('assert!');
      // Should have inline comment with original message
      expect(code).toContain('// require:');
      expect(code).toContain('Amount must be positive');
    });
  });

  describe('flag combinations', () => {
    it('should work with multiple flags enabled simultaneously', () => {
      const result = transpileWith(SIMPLE_CONTRACT, {
        strictMode: false,
        stringType: 'string',
        emitSourceComments: true,
        useInlineFunctions: true,
        viewFunctionBehavior: 'annotate',
        errorStyle: 'abort-codes',
      });
      expect(result.success).toBe(true);
      expect(result.modules.length).toBeGreaterThan(0);
    });

    it('should work with all flags set to non-default values', () => {
      const result = transpileWith(SIMPLE_CONTRACT, {
        strictMode: true,
        stringType: 'bytes',
        emitSourceComments: true,
        useInlineFunctions: true,
        reentrancyPattern: 'none',
        viewFunctionBehavior: 'skip',
        errorStyle: 'abort-verbose',
      });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('// Solidity:');
      expect(code).not.toContain('#[view]');
    });
  });
});
