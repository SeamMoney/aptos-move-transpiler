/**
 * Unit Tests for Tier 3 Transpilation Flags
 * Tests: mappingType, accessControl, upgradeability, optionalValues, callStyle
 *
 * Complementary to:
 * - tests/unit/optional-values.test.ts (detailed optionalValues coverage)
 * - tests/unit/call-style-smoke.test.ts (detailed callStyle coverage)
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

const MAPPING_CONTRACT = `
pragma solidity ^0.8.0;
contract MappingTest {
    mapping(address => uint256) public balances;
    function deposit() public payable {
        balances[msg.sender] += msg.value;
    }
    function getBalance(address user) public view returns (uint256) {
        return balances[user];
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

const ADDRESS_CONTRACT = `
pragma solidity ^0.8.0;
contract WithAddress {
    address public admin;
    function isAdminSet() public view returns (bool) {
        return admin != address(0);
    }
    function clearAdmin() public {
        admin = address(0);
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

const NESTED_MAPPING_CONTRACT = `
pragma solidity ^0.8.0;
contract NestedMapping {
    mapping(address => mapping(address => uint256)) public allowances;
    function approve(address spender, uint256 amount) public {
        allowances[msg.sender][spender] = amount;
    }
    function allowance(address owner, address spender) public view returns (uint256) {
        return allowances[owner][spender];
    }
}
`;

// ─── Tests ────────────────────────────────────────────────

describe('Tier 3 Flags', () => {

  // ─── mappingType ───────────────────────────────────────

  describe('mappingType', () => {
    it('should use Table by default', () => {
      const result = transpileWith(MAPPING_CONTRACT, {});
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('use aptos_std::table');
      expect(code).toContain('Table<');
      expect(code).not.toContain('SmartTable');
      expect(code).not.toContain('smart_table');
    });

    it('should use SmartTable when set to smart-table', () => {
      const result = transpileWith(MAPPING_CONTRACT, { mappingType: 'smart-table' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('use aptos_std::smart_table');
      expect(code).toContain('SmartTable<');
      expect(code).not.toContain('use aptos_std::table');
    });

    it('should use smart_table:: function prefix for operations', () => {
      const result = transpileWith(MAPPING_CONTRACT, { mappingType: 'smart-table' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toMatch(/smart_table::/);
    });

    it('should use table:: function prefix by default', () => {
      const result = transpileWith(MAPPING_CONTRACT, { mappingType: 'table' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toMatch(/table::/);
    });

    it('should initialize mappings with smart_table::new() in smart-table mode', () => {
      const result = transpileWith(MAPPING_CONTRACT, { mappingType: 'smart-table' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('smart_table::new()');
    });

    it('should handle nested mappings with smart-table', () => {
      const result = transpileWith(NESTED_MAPPING_CONTRACT, { mappingType: 'smart-table' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('SmartTable<');
      expect(code).toMatch(/smart_table::/);
    });
  });

  // ─── accessControl ────────────────────────────────────

  describe('accessControl', () => {
    it('should use inline-assert by default (check state.owner)', () => {
      const result = transpileWith(OWNER_CONTRACT, { accessControl: 'inline-assert' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Default mode checks owner via state.owner comparison
      expect(code).not.toContain('OwnerCapability');
    });

    it('should use capability pattern when set', () => {
      const result = transpileWith(OWNER_CONTRACT, { accessControl: 'capability' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Should define OwnerCapability struct
      expect(code).toContain('OwnerCapability');
      expect(code).toContain('has key');
      // Should use exists<OwnerCapability> for access check
      expect(code).toContain('exists<OwnerCapability>');
    });

    it('should add move_to for capability in init_module', () => {
      const result = transpileWith(OWNER_CONTRACT, { accessControl: 'capability' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // init should grant the deployer the capability
      expect(code).toContain('move_to');
      expect(code).toContain('OwnerCapability');
    });

    it('should not create capability structs when inline-assert', () => {
      const result = transpileWith(OWNER_CONTRACT, { accessControl: 'inline-assert' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).not.toContain('OwnerCapability');
    });

    it('should not create capability for contracts without onlyOwner', () => {
      const result = transpileWith(SIMPLE_CONTRACT, { accessControl: 'capability' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Simple contract has no onlyOwner modifier
      expect(code).not.toContain('OwnerCapability');
    });
  });

  // ─── upgradeability ───────────────────────────────────

  describe('upgradeability', () => {
    it('should not generate upgrade_module when immutable (default)', () => {
      const result = transpileWith(SIMPLE_CONTRACT, { upgradeability: 'immutable' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).not.toContain('upgrade_module');
    });

    it('should generate upgrade_module when resource-account + resource-account constructor', () => {
      const result = transpileWith(SIMPLE_CONTRACT, {
        upgradeability: 'resource-account',
        constructorPattern: 'resource-account',
      });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('upgrade_module');
      expect(code).toContain('publish_package_txn');
      expect(code).toContain('create_signer_with_capability');
    });

    it('should not generate upgrade_module with deployer-direct constructor', () => {
      // upgrade_module requires signer_cap which doesn't exist in deployer-direct
      const result = transpileWith(SIMPLE_CONTRACT, {
        upgradeability: 'resource-account',
        constructorPattern: 'deployer-direct',
      });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).not.toContain('upgrade_module');
    });

    it('should include authorization check in upgrade_module', () => {
      const result = transpileWith(SIMPLE_CONTRACT, {
        upgradeability: 'resource-account',
        constructorPattern: 'resource-account',
      });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // Should assert caller is authorized
      expect(code).toContain('signer::address_of');
      expect(code).toContain('E_UNAUTHORIZED');
    });

    it('should include code module import when upgradeability is enabled', () => {
      const result = transpileWith(SIMPLE_CONTRACT, {
        upgradeability: 'resource-account',
        constructorPattern: 'resource-account',
      });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('use aptos_framework::code');
    });
  });

  // ─── optionalValues ───────────────────────────────────

  describe('optionalValues', () => {
    it('should use sentinel (@0x0) by default', () => {
      const result = transpileWith(ADDRESS_CONTRACT, {});
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('@0x0');
      expect(code).not.toContain('option::is_none');
    });

    it('should use option type when set to option-type', () => {
      const result = transpileWith(ADDRESS_CONTRACT, { optionalValues: 'option-type' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('option::is_some');
      expect(code).toContain('option::none<address>()');
    });

    it('should add std::option import for option-type mode', () => {
      const result = transpileWith(ADDRESS_CONTRACT, { optionalValues: 'option-type' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('use std::option');
    });
  });

  // ─── callStyle ────────────────────────────────────────

  describe('callStyle', () => {
    it('should use module-qualified syntax by default', () => {
      const result = transpileWith(VECTOR_CONTRACT, {});
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toMatch(/vector::/);
    });

    it('should use receiver syntax when set', () => {
      const result = transpileWith(VECTOR_CONTRACT, { callStyle: 'receiver' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toMatch(/\.length\(/);
      expect(code).toMatch(/\.push_back\(/);
    });

    it('receiver should not convert non-eligible functions', () => {
      const result = transpileWith(VECTOR_CONTRACT, { callStyle: 'receiver' });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // borrow_global, move_to should stay as-is
      expect(code).toMatch(/move_to\(/);
      expect(code).toMatch(/borrow_global/);
    });
  });

  // ─── Cross-flag combinations ──────────────────────────

  describe('flag combinations', () => {
    it('should combine smart-table + receiver style', () => {
      const result = transpileWith(VECTOR_CONTRACT, {
        mappingType: 'smart-table',
        callStyle: 'receiver',
      });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      // SmartTable in struct
      expect(code).toContain('SmartTable<');
      // Receiver syntax for vector ops
      expect(code).toMatch(/\.length\(/);
    });

    it('should combine capability + option-type', () => {
      // Capability mode replaces owner comparison with exists<>, so the address
      // comparison is gone. option-type has no effect here but should not break.
      const result = transpileWith(OWNER_CONTRACT, {
        accessControl: 'capability',
        optionalValues: 'option-type',
      });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('OwnerCapability');
      expect(code).toContain('exists<OwnerCapability>');
    });

    it('should combine upgradeability + smart-table + capability', () => {
      const result = transpileWith(OWNER_CONTRACT, {
        upgradeability: 'resource-account',
        constructorPattern: 'resource-account',
        mappingType: 'smart-table',
        accessControl: 'capability',
      });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('OwnerCapability');
      expect(code).toContain('upgrade_module');
    });

    it('should work with all Tier 3 flags set to non-default', () => {
      const result = transpileWith(VECTOR_CONTRACT, {
        mappingType: 'smart-table',
        accessControl: 'capability',
        upgradeability: 'resource-account',
        constructorPattern: 'resource-account',
        optionalValues: 'option-type',
        callStyle: 'receiver',
      });
      expect(result.success).toBe(true);
      const code = result.modules[0]?.code || '';
      expect(code).toContain('SmartTable<');
      expect(code).toMatch(/\.length\(/);
    });

    it('should work with Tier 1 + Tier 2 + Tier 3 flags combined', () => {
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
      });
      expect(result.success).toBe(true);
      expect(result.modules.length).toBeGreaterThan(0);
    });
  });
});
