# Data Contracts: Rust Specta + Schemars

**Status**: Implemented (VU-996)
**Issue**: [VU-996](https://linear.app/acceleratedata/issue/VU-996)

## Problem

Workflow step outputs suffer from data contract drift across 4 layers:

1. **Output contract schema** declares `clarifications_json` as `{ "type": "object" }` — no inner structure
2. **Rust validator** (`validate_clarifications_json()`) does deep imperative checks the SDK doesn't enforce
3. **Agent prose** (`schemas.md`) hand-written descriptions that drift from the Rust validator
4. **Frontend** (`parseClarifications()`) silently patches missing fields and handles legacy formats
5. **Coercion helpers** (`coerce_to_i64/string/bool`) mask type mismatches between layers

Result: agents produce output the SDK accepts but Rust rejects (e.g., `"clarifications_json.version must be present"`).

## Solution

**Single source of truth**: Rust structs define the canonical shape for all workflow data contracts. Two code-generation crates produce downstream artifacts at build time:

| Crate | Output | Consumers |
|---|---|---|
| `specta` + `specta-typescript` | TypeScript types | Frontend (`app/src/generated/`), Sidecar (`app/sidecar/generated/`) |
| `schemars` | JSON Schema | App output contracts, agent `schemas.md` |

No hand-maintained type mirrors. No untyped `serde_json::Value` escape hatches. No coercion.

## Architecture

```text
┌─────────────────────────────────────────────────┐
│  Rust Contract Structs                          │
│  app/src-tauri/src/contracts/                   │
│  ┌──────────────┐  ┌──────────┐  ┌───────────┐ │
│  │clarifications│  │decisions │  │agent_events│ │
│  │  11 structs  │  │ 4 types  │  │ 15 types  │ │
│  └──────┬───────┘  └────┬─────┘  └─────┬─────┘ │
│         │               │              │        │
│  ┌──────┴───────────────┴──────────────┴─────┐  │
│  │  workflow_outputs (6 step output structs)  │  │
│  └───────────────────┬───────────────────────┘  │
└──────────────────────┼──────────────────────────┘
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
    ┌───────────┐ ┌─────────┐ ┌─────────────────┐
    │ TypeScript │ │  JSON   │ │  Rust const     │
    │  types    │ │ Schema  │ │  schema strings  │
    │ (Specta)  │ │(Schemars│ │  (for app        │
    │           │ │)        │ │   contracts)     │
    └─────┬─────┘ └────┬────┘ └────────┬────────┘
          │            │               │
    ┌─────┴─────┐  ┌───┴────┐  ┌──────┴──────────┐
    │ Frontend  │  │shared/ │  │workflow_output   │
    │ Sidecar   │  │schemas │  │_format_for_agent │
    │ (imports) │  │.md     │  │()                │
    └───────────┘  └────────┘  └──────────────────┘
```

## Codegen Binary

A separate Rust binary (`app/src-tauri/src/bin/codegen.rs`) runs as `npm run codegen`:

1. Imports all contract types from `app_lib::contracts`
2. Uses Specta to export TypeScript → `app/src/generated/contracts.ts` + `app/sidecar/generated/contracts.ts`
3. Uses Schemars to export JSON Schema → `app/src-tauri/src/generated/schemas.rs` (Rust const strings for app output contracts)
4. Writes inline JSON Schema files → `agent-sources/plugins/skill-content-researcher/shared/output-schemas/` (agents Read these at runtime)

A companion `validate-output` binary (`app/src-tauri/src/bin/validate_output.rs`) validates JSON from stdin against step-specific contract structs.

Deep schemas with `$ref`/`$defs` are maintained separately at `shared/output-deep-schemas/` for human readability.

Wired into `app/scripts/dev.mjs` before `sidecar:build`. CI freshness check: `npm run codegen && git diff --exit-code`.

## Contract Types

### Clarifications (`contracts/clarifications.rs`)

```text
ClarificationsFile
├── version: String ("1")
├── metadata: ClarificationsMetadata
│   ├── question_count, section_count, refinement_count, must_answer_count: i64
│   ├── priority_questions: Vec<String>
│   ├── research_plan?: ClarificationsResearchPlan
│   │   ├── dimension_scores: Vec<DimensionScore>
│   │   └── selected_dimensions: Vec<SelectedDimension>
│   ├── warning?: { code, message }
│   └── error?: { code, message }
├── sections: Vec<Section>
│   └── questions: Vec<Question>    ← recursive (refinements: Vec<Question>)
│       └── choices: Vec<Choice>
├── notes: Vec<Note>
└── answer_evaluator_notes?: Vec<Note>
```

### Decisions (`contracts/decisions.rs`)

```text
DecisionsOutput
├── version: String
├── metadata: DecisionsMetadata
│   ├── decision_count, conflicts_resolved, round: i64
│   ├── contradictory_inputs?: bool | "revised"  (untagged enum)
│   └── scope_recommendation?: bool
└── decisions: Vec<Decision>
    └── status: resolved | conflict-resolved | needs-review | revised
```

### Agent Events (`contracts/agent_events.rs`)

```text
AgentEventEnvelope
├── type: "agent_event"
├── event: AgentEvent (tagged union by "type")
│   ├── RunConfigEvent
│   ├── RunInitEvent
│   ├── TurnUsageEvent
│   ├── CompactionEvent
│   ├── ContextWindowEvent
│   ├── SessionExhaustedEvent
│   ├── InitProgressEvent
│   ├── TurnCompleteEvent
│   └── RunResultEvent
└── timestamp: u64
```

## Key Design Decisions

### Inline JSON Schema as App Contract

The app generates **inline** JSON Schema from Rust structs — all `$ref` resolved, `additionalProperties: false` on every object, no `$schema`/`definitions` block. The schema is an app contract used in prompts and validation. OpenHands does not receive it as an SDK `outputFormat` option.

1. Agent prompts include strong prompt directives ("CRITICAL: raw JSON only, no markdown fences") and reference generated JSON schema files at `shared/output-schemas/`.
2. The OpenHands runner emits the final assistant message as terminal result text.
3. The app extracts one JSON object from that result text.
4. Rust serde deserializes the extracted object into typed contract structs — this is the authoritative validation.

### Recursive Question type

`Question.refinements: Vec<Question>` — recursive self-reference. Specta generates `$ref` in TypeScript, Schemars generates `$ref` in JSON Schema. Depth is controlled by agent prompts ("refinements do not have sub-refinements"), not the type system. This is a safety net for forward compatibility.

### Clean break on legacy migration

`parseClarifications()` legacy migration code (dimensions → sections conversion) is removed. Existing skills built before this change won't load old-format clarifications. Intentional — forces all data through the canonical contract.

### Semantic validation separate from structural

Structural validation: handled by serde deserialization (`serde_json::from_value::<T>()`).
Semantic validation: `validate_business_rules()` methods on contract structs for rules beyond type system (e.g., "vague verdict requires reason", status enum checks).

## What Gets Removed

| Item | Location | Reason |
|---|---|---|
| `validate_clarifications_json()` | `step_config.rs:228-387` | Replaced by serde deserialization |
| `coerce_to_i64/string/bool` | `workflow/mod.rs:38-60` | Rust typed validation catches type drift |
| Hand-crafted JSON Schema | `step_config.rs:94-199` | Replaced by Schemars-generated schemas |
| Frontend type interfaces | `clarifications-types.ts:4-97` | Replaced by Specta-generated imports |
| Sidecar event interfaces | `sidecar/agent-events.ts:10-115` | Replaced by Specta-generated imports |
| Frontend event mirror | `src/lib/agent-events.ts` | Becomes thin re-export of generated types |
| `SidecarRunSummary` | `event_types.rs` | Replaced by `RunResultEvent` from contracts |
| Duplicate `schemas.md` | Two copies in research + answer-evaluator | Single generated copy in `shared/` |
| Legacy migration in `parseClarifications()` | `clarifications-types.ts:161-259` | Clean break |

## What Stays

| Item | Location | Reason |
|---|---|---|
| `parseClarifications()` (minus legacy) | `clarifications-types.ts` | Runtime parser, imports generated types |
| Helper functions | `clarifications-types.ts` | `getSectionStatus`, `getTotalCounts`, etc. |
| `parseAnswerFeedback()` | `clarifications-review.ts` | Imports `Note` from generated |
| Decisions helpers | `decisions-summary-card.tsx` | `parseDecisions`, `serializeDecisions` |
| `materialize_workflow_step_output_value()` | `output_format.rs` | Logic stays, uses typed deserialization |

## Testing Strategy

- **Unit tests**: Rust struct round-trip, JSON Schema validation against fixtures, TypeScript compilation
- **Component tests**: Frontend parsing with generated types (existing test suites)
- **CI freshness check**: `npm run codegen && git diff --exit-code` in PR pipeline
- **Manual**: Run workflow Step 0 → Step 1 to confirm e2e contract enforcement

## Source Files

| File | Role |
|---|---|
| `app/src-tauri/src/contracts/` | Canonical contract type definitions (Rust structs) |
| `app/src-tauri/src/bin/codegen.rs` | Build-time code generator (Specta TS + Schemars JSON Schema) |
| `app/src-tauri/src/bin/validate_output.rs` | CLI validator — pipe JSON stdin, exit 0/1 |
| `app/src/generated/contracts.ts` | Generated frontend TypeScript |
| `app/sidecar/generated/contracts.ts` | Generated sidecar TypeScript |
| `app/src-tauri/src/generated/schemas.rs` | Generated inline JSON Schema const strings for app prompts and validation |
| `agent-sources/.../shared/output-schemas/` | Generated inline JSON Schema files (agents Read at runtime) |
| `agent-sources/.../shared/output-deep-schemas/` | Deep JSON Schema with `$ref`/`$defs` (human-readable) |
| `agent-sources/.../shared/schemas.md` | Semantic rules supplement (what JSON Schema cannot express) |
| `app/sidecar/message-processor.ts` | Structured output extraction + missing-output error handling |
| `app/sidecar/lib/result-extraction.ts` | Display markdown extraction from structured output |
| `.claude/rules/codegen.md` | Agent rule: run codegen when modifying contracts |
