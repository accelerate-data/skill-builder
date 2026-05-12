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

## Model Catalog Relationship

OpenHands does not own model discovery or filtering. The backend resolves the
final provider/model selection through the model catalog subsystem documented in
[`../model-catalog/README.md`](../model-catalog/README.md), then passes that
resolved selection into `OpenHandsRuntimeConfig`.

## Three-Layer Architecture

```text
commands/                    ← Layer 3: app commands (Tauri IPC, DB, workspace setup)
agents/skill_creator.rs      ← Layer 2: skill creator model (config, session sequence)
agents/openhands_server/     ← Layer 1: raw OpenHands API (HTTP, server lifecycle)
```

Each layer imports only from layers below it. `commands/` never reaches into
`agents/openhands_server/` directly — it goes through Layer 2.

### Layer 1 — Raw OpenHands API (`agents/openhands_server/`)

The raw primitives. No product concepts here.

| Primitive | Purpose |
|---|---|
| `ensure_openhands_server` | Start or reuse the cached Agent Server process for a given runtime root. |
| `start_openhands_session` | Resolve or create a persistent conversation for a skill and hydrate prior events when resuming. |
| `send_openhands_message` | Append a user message to an existing persistent conversation and run it. |
| `pause_openhands_conversation` | Pause active execution without deleting the conversation. |
| `shutdown_agent_server` | Stop the cached Agent Server process. |

Rules:

- `ensure_openhands_server` is conversation-free — it must not create a conversation.
- `start_openhands_session` owns resume-or-create behavior.
- `start_openhands_session` also owns resume hydration. Reused conversations return prior events; newly created conversations return empty history.
- A successfully completed turn does not auto-pause. The conversation remains persisted and idle.
- `shutdown_agent_server` is a process-lifecycle primitive, not a conversation-turn primitive.

### Layer 2 — Skill Creator Model (`agents/skill_creator.rs`)

The single place that knows how to configure and launch the skill-creator
agent. No deps on `commands::`.

| Export | Purpose |
|---|---|
| `SkillCreatorConfigParams` | Unified params struct for every skill-creator run. |
| `build_skill_creator_config` | Builds `OpenHandsRuntimeConfig` from params. |
| `ensure_skill_session` | Wraps `ensure_openhands_server` + `start_openhands_session` in the correct sequence and returns the conversation plus any restored resume history. |
| `SKILL_CREATOR_USER_SUFFIX` | Per-message suffix applied to every skill-creator turn. |

`ensure_skill_session` is the enforced entry point. All product surfaces call it
instead of the Layer 1 primitives directly — this guarantees the server
lifecycle check always runs before a session is opened.

The struct definition and function signatures are in
`app/src-tauri/src/agents/skill_creator.rs`.

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
| `ensure_skill_runtime_ready` | `commands/skill_session.rs` | Validates the app runtime is initialized, ensures prompts are deployed, and ensures the canonical skill directory exists. Returns `InitializedRuntimeContext` (skills root + LLM config). |
| `build_skill_session_config` | `commands/skill_session.rs` | Thin wrapper over `skill_creator::build_skill_creator_config` with product-owned defaults. |

## Selected-Skill Bootstrap Contract

Selected-skill activation owns the persistent session bootstrap sequence:

1. resolve the canonical skill row from `skill_id`
2. acquire or verify the skill lease in the backend before any OpenHands session work
3. resolve the canonical skill directory
4. call `ensure_skill_session` with the saved `conversation_id` from the DB
5. hydrate the visible transcript from the restored events returned by `ensure_skill_session`

The lease boundary is backend-owned. The frontend may show advisory lock state
in the menu, but it must not be the enforcement boundary for selected-skill
bootstrap.

## App Shutdown Contract

1. release skill locks and end workflow sessions owned by the current app instance
2. call `shutdown_agent_server` (graceful-first, forced-kill fallback after 5s)

The `RunEvent::Exit` handler repeats lock release and server shutdown as a
belt-and-suspenders safety net.
