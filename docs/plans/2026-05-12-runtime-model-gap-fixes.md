# Runtime Model Gap Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve eight gaps between the OpenHands runtime model design spec and the current codebase, identified by adversarial review on 2026-05-12 and the implementation-gaps backlog.

**Architecture:** Three-layer Rust+TypeScript app (Layer 1: raw OpenHands API, Layer 2: skill_creator model, Layer 3: Tauri commands). Fixes span both the Rust backend (session lifecycle, naming, artifact identity) and the React frontend (session readiness guards). Finding 3 was already closed (implementation-gaps.md deleted). Items #6 and #7 from `docs/design/backend-design/implementation-gaps.md` (artifact identity cleanup, docs index drift) are added as PR D.

**Tech Stack:** Rust (Tauri commands, rusqlite), React 19 (Zustand, TanStack Router), TypeScript

---

## PR Map

| PR | Findings | Risk | Files |
|---|---|---|---|
| PR A | #1 — conversationId guard | Low (frontend only) | `workflow.tsx`, `workspace-refine.tsx` |
| PR B | #2 — lock release propagation | Low (error path only) | `skill_session.rs` |
| PR C | #4 + #6 + #7 — Rust rename + cleanup | Low (search-replace + trivial) | `workflow/settings.rs`, `skill_session.rs`, `refine/mod.rs`, 3 callers |
| PR D | #6 (gaps) + #7 (gaps) — artifact identity + docs index | Low (DB contract + docs) | `workflow_artifacts.rs`, `clarifications.rs`, `decisions.rs`, `migrations.rs`, `docs/design/README.md` |
| PR E (optional) | #5 — move event helpers | Medium (structural refactor) | `agents/openhands_server/events.rs`, `refine/mod.rs`, `skill_session.rs` | **MERGED** |

Do PRs A, B, C, D in order (each merges before next starts). PR E can be deferred.

---

## PR A — Finding #1: `conversationId` Readiness Guard

### Background

The optimistic-session-activation spec requires both `WorkflowPage` and the refine surface to show a loading skeleton until `refineStore.conversationId` is non-null. Currently `WorkflowPage` guards only on `isLoaded` (DB persistence); `WorkspaceRefine` renders immediately and hard-refuses sends when `conversationId` is null. This creates a visible broken state between route arrival and session boot completion.

### Files

- Modify: `app/src/pages/workflow.tsx` (around line 466)
- Modify: `app/src/components/workspace/workspace-refine.tsx` (around line 35–44)

---

### Task A1: Guard `WorkflowPage` on `conversationId`

**Files:**
- Modify: `app/src/pages/workflow.tsx`

- [ ] **Step 1: Locate the `conversationId` selector block**

Open `app/src/pages/workflow.tsx`. Around line 187 there is already a `useRefineStore` selector:

```typescript
const refineSelectedSkill = useRefineStore((s) => s.selectedSkill);
```

Add `conversationId` to the same block:

```typescript
const refineSelectedSkill = useRefineStore((s) => s.selectedSkill);
const conversationId = useRefineStore((s) => s.conversationId);
```

- [ ] **Step 2: Update the loading guard (around line 466)**

Change:

```typescript
if (!isLoaded) {
  return <WorkflowLoadingSkeleton />;
}
```

To:

```typescript
if (!isLoaded || !conversationId) {
  return <WorkflowLoadingSkeleton />;
}
```

- [ ] **Step 3: Type-check**

```bash
cd app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/workflow.tsx
git commit -m "fix: guard WorkflowPage on conversationId readiness"
```

---

### Task A2: Guard `WorkspaceRefine` on `conversationId`

**Files:**
- Modify: `app/src/components/workspace/workspace-refine.tsx`

- [ ] **Step 1: Add `conversationId` selector at the top of the component**

In `WorkspaceRefine`, around line 40–44, add a reactive selector. The existing selectors are:

```typescript
const selectedSkill = useRefineStore((s) => s.selectedSkill);
const skillFiles = useRefineStore((s) => s.skillFiles);
const isRunning = useRefineStore((s) => s.isRunning);
const activeAgentId = useRefineStore((s) => s.activeAgentId);
```

Add after them:

```typescript
const conversationId = useRefineStore((s) => s.conversationId);
```

- [ ] **Step 2: Add the loading skeleton guard**

Find the component's first `return` statement (the main JSX return, not an early return for `scopeBlocked` etc.). Add this guard immediately before that return, but after all hooks (hooks must not be called conditionally):

```typescript
if (!conversationId) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-muted-foreground text-sm">Connecting to session…</p>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Unit test — guard renders skeleton when conversationId is null**

Run existing unit tests to ensure no regressions:

```bash
cd app && npm run test:unit -- --run
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/workspace/workspace-refine.tsx
git commit -m "fix: show loading state in WorkspaceRefine until conversationId is ready"
```

---

## PR B — Finding #2: Propagate Lock-Release Failures in `pause_openhands_session`

### Background

The leave contract says: if pause fails, the current skill stays visible and the next skill does NOT bootstrap. Currently, `pause_openhands_session` uses `let _ = crate::db::release_skill_lock_by_skill_id(...)` — discarding the error. If the DB lock fails or the DELETE fails, the lease stays stuck but UI state is cleared, violating the contract.

### Files

- Modify: `app/src-tauri/src/commands/skill_session.rs` (around lines 368–374)

---

### Task B1: Propagate lock-release errors

**Files:**
- Modify: `app/src-tauri/src/commands/skill_session.rs`

- [ ] **Step 1: Write the failing test**

Open `app/src-tauri/src/commands/skill_session.rs`. Add to the `#[cfg(test)]` block:

```rust
#[test]
fn pause_with_nonexistent_lock_does_not_silently_succeed() {
    // This test documents the contract: if release_skill_lock_by_skill_id
    // returns an error, it must bubble up rather than being silently dropped.
    // The function returns an error for a lock that was never acquired.
    let conn = crate::db::create_test_db_for_tests();
    let skill_id =
        crate::db::upsert_skill(&conn, "no-lock-skill", "skill-builder", "domain").unwrap();

    // release on a skill with no lock row should return an error
    let result = crate::db::release_skill_lock_by_skill_id(&conn, skill_id, "instance-x");
    assert!(result.is_err(), "expected error releasing a non-existent lock");
}
```

Run:

```bash
cd app/src-tauri && cargo test skill_session::tests::pause_with_nonexistent_lock_does_not_silently_succeed
```

Expected: this test may pass or fail depending on the current DB behavior — it validates the assumption before the fix.

- [ ] **Step 2: Fix the lock-release code**

Find the section in `pause_openhands_session` (around lines 367–374):

```rust
if let Some(sid) = skill_id {
    if let Ok(conn) = db.0.lock() {
        let _ = crate::db::release_skill_lock_by_skill_id(&conn, sid, &instance.id);
    }
}

Ok(())
```

Replace with:

```rust
if let Some(sid) = skill_id {
    let conn = db
        .0
        .lock()
        .map_err(|e| format!("failed to lock DB during lock release: {e}"))?;
    crate::db::release_skill_lock_by_skill_id(&conn, sid, &instance.id)
        .map_err(|e| format!("failed to release skill lock {sid}: {e}"))?;
}

Ok(())
```

- [ ] **Step 3: Compile**

```bash
cd app/src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 4: Run the skill_session tests**

```bash
cd app/src-tauri && cargo test skill_session::
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/commands/skill_session.rs
git commit -m "fix: propagate lock-release errors in pause_openhands_session"
```

---

## PR C — Findings #4, #6, #7: Rust Naming + Cleanup

### Background

Three low-risk, high-clarity fixes batched together because they all touch the same files and have no behavioral impact:

- **#4**: `InitializedRuntimeContext.workspace_path` stores `settings.skills_path`. Rename the field to `skills_root` to match the design spec vocabulary and prevent future misuse.
- **#6**: `resolve_skills_path()` is defined privately in both `commands/skill_session.rs` (line 111) and `commands/refine/mod.rs` (line 20). Consolidate to one `pub(crate)` copy.
- **#7**: `RefineConversationDispatchPlan` is an enum with one variant (`ReuseExisting(String)`). Replace with `String`.

### Files

- Modify: `app/src-tauri/src/commands/workflow/settings.rs`
- Modify: `app/src-tauri/src/commands/skill_session.rs`
- Modify: `app/src-tauri/src/commands/refine/mod.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs` (caller of `workspace_path`)
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs` (caller of `workspace_path`)

---

### Task C1: Rename `workspace_path` → `skills_root` in `InitializedRuntimeContext`

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/settings.rs`
- Modify: all callers

- [x] **Step 1: Update the struct and constructor**

In `app/src-tauri/src/commands/workflow/settings.rs`, rename the field:

```rust
// Before
pub(crate) struct InitializedRuntimeContext {
    pub workspace_path: String,
    pub llm: crate::types::WorkflowLlmConfig,
}

// After
pub(crate) struct InitializedRuntimeContext {
    pub skills_root: String,
    pub llm: crate::types::WorkflowLlmConfig,
}
```

Update the constructor:

```rust
// Before
Ok(InitializedRuntimeContext {
    workspace_path,
    llm,
})

// After
Ok(InitializedRuntimeContext {
    skills_root: workspace_path,
    llm,
})
```

Also update the local variable name for clarity:

```rust
// Before
let workspace_path = settings
    .skills_path
    .clone()
    ...
if !std::path::Path::new(&workspace_path).is_dir() {
    return Err(format!("Skills path is not initialized: {}...", workspace_path));
}

// After
let skills_root = settings
    .skills_path
    .clone()
    ...
if !std::path::Path::new(&skills_root).is_dir() {
    return Err(format!("Skills path is not initialized: {}...", skills_root));
}
```

Update the test in the same file that uses `workspace_path`:

```rust
// Find: context.workspace_path → context.skills_root
// Find: workspace_path.clone() variable naming in test setup → skills_root
```

- [x] **Step 2: Update all callers**

Search for `.workspace_path` across the Rust codebase:

```bash
grep -rn "\.workspace_path" /Users/hbanerjee/src/skill-builder/app/src-tauri/src/
```

For each match, rename `.workspace_path` to `.skills_root`. Key callers:

- `commands/skill_session.rs`: `runtime_ctx.workspace_path` → `runtime_ctx.skills_root` (two callsites)
- `commands/refine/mod.rs`: `runtime_ctx.workspace_path` → `runtime_ctx.skills_root`
- `commands/eval_workbench/mod.rs`: same
- `commands/workflow/runtime.rs`: same (if present)

- [x] **Step 3: Compile**

```bash
cd app/src-tauri && cargo check
```

Expected: no errors.

- [x] **Step 4: Run all Rust unit tests**

```bash
cd app/src-tauri && cargo test
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
git add app/src-tauri/src/commands/workflow/settings.rs \
        app/src-tauri/src/commands/skill_session.rs \
        app/src-tauri/src/commands/refine/mod.rs \
        app/src-tauri/src/commands/eval_workbench/mod.rs \
        app/src-tauri/src/commands/workflow/runtime.rs
git commit -m "refactor: rename InitializedRuntimeContext.workspace_path -> skills_root"
```

---

### Task C2: Consolidate `resolve_skills_path` (Finding #6)

**Files:**
- Modify: `app/src-tauri/src/commands/skill_session.rs`
- Modify: `app/src-tauri/src/commands/refine/mod.rs`

- [x] **Step 1: Make `resolve_skills_path` pub(crate) in `skill_session.rs`**

In `app/src-tauri/src/commands/skill_session.rs`, change:

```rust
// Before
fn resolve_skills_path(db: &Db) -> Result<String, String> {

// After
pub(crate) fn resolve_skills_path(db: &Db) -> Result<String, String> {
```

- [x] **Step 2: Delete the duplicate from `refine/mod.rs`**

In `app/src-tauri/src/commands/refine/mod.rs`, delete the private `resolve_skills_path` function (lines ~20–26):

```rust
// DELETE this entire function:
pub(crate) fn resolve_skills_path(db: &Db) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = db::read_settings(&conn)?;
    settings
        .skills_path
        .ok_or_else(|| "Skills path not configured in settings".to_string())
}
```

- [x] **Step 3: Update callers in `refine/mod.rs`**

Any call to `resolve_skills_path(db)` within `refine/mod.rs` must now use the path from `skill_session.rs`. Since they're in the same crate and `skill_session` is a sibling module:

```rust
// Before (inside refine/mod.rs)
resolve_skills_path(db)?

// After
crate::commands::skill_session::resolve_skills_path(db)?
```

- [x] **Step 4: Compile**

```bash
cd app/src-tauri && cargo check
```

Expected: no errors.

- [x] **Step 5: Run tests**

```bash
cd app/src-tauri && cargo test commands::refine && cargo test commands::skill_session
```

Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add app/src-tauri/src/commands/skill_session.rs \
        app/src-tauri/src/commands/refine/mod.rs
git commit -m "refactor: consolidate resolve_skills_path into skill_session"
```

---

### Task C3: Remove single-variant `RefineConversationDispatchPlan` enum (Finding #7)

**Files:**
- Modify: `app/src-tauri/src/commands/refine/mod.rs`

- [x] **Step 1: Delete the enum**

Find and delete:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
enum RefineConversationDispatchPlan {
    ReuseExisting(String),
}
```

- [x] **Step 2: Update `plan_refine_conversation_dispatch` to return `Result<String, String>`**

Change the function signature and return:

```rust
// Before
fn plan_refine_conversation_dispatch(
    session: &SkillSession,
    requested_conversation_id: Option<String>,
) -> Result<RefineConversationDispatchPlan, String> {
    ...
    Ok(RefineConversationDispatchPlan::ReuseExisting(
        active_conversation_id,
    ))
}

// After
fn plan_refine_conversation_dispatch(
    session: &SkillSession,
    requested_conversation_id: Option<String>,
) -> Result<String, String> {
    ...
    Ok(active_conversation_id)
}
```

- [x] **Step 3: Update the caller in `send_refine_message`**

Find the destructuring that uses the enum (around line 393):

```rust
// Before
let RefineConversationDispatchPlan::ReuseExisting(active_conversation_id) = dispatch_plan;

// After
let active_conversation_id = dispatch_plan;
```

- [x] **Step 4: Compile**

```bash
cd app/src-tauri && cargo check
```

Expected: no errors.

- [x] **Step 5: Run tests**

```bash
cd app/src-tauri && cargo test commands::refine
```

Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add app/src-tauri/src/commands/refine/mod.rs
git commit -m "refactor: remove single-variant RefineConversationDispatchPlan enum"
```

---

## PR D — Findings #6 + #7 (gaps): Artifact Identity + Docs Index

### Background

Two low-risk items from the implementation-gaps backlog:

- **#6 (gaps)**: Artifact identity cleanup — target architecture requires canonical
  skill resolution for clarifications and decisions through `skills.id`, with no
  redundant artifact parent identity or name-based ambiguity. VU-1179 work is
  actively addressing this area.
- **#7 (gaps)**: Documentation index drift — `docs/design/README.md` needs to
  reference the live LiteLLM design directory under
  `docs/design/litellm-integration/` correctly.

---

### Task D1: Verify artifact identity uses canonical `skills.id`

**Files:**
- Review: `app/src-tauri/src/db/workflow_artifacts.rs`
- Review: `app/src-tauri/src/commands/workflow/clarifications.rs`
- Review: `app/src-tauri/src/commands/workflow/decisions.rs`
- Review: `app/src-tauri/src/db/migrations.rs`

- [x] **Step 1: Audit artifact resolution paths**

Read the four files above and verify:

1. Clarifications and decisions resolve skills by `skills.id` (primary key), not
   by name or redundant parent identity. **VERIFIED**: `resolve_skill_db_id()` →
   `resolve_skill_master_id_from_identifier()` always returns `skills.id` (integer).
2. No name-based ambiguity exists in artifact resolution queries. **VERIFIED**: All
   artifact tables use `skill_id INTEGER` as FK; commands pass `skill_id` directly.
3. The migration history reflects the canonical `skills.id` contract. **VERIFIED**.

- [x] **Step 2: Fix any remaining name-based or redundant identity resolution**

No fixes needed. All resolution paths already use `skills.id` as the canonical key.

- [ ] **Step 3: Compile and test**

```bash
cd app/src-tauri && cargo check
cd app/src-tauri && cargo test commands::workflow
```

Expected: no errors, all pass.

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/db/workflow_artifacts.rs \
        app/src-tauri/src/commands/workflow/clarifications.rs \
        app/src-tauri/src/commands/workflow/decisions.rs \
        app/src-tauri/src/db/migrations.rs
git commit -m "fix: ensure canonical skills.id for artifact identity resolution"
```

---

### Task D2: Fix documentation index drift

**Files:**
- Modify: `docs/design/README.md`

- [x] **Step 1: Read `docs/design/README.md`**

Check for any references to old design directories (e.g., `docs/design/model-settings/`)
that should now point to `docs/design/litellm-integration/`.

**VERIFIED**: `docs/design/README.md` line 7 correctly references `litellm-integration/`.
No stale paths found.

- [x] **Step 2: Update links**

No updates needed. The README accurately reflects the current design folder structure.

- [ ] **Step 3: Commit**

```bash
git add docs/design/README.md
git commit -m "docs: fix design index to reference litellm-integration directory"
```

---

## PR E (Optional) — Finding #5: Move Event Helpers Out of `refine/`

### Background

`commands/skill_session.rs::restore_skill_conversation_state` calls `crate::commands::refine::extract_conversation_messages` and `crate::commands::refine::extract_restored_conversation_events`. Event parsing and message extraction are session-layer concerns, but they live in `commands/refine/mod.rs`. This creates a reverse dependency: the canonical session surface cannot restore itself without refine-specific helpers.

The fix: move event helpers to a new `commands/refine/events.rs` file (or into `commands/skill_session.rs` directly if there are few enough helpers), making `refine/mod.rs` a consumer of the helpers rather than their home.

### Why This Is Optional

The coupling works correctly today. The fix is purely architectural and has no customer-visible impact. Defer if bandwidth is tight; address when a second consumer of event-restore logic emerges.

### Files

- Create: `app/src-tauri/src/commands/refine/events.rs`
- Modify: `app/src-tauri/src/commands/refine/mod.rs`
- Modify: `app/src-tauri/src/commands/skill_session.rs`

---

### Task D1: Extract event helpers into `commands/refine/events.rs`

**Files:**
- Create: `app/src-tauri/src/commands/refine/events.rs`
- Modify: `app/src-tauri/src/commands/refine/mod.rs`

- [x] **Step 1: Create `events.rs` with the extracted helpers**

Create `app/src-tauri/src/commands/refine/events.rs` and move these functions from `refine/mod.rs`:

- `event_class(raw: &serde_json::Value) -> Option<&str>`
- `first_string(values: ...) -> Option<&str>`
- `extract_message_text(raw: &serde_json::Value) -> Option<String>`
- `extract_tool_call_id(raw: &serde_json::Value) -> Option<String>`
- `extract_parent_tool_call_id(raw: &serde_json::Value) -> Option<String>`
- `extract_timestamp_ms(raw: &serde_json::Value) -> i64`
- `pub(crate) extract_conversation_messages(events: &[serde_json::Value]) -> Vec<crate::types::ConversationMessage>`
- `pub(crate) extract_restored_conversation_events(events: &[serde_json::Value]) -> Vec<crate::types::RestoredConversationEvent>`
- `pub(crate) restored_conversation_user_turn_count(events: &[crate::types::RestoredConversationEvent]) -> usize`

The three `pub(crate)` functions keep their visibility. The private helpers stay private within the new file.

- [x] **Step 2: Declare the module in `refine/mod.rs`**

Add at the top of `app/src-tauri/src/commands/refine/mod.rs`:

```rust
pub mod events;
```

Remove the moved functions from `mod.rs`.

Update any internal calls in `mod.rs` to use `events::extract_conversation_messages(...)` etc.

- [x] **Step 3: Update `skill_session.rs` callers**

In `commands/skill_session.rs`, `restore_skill_conversation_state` currently calls:

```rust
crate::commands::refine::extract_conversation_messages(events)
crate::commands::refine::extract_restored_conversation_events(events)
crate::commands::refine::restored_conversation_user_turn_count(events)
```

Update to:

```rust
crate::commands::refine::events::extract_conversation_messages(events)
crate::commands::refine::events::extract_restored_conversation_events(events)
crate::commands::refine::events::restored_conversation_user_turn_count(events)
```

- [x] **Step 4: Compile**

```bash
cd app/src-tauri && cargo check
```

Expected: no errors.

- [x] **Step 5: Run all Rust tests**

```bash
cd app/src-tauri && cargo test
```

Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add app/src-tauri/src/commands/refine/events.rs \
        app/src-tauri/src/commands/refine/mod.rs \
        app/src-tauri/src/commands/skill_session.rs
git commit -m "refactor: move event extraction helpers to commands/refine/events.rs"
```

---

## Validation Checklist (all PRs)

| Check | Command |
|---|---|
| TypeScript types | `cd app && npx tsc --noEmit` |
| Frontend unit tests | `cd app && npm run test:unit -- --run` |
| Rust compile | `cd app/src-tauri && cargo check` |
| Rust tests | `cd app/src-tauri && cargo test` |
| Clippy | `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings` |

No E2E tests are required for these changes — they are runtime-invisible (skeleton guard replaces broken state, error propagation changes error path only, renaming has no observable behavior change).
