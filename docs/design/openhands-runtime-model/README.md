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
   `start_refine_session`, `review_skill_scope`, and `suggest_scenario`.
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
| Persistent session reuse is skill-scoped. | Workflow and Refine should accumulate context on the same skill conversation instead of rebuilding context each turn. |
| Throwaway sessions are still real OpenHands sessions. | Scope validation, field suggestions, and eval execution create a conversation, run it, collect the terminal result, and then delete it. |
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
- `start_refine_session`
- `send_refine_message`
- `pause_refine_session`
- `close_refine_session`
- `review_skill_scope`
- `generate_suggestions`
- `suggest_scenario`
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

- Workflow calls `run_workflow_step`.
- Refine calls `start_refine_session`, `send_refine_message`,
  `pause_refine_session`, and `close_refine_session`.
- Create Skill calls `review_skill_scope` and `generate_suggestions`.
- Eval Workbench calls scenario generation, run, and diagnosis commands.

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

Use a persistent session when the user should be able to continue on the same
conversation later.

```text
start or reopen skill
  -> StartOpenHandsSession
  -> save / restore conversation_id
  -> OpenHandsSendMessage for each new user-visible turn
  -> PauseOpenHandsSession on stop
  -> keep conversation on close
```

Properties:

- conversation survives between turns
- conversation survives leaving the view
- prior context is intentionally preserved
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

## Surface Mapping

### Workflow

Workflow is a **persistent session consumer**, even though the UI interaction
is step-oriented rather than chat-oriented.

`run_workflow_step` does product orchestration:

- load the skill-scoped workspace
- render the prompt for the selected step
- attach output schema and task metadata
- start or resume the persistent skill conversation
- send the step message
- parse terminal output into workflow-owned artifacts

Workflow steps remain:

| Step | Purpose | Runtime shape |
|---|---|---|
| 0 | Research | persistent session turn |
| 1 | Detailed Research | persistent session turn |
| 2 | Confirm Decisions | persistent session turn |
| 3 | Generate Skill | persistent session turn |

The runtime distinction is that Workflow still uses the persistent skill
conversation, not a separate throwaway conversation per step.

### Refine

Refine is the most explicit persistent-session surface.

- `start_refine_session` resolves and resumes or creates the skill session
- `send_refine_message` appends the next user turn
- `pause_refine_session` pauses active execution
- `close_refine_session` closes the product wrapper without deleting the
  persistent OpenHands conversation

### Create Skill

Create-skill pre-skill helpers are **throwaway session** consumers.

| Command | Runtime shape |
|---|---|
| `review_skill_scope` | throwaway session |
| `generate_suggestions` | throwaway session |

These runs happen before a durable skill workspace or skill-bound conversation
needs to exist.

### Eval Workbench

Eval Workbench uses both models:

| Flow | Runtime shape |
|---|---|
| performance execution | throwaway session |
| trigger execution | throwaway session |
| diagnosis / refine brief | throwaway session |
| persistent scenario/candidate generation follow-ups | persistent session when the product wants suggestion history to accumulate |

The deciding rule is whether the feature is a disposable evaluation task or a
user-visible skill-bound conversation that should be resumed later.

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

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/agents/openhands_server/mod.rs` | OpenHands runtime primitives, persistence policy, event orchestration, and throwaway/persistent session helpers. |
| `app/src-tauri/src/agents/openhands_server/process.rs` | Agent Server process lifecycle and environment wiring. |
| `app/src-tauri/src/agents/openhands_server/types.rs` | OpenHands request shape, tool list, suffix wiring, and agent definitions. |
| `app/src-tauri/src/agents/sidecar.rs` | Backend-owned request/config builder used by product commands. |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Workflow product command orchestration. |
| `app/src-tauri/src/commands/refine/mod.rs` | Refine product command orchestration and session wrapper state. |
| `app/src-tauri/src/commands/skill/scope_review.rs` | Create-skill scope validation command. |
| `app/src-tauri/src/commands/skill/suggestions.rs` | Create-skill suggestions command. |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Eval Workbench command surface and runtime call sites. |
| `agent-sources/workspace/agents/skill-creator.md` | Main-agent instruction source. |
| `agent-sources/workspace/skills/` | Bundled AgentSkills deployed into `.agents/skills`. |
| `agent-sources/prompts/` | App-owned task prompts rendered by the backend. |

## Open Questions

1. `[design]` Should Workflow always use the persistent skill conversation for
   every step, or should some step-specific operations remain throwaway despite
   being skill-bound?
2. `[design]` How much refine-specific wrapper state should remain in the
   backend once persistent session start/resume behavior is centralized?
3. `[design]` Which Eval Workbench suggestion flows should intentionally join
   the persistent skill conversation rather than remain disposable?
