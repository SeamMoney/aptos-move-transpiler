/**
 * Integration Tests for DeFi Protocol Transpilation
 * Tests complete transpilation of complex DeFi contracts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { transpile, type TranspileOptions } from '../../src/transpiler.js';

const FIXTURES_DIR = join(__dirname, '../fixtures/defi');
const OUTPUT_DIR = join(__dirname, '../output');

// Helper to read fixture
function readFixture(filename: string): string {
  return readFileSync(join(FIXTURES_DIR, filename), 'utf-8');
}

// Helper to write output and compile
function transpileAndValidate(
  source: string,
  name: string,
  options: TranspileOptions = {}
): { success: boolean; code: string; errors: string[]; warnings: string[]; compiles?: boolean } {
  const result = transpile(source, {
    moduleAddress: '0x1',
    generateToml: true,
    packageName: name.toLowerCase(),
    ...options,
  });

  if (result.success && result.modules.length > 0) {
    // Write output for inspection
    const moduleDir = join(OUTPUT_DIR, name);
    const sourcesDir = join(moduleDir, 'sources');

    if (!existsSync(moduleDir)) {
      mkdirSync(moduleDir, { recursive: true });
    }
    if (!existsSync(sourcesDir)) {
      mkdirSync(sourcesDir, { recursive: true });
    }

    if (result.moveToml) {
      writeFileSync(join(moduleDir, 'Move.toml'), result.moveToml);
    }

    for (const module of result.modules) {
      writeFileSync(join(sourcesDir, `${module.name}.move`), module.code);
    }

    return {
      success: true,
      code: result.modules[0]?.code || '',
      errors: result.errors,
      warnings: result.warnings,
    };
  }

  return {
    success: false,
    code: '',
    errors: result.errors,
    warnings: result.warnings,
  };
}

// Clean output directory before tests
beforeAll(() => {
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
});

describe('DeFi Protocol Transpilation', () => {
  describe('AMM (Uniswap-style)', () => {
    it('should transpile SimpleAMM contract', () => {
      const source = readFixture('SimpleAMM.sol');
      const result = transpileAndValidate(source, 'simple_amm');

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);

      // Check for key components
      expect(result.code).toContain('module');
      expect(result.code).toContain('struct');
    });

    it('should generate correct state struct for AMM', () => {
      const source = readFixture('SimpleAMM.sol');
      const result = transpileAndValidate(source, 'simple_amm_state');

      expect(result.success).toBe(true);

      // Check for reserve tracking
      expect(result.code).toContain('reserve0');
      expect(result.code).toContain('reserve1');
      expect(result.code).toContain('total_supply');
    });

    it('should handle constant product formula calculations', () => {
      const source = readFixture('SimpleAMM.sol');
      const result = transpileAndValidate(source, 'simple_amm_math');

      expect(result.success).toBe(true);

      // Check for getAmountOut function
      expect(result.code).toContain('get_amount_out');
    });

    it('should handle reentrancy modifier pattern', () => {
      const source = readFixture('SimpleAMM.sol');
      const result = transpileAndValidate(source, 'simple_amm_lock');

      expect(result.success).toBe(true);

      // Check for unlocked state variable (reentrancy guard)
      expect(result.code).toContain('unlocked');
    });

    it('should generate LP token functions', () => {
      const source = readFixture('SimpleAMM.sol');
      const result = transpileAndValidate(source, 'simple_amm_lp');

      expect(result.success).toBe(true);

      // Check for mint/burn functions
      expect(result.code).toContain('mint');
      expect(result.code).toContain('burn');
      expect(result.code).toContain('balance_of');
    });
  });

  describe('Lending Protocol (Aave/Compound-style)', () => {
    it('should transpile SimpleLending contract', () => {
      const source = readFixture('SimpleLending.sol');
      const result = transpileAndValidate(source, 'simple_lending');

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should generate Market struct correctly', () => {
      const source = readFixture('SimpleLending.sol');
      const result = transpileAndValidate(source, 'simple_lending_market');

      expect(result.success).toBe(true);

      // Check for Market struct fields
      expect(result.code).toContain('collateral_factor');
      expect(result.code).toContain('total_deposits');
      expect(result.code).toContain('total_borrows');
    });

    it('should handle nested mapping structures', () => {
      const source = readFixture('SimpleLending.sol');
      const result = transpileAndValidate(source, 'simple_lending_positions');

      expect(result.success).toBe(true);

      // Check for user positions (nested mapping)
      expect(result.code).toContain('user_positions');
    });

    it('should generate interest rate functions', () => {
      const source = readFixture('SimpleLending.sol');
      const result = transpileAndValidate(source, 'simple_lending_interest');

      expect(result.success).toBe(true);

      // Check for rate calculation functions
      expect(result.code).toContain('get_borrow_rate');
      expect(result.code).toContain('get_supply_rate');
    });

    it('should generate liquidation function', () => {
      const source = readFixture('SimpleLending.sol');
      const result = transpileAndValidate(source, 'simple_lending_liquidate');

      expect(result.success).toBe(true);

      // Check for liquidation
      expect(result.code).toContain('liquidate');
    });

    it('should handle onlyAdmin modifier', () => {
      const source = readFixture('SimpleLending.sol');
      const result = transpileAndValidate(source, 'simple_lending_admin');

      expect(result.success).toBe(true);

      // Admin check should be present
      expect(result.code).toContain('admin');
    });
  });

  describe('Staking Rewards (Synthetix-style)', () => {
    it('should transpile StakingRewards contract', () => {
      const source = readFixture('StakingRewards.sol');
      const result = transpileAndValidate(source, 'staking_rewards');

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should generate reward calculation functions', () => {
      const source = readFixture('StakingRewards.sol');
      const result = transpileAndValidate(source, 'staking_rewards_calc');

      expect(result.success).toBe(true);

      // Check for reward functions
      expect(result.code).toContain('reward_per_token');
      expect(result.code).toContain('earned');
    });

    it('should handle stake/withdraw/getReward functions', () => {
      const source = readFixture('StakingRewards.sol');
      const result = transpileAndValidate(source, 'staking_rewards_actions');

      expect(result.success).toBe(true);

      expect(result.code).toContain('stake');
      expect(result.code).toContain('withdraw');
      expect(result.code).toContain('get_reward');
    });

    it('should handle updateReward modifier pattern', () => {
      const source = readFixture('StakingRewards.sol');
      const result = transpileAndValidate(source, 'staking_rewards_update');

      expect(result.success).toBe(true);

      // Check for reward update state
      expect(result.code).toContain('reward_per_token_stored');
      expect(result.code).toContain('last_update_time');
    });
  });

  describe('Yield Vault (Yearn-style)', () => {
    it('should transpile Vault contract', () => {
      const source = readFixture('Vault.sol');
      const result = transpileAndValidate(source, 'vault');

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should generate ERC4626-style share functions', () => {
      const source = readFixture('Vault.sol');
      const result = transpileAndValidate(source, 'vault_shares');

      expect(result.success).toBe(true);

      // Check for share conversion functions
      expect(result.code).toContain('convert_to_shares');
      expect(result.code).toContain('convert_to_assets');
    });

    it('should handle strategy management structs', () => {
      const source = readFixture('Vault.sol');
      const result = transpileAndValidate(source, 'vault_strategy');

      expect(result.success).toBe(true);

      // Check for strategy params
      expect(result.code).toContain('StrategyParams');
    });

    it('should generate deposit/withdraw functions', () => {
      const source = readFixture('Vault.sol');
      const result = transpileAndValidate(source, 'vault_deposit');

      expect(result.success).toBe(true);

      expect(result.code).toContain('deposit');
      expect(result.code).toContain('withdraw');
      expect(result.code).toContain('redeem');
    });

    it('should handle emergency shutdown', () => {
      const source = readFixture('Vault.sol');
      const result = transpileAndValidate(source, 'vault_emergency');

      expect(result.success).toBe(true);

      expect(result.code).toContain('emergency_shutdown');
    });
  });

  describe('MultiSig Wallet (Gnosis Safe-style)', () => {
    it('should transpile MultiSig contract', () => {
      const source = readFixture('MultiSig.sol');
      const result = transpileAndValidate(source, 'multisig');

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should generate Transaction struct', () => {
      const source = readFixture('MultiSig.sol');
      const result = transpileAndValidate(source, 'multisig_tx');

      expect(result.success).toBe(true);

      expect(result.code).toContain('Transaction');
    });

    it('should generate owner management', () => {
      const source = readFixture('MultiSig.sol');
      const result = transpileAndValidate(source, 'multisig_owners');

      expect(result.success).toBe(true);

      expect(result.code).toContain('owners');
      expect(result.code).toContain('is_owner');
    });

    it('should generate transaction confirmation flow', () => {
      const source = readFixture('MultiSig.sol');
      const result = transpileAndValidate(source, 'multisig_confirm');

      expect(result.success).toBe(true);

      expect(result.code).toContain('submit_transaction');
      expect(result.code).toContain('confirm_transaction');
      expect(result.code).toContain('execute_transaction');
    });

    it('should handle bytes data type', () => {
      const source = readFixture('MultiSig.sol');
      const result = transpileAndValidate(source, 'multisig_bytes');

      expect(result.success).toBe(true);

      // bytes should be converted to vector<u8>
      expect(result.code).toContain('vector<u8>');
    });
  });
});

describe('NovaDEX Complex AMM (exercises all 6 compilation fixes)', () => {
  it('should transpile NovaDEX contract', () => {
    const source = readFixture('NovaDEX.sol');
    const result = transpileAndValidate(source, 'nova_dex');

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should not add state param to pure functions (Fix #1)', () => {
    const source = readFixture('NovaDEX.sol');
    const result = transpileAndValidate(source, 'nova_dex_fix1');

    expect(result.success).toBe(true);
    // Pure functions should NOT have 'state' parameter — only their declared params
    expect(result.code).toContain('fun compute_fees_owed(volume: u256, fee_rate: u256, duration: u256): u256');
    expect(result.code).toContain('fun get_pool_value(reserve0: u256, reserve1: u256, price0: u256, price1: u256): u256');
    expect(result.code).toContain('fun get_amount_out(amount_in: u256, reserve_in: u256, reserve_out: u256): u256');
  });

  it('should declare E_ZERO_TREASURY error constant (Fix #2)', () => {
    const source = readFixture('NovaDEX.sol');
    const result = transpileAndValidate(source, 'nova_dex_fix2');

    expect(result.success).toBe(true);
    expect(result.code).toContain('E_ZERO_TREASURY');
  });

  it('should wrap keccak256 with bytes_to_u256 (Fix #3)', () => {
    const source = readFixture('NovaDEX.sol');
    const result = transpileAndValidate(source, 'nova_dex_fix3');

    expect(result.success).toBe(true);
    expect(result.code).toContain('evm_compat::bytes_to_u256');
    expect(result.code).toContain('aptos_hash::keccak256');
  });

  it('should handle nested mapping access (Fix #4)', () => {
    const source = readFixture('NovaDEX.sol');
    const result = transpileAndValidate(source, 'nova_dex_fix4');

    expect(result.success).toBe(true);
    // Nested table type
    expect(result.code).toContain('Table<u256, aptos_std::table::Table<address, UserPosition>>');
    // Nested borrow pattern without double-& wrapper
    expect(result.code).toContain('table::borrow(');
    // Contains + add pattern for lazy initialization
    expect(result.code).toContain('table::contains(');
    expect(result.code).toContain('table::add(');
  });

  it('should harmonize arithmetic types (Fix #5)', () => {
    const source = readFixture('NovaDEX.sol');
    const result = transpileAndValidate(source, 'nova_dex_fix5');

    expect(result.success).toBe(true);
    // u16 and u8 fields/constants should be cast to u256 in arithmetic
    expect(result.code).toContain('as u256)');
  });

  it('should generate evm_compat module', () => {
    const source = readFixture('NovaDEX.sol');
    const result = transpile(source, {
      moduleAddress: '0x1',
      packageName: 'nova_dex_compat',
      generateToml: true,
    });

    expect(result.success).toBe(true);
    const evmCompat = result.modules.find(m => m.name === 'evm_compat');
    expect(evmCompat).toBeDefined();
    expect(evmCompat!.code).toContain('public fun bytes_to_u256');
  });
});

describe('Complex Solidity Features', () => {
  describe('Struct handling', () => {
    it('should handle nested structs', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract NestedStruct {
          struct Inner {
            uint256 value;
            address owner;
          }
          struct Outer {
            Inner inner;
            uint256 timestamp;
          }
          mapping(uint256 => Outer) public items;
        }
      `;
      const result = transpileAndValidate(source, 'nested_struct');
      expect(result.success).toBe(true);
    });

    it('should handle struct arrays', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract StructArray {
          struct Item {
            uint256 id;
            string name;
          }
          Item[] public items;
          function addItem(uint256 id, string memory name) public {
            items.push(Item(id, name));
          }
        }
      `;
      const result = transpileAndValidate(source, 'struct_array');
      expect(result.success).toBe(true);
    });
  });

  describe('Enum handling', () => {
    it('should handle enums in function parameters', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract EnumParam {
          enum Status { Pending, Active, Completed }
          mapping(uint256 => Status) public itemStatus;
          function setStatus(uint256 id, Status status) public {
            itemStatus[id] = status;
          }
          function isActive(uint256 id) public view returns (bool) {
            return itemStatus[id] == Status.Active;
          }
        }
      `;
      const result = transpileAndValidate(source, 'enum_param');
      expect(result.success).toBe(true);
      expect(result.code).toContain('enum Status');
      expect(result.code).toContain('Status::Active');
    });
  });

  describe('Modifier patterns', () => {
    it('should inline onlyOwner modifier', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract Ownable {
          address public owner;
          modifier onlyOwner() {
            require(msg.sender == owner, "Not owner");
            _;
          }
          constructor() {
            owner = msg.sender;
          }
          function doSomething() public onlyOwner {
            // action
          }
        }
      `;
      const result = transpileAndValidate(source, 'only_owner');
      expect(result.success).toBe(true);
    });

    it('should handle nonReentrant modifier', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract ReentrancyGuard {
          uint256 private _status;
          uint256 private constant NOT_ENTERED = 1;
          uint256 private constant ENTERED = 2;

          modifier nonReentrant() {
            require(_status != ENTERED, "ReentrancyGuard: reentrant call");
            _status = ENTERED;
            _;
            _status = NOT_ENTERED;
          }

          function withdraw(uint256 amount) public nonReentrant {
            // withdrawal logic
          }
        }
      `;
      const result = transpileAndValidate(source, 'reentrancy');
      expect(result.success).toBe(true);
    });
  });

  describe('Math operations', () => {
    it('should handle safe math patterns', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract SafeMath {
          function mulDiv(uint256 a, uint256 b, uint256 denominator) public pure returns (uint256) {
            uint256 result = (a * b) / denominator;
            return result;
          }

          function sqrt(uint256 y) public pure returns (uint256 z) {
            if (y > 3) {
              z = y;
              uint256 x = y / 2 + 1;
              while (x < z) {
                z = x;
                x = (y / x + x) / 2;
              }
            } else if (y != 0) {
              z = 1;
            }
          }
        }
      `;
      const result = transpileAndValidate(source, 'safe_math');
      expect(result.success).toBe(true);
    });

    it('should handle power operations', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract PowerMath {
          function power(uint256 base, uint8 exponent) public pure returns (uint256) {
            return base ** exponent;
          }
        }
      `;
      const result = transpileAndValidate(source, 'power_math');
      expect(result.success).toBe(true);
    });
  });

  describe('Event emission', () => {
    it('should handle indexed event parameters', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract EventTest {
          event Transfer(address indexed from, address indexed to, uint256 value);
          event Approval(address indexed owner, address indexed spender, uint256 value);

          function emitTransfer(address to, uint256 value) public {
            emit Transfer(msg.sender, to, value);
          }
        }
      `;
      const result = transpileAndValidate(source, 'events');
      expect(result.success).toBe(true);
      expect(result.code).toContain('#[event]');
      expect(result.code).toContain('event::emit');
    });
  });

  describe('Error handling', () => {
    it('should convert require to assert', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract RequireTest {
          function checkValue(uint256 value) public pure {
            require(value > 0, "Value must be positive");
            require(value < 1000, "Value too large");
          }
        }
      `;
      const result = transpileAndValidate(source, 'require_test');
      expect(result.success).toBe(true);
      expect(result.code).toContain('assert!');
    });

    it('should handle custom errors', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract CustomErrors {
          error InsufficientBalance(uint256 available, uint256 required);
          error Unauthorized();

          function check(uint256 balance, uint256 amount) public pure {
            if (balance < amount) {
              revert InsufficientBalance(balance, amount);
            }
          }
        }
      `;
      const result = transpileAndValidate(source, 'custom_errors');
      expect(result.success).toBe(true);
    });
  });

  describe('Control flow', () => {
    it('should handle for loops', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract ForLoops {
          function sum(uint256 n) public pure returns (uint256 total) {
            for (uint256 i = 0; i < n; i++) {
              total += i;
            }
          }
        }
      `;
      const result = transpileAndValidate(source, 'for_loops');
      expect(result.success).toBe(true);
    });

    it('should handle nested loops', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract NestedLoops {
          function matrix(uint256 rows, uint256 cols) public pure returns (uint256 sum) {
            for (uint256 i = 0; i < rows; i++) {
              for (uint256 j = 0; j < cols; j++) {
                sum += i * j;
              }
            }
          }
        }
      `;
      const result = transpileAndValidate(source, 'nested_loops');
      expect(result.success).toBe(true);
    });

    it('should handle while loops', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract WhileLoops {
          function countdown(uint256 n) public pure returns (uint256) {
            uint256 result = 0;
            while (n > 0) {
              result += n;
              n--;
            }
            return result;
          }
        }
      `;
      const result = transpileAndValidate(source, 'while_loops');
      expect(result.success).toBe(true);
    });
  });
});

describe('Token Standards', () => {
  describe('ERC-20 to Fungible Asset', () => {
    it('should detect and transpile ERC-20 with FA flag', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract TestToken {
          string public name = "Test";
          string public symbol = "TST";
          uint8 public decimals = 18;
          uint256 public totalSupply;
          mapping(address => uint256) public balanceOf;
          mapping(address => mapping(address => uint256)) public allowance;

          event Transfer(address indexed from, address indexed to, uint256 value);

          function transfer(address to, uint256 amount) public returns (bool) {
            balanceOf[msg.sender] -= amount;
            balanceOf[to] += amount;
            emit Transfer(msg.sender, to, amount);
            return true;
          }
        }
      `;
      const result = transpileAndValidate(source, 'erc20_fa', { useFungibleAsset: true });
      expect(result.success).toBe(true);
      expect(result.warnings.some(w => w.includes('Fungible Asset'))).toBe(true);
      expect(result.code).toContain('fungible_asset');
    });
  });

  describe('ERC-721 to Digital Asset', () => {
    it('should detect and transpile ERC-721 with DA flag', () => {
      const source = `
        pragma solidity ^0.8.20;
        contract TestNFT {
          string public name = "TestNFT";
          string public symbol = "TNFT";

          mapping(uint256 => address) private _owners;
          mapping(address => uint256) private _balances;
          mapping(uint256 => address) private _tokenApprovals;

          event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

          function balanceOf(address owner) public view returns (uint256) {
            return _balances[owner];
          }

          function ownerOf(uint256 tokenId) public view returns (address) {
            return _owners[tokenId];
          }

          function tokenURI(uint256 tokenId) public view returns (string memory) {
            return "";
          }

          function approve(address to, uint256 tokenId) public {}

          function transferFrom(address from, address to, uint256 tokenId) public {
            _owners[tokenId] = to;
            emit Transfer(from, to, tokenId);
          }
        }
      `;
      const result = transpileAndValidate(source, 'erc721_da', { useDigitalAsset: true });
      expect(result.success).toBe(true);
      expect(result.warnings.some(w => w.includes('Digital Asset'))).toBe(true);
      expect(result.code).toContain('aptos_token_objects');
    });
  });
});
