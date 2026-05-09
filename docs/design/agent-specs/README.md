# Agent And Artifact Contracts

This directory documents the agent-layer contracts: which OpenHands agents Skill Builder ships, which file-based AgentSkills it bundles, the workflow-output JSON contracts the agents must produce, and the storage layout those contracts live in.

It is not the runtime architecture doc. For session lifecycle, persistent versus throwaway sessions, and frontend/backend/runtime layering, see [`../openhands-runtime-model/README.md`](../openhands-runtime-model/README.md).

## What Lives Here

- [openhands-agents.md](openhands-agents.md)
  The two named OpenHands agents (`skill-creator`, `skill-verifier`), how each reaches the runtime (compile-time `system_message_suffix` injection vs. file-based deploy under `.agents/agents/`), per-call tool exposure, and the task-routing table.
- [openhands-bundled-skills.md](openhands-bundled-skills.md)
  Bundled file-based AgentSkills (`creating-skills`, `researching-skill-requirements`) and the `shared/` reference directory: deploy contract, discovery contract, per-skill responsibilities.
- [canonical-format.md](canonical-format.md)
  Structural JSON contracts for workflow step outputs and artifacts. Semantic invariants live in `agent-sources/workspace/skills/shared/schemas.md`.
- [storage.md](storage.md)
  Database, runtime workspace, and skills-path ownership.

## Current Model

### One agent identity

Every product surface — workflow steps 0-3, the workflow answer evaluator, refine, scope review, and eval scenario suggest — runs as `skill-creator`. The agent's prose lives at `agent-sources/workspace/agents/skill-creator.md` and is `include_str!`-embedded in the Rust binary, frontmatter-stripped, and injected as `agent_context.system_message_suffix` only when `agent_name == "skill-creator"`.

The `skill-verifier` subagent reaches the runtime as a deployed `.md` file under `<workspace_skill_dir>/.agents/agents/`. The OpenHands SDK discovers file-based agents at conversation creation; `task_tool_set` invokes them. There is no `agent_definitions` payload field.

### Bundled AgentSkills

Two AgentSkills are deployed alongside the agents:

| Skill | Used by |
|---|---|
| `creating-skills` | Workflow step 3 (skill generation). Owns the generator/verifier loop. |
| `researching-skill-requirements` | Workflow steps 0 and 1 (research, detailed research). Owns clarification-question quality. |

`shared/` carries semantic invariants and JSON Schemas referenced by step prompts. It has no `SKILL.md`, so discovery skips it; other skills read its files by relative path.

Source: `agent-sources/workspace/skills/`. Discovery walks `<workspace_skill_dir>/.agents/skills/<dir>/SKILL.md` per conversation.

### Task routing

`task_kind` is the per-call discriminator. Prompt templates are app-owned files under `agent-sources/prompts/`, `include_str!`-embedded into the binary, and rendered in Rust before dispatch.

| Operation | `task_kind` | Prompt template | `allowed_tools` (pre-`task_tool_set`) |
|---|---|---|---|
| Step 0 research | `workflow.research` | `research.txt` | `file_editor`, `terminal`, `browser_tool_set` |
| Step 1 detailed research | `workflow.detailed_research` | `detailed-research.txt` | `file_editor`, `terminal`, `browser_tool_set` |
| Workflow answer evaluator | `workflow.answer_evaluator` | `answer-evaluator.txt` | `file_editor` |
| Step 2 confirm decisions | `workflow.confirm_decisions` | `confirm_decisions.txt` | `file_editor` |
| Step 3 generate skill | `workflow.skill_generation` | `skill-generation.txt` | `file_editor`, `terminal` |
| Refine turn | `refine` | (caller-provided message) | `file_editor`, `terminal` |
| Scope review (throwaway) | `scope_review` | `scope-review.txt` | `file_editor` |
| Eval scenario suggest (throwaway) | `scenario-suggest` | `eval-workbench-suggest-scenario.txt` | `file_editor`, `terminal` |

`task_tool_set` is unconditionally appended after normalization so file-based subagent invocation always works.

The user-message suffix from `agent-sources/prompts/skill-creator-user-suffix.txt` is appended on every surface except eval scenario suggest, which deliberately omits it because its prompt is fully self-contained.

### Output authority

Workflow step outputs split into two families:

| Step | Output authority | Canonical output |
|---|---|---|
| 0 Research | SQLite + typed contract validation | `ResearchStepOutput` wrapping `ClarificationsFile` |
| 1 Detailed Research | SQLite + typed contract validation | `DetailedResearchOutput` wrapping `ClarificationsFile` |
| 2 Confirm Decisions | SQLite + typed contract validation | `DecisionsOutput` |
| 3 Generate Skill | Filesystem skill output + typed terminal result | `GenerateSkillOutput` plus `SKILL.md` / `references/` under the skills path |

The Rust contract structs live in `app/src-tauri/src/contracts/`. See [canonical-format.md](canonical-format.md) for the structural JSON shapes and [`agent-sources/workspace/skills/shared/schemas.md`](../../../agent-sources/workspace/skills/shared/schemas.md) for the semantic invariants.

### Prompt and parsing flow

1. Rust loads app-owned context from SQLite and settings.
2. Rust renders the task prompt from the embedded template.
3. Rust attaches an output schema to the OpenHands request when applicable.
4. The runtime sends the message into the persistent skill conversation (or runs a throwaway session for scope review and eval scenario suggest).
5. Rust extracts the terminal `conversation_state.result_text` (or `structured_output.result` for schema-validated outputs).
6. Rust deserializes into typed structs and persists normalized rows or materializes skill output files.

Code entry points:

- `app/src-tauri/src/agents/sidecar.rs` (`build_openhands_runtime_config`, `skill_creator_system_message_suffix`)
- `app/src-tauri/src/agents/openhands_server/types.rs` (`StartConversationRequest::from_runtime_request_with_initial_message`, `discover_agentskills`, `openhands_tools`)
- `app/src-tauri/src/commands/workflow/runtime.rs` (per-step `SidecarConfig` builders)
- `app/src-tauri/src/commands/workflow/prompt.rs` (template rendering)
- `app/src-tauri/src/commands/workflow/output_format.rs` (terminal-output extraction and typed validation)
- `app/src-tauri/src/commands/workflow/deploy.rs` (two-tier SHA-gated deploy of `agent-sources/workspace/{agents,skills}/`)

## Relationship To Other Design Docs

| Doc | Responsibility |
|---|---|
| [`../openhands-runtime-model/README.md`](../openhands-runtime-model/README.md) | Session lifecycle, runtime primitives, persistent versus throwaway, surface mapping, workspace and conversation ownership. |
| [`../openhands-runtime-model/tools-included.md`](../openhands-runtime-model/tools-included.md) | Registered-tool registry and the default-fallback policy that this directory's per-call `allowed_tools` references. |
| [`../openhands-model-settings/README.md`](../openhands-model-settings/README.md) | The `llm` config that the runtime projects onto every request these agents serve. |
| [`../openhands-event-display-projection/README.md`](../openhands-event-display-projection/README.md) | UI projection of the runtime events these agents emit (`conversation_event`, `conversation_state`). |
| [`../workflow-artifact-storage/README.md`](../workflow-artifact-storage/README.md) | Broader artifact persistence boundary above the per-step output authority documented here. |
| [`../product-architecture/README.md`](../product-architecture/README.md) | Product-level architecture entrypoint. |

## Key Source Files

| File | Purpose |
|---|---|
| `agent-sources/workspace/agents/skill-creator.md` | Main-agent identity prose. |
| `agent-sources/workspace/agents/skill-verifier.md` | File-based subagent prose. |
| `agent-sources/workspace/skills/creating-skills/SKILL.md` | Generator + verifier-loop guidance for step 3. |
| `agent-sources/workspace/skills/researching-skill-requirements/SKILL.md` | Clarification-quality rules for steps 0 and 1. |
| `agent-sources/workspace/skills/shared/schemas.md` | Semantic invariants for research output. |
| `agent-sources/prompts/*.txt` | App-owned task prompt templates. |
| `app/src-tauri/src/contracts/clarifications.rs` | Canonical clarifications schema. |
| `app/src-tauri/src/contracts/decisions.rs` | Canonical decisions schema. |
| `app/src-tauri/src/contracts/workflow_outputs.rs` | Canonical step output wrapper types. |
| `app/src-tauri/src/contracts/workflow_artifacts.rs` | Canonical DTOs for artifact CRUD commands. |
| `app/src-tauri/src/db/workflow_artifacts.rs` | Normalized SQLite storage for clarifications and decisions. |
| `app/src-tauri/src/agents/sidecar.rs` | `SidecarConfig` builder, system-suffix loader. |
| `app/src-tauri/src/agents/openhands_server/types.rs` | OpenHands request shape, AgentSkills discovery, tool resolution. |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Workflow runtime orchestration. |
| `app/src-tauri/src/commands/workflow/output_format.rs` | Terminal-output extraction and typed validation. |
| `app/src-tauri/src/commands/workflow/deploy.rs` | Two-tier SHA-gated agent/skill deploy. |
