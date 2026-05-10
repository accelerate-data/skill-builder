---
functional-specs: [custom-plugin-management]
---

# Implementation Gaps

This document tracks the delta between the target architecture (described in
[README.md](README.md)) and the current codebase. Use it to scope implementation
PRs and to verify when the target state has been reached.

---

## Gap 1 — `agents/skill_creator.rs` does not exist

**Target:** Layer 2 (`agents/skill_creator.rs`) is the single place that knows
how to configure and launch the skill-creator agent. No deps on `commands::` —
imports only from `agents/openhands_server/`, `agents/runtime_config`, and
`skill_paths`.

**Current state:** This file does not exist. The two config builders
(`build_refine_openhands_config` in `commands/refine/mod.rs` and
`build_skill_creator_workflow_runtime_config` in
`commands/workflow/runtime.rs`) are separate, diverged, and live in Layer 3.

**Fix:** Create `app/src-tauri/src/agents/skill_creator.rs` exporting:

`SKILL_CREATOR_USER_SUFFIX` — moves here from `commands/refine/mod.rs`.

`SkillCreatorConfigParams`:

```rust
pub struct SkillCreatorConfigParams<'a> {
    pub skill_name: &'a str,
    pub prompt: &'a str,
    pub workspace_path: &'a str,
    pub plugin_slug: &'a str,
    pub llm: WorkflowLlmConfig,
    pub task_kind: &'a str,
    pub run_source: &'a str,
    pub allowed_tools: Vec<String>,
    pub max_turns: u32,
    pub step_id: i32,
    pub output_format: Option<serde_json::Value>,
}
```

`step_id` convention is in [README.md](README.md#step_id-convention).
`workflow_session_id` is intentionally absent — cost queries group by
`skill_name + step_id` only.

`build_skill_creator_config`:

```rust
pub fn build_skill_creator_config(params: SkillCreatorConfigParams<'_>) -> OpenHandsRuntimeConfig
```

Derives `workspace_run_dir` from `workspace_skill_dir(workspace_path, plugin_slug, skill_name)`,
sets `agent_name: "skill-creator"`, applies `SKILL_CREATOR_USER_SUFFIX`,
delegates to `build_openhands_runtime_config`.

`ensure_skill_session`:

```rust
pub async fn ensure_skill_session(
    app: &tauri::AppHandle,
    config: OpenHandsRuntimeConfig,
    saved_conversation_id: Option<String>,
) -> Result<String, String>
```

Wraps `ensure_openhands_server` + `start_openhands_session` in the correct
sequence. All callers use this instead of calling `start_openhands_session`
directly.

---

## Gap 2 — `dispatch_persistent_skill_turn` bypasses `ensure_openhands_server`

**Target:** All product surfaces call `ensure_skill_session`, which wraps
`ensure_openhands_server` + `start_openhands_session`. The server lifecycle
check always runs before a session is opened.

**Current state:** `dispatch_persistent_skill_turn` in
`commands/workflow/runtime.rs` calls `start_openhands_session` directly,
skipping the server lifecycle check.

**Fix:** Update `dispatch_persistent_skill_turn` to call
`skill_creator::ensure_skill_session` instead of `start_openhands_session`.

---

## Gap 3 — `skill_session.rs` and `refine/mod.rs` still use `Refine*` names

**Target:** All session management types and helpers in
`commands/skill_session.rs` use `Skill*` names. `commands/refine/mod.rs` is a
thin Layer 3 caller with no config builders or re-exports of `Refine*` names.

**Current state:**

| Current name | Target name |
|---|---|
| `RefineSession` | `SkillSession` |
| `RefineSessionManager` | `SkillSessionManager` |
| `refine_session_key` | `skill_session_key` |
| `upsert_refine_session` | `upsert_skill_session` |
| `remove_refine_sessions_for_skill` | `remove_skill_sessions` |
| `restore_refine_conversation_state` | `restore_skill_conversation_state` |

**Fix in `commands/skill_session.rs`:** Apply the renames above. Add
`build_skill_session_config` as a thin wrapper over
`skill_creator::build_skill_creator_config` with workspace-fixed params:
`task_kind: "refine"`, `step_id: -10`,
`allowed_tools: ["file_editor", "terminal"]`, `max_turns: 500`,
`run_source: "refine"`. Update `select_skill_openhands_session` to call
`skill_creator::ensure_skill_session` instead of
`ensure_openhands_server` + `start_openhands_session`.

Signature:
```rust
pub fn build_skill_session_config(
    skill_name: &str,
    plugin_slug: &str,
    prompt: &str,
    workspace_path: &str,
    llm: WorkflowLlmConfig,
) -> OpenHandsRuntimeConfig
```

**Fix in `commands/refine/mod.rs`:** Update re-exports to the renamed symbols.

**Callers across the codebase:**

| File | Change |
|---|---|
| `lib.rs` | `RefineSessionManager` → `SkillSessionManager` |
| `commands/skill/crud.rs` | `RefineSessionManager` → `SkillSessionManager` |
| `commands/refine/output.rs` | `RefineSessionManager` → `SkillSessionManager` |
| `commands/refine/tests.rs` | `build_refine_openhands_config` → `build_skill_session_config` |
| `skill_session.rs` unit tests | test function names updated to match renamed helpers |

---

## Gap 4 — `commands/refine/mod.rs` owns Layer 2 code

**Target:** `commands/refine/mod.rs` is a thin Layer 3 caller. It does not own
the OpenHands config builder, the runtime-ready check, or the user suffix.

**Current state:**

- `build_refine_openhands_config` — Layer 2 concern, lives in Layer 3
- `ensure_refine_runtime_ready` — needs rename to `ensure_skill_runtime_ready`;
  stays in Layer 3 but moves to `commands/skill_session.rs`
- `SKILL_CREATOR_USER_SUFFIX` — belongs in `agents/skill_creator.rs`

**Fix:** Delete `build_refine_openhands_config` (replaced by
`skill_creator::build_skill_creator_config`). Move
`ensure_refine_runtime_ready` → `ensure_skill_runtime_ready` into
`commands/skill_session.rs`. Move `SKILL_CREATOR_USER_SUFFIX` into
`agents/skill_creator.rs`.

---

## Gap 5 — `workflow/runtime.rs` has a parallel skill-creator config builder

**Target:** All skill-creator config construction goes through
`skill_creator::build_skill_creator_config`. Step-specific wrappers in
`workflow/runtime.rs` are thin callers of that unified builder.

**Current state:** `SkillCreatorWorkflowConfigParams` and
`build_skill_creator_workflow_runtime_config` are a separate, diverged
implementation of the config builder that lives entirely in
`commands/workflow/runtime.rs`.

**Fix:** Delete `SkillCreatorWorkflowConfigParams` and
`build_skill_creator_workflow_runtime_config`. The five step wrappers stay but
delegate to `skill_creator::build_skill_creator_config`:

- `build_workflow_research_runtime_config`
- `build_workflow_detailed_research_runtime_config`
- `build_workflow_confirm_decisions_runtime_config`
- `build_workflow_generate_skill_runtime_config`
- `build_answer_evaluator_runtime_config`

## PR 1 scope note

Gaps 1–5 are one PR. All Tauri command names, IPC contracts, frontend code,
agent behavior, and runtime semantics are unchanged — this is a pure structural
refactor. The one functional change is that `dispatch_persistent_skill_turn`
now calls `ensure_openhands_server` via `ensure_skill_session`, correcting a
pre-existing gap rather than changing intended behavior.

---

## Gap 6 — `leaveCurrentSkill` still stops the Agent Server (deferred)

**Target:** `leaveCurrentSkill` is three steps: pause conversation, release
lock, clear UI. The server stays alive between skill switches.

**Current state:** `leaveCurrentSkill` in
`app/src/lib/active-skill-transition.ts` calls `stopOpenHandsServer()` as a
fourth step. The `stop_openhands_server` Tauri command in
`commands/runtime_lifecycle.rs` becomes dead code once this is removed.

**Fix (deferred PR 2):** Remove `stopOpenHandsServer()` from `leaveCurrentSkill`.
Delete the `stop_openhands_server` Tauri command and its registration.

---

## Gap 7 — `workflow_session_id` is still in the runtime contracts

**Target:** `workflow_session_id` is absent from `OpenHandsRuntimeConfig` and
all generated contracts. Cost and usage queries group by `skill_name + step_id`
only.

**Current state:** `workflow_session_id` is present in
`app/src-tauri/src/contracts/` and the generated TypeScript types. It is
passed through the runtime config to OpenHands but provides no query value
beyond `skill_name + step_id`.

**Fix (follow-on codegen PR):** Remove `workflow_session_id` from the contracts
struct, run `npm run codegen` to regenerate TypeScript types and the Rust
schema, and update all callers.

---

## Gap 8 — Event recovery has multiple modes; target is always-FullHistory

**Target:** `OpenHandsSendMessage` always replays full conversation history after
send. No per-surface recovery mode selection. One code path, same behavior for
Workflow and Refine.

**Current state:** `agents/openhands_server/mod.rs` has three
`EventRecoveryMode` variants — `None`, `FullHistory`, and `Delta` — plus a
pre-send watermark collection path used by `Delta`. Different surfaces may
select different modes, adding complexity with no product benefit.

**Fix:** Collapse to a single `FullHistory` replay path. Delete
`EventRecoveryMode::Delta`, `EventRecoveryMode::None`, and the
`collect_event_watermark_keys` / `filter_events_after_watermark` watermark
logic in `agents/openhands_server/mod.rs`. All callers that previously set a
non-`FullHistory` mode are updated to use `FullHistory`.

---

## Gap 9 — Node sidecar cleanup is already complete on `main`

**Status:** Resolved outside this refactor.

The tracked Node sidecar package and its packaging/CI wiring have already been
removed on `main`. If a local checkout still shows `app/sidecar/`, treat it as
workspace residue and delete it before starting the runtime-model refactor.

---

## Gap 10 — Skill activation blocks on session boot

**Target:** Skill activation splits into a sync phase (lock + navigate) and an
async background phase (server ensure + conversation resolve + history hydration).
The UI navigates immediately and shows a skeleton while the session boots.
Full spec: [optimistic-session-activation.md](optimistic-session-activation.md).

**Current state:** `activateSkill` in `app/src/components/layout/app-layout.tsx`
calls `selectSkillOpenHandsSession` synchronously before navigating. The UI
blocks for 2–5s on a cold Agent Server start before the target page appears.

**Fix:** Split `activateSkill` into sync and async phases. Sync: `acquireLock`,
`setSelectedWorkspaceSkillName`, `navigate`. Async (background):
`selectSkillOpenHandsSession`, `hydrateSelectedSkillOpenHandsSession`,
`setActiveSessionSkillName`. Add a `conversationId` null-guard to the loading
state in `WorkflowPage` and `WorkspaceRoutePage` so they hold the skeleton
until the background boot completes. On failure: toast, navigate to `/`,
release lock.
