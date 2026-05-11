---
functional-specs: [custom-plugin-management]
---

# Implementation Gaps

This document tracks the delta between the target architecture (described in
[README.md](README.md)) and the current codebase. Use it to scope implementation
PRs and to verify when the target state has been reached.

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
| `RefineSessionInfo` | `SkillSessionInfo` |

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
| `types/refine.rs` | `RefineSessionInfo` → `SkillSessionInfo` |

---

## Closed Gaps

The following gaps have been resolved and are kept here as historical context:

- **Gap 1** — `agents/skill_creator.rs` created (PR 1)
- **Gap 2** — `dispatch_persistent_skill_turn` uses `ensure_skill_session` (PR 1)
- **Gap 4** — `commands/refine/mod.rs` is now a thin Layer 3 caller (PR 1)
- **Gap 5** — `workflow/runtime.rs` delegates to `skill_creator::build_skill_creator_config` (PR 1)
- **Gap 6** — `stopOpenHandsServer` removed from TS/RS codebases (PR 2)
- **Gap 7** — `workflow_session_id` absent from contracts and frontend; retained in Rust DB layer
- **Gap 8** — Event recovery unified; `send_openhands_message` no longer replays history
- **Gap 9** — Node sidecar removed from `main`
- **Gap 10** — Optimistic session activation implemented
- **Gap 11** — Shared `.openhands` storage and no-restart skill switching (PR 6)
- **Gap 12** — Runtime CWD uses canonical `skill_dir` (PR 12)
- **Gap 13** — Flat app storage; `.agents` no longer mirrored (PR 12)
