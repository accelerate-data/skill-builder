# Code Review: Skill-Creator Plugin Delegation (VU-618 / VU-627 / VU-630 / VU-631)

**Status:** Review complete — fixes pending

**Branch:** `feature/vu-618-delegate-skill-authoring-to-skill-creator-plugin-with-auto`

**Scope:** 114 files, ~6200 additions / ~4600 deletions across agents, sidecar, Rust backend, and React frontend

---

## What Changed

The branch splits the monolithic `generate-skill` agent into three focused agents (`generate-skill`, `rewrite-skill`, `benchmark-skill`) under the `skill-creator` plugin, restructures the frontend into a workspace shell with overview/refine tabs, and adds direct-dispatch refine commands for validate/rewrite/benchmark.

Key architectural changes:

- **Agent split:** `generate-skill` now only generates. `rewrite-skill` handles iterative improvement (merged from the old `refine-skill` streaming agent). `benchmark-skill` runs evaluations as a separate phase.
- **Plugin delegation:** Step 3 of the workflow delegates to the `skill-creator` plugin, which owns all three agents and their schemas.
- **Frontend restructure:** Dashboard replaced by `SkillListPanel` sidebar + `WorkspaceShell` (overview/refine tabs). Workflow page gains a state machine hook (`useWorkflowStateMachine`) and benchmark confirmation dialog.
- **Direct-dispatch refine:** `send_refine_message` now supports `DirectValidate`, `DirectRewrite`, `DirectBenchmark` dispatch modes alongside the existing streaming path.

---

## Issues Found

### Critical — Mock Path Broken

| ID | Issue | Location | Impact |
|---|---|---|---|
| C1 | `benchmark-skill` agent has no mock mapping or template | `sidecar/mock-agent.ts:18-62` | `MOCK_AGENTS=true` errors at benchmark phase — workflow cannot complete |
| C2 | `step3-generate-skill` mock returns stale `benchmark_status: "complete"` | `sidecar/mock-agent.ts:476-486` | Mock skips benchmark phase entirely, diverging from real flow |
| C3 | `rewrite-skill` mock has no `structured_output` or `buildStructuredMockResult` case | `sidecar/mock-templates/rewrite-skill.jsonl:11` | Rust materialization errors on missing status |

**Root cause:** The mock system was not updated when `benchmark-skill` was extracted from `generate-skill`. All three issues are in `mock-agent.ts` and mock templates.

### High — Race Conditions and Logic Bugs

| ID | Issue | Location | Impact |
|---|---|---|---|
| H1 | TOCTOU race in `ensure_workspace_prompts` — check-then-act not atomic | `commands/workflow/deploy.rs:265-288` | Concurrent workspace copies can corrupt `.claude/` directory via `remove_dir_all` + `create_dir_all` race |
| H2 | `deploy_skill_for_workflow` returns `()` — errors silently swallowed | `commands/workflow/runtime.rs:163-173` | Workflow proceeds with stale/missing plugin, agent produces incorrect results |
| H3 | `WorkspaceRefine` completion effect uses reactive `selectedSkill` instead of run-start ref | `workspace/workspace-refine.tsx:217-307` | Skill switch during agent run attributes output to wrong skill |
| H4 | Streaming/direct-dispatch session mismatch in `send_refine_message` | `commands/refine/mod.rs:201-278` | Follow-up streaming message after direct dispatch sends to wrong sidecar context |

### Medium — Code Quality

| ID | Issue | Location | Impact |
|---|---|---|---|
| M1 | `handleStartAgentStep` not wrapped in `useCallback` | `hooks/use-workflow-state-machine.ts:366-406` | Fragile effect dependency, inconsistent with other handlers |
| M2 | `handleSelectSkill` missing `setSelectedWorkspaceSkillName` in deps | `components/layout/app-layout.tsx:274-280` | ESLint violation, works due to stable Zustand refs |
| M3 | `copy_dir_recursive` in `protocol.rs` has no symlink cycle guard | `commands/refine/protocol.rs:104-128` | Unbounded recursion on symlink cycles (guarded in `files.rs` but not here) |
| M4 | `rewrite-skill.jsonl` has `tool_result` blocks as `assistant` messages | `sidecar/mock-templates/rewrite-skill.jsonl:5,7,9` | Orphaned tool calls in mock UI |
| M5 | `workspace-refine.test.tsx` `makeSkill` missing `SkillSummary` fields | `__tests__/components/workspace/workspace-refine.test.tsx:118-131` | Stale test mock diverges from interface |
| M6 | `workspacePath` missing from persistence debounce effect deps | `hooks/use-workflow-persistence.ts:163-208` | Stale closure if settings change mid-session |
| M7 | Log injection via user-supplied `decision` string | `commands/workflow/runtime.rs:552-558` | Violates `logging-policy.md` — newlines can forge log lines |
| M8 | Dead `MoreHorizontal` button with no action | `components/workspace/workspace-shell.tsx:76` | Clickable button does nothing |

---

## Fix Plan

### Phase 1: Unblock `MOCK_AGENTS=true` (C1 + C2 + C3)

All changes in `app/sidecar/`:

1. **Add `benchmark-skill` mapping** in `resolveStepTemplate`:

   ```ts
   if (agentName === "skill-creator:benchmark-skill") return "benchmark-skill";
   ```

2. **Create `mock-templates/benchmark-skill.jsonl`** — minimal template with tool use events and a result line.

3. **Add `"benchmark-skill"` case** in `buildStructuredMockResult`:

   ```ts
   case "benchmark-skill":
     return { status: "benchmarked", benchmark_status: "complete", benchmark_path: "evals/workspace/iteration-1" };
   ```

4. **Fix `step3-generate-skill` mock result** — remove stale `benchmark_status`/`benchmark_path`, add `call_trace`:

   ```ts
   return { status: "generated", call_trace: ["read-user-context", "write-skill", "write-evals"] };
   ```

5. **Add `"rewrite-skill"` case** in `buildStructuredMockResult`:

   ```ts
   case "rewrite-skill":
     return { status: "rewritten", call_trace: ["read-user-context", "read-existing-skill", "rewrite-skill"] };
   ```

### Phase 2: Race Conditions (H1 + H2)

1. **H1 — Atomic check-and-mark:** Set the `COPIED_WORKSPACES` flag optimistically inside a single lock acquisition before `spawn_blocking`, not after. If the copy fails, clear the flag.

2. **H2 — Propagate deploy errors:** Change `deploy_skill_for_workflow` return type to `Result<()>` and propagate to callers. Fail-fast if the required plugin cannot be deployed.

### Phase 3: Frontend Stale Closures (H3 + H4)

1. **H3 — Capture skill at run start:** Add a `runSkillNameRef` in `WorkspaceRefine`, set it when the agent starts, use it in the completion effect instead of the reactive `selectedSkill`.

2. **H4 — Track session dispatch mode:** Add a `dispatch_mode` field to `RefineSession` (or reset `stream_started` on direct-dispatch completion) so follow-up streaming messages know whether the prior session was streaming or direct.

### Phase 4: Medium Issues (batch)

Address M1–M8 as cleanup in the same PR or a follow-up.

---

## Verification

After fixes:

```bash
# Mock flow end-to-end
MOCK_AGENTS=true npm run dev
# Create a skill, complete all steps, verify benchmark phase completes

# Unit tests
cd app && npm run test:unit
cd app && npm run test:agents:structural

# Rust tests
cargo test --manifest-path app/src-tauri/Cargo.toml

# Type check
cd app && npx tsc --noEmit
```
