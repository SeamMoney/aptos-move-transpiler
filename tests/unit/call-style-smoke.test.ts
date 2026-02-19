/**
 * Smoke test for callStyle transpilation flag
 */

import { describe, it, expect } from 'vitest';
import { transpile } from '../../src/transpiler.js';

function transpileWith(source: string, flags: Record<string, any>) {
  return transpile(source, {
    moduleAddress: '0x1',
    generateToml: false,
    ...flags,
  });
}

const VECTOR_CONTRACT = `
pragma solidity ^0.8.0;
contract VectorTest {
    uint256[] public values;
    mapping(address => uint256) public balances;

    function getLength() public view returns (uint256) {
        return values.length;
    }

    function addValue(uint256 v) public {
        values.push(v);
    }
}
`;

const TABLE_CONTRACT = `
pragma solidity ^0.8.0;
contract TableTest {
    mapping(address => uint256) public scores;
    function getScore(address user) public view returns (uint256) {
        return scores[user];
    }
    function setScore(address user, uint256 score) public {
        scores[user] = score;
    }
}
`;

describe('callStyle flag', () => {
  it('module-qualified (default) should use module::function syntax', () => {
    const result = transpileWith(VECTOR_CONTRACT, {});
    expect(result.success).toBe(true);
    const code = result.modules[0].code;
    // Should contain vector::length or vector::push_back style calls
    expect(code).toMatch(/vector::/);
  });

  it('receiver style should convert vector::length to .length()', () => {
    const result = transpileWith(VECTOR_CONTRACT, { callStyle: 'receiver' });
    expect(result.success).toBe(true);
    const code = result.modules[0].code;
    // Should use receiver syntax for vector operations
    expect(code).toMatch(/\.length\(/);
  });

  it('receiver style should NOT convert non-eligible functions', () => {
    const result = transpileWith(VECTOR_CONTRACT, { callStyle: 'receiver' });
    expect(result.success).toBe(true);
    const code = result.modules[0].code;
    // move_to, borrow_global, assert! etc. should remain as module-qualified
    expect(code).toMatch(/move_to\(/);
    expect(code).toMatch(/borrow_global</);
    // account::create_resource_account is not in the eligible set
    expect(code).toMatch(/account::create_resource_account/);
  });

  it('module-qualified should NOT use receiver syntax for vector ops', () => {
    const result = transpileWith(VECTOR_CONTRACT, { callStyle: 'module-qualified' });
    expect(result.success).toBe(true);
    const code = result.modules[0].code;
    // Should use vector::length, not .length()
    expect(code).toMatch(/vector::length/);
    // Should NOT contain .length( without a module prefix
    expect(code).not.toMatch(/\.length\(/);
  });

  it('receiver style should unwrap borrow from first arg', () => {
    // When vector::push_back(&mut v, x) is converted, the &mut is stripped:
    // v.push_back(x) -- Move infers the borrow for receiver calls
    const result = transpileWith(VECTOR_CONTRACT, { callStyle: 'receiver' });
    expect(result.success).toBe(true);
    const code = result.modules[0].code;
    // push_back should use receiver syntax without & prefix
    expect(code).toMatch(/\.push_back\(/);
    // Should NOT contain vector::push_back
    expect(code).not.toMatch(/vector::push_back/);
  });

  it('receiver style should handle table operations', () => {
    const result = transpileWith(TABLE_CONTRACT, { callStyle: 'receiver' });
    expect(result.success).toBe(true);
    const code = result.modules[0].code;
    // Table operations should use receiver syntax
    // table::borrow -> .borrow(), table::upsert -> .upsert(), etc.
    // Should NOT have table::borrow or table::upsert as module-qualified calls
    expect(code).not.toMatch(/table::borrow\b/);
  });

  it('default callStyle should be module-qualified when not specified', () => {
    const result = transpileWith(VECTOR_CONTRACT, {});
    expect(result.success).toBe(true);
    const code = result.modules[0].code;
    // Default should be module-qualified
    expect(code).toMatch(/vector::/);
    expect(code).not.toMatch(/\.length\(/);
  });
});
