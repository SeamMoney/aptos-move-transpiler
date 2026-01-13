# Pontem e2m Binary - Detailed Reverse Engineering Analysis

## Tool Used
- **rizin** v0.8.1 - Open-source reverse engineering framework (fork of radare2)

## Binary Overview
```
File:     e2m v0.0.5
Type:     Mach-O 64-bit x86_64
Size:     22.3 MB (0x015640b0 bytes)
Language: Rust
OS:       macOS/darwin
PIE:      Yes
Stripped: No (symbols preserved)
```

## Architecture: Three-Stage Translation Pipeline

The e2m binary implements a **bytecode-to-bytecode** translator with three distinct intermediate representations:

```
┌──────────────┐    ┌─────────┐    ┌─────────┐    ┌──────────────┐
│ EVM Bytecode │───▶│   HIR   │───▶│   MIR   │───▶│Move Bytecode │
│  (.bin+.abi) │    │         │    │         │    │    (.mv)     │
└──────────────┘    └─────────┘    └─────────┘    └──────────────┘
       │                 │              │                │
  ethabi crate    HirBuilder     MirTranslator    MvIrTranslator
```

## Key Functions Discovered (via Symbol Analysis)

### 1. Main Entry Point
```
translator::translate::h6b2ef9cf03b9986b          @ 0x100890ad0
  └── eth::transpile_program::h93ba32d52fe46dc8  (main transpilation)
```

### 2. HIR Stage (High-Level IR)
```
eth::bytecode::hir::HirBuilder::new              @ 0x1009cf150
eth::bytecode::hir::HirBuilder::translate_fun    @ 0x1009cf4d0
eth::bytecode::hir::HirBuilder::dup              @ 0x1009d1300
eth::bytecode::hir::ir::Hir::assign              @ 0x100991430
eth::bytecode::hir::ir::_Expr::resolve           @ 0x100990ea0
eth::bytecode::hir::stack::Stack::dup            @ 0x1009cf090
eth::bytecode::hir::stack::Stack::pop_vec        @ 0x1009cee90
eth::bytecode::hir::vars::Vars::set              @ 0x1009989b0
eth::bytecode::hir::context::Context::new        @ 0x1009c1850
eth::bytecode::hir::context::Context::create_loop @ 0x1009c1ae0
```

### 3. EVM Instruction Handlers (HIR Level)
Each EVM opcode category has a dedicated handler:

#### Arithmetic Operations
```
<eth::bytecode::hir::executor::math::BinaryOp as InstructionHandler>::handle  @ 0x1009a7820
<eth::bytecode::hir::executor::math::UnaryOp as InstructionHandler>::handle   @ 0x1009a7690
<eth::bytecode::hir::executor::math::TernaryOp as InstructionHandler>::handle @ 0x1009a9050
eth::bytecode::hir::executor::math::BinaryOp::calc                            @ 0x1009a7ef0
eth::bytecode::hir::executor::math::TernaryOp::calc                           @ 0x1009a95c0
```

Supported operations (from disassembly):
- Binary: Add, Sub, Mul, Div, SDiv, Mod, SMod, Exp, Lt, Gt, SLt, SGt, Eq, And, Or, Xor, Byte, Shl, Shr, Sar
- Unary: Not, IsZero, SignExtend
- Ternary: AddMod, MulMod

#### Memory Operations
```
<eth::bytecode::hir::executor::memory::MemoryOp as InstructionHandler>::handle @ 0x10098b1f0
```
Handles: MLoad, MStore, MStore8

#### Storage Operations
```
<eth::bytecode::hir::executor::storage::StorageOp as InstructionHandler>::handle @ 0x1009ceb10
```
Handles: SLoad, SStore - Maps to Move's global storage via `borrow_global`/`move_to`

#### Stack Operations
```
<eth::bytecode::hir::executor::stack::StackOp as InstructionHandler>::handle @ 0x100998880
```
Handles: Push1-Push32, Dup1-Dup16, Swap1-Swap16, Pop

#### Control Flow
```
<eth::bytecode::hir::executor::control_flow::ControlFlow as InstructionHandler>::handle @ 0x100997190
```
Handles: Jump, JumpI, Stop, Return, Revert

#### External Calls
```
<eth::bytecode::hir::executor::call::CallOp as InstructionHandler>::handle @ 0x1009b8f40
```
Handles: Call, StaticCall, DelegateCall, Create, Create2

#### Event Emission
```
<eth::bytecode::hir::executor::event::EventOp as InstructionHandler>::handle @ 0x10098ae20
```
Handles: Log0, Log1, Log2, Log3, Log4

#### Hash Operations
```
<eth::bytecode::hir::executor::dependency::Sha3 as InstructionHandler>::handle @ 0x1009979e0
```
Handles: Keccak256 (SHA3)

#### Transaction/Block Context
```
<eth::bytecode::hir::executor::dependency::TxMeta as InstructionHandler>::handle   @ 0x100997db0
<eth::bytecode::hir::executor::dependency::Address as InstructionHandler>::handle  @ 0x100997cb0
```
Handles: msg.sender, msg.value, block.timestamp, block.number, etc.

#### Code Operations
```
<eth::bytecode::hir::executor::code::CodeOp as InstructionHandler>::handle @ 0x1009c2e70
```
Handles: CodeCopy, CodeSize, ExtCodeCopy, ExtCodeSize (partially - marked "not implemented" in strings)

### 4. MIR Stage (Mid-Level IR)
```
eth::bytecode::mir::translation::MirTranslator::new                      @ 0x1009a09f0
eth::bytecode::mir::translation::MirTranslator::translate                @ 0x1009a1220
eth::bytecode::mir::translation::expr::translate_expr                    @ 0x10099d5e0
eth::bytecode::mir::translation::cast::cast_expr                         @ 0x10099d3b0
eth::bytecode::mir::translation::math::translate_binary_op               @ 0x10099f3b0
eth::bytecode::mir::translation::math::translate_ternary_op              @ 0x10099fd00
eth::bytecode::mir::translation::math::unary_with_num                    @ 0x1009a0460
eth::bytecode::mir::translation::math::unary_with_bool                   @ 0x1009a0690
eth::bytecode::mir::translation::variables::Variable::index              @ 0x1009bb800
eth::bytecode::mir::translation::variables::Variables::borrow            @ 0x1009bb3e0
eth::bytecode::mir::translation::variables::Variables::borrow_param      @ 0x1009bb7d0
eth::bytecode::mir::translation::variables::Variables::release           @ 0x1009bb660
eth::bytecode::mir::ir::expression::Expression::ty                       @ 0x1009d1ba0
eth::bytecode::mir::ir::expression::Cast::make                           @ 0x1009d1c40
eth::bytecode::mir::ir::Mir::statements                                  @ 0x1009bb3c0
eth::bytecode::mir::ir::Mir::locals                                      @ 0x1009bb3d0
eth::bytecode::mir::constructor::make_constructor                        @ 0x1009b45d0
eth::bytecode::mir::ir::debug::print_ir                                  @ 0x1009c30e0
```

### 5. Move IR Stage (Final Translation)
```
mv::translator::MvIrTranslator::new                @ 0x1008b35d0
mv::translator::MvIrTranslator::translate          @ 0x1008b3920
mv::translator::MvIrTranslator::translate_func     @ 0x1008b43c0
mv::translator::MvIrTranslator::translate_statements @ 0x1008b49d0
mv::translator::MvIrTranslator::translate_expr     @ 0x1008b5530
mv::translator::MvIrTranslator::call               @ 0x1008b5f80 (multiple variants)
mv::translator::writer::Code::write                @ 0x1008a6870
mv::translator::writer::Code::jmp                  @ 0x1008a6910
mv::translator::writer::Code::freeze               @ 0x1008a69d0
mv::translator::bytecode::abort                    @ 0x1008a6760
mv::translator::signature::SignatureWriter::new    @ 0x1008a89e0
mv::translator::signature::SignatureWriter::make_signature @ 0x1008a8b70
mv::translator::signature::map_type                @ 0x1008a8890
mv::translator::identifier::IdentifierWriter::make_identifier @ 0x1008ba3c0
```

### 6. Intrinsic Functions (Move Runtime Helpers)
```
intrinsic::table::self_address_index   @ 0x10091fc00
intrinsic::table::U256::token          @ 0x10091fbd0
intrinsic::table::Memory::token        @ 0x10091fae0
intrinsic::table::Persist::token       @ 0x10091fb10
intrinsic::table::Persist::instance    @ 0x10091fba0
intrinsic::template                    @ 0x100921a40
intrinsic::toml_template               @ 0x100921950
<intrinsic::table::Info as Function>::handler    @ 0x10091fbe0
<intrinsic::table::U256 as Function>::handler    @ 0x10091fbb0
<intrinsic::table::Memory as Function>::handler  @ 0x10091fac0
<intrinsic::table::Persist as Function>::handler @ 0x10091faf0
```

## Type System

### Ethereum Types (`eth::bytecode::types::EthType`)
```
<EthType as TryFrom<&ethabi::param::Param>>::try_from @ 0x10098c2a0
```
Converts Ethereum ABI types to internal representation.

### MIR Types (`eth::bytecode::mir::ir::types::SType`)
```
<SType as Debug>::fmt   @ 0x1009b52f0
<SType as Display>::fmt @ 0x1009b51e0
```
Intermediate type representation.

### Move Types (`move_binary_format::file_format::SignatureToken`)
```
SignatureToken::is_integer              @ 0x100951150
SignatureToken::is_reference            @ 0x100951170
SignatureToken::is_mutable_reference    @ 0x100951190
SignatureToken::is_valid_for_constant   @ 0x1009511a0
```
Final Move bytecode type representation.

## Storage Pattern

The binary uses a special storage abstraction:

1. **Persist** (`intrinsic::table::Persist`) - For persistent storage (SLOAD/SSTORE)
   - Maps EVM's 256-bit storage slots to Move's global storage
   - Uses `borrow_global_mut` for writes, `borrow_global` for reads

2. **Memory** (`intrinsic::table::Memory`) - For temporary memory (MLOAD/MSTORE)
   - Maps EVM's linear memory model to Move vectors

3. **U256** (`intrinsic::table::U256`) - For 256-bit integer operations
   - Uses `primitive_types::U256` crate for math
   - Maps to Move's u256 type (or custom struct for older Move)

## Disassembly Insights

### BinaryOp::calc (Math Operations)
The `eth::bytecode::hir::executor::math::BinaryOp::calc` function at `0x1009a7ef0`:
- Uses a jump table (at `0x1009a8ff0`) to dispatch to operation handlers
- Handles 256-bit arithmetic using SSE/XMM registers
- Calls `primitive_types::U256` methods for operations
- Example flow: `Shr` operation → `U256::as_usize` → `Shr::shr` trait method

### StorageOp Handler
The storage handler at `0x1009ceb10`:
- First byte determines operation type (0 = SLoad, 1 = SStore)
- Pops stack elements for key/value
- Builds Persist intrinsic calls for Move bytecode

### Main Translate Function
The entry at `0x100890ad0`:
1. Parses JSON ABI via `serde_json::de::from_str`
2. Extracts bytecode and constructor args
3. Calls `eth::transpile_program` for main translation
4. Handles module deployment parameters

## Limitations Found (from strings and disassembly)

1. **"not yet implemented"** - Found in CodeOp handler, delegatecall handling
2. **"Unsupported dynamic jump"** - Dynamic jump destinations not supported
3. **"not implemented: CodeCopy"** - Code copying not fully supported
4. **"unsupported dynamic types"** - Some type inference limitations

## Outdated Components

### Dependencies (from embedded paths)
```
aptos-core    @ commit 23d258d (2022)
move          @ commit a6e1ffb (Move 1.x)
evm           @ commit b4c0559 (2022)
reqwest       @ 0.11.13
serde         @ 1.0.147
tokio         @ 1.21.2
Rust          @ 1.65.x
```

### Missing Modern Features
- No Move 2.0 enum support
- No signed integers (i8-i256)
- No receiver-style calls
- No index notation for tables
- No optional acquires
- Old event system (pre-module events)
- No Object model support

## Reconstructed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI (cli/e2m/src/)                     │
│  convert/mod.rs, convert/deploy.rs, profile.rs, resources/  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Translator (translator/)                     │
├─────────────────────────────────────────────────────────────┤
│  eth/                                                        │
│  ├── src/abi/           - ABI parsing (ethabi)              │
│  ├── src/bytecode/                                          │
│  │   ├── hir/           - High-level IR                     │
│  │   │   ├── executor/  - EVM opcode handlers               │
│  │   │   │   ├── math.rs      (BinaryOp, UnaryOp, TernaryOp)│
│  │   │   │   ├── memory.rs    (MLoad, MStore)               │
│  │   │   │   ├── storage.rs   (SLoad, SStore)               │
│  │   │   │   ├── stack.rs     (Push, Dup, Swap, Pop)        │
│  │   │   │   ├── call.rs      (Call, Create)                │
│  │   │   │   ├── event.rs     (Log0-Log4)                   │
│  │   │   │   ├── control_flow.rs (Jump, Return)             │
│  │   │   │   └── dependency.rs   (msg.sender, block.*)      │
│  │   │   ├── ir.rs      - HIR data structures               │
│  │   │   ├── vars.rs    - Variable tracking                 │
│  │   │   └── stack.rs   - Stack simulation                  │
│  │   └── mir/           - Mid-level IR                      │
│  │       ├── translation/                                   │
│  │       │   ├── expr.rs    - Expression translation        │
│  │       │   ├── math.rs    - Math op translation           │
│  │       │   ├── cast.rs    - Type casting                  │
│  │       │   └── variables.rs - Variable management         │
│  │       └── ir/                                            │
│  │           ├── expression.rs                              │
│  │           ├── statement.rs                               │
│  │           └── types.rs (SType)                           │
│  └── src/vm.rs          - EVM simulation                    │
├─────────────────────────────────────────────────────────────┤
│  mv/                                                         │
│  ├── src/translator/                                        │
│  │   ├── mod.rs         - MvIrTranslator                    │
│  │   ├── writer.rs      - Bytecode writer (Code struct)     │
│  │   ├── signature.rs   - Type signatures                   │
│  │   ├── identifier.rs  - Identifier handling               │
│  │   └── bytecode.rs    - Move bytecode generation          │
│  └── src/mv_ir/                                             │
│      ├── crop/          - Code optimization                 │
│      └── interface.rs   - Type interfaces                   │
├─────────────────────────────────────────────────────────────┤
│  me/                    - Move Executor                      │
│  ├── src/lib.rs                                             │
│  ├── src/stdlib.rs      - Standard library paths            │
│  ├── src/resolver/      - Resource resolution               │
│  └── src/load/          - Module/resource loading           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Output: Move Bytecode (.mv)                     │
│         (move_binary_format::file_format)                    │
└─────────────────────────────────────────────────────────────┘
```

## Key Differences from Our Source-to-Source Approach

| Aspect | e2m (Bytecode) | Our Transpiler (Source) |
|--------|----------------|-------------------------|
| Input | Compiled EVM bytecode | Solidity source code |
| Output | Move bytecode (.mv) | Move source (.move) |
| Readability | Binary, not auditable | Human-readable |
| Debugging | Very difficult | Source maps possible |
| Move Version | 1.x (outdated) | 2.0+ (modern) |
| Maintenance | Tied to bytecode formats | Language-level |
| Optimizations | Compiler handles | Can leverage Move 2 |

## Conclusion

The e2m binary is a sophisticated bytecode translator that:
1. Parses EVM bytecode and ABI
2. Simulates EVM execution to build HIR
3. Transforms HIR to a mid-level IR (MIR)
4. Generates Move bytecode from MIR

However, it's fundamentally limited because:
1. It works at the bytecode level, losing source-level semantics
2. Uses outdated Move 1.x bytecode format
3. Cannot leverage Move 2.0 language features
4. Produces binary output that can't be audited or modified

Our source-to-source approach is superior for producing maintainable, auditable Move code.
