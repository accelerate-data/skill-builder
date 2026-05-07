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
as a persistent skill conversation versus a non-resumable throwaway run. The
active runtime model in this branch is persistent-session preparation plus
throwaway runtime roots.

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
| Persistent session reuse now covers workflow, refine, and skill-bound eval authoring/diagnosis flows. | The branch routes workflow steps, answer evaluation, scenario definition, and refine-brief generation through the saved skill conversation model. |
| Throwaway sessions are reserved for bounded execution tasks. | Scope validation and eval execution run as non-resumable tasks whose runtime artifacts stay outside normal product conversation state. |
| The live Eval Workbench surface is currently performance-first. | The frontend exposes performance scenarios and performance eval runs; trigger-mode storage and execution code still exists below the live UI. |
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
| `RunThrowawayOpenHandsSession` | Create a bounded conversation, run it to completion, collect the result, and keep it outside resumable product state. |

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
```

Properties:

- no saved `conversation_id`
- no later user reply path
- the product keeps only the parsed output or evaluation result
- runtime files may be retained under `.openhands/throwaway/...` for debugging
  or later cleanup without becoming resumable product state

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

### Current implementation status

The current branch implements the split like this:

- workflow steps and `run_answer_evaluator` dispatch against the saved
  skill-scoped conversation
- `start_refine_session` validates saved refine conversation state, restores
  history when compatible, clears stale saved ids, and prepares a new
  persistent OpenHands conversation up front when none exists
- Eval Workbench scenario definition and refine-brief generation use a
  product-layer persistent-turn helper built on top of
  `start_openhands_session(...)` and `openhands_send_message(...)`
- scope review and live eval execution use isolated
  `.openhands/throwaway/...` runtime roots and do not save resumable product
  conversation ids
- the frontend currently exposes performance scenarios and performance eval
  execution only; trigger-mode runtime/data paths remain below the live UI

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
| Refine session start | `start_refine_session` | Persistent session preparation for `StartOpenHandsSession` | Restores compatible history, clears stale saved ids, and prepares the persistent OpenHands conversation before the first send |
| Refine chat turn | `send_refine_message` | `OpenHandsSendMessage` | Sends the next user turn into the prepared session |
| Refine stop | `pause_refine_session` | `PauseOpenHandsSession` | Explicit user stop only |
| Eval scenario definition | `define_eval_scenario` | Product helper over `StartOpenHandsSession` / `OpenHandsSendMessage` | Skill-bound scenario definition accumulates on the saved skill conversation |
| Eval-to-refine brief | `build_refine_improvement_brief` | Product helper over `StartOpenHandsSession` / `OpenHandsSendMessage` | Skill-bound diagnosis reuses the saved skill conversation |

### Throwaway surfaces

| Product surface | Product command | OpenHands primitive mapping | Notes |
|---|---|---|---|
| Create Skill scope validation | `review_skill_scope` | `RunThrowawayOpenHandsSession` | Bounded validation run, no later reply path |
| Eval execution | `run_eval_workbench` | `RunThrowawayOpenHandsSession` plus Promptfoo sidecar orchestration | The live UI currently runs performance-mode evals in isolated `.openhands/throwaway/eval-workbench/...` runtime roots; trigger-mode execution code still exists below the UI |

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

The branch already removed the old description-surface commands and UI. The
remaining cleanup residue is narrower:

- trigger-mode Eval Workbench runtime/data paths that still exist even though
  the current frontend live surface is performance-only
- product-layer persistent-turn helpers that still duplicate session-selection
  logic already implied by the runtime primitive layer

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/agents/openhands_server/mod.rs` | OpenHands runtime primitives, persistence policy, event orchestration, and throwaway/persistent session helpers. |
| `app/src-tauri/src/agents/openhands_server/process.rs` | Agent Server process lifecycle and environment wiring. |
| `app/src-tauri/src/agents/openhands_server/types.rs` | OpenHands request shape, tool list, suffix wiring, and agent definitions. |
| `app/src-tauri/src/agents/sidecar.rs` | Backend-owned request/config builder used by product commands. |
| `app/src-tauri/src/skill_paths.rs` | Runtime workspace path resolution for persistent skill workspaces and implemented throwaway runtime directories. |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Workflow product command orchestration. |
| `app/src-tauri/src/commands/refine/mod.rs` | Refine product command orchestration and session wrapper state. |
| `app/src-tauri/src/commands/skill/scope_review.rs` | Create-skill scope validation command. |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Eval Workbench command surface and runtime call sites. |
| `agent-sources/workspace/agents/skill-creator.md` | Main-agent instruction source. |
| `agent-sources/workspace/skills/` | Bundled AgentSkills deployed into `.agents/skills`. |
| `agent-sources/prompts/` | App-owned task prompts rendered by the backend. |

## Remaining Cleanup Direction

- Centralize persistent-session selection in the runtime layer so Workflow,
  Refine, and Eval Workbench do not keep parallel product-layer helpers for the
  same resume-or-create behavior.
- Remove the retained Eval Workbench trigger/runtime residue or re-promote it to
  a live surface explicitly; the current branch still has backend/data-model
  branches that the frontend no longer exposes.
