import { describe, it, expect } from 'vitest';
import { analyzeContract, buildResourcePlan } from '../../src/analyzer/state-analyzer.js';
import { contractToIR } from '../../src/transformer/contract-transformer.js';
import { parseSolidity, extractContracts } from '../../src/parser/solidity-parser.js';
import type { IRContract } from '../../src/types/ir.js';

/**
 * Helper: parse Solidity source and return IR for the first (non-interface) contract.
 */
function parseToIR(source: string): IRContract {
  const result = parseSolidity(source);
  if (!result.success || !result.ast) throw new Error('Parse failed');
  const contracts = extractContracts(result.ast);
  const contract = contracts.find(c => c.kind !== 'interface');
  if (!contract) throw new Error('No contract found');
  return contractToIR(contract);
}

describe('State Variable Analyzer', () => {
  describe('Phase 1: Admin Modifier Detection', () => {
    it('should detect onlyOwner as admin modifier', () => {
      const ir = parseToIR(`
        contract Token {
          address public owner;
          uint256 public fee;

          modifier onlyOwner() {
            require(msg.sender == owner, "Not owner");
            _;
          }

          function setFee(uint256 _fee) public onlyOwner {
            fee = _fee;
          }
        }
      `);

      const profile = analyzeContract(ir);
      expect(profile.adminModifiers.has('onlyOwner')).toBe(true);
    });

    it('should detect custom admin modifier with ownership check', () => {
      const ir = parseToIR(`
        contract Custom {
          address public admin;

          modifier onlyAdmin() {
            require(msg.sender == admin, "Not admin");
            _;
          }

          function setConfig() public onlyAdmin {}
        }
      `);

      const profile = analyzeContract(ir);
      expect(profile.adminModifiers.has('onlyAdmin')).toBe(true);
    });
  });

  describe('Phase 3: Variable Classification', () => {
    it('should classify immutable variables as admin_config', () => {
      const ir = parseToIR(`
        contract Token {
          address immutable owner;
          uint256 public value;

          constructor() {
            owner = msg.sender;
          }

          function setValue(uint256 v) public {
            value = v;
          }
        }
      `);

      const profile = analyzeContract(ir);
      const ownerAnalysis = profile.variableAnalyses.get('owner');
      expect(ownerAnalysis).toBeDefined();
      expect(ownerAnalysis!.category).toBe('admin_config');
      expect(ownerAnalysis!.confidence).toBe(1.0);
    });

    it('should classify admin-only written variables as admin_config', () => {
      const ir = parseToIR(`
        contract Config {
          address public owner;
          uint256 public feeRate;

          modifier onlyOwner() {
            require(msg.sender == owner, "Not owner");
            _;
          }

          function setFeeRate(uint256 rate) public onlyOwner {
            feeRate = rate;
          }

          function getFeeRate() public view returns (uint256) {
            return feeRate;
          }
        }
      `);

      const profile = analyzeContract(ir);
      const feeAnalysis = profile.variableAnalyses.get('feeRate');
      expect(feeAnalysis).toBeDefined();
      expect(feeAnalysis!.category).toBe('admin_config');
    });

    it('should classify counter variables as aggregatable', () => {
      const ir = parseToIR(`
        contract Token {
          uint256 public totalSupply;
          mapping(address => uint256) public balances;

          function mint(address to, uint256 amount) public {
            totalSupply += amount;
            balances[to] += amount;
          }

          function burn(address from, uint256 amount) public {
            totalSupply -= amount;
            balances[from] -= amount;
          }
        }
      `);

      const profile = analyzeContract(ir);
      const totalSupplyAnalysis = profile.variableAnalyses.get('totalSupply');
      expect(totalSupplyAnalysis).toBeDefined();
      expect(totalSupplyAnalysis!.category).toBe('aggregatable');
    });

    it('should classify address-keyed mappings with msg.sender as user_keyed_mapping', () => {
      const ir = parseToIR(`
        contract Token {
          mapping(address => uint256) public balances;

          function deposit() public payable {
            balances[msg.sender] += msg.value;
          }

          function withdraw(uint256 amount) public {
            balances[msg.sender] -= amount;
          }
        }
      `);

      const profile = analyzeContract(ir);
      const balancesAnalysis = profile.variableAnalyses.get('balances');
      expect(balancesAnalysis).toBeDefined();
      expect(balancesAnalysis!.category).toBe('user_keyed_mapping');
      expect(balancesAnalysis!.msgSenderKeyFraction).toBeGreaterThanOrEqual(0.5);
    });

    it('should classify variables with plain assignment as general', () => {
      const ir = parseToIR(`
        contract Store {
          uint256 public lastPrice;

          function updatePrice(uint256 price) public {
            lastPrice = price;
          }
        }
      `);

      const profile = analyzeContract(ir);
      const priceAnalysis = profile.variableAnalyses.get('lastPrice');
      expect(priceAnalysis).toBeDefined();
      expect(priceAnalysis!.category).toBe('general');
    });

    it('should not classify as aggregatable if plain = assignment exists', () => {
      const ir = parseToIR(`
        contract ResetCounter {
          uint256 public count;

          function increment() public {
            count += 1;
          }

          function reset() public {
            count = 0;
          }
        }
      `);

      const profile = analyzeContract(ir);
      const countAnalysis = profile.variableAnalyses.get('count');
      expect(countAnalysis).toBeDefined();
      // Has both += and =, so should not be aggregatable
      expect(countAnalysis!.category).not.toBe('aggregatable');
    });
  });

  describe('Phase 4: Resource Grouping', () => {
    it('should group variables into separate resources by category', () => {
      const ir = parseToIR(`
        contract Vault {
          address public owner;
          uint256 public totalDeposits;
          mapping(address => uint256) public deposits;
          uint256 public lastTimestamp;

          modifier onlyOwner() {
            require(msg.sender == owner, "Not owner");
            _;
          }

          function deposit() public payable {
            deposits[msg.sender] += msg.value;
            totalDeposits += msg.value;
          }

          function setTimestamp(uint256 t) public {
            lastTimestamp = t;
          }
        }
      `);

      const profile = analyzeContract(ir);
      expect(profile.resourceGroups.length).toBeGreaterThan(1);

      // Should have admin config group for 'owner'
      const adminGroup = profile.resourceGroups.find(g => g.name.includes('AdminConfig'));
      expect(adminGroup).toBeDefined();
      expect(adminGroup!.variables.some(v => v.variable.name === 'owner')).toBe(true);

      // Should have counters group for 'totalDeposits'
      const countersGroup = profile.resourceGroups.find(g => g.name.includes('Counters'));
      expect(countersGroup).toBeDefined();
      expect(countersGroup!.variables.some(v => v.variable.name === 'totalDeposits')).toBe(true);

      // Should have user data group for 'deposits'
      const userGroup = profile.resourceGroups.find(g => g.name.includes('UserData'));
      expect(userGroup).toBeDefined();
      expect(userGroup!.variables.some(v => v.variable.name === 'deposits')).toBe(true);

      // Exactly one primary group
      const primaryGroups = profile.resourceGroups.filter(g => g.isPrimary);
      expect(primaryGroups.length).toBe(1);
    });

    it('should put all vars in one group when all are general', () => {
      const ir = parseToIR(`
        contract Simple {
          uint256 public a;
          uint256 public b;

          function setA(uint256 _a) public { a = _a; }
          function setB(uint256 _b) public { b = _b; }
        }
      `);

      const profile = analyzeContract(ir);
      // Both have plain = assignment, so both are general
      expect(profile.resourceGroups.length).toBe(1);
      expect(profile.resourceGroups[0].name).toContain('State');
      expect(profile.resourceGroups[0].isPrimary).toBe(true);
    });
  });

  describe('Phase 5: Function Access Profiles', () => {
    it('should map functions to the resource groups they access', () => {
      const ir = parseToIR(`
        contract Token {
          address public owner;
          uint256 public totalSupply;
          uint256 public lastPrice;

          modifier onlyOwner() {
            require(msg.sender == owner, "Not owner");
            _;
          }

          function mint(uint256 amount) public {
            totalSupply += amount;
          }

          function setPrice(uint256 price) public {
            lastPrice = price;
          }

          function transferOwnership(address newOwner) public onlyOwner {
            owner = newOwner;
          }
        }
      `);

      const profile = analyzeContract(ir);

      // mint should access Counters group
      const mintProfile = profile.functionProfiles.get('mint');
      expect(mintProfile).toBeDefined();
      expect(mintProfile!.acquires.length).toBeGreaterThan(0);

      // transferOwnership should access AdminConfig group
      const transferProfile = profile.functionProfiles.get('transferOwnership');
      expect(transferProfile).toBeDefined();

      // mint and transferOwnership should access different groups
      if (mintProfile && transferProfile) {
        const mintGroups = new Set(mintProfile.acquires);
        const transferGroups = new Set(transferProfile.acquires);
        // They should not overlap (different resource groups)
        const overlap = [...mintGroups].filter(g => transferGroups.has(g));
        expect(overlap.length).toBe(0);
      }
    });

    it('should handle pure functions with no state access', () => {
      const ir = parseToIR(`
        contract Math {
          function add(uint256 a, uint256 b) public pure returns (uint256) {
            return a + b;
          }
        }
      `);

      const profile = analyzeContract(ir);
      // No state variables → empty profile
      expect(profile.variableAnalyses.size).toBe(0);
      expect(profile.parallelizationScore).toBe(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle library contracts with no state', () => {
      const ir = parseToIR(`
        library SafeMath {
          function add(uint256 a, uint256 b) internal pure returns (uint256) {
            return a + b;
          }
        }
      `);

      const profile = analyzeContract(ir);
      expect(profile.variableAnalyses.size).toBe(0);
      expect(profile.resourceGroups.length).toBe(0);
      expect(profile.parallelizationScore).toBe(100);
    });

    it('should handle constructor-only writes as admin_config', () => {
      const ir = parseToIR(`
        contract Token {
          string public name;
          string public symbol;
          uint256 public value;

          constructor(string memory _name, string memory _symbol) {
            name = _name;
            symbol = _symbol;
          }

          function setValue(uint256 v) public {
            value = v;
          }
        }
      `);

      const profile = analyzeContract(ir);
      const nameAnalysis = profile.variableAnalyses.get('name');
      expect(nameAnalysis).toBeDefined();
      expect(nameAnalysis!.category).toBe('admin_config');

      const symbolAnalysis = profile.variableAnalyses.get('symbol');
      expect(symbolAnalysis).toBeDefined();
      expect(symbolAnalysis!.category).toBe('admin_config');
    });

    it('should handle variables accessed in multiple function contexts', () => {
      const ir = parseToIR(`
        contract Mixed {
          address public owner;
          uint256 public value;

          modifier onlyOwner() {
            require(msg.sender == owner, "Not owner");
            _;
          }

          function adminSet(uint256 v) public onlyOwner {
            value = v;
          }

          function publicSet(uint256 v) public {
            value = v;
          }
        }
      `);

      const profile = analyzeContract(ir);
      // 'value' is written by both admin AND non-admin → should be 'general'
      const valueAnalysis = profile.variableAnalyses.get('value');
      expect(valueAnalysis).toBeDefined();
      expect(valueAnalysis!.category).toBe('general');
    });

    it('should compute a parallelization score', () => {
      const ir = parseToIR(`
        contract Scored {
          address public owner;
          uint256 public totalSupply;
          mapping(address => uint256) public balances;

          modifier onlyOwner() {
            require(msg.sender == owner, "Not owner");
            _;
          }

          function mint(uint256 amount) public {
            totalSupply += amount;
            balances[msg.sender] += amount;
          }

          function transferOwnership(address newOwner) public onlyOwner {
            owner = newOwner;
          }
        }
      `);

      const profile = analyzeContract(ir);
      expect(profile.parallelizationScore).toBeGreaterThan(0);
      expect(profile.parallelizationScore).toBeLessThanOrEqual(100);
    });

    it('should generate recommendations', () => {
      const ir = parseToIR(`
        contract Recommended {
          address public owner;
          uint256 public totalSupply;

          modifier onlyOwner() {
            require(msg.sender == owner, "Not owner");
            _;
          }

          function mint(uint256 amount) public {
            totalSupply += amount;
          }

          function transferOwnership(address newOwner) public onlyOwner {
            owner = newOwner;
          }
        }
      `);

      const profile = analyzeContract(ir);
      expect(profile.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('buildResourcePlan', () => {
    it('should build a varToGroup map from analysis', () => {
      const ir = parseToIR(`
        contract Planned {
          address public owner;
          uint256 public totalSupply;
          uint256 public price;

          modifier onlyOwner() {
            require(msg.sender == owner, "Not owner");
            _;
          }

          function mint(uint256 amount) public {
            totalSupply += amount;
          }

          function setPrice(uint256 p) public {
            price = p;
          }

          function transferOwnership(address newOwner) public onlyOwner {
            owner = newOwner;
          }
        }
      `);

      const profile = analyzeContract(ir);
      const plan = buildResourcePlan(profile);

      // Every mutable state variable should be mapped to a group
      expect(plan.varToGroup.has('owner')).toBe(true);
      expect(plan.varToGroup.has('totalSupply')).toBe(true);
      expect(plan.varToGroup.has('price')).toBe(true);

      // Groups should match profile
      expect(plan.groups).toBe(profile.resourceGroups);
      expect(plan.functionProfiles).toBe(profile.functionProfiles);
    });
  });

  describe('Complex Contract Analysis', () => {
    it('should correctly analyze a DeFi-like contract', () => {
      const ir = parseToIR(`
        contract StakingVault {
          address public owner;
          address public rewardsToken;
          uint256 public rewardRate;
          uint256 public totalStaked;
          mapping(address => uint256) public stakedBalance;
          mapping(address => uint256) public rewards;
          bool public paused;

          modifier onlyOwner() {
            require(msg.sender == owner, "Not owner");
            _;
          }

          function stake() public payable {
            stakedBalance[msg.sender] += msg.value;
            totalStaked += msg.value;
            rewards[msg.sender] += 1;
          }

          function withdraw(uint256 amount) public {
            stakedBalance[msg.sender] -= amount;
            totalStaked -= amount;
            rewards[msg.sender] -= 1;
          }

          function setRewardRate(uint256 rate) public onlyOwner {
            rewardRate = rate;
          }

          function pause() public onlyOwner {
            paused = true;
          }
        }
      `);

      const profile = analyzeContract(ir);

      // owner, rewardsToken, paused should be admin_config
      expect(profile.variableAnalyses.get('owner')!.category).toBe('admin_config');
      expect(profile.variableAnalyses.get('paused')!.category).toBe('admin_config');

      // rewardRate is written only by admin → admin_config
      expect(profile.variableAnalyses.get('rewardRate')!.category).toBe('admin_config');

      // totalStaked should be aggregatable (only += and -=)
      expect(profile.variableAnalyses.get('totalStaked')!.category).toBe('aggregatable');

      // stakedBalance, rewards should be user_keyed_mapping
      expect(profile.variableAnalyses.get('stakedBalance')!.category).toBe('user_keyed_mapping');
      expect(profile.variableAnalyses.get('rewards')!.category).toBe('user_keyed_mapping');

      // Should have multiple resource groups
      expect(profile.resourceGroups.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Event-trackable classification', () => {
    it('should classify write-only fee-like variables as event_trackable', () => {
      const ir = parseToIR(`
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
      `);

      const profile = analyzeContract(ir);
      // accumulatedFees is only written (+=), never explicitly read → event_trackable
      expect(profile.variableAnalyses.get('accumulatedFees')!.category).toBe('event_trackable');
      // totalVolume is also only written via += but not fee-like, might be aggregatable or event_trackable
      // depending on whether it has explicit reads
    });
  });

  describe('Per-user resource detection', () => {
    it('should detect msg.sender-only mappings for per-user resources', () => {
      const ir = parseToIR(`
        contract Token {
          mapping(address => uint256) public balances;

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
      `);

      const profile = analyzeContract(ir);
      expect(profile.variableAnalyses.get('balances')!.category).toBe('user_keyed_mapping');

      const plan = buildResourcePlan(profile, 'high');
      expect(plan.perUserResources).toBeDefined();
      expect(plan.perUserResources!.structName).toBe('TokenUserState');
      expect(plan.perUserResources!.fields.length).toBe(1);
      expect(plan.perUserResources!.fields[0].varName).toBe('balances');
    });

    it('should NOT use per-user resources for mappings with non-sender writes', () => {
      const ir = parseToIR(`
        contract Token {
          mapping(address => uint256) public balances;

          function transfer(address to, uint256 amount) public {
            balances[msg.sender] -= amount;
            balances[to] += amount;
          }
        }
      `);

      const profile = analyzeContract(ir);
      const plan = buildResourcePlan(profile, 'high');
      // balances is written with non-msg.sender key → not eligible for per-user
      expect(plan.perUserResources).toBeUndefined();
    });

    it('should NOT generate per-user resources at medium level', () => {
      const ir = parseToIR(`
        contract Token {
          mapping(address => uint256) public balances;

          function deposit() public payable {
            balances[msg.sender] += msg.value;
          }
        }
      `);

      const profile = analyzeContract(ir);
      const plan = buildResourcePlan(profile, 'medium');
      expect(plan.perUserResources).toBeUndefined();
    });
  });
});
