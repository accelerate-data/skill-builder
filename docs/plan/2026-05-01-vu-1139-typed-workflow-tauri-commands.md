# VU-1139 Typed Workflow Tauri Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move workflow/runtime, workspace lifecycle, workflow session, file, and reconciliation follow-up Tauri wrappers from `invokeUnsafe` to the typed `TauriCommandMap`.

**Architecture:** Keep the existing wrapper API in `app/src/lib/tauri.ts` stable and extend the compile-time command contract in `app/src/lib/tauri-command-types.ts`. Use TypeScript typechecking as the primary regression gate, with representative negative checks in `app/src/lib/tauri-command-types.typecheck.ts`.

**Tech Stack:** React/TypeScript strict mode, Tauri command wrappers, Vitest typecheck harness through `npm run build`/`tsc`.

---

## Source Traceability

- Linear issue: `VU-1139`
- Functional spec: user-approved override; no `docs/functional/custom-plugin-management/` exists in this checkout.
- Related design docs:
  - `docs/design/agent-runtime-boundary/README.md`
  - `docs/design/agent-specs/README.md`
  - `docs/design/backend-design/README.md`
  - `docs/design/sdk-agent-options/README.md`
  - `docs/design/startup-recon/README.md`
  - `docs/design/workflow-state/README.md`
- Implementation plan: `docs/plan/2026-05-01-vu-1139-typed-workflow-tauri-commands.md`

## Manual Tests

No manual tests required. The scenarios are type-contract migrations and can be covered by TypeScript compile-time checks plus existing automated workflow/reconciliation/startup tests.

## Task 1: Add Failing Type-Contract Checks

**Files:**

- Modify: `app/src/lib/tauri-command-types.typecheck.ts`

- [x] **Step 1: Add representative negative checks before production edits**

Add compile-time checks for workflow/runtime mistakes:

```ts
// @ts-expect-error run_workflow_step requires workflowSessionId to be string or null, not number
void invokeCommand("run_workflow_step", {
  skillName: "demo",
  stepId: 1,
  workspacePath: "/tmp/workspace",
  workflowSessionId: 123,
});

// @ts-expect-error get_workspace_path uses the typed no-args convention
void invokeCommand("get_workspace_path");

// @ts-expect-error resolve_discovery action must be a string and pluginSlug must be nullable string
void invokeCommand("resolve_discovery", {
  skillName: "demo",
  action: 42,
  pluginSlug: false,
});
```

- [x] **Step 2: Verify RED**

Run:

```bash
cd app && npx tsc --noEmit
```

Expected: FAIL because the commands are not yet declared in `TauriCommandMap`, causing some `@ts-expect-error` comments to be unused or to fail for the wrong reason.

## Task 2: Extend TauriCommandMap

**Files:**

- Modify: `app/src/lib/tauri-command-types.ts`

- [x] **Step 1: Import result types**

Import the wrapper result types already used by `app/src/lib/tauri.ts`:

```ts
import type {
  AppSettings,
  DetailedResearchOutput,
  DeviceFlowResponse,
  DiscoveryResolutionAction,
  GitHubAuthResult,
  GitHubUser,
  GenerateSkillOutput,
  ModelInfo,
  ReconciliationResult,
  ResearchStepOutput,
  SkillFileEntry,
  StartupDeps,
  StepResetPreview,
  StepStatusUpdate,
  WorkflowStateResponse,
  DecisionsOutput,
} from "@/lib/types";
```

- [x] **Step 2: Add workflow/runtime command entries**

Add entries for:

```ts
start_agent
run_workflow_step
materialize_workflow_step_output
reset_workflow_step
navigate_back_to_step
preview_step_reset
verify_step_output
get_disabled_steps
get_workflow_state
save_workflow_state
read_file
write_file
list_skill_files
get_workspace_path
cleanup_skill_sidecar
graceful_shutdown
allow_app_exit
create_workflow_session
end_workflow_session
resolve_orphan
resolve_discovery
cancel_workflow_step
get_clarifications_content
save_clarifications_content
get_decisions_content
save_decisions_content
get_context_file_content
```

Use camelCase argument names because the frontend wrappers and Tauri serde bridge already use those names. Use `NoArgs` for `get_workspace_path`, `graceful_shutdown`, and `allow_app_exit`.

- [x] **Step 3: Verify GREEN for the type contract**

Run:

```bash
cd app && npx tsc --noEmit
```

Expected: PASS or only unrelated pre-existing errors. If there are unrelated errors, run the narrower changed test target in Task 4 and document the unrelated errors.

## Task 3: Migrate Wrappers to invokeCommand

**Files:**

- Modify: `app/src/lib/tauri.ts`

- [x] **Step 1: Replace scoped wrappers**

Change only the `VU-1139` wrappers listed in Task 2 from `invokeUnsafe` to `invokeCommand`. Preserve exported function names, parameter order, return types, and null normalization.

- [x] **Step 2: Keep out-of-scope wrappers on invokeUnsafe**

Do not migrate skill CRUD, usage, imported skills, GitHub import, marketplace import, refine, eval, document, or feedback wrappers in this issue.

- [x] **Step 3: Verify wrapper typechecking**

Run:

```bash
cd app && npx tsc --noEmit
```

Expected: PASS or only unrelated pre-existing errors. All scoped wrappers must typecheck against `TauriCommandMap`.

## Task 4: Automated Validation

**Files:**

- No production edits expected.

- [x] **Step 1: Run frontend automated tests**

Run:

```bash
cd app && npm run test:unit
```

Expected: PASS.

- [x] **Step 2: Run Rust mapped tests from TEST_MANIFEST**

Run:

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml commands::workflow commands::workspace reconciliation
```

Expected: PASS. If Cargo rejects multiple filters, run the mapped filters separately:

```bash
cd app && cargo test --manifest-path src-tauri/Cargo.toml commands::workflow
cd app && cargo test --manifest-path src-tauri/Cargo.toml commands::workspace
cd app && cargo test --manifest-path src-tauri/Cargo.toml reconciliation
```

- [x] **Step 3: Run deterministic eval harness only if agent/eval contracts changed**

This issue does not touch agent prompts, eval fixtures, or model-backed smoke suites. The deterministic eval harness contract was expanded for the newly migrated command list and run with `cd tests/evals && npm test`. Do not run `test:agents:smoke` unless explicitly requested.

## Task 5: Linear Update and Commit

**Files:**

- Update only Linear metadata/comment and git commit state.

- [x] **Step 1: Update Linear**

Post implementation status with:

```md
Functional spec: user-approved override; missing docs/functional/custom-plugin-management/.
Design docs: docs/design/agent-runtime-boundary/README.md, docs/design/agent-specs/README.md, docs/design/backend-design/README.md, docs/design/sdk-agent-options/README.md, docs/design/startup-recon/README.md, docs/design/workflow-state/README.md
Implementation plan: docs/plan/2026-05-01-vu-1139-typed-workflow-tauri-commands.md
Verification: <commands and results>
Manual tests: No manual tests required.
```

- [x] **Step 2: Commit**

Run:

```bash
git status --short
git add app/src/lib/tauri-command-types.ts app/src/lib/tauri-command-types.typecheck.ts app/src/lib/tauri.ts docs/plan/2026-05-01-vu-1139-typed-workflow-tauri-commands.md
git commit -m "VU-1139: type workflow Tauri command wrappers"
```
