# VU-1144 Tauri Command Policy Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the typed Tauri command policy with AST-based detection for raw command escapes and keep the unit guard and deterministic eval assertion aligned.

**Architecture:** Add one shared CommonJS policy helper that parses TypeScript/TSX files with the TypeScript compiler API, then call it from both the Vitest guard and the Node eval assertion. Keep `app/src/lib/tauri.ts` as the only raw Tauri import boundary and require exactly one exported typed gateway plus one explicit escape hatch.

**Tech Stack:** TypeScript compiler API, Vitest, Node `node:test`, existing frontend typecheck and eval harness tests.

---

## Source Traceability

- Linear issue: `VU-1144`
- Functional spec: waived by prior same-flow repo plan on 2026-05-01 because `docs/functional/custom-plugin-management/` does not exist in this repo.
- Related design docs:
  - `docs/design/backend-design/README.md`
  - `docs/design/data-contracts/README.md`
  - `docs/design/agent-runtime-boundary/README.md`
- Implementation plan: `docs/plans/2026-05-01-vu-1144-tauri-command-policy-guards.md`
- Manual checks: No manual tests required. All scenarios are covered by AST policy unit guards, deterministic eval assertions, TypeScript typechecking, and existing automated test commands.

## Files

- Add: `tests/evals/assertions/tauri-command-policy.js` for shared AST policy analysis.
- Modify: `app/src/__tests__/guards/tauri-command-policy.test.ts` to use the shared helper and add alias/non-literal AST checks.
- Modify: `tests/evals/assertions/tauri-command-contract.test.js` to use the same helper and assert the same policy.
- Modify: `app/src/lib/tauri.ts` only if helper type cleanup can reduce wrapper/type-map drift without behavior change.
- Modify: `docs/plans/2026-05-01-vu-1144-tauri-command-policy-guards.md` as implementation status is completed.

## Task 1: RED AST Policy Guard

- [x] Add a shared helper that can parse arbitrary TS source and report:
  - raw imports from `@tauri-apps/api/core` outside `app/src/lib/tauri.ts`, including aliases
  - `invokeUnsafe` call expressions outside `app/src/lib/tauri.ts`, including aliases
  - `invokeUnsafe` command calls in `app/src/lib/tauri.ts`, including string literals and non-literal command expressions
  - exported `invokeCommand` gateway count in `app/src/lib/tauri.ts`
- [x] Add Vitest fixtures inside `tauri-command-policy.test.ts` proving alias and non-literal bypasses are caught structurally.
- [x] Add matching Node eval assertions in `tauri-command-contract.test.js`.
- [x] Run `cd app && npx vitest run src/__tests__/guards/tauri-command-policy.test.ts` and `cd tests/evals && npm test -- --test-name-pattern "tauri"`.

## Task 2: GREEN Shared AST Helper

- [x] Implement `tests/evals/assertions/tauri-command-policy.js` using `app/node_modules/typescript`.
- [x] Replace regex/string checks in the Vitest guard with the shared helper.
- [x] Replace regex/string checks in the deterministic eval assertion with the same helper.
- [x] Keep path walking exclusions limited to test directories and generated/dependency directories.
- [x] Run the two focused tests again; expected GREEN.

## Task 3: Helper Type Drift Cleanup

- [x] Remove `FieldSuggestions` from the direct `app/src/lib/tauri.ts` import and type `generateSuggestions` from `TauriCommandResult<"generate_suggestions">`.
- [x] Keep public type re-exports intact so existing callers importing from `@/lib/tauri` do not break.
- [x] Run `cd app && npx tsc --noEmit`.

## Task 4: Validation, Evals, And Gates

- [x] Run `cd app && npx vitest run src/__tests__/guards/tauri-command-policy.test.ts`.
- [x] Run `cd tests/evals && npm test -- --test-name-pattern "tauri"`.
- [x] Run `cd tests/evals && npm test`.
- [x] Run `cd app && npm run test:unit`.
- [x] Run independent quality gates: code review, simplification review, test coverage review, and acceptance-criteria review.
- [x] Update Linear with traceability, test/eval evidence, quality-gate outcomes, and checked acceptance criteria.
- [x] Commit the final implementation and leave the worktree clean.
