# Sol2Move Remediation Tracker

Last updated: 2026-02-20
Mode: coordinated multi-lane execution (non-overlapping ownership)

## Coordination Rules

- Each lane owns an explicit file set to prevent overlap.
- Cross-lane dependencies are resolved only at integration checkpoints.
- No lane edits files owned by another lane without first moving ownership in this tracker.

## Lane Ownership

| Lane | Scope | Owned files |
|---|---|---|
| `W1-State` | state address model + init consistency | `src/transformer/function-transformer.ts`, `src/transformer/contract-transformer.ts` |
| `W2-Flow` | return/cleanup correctness | `src/transformer/function-transformer.ts`, `src/codegen/move-generator.ts` |
| `W3-Calls` | overload dedup + call remap + strict unresolved calls | `src/transformer/contract-transformer.ts`, `src/transformer/expression-transformer.ts`, `src/transformer/function-transformer.ts` |
| `W4-Optimize` | optimization/constructorPattern compatibility + per-user init detection | `src/transformer/contract-transformer.ts`, `src/transformer/function-transformer.ts` |
| `W5-Packaging` | imports/runtime helper packaging | `src/transpiler.ts`, `src/transformer/contract-transformer.ts`, `src/codegen/move-generator.ts` |
| `W6-Access` | capability role provisioning flow | `src/transformer/contract-transformer.ts` |
| `W7-API` | SDK + single-contract API semantics | `src/transpiler.ts`, `src/sdk.ts` |
| `W8-Tests` | regression/compile fixtures and assertions | `tests/unit/*.test.ts`, `tests/integration/*.test.ts` |

## Work Items

| ID | Severity | Lane | Status | Target |
|---|---|---|---|---|
| `B01` | critical | `W1-State` | `done` | resource-account init/borrow address mismatch |
| `B02` | critical | `W1-State` | `done` | constructor initializer semantics + remove hardcoded decimals |
| `B03` | critical | `W2-Flow` | `done` | modifier cleanup before all returns |
| `B04` | critical | `W3-Calls` | `done` | overload renaming without call remap |
| `B05` | critical | `W4-Optimize` | `done` | optimized init assumes resource-account |
| `B06` | high | `W1-State` | `done` | invalid `@0x0()` address codegen |
| `B07` | high | `W3-Calls` | `done` | internal msg.sender helper arity propagation |
| `B08` | high | `W4-Optimize` | `done` | per-user ensure_user_state branch detection |
| `B09` | high | `W5-Packaging` | `done` | block import conflict (`aptos_framework::block` vs `0x1::block`) |
| `B10` | high | `W3-Calls` | `done` | strict mode unresolved calls not surfaced |
| `B11` | high | `W5-Packaging` | `done` | `evm_compat` reference not emitted as source module |
| `B12` | medium | `W6-Access` | `done` | role capability checks without provisioning |
| `B13` | medium | `W7-API` | `done` | `transpileContract` not isolated |
| `B14` | medium | `W3-Calls` | `done` | keccak constant hashing approximation |
| `B15` | low | `W7-API` | `done` | SDK `allValid` false when parser unavailable |

## Acceptance Checklist (per bug)

- [x] Repro test exists for newly added regressions (`B11`, `B13`, `B15`)
- [x] Fix implemented in owned lane files only
- [x] Compile-check or behavior-check passes after fix
- [x] No regression in baseline test suites
- [x] Tracker status moved to `done` with notes

## Integration Checkpoints

1. `IC1`: core transformer compile sanity (`B01`-`B07`) - complete
2. `IC2`: packaging/import and capability flow (`B08`-`B12`) - complete
3. `IC3`: API semantics + final regression suite (`B13`-`B15`) - complete

## Progress Notes

- Completed lane execution across `W1` through `W8` without cross-lane file overlap.
- Added regression tests:
  - `tests/unit/transpiler-api.test.ts` (contract isolation + evm_compat packaging)
  - `tests/unit/sdk.test.ts` parser-unavailable allValid semantics
- Added safety hardening:
  - fail-safe error on reserved helper/module name collision (`evm_compat`).
- Verification completed:
  - `npm run build`
  - `npx vitest run tests/unit`
  - `npx vitest run tests/integration`
