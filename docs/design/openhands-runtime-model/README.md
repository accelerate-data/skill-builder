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
   `select_skill_openhands_session`, `send_refine_message`,
   `review_skill_scope`, and `generate_eval_scenario_assertions`.
2. **Backend -> OpenHands API**
   A small set of runtime primitives that create or resume OpenHands
   conversations, send messages, pause active execution, or run disposable
   throwaway conversations.

The key model is that OpenHands always operates on a conversation-backed
session. The important product distinction is whether Skill Builder keeps the
conversation alive for future user-visible turns or treats it as a persistent
skill conversation versus a non-resumable throwaway run.

The active runtime model in this branch is:

- selected-skill activation owns persistent session bootstrap
- workflow, refine, and Eval scenario generation all send into the
  already-selected persistent skill conversation
- switch-away and app shutdown pause the selected skill session instead of
  deleting the conversation

Related sub-designs:

- [send-turn-semantics.md](send-turn-semantics.md) — how
  `OpenHandsSendMessage` must own stream attach, message dispatch, turn-scoped
  recovery, and visible `task_sent` consistency across Workflow and Refine.

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
| Model OpenHands around sessions, not ad hoc helpers. | OpenHands is conversation-backed in both persistent and throwaway cases. The product should name the actual lifecycle boundary. |
| Keep two explicit layers: product commands and runtime primitives. | Frontend surfaces should call product-specific commands; only the backend should speak in raw OpenHands session terms. |
| Use explicit runtime primitives for server lifecycle and conversation lifecycle. | The runtime needs server ensure/shutdown plus persistent session preparation, `OpenHandsSendMessage`, `PauseOpenHandsSession`, and `RunThrowawayOpenHandsSession`. Everything else is product orchestration. |
| Persistent session reuse covers workflow, refine, and Eval scenario generation. | Workflow steps, refine chat, and Eval scenario generation are all follow-up turns on the selected skill, so they should reuse the saved skill conversation rather than inventing a second conversation lifecycle. |
| Throwaway sessions are reserved for bounded execution tasks with no later reply path. | Scope validation remains non-resumable because it produces a bounded artifact and should stay outside normal product conversation state. |
| The live Eval Workbench surface is performance-only end to end. | The frontend, backend model, and migration path all flatten legacy trigger-mode data to performance scenarios. |
| Rust owns Agent Server lifecycle and workspace selection. | The backend already owns persistence, filesystem policy, event delivery, logging, and cancellation. |
| The frontend never calls OpenHands-shaped APIs directly. | Product APIs stay stable even if the runtime implementation changes. |
| `skill-creator.md` is always sent through `system_message_suffix`. | The main agent should preserve the default OpenHands system prompt while deterministically appending Skill Builder's stable instructions. |
| `skill-creator-user-suffix.txt` remains app-owned and per-call. | The user-message suffix is set per dispatch, not per agent. Workflow surfaces, refine, scope review, and the workflow answer evaluator opt in; eval scenario suggest deliberately omits it because its prompt is fully self-contained. Per-message invariants stay a backend control surface, not embedded in task prompts. |
| Tool exposure is runtime-owned and centrally defined. | Prevent per-surface tool drift and keep product commands focused on task semantics. |
| Selected-skill activation owns persistent-session startup. | Workflow and Refine both depend on the same selected-skill conversation. Bootstrapping that session at skill-selection time removes per-surface lifecycle drift. |

## Core Concepts

### Product Command Layer

This is the **frontend -> backend** contract. These commands are shaped around
product surfaces, not OpenHands transport details.

Examples:

- `run_workflow_step`
- `run_answer_evaluator`
- `select_skill_openhands_session`
- `send_refine_message`
- `cancel_agent_run`
- `pause_openhands_session`
- `review_skill_scope`
- `generate_eval_scenario_assertions`

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
| Ensure server | Make sure the per-skill OpenHands Agent Server is running for the target runtime root. |
| Session start | Create or resume a persistent OpenHands conversation for a skill-scoped session. |
| `OpenHandsSendMessage` | Append a user message to an existing persistent conversation and run it. |
| `PauseOpenHandsSession` | Pause active execution on a persistent conversation without deleting it. |
| `RunThrowawayOpenHandsSession` | Create a bounded conversation, run it to completion, collect the result, and keep it outside resumable product state. |
| `ShutdownOpenHandsServer` | Stop the cached Agent Server process for the current runtime root during app-exit cleanup. |

These primitives are generic runtime concepts. They should not know about
Workflow step numbers, Refine UI state, or Eval Workbench entities.

Rules:

- ensure-server is conversation-free. It must not call
  `GET /api/conversations/:id` or create a conversation shell.
- persistent session start owns resume-or-create behavior.
- `OpenHandsSendMessage` sends the next turn into an already-established
  persistent session.
- `PauseOpenHandsSession` is only for explicit user stop/cancel during an
  active run.
- A successfully completed turn does not auto-pause. The conversation remains
  persisted and idle.
- `RunThrowawayOpenHandsSession` is for bounded tasks with no later reply path.
- `ShutdownOpenHandsServer` is a process-lifecycle primitive, not a
  conversation-turn primitive.

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

- selected-skill activation calls `select_skill_openhands_session`.
- Workflow calls `run_workflow_step` and `run_answer_evaluator`.
- Refine calls `send_refine_message`.
- selected-skill cleanup calls `pause_openhands_session`.
- Create Skill calls `review_skill_scope`.
- Eval Workbench calls scenario-generation commands.

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
ensure server
  -> no conversation lookup

open or resume session
  -> persistent session start

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

### Selected-Skill Bootstrap Seam

The VU-1175 follow-up work exposed that session ownership had to move above
Refine:

1. the app stores a durable `conversation_id` per skill
2. skill switch can restart the per-skill OpenHands Agent Server because
   `OH_CONVERSATIONS_PATH` is skill-scoped
3. abrupt server shutdown can leave OpenHands lease state behind for some
   saved conversations
4. per-surface startup logic created drift between Workflow and Refine about
   when to resume, recreate, or pause the durable conversation

The current contract removes that split ownership:

- selected-skill activation performs resume-or-create for the durable
  `conversation_id`
- workflow and refine both consume that same selected-skill session
- switch-away and app shutdown pause the selected skill session through the
  same lifecycle owner

### Selected-Skill Bootstrap Contract

Selected-skill activation owns the persistent OpenHands bootstrap sequence:

1. resolve the skill-scoped runtime root
2. ensure the cached Agent Server matches that runtime root
3. load the saved `conversation_id` from `skill_conversations`
4. resume that conversation when it is still compatible, or create a fresh one
5. restore visible transcript history for the selected-skill surface

The runtime is intentionally skill-scoped:

- `OH_CONVERSATIONS_PATH` points at the selected skill workspace's
  `conversations/` directory
- switching skills can restart the cached Agent Server when that conversations
  root changes
- the database remains the durable source of truth for the selected skill's
  saved `conversation_id`
- stale or incompatible saved ids are cleared during selected-skill bootstrap
  before a new persistent conversation is created

### Persistent Eval Scenario Generation Contract

Eval scenario generation is part of the selected-skill persistent conversation
model, not a throwaway side path.

Contract:

1. selected-skill activation has already prepared the durable
   `conversation_id`
2. Eval loads that saved `conversation_id` from `skill_conversations`
3. Eval dispatches its generation prompt as another turn on that existing
   conversation
4. Eval does not start, resume, or pause the conversation itself; it relies on
   the selected-skill lifecycle owner
5. Eval persists only the parsed scenario/assertion result back into SQLite

This keeps Eval aligned with Workflow and Refine: the user is still operating
on the currently selected skill, so scenario generation should reuse that
skill's accumulated conversation context.

### Stable Persistence Secret

Persistent OpenHands conversations depend on a workspace-level encryption
secret, not a per-process runtime token.

Contract:

- Rust stores the secret at `{workspace}/.openhands/secret.key`
- the same secret is reused across all plugins and skill-scoped runtime roots
- Agent Server startup always loads that file into `OH_SECRET_KEY`
- `SESSION_API_KEY` remains per-process request authentication and is not used
  for persistent conversation encryption

This split matters because the selected skill can restart the cached Agent
Server with a different `OH_CONVERSATIONS_PATH`. Persisted conversations only
remain decryptable across those restarts when `OH_SECRET_KEY` is stable.

### App Shutdown Contract

App-exit cleanup is a selected-skill lifecycle concern, not a Refine-only
cleanup path.

Contract:

1. release skill locks owned by the current app instance
2. end workflow/runtime sessions owned by the current app instance
3. pause or stop active OpenHands execution through the selected-skill cleanup
   path
4. shut down the cached Agent Server process

The backend owns this flow through `graceful_shutdown`, which calls the runtime
server-shutdown primitive. Server shutdown is graceful-first and only falls
back to forced termination when the Agent Server does not exit within the
bounded wait window.

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
| `{workspace}/.openhands/secret.key` | Rust process lifecycle | Stable OpenHands persistence secret shared by all skills and throwaway surfaces in this app workspace. |
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

- selected-skill activation validates saved session state, restores compatible
  history, clears stale saved ids, and prepares the persistent OpenHands
  conversation for the active skill
- workflow steps and `run_answer_evaluator` dispatch against the selected
  skill-scoped conversation
- refine turns dispatch against that same selected persistent conversation
- Eval Workbench scenario generation is being aligned to dispatch against that
  same selected persistent conversation and persist only the parsed
  scenario/assertion result back into SQLite
- scope review uses isolated
  `.openhands/throwaway/...` runtime roots and do not save resumable product
  conversation ids
- the frontend and backend both expose performance-only scenario authoring; old
  trigger-mode database rows are flattened during migration and unsupported
  legacy scenario files now fail loudly instead of disappearing silently

### Agent Server Ownership

Rust owns Agent Server process lifecycle:

- bind on a random loopback port
- configure workspace and conversation roots
- provide a stable OpenHands persistence secret
- manage auth when supported by the installed server
- shut the process down with the owning app or skill lifecycle

### OpenHands Secret Persistence

Persistent OpenHands conversation state is encrypted with a stable workspace
secret:

- the secret is stored once at `{workspace}/.openhands/secret.key`
- the same secret is reused across all skills and throwaway runtime roots in
  that app workspace
- `OH_SECRET_KEY` is loaded from that file on every Agent Server start
- `SESSION_API_KEY` remains per-process and is not used as the persistence
  encryption key

This stability matters because saved OpenHands conversations become
undecryptable if the persistence key rotates between server restarts.

### Graceful Shutdown Contract

App-exit cleanup is a product-layer lifecycle command backed by the runtime
process primitive `ShutdownOpenHandsServer`:

1. release selected-skill locks and end workflow sessions owned by the current
   app instance
2. request graceful OpenHands Agent Server shutdown
3. allow a bounded wait for clean exit
4. fall back to forced process termination only if graceful shutdown fails

Persistent conversation reuse after app restart depends on three stable inputs:

- the skill-scoped `OH_CONVERSATIONS_PATH`
- the saved `conversation_id` in `skill_conversations`
- the stable workspace `OH_SECRET_KEY`

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

Named subagents are deploy-time inputs, not request-time payload fields.

- default subagent capability is exposed through `task_tool_set`
- named agents such as `skill-verifier` are deployed as `.md` files under
  `<workspace_skill_dir>/.agents/agents/` by the SHA-gated deploy step
  (`app/src-tauri/src/commands/workflow/deploy.rs`); the OpenHands SDK
  discovers file-based agents in that directory at conversation creation, and
  `task_tool_set` is what invokes them
- the OpenHands request has no `agent_definitions` field — subagent
  registration is a file-on-disk contract, not a payload contract

### Tools

The default tool policy for OpenHands requests lives in the child doc:

- [tools-included.md](tools-included.md)

## Active Product Surface Mapping

### Persistent surfaces

| Product surface | Product command | OpenHands primitive mapping | Notes |
|---|---|---|---|
| Selected skill activation | `select_skill_openhands_session` | persistent session preparation | Restores compatible history, clears stale saved ids, and prepares the persistent OpenHands conversation for the active skill |
| Workflow step execution | `run_workflow_step` | `OpenHandsSendMessage` | Step-oriented UI, but reuses the selected skill's persistent conversation |
| Workflow gate evaluation | `run_answer_evaluator` | `OpenHandsSendMessage` | Part of the same workflow conversation, not a disposable side run |
| Refine chat turn | `send_refine_message` | `OpenHandsSendMessage` | Sends the next user turn into the selected persistent session |
| Eval scenario suggest (target state) | `generate_eval_scenario_assertions` | `OpenHandsSendMessage` | **Target state for VU-1178.** Sends a scenario-generation turn into the selected persistent session and persists the parsed result back into SQLite. Current code still uses `RunThrowawayOpenHandsSession` (see Throwaway surfaces below). |
| Selected-skill pause on switch/exit | `pause_openhands_session` | `PauseOpenHandsSession` | Shared lifecycle cleanup for switch-away and app shutdown |

### Throwaway surfaces

| Product surface | Product command | OpenHands primitive mapping | Notes |
|---|---|---|---|
| Create Skill scope validation | `review_skill_scope` | `RunThrowawayOpenHandsSession` | Bounded validation run, no later reply path |
| Eval scenario suggest (current code) | `generate_eval_scenario_assertions` | `RunThrowawayOpenHandsSession` | `task_kind = "scenario-suggest"`, `OpenHandsRuntimeMode::Throwaway`, `<workspace>/.openhands/throwaway/eval-workbench/{run_id}/` runtime root. VU-1178 migrates this to the persistent surface above. |

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
| `app/src-tauri/src/commands/refine/mod.rs` | Refine product command orchestration and restore/event helpers. |
| `app/src-tauri/src/commands/skill_session.rs` | Selected-skill OpenHands session bootstrap and pause command surface. |
| `app/src-tauri/src/commands/skill/scope_review.rs` | Create-skill scope validation command. |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Eval Workbench command surface, selected-conversation send path, and scenario/assertion result parsing and persistence. |
| `agent-sources/workspace/agents/skill-creator.md` | Main-agent instruction source. |
| `agent-sources/workspace/skills/` | Bundled AgentSkills deployed into `.agents/skills`. |
| `agent-sources/prompts/` | App-owned task prompts rendered by the backend. |

## Remaining Cleanup Direction

- Remove the retained Eval Workbench run-history, throwaway-runtime, and
  disk-backed-scenario residue so the implementation matches the persistent
  selected-skill conversation model documented here.
