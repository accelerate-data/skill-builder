# VU-1140 Typed Tauri Command Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Refine, git history, answer-evaluation, and workflow gate command wrappers from `invokeUnsafe` to typed `invokeCommand` calls.

**Architecture:** Extend `TauriCommandMap` with command contracts matching the existing wrappers in `app/src/lib/tauri.ts`, then migrate only the VU-1140 command scope to `invokeCommand`. Keep the raw escape hatch in place for commands outside this issue and add static guards so this scope cannot regress.

**Tech Stack:** TypeScript 6, Tauri v2 IPC wrappers, Vitest guard tests, Node test eval assertions, existing Rust and Playwright automation.

---

## Source Traceability

- Linear issue: `VU-1140`
- Functional spec: waived by user on 2026-05-01 because `docs/functional/custom-plugin-management/` does not exist in this repo.
- Related design docs:
  - `docs/design/agent-runtime-boundary/README.md`
  - `docs/design/sdk-agent-options/README.md`
  - `docs/design/write-eval-test-refine-loop/README.md`
  - `docs/design/workflow-state/README.md`
  - `docs/design/workspace-ui-refinement/README.md`
- Implementation plan: `docs/plans/2026-05-01-vu-1140-typed-tauri-command-migration.md`
- Manual checks: No manual tests required. All VU-1140 scenarios are automatable via compile-time type checks, static guard/eval assertions, unit tests, Rust tests, and mocked Playwright E2E tags.

## Files

- Modify: `app/src/lib/tauri-command-types.ts` for typed command entries.
- Modify: `app/src/lib/tauri-command-types.typecheck.ts` for representative negative compile-time checks.
- Modify: `app/src/lib/tauri.ts` to use `invokeCommand` for the VU-1140 wrappers.
- Modify: `app/src/__tests__/guards/tauri-command-policy.test.ts` to enforce that the scoped commands no longer use `invokeUnsafe`.
- Modify: `app/e2e/helpers/workflow-helpers.ts` to keep mocked workflow automation aligned with required model settings.
- Modify: `tests/evals/assertions/tauri-command-contract.test.js` to mirror the static guard in the eval assertion suite.
- Leave unchanged unless verification proves otherwise: Rust command implementations, existing UI tests, `repo-map.json`, and `TEST_MAP.md`.

## Task 1: RED Guards For Scoped Escape-Hatch Removal

- [x] Add a scoped command inventory to `app/src/__tests__/guards/tauri-command-policy.test.ts`:

```ts
const vu1140Commands = [
  "get_skill_content_at_path",
  "get_skill_content_for_refine",
  "start_refine_session",
  "close_refine_session",
  "cancel_refine_turn",
  "cancel_agent_run",
  "cancel_workflow_step",
  "answer_refine_question",
  "send_refine_message",
  "finalize_refine_run",
  "clean_benchmark_snapshot",
  "get_skill_history",
  "restore_skill_version",
  "get_skill_files_at_sha",
  "run_answer_evaluator",
  "materialize_answer_evaluation_output",
  "get_clarifications_content",
  "save_clarifications_content",
  "get_decisions_content",
  "save_decisions_content",
  "get_context_file_content",
  "log_gate_decision",
] as const;
```

- [x] Add a Vitest assertion that each command has a `TauriCommandMap` entry and `invokeCommand("<command>"` in `tauri.ts`, and does not appear as `invokeUnsafe...("<command>"`.
- [x] Add the same command inventory to `tests/evals/assertions/tauri-command-contract.test.js`, with Node assertions against `tauri.ts` and `tauri-command-types.ts`.
- [x] Run:

```bash
cd app && npx vitest run src/__tests__/guards/tauri-command-policy.test.ts
cd tests/evals && npm run test:assertions
```

Expected: both fail because the scoped wrappers still use `invokeUnsafe` and the command map lacks entries.

## Task 2: GREEN Type Map And Wrapper Migration

- [x] Update imports in `app/src/lib/tauri-command-types.ts` to include:

```ts
import type {
  AnswerEvaluationOutput,
  RefineFinalizeResult,
  RefineSessionInfo,
  SkillCommit,
  SkillFileContent,
} from "@/lib/types";
```

- [x] Add `TauriCommandMap` entries for the scoped commands, preserving existing wrapper argument names and result types:

```ts
  get_skill_content_at_path: { args: { path: string }; result: SkillFileContent[] };
  get_skill_content_for_refine: {
    args: { skillName: string; workspacePath: string; pluginSlug: string };
    result: SkillFileContent[];
  };
  start_refine_session: {
    args: { skillName: string; pluginSlug: string; workspacePath: string };
    result: RefineSessionInfo;
  };
  close_refine_session: { args: { sessionId: string }; result: void };
  cancel_refine_turn: { args: { sessionId: string }; result: void };
  cancel_agent_run: { args: { skillName: string; agentId: string }; result: void };
  cancel_workflow_step: { args: { agentId: string }; result: void };
  answer_refine_question: {
    args: {
      sessionId: string;
      agentId: string;
      toolUseId: string;
      questions: unknown;
      answers: Record<string, unknown>;
    };
    result: void;
  };
  send_refine_message: {
    args: {
      sessionId: string;
      userMessage: string;
      pluginSlug: string;
      workspacePath: string;
      targetFiles: string[] | null;
      command: string | null;
    };
    result: string;
  };
  finalize_refine_run: {
    args: {
      skillName: string;
      workspacePath: string;
      pluginSlug: string;
      structuredOutput: unknown | null;
    };
    result: RefineFinalizeResult;
  };
  clean_benchmark_snapshot: {
    args: { skillName: string; workspacePath: string; pluginSlug: string };
    result: void;
  };
  get_skill_history: {
    args: { workspacePath: string; skillName: string; pluginSlug: string; limit: number | null };
    result: SkillCommit[];
  };
  restore_skill_version: {
    args: { workspacePath: string; skillName: string; pluginSlug: string; sha: string };
    result: string;
  };
  get_skill_files_at_sha: {
    args: { workspacePath: string; skillName: string; pluginSlug: string; sha: string };
    result: SkillFileContent[];
  };
  run_answer_evaluator: { args: { skillName: string; workspacePath: string }; result: string };
  materialize_answer_evaluation_output: {
    args: { skillName: string; workspacePath: string; structuredOutput: AnswerEvaluationOutput };
    result: void;
  };
  get_clarifications_content: { args: { skillName: string; workspacePath: string }; result: string };
  save_clarifications_content: {
    args: { skillName: string; workspacePath: string; content: string };
    result: void;
  };
  get_decisions_content: { args: { skillName: string; workspacePath: string }; result: string };
  save_decisions_content: {
    args: { skillName: string; workspacePath: string; content: string };
    result: void;
  };
  get_context_file_content: {
    args: { skillName: string; workspacePath: string; fileName: string };
    result: string;
  };
  log_gate_decision: {
    args: { skillName: string; verdict: string; decision: string };
    result: void;
  };
```

- [x] Change only the scoped wrappers in `app/src/lib/tauri.ts` from `invokeUnsafe` to `invokeCommand`.
- [x] Run:

```bash
cd app && npx vitest run src/__tests__/guards/tauri-command-policy.test.ts
cd tests/evals && npm run test:assertions
```

Expected: both pass.

## Task 3: Compile-Time Negative Checks

- [x] Add representative VU-1140 negative checks in `app/src/lib/tauri-command-types.typecheck.ts`:

```ts
// @ts-expect-error refine command requires camelCase sessionId
void invokeCommand("close_refine_session", { session_id: "session-1" });

// @ts-expect-error send_refine_message requires nullable targetFiles and command fields
void invokeCommand("send_refine_message", {
  sessionId: "session-1",
  userMessage: "Update this skill",
  pluginSlug: "skills",
  workspacePath: "/tmp/workspace",
});

// @ts-expect-error answer evaluator output must match AnswerEvaluationOutput
void invokeCommand("materialize_answer_evaluation_output", {
  skillName: "demo",
  workspacePath: "/tmp/workspace",
  structuredOutput: { verdict: "ok" },
});

// @ts-expect-error git history limit must be number or null
void invokeCommand("get_skill_history", {
  workspacePath: "/tmp/workspace",
  skillName: "demo",
  pluginSlug: "skills",
  limit: "10",
});
```

- [x] Run:

```bash
cd app && npx tsc --noEmit
```

Expected: pass, proving the `@ts-expect-error` checks are active.

## Task 4: Existing Automated Scenario Coverage

- [x] Run changed-area and issue-scope tests:

```bash
cd app && npm run test:guard
cd app && npm run test:unit
cd app && npx vitest run src/__tests__/components/refine src/__tests__/components/workspace/workspace-refine.test.tsx src/__tests__/stores/refine-store.test.ts src/__tests__/components/decisions-summary-card.test.tsx src/__tests__/lib/gate-feedback.test.ts
cd app/src-tauri && cargo test commands::refine commands::workflow commands::git
cd app && npx playwright test --grep '@refine|@workflow|@dashboard'
cd tests/evals && npm test
```

- [x] If targeted commands pass and time permits, run shared-infrastructure full suite:

```bash
cd app && ./tests/run.sh
```

Expected: targeted and full-suite checks pass, or any failure is isolated and fixed before handoff.

## Task 5: Quality Gates, Linear Update, And Commit

- [x] Review the final diff against VU-1140 scope:
  - typed command contract correctness
  - no overbroad migration outside the scoped command areas
  - automation coverage for static guards, eval assertions, existing Refine, git history, workflow gate, and answer-evaluation paths
  - acceptance criteria checked against Linear VU-1140
- [x] Apply only verified feedback.
- [x] Update Linear with:
  - functional spec waived by user
  - design docs listed above
  - implementation plan path
  - verification commands and results
  - manual checks: `No manual tests required.`
  - acceptance criteria completed
- [x] Commit all changes:

```bash
git add app/src/lib/tauri-command-types.ts app/src/lib/tauri-command-types.typecheck.ts app/src/lib/tauri.ts app/src/__tests__/guards/tauri-command-policy.test.ts app/e2e/helpers/workflow-helpers.ts tests/evals/assertions/tauri-command-contract.test.js docs/plans/2026-05-01-vu-1140-typed-tauri-command-migration.md
git commit -m "VU-1140: migrate refine and gate Tauri wrappers"
```

Expected: clean worktree after commit.
