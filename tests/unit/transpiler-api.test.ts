import { describe, expect, it } from 'vitest';
import { transpile, transpileContract } from '../../src/transpiler.js';

describe('transpiler API regressions', () => {
  it('isolates transpileContract from unrelated contracts and interface warnings', () => {
    const source = `
      pragma solidity ^0.8.20;

      interface INoise {
        function ping() external;
      }

      contract Counter {
        uint256 public count;
        function inc() public { count += 1; }
      }
    `;

    const full = transpile(source, { generateToml: false });
    expect(full.warnings).toContain('Skipping interface: INoise');

    const isolated = transpileContract(source, 'Counter', { generateToml: false });
    expect(isolated.success).toBe(true);
    expect(isolated.modules.length).toBe(1);
    expect(isolated.modules[0].name).toBe('counter');
    expect(isolated.warnings).not.toContain('Skipping interface: INoise');
  });

  it('emits evm_compat module and Move.toml address only when used', () => {
    const usesCompat = `
      pragma solidity ^0.8.20;
      contract Casts {
        function toAddr(uint256 x) public pure returns (address) {
          return address(x);
        }
      }
    `;

    const compatResult = transpile(usesCompat, { generateToml: true });
    expect(compatResult.success).toBe(true);
    expect(compatResult.modules.some(m => m.name === 'evm_compat')).toBe(true);
    expect(compatResult.modules.some(m => /evm_compat::to_address/.test(m.code))).toBe(true);
    expect(compatResult.moveToml).toContain('transpiler = "0x42"');

    const noCompat = `
      pragma solidity ^0.8.20;
      contract Plain {
        uint256 public count;
        function inc() public { count += 1; }
      }
    `;

    const plainResult = transpile(noCompat, { generateToml: true });
    expect(plainResult.success).toBe(true);
    expect(plainResult.modules.some(m => m.name === 'evm_compat')).toBe(false);
    expect(plainResult.moveToml).not.toContain('transpiler = "0x42"');
  });

  it('fails safely when reserved evm_compat helper name collides with a user module', () => {
    const source = `
      pragma solidity ^0.8.20;
      contract EvmCompat {
        function toAddr(uint256 x) public pure returns (address) {
          return address(x);
        }
      }
    `;

    const result = transpile(source, { generateToml: true });
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Helper module name conflict'))).toBe(true);
  });
});
