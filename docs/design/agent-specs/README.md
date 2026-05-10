# Agent And Artifact Contracts

This directory documents the current app-owned contracts around workflow
artifacts, storage ownership, and runtime-facing outputs.

It is not the runtime architecture doc. For session lifecycle, persistent
versus throwaway OpenHands sessions, and frontend/backend/runtime layering, see
[../openhands-runtime-model/README.md](../openhands-runtime-model/README.md).

## What Lives Here

- [canonical-format.md](canonical-format.md)
  Canonical artifact and output contracts for the workflow pipeline. The Rust
  contract structs under `app/src-tauri/src/contracts/` are authoritative.
- [storage.md](storage.md)
  Ownership and layout of the database, runtime workspace, and skills path.

## Current Model

### One top-level OpenHands agent

Workflow, refine, create-skill validation, and eval helpers all run through the
same top-level agent identity: `skill-creator`.

- Runtime prompts are rendered by Rust from `agent-sources/prompts/*.txt`.
- Bundled file-based agents and AgentSkills are deployed into `.agents/**`.
- The OpenHands session/conversation lifecycle is defined in
  [../openhands-runtime-model/README.md](../openhands-runtime-model/README.md).

### Workflow artifact authority

Workflow step outputs split into two families:

| Step | Output authority | Canonical output |
|---|---|---|
| 0 Research | SQLite + typed contract validation | `ResearchStepOutput` wrapping `ClarificationsFile` |
| 1 Detailed Research | SQLite + typed contract validation | `DetailedResearchOutput` wrapping `ClarificationsFile` |
| 2 Confirm Decisions | SQLite + typed contract validation | `DecisionsOutput` |
| 3 Generate Skill | Filesystem skill output + typed terminal result | `GenerateSkillOutput` plus `SKILL.md` / `references/` |

The current Rust contract structs live in:

- `app/src-tauri/src/contracts/clarifications.rs`
- `app/src-tauri/src/contracts/decisions.rs`
- `app/src-tauri/src/contracts/workflow_outputs.rs`
- `app/src-tauri/src/contracts/workflow_artifacts.rs`

### Prompt and parsing flow

Workflow commands:

1. Load app-owned context from SQLite and settings.
2. Render the task prompt in Rust.
3. Send the prompt to OpenHands with an output schema attached to the request.
4. Extract the terminal `conversation_state.result_text`.
5. Deserialize into typed Rust structs.
6. Persist normalized artifact rows or materialize skill output files.

Code entry points:

- `app/src-tauri/src/commands/workflow/runtime.rs`
- `app/src-tauri/src/commands/workflow/prompt.rs`
- `app/src-tauri/src/commands/workflow/output_format.rs`

### What is no longer true

This directory no longer describes the old Claude/plugin runtime model.

These older assumptions are obsolete:

- one workflow step per plugin-owned top-level agent
- `.claude/plugins/**` as the active runtime layout
- `user-context.md`, `clarifications.json`, `decisions.json`, or
  `answer-evaluation.json` as canonical workflow state files on disk
- runtime JSONL/stdout as the active runtime contract

## Relationship To Other Design Docs

| Doc | Responsibility |
|---|---|
| [../openhands-runtime-model/README.md](../openhands-runtime-model/README.md) | Session lifecycle, runtime primitives, surface mapping, workspace/conversation ownership |
| [../workflow-artifact-storage/README.md](../workflow-artifact-storage/README.md) | Broader artifact persistence boundary and DB-first workflow state model |
| [../product-architecture/README.md](../product-architecture/README.md) | Product-level architecture overview |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/contracts/clarifications.rs` | Canonical clarifications schema |
| `app/src-tauri/src/contracts/decisions.rs` | Canonical decisions schema |
| `app/src-tauri/src/contracts/workflow_outputs.rs` | Canonical step output wrapper types |
| `app/src-tauri/src/contracts/workflow_artifacts.rs` | Canonical DTOs for artifact CRUD commands |
| `app/src-tauri/src/db/workflow_artifacts.rs` | Normalized SQLite storage for clarifications and decisions |
| `app/src-tauri/src/commands/workflow/output_format.rs` | Terminal output extraction and typed validation |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Workflow runtime orchestration |
| `app/src-tauri/src/commands/workflow/prompt.rs` | Inline prompt rendering from DB-backed state |
