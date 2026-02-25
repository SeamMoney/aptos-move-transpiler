# Transpilation Examples

Side-by-side Solidity input and Move output for every supported contract pattern. Each directory contains the original `.sol` file and an `output/` folder with the generated Move project (Move.toml + sources).

## Example Index

| Example | Category | Sol LoC | Move LoC | Functions | Structs | Events | Description |
|---------|----------|---------|----------|-----------|---------|--------|-------------|
| [simple-storage](basic/simple-storage/) | basic | 41 | 70 | 5 | 2 | 1 | Basic key-value storage with events |
| [erc20-token](basic/erc20-token/) | basic | 53 | 98 | 4 | 3 | 2 | ERC-20 fungible token with transfer and approval |
| [erc721-token](basic/erc721-token/) | basic | 105 | 172 | 13 | 4 | 3 | ERC-721 NFT collection with mint, burn, and approval |
| [amm](defi/amm/) | defi | 231 | 220 | 12 | 5 | 4 | Uniswap-style AMM with constant product formula |
| [lending](defi/lending/) | defi | 363 | 325 | 13 | 10 | 6 | Aave/Compound-style lending with interest rates |
| [staking](defi/staking/) | defi | 221 | 218 | 14 | 6 | 5 | Synthetix-style staking with reward distribution |
| [vault](defi/vault/) | defi | 411 | 362 | 24 | 9 | 7 | ERC-4626 yield vault with strategy management |
| [multisig](defi/multisig/) | defi | 351 | 355 | 21 | 10 | 8 | Gnosis Safe-style multisig wallet |
| [nova-dex](defi/nova-dex/) | defi | 424 | 479 | 22 | 13 | 9 | Full-featured DEX with staking, governance, flash loans |

**Totals:** 2,200 Solidity LoC → 2,299 Move LoC | 128 functions | 62 structs | 45 events | 0 errors

## How to Browse

Each example directory has this structure:

```
examples/defi/amm/
├── SimpleAMM.sol              ← Solidity input
└── output/
    ├── Move.toml              ← Aptos package manifest
    └── sources/
        └── simple_amm.move    ← Generated Move v2 code
```

Open the `.sol` and `.move` files side-by-side to see how each Solidity pattern maps to Move.

## How to Run

Transpile any Solidity file yourself:

```bash
# Single file
npx sol2move convert examples/defi/amm/SimpleAMM.sol -o my-output/

# With cross-contract context (for library dependencies)
npx sol2move convert Contract.sol -o output/ --context libraries/*.sol
```

## Categories

### basic/

Simple contracts demonstrating core type and pattern mappings: state variables, events, mappings, constructors, view functions, and token standards.

### defi/

Real DeFi protocol patterns from production-grade Solidity contracts. These exercise advanced features like nested mappings, reentrancy guards, modifier inlining, struct management, and arithmetic type harmonization.

The **nova-dex** example is the flagship — a 424-line contract with 7 structs, 37 functions, 8 mappings (3 nested), 20 events, staking, governance, flash loans, and TWAP oracles. It compiles with **0 errors, 0 warnings** via the WASM Move compiler.

### protocol/

Protocol-scale evaluation against the [Trader Joe Liquidity Book (DLMM)](protocol/dlmm/) — a 22-contract DeFi protocol with 317 functions. See the [DLMM evaluation report](protocol/dlmm/README.md) for detailed metrics.

## Post-Run Analysis

### Evaluation Framework

The transpiler includes an evaluation framework that measures transpilation quality across real-world contract suites. For each contract it tracks:

| Metric | Description |
|--------|-------------|
| `transpiles` | Does the transpiler produce output without crashing? |
| `functionCount` | Number of functions successfully transpiled |
| `structCount` | Number of structs generated |
| `errorCount` | Transpiler errors (should be 0) |
| `warningCount` | Transpiler warnings (type coercions, unsupported patterns) |
| `unsupportedCount` | `/* unsupported */` or `TODO` markers in output |
| `assemblyBlockCount` | Inline assembly blocks that couldn't be transpiled |
| `lineCount` | Size of generated Move code |

### Running the Evaluation

```bash
# Run the DLMM protocol evaluation (22 contracts)
npx vitest run tests/eval/dlmm-eval.test.ts

# Run DeFi contract transpilation tests
npx vitest run tests/integration/defi-transpilation.test.ts

# Run compilation verification (requires wasmtime or aptos CLI)
npx vitest run tests/integration/compilation.test.ts

# Run the full test suite (453 tests)
npx vitest run
```

### Key Results

- **9 curated examples:** 0 transpilation errors across all categories
- **DLMM protocol:** 22/22 contracts transpile successfully, 317 functions, 95 warnings (library call patterns)
- **NovaDEX compilation:** End-to-end transpile + WASM compile with 0 errors, 0 warnings
- **453 tests passing** across 22 test files with 0 failures

## Regenerating Examples

After making transpiler changes, regenerate all examples:

```bash
npm run generate:examples
```

This runs `scripts/generate-examples.ts`, which transpiles each Solidity source and writes the Move output to the corresponding `output/` directory.
