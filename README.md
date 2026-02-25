# Sol2Move - Solidity to Aptos Move v2 Transpiler

A TypeScript-based transpiler that converts Solidity smart contracts to Aptos Move v2 source code, with built-in Move parsing and validation.

## Features

- Converts Solidity source code to human-readable Move v2
- Supports Move v2 features: enums, signed integers, receiver-style calls, index notation
- **Expression-level type inference** — tracks types through binary ops, casts, function calls, and identifiers to produce type-safe Move code
- **Inheritance flattening** — merges parent contract state, functions, modifiers, and events into a single Move module
- **Cross-contract transpilation** — `contextSources` option resolves cross-file library calls and constants
- **OpenZeppelin library support** — SafeMath inlining, EnumerableSet/EnumerableMap, ReentrancyGuard patterns
- **EVM pattern translation** — `abi.encode` to `bcs::to_bytes`, inline assembly stubs, `type(uint24).max` computed constants
- **Move parser/validator** — tree-sitter-based Move code parsing and syntax validation (optional dependency)
- **Unified SDK** — single `Sol2Move` class exposing all capabilities
- CLI tool for easy conversion

## Installation

```bash
npm install sol2move
```

To enable Move parsing and validation (optional — requires a C compiler for native addon):

```bash
npm install tree-sitter tree-sitter-move-on-aptos@github:aptos-labs/tree-sitter-move-on-aptos
```

On macOS, if the native build fails, set the C++ include path:

```bash
CXXFLAGS="-isysroot $(xcrun --show-sdk-path) -I$(xcrun --show-sdk-path)/usr/include/c++/v1" npm install
```

## SDK Usage

The `Sol2Move` class is the primary interface — one import, all capabilities.

```typescript
import { Sol2Move } from 'sol2move';

const sdk = new Sol2Move({
  moduleAddress: '0x1',
  packageName: 'my_dapp',
});

// ─── Analyze Solidity ───────────────────────────────────
const analysis = sdk.analyzeSolidity(soliditySource);
// { valid, contracts: [{ name, kind, functions, events, stateVariables }], errors }

// ─── Validate Solidity ──────────────────────────────────
const check = sdk.validateSolidity(soliditySource);
// { valid, contracts: ['Counter', 'Token'], errors }

// ─── Transpile Solidity → Move ──────────────────────────
const result = sdk.transpile(soliditySource);
// { success, modules: [{ name, code, ast }], moveToml, errors, warnings }

if (result.success) {
  for (const mod of result.modules) {
    console.log(mod.name);  // Module name
    console.log(mod.code);  // Generated Move source
  }
}

// ─── Parse Move code ────────────────────────────────────
const parsed = await sdk.parseMove(moveSource);
// { success, tree (navigable syntax tree), errors }

if (parsed.success) {
  const mod = parsed.tree.children[0];
  console.log(mod.fieldChild('name')?.text);  // "0x1::my_module"
}

// ─── Validate Move code ────────────────────────────────
const validation = await sdk.validateMove(moveSource);
// { valid, errors, structure: { modules, functions, structs } }

// ─── Generate Move from AST ────────────────────────────
const code = sdk.generateMove(result.modules[0].ast);

// ─── Full pipeline: transpile + validate ────────────────
const full = await sdk.transpileAndValidate(soliditySource);
// { transpile: TranspileOutput, moveValidation: ModuleValidation[], allValid }

if (full.allValid) {
  console.log('All generated modules are syntactically valid');
}
```

### Individual Functions

All functions are also available as standalone exports:

```typescript
import {
  transpile,
  validate,
  analyze,
  parseMoveCode,
  validateMoveCode,
  isMoveParserAvailable,
} from 'sol2move';

// Transpile
const result = transpile(soliditySource, { moduleAddress: '0x1' });

// Check if Move parser is available
if (await isMoveParserAvailable()) {
  const validation = await validateMoveCode(result.modules[0].code);
}
```

## CLI Commands

```bash
# Convert a Solidity file to Move
npx sol2move convert contract.sol -o output

# Validate Solidity file
npx sol2move validate contract.sol

# Analyze contract structure
npx sol2move analyze contract.sol
```

### CLI Options

```
sol2move convert <file> [options]

Options:
  -o, --output <dir>     Output directory (default: "./move_output")
  -a, --address <addr>   Module address (default: "0x1")
  -n, --name <name>      Package name
  --no-toml              Skip generating Move.toml
  --fungible-asset       Use Fungible Asset standard for ERC-20 tokens
  --digital-asset        Use Digital Asset standard for ERC-721 tokens
```

## Type Mappings

| Solidity | Move v2 |
|----------|---------|
| `uint8-uint256` | `u8-u256` |
| `int8-int256` | `i8-i256` |
| `uint24`, `uint40`, etc. | nearest larger Move type (`u32`, `u64`, etc.) |
| `bool` | `bool` |
| `address` | `address` |
| `bytes`, `string` | `vector<u8>` |
| `mapping(K => V)` | `Table<K, V>` |
| `T[]` | `vector<T>` |
| `EnumerableMap.UintToUintMap` | `Table<u256, u256>` |
| `EnumerableSet.AddressSet` | `vector<address>` |
| `EnumerableSet.UintSet` | `vector<u256>` |
| `IERC20`, `ILBPair`, etc. | `address` |

## Pattern Mappings

| Solidity | Move v2 |
|----------|---------|
| `contract C` | `module addr::c` |
| `msg.sender` | `signer::address_of(account)` |
| `require(cond)` | `assert!(cond, ERROR_CODE)` |
| `emit Event(...)` | `event::emit(Event { ... })` |
| Constructor | `init_module` / `initialize` |
| `public` functions | `public entry fun` |
| `view` functions | `#[view] public fun` |
| `type(uint24).max` | `16777215` (computed `2^N - 1`) |
| `type(uint256).max` | `u256::MAX` (Move 2.3 builtin) |
| `abi.encode(x)` | `bcs::to_bytes(&x)` |
| `x.add(y)` (SafeMath) | `x + y` |
| `set.contains(x)` | `vector::contains(&set, &x)` |
| `map.get(k)` | `*table::borrow(&map, k)` |

## Example

### Input (Solidity)

```solidity
contract SimpleStorage {
    uint256 private value;

    event ValueChanged(address sender, uint256 newValue);

    function setValue(uint256 _value) public {
        value = _value;
        emit ValueChanged(msg.sender, _value);
    }

    function getValue() public view returns (uint256) {
        return value;
    }
}
```

### Output (Move v2)

```move
module 0x1::simple_storage {
    use std::signer;
    use aptos_framework::event;

    const E_NOT_AUTHORIZED: u64 = 1;
    const E_INVALID_ARGUMENT: u64 = 2;

    struct SimpleStorageState has key {
        value: u256
    }

    #[event]
    struct ValueChanged has drop, store {
        sender: address,
        new_value: u256
    }

    fun init_module(deployer: &signer) {
        move_to(deployer, SimpleStorageState { value: 0 });
    }

    public entry fun set_value(account: &signer, _value: u256) acquires SimpleStorageState {
        let state = borrow_global_mut<SimpleStorageState>(@0x1);
        state.value = _value;
        event::emit(ValueChanged {
            sender: signer::address_of(account),
            new_value: _value
        });
    }

    #[view]
    public fun get_value(): u256 acquires SimpleStorageState {
        borrow_global<SimpleStorageState>(@0x1).value
    }
}
```

## DeFi Protocol Support

The transpiler has been validated against production DeFi contracts and the **DLMM (Liquidity Book) protocol** — 22 contracts with 317 functions, all transpiling successfully with zero errors. See [`examples/`](examples/) for side-by-side Solidity/Move output.

| Protocol Pattern | Example | Sol LoC | Move LoC | Functions |
|-----------------|---------|---------|----------|-----------|
| AMM (Uniswap-style) | [`examples/defi/amm/`](examples/defi/amm/) | 231 | 220 | 12 |
| Lending (Aave-style) | [`examples/defi/lending/`](examples/defi/lending/) | 363 | 325 | 13 |
| Staking (Synthetix-style) | [`examples/defi/staking/`](examples/defi/staking/) | 221 | 218 | 14 |
| Yield Vault (ERC-4626) | [`examples/defi/vault/`](examples/defi/vault/) | 411 | 362 | 24 |
| MultiSig (Gnosis-style) | [`examples/defi/multisig/`](examples/defi/multisig/) | 351 | 355 | 21 |
| Full DEX (NovaDEX) | [`examples/defi/nova-dex/`](examples/defi/nova-dex/) | 424 | 479 | 22 |
| DLMM Protocol (22 contracts) | [`examples/protocol/dlmm/`](examples/protocol/dlmm/) | — | — | 317 |

```bash
# Transpile a multi-contract DeFi protocol
npx sol2move convert contracts/LBPair.sol -o output \
  --context contracts/libraries/*.sol contracts/LBToken.sol
```

## Project Structure

```
sol2move/
├── src/
│   ├── index.ts              # CLI + package exports
│   ├── sdk.ts                # Unified Sol2Move SDK class
│   ├── transpiler.ts         # Main transpiler (3-stage pipeline)
│   ├── compiler/             # Move compilation verification (WASM + CLI)
│   ├── parser/               # Solidity + Move parsing
│   ├── types/                # IR and Move AST types
│   ├── mapper/               # Solidity → Move type mapping
│   ├── transformer/          # AST transformation pipeline
│   └── codegen/              # Move source code generation
├── examples/
│   ├── basic/                # Simple contracts (storage, ERC-20, ERC-721)
│   ├── defi/                 # DeFi protocols (AMM, lending, vault, staking, multisig, NovaDEX)
│   └── protocol/             # Protocol-scale eval (DLMM — 22 contracts)
├── tests/
│   ├── unit/                 # Unit tests
│   ├── integration/          # Integration + compilation tests
│   └── eval/                 # Protocol evaluation framework
└── dist/                     # Compiled output (npm package)
```

## Limitations

- **No dynamic dispatch**: Move is statically typed
- **Storage model differs**: Move uses resources at addresses
- **No delegatecall**: Must use capability pattern
- **Inline assembly**: Translated to stubs (EVM opcodes have no Move equivalent)
- **Hash function**: keccak256 maps to aptos_hash::keccak256
- **tx.origin, tx.gasprice**: Not supported in Move
- **Move parser**: Requires optional native dependencies (tree-sitter). All other features work without it.

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev convert examples/basic/simple-storage/SimpleStorage.sol

# Build
npm run build

# Run tests
npx vitest run

# Run DLMM protocol evaluation
npx vitest run tests/eval/dlmm-eval.test.ts
```

## License

MIT
