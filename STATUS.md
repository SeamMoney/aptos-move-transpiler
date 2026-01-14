# Solidity to Aptos Move Transpiler - Status

## Current State (January 2025)

**All 173 tests passing** - The transpiler successfully handles basic to moderate complexity Solidity contracts.

### Verified Working
- **Counter contract**: Compiles with `aptos move compile`
- **SimpleStorage**: Compiles with `aptos move compile`
- **ERC-20 with Fungible Asset**: Compiles with `aptos move compile`

### Feature Coverage

Based on comprehensive analysis of 125 Solidity features:
- **57% fully implemented** (71 features)
- **15% partially implemented** (19 features)
- **28% not implemented** (35 features - some fundamentally impossible in Move)

---

## What's Complete (Phase 1)

### Math Helpers (`src/stdlib/evm_compat.move`)
- `sqrt(u256)` - Babylonian method for AMM liquidity
- `mulDiv(a, b, c)` - Overflow-safe (a*b)/c
- `mulDivRoundingUp` - Ceiling division variant
- `exp_u256` - Exponentiation
- `addmod`, `mulmod` - Modular arithmetic
- `keccak256`, block timestamp/number helpers

### Core Transpilation
- Types: uint8-256, int8-256, bool, address, bytes, string, arrays, mappings, structs, enums
- Functions: public/private/internal/external visibility, view/pure modifiers
- Control flow: if/else, for, while, do-while, break, continue
- Error handling: require, assert, revert, custom errors
- Events: Full support with `#[event]` structs
- Modifiers: onlyOwner, nonReentrant, whenNotPaused, custom modifiers

### Recent Fixes (This Session)
1. **Error constant generation** - Now includes dynamically discovered error codes
2. **Named return parameters** - Automatic return statement generation
3. **Private function signatures** - No unnecessary signer parameter
4. **View function state borrowing** - Proper handling of tuple returns
5. **`this` keyword** - Correctly converts to module address
6. **`address(this)` conversion** - No redundant type conversion calls

---

## What's Left (Future Phases)

### Phase 2: Inheritance & Libraries (HIGH Priority)
- [ ] Fix C3 linearization for proper parent ordering
- [ ] Merge inherited functions with override resolution
- [ ] Flatten library calls (inline library functions)
- [ ] Handle `using X for Y` syntax
- [ ] Handle `super.method()` calls

### Phase 3: Fungible Asset Integration (HIGH Priority)
- [ ] Detect ERC-20 pattern in Solidity code
- [ ] Generate FA initialization boilerplate
- [ ] Map `transfer()` to `fungible_asset::transfer`
- [ ] Map `approve()` to FA allowance pattern
- [ ] Map `balanceOf()` to `primary_fungible_store::balance`
- [ ] Store MintRef/BurnRef capabilities

### Phase 4: Resource Account Pattern (HIGH Priority)
- [ ] Create resource account with `account::create_resource_account`
- [ ] Store SignerCapability in state struct
- [ ] Use resource signer for protocol operations
- [ ] Support dynamic module addresses (not hardcoded @0x1)

### Phase 5: Fail-Fast Errors (MEDIUM Priority)
- [ ] Detect `delegatecall` - FAIL with clear error
- [ ] Detect inline assembly - FAIL with clear error
- [ ] Detect proxy patterns - FAIL with clear error
- [ ] Detect `receive()`/`fallback()` - FAIL with clear error
- [ ] Detect `try/catch` - FAIL with clear error

### Phase 6: Compilation Validation (MEDIUM Priority)
- [ ] Add `aptos move compile` step to integration tests
- [ ] CI/CD integration for automated validation
- [ ] Generate Move.toml automatically for all outputs

### Known Limitation: Borrow Checker Conflicts
When a function has an active mutable borrow (`borrow_global_mut`), calling other functions that also acquire the same resource fails. This affects:
- AMM contracts where `mint`/`burn`/`swap` call internal view functions
- Any pattern where external functions call internal state-reading helpers

**Solutions** (not yet implemented):
1. Inline internal function calls when caller has active borrow
2. Pass borrowed state as parameter instead of re-borrowing
3. Restructure to read values before taking mutable borrow

---

## Fundamentally Impossible Features

These Solidity features **cannot** be transpiled due to Move's design:

| Feature | Why Impossible |
|---------|----------------|
| `delegatecall` | Move has no execution context switching |
| Dynamic dispatch | Move is statically typed, no runtime resolution |
| Proxy upgrades | Requires delegatecall |
| `receive()`/`fallback()` | No catch-all function mechanism |
| Inline assembly (Yul) | No low-level bytecode access |
| `selfdestruct` | Move modules are permanent |
| `tx.origin` | Different security model |
| `msg.value` | Different value transfer model |
| Contract factories (`new Contract()`) | No dynamic deployment |

---

## Running Tests

```bash
# Run all tests
npm test

# Test specific contract compilation
npx tsx scripts/test_amm_compile.ts
npx tsx scripts/test_counter.ts

# Manually compile generated Move
cd /tmp/output_dir && aptos move compile
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/transpiler.ts` | Main entry point |
| `src/transformer/contract-transformer.ts` | Contract/inheritance handling |
| `src/transformer/function-transformer.ts` | Function transformation |
| `src/transformer/expression-transformer.ts` | Expression/statement handling |
| `src/codegen/move-generator.ts` | Move code generation |
| `src/stdlib/evm_compat.move` | EVM compatibility helpers |
| `src/mapper/type-mapper.ts` | Solidity to Move type mapping |
