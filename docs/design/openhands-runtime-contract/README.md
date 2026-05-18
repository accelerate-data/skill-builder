---
functional-specs: [custom-plugin-management]
---

# OpenHands Runtime Contract

> **Status:** Implemented
> **Functional specs:** Not applicable; this design defines the shared runtime contract used by Workflow, selected-skill session bootstrap, create-skill validation, scope review, setup validation, and Eval Workbench helpers.

## Overview

Skill Builder has one cross-layer OpenHands contract. The backend owns runtime setup, storage roots, session lifecycle, event normalization, and typed workflow result handling. Product surfaces choose prompts, tools, and persistent-versus-throwaway behavior, but they all pass through the same runtime boundary.

This doc is the canonical source for:

- runtime layers and responsibilities
- core wrapper APIs at each layer
- raw conversation lifecycle primitives
- raw side-channel inspection primitives
- persistent versus throwaway session behavior
- storage roots and canonical path ownership
- normalized event ingress and terminal result handling
- workflow artifact authority and typed step-output contracts

Companion sequence pages:

- [Selected-Skill Conversation Sequence](./selected-skill-conversation-sequence.md)
- [OpenHands Conversation Model](./openhands-conversation-model.md)

## Design Scope

**Covers**

- the four-layer runtime boundary from Tauri commands to Agent Server calls
- canonical storage roots: app data, skills root, skill dir, throwaway run dirs
- persistent selected-skill sessions and throwaway product-surface runs
- normalized OpenHands event and terminal result ownership
- workflow step output contracts and which layer persists them
- step 3 contract variants for generate, rewrite, and benchmark flows

**Does not cover**

- frontend projection of normalized events into renderer-facing `DisplayNode`
- per-page UX like optimistic activation skeletons or chat rendering
- low-level tool inclusion policy beyond the contract boundary that accepts `allowed_tools`

## Key Decisions

| Decision | Rationale |
|---|---|
| One backend-owned runtime contract serves all product surfaces. | Workflow, selected-skill session bootstrap, scope review, and validation flows share the same OpenHands runtime boundary even when their prompts and allowed tools differ. |
| Persistent runs operate in the canonical skill directory. | The active working directory for selected-skill sessions is the resolved skill dir under the user-configured skills root, not a per-skill workspace mirror. |
| Throwaway runs declare whether they are skill-related. | Skill-related throwaway runs may need proximity to the skills tree; unrelated throwaway runs should stay out of user-owned skill directories. |
| Throwaway runs declare tool-access mode. | The backend must know whether a throwaway run is read-only or write-capable before selecting allowed tools. |
| Conversations are deleted when their owning skill is deleted or after a successful fork. | Conversation history is durable during active use, but the app cleans up persisted conversations when they are no longer referenced: deleting a skill removes all its bound conversations, and forking a conversation deletes the source after the fork succeeds. |
| Raw conversation APIs mirror the OpenHands send-then-run model. | Sending a user message and starting agent processing are separate operations. That separation is required for send-while-running behavior. |
| Persistent interactive surfaces share one canonical conversation stream. | OpenHands persists one ordered conversation event stream per conversation, and Skill Builder renders that stream directly instead of layering a second turn-owned transcript model above it. |
| User sends and runtime events remain separate concerns. | User intent should be recorded immediately and independently from runtime event delivery, but both become part of the same canonical conversation stream. |
| `ask_agent` is a raw inspection side-channel. | It is a non-authoritative side-channel inspection capability scoped to the raw OpenHands layer. |
| App data owns shared OpenHands persistence roots. | Conversations, bash events, logs, DB state, and app-local runtime files belong to app data rather than the user-configured skills tree. |
| Steps 0-2 are DB-authoritative; step 3 is file-output-authoritative. | Clarifications and decisions are canonical typed records in SQLite; generated skill files remain canonical on disk. |
| Runtime events are normalized before frontend projection. | Lower layers own wire-shape cleanup so upper layers consume a stable event model regardless of SDK field naming differences. |
| Step 3 accepts generate, rewrite, and benchmark terminal statuses. | The backend validates all of these variants; the design doc describes the real contract surface rather than only the original generate path. |

## Runtime Layers and APIs

```text
commands/                    ← Layer 4: product commands, DB reads, prompt building, runtime choice
agents/tracked_openhands.rs  ← Layer 3: app-tracked run control and local runtime wiring
agents/skill_creator.rs      ← Layer 2: shared skill-creator config and persistent-session sequence
agents/openhands_server/     ← Layer 1: raw Agent Server process, HTTP, WebSocket, event normalization
```

### Layer 1: Raw OpenHands Runtime

`app/src-tauri/src/agents/openhands_server/` owns:

- Agent Server process lifecycle
- raw conversation create / send / run / pause / fork operations
- raw side-channel ask-agent operations
- WebSocket event ingestion
- normalization of runtime event payloads before they reach higher layers

The OpenHands Agent Server process is shut down only during app shutdown. Normal runtime surfaces pause conversations; they do not shut the server down.

Skill Builder deletes conversations in two scenarios: when a skill is deleted (all bound conversations are paused then deleted), and after a successful fork (the source conversation is deleted once the fork is rebound). Outside these paths, conversations remain durable runtime state.

Raw primitives are runtime-oriented, not product-oriented. This layer does not decide which product surface is running or how workflow outputs are persisted.

Core APIs:

| API | Purpose |
|---|---|
| `ensure_openhands_server(config)` | Start or reuse the Agent Server process for the requested runtime root. |
| `shutdown_openhands_server()` | Shut down the Agent Server process during app-exit lifecycle handling. |
| `start_openhands_session(app, config, saved_conversation_id)` | Resume or create a persistent conversation and return restored events for hydration. |
| `create_openhands_conversation(app, config)` | Create a fresh conversation without attempting to resume a saved one. Used by throwaway surfaces that bypass `start_openhands_session`. |
| `send_message_to_openhands_conversation(config, conversation_id, prompt)` | Append a user message to an existing conversation without starting a new local run task. |
| `run_openhands_conversation(app, config, conversation_id, prompt_delivery)` | Start or resume active processing for a conversation and own the live socket/task for that run. |
| `ask_openhands_agent(config, conversation_id, question)` | Ask the agent a non-authoritative question about the current conversation state without changing product-layer runtime ownership. |
| `pause_openhands_conversation(config, conversation_id)` | Pause active execution without deleting the conversation. |
| `delete_openhands_conversation(config, conversation_id)` | Delete a conversation from the OpenHands Agent Server. Used when deleting a skill or after a successful fork. |
| `fork_openhands_conversation(app, config, source_conversation_id)` | Fork an existing paused conversation into a new conversation ID and return restored events for the fork. |

Raw OpenHands wrappers only handle server, runtime, and conversation concerns. They take only conversation-centric runtime inputs. The raw layer exposes one pause API, `pause_openhands_conversation(config, conversation_id)`, and one delete API, `delete_openhands_conversation(config, conversation_id)`. Server shutdown is also a raw-layer API, exposed as `shutdown_openhands_server()`, so app-exit flows do not call `process.rs` directly. Conversations are pause-only during active use; deletion occurs only when a skill is removed or after a successful fork.

Important rule:

- `send_message_to_openhands_conversation(...)` and `run_openhands_conversation(...)` are separate raw primitives.
- Sending a message to a conversation that is already running must not start a second local runner for the same conversation.
- The raw layer may reuse OpenHands server-side "already running" behavior, but Skill Builder treats live socket/task ownership as a single-runner concern.
- `ask_openhands_agent(...)` is a raw inspection primitive only. It does not create local run ownership, does not replace typed workflow outputs, and does not imply any tracked or product wrapper behavior.

### Layer 2: Shared Skill-Creator Model

`app/src-tauri/src/agents/skill_creator.rs` and `app/src-tauri/src/agents/runtime_config.rs` own the shared contract for building runtime requests used by persistent skill-creator runs.

Important rules:

- `build_skill_creator_config` is the canonical builder for shared `skill-creator` runs.
- persistent runs resolve `skill_dir` from the canonical skills tree: `{skills_root}/{plugin_slug}/skills/{skill_name}`.
- the runtime request carries app data root, skills root, resolved skill dir, task discriminator, allowed tools, step id, run source, and plugin slug.

Canonical builder shape:

```rust
pub fn build_skill_creator_config(
    context: SkillCreatorRuntimeContext,
) -> OpenHandsRuntimeConfig
```

```rust
pub struct SkillCreatorRuntimeContext {
    pub app_data_root: String,
    pub skills_root: String,
    pub skill_name: String,
    pub plugin_slug: String,
    pub prompt: String,
    pub llm: WorkflowLlmConfig,
    pub intent: SkillCreatorIntent,
    /// Override the resolved skill_dir. Used by throwaway surfaces (scope review,
    /// model validation, eval workbench) that need a custom runtime directory.
    pub skill_dir_override: Option<String>,
}

pub enum SkillCreatorIntent {
    Refine,
    SelectedSkillSession,
    WorkflowStep { step: WorkflowStepKind },
    AnswerEvaluator,
    Eval,
    ScopeReview,
    ModelValidation,
}
```

### Skill-Creator Agent

The shared runtime model is built around the `skill-creator` agent.

Important rules:

- `agent_name` is `skill-creator` for the shared builder path.
- the runtime attaches the `skill-creator` system-message suffix from `agent-sources/workspace/agents/skill-creator.md`.
- the runtime attaches the `skill-creator` user-message suffix from `agent-sources/prompts/skill-creator-user-suffix.txt`.
- AgentSkills are discovered from the active run directory under `.agents/skills/` and attached through `agent_context.skills`.
- `InvokeSkillTool` is not explicitly listed in `include_default_tools`; it is attached by OpenHands when the active agent context includes AgentSkills.

Core APIs:

| API | Purpose |
|---|---|
| `build_skill_creator_config(context)` | Build the canonical runtime config from app-owned inputs and typed runtime intent. |
| `ensure_skill_session(app, config, saved_conversation_id)` | Enforced persistent-session entry point: ensure server, then resume or create the skill conversation. |
| `fork_openhands_conversation(app, config, source_conversation_id)` | Raw conversation fork API. Product commands own when to fork, delete the source conversation, and rebind persisted skill state to the fork ID. |

### Layer 3: App-Tracked Runtime Wrappers

`app/src-tauri/src/agents/tracked_openhands.rs` owns app-tracked live-run behavior above the raw conversation/session APIs.

This layer owns:

- app-tracked conversation run ownership
- local event routing
- cancel/task registries
- timeout cleanup
- tracked send and tracked throwaway send-and-wait wrappers

Important rules:

- `conversation_id` remains the canonical run identity at this layer.
- forking a conversation creates a new `conversation_id`.
- the next live send/run on the fork rebinds local run ownership to that new `conversation_id`.
- tracked runs stop through pause semantics; this layer does not own separate abort/terminate runtime concepts.
- a live conversation has one tracked local runner at a time.
- sending a message to a running conversation reuses the existing runner; it does not spawn a second socket/task owner for the same conversation.

Core APIs:

| API | Purpose |
|---|---|
| `send_tracked_openhands_message(...)` | App-tracked send wrapper for persistent conversations. If the conversation is idle it sends the message and starts the run. If the conversation is already running it appends the message only. |
| `pause_tracked_openhands_conversation(...)` | App-tracked pause wrapper that combines remote conversation pause with optional local run cancellation signaling. |
| `send_tracked_throwaway(...)` | App-tracked throwaway one-shot wrapper that sends a fresh throwaway conversation and waits for its terminal state. |

### Layer 4: Product Commands

`app/src-tauri/src/commands/` owns product behavior:

- validating user-facing inputs
- loading DB-backed runtime context
- building prompts
- choosing persistent versus throwaway execution
- attaching structured output schemas where needed
- parsing terminal `conversation_state.result_text`
- persisting typed results or validating file-output completion

This is the layer that decides whether a surface is:

- a persistent selected-skill session
- a throwaway validation/evaluation/scope-review run
- a typed workflow step that must materialize app-owned outputs

This layer owns persistent selected-skill conversation behavior above the raw OpenHands stream. One selected-skill conversation stays bound to one live run at a time, and product surfaces render the shared canonical conversation stream directly rather than inventing a second logical-turn transcript model.

Persistent interactive surfaces also own two distinct product lanes:

- an outbound command lane that records user intent (`send`, `pause`, question answers) and dispatches it to the backend runtime contract
- an inbound event lane that receives normalized OpenHands events and terminal state updates

These lanes merge in app-owned turn state. The conversation UI must not rely on raw event continuity alone to decide where a new user turn begins.

Core APIs:

These wrappers are the main command-level surfaces that product flows call.

| API | Location | Purpose |
|---|---|---|
| `ensure_skill_runtime_ready(...)` | `commands/skill_session.rs` | Internal `pub(crate)` helper (not a Tauri command). Resolves runtime context, ensures the canonical skill dir exists, and seeds `.agents/`. |
| `select_skill_openhands_session(...)` | `commands/skill_session.rs` | Selected-skill bootstrap wrapper: acquire/verify lease, ensure runtime readiness, restore or create the persistent session, and hydrate frontend session state. |
| `pause_openhands_session(...)` | `commands/skill_session.rs` | Product wrapper for pausing a selected-skill session and releasing its lock. |
| `run_workflow_step(...)` | `commands/workflow/runtime.rs` | Product wrapper for typed workflow steps 0-3 over persistent skill-bound conversations. |
| `run_answer_evaluator(...)` | `commands/workflow/runtime.rs` | Product wrapper for workflow gate evaluation over the shared runtime contract. |
| `review_skill_scope(...)` | `commands/skill/scope_review.rs` | Throwaway scope-review wrapper. Builds a throwaway config, runs to terminal state, and parses typed scope-review output. |
| `test_model_connection(...)` | `commands/api_validation.rs` | Throwaway model-connectivity wrapper. Builds a minimal throwaway config and verifies a completed terminal state. |
| `reset_workflow_step(...)` | `commands/workflow/evaluation.rs` | Workflow reset wrapper. Pauses the current conversation, resets artifacts to the target step, forks the paused conversation, rebinds the skill to the fork ID, and resumes future work on the fork. |

## Runtime Tool Policy

Tool policy is part of the runtime contract because callers choose intent, but the backend compiles that intent into the emitted OpenHands tool set.

### OpenHands Request Fields

The OpenHands request builder emits:

- `agent.tools` for registered workspace tools
- `include_default_tools` for OpenHands built-in tool classes

Unknown tool names fail conversation creation, so the runtime normalizes and filters the tool set before sending the request.

### Default Workspace Tool Set

The default emitted workspace tool set is:

```text
terminal
file_editor
task_tracker
grep
glob
task_tool_set
```

These cover shell execution, file mutation, task tracking, read-only search, path discovery, and sub-agent delegation.

### Built-In Tool Set

The emitted built-in tool class set is:

```text
FinishTool
ThinkTool
```

### Opt-In Tools

The runtime recognizes additional tools that are not part of the default set. These should be enabled through backend runtime policy for the relevant intent, not by ad hoc caller strings spread across product commands.

Examples:

- `browser_tool_set`
- `planning_file_editor`

### Override Policy

`allowed_tools` remains the low-level emitted runtime field, but it is a backend-owned contract surface:

- product surfaces select a typed runtime intent
- the canonical builder derives the tool policy for that intent
- the request builder normalizes names against the OpenHands registry
- if the derived set is empty after normalization, the runtime falls back to the default workspace tool set

### Wrapper Usage Rules

Higher layers should prefer the highest wrapper that matches their intent:

- selected-skill session work should go through `select_skill_openhands_session` and `pause_openhands_session`
- persistent skill turns should go through `ensure_skill_session` plus `send_tracked_openhands_message`
- throwaway surfaces should go through `send_tracked_throwaway` indirectly via product wrappers like `review_skill_scope` or `test_model_connection`
- initial persistent sends should follow the raw sequence `send_message_to_openhands_conversation(...)` then `run_openhands_conversation(...)`
- follow-up sends to an already running conversation should call only `send_message_to_openhands_conversation(...)` through the tracked wrapper
- `ask_openhands_agent(...)` is a raw inspection side-channel; product wrappers that use it should not bypass the tracked layer
- workflow reset/redo should pause the active conversation, reset local product state, fork the paused conversation, delete the source conversation, rebind the skill to the fork, and only create a new live run when the next send/run begins
- deleting a skill should pause all bound conversations, then delete them from the OpenHands server before removing local bookkeeping and filesystem state
- all non-shutdown, non-delete surfaces should pause conversations rather than shutting the OpenHands server down
- server shutdown is app-lifecycle-only and should remain confined to app exit orchestration through the raw `shutdown_openhands_server()` wrapper
- direct callers of `agents/openhands_server` should be implementing wrapper behavior, not product flows; that module owns only runtime/config/session/conversation concerns
- any wrapper that needs local listener wiring, cancel signaling, task-handle tracking, or timeout cleanup should live above the raw `agents/openhands_server` layer

Callers should not skip upward wrapper layers unless they are implementing a new wrapper at the boundary immediately above.

## Storage Roots

The runtime contract uses three primary roots plus one derived throwaway root.

| Root | Canonical path | Owner | Purpose |
|---|---|---|---|
| App data root | `app_handle.path().app_data_dir()` | Rust | App-local DB, OpenHands persistence roots, documents, runtime support files |
| Skills root | user-configured `settings.skills_path` | Rust + user filesystem | Canonical plugin/skill tree and durable skill output |
| Skill dir | `{skills_root}/{plugin_slug}/skills/{skill_name}` | Rust + OpenHands runtime | Working directory for persistent skill-bound runs |
| Throwaway run dir | `{system_tmp}/skill-builder/throwaway/{surface}/{run_id}` | Rust + OpenHands runtime | Active working directory for throwaway runs |

### Canonical Path Templates

The path resolver source of truth is `app/plugin-paths.json`.

Canonical templates:

```json
{
  "skill_dir": "{skills_root}/{plugin_slug}/skills/{skill_name}",
  "eval_dir": "{skills_root}/{plugin_slug}/evals/{skill_name}"
}
```

There is no canonical `workspace_skill_dir` template in the live resolver.

### App Data Ownership

App data owns:

- `db/skill-builder.db`
- `openhands/conversations/`
- related OpenHands persistence roots such as logs / bash events when present
- app-local documents and runtime support files

### Skills Root and Skill Dir Ownership

The user-configured skills root owns the canonical plugin-aware skill tree:

```text
{skills_root}/{plugin_slug}/skills/{skill_name}/
  SKILL.md
  references/
  evals/
  .git/
```

Persistent OpenHands skill runs use this resolved skill dir as the runtime working directory. The runtime does not maintain a second canonical per-skill workspace mirror under app-local data.

### Throwaway Runtime Ownership

All throwaway runs use one shared temp-root contract:

- resolve the system temp base from `TMPDIR`, `TMP`, `TEMP`, then `std::env::temp_dir()`
- place the active working directory at `{system_tmp}/skill-builder/throwaway/{surface}/{run_id}`

Examples:

```text
scope review
  {system_tmp}/skill-builder/throwaway/scope-review/{run_id}

eval workbench
  {system_tmp}/skill-builder/throwaway/eval-workbench/{run_id}

model validation
  {system_tmp}/skill-builder/throwaway/model-connection-test/{run_id}
```

Persistent selected-skill and workflow sessions use the canonical skill dir. Conversation history remains app-data-owned; this section only describes the active working directory passed to the runtime.

### Throwaway Tool Access Mode

Throwaway runs declare a tool-access mode before the runtime request is built:

- `read_only` → read/search/navigation only; no file mutation tools
- `write_enabled` → mutation-capable tools may be included

This flag is independent of `skill_related`.

Examples:

- scope review is `read_only`
- a write-enabled throwaway helper (e.g., repair or migration) uses `write_enabled`
- model-connection validation is `read_only`

### Workspace Skill Dir Cleanup

Workspace skill directories at `<app_local_data_dir>/workspace/{plugin_slug}/skills/{skill_name}` are not used. `commands/workspace.rs` deletes them if present.

## Session Model

## Persistent Skill Sessions

Selected-skill activation uses a persistent conversation model:

1. resolve the skill row and canonical skill dir
2. acquire or verify the skill lease in the backend
3. ensure the Agent Server is ready
4. resume or create the saved conversation
5. hydrate restored history for the frontend

Important contract properties:

- persistent conversation ids are stored in `skill_conversations`
- a completed turn does not destroy the conversation
- later turns reuse the same session when the saved conversation id is valid
- a fork creates a new `conversation_id` and deletes the source conversation
- the next live send/run on the fork reuses that new canonical `conversation_id`

## Throwaway Runs

Throwaway product surfaces create isolated runs with fresh runtime dirs and no selected-skill session reuse. These are used where the product needs a quick validation or analysis pass rather than ongoing session continuity.

Examples include:

- scope review
- setup/model connection validation

Throwaway runs use the same lower-level runtime boundary, but the caller supplies:

- `mode: "throwaway"`
- a throwaway `skill_dir`
- a `skill_related` classification that chooses the base path
- a tool-access mode that chooses read-only versus write-capable tools

Throwaway runs create fresh conversations. They do not create or require a separate OpenHands server runtime.

### Raw Conversation Lifecycle Model

The raw OpenHands contract follows the same high-level conversation model as the standalone SDK examples:

1. send the initial user message
2. start active processing
3. send additional user messages while the conversation is still processing
4. pause when the product needs to stop execution

In Skill Builder terms, that means:

- `send_message_to_openhands_conversation(...)` appends a user event
- `run_openhands_conversation(...)` creates the live socket/task owner for that conversation
- later `send_message_to_openhands_conversation(...)` calls may target the same active conversation without creating a second local runner

`send_message_to_openhands_conversation(...)` and `run_openhands_conversation(...)` are distinct raw conversation operations.

## Event and Result Ingress

The runtime boundary has two distinct ingress shapes:

- streaming runtime events
- terminal `conversation_state` summaries

### Normalized Event Ownership

Lower runtime layers normalize Agent Server event payloads before higher layers consume them. This includes discriminator cleanup such as falling back to SDK `kind` fields when `event_class` is absent.

This contract guarantees that upper layers can reason about:

- normalized `conversation_event` messages
- normalized `conversation_state` terminal updates
- stable event semantics independent of raw SDK field drift

Frontend projection is a separate concern and is documented in `docs/design/openhands-event-display-projection/README.md`.

The canonical frontend event core:

- `app/src/lib/conversation-event-types.ts` defines the app-owned envelope
- `app/src/lib/conversation-event-ordering.ts` defines the in-place mutation and append ordering rules
- `app/src/stores/conversation-store.ts` is the transcript authority keyed by `conversationId`
- `app/src/lib/conversation-event-projection.ts` is the pure display-node projection boundary

The shared conversation-centric helper layer above the transport seam:

- `app/src/lib/conversation-runtime.ts` is the frontend helper for `send_conversation_message`
- `app/src-tauri/src/commands/conversation.rs` is the session-based backend command surface for selected-skill conversation sends
- `app/src/hooks/use-session-runtime-stream.ts` appends normalized backend-observed events into `conversation-store` and updates `session-runtime-store` with runtime lifecycle metadata

Transcript authority and runtime lifecycle ownership are split between canonical conversation events and session runtime metadata.

Workspace and Workflow both render from the canonical event stream:

- `app/src/components/conversation/conversation-timeline.tsx` and `conversation-event-row.tsx` render a flat canonical timeline from `projectConversationEvents(...)`
- `app/src/components/workspace/workspace-conversation.tsx` is the workspace conversation surface for the selected skill session
- `app/src/components/layout/app-layout.tsx` restores workspace skills onto the conversation surface by default when the selected session is rehydrated
- `app/src/lib/skill-openhands-session.ts` replays `restored_transcript_events` into canonical conversation envelopes during selected-session hydration, so restored workspace sessions land on the same `conversation-store` timeline used for live activity
- `app/src/pages/workflow.tsx` renders live workflow transcript activity through `ConversationTimeline` keyed by the selected session's `conversationId`

Workflow uses `session-runtime-store` for run lifecycle/orchestration inside the workflow state machine, while transcript rendering reads from the canonical conversation layer.

### Terminal Result Ownership

Workflow commands extract terminal `conversation_state.result_text` from a completed run, parse it as JSON when required, and validate it against typed Rust structs plus semantic rules.

Core flow:

1. attach output schema where applicable
2. send prompt through the runtime
3. wait for terminal `conversation_state`
4. extract `result_text`
5. deserialize into typed output structs
6. persist normalized artifacts or validate file-output completion

## Workflow Artifact Authority

### Steps 0-2

Workflow steps 0-2 are DB-authoritative.

| Step | Typed output | Canonical authority |
|---|---|---|
| 0 Research | `ResearchStepOutput` | SQLite clarifications tables |
| 1 Detailed Research | `DetailedResearchOutput` | SQLite clarifications tables |
| 2 Confirm Decisions | `DecisionsOutput` | SQLite decisions tables |

The canonical artifact types live in:

- `contracts/clarifications.rs`
- `contracts/decisions.rs`
- `contracts/workflow_outputs.rs`
- `contracts/workflow_artifacts.rs`

### Step 3

Step 3 is file-output-authoritative with typed terminal validation.

The backend accepts these contract variants:

| Variant | Valid statuses | Authority |
|---|---|---|
| generate skill | `generated` | generated skill files plus typed terminal result |
| rewrite skill | `rewritten` | rewritten skill files plus typed terminal result |
| benchmark / eval iteration | `complete`, `partial`, `skipped` | benchmark output path semantics plus typed terminal result |

`GenerateSkillOutput` is the typed wrapper for all three paths.

In code, `GenerateSkillOutput` is a single struct (not three separate typed structs). All three paths share the same struct; benchmark-specific fields (`benchmark_path`, `commit_summary`, `skipped`, `call_trace`, `verifier_result`) are optional. The five valid statuses (`generated`, `rewritten`, `complete`, `partial`, `skipped`) are validated at the command layer, not enforced by the struct type itself.

## Typed Output Contracts

### Clarifications

Clarifications are represented as `ClarificationsFile` and persisted into normalized DB tables. Important contract details include:

- recursive `Question.refinements`
- integer `Section.id`
- optional structured `warning` and `error` metadata
- optional `answer_evaluator_notes`

### Decisions

Decision confirmation is represented as `DecisionsOutput`. Important contract details include:

- decision statuses are kebab-case strings
- `contradictory_inputs` is a union of boolean or `"revised"`
- persisted DB state flattens this into validated enum-like storage strings

### Answer Evaluation

Answer evaluation is a typed terminal output used by the workflow gate. The semantic contract accepts:

- verdicts: `sufficient`, `mixed`, `insufficient`
- gate decisions: `run_research`, `revise`
- per-question verdicts:
  - `clear`
  - `needs_refinement`
  - `not_answered`
  - `vague`
  - `contradictory`

The backend enforces extra semantic checks beyond raw schema shape, such as required reasoning and required `reason` fields for selected verdicts.

## Relationship to Companion Design Docs

| Doc | Relationship |
|---|---|
| `docs/design/openhands-event-display-projection/README.md` | Frontend event rendering and display projection design |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/agents/openhands_server/` | Raw Agent Server lifecycle, HTTP, WebSocket, normalization |
| `app/src-tauri/src/agents/runtime_config.rs` | Shared OpenHands runtime request contract |
| `app/src-tauri/src/agents/skill_creator.rs` | Shared `skill-creator` config builder and persistent session entry point |
| `app/src-tauri/src/skill_paths.rs` | Canonical skill-dir and throwaway-dir resolution |
| `app/src-tauri/src/commands/workspace.rs` | App-data runtime root and workspace cleanup |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Workflow runtime orchestration |
| `app/src-tauri/src/commands/workflow/output_format.rs` | Terminal result extraction, typed validation, and workflow materialization |
| `app/src-tauri/src/contracts/clarifications.rs` | Clarifications schema |
| `app/src-tauri/src/contracts/decisions.rs` | Decisions schema |
| `app/src-tauri/src/contracts/workflow_outputs.rs` | Step output wrappers including step 3 variants and answer evaluation |
| `app/src-tauri/src/contracts/workflow_artifacts.rs` | Tauri DTOs for persisted artifact CRUD |
| `app/src-tauri/src/db/workflow_artifacts.rs` | Normalized artifact persistence |

## Open Questions

1. `[design]` Do we want the throwaway-run classification and tool-access mode to live as first-class typed fields on `OpenHandsRuntimeConfig`, or should they stay one layer up as command-level inputs that are compiled into `skill_dir` plus `allowed_tools` before the runtime config is built?
