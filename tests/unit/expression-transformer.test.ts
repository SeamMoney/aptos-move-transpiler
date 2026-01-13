/**
 * Unit Tests for Expression Transformer
 * Tests transformation of Solidity expressions to Move expressions
 */

import { describe, it, expect } from 'vitest';
import { parseSolidity } from '../../src/parser/solidity-parser.js';
import { contractToIR, irToMoveModule } from '../../src/transformer/contract-transformer.js';
import { generateMoveCode } from '../../src/codegen/move-generator.js';

// Helper to extract transpiled code for a simple contract
function transpileExpression(solidityCode: string): string {
  const source = `
    pragma solidity ^0.8.20;
    contract Test {
      ${solidityCode}
    }
  `;

  const parseResult = parseSolidity(source);
  if (!parseResult.success || !parseResult.ast) {
    throw new Error(`Parse failed: ${parseResult.errors.map(e => e.message).join(', ')}`);
  }

  const contracts = parseResult.ast.children.filter((n: any) => n.type === 'ContractDefinition');
  if (contracts.length === 0) {
    throw new Error('No contract found');
  }

  const ir = contractToIR(contracts[0]);
  const result = irToMoveModule(ir, '0x1');

  if (!result.success || !result.module) {
    throw new Error(`Transform failed: ${result.errors.map(e => e.message).join(', ')}`);
  }

  return generateMoveCode(result.module);
}

describe('Expression Transformer', () => {
  describe('Binary Operations', () => {
    it('should transform addition', () => {
      const code = transpileExpression(`
        function add(uint256 a, uint256 b) public pure returns (uint256) {
          return a + b;
        }
      `);
      expect(code).toContain('(a + b)');
    });

    it('should transform subtraction', () => {
      const code = transpileExpression(`
        function sub(uint256 a, uint256 b) public pure returns (uint256) {
          return a - b;
        }
      `);
      expect(code).toContain('(a - b)');
    });

    it('should transform multiplication', () => {
      const code = transpileExpression(`
        function mul(uint256 a, uint256 b) public pure returns (uint256) {
          return a * b;
        }
      `);
      expect(code).toContain('(a * b)');
    });

    it('should transform division', () => {
      const code = transpileExpression(`
        function div(uint256 a, uint256 b) public pure returns (uint256) {
          return a / b;
        }
      `);
      expect(code).toContain('(a / b)');
    });

    it('should transform modulo', () => {
      const code = transpileExpression(`
        function mod(uint256 a, uint256 b) public pure returns (uint256) {
          return a % b;
        }
      `);
      expect(code).toContain('(a % b)');
    });
  });

  describe('Comparison Operations', () => {
    it('should transform equality', () => {
      const code = transpileExpression(`
        function eq(uint256 a, uint256 b) public pure returns (bool) {
          return a == b;
        }
      `);
      expect(code).toContain('(a == b)');
    });

    it('should transform inequality', () => {
      const code = transpileExpression(`
        function neq(uint256 a, uint256 b) public pure returns (bool) {
          return a != b;
        }
      `);
      expect(code).toContain('(a != b)');
    });

    it('should transform less than', () => {
      const code = transpileExpression(`
        function lt(uint256 a, uint256 b) public pure returns (bool) {
          return a < b;
        }
      `);
      expect(code).toContain('(a < b)');
    });

    it('should transform greater than', () => {
      const code = transpileExpression(`
        function gt(uint256 a, uint256 b) public pure returns (bool) {
          return a > b;
        }
      `);
      expect(code).toContain('(a > b)');
    });

    it('should transform less than or equal', () => {
      const code = transpileExpression(`
        function lte(uint256 a, uint256 b) public pure returns (bool) {
          return a <= b;
        }
      `);
      expect(code).toContain('(a <= b)');
    });

    it('should transform greater than or equal', () => {
      const code = transpileExpression(`
        function gte(uint256 a, uint256 b) public pure returns (bool) {
          return a >= b;
        }
      `);
      expect(code).toContain('(a >= b)');
    });
  });

  describe('Logical Operations', () => {
    it('should transform logical AND', () => {
      const code = transpileExpression(`
        function and(bool a, bool b) public pure returns (bool) {
          return a && b;
        }
      `);
      expect(code).toContain('(a && b)');
    });

    it('should transform logical OR', () => {
      const code = transpileExpression(`
        function or(bool a, bool b) public pure returns (bool) {
          return a || b;
        }
      `);
      expect(code).toContain('(a || b)');
    });

    it('should transform logical NOT', () => {
      const code = transpileExpression(`
        function not(bool a) public pure returns (bool) {
          return !a;
        }
      `);
      expect(code).toContain('!a');
    });
  });

  describe('Bitwise Operations', () => {
    it('should transform bitwise AND', () => {
      const code = transpileExpression(`
        function bitAnd(uint256 a, uint256 b) public pure returns (uint256) {
          return a & b;
        }
      `);
      expect(code).toContain('(a & b)');
    });

    it('should transform bitwise OR', () => {
      const code = transpileExpression(`
        function bitOr(uint256 a, uint256 b) public pure returns (uint256) {
          return a | b;
        }
      `);
      expect(code).toContain('(a | b)');
    });

    it('should transform bitwise XOR', () => {
      const code = transpileExpression(`
        function bitXor(uint256 a, uint256 b) public pure returns (uint256) {
          return a ^ b;
        }
      `);
      expect(code).toContain('(a ^ b)');
    });

    it('should transform left shift', () => {
      const code = transpileExpression(`
        function shl(uint256 a, uint256 b) public pure returns (uint256) {
          return a << b;
        }
      `);
      expect(code).toContain('(a << b)');
    });

    it('should transform right shift', () => {
      const code = transpileExpression(`
        function shr(uint256 a, uint256 b) public pure returns (uint256) {
          return a >> b;
        }
      `);
      expect(code).toContain('(a >> b)');
    });
  });

  describe('Assignment Operations', () => {
    it('should transform simple assignment', () => {
      const code = transpileExpression(`
        uint256 public value;
        function setValue(uint256 v) public {
          value = v;
        }
      `);
      expect(code).toContain('state.value = v');
    });

    it('should transform compound addition assignment', () => {
      const code = transpileExpression(`
        uint256 public value;
        function addValue(uint256 v) public {
          value += v;
        }
      `);
      expect(code).toContain('+=');
    });

    it('should transform compound subtraction assignment', () => {
      const code = transpileExpression(`
        uint256 public value;
        function subValue(uint256 v) public {
          value -= v;
        }
      `);
      expect(code).toContain('-=');
    });
  });

  describe('EVM Context Access', () => {
    it('should transform msg.sender', () => {
      const code = transpileExpression(`
        function getSender() public view returns (address) {
          return msg.sender;
        }
      `);
      // msg.sender gets transformed to signer parameter
      expect(code).toMatch(/signer|address_of|account/);
    });

    it('should transform block.timestamp', () => {
      const code = transpileExpression(`
        function getTimestamp() public view returns (uint256) {
          return block.timestamp;
        }
      `);
      expect(code).toContain('timestamp::now');
    });

    it('should transform block.number', () => {
      const code = transpileExpression(`
        function getBlockNumber() public view returns (uint256) {
          return block.number;
        }
      `);
      expect(code).toContain('block::get_current_block_height');
    });
  });

  describe('Literals', () => {
    it('should transform integer literals with suffix', () => {
      const code = transpileExpression(`
        function getConstant() public pure returns (uint256) {
          return 100;
        }
      `);
      expect(code).toMatch(/100u?\d*/);
    });

    it('should transform boolean literals', () => {
      const code = transpileExpression(`
        function getTrue() public pure returns (bool) {
          return true;
        }
        function getFalse() public pure returns (bool) {
          return false;
        }
      `);
      expect(code).toContain('true');
      expect(code).toContain('false');
    });

    it('should transform address(0) to @0x0', () => {
      const code = transpileExpression(`
        function getZeroAddress() public pure returns (address) {
          return address(0);
        }
      `);
      expect(code).toContain('@0x0');
    });
  });

  describe('Conditional Expression', () => {
    it('should transform ternary operator', () => {
      const code = transpileExpression(`
        function max(uint256 a, uint256 b) public pure returns (uint256) {
          return a > b ? a : b;
        }
      `);
      expect(code).toContain('if');
    });
  });

  describe('Function Calls', () => {
    it('should transform internal function calls', () => {
      const code = transpileExpression(`
        function helper(uint256 x) internal pure returns (uint256) {
          return x * 2;
        }
        function caller(uint256 x) public pure returns (uint256) {
          return helper(x);
        }
      `);
      expect(code).toContain('helper(x)');
    });
  });
});

describe('Statement Transformer', () => {
  describe('Variable Declaration', () => {
    it('should transform local variable declaration', () => {
      const code = transpileExpression(`
        function test() public pure returns (uint256) {
          uint256 x = 10;
          return x;
        }
      `);
      expect(code).toContain('let x');
    });

    it('should transform multiple variable declaration', () => {
      const code = transpileExpression(`
        function test() public pure returns (uint256, uint256) {
          uint256 x = 10;
          uint256 y = 20;
          return (x, y);
        }
      `);
      expect(code).toContain('let x');
      expect(code).toContain('let y');
    });
  });

  describe('If Statement', () => {
    it('should transform if statement', () => {
      const code = transpileExpression(`
        function test(uint256 x) public pure returns (uint256) {
          if (x > 10) {
            return 1;
          }
          return 0;
        }
      `);
      expect(code).toContain('if');
      // The comparison may have type suffix
      expect(code).toMatch(/x > 10/);
    });

    it('should transform if-else statement', () => {
      const code = transpileExpression(`
        function test(uint256 x) public pure returns (uint256) {
          if (x > 10) {
            return 1;
          } else {
            return 0;
          }
        }
      `);
      expect(code).toContain('if');
      expect(code).toContain('else');
    });
  });

  describe('Loop Statements', () => {
    it('should transform while loop', () => {
      const code = transpileExpression(`
        function test() public pure returns (uint256) {
          uint256 i = 0;
          uint256 sum = 0;
          while (i < 10) {
            sum += i;
            i++;
          }
          return sum;
        }
      `);
      expect(code).toContain('while');
    });

    it('should transform for loop', () => {
      const code = transpileExpression(`
        function test() public pure returns (uint256) {
          uint256 sum = 0;
          for (uint256 i = 0; i < 10; i++) {
            sum += i;
          }
          return sum;
        }
      `);
      // Should be converted to while or Move 2.0 for
      expect(code).toMatch(/while|for/);
    });
  });

  describe('Require Statement', () => {
    it('should transform require to assert', () => {
      const code = transpileExpression(`
        function test(uint256 x) public pure {
          require(x > 0, "Value must be positive");
        }
      `);
      expect(code).toContain('assert!');
    });
  });

  describe('Return Statement', () => {
    it('should transform return statement', () => {
      const code = transpileExpression(`
        function test() public pure returns (uint256) {
          return 42;
        }
      `);
      expect(code).toMatch(/42|return/);
    });

    it('should handle multiple return values', () => {
      const code = transpileExpression(`
        function test() public pure returns (uint256, bool) {
          return (42, true);
        }
      `);
      expect(code).toContain('42');
      expect(code).toContain('true');
    });
  });
});
