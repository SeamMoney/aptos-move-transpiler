/**
 * Unit Tests for optionalValues transpilation flag
 * Tests the 'sentinel' (default) and 'option-type' modes.
 *
 * When 'option-type':
 * - address(0) literals become option::none<address>()
 * - addr == address(0) becomes option::is_none(&addr)
 * - addr != address(0) becomes option::is_some(&addr)
 * - Default address values in state become option::none<address>()
 */

import { describe, it, expect } from 'vitest';
import { transpile } from '../../src/transpiler.js';

// ---- Helper ----

function transpileWith(source: string, flags: Record<string, any>) {
  return transpile(source, {
    moduleAddress: '0x1',
    generateToml: false,
    ...flags,
  });
}

// ---- Test contracts ----

const ADDRESS_COMPARISON_CONTRACT = `
pragma solidity ^0.8.0;
contract AddressCheck {
    address public owner;
    function isOwnerSet() public view returns (bool) {
        return owner != address(0);
    }
    function isOwnerEmpty() public view returns (bool) {
        return owner == address(0);
    }
}
`;

const ADDRESS_ASSIGNMENT_CONTRACT = `
pragma solidity ^0.8.0;
contract AddressAssign {
    address public recipient;
    function clearRecipient() public {
        recipient = address(0);
    }
}
`;

const ADDRESS_STATE_DEFAULT_CONTRACT = `
pragma solidity ^0.8.0;
contract AddressDefault {
    address public admin;
    uint256 public value;
    function setValue(uint256 v) public {
        value = v;
    }
}
`;

const NO_ADDRESS_CONTRACT = `
pragma solidity ^0.8.0;
contract NoAddress {
    uint256 public counter;
    function increment() public {
        counter += 1;
    }
}
`;

// ---- Tests ----

describe('optionalValues flag', () => {

  describe('sentinel mode (default)', () => {
    it('should use @0x0 for address(0) comparisons', () => {
      const result = transpileWith(ADDRESS_COMPARISON_CONTRACT, { optionalValues: 'sentinel' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('@0x0');
      expect(code).not.toContain('option::is_none');
      expect(code).not.toContain('option::is_some');
    });

    it('should use @0x0 for address(0) assignment', () => {
      const result = transpileWith(ADDRESS_ASSIGNMENT_CONTRACT, { optionalValues: 'sentinel' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('@0x0');
      expect(code).not.toContain('option::none');
    });

    it('should use @0x0 as default address value in state init', () => {
      const result = transpileWith(ADDRESS_STATE_DEFAULT_CONTRACT, { optionalValues: 'sentinel' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('@0x0');
      expect(code).not.toContain('option::none');
    });
  });

  describe('option-type mode', () => {
    it('should transform addr != address(0) to option::is_some(&addr)', () => {
      const result = transpileWith(ADDRESS_COMPARISON_CONTRACT, { optionalValues: 'option-type' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('option::is_some');
    });

    it('should transform addr == address(0) to option::is_none(&addr)', () => {
      const result = transpileWith(ADDRESS_COMPARISON_CONTRACT, { optionalValues: 'option-type' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('option::is_none');
    });

    it('should transform address(0) literal to option::none<address>()', () => {
      const result = transpileWith(ADDRESS_ASSIGNMENT_CONTRACT, { optionalValues: 'option-type' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('option::none<address>()');
    });

    it('should use option::none<address>() for default address state values', () => {
      const result = transpileWith(ADDRESS_STATE_DEFAULT_CONTRACT, { optionalValues: 'option-type' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('option::none<address>()');
      expect(code).not.toContain('@0x0');
    });

    it('should add std::option use declaration when option-type is active', () => {
      const result = transpileWith(ADDRESS_COMPARISON_CONTRACT, { optionalValues: 'option-type' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('use std::option');
    });

    it('should not affect contracts without address types', () => {
      const sentinelResult = transpileWith(NO_ADDRESS_CONTRACT, { optionalValues: 'sentinel' });
      const optionResult = transpileWith(NO_ADDRESS_CONTRACT, { optionalValues: 'option-type' });
      expect(sentinelResult.success).toBe(true);
      expect(optionResult.success).toBe(true);
      // Both should produce the same code when no address patterns are present
      const sentinelCode = sentinelResult.modules[0]?.code || '';
      const optionCode = optionResult.modules[0]?.code || '';
      expect(sentinelCode).not.toContain('option::');
      expect(optionCode).not.toContain('option::');
    });

    it('should not contain @0x0 in address comparisons with option-type', () => {
      const result = transpileWith(ADDRESS_COMPARISON_CONTRACT, { optionalValues: 'option-type' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // The comparison patterns should be fully replaced, no @0x0 remnants
      // (though @0x0 may still appear in non-comparison contexts if any)
      expect(code).not.toContain('== @0x0');
      expect(code).not.toContain('!= @0x0');
    });
  });

  describe('default behavior', () => {
    it('should default to sentinel mode when flag is not specified', () => {
      const result = transpileWith(ADDRESS_COMPARISON_CONTRACT, {});
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('@0x0');
      expect(code).not.toContain('option::is_none');
    });
  });
});
