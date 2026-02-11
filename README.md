# Sol2Move - Solidity to Aptos Move v2 Transpiler

A TypeScript-based transpiler that converts Solidity smart contracts to Aptos Move v2 source code.

## Features

- Converts Solidity source code to human-readable Move v2
- Supports Move v2 features: enums, signed integers, receiver-style calls, index notation
- **Expression-level type inference** — tracks types through binary ops, casts, function calls, and identifiers to produce type-safe Move code
- **Inheritance flattening** — merges parent contract state, functions, modifiers, and events into a single Move module
- **Cross-contract transpilation** — `contextSources` option resolves cross-file library calls and constants
- **OpenZeppelin library support** — SafeMath inlining, EnumerableSet/EnumerableMap → Table/vector, ReentrancyGuard patterns
- **EVM pattern translation** — `abi.encode` → `bcs::to_bytes`, inline assembly → stubs, `type(uint24).max` → computed constants
- **Auto `acquires` detection** — scans function bodies for `borrow_global` usage and emits correct resource annotations
- **Auto `use` declarations** — discovers `module::function` references and generates `use` imports
- Event and storage pattern conversion
- EVM compatibility module for common operations
- CLI tool for easy conversion

## Installation

```bash
npm install
npm run build
```

## Usage

### CLI Commands

```bash
# Convert a Solidity file to Move
npm run dev convert examples/simple-storage/SimpleStorage.sol -o output

# Or after building:
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
```

### Programmatic Usage

```typescript
import { transpile } from 'sol2move';

const soliditySource = `
contract SimpleStorage {
    uint256 private value;

    function setValue(uint256 _value) public {
        value = _value;
    }

    function getValue() public view returns (uint256) {
        return value;
    }
}
`;

const result = transpile(soliditySource, {
  moduleAddress: '0x1',
  packageName: 'my_contract',
});

if (result.success) {
  console.log(result.modules[0].code);
}
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

    // Error codes
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

The transpiler has been validated against the **DLMM (Liquidity Book) protocol** — a complex DeFi protocol with 22 contracts including math libraries, token standards, factory/router/pair patterns, and OpenZeppelin dependencies. All 22 contracts transpile successfully with zero errors.

```bash
# Transpile a multi-contract DeFi protocol
npx sol2move convert contracts/LBPair.sol -o output \
  --context contracts/libraries/*.sol contracts/LBToken.sol
```

## Limitations

- **No dynamic dispatch**: Move is statically typed
- **Storage model differs**: Move uses resources at addresses
- **No delegatecall**: Must use capability pattern
- **Inline assembly**: Translated to stubs (EVM opcodes have no Move equivalent)
- **Hash function**: keccak256 maps to aptos_hash::keccak256
- **tx.origin, tx.gasprice**: Not supported in Move

## Project Structure

```
sol2move/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── transpiler.ts         # Main transpiler (3-stage pipeline)
│   ├── parser/               # Solidity parsing
│   ├── types/
│   │   ├── ir.ts             # Intermediate representation types
│   │   └── move-ast.ts       # Move AST types (with inferredType)
│   ├── mapper/
│   │   └── type-mapper.ts    # Solidity → Move type mapping
│   ├── transformer/
│   │   ├── contract-transformer.ts    # Module assembly, inheritance flattening
│   │   ├── function-transformer.ts    # Function bodies, state access, modifiers
│   │   ├── expression-transformer.ts  # Expressions, library calls, type inference
│   │   └── type-inference.ts          # Centralized type inference utilities
│   ├── codegen/
│   │   └── move-generator.ts # Move source code generation
│   └── stdlib/               # EVM compatibility module
├── tests/
│   ├── unit/                 # Unit tests (95 tests)
│   ├── integration/          # Integration tests (40 tests)
│   ├── eval/                 # Protocol eval tests (22 DLMM tests)
│   └── fixtures/             # Solidity source fixtures
└── examples/                 # Example contracts
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev convert examples/simple-storage/SimpleStorage.sol

# Build
npm run build

# Run tests
npx vitest run

# Run DLMM protocol evaluation
npx vitest run tests/eval/dlmm-eval.test.ts
```

## License

MIT
