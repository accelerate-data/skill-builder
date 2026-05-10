# Implementation Gaps

This document tracks the delta between the target architecture (described in
[README.md](README.md)) and the current codebase. Use it to scope implementation
PRs and to verify when the target state has been reached.

See [skill-creator-config-unification.md](skill-creator-config-unification.md)
for the full implementation spec covering gaps 1–5.

---

## Gap 1 — `agents/skill_creator.rs` does not exist

**Target:** Layer 2 (`agents/skill_creator.rs`) is the single place that knows
how to configure and launch the skill-creator agent. It exports
`SkillCreatorConfigParams`, `build_skill_creator_config`,
`ensure_skill_session`, and `SKILL_CREATOR_USER_SUFFIX`.

**Current state:** This file does not exist. The two config builders
(`build_refine_openhands_config` in `commands/refine/mod.rs` and
`build_skill_creator_workflow_runtime_config` in
`commands/workflow/runtime.rs`) are separate, diverged, and live in Layer 3.

**Fix:** Create `app/src-tauri/src/agents/skill_creator.rs` with the unified
struct and builders. Delete the diverged Layer 3 builders.

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

## Gap 3 — Naming: `skill_session.rs` still uses `Refine*` names

**Target:** All session management types and helpers in
`commands/skill_session.rs` use `Skill*` names.

**Current state:**

| Current name | Target name |
|---|---|
| `RefineSession` | `SkillSession` |
| `RefineSessionManager` | `SkillSessionManager` |
| `refine_session_key` | `skill_session_key` |
| `upsert_refine_session` | `upsert_skill_session` |
| `remove_refine_sessions_for_skill` | `remove_skill_sessions` |
| `restore_refine_conversation_state` | `restore_skill_conversation_state` |

**Callers to update:** `lib.rs`, `commands/skill/crud.rs`,
`commands/refine/output.rs`, `commands/refine/mod.rs` (re-exports).

---

## Gap 4 — `commands/refine/mod.rs` has Layer 2 and Layer 3 code mixed

**Target:** `commands/refine/mod.rs` is a thin Layer 3 caller. It does not own
the OpenHands config builder, the runtime-ready check, or the user suffix.

**Current state:**

- `build_refine_openhands_config` — Layer 2 concern, lives in Layer 3
- `ensure_refine_runtime_ready` — needs rename to `ensure_skill_runtime_ready`;
  stays in Layer 3 but moves to `commands/skill_session.rs`
- `SKILL_CREATOR_USER_SUFFIX` — belongs in `agents/skill_creator.rs`

**Fix:** Delete `build_refine_openhands_config` (replaced by the unified
builder). Move `ensure_refine_runtime_ready` → `ensure_skill_runtime_ready`
into `commands/skill_session.rs`. Move `SKILL_CREATOR_USER_SUFFIX` into
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
`build_skill_creator_workflow_runtime_config`. Update the five step wrappers
(`build_workflow_research_runtime_config`,
`build_workflow_detailed_research_runtime_config`,
`build_workflow_confirm_decisions_runtime_config`,
`build_workflow_generate_skill_runtime_config`,
`build_answer_evaluator_runtime_config`) to call
`skill_creator::build_skill_creator_config` directly.

---

## Gap 6 — `leaveCurrentSkill` still stops the Agent Server (deferred PR 2)

**Target:** `leaveCurrentSkill` is three steps: pause conversation, release
lock, clear UI. The server stays alive between skill switches.

**Current state:** `leaveCurrentSkill` in
`app/src/lib/active-skill-transition.ts` calls `stopOpenHandsServer()` as a
fourth step. The frontend `stop_openhands_server` Tauri command in
`commands/runtime_lifecycle.rs` becomes dead code once this is removed.

**Fix (deferred):** Remove the `stopOpenHandsServer()` call from
`leaveCurrentSkill`. Delete the `stop_openhands_server` Tauri command and its
registration.

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
struct, run codegen to regenerate TypeScript types and the Rust schema, and
update all callers.

---

## Gap 8 — Node sidecar still exists in the repo

**Target:** The `app/sidecar/` package is removed. The Rust process and
OpenHands Agent Server are the only runtime. TypeScript contract ownership is
explicit without any dependency on `app/sidecar/`. Rust modules use
runtime-oriented names instead of `sidecar`.

**Current state:** `app/sidecar/` still exists. Packaging, CI, and release
scripts still reference it. Some Rust module names (`agents/sidecar.rs`,
`SidecarConfig`, etc.) still use `sidecar` terminology.

**Fix (separate PR):** Delete `app/sidecar/`. Update packaging and CI. Rename
Rust modules and types to remove `sidecar` in favor of runtime-oriented names
(`runtime_config.rs`, `OpenHandsRuntimeConfig`, etc.). Update docs, repo-map,
TEST_MAP, and AGENTS.md.
