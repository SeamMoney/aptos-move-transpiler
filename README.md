# Sol2Move - Solidity to Aptos Move v2 Transpiler

A TypeScript-based transpiler that converts Solidity smart contracts to Aptos Move v2 source code.

## Features

- Converts Solidity source code to human-readable Move v2
- Supports Move v2 features: enums, signed integers, receiver-style calls, index notation
- Type mapping from Solidity to Move types
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
| `bool` | `bool` |
| `address` | `address` |
| `bytes`, `string` | `vector<u8>` |
| `mapping(K => V)` | `Table<K, V>` |
| `T[]` | `vector<T>` |

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

## Limitations

- **No dynamic dispatch**: Move is statically typed
- **Storage model differs**: Move uses resources at addresses
- **No delegatecall**: Must use capability pattern
- **Hash function**: keccak256 maps to aptos_hash::keccak256
- **tx.origin, tx.gasprice**: Not supported in Move

## Project Structure

```
sol2move/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── transpiler.ts         # Main transpiler
│   ├── parser/               # Solidity parsing
│   ├── types/                # Type definitions
│   ├── mapper/               # Type mapping
│   ├── transformer/          # AST transformation
│   ├── codegen/              # Move code generation
│   └── stdlib/               # EVM compatibility module
├── examples/                 # Example contracts
└── tests/                    # Test suite
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
npm test
```

## License

MIT
