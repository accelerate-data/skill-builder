# VU-1138 Typed Skill Library Command Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move skill library, imported skill, plugin, GitHub import, marketplace import/update, and standalone skill file import wrappers from `invokeUnsafe` to typed `invokeCommand`.

**Architecture:** Extend `TauriCommandMap` with the existing frontend wrapper contracts, then update only the in-scope wrappers in `app/src/lib/tauri.ts`. Keep `invokeUnsafe` available for out-of-scope command areas until their follow-up migrations.

**Tech Stack:** TypeScript strict mode, Tauri IPC wrappers, Vitest static guards, Playwright `@skills` E2E, deterministic Promptfoo harness.

---

## Source Traceability

- Linear issue: VU-1138
- Functional spec: skipped by explicit user instruction; no `docs/functional/` directory exists in this checkout.
- Design docs: `docs/design/skill-import/README.md`, `docs/design/skills-marketplace/README.md`, `docs/design/skills/README.md`, `docs/design/skill-scope-review/README.md`
- Implementation plan: `docs/plan/2026-05-01-vu-1138-typed-skill-library-command-map.md`
- Manual tests: No manual tests required.

## Files

- Modify: `app/src/lib/tauri-command-types.ts` — add command map entries and local result types for the VU-1138 scope.
- Modify: `app/src/lib/tauri-command-types.typecheck.ts` — add compile-time negative checks from this command scope.
- Modify: `app/src/lib/tauri.ts` — replace in-scope `invokeUnsafe` calls with `invokeCommand`.
- Modify: `app/src/__tests__/guards/tauri-command-policy.test.ts` — add a guard that fails when in-scope commands use `invokeUnsafe`.

## Tasks

### Task 1: Add RED coverage for the migration boundary

- [x] Add a static guard listing every VU-1138 command name and asserting no corresponding wrapper call uses `invokeUnsafe`.
- [x] Add typecheck examples for at least one valid in-scope command plus one command-name error, one argument-shape error, and one return-type error from this scope.
- [x] Run `cd app && npx vitest run src/__tests__/guards/tauri-command-policy.test.ts` and confirm it fails on current `invokeUnsafe` usage.
- [x] Run `cd app && npx tsc --noEmit` and confirm it fails because the new in-scope commands are absent from `TauriCommandMap`.

### Task 2: Extend the typed command map

- [x] Add command entries for skill management: delete, rename, metadata update, export, suggestions, and scope review.
- [x] Add command entries for imported skill and plugin library commands.
- [x] Add command entries for GitHub import and marketplace import/update commands.
- [x] Add command entries for standalone skill file import commands.
- [x] Keep argument names aligned to the existing frontend wrapper call shapes.

### Task 3: Migrate wrappers to `invokeCommand`

- [x] Replace `invokeUnsafe` with `invokeCommand` for every in-scope wrapper.
- [x] Preserve existing public wrapper function signatures and null-default behavior.
- [x] Leave out-of-scope wrappers on `invokeUnsafe`.

### Task 4: Verify automated coverage

- [x] Run `cd app && npx vitest run src/__tests__/guards/tauri-command-policy.test.ts`.
- [x] Run `cd app && npx tsc --noEmit`.
- [x] Run `cd app && npm run test:unit`.
- [x] Run `cd app && bash tests/run.sh e2e --tag @skills`.
- [x] Run `cd tests/evals && npm test` only if `tests/evals/**` changes; otherwise record as not applicable.
- [x] Run `git status --short`.

## Verification Notes

- Focused guard and typecheck were run RED first and failed on the intended missing migration.
- `cd app && npm run test:unit` passed.
- `cd app && bash tests/run.sh e2e --tag @skills` passed.
- `cd app && npx vitest run src/__tests__/components/app-layout.test.tsx src/__tests__/guards/tauri-command-policy.test.ts` passed after updating the typed no-arg call expectation.
- `cd app && npm run sidecar:build` passed and restored `app/sidecar/dist/agent-runner.js` for sidecar-backed E2E.
- Full `cd app && bash tests/run.sh` did not pass: frontend unit, Rust unit, sidecar unit, and agent structural tests passed; integration still had unrelated workflow tests failing because their setup lacks a selected Settings model, and full E2E had unrelated workflow/sidecar scenarios failing outside the VU-1138 `@skills` surface.
