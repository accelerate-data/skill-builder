---
functional-specs: []
---

# OpenHands Runtime Model

> **Status:** Draft
> **Functional specs:** Not applicable; this design defines the runtime model
> shared by Workflow, Refine, create-skill validation, and Eval Workbench.

## Overview

Skill Builder integrates with OpenHands through two layers:

1. **Frontend -> Backend API**
   Product-specific Tauri commands such as `run_workflow_step`,
   `start_refine_session`, `review_skill_scope`, and `define_eval_scenario`.
2. **Backend -> OpenHands API**
   A small set of runtime primitives that create or resume OpenHands
   conversations, send messages, pause active execution, or run disposable
   throwaway conversations.

The key model is that OpenHands always operates on a conversation-backed
session. The important product distinction is not "one-shot" versus
"streaming" as separate OpenHands concepts. The distinction is whether Skill
Builder keeps the conversation alive for future user-visible turns or treats it
as a throwaway session that is deleted after one bounded run.

## Design Scope

**Covers**

- The two-layer runtime contract: frontend/backend product APIs and
  backend/OpenHands session APIs.
- Persistent versus throwaway OpenHands session semantics.
- Workspace ownership, Agent Server ownership, and session persistence.
- The command-to-runtime mapping for Workflow, Refine, create-skill flows, and
  Eval Workbench.
- Main-agent prompt ownership, suffix wiring, subagent registration, and tool
  exposure.
- Workflow step routing where it affects runtime behavior.

**Does not cover**

- Product behavior source-of-truth for individual user flows.
- Implementation sequencing or migration steps.
- Prompt wording details beyond ownership and routing.
- Eval rubric design or Promptfoo package behavior.

## Key Decisions

| Decision | Rationale |
|---|---|
| Model OpenHands around sessions, not ad hoc one-shot helpers. | OpenHands is conversation-backed in both persistent and throwaway cases. The product should name the actual lifecycle boundary. |
| Keep two explicit layers: product commands and runtime primitives. | Frontend surfaces should call product-specific commands; only the backend should speak in raw OpenHands session terms. |
| Use four backend -> OpenHands primitives. | The runtime only needs `StartOpenHandsSession`, `OpenHandsSendMessage`, `PauseOpenHandsSession`, and `RunThrowawayOpenHandsSession`. Everything else is product orchestration. |
| Persistent session reuse is skill-scoped. | Workflow, Refine, and skill-bound eval-definition flows should accumulate context on the same skill conversation instead of rebuilding context each turn. |
| Throwaway sessions are reserved for bounded execution tasks. | Scope validation and eval execution create a conversation, run it, collect the terminal result, and then delete it. |
| Rust owns Agent Server lifecycle and workspace selection. | The backend already owns persistence, filesystem policy, event delivery, logging, and cancellation. |
| The frontend never calls OpenHands-shaped APIs directly. | Product APIs stay stable even if the runtime implementation changes. |
| `skill-creator.md` is always sent through `system_message_suffix`. | The main agent should preserve the default OpenHands system prompt while deterministically appending Skill Builder's stable instructions. |
| `skill-creator-user-suffix.txt` remains app-owned and additive. | Per-message invariants are a backend control surface and should not be embedded in task prompts. |
| Tool exposure is runtime-owned and centrally defined. | Prevent per-surface tool drift and keep product commands focused on task semantics. |

## Core Concepts

### Product Command Layer

This is the **frontend -> backend** contract. These commands are shaped around
product surfaces, not OpenHands transport details.

Examples:

- `run_workflow_step`
- `run_answer_evaluator`
- `start_refine_session`
- `send_refine_message`
- `pause_refine_session`
- `close_refine_session`
- `review_skill_scope`
- `define_eval_scenario`
- `build_refine_improvement_brief`
- `run_eval_workbench`

Each command is responsible for:

- validating user-facing inputs
- loading backend-owned workspace and model context
- building the correct task prompt and `SidecarConfig`
- choosing persistent versus throwaway session behavior
- parsing terminal outputs into app-owned result contracts

### Runtime Primitive Layer

This is the **backend -> OpenHands** contract.

| Primitive | Purpose |
|---|---|
| `StartOpenHandsSession` | Create or resume a persistent OpenHands conversation for a skill-scoped session. |
| `OpenHandsSendMessage` | Append a user message to an existing persistent conversation and run it. |
| `PauseOpenHandsSession` | Pause active execution on a persistent conversation without deleting it. |
| `RunThrowawayOpenHandsSession` | Create a bounded conversation, run it to completion, collect the result, and delete it. |

These primitives are generic runtime concepts. They should not know about
Workflow step numbers, Refine UI state, or Eval Workbench entities.

Rules:

- `StartOpenHandsSession` owns resume-or-create behavior.
- `OpenHandsSendMessage` sends the next turn into an already-established
  persistent session.
- `PauseOpenHandsSession` is only for explicit user stop/cancel during an
  active run.
- A successfully completed turn does not auto-pause. The conversation remains
  persisted and idle.
- `RunThrowawayOpenHandsSession` is for bounded tasks with no later reply path.

## Two-Layer Model

```text
Frontend
  -> product-specific Tauri commands

Rust backend command layer
  -> validate inputs
  -> resolve workspace + model context
  -> render prompt + config
  -> choose persistent vs throwaway policy
  -> call OpenHands runtime primitive
  -> normalize events and parse results

OpenHands runtime layer
  -> Agent Server process
  -> REST conversation/session calls
  -> WebSocket event stream
```

### Frontend -> Backend API

The frontend should stay product-oriented:

- Workflow calls `run_workflow_step` and `run_answer_evaluator`.
- Refine calls `start_refine_session`, `send_refine_message`,
  `pause_refine_session`, and `close_refine_session`.
- Create Skill calls `review_skill_scope`.
- Eval Workbench calls eval scenario definition, eval execution, and
  refine-brief generation commands.

The frontend should not need to know whether a surface reuses a persistent
session or uses a throwaway one.

### Backend -> OpenHands API

The backend translates product commands into the minimal runtime operations:

- start or resume a persistent session
- send a message into that session
- pause that session
- run a disposable throwaway session

That layer owns:

- Agent Server process lifecycle
- OpenHands REST and WebSocket calls
- session persistence and deletion policy
- event normalization into `conversation_event` and `conversation_state`

## Persistent vs Throwaway Sessions

### Persistent Session

Use a persistent session when the product wants later turns to reuse the same
skill-bound conversation.

```text
open or resume session
  -> StartOpenHandsSession

normal product turn
  -> OpenHandsSendMessage
  -> run completes
  -> conversation remains persisted and idle

explicit user stop during active run
  -> PauseOpenHandsSession
```

Properties:

- conversation survives between turns
- conversation survives leaving the view
- prior context is intentionally preserved
- completed turns do not require an explicit pause
- app stores the current `conversation_id`

### Throwaway Session

Use a throwaway session when the result is a bounded derived artifact and the
user is not expected to continue talking to that same OpenHands conversation.

```text
product command
  -> RunThrowawayOpenHandsSession
  -> create conversation
  -> send one task message
  -> run to terminal state
  -> parse result
  -> delete conversation
```

Properties:

- no saved `conversation_id`
- no later user reply path
- the product keeps only the parsed output or evaluation result

## Session Ownership Model

### Workspace Ownership

| Folder | Owner | Purpose |
|---|---|---|
| `{data_dir}/workspace` | Rust startup/settings | App workspace root and pre-skill throwaway runs. |
| `{workspace}/{plugin_slug}/{skill_name}` | Rust product lifecycle | Skill-scoped working directory for Workflow and Refine. |
| `{workspace_skill_dir}/.agents/agents` | Rust deployment | OpenHands file-based agent definitions. |
| `{workspace_skill_dir}/.agents/skills` | Rust deployment | OpenHands AgentSkills. |
| `{workspace_skill_dir}/conversations` | Rust + Agent Server | Persistent conversation storage for the skill. |
| `{workspace_skill_dir}/logs` | Rust | App logs and transcripts. |

### Throwaway runtime workspaces

Throwaway runs still need a full OpenHands runtime workspace. They should not
reuse a skill-owned workspace directory or skill-owned `conversations/`
directory.

They still use the same top-level OpenHands agent identity as persistent
surfaces: `skill-creator`. The distinction is runtime workspace ownership,
resumability, and retention policy, not a different main agent.

Recommended shape:

```text
{workspace}/.openhands/throwaway/{surface}/{run_id}/
  .agents/
    agents/
    skills/
  conversations/
  logs/
```

Rules:

- throwaway runs get their own runtime directory outside
  `{workspace}/{plugin_slug}/{skill_name}`
- `.agents/agents` and `.agents/skills` are deployed into that throwaway run
  directory the same way they are for persistent skill workspaces
- throwaway conversations are stored under that run directory's
  `conversations/`
- throwaway runs are not saved in normal skill conversation state and are not
  resumable from product state
- throwaway artifacts may still be retained for debugging and cleaned up later
  by retention policy

### Agent Server Ownership

Rust owns Agent Server process lifecycle:

- bind on a random loopback port
- configure workspace and conversation roots
- manage auth when supported by the installed server
- shut the process down with the owning app or skill lifecycle

OpenHands owns:

- conversation execution
- run/pause behavior
- event streaming
- on-disk conversation state inside the configured conversations root

## Agent Construction Contract

### Main Agent

Skill Builder uses one top-level OpenHands agent identity: `skill-creator`.

| Input | Source | OpenHands destination |
|---|---|---|
| main agent instructions | `agent-sources/workspace/agents/skill-creator.md` | `agent_context.system_message_suffix` |
| file-based skills | `agent-sources/workspace/skills/**` | `agent_context.skills` |
| per-message suffix | `agent-sources/prompts/skill-creator-user-suffix.txt` | `agent_context.user_message_suffix` |
| task prompt | `agent-sources/prompts/*.txt` | message/event content |
| tools | backend runtime policy | `agent.tools` + `include_default_tools` |

### Subagents

Named subagents are runtime inputs, not frontend concepts.

- default subagent capability is exposed through `task_tool_set`
- named agents such as `skill-verifier` are sent through
  `agent_definitions` when a prompt may invoke them

### Tools

The default tool policy for OpenHands requests lives in the child doc:

- [tools-included.md](tools-included.md)

## Active Product Surface Mapping

### Persistent surfaces

| Product surface | Product command | OpenHands primitive mapping | Notes |
|---|---|---|---|
| Workflow step execution | `run_workflow_step` | `StartOpenHandsSession` -> `OpenHandsSendMessage` | Step-oriented UI, but should reuse one persistent skill conversation |
| Workflow gate evaluation | `run_answer_evaluator` | `StartOpenHandsSession` -> `OpenHandsSendMessage` | Part of the same workflow conversation, not a disposable side run |
| Refine session start | `start_refine_session` | `StartOpenHandsSession` | Owns resume-or-create and history restoration |
| Refine chat turn | `send_refine_message` | `OpenHandsSendMessage` | Sends the next user turn into the already-started session |
| Refine stop | `pause_refine_session` | `PauseOpenHandsSession` | Explicit user stop only |
| Eval scenario definition | `define_eval_scenario` | `StartOpenHandsSession` -> `OpenHandsSendMessage` | Skill-bound scenario definition should accumulate on the same conversation |
| Eval-to-refine brief | `build_refine_improvement_brief` | `StartOpenHandsSession` -> `OpenHandsSendMessage` | Skill-bound reasoning that benefits from conversation context |

### Throwaway surfaces

| Product surface | Product command | OpenHands primitive mapping | Notes |
|---|---|---|---|
| Create Skill scope validation | `review_skill_scope` | `RunThrowawayOpenHandsSession` | Bounded validation run, no later reply path |
| Eval execution | `run_eval_workbench` | `RunThrowawayOpenHandsSession` | Disposable evaluation execution |

### Product-only wrapper commands

| Product command | OpenHands primitive mapping | Notes |
|---|---|---|
| `close_refine_session` | none | Product-layer cleanup only; does not delete the persistent OpenHands conversation |

## Workflow Prompt Routing

Workflow-specific runtime behavior is selected by app-owned prompt templates and
task metadata, not by switching top-level agents.

| Operation | Prompt | Task kind |
|---|---|---|
| scope validation | `scope-review.txt` | `scope_review` |
| step 0 research | `research.txt` | `workflow.research` |
| step 1 detailed research | `detailed-research.txt` | `workflow.detailed_research` |
| answer evaluation | `answer-evaluator.txt` | `workflow.answer_evaluation` |
| step 2 confirm decisions | `confirm_decisions.txt` | `workflow.decision_confirmation` |
| step 3 generate skill | `skill-generation.txt` | `workflow.skill_generation` |

This keeps the runtime model stable while allowing task behavior to vary by
product operation.

## Event Model

The backend normalizes OpenHands events into app-owned envelopes.

| OpenHands event | Skill Builder event |
|---|---|
| conversation created / running | `conversation_state(status = "running")` |
| message/tool/action/observation event | `conversation_event` |
| completed run | terminal `conversation_state(status = "completed")` |
| errored run | terminal `conversation_state(status = "error")` |
| paused or cancelled run | terminal `conversation_state(status = "cancelled")` or pause-specific lifecycle handling |

This app-facing event model stays stable even if the internal OpenHands
transport details evolve.

## Relationship To Existing Design Specs

| Spec | Relationship |
|---|---|
| `docs/design/product-architecture/README.md` | Product-level entrypoint. This doc is the canonical runtime-model detail page. |
| `docs/design/model-settings/README.md` | Defines the app-owned `llm` configuration contract that this runtime consumes when building OpenHands requests. |
| `docs/design/workflow-artifact-storage/README.md` | Owns artifact persistence boundaries above this runtime model. |
| `docs/design/skill-scope-review/README.md` | Owns create-skill behavior. This doc defines the runtime shape that behavior uses. |
| `docs/design/openhands-event-display-projection/README.md` | Consumes the event model defined here for UI projection. |

## Dead Code Cleanup

The runtime model should describe only active product surfaces. The following
paths are no longer part of the intended surface model and should be removed as
cleanup work:

- `generate_suggestions`
- `WorkspaceDescription`
- `suggest_description_candidates`
- `apply_description_candidate`
- old trigger/comparison-specific Eval Workbench code that is no longer part of
  the live one-tab product surface

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/agents/openhands_server/mod.rs` | OpenHands runtime primitives, persistence policy, event orchestration, and throwaway/persistent session helpers. |
| `app/src-tauri/src/agents/openhands_server/process.rs` | Agent Server process lifecycle and environment wiring. |
| `app/src-tauri/src/agents/openhands_server/types.rs` | OpenHands request shape, tool list, suffix wiring, and agent definitions. |
| `app/src-tauri/src/agents/sidecar.rs` | Backend-owned request/config builder used by product commands. |
| `app/src-tauri/src/skill_paths.rs` | Runtime workspace path resolution for persistent skill workspaces and future throwaway runtime directories. |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Workflow product command orchestration. |
| `app/src-tauri/src/commands/refine/mod.rs` | Refine product command orchestration and session wrapper state. |
| `app/src-tauri/src/commands/skill/scope_review.rs` | Create-skill scope validation command. |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Eval Workbench command surface and runtime call sites. |
| `agent-sources/workspace/agents/skill-creator.md` | Main-agent instruction source. |
| `agent-sources/workspace/skills/` | Bundled AgentSkills deployed into `.agents/skills`. |
| `agent-sources/prompts/` | App-owned task prompts rendered by the backend. |

## Resolved Cleanup Direction

- Simplify Refine backend session state once persistent session start/resume is
  centralized. Keep only the minimal product-layer wrapper state needed for
  active-run control and UI lifecycle.
- Remove the old Eval Workbench trigger/comparison path as part of this
  migration rather than deferring it to a follow-up cleanup pass.
