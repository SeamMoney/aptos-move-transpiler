import { describe, it, expect } from 'vitest';
import { generateSpecs, renderSpecs } from '../../src/codegen/spec-generator.js';
import { transpile } from '../../src/transpiler.js';
import type { MoveModule } from '../../src/types/move-ast.js';

describe('MSL Spec Generator', () => {
  describe('generateSpecs', () => {
    it('should generate module-level spec with partial pragma', () => {
      const result = transpile(`
        contract Test {
          uint256 public value;
        }
      `);

      expect(result.success).toBe(true);
      const ast = result.modules[0].ast;
      const specs = generateSpecs(ast);

      // Should have at least the module-level spec
      const moduleSpec = specs.find(s => s.targetKind === 'module');
      expect(moduleSpec).toBeDefined();
      expect(moduleSpec!.pragmas).toContainEqual({
        name: 'aborts_if_is_partial',
        value: 'true',
      });
    });

    it('should extract aborts_if from require() statements', () => {
      const result = transpile(`
        contract Token {
          mapping(address => uint256) public balances;

          function transfer(address to, uint256 amount) public {
            require(balances[msg.sender] >= amount, "Insufficient balance");
            balances[msg.sender] -= amount;
            balances[to] += amount;
          }
        }
      `);

      expect(result.success).toBe(true);
      const ast = result.modules[0].ast;
      const specs = generateSpecs(ast);

      const transferSpec = specs.find(s => s.target === 'transfer');
      expect(transferSpec).toBeDefined();
      expect(transferSpec!.abortsIf!.length).toBeGreaterThan(0);

      // Should have at least one aborts_if with an error code
      const hasAbortWithCode = transferSpec!.abortsIf!.some(a => a.abortCode);
      expect(hasAbortWithCode).toBe(true);
    });

    it('should extract modifies from mutable state access', () => {
      const result = transpile(`
        contract Counter {
          uint256 public count;

          function increment() public {
            count += 1;
          }
        }
      `);

      expect(result.success).toBe(true);
      const ast = result.modules[0].ast;
      const specs = generateSpecs(ast);

      const incrementSpec = specs.find(s => s.target === 'increment');
      expect(incrementSpec).toBeDefined();
      expect(incrementSpec!.modifies!.length).toBeGreaterThan(0);
      // Should reference global<State>
      expect(incrementSpec!.modifies![0]).toContain('global<');
    });

    it('should extract exists checks from acquires', () => {
      const result = transpile(`
        contract Storage {
          uint256 public data;

          function getData() public view returns (uint256) {
            return data;
          }
        }
      `);

      expect(result.success).toBe(true);
      const ast = result.modules[0].ast;
      const specs = generateSpecs(ast);

      const getDataSpec = specs.find(s => s.target === 'get_data');
      if (getDataSpec) {
        // Should have aborts_if !exists<> if function acquires resources
        const hasExistsCheck = getDataSpec.abortsIf?.some(a =>
          a.expression.includes('!exists<')
        );
        if (getDataSpec.abortsIf && getDataSpec.abortsIf.length > 0) {
          expect(hasExistsCheck).toBe(true);
        }
      }
    });

    it('should generate specs for multiple require() conditions', () => {
      const result = transpile(`
        contract Access {
          address public owner;
          bool public paused;

          function doAction() public {
            require(msg.sender == owner, "Not owner");
            require(!paused, "Contract paused");
          }
        }
      `);

      expect(result.success).toBe(true);
      const ast = result.modules[0].ast;
      const specs = generateSpecs(ast);

      const actionSpec = specs.find(s => s.target === 'do_action');
      expect(actionSpec).toBeDefined();
      // Should have at least 2 abort conditions (from 2 requires)
      // Plus any exists checks from acquires
      expect(actionSpec!.abortsIf!.length).toBeGreaterThanOrEqual(2);
    });

    it('should not generate specs for view functions without assert', () => {
      const result = transpile(`
        contract Pure {
          function add(uint256 a, uint256 b) public pure returns (uint256) {
            return a + b;
          }
        }
      `);

      expect(result.success).toBe(true);
      const ast = result.modules[0].ast;
      const specs = generateSpecs(ast);

      // add() should not have a meaningful spec (no assert, no state)
      const addSpec = specs.find(s => s.target === 'add');
      // Either no spec or empty spec
      if (addSpec) {
        const totalConditions =
          (addSpec.abortsIf?.length || 0) +
          (addSpec.modifies?.length || 0) +
          (addSpec.ensures?.length || 0);
        expect(totalConditions).toBe(0);
      }
    });
  });

  describe('renderSpecs', () => {
    it('should render spec blocks to valid Move syntax', () => {
      const specs = [
        {
          target: 'module',
          targetKind: 'module' as const,
          pragmas: [{ name: 'aborts_if_is_partial', value: 'true' }],
        },
        {
          target: 'transfer',
          targetKind: 'function' as const,
          abortsIf: [
            {
              expression: 'balance < amount',
              abortCode: 'E_INSUFFICIENT_BALANCE',
              comment: 'from require()/assert!',
            },
          ],
          modifies: ['global<TokenState>(@0x1)'],
        },
      ];

      const lines = renderSpecs(specs);
      const output = lines.join('\n');

      expect(output).toContain('spec module {');
      expect(output).toContain('pragma aborts_if_is_partial = true;');
      expect(output).toContain('spec transfer {');
      expect(output).toContain('aborts_if balance < amount with E_INSUFFICIENT_BALANCE;');
      expect(output).toContain('modifies global<TokenState>(@0x1);');
    });

    it('should render invariants for structs', () => {
      const specs = [
        {
          target: 'MyStruct',
          targetKind: 'struct' as const,
          invariants: [
            { expression: 'value <= 255', comment: 'uint8 range' },
          ],
        },
      ];

      const lines = renderSpecs(specs);
      const output = lines.join('\n');

      expect(output).toContain('spec MyStruct {');
      expect(output).toContain('invariant value <= 255;');
    });
  });

  describe('transpile with generateSpecs option', () => {
    it('should include spec blocks in generated code', () => {
      const result = transpile(`
        contract Guarded {
          address public owner;

          function setOwner(address newOwner) public {
            require(msg.sender == owner, "Only owner");
            owner = newOwner;
          }
        }
      `, { generateSpecs: true });

      expect(result.success).toBe(true);
      const code = result.modules[0].code;

      // Should contain spec blocks
      expect(code).toContain('spec module {');
      expect(code).toContain('pragma aborts_if_is_partial');
      expect(code).toContain('spec set_owner {');
      expect(code).toContain('aborts_if');
    });

    it('should not include specs when option is false', () => {
      const result = transpile(`
        contract Simple {
          uint256 public x;
          function setX(uint256 _x) public { x = _x; }
        }
      `, { generateSpecs: false });

      expect(result.success).toBe(true);
      const code = result.modules[0].code;

      expect(code).not.toContain('spec module');
      expect(code).not.toContain('aborts_if');
    });

    it('should store specs on the module AST', () => {
      const result = transpile(`
        contract WithSpecs {
          uint256 public value;
          function setValue(uint256 v) public {
            require(v > 0, "Must be positive");
            value = v;
          }
        }
      `, { generateSpecs: true });

      expect(result.success).toBe(true);
      const ast = result.modules[0].ast;

      expect(ast.specs).toBeDefined();
      expect(ast.specs!.length).toBeGreaterThan(0);

      const moduleSpec = ast.specs!.find(s => s.targetKind === 'module');
      expect(moduleSpec).toBeDefined();
    });

    it('should work with modifiers (onlyOwner pattern)', () => {
      const result = transpile(`
        contract Ownable {
          address public owner;

          modifier onlyOwner() {
            require(msg.sender == owner, "Not the owner");
            _;
          }

          function doProtected() public onlyOwner {
            // action
          }
        }
      `, { generateSpecs: true });

      expect(result.success).toBe(true);
      const code = result.modules[0].code;

      // The modifier's require() should produce an aborts_if
      expect(code).toContain('aborts_if');
    });

    it('should generate specs for contract with multiple functions', () => {
      const result = transpile(`
        contract Vault {
          mapping(address => uint256) public deposits;
          uint256 public totalDeposits;

          function deposit() public payable {
            deposits[msg.sender] += msg.value;
            totalDeposits += msg.value;
          }

          function withdraw(uint256 amount) public {
            require(deposits[msg.sender] >= amount, "Insufficient balance");
            deposits[msg.sender] -= amount;
            totalDeposits -= amount;
          }
        }
      `, { generateSpecs: true });

      expect(result.success).toBe(true);
      const code = result.modules[0].code;

      // Should have specs for both functions
      expect(code).toContain('spec deposit {');
      expect(code).toContain('spec withdraw {');
      // Withdraw should have the require condition
      expect(code).toContain('aborts_if');
    });
  });
});
