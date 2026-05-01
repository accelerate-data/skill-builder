# VU-1142 Typed Tauri Utility Wrappers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Complete the VU-927 typed Tauri command migration by removing remaining `invokeUnsafe` wrapper usage or documenting machine-checked exceptions.

**Architecture:** Keep one frontend IPC boundary: `app/src/lib/tauri.ts` exposes command-specific wrappers and `invokeCommand`, while `app/src/lib/tauri-command-types.ts` owns the command-name, args, and result contract. Guard tests and deterministic eval assertions enforce that wrapper commands use `invokeCommand` and that any future escape-hatch command is explicitly allowlisted with a reason.

**Tech Stack:** TypeScript strict, Tauri v2 IPC, Vitest guard/type tests, Node test eval assertions, existing Rust command modules.

---

## Source Traceability

- Linear issue: `VU-1142`
- Functional spec: `waived_by_user` (`custom-plugin-management` folder is absent; user explicitly said to proceed without it)
- Design docs: `not_applicable` after search
- Existing implementation plan: `not_applicable`; this file is the plan
- Manual checks: No manual tests required.

## Files

- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/tauri.ts`
- Modify: `app/src/__tests__/guards/tauri-command-policy.test.ts`
- Modify: `tests/evals/assertions/tauri-command-contract.test.js`
- Create/modify only if verification reveals stale mapping: `repo-map.json`

## Tasks

### Task 1: Add Failing Guard Coverage

- [x] Update `app/src/__tests__/guards/tauri-command-policy.test.ts` so it parses `app/src/lib/tauri.ts` and fails when any `invokeUnsafe("command")` call appears outside an explicit allowlist with reason.
- [x] Add the same command-level policy to `tests/evals/assertions/tauri-command-contract.test.js`.
- [x] Run `cd app && npx vitest run src/__tests__/guards/tauri-command-policy.test.ts` and confirm it fails on the current unsafe command list.
- [x] Run `cd tests/evals && npm test -- assertions/tauri-command-contract.test.js` and confirm it fails on the current unsafe command list.

### Task 2: Type Remaining Utility Commands

- [x] Add `TauriCommandMap` entries for logging, lifecycle, workflow-session, feedback, lock, usage, and document commands.
- [x] Move or import any wrapper-only request/result types needed by those command entries, including `CreateGithubIssueRequest`, `CreateGithubIssueResponse`, and `SkillIdName`.
- [x] Convert the matching wrappers in `app/src/lib/tauri.ts` from `invokeUnsafe` to `invokeCommand`.
- [x] Run the two guards from Task 1 and confirm the utility scope passes.

### Task 3: Complete Remaining Wrapper Migration

- [x] Continue adding `TauriCommandMap` entries for all remaining wrapper commands in `app/src/lib/tauri.ts`.
- [x] Convert every remaining wrapper call from `invokeUnsafe` to `invokeCommand`.
- [x] If any command cannot safely join the typed map, leave it in a named allowlist with a short reason in both guard files. Expected outcome for this issue is no command allowlist.
- [x] Run `cd app && npx tsc --noEmit` and fix command-map type errors.

### Task 4: Verification

- [x] Run `cd app && npx vitest run src/__tests__/guards/tauri-command-policy.test.ts src/__tests__/stores/usage-store.test.ts src/__tests__/pages/settings.test.tsx src/__tests__/components/feedback-dialog.test.tsx`.
- [x] Run `cd tests/evals && npm test -- assertions/tauri-command-contract.test.js`.
- [x] Run `cargo test --manifest-path app/src-tauri/Cargo.toml commands::usage commands::documents`.
- [x] Run `cd app && npx tsc --noEmit`.
- [x] Because `app/src/lib/tauri.ts` and `app/src/lib/tauri-command-types.ts` are shared infrastructure, run `cd app && bash tests/run.sh` if the targeted gates are clean and time permits; otherwise report the targeted verification and residual full-suite risk.

### Task 5: Linear and Commit

- [x] Update the VU-1142 acceptance criteria in Linear after verification.
- [x] Post a Linear implementation note with source traceability, tests/evals, manual checks, and risks.
- [x] Commit the final implementation on `feature/vu-1142`.
