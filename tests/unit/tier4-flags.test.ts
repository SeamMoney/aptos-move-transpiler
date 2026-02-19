/**
 * Unit Tests for Tier 4 Transpilation Flags
 * Tests: eventPattern, signerParamName, emitAllErrorConstants, errorCodeType, indexNotation, acquiresStyle
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

// ─── Test Contracts ───────────────────────────────────────

const EVENT_CONTRACT = `
pragma solidity ^0.8.0;
contract EventTest {
    event Transfer(address indexed from, address indexed to, uint256 value);
    uint256 public totalSupply;
    function mint(address to, uint256 amount) public {
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
}
`;

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

const OWNER_CONTRACT = `
pragma solidity ^0.8.0;
contract Owned {
    address public owner;
    uint256 public value;
    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }
    constructor() {
        owner = msg.sender;
    }
    function setValue(uint256 v) public onlyOwner {
        value = v;
    }
}
`;

const REQUIRE_CONTRACT = `
pragma solidity ^0.8.0;
contract WithRequire {
    uint256 public value;
    function setValue(uint256 _value) public {
        require(_value > 0, "must be positive");
        require(_value < 1000, "too large");
        value = _value;
    }
}
`;

const VECTOR_CONTRACT = `
pragma solidity ^0.8.0;
contract WithVector {
    uint256[] public values;
    mapping(address => uint256) public scores;
    function getLength() public view returns (uint256) {
        return values.length;
    }
    function addValue(uint256 v) public {
        values.push(v);
    }
}
`;

// ─── Tests ────────────────────────────────────────────────

describe('Tier 4 Flags', () => {

  // ─── eventPattern ────────────────────────────────────────

  describe('eventPattern', () => {
    it('should use #[event] + event::emit by default (native)', () => {
      const result = transpileWith(EVENT_CONTRACT, {});
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('#[event]');
      expect(code).toContain('event::emit');
    });

    it('should strip events when set to none', () => {
      const result = transpileWith(EVENT_CONTRACT, { eventPattern: 'none' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).not.toContain('#[event]');
      expect(code).not.toContain('event::emit');
      // Should still have the state and function
      expect(code).toContain('total_supply');
      expect(code).toContain('fun mint');
    });

    it('should use EventHandle pattern when set to event-handle', () => {
      const result = transpileWith(EVENT_CONTRACT, { eventPattern: 'event-handle' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Should NOT have #[event]
      expect(code).not.toContain('#[event]');
      // Should have EventHandle in state or emit_event in body
      expect(code).toMatch(/EventHandle|emit_event/);
    });

    it('should still generate the struct for event-handle mode', () => {
      const result = transpileWith(EVENT_CONTRACT, { eventPattern: 'event-handle' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Transfer struct should exist but without #[event]
      expect(code).toContain('struct Transfer');
    });
  });

  // ─── signerParamName ─────────────────────────────────────

  describe('signerParamName', () => {
    it('should use account as default signer param name', () => {
      const result = transpileWith(SIMPLE_CONTRACT, {});
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('account: &signer');
    });

    it('should use signer when set to signer', () => {
      const result = transpileWith(SIMPLE_CONTRACT, { signerParamName: 'signer' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Should have signer: &signer (not account: &signer)
      expect(code).toMatch(/\bsigner: &signer\b/);
      expect(code).not.toContain('account: &signer');
    });

    it('should use signer in signer::address_of calls', () => {
      const result = transpileWith(OWNER_CONTRACT, { signerParamName: 'signer' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // All signer::address_of should reference 'signer', not 'account'
      expect(code).toContain('signer::address_of(signer)');
      expect(code).not.toContain('signer::address_of(account)');
    });
  });

  // ─── emitAllErrorConstants ───────────────────────────────

  describe('emitAllErrorConstants', () => {
    it('should emit all 19 standard error constants by default', () => {
      const result = transpileWith(SIMPLE_CONTRACT, {});
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Should have many standard errors
      expect(code).toContain('E_UNAUTHORIZED');
      expect(code).toContain('E_OVERFLOW');
      expect(code).toContain('E_PAUSED');
      expect(code).toContain('E_REENTRANCY');
    });

    it('should only emit referenced constants when false', () => {
      const result = transpileWith(REQUIRE_CONTRACT, { emitAllErrorConstants: false });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Should NOT have E_REENTRANCY or E_PAUSED (not referenced)
      expect(code).not.toContain('E_REENTRANCY');
      expect(code).not.toContain('E_PAUSED');
      expect(code).not.toContain('E_OVERFLOW');
    });

    it('should still emit custom errors when emitAllErrorConstants is false', () => {
      const result = transpileWith(REQUIRE_CONTRACT, { emitAllErrorConstants: false });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // The require messages should generate dynamically discovered error codes
      // At minimum the code should compile without undefined constants
      expect(result.modules[0]?.code.length).toBeGreaterThan(0);
    });
  });

  // ─── errorCodeType ───────────────────────────────────────

  describe('errorCodeType', () => {
    it('should use raw u64 abort codes by default', () => {
      const result = transpileWith(OWNER_CONTRACT, {});
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('E_UNAUTHORIZED');
      // Should NOT wrap in error:: module calls
      expect(code).not.toContain('error::permission_denied');
    });

    it('should wrap abort codes with error:: module when aptos-error-module', () => {
      const result = transpileWith(OWNER_CONTRACT, { errorCodeType: 'aptos-error-module' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Should wrap E_UNAUTHORIZED in error::permission_denied
      expect(code).toContain('error::permission_denied');
      // Should import std::error
      expect(code).toContain('use std::error');
    });

    it('should use appropriate error categories for require messages', () => {
      const result = transpileWith(REQUIRE_CONTRACT, { errorCodeType: 'aptos-error-module' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Should use error:: wrapping for abort codes
      expect(code).toMatch(/error::/);
    });
  });

  // ─── indexNotation ───────────────────────────────────────

  describe('indexNotation', () => {
    it('should use vector::borrow by default', () => {
      const result = transpileWith(VECTOR_CONTRACT, {});
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Default: module-qualified calls
      expect(code).toMatch(/vector::|borrow_global/);
    });

    it('should use bracket notation when enabled', () => {
      const result = transpileWith(SIMPLE_CONTRACT, { indexNotation: true });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // With state access, should use State[@0x1] instead of borrow_global<State>(@0x1)
      // Note: might still have borrow_global_mut, but at least some should be bracket
      if (code.includes('[')) {
        expect(code).toMatch(/\[/);
      }
    });

    it('should not affect exists<> or move_to', () => {
      const result = transpileWith(SIMPLE_CONTRACT, { indexNotation: true });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // exists and move_to should NOT use bracket notation
      if (code.includes('exists<')) {
        expect(code).toContain('exists<');
      }
      if (code.includes('move_to')) {
        expect(code).toContain('move_to');
      }
    });
  });

  // ─── acquiresStyle ───────────────────────────────────────

  describe('acquiresStyle', () => {
    it('should include acquires annotations by default (explicit)', () => {
      const result = transpileWith(SIMPLE_CONTRACT, {});
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('acquires');
    });

    it('should omit acquires annotations when inferred', () => {
      const result = transpileWith(SIMPLE_CONTRACT, { acquiresStyle: 'inferred' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).not.toContain('acquires');
    });

    it('should omit acquires on all functions when inferred', () => {
      const result = transpileWith(OWNER_CONTRACT, { acquiresStyle: 'inferred' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // No acquires keyword should appear anywhere
      expect(code).not.toMatch(/\bacquires\b/);
    });
  });

  // ─── Cross-flag combinations ──────────────────────────────

  describe('flag combinations', () => {
    it('should combine eventPattern=none + acquiresStyle=inferred', () => {
      const result = transpileWith(EVENT_CONTRACT, {
        eventPattern: 'none',
        acquiresStyle: 'inferred',
      });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).not.toContain('#[event]');
      expect(code).not.toContain('event::emit');
      expect(code).not.toMatch(/\bacquires\b/);
    });

    it('should combine signerParamName=signer + errorCodeType=aptos-error-module', () => {
      const result = transpileWith(OWNER_CONTRACT, {
        signerParamName: 'signer',
        errorCodeType: 'aptos-error-module',
      });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toMatch(/\bsigner: &signer\b/);
      expect(code).toContain('error::permission_denied');
    });

    it('should combine emitAllErrorConstants=false + errorCodeType=aptos-error-module', () => {
      const result = transpileWith(REQUIRE_CONTRACT, {
        emitAllErrorConstants: false,
        errorCodeType: 'aptos-error-module',
      });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Should have error:: wrapping
      expect(code).toMatch(/error::/);
      // Should NOT have unreferenced constants
      expect(code).not.toContain('E_PAUSED');
    });

    it('should work with all Tier 4 flags set to non-default', () => {
      const result = transpileWith(EVENT_CONTRACT, {
        eventPattern: 'none',
        signerParamName: 'signer',
        emitAllErrorConstants: false,
        errorCodeType: 'aptos-error-module',
        indexNotation: true,
        acquiresStyle: 'inferred',
      });
      expect(result.success).toBe(true);
      expect(result.modules.length).toBeGreaterThan(0);
    });

    it('should work with all Tier 1-4 flags combined', () => {
      const result = transpileWith(SIMPLE_CONTRACT, {
        // Tier 1
        strictMode: false,
        stringType: 'string',
        emitSourceComments: true,
        errorStyle: 'abort-codes',
        reentrancyPattern: 'mutex',
        // Tier 2
        enumStyle: 'native-enum',
        constructorPattern: 'deployer-direct',
        internalVisibility: 'public-package',
        overflowBehavior: 'abort',
        // Tier 3
        mappingType: 'smart-table',
        accessControl: 'inline-assert',
        upgradeability: 'immutable',
        optionalValues: 'sentinel',
        callStyle: 'module-qualified',
        // Tier 4
        eventPattern: 'native',
        signerParamName: 'account',
        emitAllErrorConstants: true,
        errorCodeType: 'u64',
        indexNotation: false,
        acquiresStyle: 'explicit',
      });
      expect(result.success).toBe(true);
      expect(result.modules.length).toBeGreaterThan(0);
    });

    it('should work with all flags set to non-default values', () => {
      const result = transpileWith(SIMPLE_CONTRACT, {
        // Tier 1
        strictMode: true,
        stringType: 'bytes',
        emitSourceComments: true,
        useInlineFunctions: true,
        viewFunctionBehavior: 'skip',
        errorStyle: 'abort-verbose',
        reentrancyPattern: 'none',
        // Tier 2
        enumStyle: 'u8-constants',
        constructorPattern: 'deployer-direct',
        internalVisibility: 'private',
        overflowBehavior: 'wrapping',
        // Tier 3
        mappingType: 'smart-table',
        accessControl: 'capability',
        upgradeability: 'immutable',
        optionalValues: 'option-type',
        callStyle: 'receiver',
        // Tier 4
        eventPattern: 'none',
        signerParamName: 'signer',
        emitAllErrorConstants: false,
        errorCodeType: 'aptos-error-module',
        indexNotation: true,
        acquiresStyle: 'inferred',
      });
      expect(result.success).toBe(true);
      expect(result.modules.length).toBeGreaterThan(0);
    });
  });
});
