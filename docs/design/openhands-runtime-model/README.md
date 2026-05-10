---
functional-specs: [custom-plugin-management]
---

# OpenHands Runtime Model

> **Status:** Draft
> **Functional specs:** Not applicable; this design defines the runtime model shared by Workflow, Refine, create-skill validation, and Eval Workbench.

## Design Principles

1. **One model** — a single `SkillCreatorConfigParams` struct and `build_skill_creator_config` function is the only way to build an OpenHands config for any skill-creator run.
2. **Same primitives** — all product surfaces go through the same call sequence: `ensure_skill_session` → `OpenHandsSendMessage` → `PauseOpenHandsSession`.
3. **Clean separation** — the OpenHands interaction model lives in `agents/`; app-specific setup (workspace dirs, DB reads, Tauri commands) lives in `commands/`.

## Three-Layer Architecture

```text
commands/                    ← Layer 3: app commands (Tauri IPC, DB, workspace setup)
agents/skill_creator.rs      ← Layer 2: skill creator model (config, session sequence)
agents/openhands_server/     ← Layer 1: raw OpenHands API (HTTP, server lifecycle)
```

Each layer imports only from layers below it. `commands/` never reaches into `agents/openhands_server/` directly — it goes through Layer 2.

### Layer 1 — Raw OpenHands API (`agents/openhands_server/`)

The raw primitives. No product concepts here.

| Primitive | Purpose |
|---|---|
| `ensure_openhands_server` | Start or reuse the cached Agent Server process for a given runtime root. |
| `start_openhands_session` | Resolve or create a persistent conversation for a skill. |
| `send_openhands_message` | Append a user message to an existing persistent conversation and run it. |
| `pause_openhands_conversation` | Pause active execution without deleting the conversation. |
| `list_openhands_conversation_events` | Fetch all events for a conversation (used during session restore). |
| `shutdown_agent_server` | Stop the cached Agent Server process. |

Rules:

- `ensure_openhands_server` is conversation-free — it must not create a conversation.
- `start_openhands_session` owns resume-or-create behavior.
- A successfully completed turn does not auto-pause. The conversation remains persisted and idle.
- `shutdown_agent_server` is a process-lifecycle primitive, not a conversation-turn primitive.

### Layer 2 — Skill Creator Model (`agents/skill_creator.rs`)

The single place that knows how to configure and launch the skill-creator agent. No deps on `commands::`.

| Export | Purpose |
|---|---|
| `SkillCreatorConfigParams` | Unified params struct for every skill-creator run. |
| `build_skill_creator_config` | Builds `OpenHandsRuntimeConfig` from params. |
| `ensure_skill_session` | Wraps `ensure_openhands_server` + `start_openhands_session` in the correct sequence. |
| `SKILL_CREATOR_USER_SUFFIX` | Per-message suffix applied to every skill-creator turn. |

`ensure_skill_session` is the enforced entry point. All product surfaces call it instead of the Layer 1 primitives directly — this guarantees the server lifecycle check always runs before a session is opened.

See [implementation-gaps.md](implementation-gaps.md) Gap 1 for the struct definition and function signatures.

### Layer 3 — App Commands (`commands/`)

Product-specific Tauri commands and orchestration. Responsible for:

- validating user-facing inputs
- loading workspace and model context from the DB
- building task prompts
- choosing persistent vs throwaway session behavior
- parsing terminal outputs into app-owned result contracts

Layer 3 exports:

| Export | Location | Purpose |
|---|---|---|
| `ensure_skill_runtime_ready` | `commands/skill_session.rs` | Validates the app runtime is initialized, ensures prompts are deployed, and ensures the canonical skill directory exists. Returns `InitializedRuntimeContext` (workspace path + LLM config). Layer 3 concern because it reads from the DB and touches app-owned paths. |
| `build_skill_session_config` | `commands/skill_session.rs` | Thin wrapper over `skill_creator::build_skill_creator_config` with refine-fixed params: `task_kind: "refine"`, `step_id: -10`, `allowed_tools: ["file_editor", "terminal"]`, `max_turns: 500`, `run_source: "refine"`. |

**Dispatch exception:** Layer 3 may call Layer 1 dispatch primitives (`send_openhands_message`, `pause_openhands_conversation`) directly for one-shot turn operations. These do not need Layer 2 helpers — they operate on an already-booted session and only append/pause. Layer 2 is required for session boot (`ensure_skill_session`) and config construction (`build_skill_creator_config`), not for individual turn dispatch.

## Runtime Roots

The target model has two durable roots:

| Root | Purpose |
|---|---|
| `{app_data_root}` | App-owned runtime state. Contains `openhands/`, the SQLite DB, and app documents directly at the root. There is no extra `workspace/` wrapper directory. |
| `{skills_root}` | Canonical authored skill tree. OpenHands conversations set `workspace.working_dir` to a canonical skill directory under this root. |

`workspaceSkillDir` is not part of the target model. A skill conversation works directly in the canonical skill directory:

`{skills_root}/{plugin_slug}/skills/{skill_name}`

## Persistent vs Throwaway Sessions

### Persistent Session

Use when the product wants later turns to reuse the same skill-bound conversation.

```text
ensure_skill_session          → starts or resumes the conversation
OpenHandsSendMessage          → dispatches one turn; conversation stays alive after completion
PauseOpenHandsSession         → only on explicit user stop during an active run
```

Properties:

- conversation survives between turns and between skill selections
- the DB stores the durable `conversation_id` per skill
- completed turns do not require an explicit pause

### Throwaway Session

Use when the result is a bounded derived artifact and no later reply is expected.

```text
RunThrowawayOpenHandsSession  → create, run to completion, parse result
```

Properties:

- no saved `conversation_id`
- runtime files may be kept for debugging but are not resumable product state
- the conversation still uses the canonical skill directory as `workspace.working_dir`

## Selected-Skill Bootstrap Contract

Selected-skill activation owns the persistent session bootstrap sequence:

1. resolve the canonical skill directory
2. call `ensure_skill_session` with the saved `conversation_id` from the DB
3. restore visible transcript history from the conversation events

The runtime is app-scoped: `OH_CONVERSATIONS_PATH` points at `{app_data_root}/openhands/conversations/` and `OH_BASH_EVENTS_DIR` points at `{app_data_root}/openhands/bash_events/`. Both are fixed for the lifetime of the app data root — they do not change between skill switches. The cached Agent Server is reused across skill switches; it only restarts on process crash or failed health probe. Skill-specific file access is provided by `workspace.working_dir` in each conversation's `POST /api/conversations` body, and that working dir is always the canonical skill directory. The DB is the durable source of truth for the saved `conversation_id`.

See [optimistic-session-activation.md](optimistic-session-activation.md) for the async optimization of this sequence.

## Active Skill Leave Contract

Every UI path that leaves the current skill uses the same shared leave sequence:

1. pause the current persistent conversation (`pause_openhands_session`)
2. release the current skill lock
3. clear app-level UI state

The server stays alive after leave. The next skill's bootstrap calls `ensure_skill_session`, which reuses the running server against the same app-scoped `openhands/` storage.

Failure policy:

- if pause fails, the current skill stays visible and the next skill does not bootstrap
- if lock release fails, the current skill stays visible and the next skill does not bootstrap

## App Shutdown Contract

1. release skill locks and end workflow sessions owned by the current app instance
2. call `shutdown_agent_server` (graceful-first, forced-kill fallback after 5s)

The `RunEvent::Exit` handler repeats lock release and server shutdown as a belt-and-suspenders safety net.

## Stable Persistence Secret

Persistent conversations depend on an app-scoped encryption key at `{app_data_root}/openhands/secret.key`. This key is stable across Agent Server restarts. `SESSION_API_KEY` is separate — it is per-process request authentication only, not used for conversation encryption.

## Runtime Ownership

| Path | Owner | Purpose |
|---|---|---|
| `{app_data_root}/openhands/secret.key` | Rust process lifecycle | Stable encryption key across all skills. |
| `{app_data_root}/openhands/conversations/` | Rust + Agent Server | All skill conversations (`OH_CONVERSATIONS_PATH`). Conversation identity is shared here; skill-specific file access comes from `workspace.working_dir`. |
| `{app_data_root}/openhands/bash_events/` | Rust + Agent Server | Bash event logs for all conversations (`OH_BASH_EVENTS_DIR`). |
| `{app_data_root}/openhands/logs/` | Rust | Agent Server stderr logs. |
| `{skills_root}/{plugin_slug}/skills/{skill_name}` | Product-owned authored content | Canonical skill directory. OpenHands sets this as `workspace.working_dir`, reads `.agents/` here, and edits skill files here directly. |
| `{app_data_root}/skill-builder.db` | Rust + SQLite | Durable metadata and conversation bindings. |
| `{app_data_root}/documents/` | Rust product lifecycle | App-managed document artifacts. |

## Agent Construction Contract

Skill Builder uses one top-level agent identity: `skill-creator`.

| Input | Source | OpenHands destination |
|---|---|---|
| main agent instructions | `agent-sources/workspace/agents/skill-creator.md` | `agent_context.system_message_suffix` |
| file-based skills | `agent-sources/workspace/skills/**` | `agent_context.skills` |
| per-message suffix | `SKILL_CREATOR_USER_SUFFIX` (`agents/skill_creator.rs`) | `agent_context.user_message_suffix` |
| task prompt | rendered by each product command | message content |
| tools | `allowed_tools` in `SkillCreatorConfigParams` | `agent.tools` |

See [tools-included.md](tools-included.md) for tool policy.

## `step_id` Convention

| Context | `step_id` |
|---|---|
| Workflow step 0–3 | `0`, `1`, `2`, `3` |
| Answer evaluator | `-1` |
| Workspace (refine) | `-10` |

Cost and usage queries group by `skill_name + step_id`. A per-invocation session ID is not needed.

## Active Product Surface Mapping

### Persistent surfaces

| Surface | Product command | Primitive path |
|---|---|---|
| Skill activation | `select_skill_openhands_session` | `ensure_skill_session` → restore history |
| Workflow step | `run_workflow_step` | `OpenHandsSendMessage` |
| Workflow gate | `run_answer_evaluator` | `OpenHandsSendMessage` |
| Refine turn | `send_refine_message` | `OpenHandsSendMessage` |
| Skill leave | `pause_openhands_session` | `PauseOpenHandsSession` |

### Throwaway surfaces

| Surface | Product command | Primitive path |
|---|---|---|
| Scope validation | `review_skill_scope` | `RunThrowawayOpenHandsSession` |
| Eval scenario definition | `define_eval_scenario` | `RunThrowawayOpenHandsSession` |

## Workflow Prompt Routing

| Step | Task kind |
|---|---|
| Scope validation | `scope_review` |
| Step 0 research | `workflow.research` |
| Step 1 detailed research | `workflow.detailed_research` |
| Answer evaluation | `workflow.answer_evaluator` |
| Step 2 confirm decisions | `workflow.confirm_decisions` |
| Step 3 generate skill | `workflow.skill_generation` |
| Refine turn | `refine` |

## Event Replay

Every `OpenHandsSendMessage` call replays full conversation history after send. All surfaces use the same replay path — there is no per-surface recovery mode. This keeps the runtime simple and ensures the visible transcript is always consistent with the durable conversation state.

## Event Model

| OpenHands event | Skill Builder event |
|---|---|
| running | `conversation_state(status = "running")` |
| message / tool / action / observation | `conversation_event` |
| completed | terminal `conversation_state(status = "completed")` |
| error | terminal `conversation_state(status = "error")` |
| paused / cancelled | terminal `conversation_state(status = "cancelled")` |

## Child Docs

| Doc | Purpose |
|---|---|
| [optimistic-session-activation.md](optimistic-session-activation.md) | Async skill bootstrap optimization: navigate before server ready. |
| [tools-included.md](tools-included.md) | Tool policy for OpenHands requests. |
| [implementation-gaps.md](implementation-gaps.md) | Gaps between the target design and the current codebase. |
