---
functional-specs: [custom-plugin-management]
---

# OpenHands Runtime Contract

> **Status:** Draft
> **Functional specs:** Not applicable; this design defines the shared runtime contract used by Workflow, Refine, create-skill validation, scope review, setup validation, and Eval Workbench helpers.

## Overview

Skill Builder has one cross-layer OpenHands contract. The backend owns runtime setup, storage roots, session lifecycle, event normalization, and typed workflow result handling. Product surfaces choose prompts, tools, and persistent-versus-throwaway behavior, but they all pass through the same runtime boundary.

This doc is the canonical source for:

- runtime layers and responsibilities
- persistent versus throwaway session behavior
- storage roots and canonical path ownership
- normalized event ingress and terminal result handling
- workflow artifact authority and typed step-output contracts

Implementation mismatches against this target model belong in
[implementation-gaps.md](implementation-gaps.md).

## Design Scope

**Covers**

- the three-layer runtime boundary from Tauri commands to Agent Server calls
- canonical storage roots: app data, skills root, skill dir, throwaway run dirs
- persistent selected-skill sessions and throwaway product-surface runs
- normalized OpenHands event and terminal result ownership
- workflow step output contracts and which layer persists them
- step 3 contract variants for generate, rewrite, and benchmark flows

**Does not cover**

- frontend projection of normalized events into `DisplayItem`
- per-page UX like optimistic activation skeletons or chat rendering
- low-level tool inclusion policy beyond the contract boundary that accepts
  `allowed_tools`

## Key Decisions

| Decision | Rationale |
|---|---|
| One backend-owned runtime contract serves all product surfaces. | Workflow, Refine, scope review, and validation flows share the same OpenHands runtime boundary even when their prompts and allowed tools differ. |
| Persistent runs operate in the canonical skill directory. | The active working directory for selected-skill sessions is the resolved skill dir under the user-configured skills root, not a per-skill workspace mirror. |
| Throwaway runs declare whether they are skill-related. | Skill-related throwaway runs reuse the canonical skill dir as their working directory; unrelated throwaway runs should stay under `/tmp/skill-builder/throwaway/...`. |
| Throwaway runs declare tool-access mode. | The backend must know whether a throwaway run is read-only or write-capable before selecting allowed tools. |
| App data owns shared OpenHands persistence roots. | Conversations, bash events, logs, DB state, and app-local runtime files belong to app data rather than the user-configured skills tree. |
| Steps 0-2 are DB-authoritative; step 3 is file-output-authoritative. | Clarifications and decisions are canonical typed records in SQLite; generated skill files remain canonical on disk. |
| Runtime events are normalized before frontend projection. | Lower layers own wire-shape cleanup so upper layers consume a stable event model regardless of SDK field naming differences. |
| Step 3 accepts generate, rewrite, and benchmark terminal statuses. | The backend already validates all of these variants; the design doc should describe the real contract surface instead of only the original generate path. |

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
- raw conversation create / pause operations
- WebSocket event ingestion
- normalization of runtime event payloads before they reach higher layers

The OpenHands Agent Server process itself is shut down only during app shutdown. Normal runtime surfaces pause conversations; they do not shut the server down.

Raw primitives are runtime-oriented, not product-oriented. This layer does not decide which product surface is running or how workflow outputs are persisted.

| API | Purpose |
|---|---|
| `ensure_openhands_server(config)` | Start or reuse the Agent Server process for the requested runtime root. |
| `shutdown_openhands_server()` | Shut down the Agent Server process during app-exit lifecycle handling. |
| `start_openhands_session(app, config, saved_conversation_id)` | Resume or create a persistent conversation and return restored events for hydration. |
| `pause_openhands_conversation(config, conversation_id)` | Pause active execution without deleting the conversation. |

### Layer 2: Shared Skill-Creator Model

`app/src-tauri/src/agents/skill_creator.rs` and `app/src-tauri/src/agents/runtime_config.rs` own the shared contract for building runtime requests used by persistent skill-creator runs.

Important rules:

- `build_skill_creator_config` is the canonical builder for shared `skill-creator` runs.
- callers should provide a typed runtime intent, not hand-fill policy fields like `task_kind`, `run_source`, `allowed_tools`, `max_turns`, `step_id`, or `output_format`.
- persistent runs resolve `skill_dir` from the canonical skills tree:
  `{skills_root}/{plugin_slug}/skills/{skill_name}`.
- the builder derives task discriminator, run source, allowed tools, max turns, output contract, and persisted step id from the typed intent.

The canonical shape should be:

```rust
pub fn build_skill_creator_config(
    context: SkillCreatorRuntimeContext,
) -> OpenHandsRuntimeConfig

pub struct SkillCreatorRuntimeContext {
    pub app_data_root: String,
    pub skills_root: String,
    pub skill_name: String,
    pub plugin_slug: String,
    pub prompt: String,
    pub llm: WorkflowLlmConfig,
    pub intent: SkillCreatorIntent,
}

pub enum SkillCreatorIntent {
    Refine,
    WorkflowStep { step: WorkflowStepKind },
    AnswerEvaluator,
    Eval,
    ScopeReview,
    ModelValidation,
}

pub enum WorkflowStepKind {
    Research,
    DetailedResearch,
    ConfirmDecisions,
    GenerateSkill,
}
```

`step_id` remains part of the final runtime config for persistence and reporting, but it is derived from `SkillCreatorIntent`. It should not be the public abstraction.

| API | Purpose |
|---|---|
| `build_skill_creator_config(context)` | Build the canonical `skill-creator` runtime config from app-owned inputs plus typed runtime intent. |
| `ensure_skill_session(app, config, saved_conversation_id)` | Enforced persistent-session entry point: ensure server, then resume or create the skill conversation. |

### Layer 3: App-Tracked Runtime Wrappers

These wrappers are the first layer that introduces app-owned run identity. They sit in `app/src-tauri/src/agents/tracked_openhands.rs` and compose the raw conversation APIs with local runtime concerns such as event routing, cancel/task registries, and throwaway terminal-state waiting.

| API | Purpose |
|---|---|
| `send_tracked_openhands_message(...)` | App-tracked turn wrapper for an existing conversation. Adds local run identity, event routing, and cancel/task tracking on top of the raw runtime. |
| `pause_tracked_openhands_conversation(...)` | App-tracked pause wrapper that combines remote conversation pause with optional local run cancellation signaling. |
| `send_tracked_throwaway(...)` | App-tracked throwaway one-shot wrapper. Sends the throwaway prompt, listens for local runtime events, and waits for the terminal state of one tracked run. |

`agent_id` is owned by this layer. It is not part of the raw OpenHands conversation contract. This layer does not own a separate abort or terminate primitive. Tracked runs are stopped by pause, not by local detach semantics.

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

| API | Location | Purpose |
|---|---|---|
| `ensure_skill_runtime_ready(...)` | `commands/skill_session.rs` | Resolve runtime context, ensure the canonical skill dir exists, and seed `.agents/`. |
| `select_skill_openhands_session(...)` | `commands/skill_session.rs` | Selected-skill bootstrap wrapper: acquire/verify lease, ensure runtime readiness, restore or create the persistent session, and hydrate frontend session state. |
| `pause_openhands_session(...)` | `commands/skill_session.rs` | Product wrapper for pausing a selected-skill session and releasing its lock. |
| `run_workflow_step(...)` | `commands/workflow/runtime.rs` | Product wrapper for typed workflow steps 0-3 over persistent skill-bound conversations. |
| `run_answer_evaluator(...)` | `commands/workflow/runtime.rs` | Product wrapper for workflow gate evaluation over the shared runtime contract. |
| `review_skill_scope(...)` | `commands/skill/scope_review.rs` | Throwaway scope-review wrapper. Builds a throwaway config, runs to terminal state, and parses typed scope-review output. |
| `test_model_connection(...)` | `commands/api_validation.rs` | Throwaway model-connectivity wrapper. Builds a minimal throwaway config and verifies a completed terminal state. |

### Wrapper Usage Rules

Higher layers should prefer the highest wrapper that matches their intent:

- selected-skill session work should go through `select_skill_openhands_session`
  and `pause_openhands_session`
- persistent skill turns should go through `ensure_skill_session` plus
  `send_tracked_openhands_message`
- throwaway surfaces should go through `send_tracked_throwaway` indirectly via product wrappers like `review_skill_scope` or `test_model_connection`
- tracked runs stop through pause semantics; the tracked layer should not expose separate abort or terminate APIs for normal runtime flows
- all non-shutdown surfaces should pause conversations rather than shutting the OpenHands server down
- server shutdown is app-lifecycle-only and should remain confined to app exit orchestration through the raw `shutdown_openhands_server()` wrapper
- direct callers of `agents/openhands_server` should be implementing wrapper behavior, not product flows; that module owns only runtime/config/session/conversation concerns
- any wrapper that needs `agent_id`, local listener wiring, cancel signaling, task-handle tracking, or timeout cleanup should live above the raw `agents/openhands_server` layer

Callers should not skip upward wrapper layers unless they are implementing a
new wrapper at the boundary immediately above.

## Storage Roots

The runtime contract uses three primary roots plus one derived throwaway root.

| Root | Canonical path | Owner | Purpose |
|---|---|---|---|
| App data root | `app_handle.path().app_data_dir()` | Rust | App-local DB, OpenHands persistence roots, documents, runtime support files |
| Skills root | user-configured `settings.skills_path` | Rust + user filesystem | Canonical plugin/skill tree and durable skill output |
| Skill dir | `{skills_root}/{plugin_slug}/skills/{skill_name}` | Rust + OpenHands runtime | Working directory for persistent skill-bound runs |
| Throwaway run dir | skill-related: `{skills_root}/{plugin_slug}/skills/{skill_name}`; unrelated: `/tmp/skill-builder/throwaway/{surface}/{run_id}` | Rust + OpenHands runtime | Working directory for throwaway runs |

### Canonical Path Templates

The path resolver source of truth is `app/plugin-paths.json`.

Canonical templates:

```json
{
  "skill_dir": "{skills_root}/{plugin_slug}/skills/{skill_name}",
  "eval_dir": "{skills_root}/{plugin_slug}/evals/{skill_name}"
}
```

### App Data Ownership

App data owns:

- `db/skill-builder.db`
- `openhands/conversations/`
- related OpenHands persistence roots such as logs / bash events when present
- app-local documents and runtime support files

Older workspace-mirror layouts are outside the target model.

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

Throwaway runs choose their working directory from an explicit backend flag:

- `skill_related = true` → working directory is the canonical skill dir
- `skill_related = false` → working directory is under `/tmp/skill-builder/throwaway/{surface}/{run_id}`

The resulting working directory is:

```text
skill-related:
  {skills_root}/{plugin_slug}/skills/{skill_name}

not skill-related:
  /tmp/skill-builder/throwaway/{surface}/{run_id}
```

Policy examples:

- scope review is skill-related, so its throwaway working directory is the canonical skill dir
- model-connection validation is not skill-related, so its throwaway dir should
  be rooted under `/tmp/skill-builder`

These dirs are runtime scratch only and are not canonical product state.

### Throwaway Tool Access Mode

Throwaway runs also declare a tool-access mode before the runtime request is
built:

- `read_only` → read/search/navigation only; no file mutation tools
- `write_enabled` → mutation-capable tools may be included

This flag is independent of `skill_related`.

Examples:

- scope review may be `skill_related = true` and `read_only`
- a future throwaway repair/migration helper may be
  `skill_related = true` and `write_enabled`
- model-connection validation should be
  `skill_related = false` and `read_only`

### Legacy Workspace Skill Dirs

Old workspace skill directories at
`<app_local_data_dir>/workspace/{plugin_slug}/skills/{skill_name}` are now a
cleanup concern only. `commands/workspace.rs` treats them as obsolete and
deletes them best-effort during migration.

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

## Throwaway Runs

Throwaway product surfaces create isolated runs with fresh working directories and no selected-skill session reuse. These are used where the product needs a quick validation or analysis pass rather than ongoing session continuity.

Examples include:

- scope review
- setup/model connection validation

Throwaway runs still use the same lower-level runtime boundary, but the caller
supplies:

- `mode: "throwaway"`
- a throwaway `skill_dir`
- a `skill_related` classification that chooses the base path
- a tool-access mode that chooses read-only versus write-capable tools

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

Frontend projection is a separate concern and is documented in
`docs/design/openhands-event-display-projection/README.md`.

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

This section covers only the runtime-boundary question: after a runtime step completes, which artifact class is authoritative and where does the handoff go. Deeper persistence layout, schema ownership, and storage implementation belong in [Workflow Artifact Storage](../workflow-artifact-storage/README.md) and the [Backend Design](../backend-design/README.md) docs.

### Steps 0-2

Workflow steps 0-2 are DB-authoritative.

| Step | Typed output | Canonical authority |
|---|---|---|
| 0 Research | `ResearchStepOutput` | SQLite clarifications tables |
| 1 Detailed Research | `DetailedResearchOutput` | SQLite clarifications tables |
| 2 Confirm Decisions | `DecisionsOutput` | SQLite decisions tables |

### Step 3

Step 3 is file-output-authoritative with typed terminal validation.

The backend accepts these contract variants:

| Variant | Valid statuses | Authority |
|---|---|---|
| generate skill | `generated` | generated skill files plus typed terminal result |
| rewrite skill | `rewritten` | rewritten skill files plus typed terminal result |
| benchmark / eval iteration | `complete`, `partial`, `skipped` | benchmark output path semantics plus typed terminal result |

`GenerateSkillOutput` is therefore the typed wrapper for more than just the
original generate path.

## Typed Output Contracts

This section covers only the runtime-boundary contract: which runtime surfaces require structured terminal output, what high-level result category is expected, and where the parsed handoff goes next. Detailed Rust type structure and persistence internals belong in backend-focused docs.

### Workflow Steps 0-2

These surfaces require typed terminal output that is parsed from `conversation_state.result_text` and handed off to DB-backed persistence:

| Surface | Expected typed result category | Handoff target |
|---|---|---|
| Research | clarifications output | SQLite clarifications tables |
| Detailed Research | detailed clarifications output | SQLite clarifications tables |
| Confirm Decisions | decisions output | SQLite decisions tables |

### Workflow Step 3

This surface requires typed terminal validation plus file-output verification:

| Surface | Expected typed result category | Handoff target |
|---|---|---|
| Generate / rewrite / benchmark variants | `GenerateSkillOutput`-family terminal result | file-output validation plus status-specific artifact handling |

### Answer Evaluation

Answer evaluation is also a typed terminal output surface:

| Surface | Expected typed result category | Handoff target |
|---|---|---|
| Answer evaluator | evaluator verdict output | workflow gate logic and DB-adjacent evaluation flow |

At this layer, the important rule is that commands attach the output contract before dispatch, parse terminal `result_text` after completion, and then hand the typed result to the appropriate backend persistence or validation path.

The backend enforces extra semantic checks beyond raw schema shape, such as
required reasoning and required `reason` fields for selected verdicts.

## Relationship to Companion Design Docs

| Doc | Relationship |
|---|---|
| `docs/design/openhands-event-display-projection/README.md` | Frontend/store-layer projection of normalized runtime events into `DisplayItem` |
| `docs/design/openhands-runtime-model/optimistic-session-activation.md` | Companion UX design for async selected-skill boot flow layered on top of this runtime contract |
| `docs/design/openhands-runtime-model/tools-included.md` | Companion doc for runtime tool-set policy and request-builder validation rules |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/agents/openhands_server/` | Raw Agent Server lifecycle, HTTP, WebSocket, normalization |
| `app/src-tauri/src/agents/runtime_config.rs` | Shared OpenHands runtime request contract |
| `app/src-tauri/src/agents/skill_creator.rs` | Shared `skill-creator` config builder and persistent session entry point |
| `app/src-tauri/src/skill_paths.rs` | Canonical skill-dir and throwaway-dir resolution |
| `app/src-tauri/src/commands/workspace.rs` | App-data runtime root migration and legacy workspace cleanup |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Workflow runtime orchestration |
| `app/src-tauri/src/commands/workflow/output_format.rs` | Terminal result extraction, typed validation, and workflow materialization |
| `app/src-tauri/src/contracts/clarifications.rs` | Clarifications schema |
| `app/src-tauri/src/contracts/decisions.rs` | Decisions schema |
| `app/src-tauri/src/contracts/workflow_outputs.rs` | Step output wrappers including step 3 variants and answer evaluation |
| `app/src-tauri/src/contracts/workflow_artifacts.rs` | Tauri DTOs for persisted artifact CRUD |
| `app/src-tauri/src/db/workflow_artifacts.rs` | Normalized artifact persistence |

## Open Questions

1. `[design]` Do we want the throwaway-run classification and tool-access mode to live as first-class typed fields on `OpenHandsRuntimeConfig`, or should they stay one layer up as command-level inputs that are compiled into `skill_dir` plus `allowed_tools` before the runtime config is built?
