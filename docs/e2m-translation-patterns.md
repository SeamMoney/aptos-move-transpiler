# EVM to Move Translation Patterns (from e2m Reverse Engineering)

This document details the actual translation patterns used by Pontem's e2m tool, extracted via reverse engineering with rizin.

## 1. Type Mapping (`mv::translator::signature::map_type`)

From disassembly of `map_type` at `0x1008a8890`:

```
EVM/Solidity Type → Move SignatureToken

uint8-uint64     → U8, U64       (SignatureToken codes 1, 3)
uint128          → U128          (SignatureToken code 4)
uint256          → U256 struct   (calls intrinsic::table::U256::token)
bool             → Bool          (SignatureToken code 0)
address          → Address       (SignatureToken code 5)
bytes/bytes32    → Vector<U8>    (SignatureToken code 6)
mapping          → Table/Struct  (SignatureToken code 9)
```

The function uses a **jump table** at `0x1008a89c4` to dispatch based on the first byte of the type enum.

### U256 Handling
For `uint256`, the tool calls `intrinsic::table::U256::token()` at `0x1008a8964`, which returns a custom struct type (not native `u256` since Move 1.x didn't have it).

## 2. Storage Operations (SLOAD/SSTORE)

From `StorageOp::handle` at `0x1009ceb10`:

### SLOAD (Storage Read)
```
EVM:  SLOAD(key)

Pattern:
1. Pop key from stack (72 bytes = 0x48 for expression struct)
2. Build Persist intrinsic call
3. Generate: borrow_global<Storage>(@self).slots[key]
```

### SSTORE (Storage Write)
```
EVM:  SSTORE(key, value)

Pattern:
1. Pop value and key from stack
2. Check if first byte of opcode is 0 (SLoad) or 1 (SStore)
3. Build Persist::instance call
4. Generate: borrow_global_mut<Storage>(@self).slots[key] = value
```

The function checks `cmp byte [rsi], 0` at `0x1009ceb31` to determine load vs store.

### Storage Struct Pattern
The tool generates a "Persist" struct for storage:
```move
struct Storage has key {
    slots: Table<u256, u256>  // EVM's 256-bit key-value storage
}
```

## 3. Math Operations (BinaryOp/UnaryOp/TernaryOp)

From `BinaryOp::calc` at `0x1009a7ef0`:

### Binary Operations Jump Table
Uses a jump table at `0x1009a8ff0` with entries for each operation:

```
Opcode  | EVM        | Move Translation
--------|------------|------------------
0x01    | ADD        | a + b (with overflow check)
0x02    | MUL        | a * b
0x03    | SUB        | a - b
0x04    | DIV        | a / b
0x05    | SDIV       | (signed division)
0x06    | MOD        | a % b
0x07    | SMOD       | (signed mod)
0x08    | ADDMOD     | (a + b) % n
0x09    | MULMOD     | (a * b) % n
0x0a    | EXP        | pow(a, b) - loop-based
0x10    | LT         | a < b
0x11    | GT         | a > b
0x12    | SLT        | (signed less than)
0x13    | SGT        | (signed greater than)
0x14    | EQ         | a == b
0x16    | AND        | a & b
0x17    | OR         | a | b
0x18    | XOR        | a ^ b
0x1b    | SHL        | a << b
0x1c    | SHR        | a >> b
0x1d    | SAR        | (arithmetic shift right)
```

### 256-bit Arithmetic
Uses SSE/XMM registers for 256-bit operations:
```asm
movdqu xmm0, xmmword [rax]      ; Load lower 128 bits
movdqu xmm1, xmmword [rax + 0x10] ; Load upper 128 bits
```

Calls `primitive_types::U256` methods for actual math:
- `U256::as_usize` for shift amounts
- `Shr::shr` trait for right shift
- `Ord::cmp` for comparisons

## 4. Event Emission (LOG0-LOG4)

From `EventOp::handle` at `0x10098ae20`:

### Pattern
```
EVM:  LOG{n}(offset, length, topic0, ..., topic{n-1})

Steps:
1. Pop topics from stack (0x48 bytes each = expression struct)
2. Clone topic expressions via Loc::clone
3. Build memory read for data: Memory[offset..offset+length]
4. Generate event struct with topics as fields
5. Call event::emit(EventStruct { ... })
```

The number of topics is determined by `r12` register which holds the topic count:
- `cmp r12, 1` at `0x10098ae60` checks if LOG0 (no topics)
- Topics are 72 bytes each (`add r13, 0x48` at `0x10098af55`)

### Generated Move Code Pattern
```move
#[event]
struct LogEvent has drop, store {
    topic0: vector<u8>,
    topic1: vector<u8>,
    // ...
    data: vector<u8>
}

event::emit(LogEvent { topic0, topic1, data })
```

## 5. Control Flow (Jump/Branch)

From `ControlFlow::handle` at `0x100997190`:

### Jump Translation
```
EVM:  JUMP(dest)     → Branch (unconditional)
      JUMPI(dest, c) → BrTrue/BrFalse (conditional)
      STOP           → Ret (return)
      RETURN         → Ret with value
      REVERT         → Abort with error code
```

### Branch Pattern
```move
// JUMPI translation
if (condition) {
    // jump to label
} else {
    // fall through
}
```

## 6. Memory Operations

From `MemoryOp::handle` at `0x10098b1f0`:

### Pattern
```
EVM Memory Model:
- Linear byte array
- MLOAD: read 32 bytes from offset
- MSTORE: write 32 bytes to offset
- MSTORE8: write 1 byte to offset

Move Translation:
- Uses vector<u8> as memory
- intrinsic::table::Memory for operations
```

### Generated Code
```move
// Memory struct
struct Memory {
    data: vector<u8>
}

// MLOAD
let value = vector::slice(&memory.data, offset, offset + 32);

// MSTORE
vector::append(&mut memory.data, value);
```

## 7. External Calls

From `CallOp::handle` at `0x1009b8f40`:

### Limitations
External calls are complex because Move doesn't support dynamic dispatch:

```
EVM:  CALL(gas, addr, value, argsOffset, argsLen, retOffset, retLen)
      STATICCALL(...)
      DELEGATECALL(...)

Translation:
- Static calls → Direct module function calls
- DELEGATECALL → Not fully supported (requires capability pattern)
- CREATE/CREATE2 → Factory pattern with fixed addresses
```

## 8. Transaction Context (msg.sender, block.*)

From `TxMeta::handle` at `0x100997db0` and `Address::handle` at `0x100997cb0`:

### Mappings
```
EVM Global          | Move Translation
--------------------|------------------
msg.sender          | signer::address_of(account)
msg.value           | (not directly supported)
block.timestamp     | timestamp::now_seconds()
block.number        | block::get_current_block_height()
block.difficulty    | (not available)
tx.origin           | signer::address_of(account)
tx.gasprice         | (not available)
address(this)       | @self (module address)
```

## 9. Intrinsic Functions

The tool uses special "intrinsic" modules for EVM-specific operations:

### intrinsic::table::Persist
- Handles persistent storage (SLOAD/SSTORE)
- Maps to Move's global storage via `borrow_global`

### intrinsic::table::Memory
- Handles EVM memory model
- Maps to `vector<u8>` operations

### intrinsic::table::U256
- Provides 256-bit integer operations
- Wraps `primitive_types::U256`

### intrinsic::table::Info
- Provides contract metadata
- Address, code size, etc.

## 10. Constructor Handling

From `mir::constructor::make_constructor` at `0x1009b45d0`:

### Pattern
```
Solidity:
constructor(args) {
    state = initial_value;
}

Move:
fun init_module(deployer: &signer) {
    move_to(deployer, Storage {
        slots: table::new()
    });
}
```

## Key Observations

### 1. Bytecode-Level Translation
The tool works at **EVM bytecode level**, not source level:
- Loses variable names
- Loses type information (everything is u256)
- Loses structure (functions become bytecode blocks)

### 2. Stack Machine Simulation
HIR stage simulates EVM stack machine:
- `Stack::pop_vec` pops N items
- `Stack::dup` duplicates items
- `Vars::set` assigns to virtual registers

### 3. Intermediate Representations
```
EVM Bytecode
    ↓
HIR (High-level IR)
  - Preserves stack semantics
  - Resolves jump targets
  - Builds control flow graph
    ↓
MIR (Mid-level IR)
  - Converts stack to SSA-like form
  - Types expressions
  - Builds function structure
    ↓
Move Bytecode
  - Maps MIR to Move opcodes
  - Generates signatures
  - Builds module structure
```

### 4. Why Source-to-Source is Better

Our approach (Solidity source → Move source) has advantages:

| Aspect | e2m (Bytecode) | Our Transpiler |
|--------|----------------|----------------|
| Variable names | Lost (var_0, var_1) | Preserved |
| Types | All u256 | Proper types |
| Structure | Flat bytecode | Clean functions |
| Readability | None | Human-readable |
| Debugging | Very hard | Source maps |
| Optimization | Limited | Move compiler |
