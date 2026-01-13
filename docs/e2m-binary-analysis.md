# Pontem e2m Binary Reverse Engineering Analysis

## Binary Information

- **File**: e2m v0.0.5
- **Type**: Mach-O 64-bit x86_64 executable
- **Size**: ~21MB
- **Language**: Rust
- **Build Date**: 2022 (based on dependency versions)
- **Source Path**: `/Users/runner/work/eth2move/eth2move/`

## Architecture Overview

The e2m tool is a **bytecode-to-bytecode** translator, NOT a source-to-source transpiler. It works with:
- **Input**: EVM bytecode (compiled Solidity `.bin` files + ABI `.abi` files)
- **Output**: Move bytecode (compiled `.mv` files)

### Translation Pipeline

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ EVM Bytecode│────▶│     HIR     │────▶│     MIR     │────▶│Move Bytecode│
│ (.bin + abi)│     │(High-Level) │     │ (Mid-Level) │     │   (.mv)     │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
        │                  │                  │                    │
        │                  │                  │                    │
   translator/eth/    translator/eth/    translator/eth/     translator/mv/
   src/abi/           src/bytecode/hir/  src/bytecode/mir/   src/mv_ir/
```

### Module Structure (from binary strings)

```
translator/
├── eth/                          # EVM bytecode handling
│   ├── src/
│   │   ├── abi/                  # ABI parsing
│   │   │   ├── mod.rs            # Input/output mapping
│   │   │   └── call.rs           # Call parameter splitting
│   │   ├── bytecode/
│   │   │   ├── hir/              # High-level IR
│   │   │   │   ├── executor/     # HIR execution
│   │   │   │   │   ├── math.rs   # Math operations
│   │   │   │   │   ├── memory.rs # Memory operations
│   │   │   │   │   ├── storage.rs# Storage ops (SLOAD/SSTORE)
│   │   │   │   │   ├── event.rs  # Event emission
│   │   │   │   │   ├── call.rs   # External calls
│   │   │   │   │   ├── code.rs   # Code operations
│   │   │   │   │   ├── control_flow.rs
│   │   │   │   │   └── dependency.rs
│   │   │   │   ├── ir.rs         # HIR data structures
│   │   │   │   ├── vars.rs       # Variable tracking
│   │   │   │   └── stack.rs      # Stack simulation
│   │   │   ├── mir/              # Mid-level IR
│   │   │   │   ├── translation/
│   │   │   │   │   └── variables.rs
│   │   │   │   └── ir/
│   │   │   │       └── debug.rs
│   │   │   ├── ops.rs            # EVM opcode definitions
│   │   │   └── tracing/          # Execution tracing
│   │   │       ├── exec.rs
│   │   │       └── tracer.rs
│   │   ├── lib.rs
│   │   └── vm.rs                 # EVM virtual machine
│   └── ...
├── mv/                           # Move bytecode generation
│   ├── src/
│   │   ├── mv_ir/                # Move IR
│   │   │   ├── crop/             # Code optimization
│   │   │   │   ├── mod.rs
│   │   │   │   └── access.rs
│   │   │   └── interface.rs      # Type interfaces
│   │   ├── translator/
│   │   │   ├── mod.rs
│   │   │   └── writer.rs         # Bytecode writer
│   │   └── ...
│   └── ...
└── me/                           # Move executor
    ├── src/
    │   ├── lib.rs
    │   ├── stdlib.rs             # Standard library handling
    │   ├── resolver/             # Resource resolution
    │   │   ├── mod.rs
    │   │   └── print_access_path.rs
    │   └── load/                 # Module/resource loading
    │       └── mod.rs
    └── ...
```

## EVM Opcodes Supported

### Arithmetic Operations
- `Add`, `Sub`, `Mul`, `Div`, `SDiv`, `Mod`, `SMod`
- `Exp` (exponentiation)
- `AddMod`, `MulMod` (modular arithmetic)
- `SignExtend`

### Comparison & Bitwise
- `Lt`, `Gt`, `SLt`, `SGt`, `Eq`
- `IsZero`, `Not`
- `And`, `Or`, `Xor`
- `Byte`, `Shl`, `Shr`, `Sar`

### Memory Operations
- `MLoad`, `MStore`, `MStore8`
- `SLoad`, `SStore` (storage)

### Control Flow
- `Jump`, `JumpI`
- `Stop`, `Return`, `Revert`

### Stack Operations
- `Push1-Push32`
- `Dup1-Dup16`
- `Swap1-Swap16`
- `Pop`

### Environment
- `block_timestamp()`, `block_height()`, `block_hash()`
- `gas_limit()`, `gas_price()`
- `Address`, `Caller`, `CallValue`

### Events
- `Log0-Log4` (event emission)

### Limitations Found
- `CodeCopy` - marked as "not implemented"
- Dynamic jumps - "Unsupported dynamic jump"
- Some features marked "not yet implemented"

## Dependencies (Outdated)

### Aptos Core
```
aptos-core @ commit 23d258d1f2440267f866eeb27f9830be48682af8
Path: /Users/runner/.cargo/git/checkouts/aptos-core-8f3268fcf79e1f38/23d258d/
```

This is from **late 2022** (Aptos mainnet launch era).

### Move VM
```
move @ commit a6e1ffb
Path: /Users/runner/.cargo/git/checkouts/move-0639dd674f581c30/a6e1ffb/
```

Components used:
- `move-vm/runtime` - VM execution
- `move-core/types` - Core types
- `move-binary-format` - Bytecode format
- `move-bytecode-verifier` - Verification

### EVM Crate
```
evm @ commit b4c0559
Path: /Users/runner/.cargo/git/checkouts/evm-4e989074ef230ca4/b4c0559/
```

### Other Dependencies (versions from 2022)
- `reqwest` 0.11.13
- `serde` 1.0.147
- `serde_json` 1.0.87
- `tokio` 1.21.2
- `http` 0.2.8
- Rust 1.65.x (based on `/rustc/e9493d63c2a57b91556dccd219e21821432c7445/`)

## What's Outdated

### 1. Move Language Version
The binary targets **Move 1.x** (pre-Move 2.0). Missing support for:
- **Enums** - Move 2.0 feature
- **Signed integers** (i8-i256) - Move 2.3 feature
- **Receiver-style calls** (`value.method()`)
- **Index notation** (`table[key]`)
- **Function values/closures**
- **Optional acquires**
- **Compound assignments** (`x += 1`)

### 2. Aptos Framework
The binary uses Aptos Framework from 2022:
- Old module paths (pre-reorganization)
- Missing modern modules like `aptos_framework::primary_fungible_store`
- Old event system (pre-module events)
- Missing Object model support

### 3. Type System
Move types in the binary:
```move
vector<u8>, address, bool, u128, U256
```

Missing modern types:
- `u256` (native, not the `U256` module type)
- `i8`, `i16`, `i32`, `i64`, `i128`, `i256`
- `String` from `std::string`
- Modern `Table` syntax

### 4. CLI/API Changes
The binary uses:
```
$ aptos init
$ aptos init --profile <NameProfile>
```

Modern Aptos CLI has different command structure and options.

### 5. REST API
Uses old API paths:
- `/v1/accounts/` - old format
- `/v1/tables/` - old format

### 6. Output Format
Generates **compiled bytecode** (.mv files), not human-readable source code.

## Key Architectural Differences

### e2m (Pontem) vs Our Transpiler

| Aspect | e2m (Pontem) | Our Transpiler |
|--------|--------------|----------------|
| Input | EVM bytecode (.bin) | Solidity source (.sol) |
| Output | Move bytecode (.mv) | Move source (.move) |
| Approach | Bytecode translation | AST transformation |
| IR Stages | HIR → MIR → Move bytecode | Solidity AST → IR → Move AST |
| Readability | Binary output | Human-readable |
| Debugging | Difficult | Easy |
| Maintainability | Tied to bytecode formats | Works with language changes |
| Move Version | Move 1.x | Move 2.0+ |

### Why Source-to-Source is Better

1. **Readable Output**: Developers can review, audit, and modify the generated code
2. **Easier Debugging**: Source maps and clear correspondence between input/output
3. **Future-Proof**: Less dependent on bytecode format changes
4. **Better Error Messages**: Can provide Solidity line numbers for issues
5. **Optimization Opportunities**: Compiler can optimize the generated source
6. **Move 2.0 Features**: Can leverage new language features directly

## Reconstruction Insights

To replicate e2m's functionality in a modern source-to-source transpiler:

### EVM → Move Mappings (from binary analysis)

1. **Storage Model**
   - EVM: 256-bit slots accessed by `SLOAD`/`SSTORE`
   - Move: Resources with typed fields

2. **Memory Model**
   - EVM: Linear byte array with `MLOAD`/`MSTORE`
   - Move: Typed local variables

3. **Events**
   - EVM: `LOG0-LOG4` with topics
   - Move: `event::emit()` with struct

4. **Calls**
   - EVM: `CALL`, `STATICCALL`, `DELEGATECALL`
   - Move: Module function calls

5. **Math**
   - EVM: 256-bit arithmetic with overflow
   - Move: Fixed-width types with abort on overflow

### CLI Commands (from binary)
```
convert    - Convert sol to move binary
run        - Run a Move function
list       - List resources/modules
```

## Recommendations

1. **Continue source-to-source approach** - More maintainable and produces readable output
2. **Target Move 2.0+** - Leverage modern features for better Solidity compatibility
3. **Use Aptos Framework 2024** - Current mainnet version with modern APIs
4. **Focus on Solidity patterns** - Transform common patterns, not low-level opcodes
5. **Generate human-readable code** - Essential for auditing and debugging

## Files Referenced in Binary

Key source files found in binary strings:
- `cli/e2m/src/convert/mod.rs` - Main conversion logic
- `cli/e2m/src/convert/deploy.rs` - Deployment handling
- `cli/e2m/src/profile.rs` - Profile management
- `cli/e2m/src/resources/mod.rs` - Resource queries
- `cli/e2m/src/resources/decode.rs` - Resource decoding
- `translator/eth/src/lib.rs` - EVM translation entry
- `translator/mv/src/translator/mod.rs` - Move generation
- `translator/me/src/lib.rs` - Move executor
