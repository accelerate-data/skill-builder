# VU-1141 Typed Eval Tauri Wrappers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move description optimization, benchmark, and Evals tab Tauri wrappers from `invokeUnsafe` to the typed `TauriCommandMap`/`invokeCommand` contract.

**Architecture:** Keep `app/src/lib/tauri.ts` as the only frontend Tauri IPC surface. Add precise command entries to `app/src/lib/tauri-command-types.ts`, reusing existing domain types from `types.ts` and `description-optimization.ts`; model tuple and record results explicitly so call sites get frontend compile-time checking.

**Tech Stack:** React 19, TypeScript strict, Tauri v2 IPC, Vitest, Playwright mocked E2E, Rust command tests.

---

## Source Traceability

- Linear issue: `VU-1141`
- Functional spec: waived by user because this repo has no `docs/functional/` tree
- Related design doc: `docs/design/write-eval-test-refine-loop/README.md`
- Existing implementation plan: not found before this plan

## Manual Tests

No manual tests required. The affected behavior is covered through TypeScript contract checks, Vitest wrapper/component tests, Rust command tests, and mocked E2E tags `@description` and `@evals`. Live OpenCode evals are automated checks; run them when prompt, agent, or runtime behavior changes.

## File Map

- Modify `app/src/lib/tauri-command-types.ts`: add typed command-map entries for description optimization, benchmark, Evals tab test cases, iteration results, grading, prompt building, and pending eval support.
- Modify `app/src/lib/tauri.ts`: switch scoped wrappers from `invokeUnsafe` to `invokeCommand`.
- Modify `app/src/lib/tauri-command-types.typecheck.ts`: add representative negative checks for wrong eval/optimization args, tuple results, and record results.
- No `repo-map.json` update expected: no source module, command file, store, page, component, lib, or hook is added, removed, renamed, or restructured.

## Tasks

- [x] Add RED compile-time checks for the scoped commands and verify the missing command-map entries fail compilation.
- [x] Add the command-map entries and migrate the scoped wrappers to `invokeCommand`.
- [x] Re-run `cd app && npx tsc --noEmit` and targeted Vitest/Rust/E2E coverage.
- [ ] Run the required independent review gates, update Linear, commit, and leave the worktree clean.
