# Shared Data Contracts

Single source of truth for cross-layer type definitions, generated from Rust.

## Architecture

Rust structs in `app/src-tauri/src/contracts/` are the canonical type definitions.
A codegen binary (`app/src-tauri/src/bin/codegen.rs`) generates:

- **TypeScript types** via Specta into `app/src/generated/contracts.ts` and `app/sidecar/generated/contracts.ts`
- **JSON Schema** via Schemars into `app/src-tauri/src/generated/schemas.rs` (embedded as `const &str`)

## Contract Modules

| Module | Covers |
|---|---|
| `contracts/clarifications.rs` | `ClarificationsFile`, sections, questions, choices, notes, research plan |
| `contracts/decisions.rs` | `DecisionsMetadata`, `Decision`, `DecisionStatus`, `ContradictoryInputs` |
| `contracts/workflow_outputs.rs` | Step output wrappers (`ResearchStepOutput`, `DetailedResearchOutput`, `DecisionsOutput`, `GenerateSkillOutput`, `AnswerEvaluationOutput`) |
| `contracts/agent_events.rs` | `AgentEvent` tagged union, all event structs, `AgentEventEnvelope` |

## Generated Outputs

| Output | Path | Consumer |
|---|---|---|
| Frontend TS types | `app/src/generated/contracts.ts` | React components, stores |
| Sidecar TS types | `app/sidecar/generated/contracts.ts` | Node.js agent sidecar |
| JSON Schema constants | `app/src-tauri/src/generated/schemas.rs` | Rust `output_format` builders |

## Regeneration

```bash
cd app && npm run codegen
```

This runs `cargo run --manifest-path src-tauri/Cargo.toml --bin codegen`.

## Rules

- Do NOT hand-edit files in `generated/` directories.
- Always commit regenerated files alongside contract struct changes.
- The CI freshness check verifies generated output matches committed files.
- Semantic validation (business rules beyond structural typing) lives in
  `app/src-tauri/src/commands/workflow/output_format.rs`.
