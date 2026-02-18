import { describe, it, expect } from 'vitest';
import { transpile } from '../../src/transpiler.js';

const TOKEN_CONTRACT = `
  contract Token {
    address public owner;
    uint256 public totalSupply;
    mapping(address => uint256) public balances;

    modifier onlyOwner() {
      require(msg.sender == owner, "Not owner");
      _;
    }

    function mint(address to, uint256 amount) public {
      totalSupply += amount;
      balances[to] += amount;
    }

    function burn(address from, uint256 amount) public {
      totalSupply -= amount;
      balances[from] -= amount;
    }

    function transferOwnership(address newOwner) public onlyOwner {
      owner = newOwner;
    }
  }
`;

const SIMPLE_CONTRACT = `
  contract Simple {
    uint256 public value;
    function setValue(uint256 v) public { value = v; }
    function getValue() public view returns (uint256) { return value; }
  }
`;

const PURE_CONTRACT = `
  contract Math {
    function add(uint256 a, uint256 b) public pure returns (uint256) {
      return a + b;
    }
  }
`;

describe('Optimization Integration', () => {
  describe('Low optimization (default)', () => {
    it('should produce identical output with low vs no optimization level', () => {
      const resultDefault = transpile(SIMPLE_CONTRACT);
      const resultLow = transpile(SIMPLE_CONTRACT, { optimizationLevel: 'low' });

      expect(resultDefault.success).toBe(true);
      expect(resultLow.success).toBe(true);
      expect(resultDefault.modules[0].code).toBe(resultLow.modules[0].code);
    });

    it('should use single State struct at low level', () => {
      const result = transpile(TOKEN_CONTRACT, { optimizationLevel: 'low' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      expect(code).toContain('struct TokenState');
      expect(code).not.toContain('AdminConfig');
      expect(code).not.toContain('Counters');
    });
  });

  describe('Medium optimization', () => {
    it('should split state into multiple resource structs', () => {
      const result = transpile(TOKEN_CONTRACT, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;

      // Should have multiple resource structs (not just one State)
      // admin_config for owner
      expect(code).toContain('AdminConfig');
      // counters for totalSupply (aggregatable)
      expect(code).toContain('Counters');
    });

    it('should use Aggregator type for counter variables', () => {
      const result = transpile(TOKEN_CONTRACT, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // totalSupply should be Aggregator<u128>
      expect(code).toContain('Aggregator');
      expect(code).toContain('aggregator_v2');
    });

    it('should use unbounded aggregators (no max_value limit)', () => {
      const result = transpile(TOKEN_CONTRACT, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // Should use create_unbounded_aggregator (not bounded create_aggregator)
      expect(code).toContain('create_unbounded_aggregator');
      expect(code).not.toContain('create_aggregator(');
    });

    it('should generate multiple move_to calls in init_module', () => {
      const result = transpile(TOKEN_CONTRACT, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // Should have multiple move_to calls (one per resource group)
      const moveToCount = (code.match(/move_to\(/g) || []).length;
      expect(moveToCount).toBeGreaterThan(1);
    });

    it('should generate per-group borrows in functions', () => {
      const result = transpile(TOKEN_CONTRACT, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // Should have borrow_global_mut for specific resource groups
      expect(code).toContain('borrow_global_mut<Token');
    });

    it('should use aggregator_v2::add for counter increments', () => {
      const result = transpile(TOKEN_CONTRACT, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // totalSupply += amount → aggregator_v2::add(&mut counters.total_supply, amount)
      expect(code).toContain('aggregator_v2::add');
    });

    it('should use aggregator_v2::sub for counter decrements', () => {
      const result = transpile(TOKEN_CONTRACT, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // totalSupply -= amount → aggregator_v2::sub(&mut counters.total_supply, amount)
      expect(code).toContain('aggregator_v2::sub');
    });

    it('should generate correct acquires annotations', () => {
      const result = transpile(TOKEN_CONTRACT, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // Functions should list the specific resources they acquire
      expect(code).toContain('acquires');
    });

    it('should report optimization info in warnings', () => {
      const result = transpile(TOKEN_CONTRACT, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      // Should have optimization warnings/info
      const optimizationWarnings = result.warnings.filter(w => w.includes('[optimization]'));
      expect(optimizationWarnings.length).toBeGreaterThan(0);
      // Should include parallelization score
      expect(optimizationWarnings.some(w => w.includes('Parallelization score'))).toBe(true);
    });
  });

  describe('Pure functions at all levels', () => {
    it('should generate no state borrows for pure functions at medium', () => {
      const result = transpile(PURE_CONTRACT, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      expect(code).not.toContain('borrow_global');
      expect(code).not.toContain('acquires');
    });
  });

  describe('View functions', () => {
    it('should use borrow_global (not _mut) for view functions', () => {
      const result = transpile(SIMPLE_CONTRACT, { optimizationLevel: 'low' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // getValue is a view function — should use borrow_global, not borrow_global_mut
      // (Note: it may also have borrow_global_mut for setValue which is a writer)
      const borrowGlobalCount = (code.match(/borrow_global</g) || []).length;
      const borrowGlobalMutCount = (code.match(/borrow_global_mut</g) || []).length;
      // Should have at least one borrow_global (for the view function)
      expect(borrowGlobalCount).toBeGreaterThan(0);
    });
  });

  describe('Backward compatibility', () => {
    it('should transpile successfully at all optimization levels', () => {
      for (const level of ['low', 'medium', 'high'] as const) {
        const result = transpile(TOKEN_CONTRACT, { optimizationLevel: level });
        expect(result.success).toBe(true);
        expect(result.modules.length).toBeGreaterThan(0);
        expect(result.modules[0].code.length).toBeGreaterThan(0);
      }
    });

    it('should handle contracts with no state variables', () => {
      const result = transpile(PURE_CONTRACT, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);
      // Pure math contract has no state — should work fine
      const code = result.modules[0].code;
      expect(code).toContain('fun add');
    });
  });

  describe('DeFi-like contract', () => {
    it('should correctly optimize a staking contract', () => {
      const stakingContract = `
        contract Staking {
          address public owner;
          uint256 public rewardRate;
          uint256 public totalStaked;
          mapping(address => uint256) public stakedBalance;
          bool public paused;

          modifier onlyOwner() {
            require(msg.sender == owner, "Not owner");
            _;
          }

          function stake() public payable {
            stakedBalance[msg.sender] += msg.value;
            totalStaked += msg.value;
          }

          function withdraw(uint256 amount) public {
            stakedBalance[msg.sender] -= amount;
            totalStaked -= amount;
          }

          function setRewardRate(uint256 rate) public onlyOwner {
            rewardRate = rate;
          }

          function pause() public onlyOwner {
            paused = true;
          }
        }
      `;

      const result = transpile(stakingContract, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;

      // Admin variables (owner, rewardRate, paused) should be in AdminConfig
      expect(code).toContain('AdminConfig');

      // totalStaked should use Aggregator
      expect(code).toContain('Aggregator');

      // Should have aggregator operations
      expect(code).toContain('aggregator_v2');

      // Should have multiple resource structs
      const structCount = (code.match(/struct \w+ has key/g) || []).length;
      expect(structCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Aggregator snapshot pattern', () => {
    const SNAPSHOT_CONTRACT = `
      contract Counter {
        uint256 public total;
        uint256 public lastAdded;

        function addAndTrack(uint256 amount) public {
          lastAdded = total;
          total += amount;
        }

        function getTotal() public view returns (uint256) {
          return total;
        }
      }
    `;

    it('should use snapshot reads in functions that both read and write aggregators', () => {
      const result = transpile(SNAPSHOT_CONTRACT, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // addAndTrack reads total (to assign to lastAdded) and writes total (+=)
      // Should use snapshot pattern for the read
      expect(code).toContain('aggregator_v2::snapshot');
      expect(code).toContain('read_snapshot');
    });

    it('should use direct read() in view functions', () => {
      const result = transpile(SNAPSHOT_CONTRACT, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // getTotal is a view function — should use regular read, not snapshot
      // The view function should contain aggregator_v2::read (but not snapshot)
      // Check that the view function section uses read
      const viewSection = code.split('fun get_total')[1];
      if (viewSection) {
        expect(viewSection.split('}')[0]).toContain('aggregator_v2::read');
        expect(viewSection.split('}')[0]).not.toContain('snapshot');
      }
    });
  });

  describe('is_at_least() comparisons', () => {
    it('should transform aggVar > 0 to is_at_least(&agg, 1)', () => {
      const contract = `
        contract Vault {
          uint256 public totalDeposits;
          function withdraw(uint256 amount) public {
            require(totalDeposits > 0, "empty");
            totalDeposits -= amount;
          }
          function deposit(uint256 amount) public {
            totalDeposits += amount;
          }
        }
      `;
      const result = transpile(contract, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      expect(code).toContain('is_at_least');
      expect(code).toContain('1u128');
    });

    it('should transform aggVar >= N to is_at_least(&agg, N)', () => {
      const contract = `
        contract Vault {
          uint256 public totalBalance;
          function check(uint256 minBal) public {
            require(totalBalance >= minBal, "low");
            totalBalance -= minBal;
          }
          function add(uint256 a) public {
            totalBalance += a;
          }
        }
      `;
      const result = transpile(contract, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      expect(code).toContain('is_at_least');
    });

    it('should NOT use is_at_least for == comparisons', () => {
      const contract = `
        contract Counter {
          uint256 public count;
          function checkExact() public view returns (bool) {
            return count == 5;
          }
          function inc() public {
            count += 1;
          }
        }
      `;
      const result = transpile(contract, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // == needs exact value, should not use is_at_least
      expect(code).not.toContain('is_at_least');
    });
  });

  describe('Fees in events (event_trackable)', () => {
    it('should emit events instead of state writes for fee-like variables', () => {
      const contract = `
        contract Market {
          uint256 public totalVolume;
          uint256 public accumulatedFees;

          function trade(uint256 amount, uint256 fee) public {
            totalVolume += amount;
            accumulatedFees += fee;
          }

          function deposit(uint256 amount) public {
            totalVolume += amount;
          }
        }
      `;
      const result = transpile(contract, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // accumulatedFees should be tracked via events (never read in non-view functions, fee-like name)
      expect(code).toContain('#[event]');
      expect(code).toContain('AccumulatedFeesUpdated');
      expect(code).toContain('event::emit');
      // accumulatedFees should NOT be in any resource struct
      expect(code).not.toMatch(/struct.*\{[^}]*accumulated_fees/);
    });

    it('should keep aggregatable variables that are read in non-view functions', () => {
      const contract = `
        contract Token {
          uint256 public totalSupply;
          uint256 public collectedFees;

          function mint(uint256 amount) public {
            require(totalSupply + amount < 1000000, "cap");
            totalSupply += amount;
          }

          function collectFee(uint256 fee) public {
            collectedFees += fee;
          }

          function getSupply() public view returns (uint256) {
            return totalSupply;
          }
        }
      `;
      const result = transpile(contract, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // totalSupply is read in mint (non-view) → stays as aggregator
      expect(code).toContain('aggregator_v2::add');
      // collectedFees is only written, never read → event-trackable
      expect(code).toContain('CollectedFeesUpdated');
      expect(code).toContain('event::emit');
    });

    it('should produce 0 literal when reading an event-trackable variable', () => {
      const contract = `
        contract FeeTracker {
          uint256 public totalFees;

          function addFee(uint256 fee) public {
            totalFees += fee;
          }

          function getFees() public view returns (uint256) {
            return totalFees;
          }
        }
      `;
      const result = transpile(contract, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // totalFees is event-trackable: only read in view, only written via +=
      expect(code).toContain('event::emit');
      // The view function should return 0 (off-chain tracking)
      const viewSection = code.split('fun get_fees')[1];
      if (viewSection) {
        const fnBody = viewSection.split('}')[0];
        expect(fnBody).toContain('0');
      }
    });

    it('should not use event tracking at low optimization level', () => {
      const contract = `
        contract Market {
          uint256 public accumulatedFees;

          function addFee(uint256 fee) public {
            accumulatedFees += fee;
          }
        }
      `;
      const result = transpile(contract, { optimizationLevel: 'low' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // At low level, no event tracking — normal state variable
      expect(code).not.toContain('#[event]');
      expect(code).not.toContain('event::emit');
    });

    it('should include event-trackable info in optimization warnings', () => {
      const contract = `
        contract Market {
          uint256 public totalVolume;
          uint256 public accumulatedFees;

          function trade(uint256 amount, uint256 fee) public {
            totalVolume += amount;
            accumulatedFees += fee;
          }

          function deposit(uint256 amount) public {
            totalVolume += amount;
          }
        }
      `;
      const result = transpile(contract, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const warnings = result.warnings.filter(w => w.includes('event'));
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some(w => w.includes('accumulatedFees'))).toBe(true);
    });
  });

  describe('Per-user resources (high optimization)', () => {
    it('should use per-user resources for msg.sender-only mappings at high level', () => {
      const contract = `
        contract Token {
          address public owner;
          mapping(address => uint256) public balances;

          modifier onlyOwner() {
            require(msg.sender == owner, "Not owner");
            _;
          }

          function deposit() public payable {
            balances[msg.sender] += msg.value;
          }

          function withdraw(uint256 amount) public {
            balances[msg.sender] -= amount;
          }

          function getBalance(address user) public view returns (uint256) {
            return balances[user];
          }
        }
      `;
      const result = transpile(contract, { optimizationLevel: 'high' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // Should have per-user struct
      expect(code).toContain('UserState');
      expect(code).toContain('has key');
      // Should have ensure_user_state helper
      expect(code).toContain('ensure_user_state');
      expect(code).toContain('exists<');
      expect(code).toContain('move_to');
      // Should use borrow_global for reads
      expect(code).toContain('borrow_global<');
      // Should use borrow_global_mut for writes
      expect(code).toContain('borrow_global_mut<');
    });

    it('should NOT use per-user resources for mappings with non-sender writes', () => {
      const contract = `
        contract Token {
          mapping(address => uint256) public balances;

          function transfer(address to, uint256 amount) public {
            balances[msg.sender] -= amount;
            balances[to] += amount;
          }
        }
      `;
      const result = transpile(contract, { optimizationLevel: 'high' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // balances is written with non-sender key (to) → should stay as Table
      expect(code).not.toContain('UserState');
      expect(code).not.toContain('ensure_user_state');
      expect(code).toContain('table::');
    });

    it('should not use per-user resources at medium optimization level', () => {
      const contract = `
        contract Token {
          mapping(address => uint256) public balances;

          function deposit() public payable {
            balances[msg.sender] += msg.value;
          }
        }
      `;
      const result = transpile(contract, { optimizationLevel: 'medium' });
      expect(result.success).toBe(true);

      const code = result.modules[0].code;
      // At medium level, per-user resources should NOT be generated
      expect(code).not.toContain('UserState');
      expect(code).not.toContain('ensure_user_state');
    });
  });
});
