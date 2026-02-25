# DLMM (Liquidity Book) Protocol Evaluation

Evaluation of the Sol2Move transpiler against [Trader Joe's Liquidity Book](https://docs.traderjoexyz.com/concepts/concentrated-liquidity) — a Discretized Liquidity Market Maker (DLMM) protocol with 22 contracts, 317 functions, and complex math libraries.

## Summary

| Metric | Value |
|--------|-------|
| Total contracts | 22 |
| Successful transpiles | 22 (100%) |
| Total functions | 317 |
| Total errors | 0 |
| Total warnings | 95 |
| Unsupported markers | 3 |
| Assembly blocks | 1 |

## Contract Inventory

### Math Libraries (10 contracts)

| Contract | Functions | Structs | Lines | Warnings | Notes |
|----------|-----------|---------|-------|----------|-------|
| Constants | 0 | 0 | 33 | 1 | Protocol-wide constants |
| SafeCast | 31 | 0 | 334 | 0 | Safe type casting (31 functions) |
| BitMath | 4 | 0 | 119 | 0 | Bit manipulation utilities |
| Encoded | 13 | 0 | 112 | 0 | Encoding/decoding utilities |
| PackedUint128Math | 15 | 0 | 132 | 2 | Packed 128-bit math operations |
| Uint128x128Math | 2 | 0 | 171 | 1 | 128x128 fixed-point math |
| Uint256x256Math | 9 | 0 | 141 | 0 | 256x256 math operations |
| SampleMath | 10 | 0 | 119 | 0 | Sampling utilities |
| TreeMath | 7 | 1 | 160 | 0 | Tree data structure operations |
| LiquidityConfigurations | 3 | 0 | 64 | 0 | Liquidity config packing |

### Helper Libraries (8 contracts)

| Contract | Functions | Structs | Lines | Warnings | Notes |
|----------|-----------|---------|-------|----------|-------|
| FeeHelper | 5 | 0 | 61 | 1 | Fee calculation logic |
| PriceHelper | 6 | 0 | 65 | 1 | Price conversion utilities |
| BinHelper | 15 | 0 | 217 | 1 | Bin management utilities |
| PairParameterHelper | 28 | 0 | 235 | 1 | Pair parameter encoding |
| OracleHelper | 8 | 1 | 162 | 0 | TWAP oracle integration |
| Hooks | 17 | 1 | 269 | 0 | Hook callback patterns |
| TokenHelper | 3 | 0 | 56 | 0 | Token utility functions |
| ReentrancyGuard | 7 | 2 | 82 | 2 | Upgradeable reentrancy guard |

### Core Contracts (4 contracts)

| Contract | Functions | Structs | Lines | Warnings | Notes |
|----------|-----------|---------|-------|----------|-------|
| LBToken | 16 | 1 | 163 | 0 | Semi-fungible token implementation |
| LBPair | 39 | 1 | 691 | 25 | Core trading pair logic |
| LBFactory | 37 | 1 | 478 | 8 | Factory for creating pairs |
| LBRouter | 42 | 1 | 753 | 52 | Router for swap execution |

## Understanding the Warnings

The 95 warnings are expected and fall into these categories:

- **Library call patterns** (majority): Solidity `using ... for` library calls transpile with explicit module references. The transpiler warns about call style differences.
- **Type coercions**: Packed uint128 operations require explicit casting between u128 and u256.
- **Interface references**: `ILBPair`, `IERC20` etc. are translated to `address` with a warning about the lost interface type information.

These warnings indicate non-idiomatic but functionally correct Move code. They do not affect compilation.

## Unsupported Features (3)

| Contract | Feature |
|----------|---------|
| ReentrancyGuard | 1 inline assembly block (EVM-specific storage slot access) |
| LBPair | 1 unsupported pattern (complex callback interface) |
| LBRouter | 1 unsupported pattern (complex callback interface) |

These generate `/* unsupported */` stubs in the output. The assembly block has no Move equivalent (it accesses EVM storage slots directly). The callback patterns require manual adaptation to Move's module system.

## How to Run

```bash
# Run the DLMM evaluation suite
npx vitest run tests/eval/dlmm-eval.test.ts

# This will:
# 1. Transpile all 22 contracts
# 2. Write Move output to tests/output/dlmm/
# 3. Generate eval-report.json with per-contract metrics
# 4. Print a summary table to stdout
```

## File Locations

| Path | Contents |
|------|----------|
| `tests/fixtures/dlmm/` | Solidity source files (30 files) |
| `tests/fixtures/dlmm/libraries/` | Helper and math libraries |
| `tests/output/dlmm/` | Generated Move output (when tests are run) |
| `tests/eval/dlmm-eval.test.ts` | Evaluation test framework |
| `examples/protocol/dlmm/eval-report.json` | Latest evaluation results |

## Report Format

The `eval-report.json` contains:

```json
{
  "timestamp": "2026-02-25T22:35:38.214Z",
  "totalContracts": 22,
  "successfulTranspiles": 22,
  "totalFunctions": 317,
  "totalErrors": 0,
  "totalWarnings": 95,
  "totalUnsupported": 3,
  "totalAssemblyBlocks": 1,
  "contracts": [
    {
      "contract": "lb_pair",
      "transpiles": true,
      "functionCount": 39,
      "structCount": 1,
      "errorCount": 0,
      "warningCount": 25,
      "unsupportedCount": 1,
      "assemblyBlockCount": 0,
      "lineCount": 691
    }
  ]
}
```
