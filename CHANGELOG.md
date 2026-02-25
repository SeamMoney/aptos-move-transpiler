# Changelog

All notable changes to the Sol2Move transpiler are documented in this file.

## [Unreleased] — 2025-02-25

### WASM Move Compiler Integration

- **WASM Move Compiler v2 integration** — Server-side compilation verification via `wasmtime` CLI runtime, bypassing V8's 39-dependency WASI limit
- **Pre-compiled evm_compat bytecode** — `evm_compat_bytecode.json` eliminates recompilation overhead; regenerate via `scripts/precompile-evm-compat.mjs`
- **All 137 framework bytecodes** passed as `precompiled_deps` for full Aptos stdlib coverage
- **`compileCheckModules()`** — New API accepting multiple modules for multi-file compilation verification
- **`compileCheckModulesAsync()`** — Tries wasmtime first, falls back to `aptos move compile` CLI
- **Diagnostic severity normalization** — WASM compiler returns capitalized severity (`"Warning"` not `"warning"`); now handled correctly
- **New test suite** — `wasm-move-compiler.test.ts` covering simple modules, multi-module, error detection, and DeFi contract compilation

### NovaDEX Compilation Fixes (6 bugs + 5 additional)

Fixed 11 compilation-breaking bugs discovered via end-to-end transpilation of NovaDEX, a 755-line production DeFi AMM with staking, governance, flash loans, TWAP oracles, and ERC-20 token mechanics.

#### Fix 1: Pure functions get spurious `state` parameter
- **Root cause:** `stateVarNames` included constants (`PRECISION`, `MINIMUM_LIQUIDITY`, etc.). When a `pure` function body referenced these constants, `stmtReferencesAny` falsely flagged `accessesState = true`.
- **Fix:** Filter constants from state variable name set:
  ```typescript
  flattenedIR.stateVariables.filter(v => v.mutability !== 'constant' && v.mutability !== 'immutable')
  ```
- **File:** `contract-transformer.ts`

#### Fix 2: `E_ZERO_TREASURY` undeclared error constant
- **Root cause:** `context.errorCodes` was not initialized in the context object literal. When `transformConstructor` spread `{ ...context }`, it got `undefined`. Error codes registered during constructor transformation were stored on a new Map, not the shared context.
- **Fix:** Added `errorCodes: new Map()` to context initialization block.
- **File:** `contract-transformer.ts`

#### Fix 3: `keccak256` returns `vector<u8>`, assigned to `u256`
- **Root cause:** `aptos_hash::keccak256(bytes)` returns `vector<u8>`, but Solidity expects `bytes32` → `u256`.
- **Fix:** Wrapped keccak256 result in `evm_compat::bytes_to_u256()` for big-endian byte→u256 conversion. Made `bytes_to_u256` public in `evm_compat` module.
- **Files:** `expression-transformer.ts`, `transpiler.ts`

#### Fix 4: Nested mapping defaults — `&0u256` where `Table` expected
- **Root cause:** `getDefaultForMappingValue` returned scalar defaults even when the value type was `Table<K2,V>`. `Table` lacks `drop`, so `borrow_with_default` can't accept it.
- **Fix:** Added `isNestedMappingValue()` detection. Read path uses `table::borrow` (no default). Write path emits `contains` + `add(table::new())` + `borrow_mut` initialization guard with pre-statements.
- **File:** `expression-transformer.ts`

#### Fix 5: Arithmetic type mismatches (`u256 * u16`)
- **Root cause:** Arithmetic operations didn't harmonize operand types. `pool.swap_fee_bps` (u16) in `amountIn * pool.swapFeeBps` failed with type mismatch.
- **Fix:** Reused `harmonizeComparisonTypes` for arithmetic/bitwise operators (`+`, `-`, `*`, `/`, `%`, `&`, `|`, `^`). Also enhanced `transformMemberAccess` to look up struct field types from `context.structs` and set `inferredType` on field access expressions.
- **File:** `expression-transformer.ts`

#### Fix 6: Copy mutation — local copies not written back
- **Root cause:** `let pool: Pool = *table::borrow_with_default(...)` creates a local copy. Subsequent mutations modify the copy, not the table entry.
- **Fix:** Track table copy origins in `_tableCopyOrigins` map. Mark copies as mutated when their fields are assigned. Inject `table::upsert(&mut state.mapping, key, local)` write-backs before reentrancy unlock and returns.
- **Files:** `expression-transformer.ts`, `function-transformer.ts`

#### Fix 7: Nested mapping copy write-back (positions table)
- **Root cause:** Fix #6 only handled flat mappings. Nested mappings like `positions[poolId][msg.sender]` were not tracked because the double `index_access` AST didn't match the flat detection pattern.
- **Fix:** Added nested index_access detection: when `stmt.initialValue.base` is itself an `index_access`, extract both outer and inner keys. Write-back emits `table::upsert(table::borrow_mut(&mut state.outer, outerKey), innerKey, local)`.
- **Files:** `expression-transformer.ts`, `function-transformer.ts`

#### Fix 8: Duplicate `reentrancy_status` field
- **Root cause:** Solidity `uint256 private reentrancyStatus` was kept as a state variable AND the reentrancy guard injected its own `reentrancy_status: u8`, causing a duplicate field.
- **Fix:** Expanded `REENTRANCY_VAR_NAMES` set to include `reentrancyStatus`, `_reentrancyStatus`, and `reentrancy_status` (snake_case) in both `contract-transformer.ts` and `function-transformer.ts` (which had its own local copy).
- **Files:** `contract-transformer.ts`, `function-transformer.ts`

#### Fix 9: `field_access` on function call result
- **Root cause:** Move doesn't support chaining `.field` on function call results. The pattern `table::borrow_with_default(...).initialized` generated for modifier checks (e.g., `poolExists`) failed with "a reference is expected but `_` was provided".
- **Fix:** In `transformMemberAccess`, detect when the object is a `dereference(borrow_call(...))` and keep the dereference as-is. In the code generator, wrap `dereference` nodes in parentheses when they appear as the object of a `field_access`: `(*borrow_with_default(...)).field`.
- **Files:** `expression-transformer.ts`, `move-generator.ts`

#### Fix 10: Write-back key not transformed to Move
- **Root cause:** `_tableCopyOrigins` stored raw Solidity AST index expressions as keys. When the key was `msg.sender` (a `member_access`), the write-back emitted `/* unsupported expression */` instead of `signer::address_of(account)`.
- **Fix:** Transform the key expression through `transformExpression` at capture time (when the copy origin is recorded), not at emission time.
- **Files:** `expression-transformer.ts`, `function-transformer.ts`

#### Fix 11: State variable `field_access` missing `inferredType`
- **Root cause:** `getExprInferredType()` returned undefined for state variable field access expressions, causing arithmetic type harmonization to skip type casting.
- **Fix:** Set `inferredType` on state variable `field_access` expressions from the variable's type information.
- **File:** `expression-transformer.ts`

### NovaDEX End-to-End Validation

- **Test fixture:** `tests/fixtures/defi/NovaDEX.sol` — 280-line contract exercising all 6 original bugs
- **Original contract:** 755-line NovaDEX with 7 structs, 37 functions, 8 mappings (3 nested), 20 events, 4 modifiers — transpiles and compiles with **0 errors, 0 warnings**
- **Integration tests:** 7 new NovaDEX test cases in `defi-transpilation.test.ts` covering each fix
- **Compilation test:** End-to-end transpile + WASM compile test in `compilation.test.ts` with 120s timeout

### SDK Enhancements

- **`isCompilerAvailable()`** — Check if wasmtime WASM compiler is available
- **`compileCheckModules()`** and `compileCheckModulesAsync()`** — Exported from SDK for programmatic compilation verification
- **Re-exported** from `src/index.ts` for direct imports

### Test Results

- **453 tests passing** across 22 test files
- **0 failures**, 47 skipped (platform-specific)
- Test coverage: unit tests, integration tests, DeFi transpilation, end-to-end compilation

---

## [1.0.0] — 2025-02-15

### SDK & Architecture

- **Unified `Sol2Move` SDK** — Single class exposing all transpilation, parsing, validation, and compilation capabilities
- **Tree-sitter Move parser** — Optional dependency for Move code parsing and syntax validation
- **CLI tool** — `sol2move convert` command for file-based transpilation
- **Tier 2-4 transpilation flags** — 17 configurable code-generation options for fine-grained control

### Transpiler Core

- **Expression-level type inference** — Tracks types through binary ops, casts, function calls, and identifiers
- **Inheritance flattening** — Merges parent contract state, functions, modifiers, and events into a single Move module
- **Cross-contract transpilation** — `contextSources` option resolves cross-file library calls and constants
- **OpenZeppelin library support** — SafeMath inlining, EnumerableSet/EnumerableMap, ReentrancyGuard patterns
- **EVM pattern translation** — `abi.encode` to `bcs::to_bytes`, inline assembly stubs, `type(uint24).max` computed constants
- **Move Specification Language** — Auto-generates MSL specs from Solidity `require` statements and modifiers
- **Fungible Asset mapping** — ERC-20 contracts can target Aptos Fungible Asset standard via `useFungibleAsset` flag
- **Digital Asset mapping** — ERC-721 contracts can target Aptos Digital Asset standard via `useDigitalAsset` flag

### Compiler Integration

- **`aptos move compile`** — Semantic validation tier using Aptos CLI
- **`movefmt`** — Post-processing formatter for generated Move code
- **Format/compile checks** — Optional, doesn't crash if tools unavailable

### DeFi Protocol Support

- **DLMM (Discretized Liquidity Market Maker)** — 17 contract library with complex math, packed uint128, tree math, oracle helpers
- **Uniswap-style AMM** — Constant product formula, LP token mechanics, reentrancy guards
- **Aave/Compound-style Lending** — Markets, interest rates, liquidation, nested mappings
- **Synthetix-style Staking** — Reward calculations, updateReward modifier pattern
- **Yearn-style Vaults** — ERC4626 shares, deposit/withdraw, emergency shutdown, strategy management
- **Gnosis Safe-style MultiSig** — Transaction structs, confirmation flow, owner management

### DLMM Compilation Fixes

Over 40 systemic compilation fixes applied across DLMM library output:
- Move v2.3 builtin constants (no `u256` suffix on literals)
- SCREAMING_SNAKE/camelCase name conversion
- Array allocation stubs
- Type inference for binary operations
- Modifier parameter fixes
- Cross-library constant references
- Nested struct handling
- Enum parameter transpilation

---

## [0.1.0] — 2025-01-28

### Initial Release

- **Solidity parser** — Full Solidity 0.8.x syntax support
- **Move v2 code generation** — Structs, functions, events, modifiers, mappings
- **State variable mapping** — Solidity storage to Move global resource pattern
- **Mapping to Table** — `mapping(K => V)` to `aptos_std::table::Table<K, V>`
- **Event emission** — Solidity events to Move `#[event]` structs with `event::emit()`
- **Modifier inlining** — `onlyOwner`, `nonReentrant`, custom modifiers
- **Error codes** — `require` messages to `const E_*: u64` error constants
- **Constructor to `initialize`** — Solidity constructor to Move `entry fun initialize`
- **Move.toml generation** — Auto-generates package manifest with Aptos framework dependencies
- **173 tests passing**
