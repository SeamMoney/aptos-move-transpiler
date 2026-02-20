# Sol2Move — Project Status

> Last updated: Feb 2026

Two repos, one product:
- **`aptos-move-transpiler/`** — Core SDK + CLI (Solidity to Aptos Move v2)
- **`sol2move-app/`** — Next.js web frontend ($0.25/transpilation via x402 + CDP)

---

## Transpiler — PRODUCTION READY

**265 tests pass** | 22/22 DLMM eval | 3 Aptos CLI compile checks | 18 Tier 1 flag tests

### Features Complete

| Category | Feature | Status |
|----------|---------|--------|
| **Core** | Solidity AST -> IR -> Move AST -> Move source (3-stage pipeline) | Done |
| **Core** | Inheritance flattening (multi-level, override resolution) | Done |
| **Core** | Cross-file context (libraries, imports via `contextSources`) | Done |
| **Core** | Type inference system (19 expression types with `inferredType`) | Done |
| **Core** | EVM pattern translation (abi.encode, assembly, selectors) | Done |
| **Core** | Modifier inlining (onlyOwner, nonReentrant, whenNotPaused, custom) | Done |
| **Core** | Borrow checker strategy (internal fns receive `&mut State`) | Done |
| **Types** | uint8-256, int8-256 (Move 2.3+ signed integers) | Done |
| **Types** | OpenZeppelin collection types (UintToUintMap, AddressSet, etc.) | Done |
| **Types** | Fixed-size bytes (bytes1-bytes32 -> u8-u256) | Done |
| **Types** | Structs, enums, arrays, mappings (-> Table) | Done |
| **Standards** | Fungible Asset (ERC-20 -> FA with MintRef/BurnRef/TransferRef) | Done |
| **Standards** | Digital Asset (ERC-721 -> Token Objects) | Done |
| **Tools** | `aptos move fmt` integration (movefmt) | Done |
| **Tools** | `aptos move compile` validation | Done |
| **Tools** | MSL spec generation (aborts_if, modifies, invariants) | Done |
| **Tools** | tree-sitter Move parser (optional native dep) | Done |
| **Optimization** | Block-STM parallelization (low/medium/high) | Done |
| **Optimization** | Aggregators, snapshots, is_at_least | Done |
| **Optimization** | Event-trackable variables | Done |
| **Optimization** | Per-user resources (high level) | Done |
| **Flags** | 7 Tier 1 transpilation flags (see below) | Done |

### Tier 1 Flags (all implemented + tested)

| Flag | CLI | Default | What it does |
|------|-----|---------|-------------|
| `strictMode` | `--strict` | `false` | Errors instead of stubs for unsupported patterns |
| `reentrancyPattern` | `--reentrancy-pattern` | `mutex` | `mutex` or `none` (skip guards) |
| `stringType` | `--string-type` | `string` | `string` (String) or `bytes` (vector\<u8\>) |
| `useInlineFunctions` | `--inline-functions` | `false` | Mark small private helpers as `inline` |
| `emitSourceComments` | `--source-comments` | `false` | Add Solidity source references as comments |
| `viewFunctionBehavior` | `--view-behavior` | `annotate` | `annotate` (#[view]) or `skip` |
| `errorStyle` | `--error-style` | `abort-codes` | `abort-codes` or `abort-verbose` |

### Known Limitations (not blockers)

- Digital Asset `totalSupply`/`tokenId` returns 0 (needs Aptos indexer)
- DLMM: `safe_call` in hooks.move still has EVM selector logic
- DLMM: Flash loan callback uses `call()` stub
- Some SCREAMING_SNAKE cross-module constants have mangled names
- C3 linearization is simplified DFS (not full C3)

### Fundamentally Impossible in Move

delegatecall, dynamic dispatch, proxy upgrades, receive/fallback, inline assembly (Yul), selfdestruct, tx.origin, msg.value (native), contract factories (new Contract)

---

## Frontend — FUNCTIONAL, NEEDS POLISH

### What Works

- Landing page with paste code / GitHub URL input modes
- Options panel with all transpile options (12+ flags exposed)
- CDP wallet auth (Smart Wallet, email, Google, X)
- x402 USDC payment on Base ($0.25/transpilation)
- Async transpilation worker (7-step pipeline with progress)
- Progress polling + animated timeline + progress bar
- Result page: code comparison, diagnostics, specs, parallelism analysis
- Download ZIP (all modules + Move.toml)
- GitHub URL -> discover .sol files -> multi-file transpile
- All API routes functional (transpile, github, result, status, history)
- Graceful degradation without CDP env vars

### What's Missing / Needs Work

| Item | Priority | Effort | Notes |
|------|----------|--------|-------|
| Syntax highlighting in code blocks | Medium | Small | `prism-react-renderer` installed but not wired into MoveCodeBlock |
| History page verification | Medium | Small | `/result` page exists but needs testing with real data |
| Public assets | Low | Trivial | Missing favicon.ico, og.png, logo.svg |
| Mobile responsiveness | Low | Medium | Not tested on small viewports |
| Payment settlement error surfacing | Low | Small | Settlement failures are fire-and-forget |

---

## Proposed Future Work

### Tier 2 Flags — Medium Complexity

| Flag | What | Notes |
|------|------|-------|
| `targetMoveVersion` | Emit Move 2.0 vs 2.2 vs 2.3 syntax | Receiver syntax, match expressions |
| `overflowBehavior` | checked/wrapping/saturating arithmetic | Move is unchecked by default |
| `enumStyle` | Move native enum vs const pattern | Move 2.2+ has native enums |
| `resourceAccountInit` | Resource account vs deployer-owned init | init_module pattern variants |
| `generateTests` | Scaffold Move unit tests from contract | #[test] functions with assertions |
| `entryFunctionStrategy` | Which public fns become entry | Currently auto-detects |
| `eventEmission` | Event generation pattern | Named events vs generic |

### Tier 3 Flags — High Complexity

| Flag | What | Notes |
|------|------|-------|
| `accessControlPattern` | RBAC / ownable / capability | Full ACL system generation |
| `objectModel` | Full Aptos Object Model integration | Replace resource account pattern |
| `receiverStyle` | Method-style syntax (Move 2.2+) | `self.method()` instead of `module::method(self)` |
| `generateMigrationScript` | Migration helpers for live contracts | State migration scripts |

### Other Ideas

- AMM / Lending / Staking DeFi templates
- Source map generation for debugging
- CI compilation testing for all fixtures
- Multi-file import resolution improvements
- Interface implementation verification

---

## Quick Reference

```bash
# ─── Transpiler ───
cd aptos-move-transpiler
npm run build                                    # Compile TypeScript
npx vitest run                                   # All tests (~150s)
npx vitest run tests/unit/tier1-flags.test.ts    # Just flag tests
npx vitest run tests/eval/dlmm-eval.test.ts      # DLMM eval (22 contracts)

# ─── Frontend ───
cd sol2move-app
npm run dev                                      # Dev server (works without env vars)
npx next build                                   # Production build
# Requires: MONGODB_URI, NEXT_PUBLIC_CDP_PROJECT_ID, CDP_API_KEY_ID/SECRET

# ─── CLI ───
sol2move convert contract.sol -o output/
sol2move convert contract.sol --strict --string-type bytes --source-comments
sol2move validate contract.sol
sol2move analyze contract.sol
```

## Key Files

| File | Purpose |
|------|---------|
| `src/transpiler.ts` | TranspileOptions, orchestration, toSnakeCase |
| `src/sdk.ts` | Sol2Move class (unified public API) |
| `src/cli.ts` | Commander CLI (convert/validate/analyze) |
| `src/types/ir.ts` | IRContract, TranspileContext, FunctionSignature |
| `src/types/move-ast.ts` | MoveModule, MoveFunction, MoveExpression (19 kinds) |
| `src/types/optimization.ts` | ResourcePlan, StateVariableAnalysis |
| `src/transformer/contract-transformer.ts` | irToMoveModule, inheritance, resource groups |
| `src/transformer/function-transformer.ts` | transformFunction, modifiers, borrow strategy |
| `src/transformer/expression-transformer.ts` | transformExpression, require/revert, EVM patterns |
| `src/codegen/move-generator.ts` | generateMoveCode, generateFunction, generateStatement |
| `src/codegen/spec-generator.ts` | MSL spec generation |
| `src/mapper/type-mapper.ts` | Solidity -> Move type mapping |
| `src/analyzer/state-analyzer.ts` | Block-STM parallelization analysis |
| `src/compiler/move-compiler.ts` | aptos move compile wrapper |
| `src/formatter/move-formatter.ts` | aptos move fmt wrapper |
