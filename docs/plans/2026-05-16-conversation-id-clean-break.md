# Conversation ID Clean Break Implementation Plan

<!-- markdownlint-disable MD032 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make `conversation_id` and `skill_id` the canonical runtime and usage identities, remove the remaining internal `agent_id` seam instead of mapping between `conversation_id` and `agent_id`, and finish the remaining step-1 contract cleanup so `refinements_json` is not mislabeled as `ClarificationsFile`.

**Architecture:** Replace the legacy `agent_runs` usage ledger with a clean-break `conversation_runs` ledger keyed by `conversation_id` and `model`, with `skill_id` as the canonical skill reference plus `skill_name` and `plugin_slug` retained as historical snapshots. Do not migrate historical usage rows. Do not use cascading ownership from conversations, skills, or workflow rows into usage history; usage is an append-only historical ledger. In the same pass, finish the step-1 schema cleanup by introducing a dedicated `RefinementsFile` contract while keeping step 1 evaluator and step 2 decision flows on the existing merged backend JSON input path.

**Tech Stack:** Rust (Tauri, rusqlite, serde, Specta codegen), TypeScript (React, TanStack Query), SQLite migrations

---

## Design Decisions

- `conversation_id` is the only canonical run identity for all OpenHands-backed flows.
- `skill_id` is the canonical skill identity in usage/history records.
- `skill_name` and `plugin_slug` remain in usage/history rows as historical snapshots for deleted skills and for reporting without joins.
- `conversation_runs` is historical data, not owned data. It must not be deleted by skill deletion, conversation deletion, or workflow reset.
- No historical `agent_runs` data needs to be preserved. The migration may drop and recreate the usage ledger in the new shape.
- No app-owned runtime contract, fixture, doc, query, or persistence surface should continue to use `agent_id`. Historical review notes and archived plan documents may still mention it as past architecture only.
- Step 1 storage and downstream runtime flow already treat clarifications and refinements separately; the remaining cleanup is the typed contract boundary.
- Step 1 evaluator and step 2 decision generation should keep consuming the merged backend JSON produced from persisted `clarifications*` and `refinements*`. The contract split is for correctness and clarity at the step-1 output boundary, not a prompt-shape change for downstream agents.

---

### Task 1: Replace the usage ledger schema with `conversation_runs`

**Files:**
- Modify: `app/src-tauri/src/db/migrations.rs`
- Test: `app/src-tauri/src/db/tests.rs`

- [x] **Step 1: Add a migration that drops the legacy `agent_runs` table and creates `conversation_runs`**

Create a new migration function in `app/src-tauri/src/db/migrations.rs` that:
- drops `agent_runs`
- creates `conversation_runs`
- does not copy historical rows

Required table shape:

```sql
CREATE TABLE conversation_runs (
    conversation_id TEXT NOT NULL,
    skill_id INTEGER NOT NULL,
    skill_name TEXT NOT NULL,
    plugin_slug TEXT NOT NULL,
    step_id INTEGER NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_cost REAL,
    session_id TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
    completed_at TEXT,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    duration_ms INTEGER,
    workflow_session_id TEXT,
    num_turns INTEGER DEFAULT 0,
    stop_reason TEXT,
    duration_api_ms INTEGER,
    tool_use_count INTEGER DEFAULT 0,
    compaction_count INTEGER DEFAULT 0,
    workflow_run_id INTEGER,
    PRIMARY KEY (conversation_id, model)
);

CREATE INDEX idx_conversation_runs_skill_id ON conversation_runs(skill_id);
CREATE INDEX idx_conversation_runs_workflow_session_id ON conversation_runs(workflow_session_id);
CREATE INDEX idx_conversation_runs_step_id ON conversation_runs(step_id);
```

Important constraints:
- no foreign key from `conversation_runs.skill_id` to `skills(id)`
- no foreign key from `conversation_runs.conversation_id` to conversation storage
- no `ON DELETE CASCADE`
- `workflow_run_id` is a soft historical reference only if retained; do not attach cascade ownership to it

- [x] **Step 2: Update migration tests for the new table shape**

Update DB migration tests in `app/src-tauri/src/db/tests.rs` so they assert:
- `conversation_runs` exists
- `agent_runs` no longer exists after the new migration
- the PK is `(conversation_id, model)`
- no historical-copy expectation remains

Run: `cd app/src-tauri && cargo test db::tests:: --quiet`
Expected: migration tests pass

- [x] **Step 3: Commit**

```bash
git add app/src-tauri/src/db/migrations.rs app/src-tauri/src/db/tests.rs
git commit -m "refactor(db): replace agent_runs with conversation_runs"
```

---

### Task 2: Rename Rust usage types and persistence APIs to `conversation_id`

**Files:**
- Modify: `app/src-tauri/src/types/usage.rs`
- Modify: `app/src-tauri/src/db/usage.rs`
- Modify: `app/src-tauri/src/agents/run_persist.rs`
- Test: `app/src-tauri/src/db/tests.rs`

- [x] **Step 1: Rename the row model from `AgentRunRecord` to `ConversationRunRecord`**

In `app/src-tauri/src/types/usage.rs`:
- rename `AgentRunRecord` to `ConversationRunRecord`
- rename field `agent_id` to `conversation_id`
- add `skill_id: i64`
- keep `skill_name` and `plugin_slug` as snapshot fields

Target shape:

```rust
#[derive(Clone, Serialize, Deserialize)]
pub struct ConversationRunRecord {
    pub conversation_id: String,
    pub skill_id: i64,
    pub skill_name: String,
    pub plugin_slug: String,
    pub step_id: i32,
    pub model: String,
    pub status: String,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub cache_read_tokens: i32,
    pub cache_write_tokens: i32,
    pub total_cost: f64,
    pub duration_ms: i64,
    pub num_turns: i32,
    pub stop_reason: Option<String>,
    pub duration_api_ms: Option<i64>,
    pub tool_use_count: i32,
    pub compaction_count: i32,
    pub session_id: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}
```

- [x] **Step 2: Rename persistence and query helpers in `db/usage.rs`**

In `app/src-tauri/src/db/usage.rs`:
- rename `persist_agent_run(...)` to `persist_conversation_run(...)`
- replace every `agent_runs` SQL reference with `conversation_runs`
- replace every `agent_id` column reference with `conversation_id`
- insert and query `skill_id`
- preserve `skill_name` and `plugin_slug` writes as snapshots

Important behavioral rule:
- completed or errored conversation runs must still resist downgrade to `shutdown`, matching current logic

- [x] **Step 3: Update runtime persistence to pass `conversation_id` and `skill_id`**

In `app/src-tauri/src/agents/run_persist.rs`:
- rename parameters and logs from `agent_id` to `conversation_id`
- call `persist_conversation_run(...)`
- resolve `skill_id` once and persist it explicitly
- keep logging redaction behavior for `session_id`

- [x] **Step 4: Update DB tests to the new identity model**

Update affected tests in `app/src-tauri/src/db/tests.rs` so they assert:
- rows are keyed by `conversation_id`
- duplicate writes replace on `(conversation_id, model)`
- `skill_id` is present and correct
- rows survive even if related live skill/conversation rows are removed in follow-up test setup

Run: `cd app/src-tauri && cargo test db:: --quiet`
Expected: usage/db tests pass

- [x] **Step 5: Commit**

```bash
git add app/src-tauri/src/types/usage.rs app/src-tauri/src/db/usage.rs app/src-tauri/src/agents/run_persist.rs app/src-tauri/src/db/tests.rs
git commit -m "refactor(rust): make conversation_id canonical in usage persistence"
```

---

### Task 3: Rename Tauri usage commands and frontend usage types

**Files:**
- Modify: `app/src-tauri/src/commands/usage.rs`
- Modify: `app/src/lib/types.ts`
- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/tauri.ts`
- Modify: `app/src/lib/queries/usage.ts`
- Modify: `app/src/components/settings/usage/session-history.tsx`
- Modify: `app/src/components/agent-stats-bar.tsx`
- Modify: `app/src/components/step-complete/index.tsx`
- Modify: `repo-map.json`
- Test: `app/src/__tests__/lib/queries/usage.test.tsx`

- [x] **Step 1: Rename the frontend record type and command map**

In frontend types:
- rename `AgentRunRecord` to `ConversationRunRecord`
- rename field `agent_id` to `conversation_id`
- add `skill_id` and `plugin_slug`

In Tauri command typing:
- rename `get_agent_runs` to `get_conversation_runs`
- rename `get_step_agent_runs` to `get_step_conversation_runs`
- update all return types accordingly

- [x] **Step 2: Update frontend wrappers and query helpers**

In `app/src/lib/tauri.ts` and query helpers:
- rename wrapper functions to `getConversationRuns(...)` and `getStepConversationRuns(...)`
- stop exposing agent terminology at the app boundary

- [x] **Step 3: Update usage UI consumers**

Update all UI components that read usage rows so they:
- use `conversation_id` as the record identity
- display unchanged usage information
- do not assume `agent_id` anywhere in keys, labels, or filtering

Key consumers to update:
- `app/src/components/settings/usage/session-history.tsx`
- `app/src/components/agent-stats-bar.tsx`
- `app/src/components/step-complete/index.tsx`

- [x] **Step 4: Update frontend usage tests**

Update usage query/component tests to the renamed commands and row shape.

Also update repo descriptions that still present usage surfaces in agent terms, especially:
- `repo-map.json` entries for shared Rust types
- any frontend usage descriptions that still mention `AgentRunRecord`

Run:
- `cd app && npx vitest run src/__tests__/lib/queries/usage.test.tsx`
- `cd app && npx tsc --noEmit`

Expected: tests and typecheck pass

- [x] **Step 5: Commit**

```bash
git add app/src-tauri/src/commands/usage.rs app/src/lib/types.ts app/src/lib/tauri-command-types.ts app/src/lib/tauri.ts app/src/lib/queries/usage.ts app/src/components/settings/usage/session-history.tsx app/src/components/agent-stats-bar.tsx app/src/components/step-complete/index.tsx app/src/__tests__/lib/queries/usage.test.tsx repo-map.json
git commit -m "refactor(frontend): rename usage APIs to conversation runs"
```

---

### Task 4: Remove remaining runtime/helper `agent_id` seams

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/guards.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src/lib/types.ts`
- Modify: `app/src/test/mocks/tauri-e2e.ts`
- Test: `app/src-tauri/src/commands/workflow/tests.rs`
- Test: `app/src/__tests__/pages/workflow.test.tsx`
- Test: `app/src/__tests__/hooks/use-workflow-persistence.test.ts`
- Test: `app/src/__tests__/components/workflow-step-complete.test.tsx`

- [x] **Step 1: Delete workflow helper names that still encode `agent_id`**

In `app/src-tauri/src/commands/workflow/guards.rs`:
- rename `make_agent_id(...)` to a conversation-centric helper or remove it entirely if no longer needed
- rename tests accordingly

In `app/src-tauri/src/commands/workflow/runtime.rs`:
- fix stale comments like “Cancel a running workflow step request by agent_id.”
- rename any local variables or log labels that still use `agent`

- [x] **Step 2: Update app-owned TS runtime types**

In `app/src/lib/types.ts`:
- remove any app-owned runtime result types that still publish `agent_id`
- rename `RefineDispatchResult.agent_id` to `conversation_id` if the separate field is redundant, or delete the redundant field entirely if callers only need the canonical conversation identity
- keep raw upstream event fixture shapes separate if they intentionally model OpenHands wire format

Update any frontend mocks that still expose app-owned `get_agent_runs` / `get_step_agent_runs` command names or `agent_id`-centric result shapes, especially `app/src/test/mocks/tauri-e2e.ts`.

- [x] **Step 3: Add regressions proving no app-owned runtime contract still uses `agent_id`**

Add/update tests so:
- workflow runtime uses `conversation_id`
- app-owned result/dispatch types use `conversation_id`
- workflow persistence and step-complete tests do not rely on `activeAgentId`, `agent_id`, or `AgentRunRecord`
- raw runtime fixtures and normalization tests are updated to `conversation_id`

Run:
- `cd app/src-tauri && cargo test commands::workflow --quiet`
- `cd app && npx vitest run src/__tests__/pages/workflow.test.tsx src/__tests__/hooks/use-workflow-persistence.test.ts src/__tests__/components/workflow-step-complete.test.tsx`

Expected: workflow tests pass with conversation-centric names

- [x] **Step 4: Commit**

```bash
git add app/src-tauri/src/commands/workflow/guards.rs app/src-tauri/src/commands/workflow/runtime.rs app/src/lib/types.ts app/src/test/mocks/tauri-e2e.ts app/src-tauri/src/commands/workflow/tests.rs app/src/__tests__/pages/workflow.test.tsx app/src/__tests__/hooks/use-workflow-persistence.test.ts app/src/__tests__/components/workflow-step-complete.test.tsx
git commit -m "refactor(runtime): remove remaining agent_id helper seams"
```

---

### Task 5: Rewrite docs and fixtures so future agents see the right contract

**Files:**
- Modify: `docs/design/openhands-runtime-contract/README.md`
- Modify: `docs/design/openhands-runtime-contract/openhands-conversation-model.md`
- Modify: `docs/design/openhands-runtime-contract/workflow-sequence.md`
- Modify: `docs/design/openhands-runtime-contract/refine-sequence.md`
- Modify: `docs/design/openhands-runtime-contract/implementation-gaps.md`
- Modify: `repo-map.json`
- Modify: `TEST_MAP.md`
- Test: `app/src/__tests__/fixtures/openhands-events/**` (only if app-owned fixture wrappers need renaming)
- Test: `app/src/__tests__/lib/canonical-format.test.ts`

- [x] **Step 1: Rewrite runtime-contract prose around `conversation_id`**

Update design docs so they no longer describe `agent_id` as:
- an app-owned identity
- a tracked runtime concept
- the thing that future conversation surfaces should reason about

Explicitly document:
- `conversation_id` is canonical for OpenHands-backed flows
- usage history is persisted by `conversation_id` and `skill_id`
- usage/history is intentionally not deleted with skill or conversation deletion

- [x] **Step 2: Update repo map and test map if descriptions still mention `agent-store` or `agent runs`**

Make the repo guidance consistent with the new naming.

- [x] **Step 3: Keep only raw upstream fixture mentions of `agent_id`**

Replace stale `agent_id` in runtime fixtures and helper-fixture wrappers with `conversation_id`, matching the current OpenHands-facing code.

Also update canonical-format and helper-fixture tests so they explicitly distinguish:
- normalized/runtime contracts and OpenHands-facing fixture inputs now use `conversation_id`
- `agent_id` is treated as obsolete historical shape, not current boundary truth

- [x] **Step 4: Verify docs formatting**

Run:
- `markdownlint docs/design/openhands-runtime-contract/README.md docs/design/openhands-runtime-contract/openhands-conversation-model.md docs/design/openhands-runtime-contract/workflow-sequence.md docs/design/openhands-runtime-contract/refine-sequence.md docs/design/openhands-runtime-contract/implementation-gaps.md docs/plans/2026-05-16-conversation-id-clean-break.md`
- `cd app && npx vitest run src/__tests__/lib/canonical-format.test.ts`

Expected: no markdownlint errors

- [x] **Step 5: Commit**

```bash
git add docs/design/openhands-runtime-contract/README.md docs/design/openhands-runtime-contract/openhands-conversation-model.md docs/design/openhands-runtime-contract/workflow-sequence.md docs/design/openhands-runtime-contract/refine-sequence.md docs/design/openhands-runtime-contract/implementation-gaps.md repo-map.json TEST_MAP.md docs/plans/2026-05-16-conversation-id-clean-break.md
git commit -m "docs: make conversation_id the canonical runtime identity"
```

---

### Task 6: Full verification and final cleanup

**Files:**
- Verify only

- [x] **Step 1: Run targeted Rust verification**

Run:

```bash
cd app/src-tauri && cargo test db:: --quiet
cd app/src-tauri && cargo test commands::workflow --quiet
cd app/src-tauri && cargo test commands::usage --quiet
cd app/src-tauri && cargo clippy -- -D warnings
```

Expected: all pass

- [x] **Step 2: Run targeted frontend verification**

Run:

```bash
cd app && npx vitest run src/__tests__/lib/queries/usage.test.tsx src/__tests__/pages/workflow.test.tsx
cd app && npx tsc --noEmit
```

Expected: all pass

- [x] **Step 3: Run repo-wide confidence check**

Run:

```bash
bash app/tests/run.sh
```

Expected: full suite green

- [x] **Step 4: Audit for straggler `agent_id` seams**

Run:

```bash
rg -n "agent_id|agentId" app/src app/src-tauri docs repo-map.json TEST_MAP.md
```

Expected:
- only archival review notes or historical plan documents remain
- no app-owned runtime, persistence, usage, Tauri command, test mock, or design-contract surface still uses `agent_id`

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "test: verify conversation_id clean break"
```

---

### Task 7: Split the step-1 contract so `refinements_json` is a real `RefinementsFile`

**Files:**
- Modify: `agent-sources/workspace/skills/shared/output-schemas/step-1-detailed-research.json`
- Modify: `app/src-tauri/src/contracts/workflow_outputs.rs`
- Modify: `app/src-tauri/src/contracts/clarifications.rs` or create a sibling contract file if that is the cleanest place for a dedicated `RefinementsFile`
- Modify: `app/src-tauri/src/bin/codegen.rs`
- Modify: `app/src/generated/contracts.ts`
- Modify: `app/src-tauri/src/generated/schemas.rs`
- Modify: `app/src-tauri/src/commands/workflow/output_format.rs`
- Modify: `app/src/lib/clarifications-types.ts`
- Test: `app/src-tauri/src/commands/workflow/tests.rs`
- Test: `app/src/__tests__/lib/clarifications-types.test.ts`
- Test: `app/src/__tests__/components/clarifications-editor.test.tsx`

- [x] **Step 1: Introduce a dedicated `RefinementsFile` contract**

Define a dedicated step-1 refinements contract with its own top-level type name instead of reusing `ClarificationsFile`.

Requirements:
- `clarifications_json` remains typed as `ClarificationsFile`
- `refinements_json` becomes typed as `RefinementsFile`
- `RefinementsFile` should describe top-level refinement sections/questions without implying it is the same artifact as a step-0 clarifications file

Update:
- the canonical schema file at `agent-sources/workspace/skills/shared/output-schemas/step-1-detailed-research.json`
- Rust `DetailedResearchOutput`
- generated TypeScript contracts

- [x] **Step 2: Keep materialization behavior unchanged while updating typed parsing**

Update `app/src-tauri/src/commands/workflow/output_format.rs` so:
- typed deserialization uses the new `RefinementsFile`
- step 1 still materializes `clarifications_json` into `clarifications*`
- step 1 still materializes `refinements_json` into `refinements*`
- step 1 evaluator and step 2 are unchanged in behavior because they continue consuming the merged backend JSON from persisted DB state

- [x] **Step 3: Update frontend display helpers only where they depend on the old shared contract name**

In `app/src/lib/clarifications-types.ts` and any dependent tests:
- keep the merged display model used by the editor/UI
- update helper typing so it can accept a `RefinementsFile` source without pretending it is a `ClarificationsFile`
- do not change the step 1 evaluator or step 2 input contract shape

- [x] **Step 4: Add contract regressions**

Add/update tests proving:
- `DetailedResearchOutput.refinements_json` is not `ClarificationsFile`
- step 1 materialization still succeeds for valid dual-output payloads
- the merged UI helpers still attach persisted refinements under parent clarification questions

Run:
- `cd app/src-tauri && cargo test commands::workflow --quiet`
- `cd app/src-tauri && cargo run --bin codegen`
- `cd app && npx vitest run src/__tests__/lib/clarifications-types.test.ts src/__tests__/components/clarifications-editor.test.tsx`
- `cd app && npx tsc --noEmit`

Expected: contract generation, tests, and typecheck pass

- [x] **Step 5: Commit**

```bash
git add agent-sources/workspace/skills/shared/output-schemas/step-1-detailed-research.json app/src-tauri/src/contracts/workflow_outputs.rs app/src-tauri/src/contracts/clarifications.rs app/src-tauri/src/bin/codegen.rs app/src/generated/contracts.ts app/src-tauri/src/generated/schemas.rs app/src-tauri/src/commands/workflow/output_format.rs app/src/lib/clarifications-types.ts app/src-tauri/src/commands/workflow/tests.rs app/src/__tests__/lib/clarifications-types.test.ts app/src/__tests__/components/clarifications-editor.test.tsx docs/plans/2026-05-16-conversation-id-clean-break.md
git commit -m "refactor(contract): split refinements_json into dedicated type"
```

<!-- markdownlint-enable MD032 -->
