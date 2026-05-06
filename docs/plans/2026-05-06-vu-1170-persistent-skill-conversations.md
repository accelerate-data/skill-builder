# VU-1170 Persistent Skill Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist one OpenHands conversation per skill, always resume it when
possible, and store the conversation files under that skill's workspace folder
instead of a shared app-wide conversation root.

**Architecture:** Skill Builder starts one Agent Server instance for the
currently open skill. That server persists conversations under
`{workspace_skill_dir}/conversations`. The app stores one durable
`conversation_id` per skill in SQLite. On skill open, the app attempts to
reattach to the saved conversation; if the server cannot find it, the app
creates a new conversation and updates the saved ID. Workflow, refine, and
other skill-bound surfaces reuse that same conversation instead of creating
isolated one-shot conversations.

**Tech Stack:** Rust / Tauri / SQLite / OpenHands Agent Server / React / Vitest
/ cargo tests.

**Design doc:** `docs/design/persistent-skill-conversations/README.md`

---

## File Structure

| File | Change |
|---|---|
| `app/src-tauri/src/agents/openhands_server/process.rs` | Skill-scoped Agent Server lifecycle and conversations root |
| `app/src-tauri/src/agents/openhands_server/client.rs` | Resume/lookup helpers for existing conversations |
| `app/src-tauri/src/agents/openhands_server/mod.rs` | Reattach-or-create orchestration |
| `app/src-tauri/src/db/migrations.rs` | Persisted per-skill conversation storage if schema changes are needed |
| `app/src-tauri/src/db/*` | CRUD helpers for conversation IDs keyed by skill |
| `app/src-tauri/src/commands/refine/mod.rs` | Replace in-memory-only conversation ownership with DB-backed resume |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Reuse the saved conversation instead of creating isolated step conversations |
| `app/src/pages/workflow.tsx` / related frontend state | Rehydration expectations when reopening a skill |

---

### Task 1: Lock the persistence model with failing tests

**Files:**

- Modify: `app/src-tauri/src/db/tests.rs` or the nearest DB test module
- Modify: `app/src-tauri/src/agents/openhands_server/tests.rs` or equivalent
- Modify: frontend tests around skill-open / refine resume when appropriate

- [ ] **Step 1: Add a failing DB test for storing and retrieving one `conversation_id` per `{plugin_slug, skill_name}`**
- [ ] **Step 2: Add a failing runtime test that the Agent Server process uses `{workspace_skill_dir}/conversations` instead of a shared app root**
- [ ] **Step 3: Add a failing orchestration test for "saved conversation found -> resume" and "saved conversation missing -> create new and overwrite ID"**
- [ ] **Step 4: Add a failing refine/workflow-facing test that conversation ownership survives app restart or view close because it is DB-backed**
- [ ] **Step 5: Run the targeted red tests and commit them**

---

### Task 2: Persist per-skill conversation identity in SQLite

**Files:**

- Modify: `app/src-tauri/src/db/migrations.rs`
- Modify: `app/src-tauri/src/db/*`

- [ ] **Step 1: Add the DB schema needed to store one active OpenHands conversation per skill**
- [ ] **Step 2: Add CRUD helpers for load/save/clear by `{plugin_slug, skill_name}`**
- [ ] **Step 3: Re-run DB tests and make them green**
- [ ] **Step 4: Commit the schema and DB helper work**

---

### Task 3: Move Agent Server lifecycle and persistence root to the skill level

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/client.rs`

- [ ] **Step 1: Refactor server startup so the conversations root is derived from the active `workspace_skill_dir`**
- [ ] **Step 2: Add resume helpers that attempt to load the saved conversation before creating a new one**
- [ ] **Step 3: Ensure reopen after crash or app restart restarts the server, then reattaches using the saved ID**
- [ ] **Step 4: Re-run the targeted runtime tests and make them green**
- [ ] **Step 5: Commit the runtime-lifecycle changes**

---

### Task 4: Reuse the persistent conversation across skill-bound surfaces

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/refine/mod.rs`
- Modify: other skill-bound OpenHands callers as needed

- [ ] **Step 1: Replace workflow's isolated per-step conversation creation with reattach-or-create against the skill conversation**
- [ ] **Step 2: Replace refine's in-memory-only conversation ownership with the DB-backed skill conversation**
- [ ] **Step 3: Keep pre-skill flows such as initial scope review on their own isolated conversation path**
- [ ] **Step 4: Add regression tests for workflow plus refine sharing the same saved conversation ID**
- [ ] **Step 5: Commit the surface integration**

---

### Task 5: Final verification and issue follow-through

- [ ] **Step 1: Run targeted cargo tests for DB, OpenHands runtime, workflow, and refine**
- [ ] **Step 2: Run `cd app && npm run test:unit` for any frontend state changes**
- [ ] **Step 3: Run `markdownlint` on the design doc and this plan if they changed during implementation**
- [ ] **Step 4: Update the plan checklist and add verification notes to `VU-1170`**
