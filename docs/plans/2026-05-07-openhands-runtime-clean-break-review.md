# OpenHands Runtime Clean Break — Code Review Feedback

> **Branch:** `feature/openhands-runtime-clean-break`
> **Reviewed commit:** `d4877945`
> **Date:** 2026-05-07
> **Reviewer:** OpenCode

## Overall Assessment

The clean-break refactor successfully replaces the old heuristic persistence model with four explicit runtime primitives. The architecture matches the design doc, all tests pass (1,107 Rust, 597 frontend), and the net deletion (~2,100 lines) confirms genuine dead-code removal. **This is a solid refactor.**

The remaining gaps are implementation-hygiene issues — error typing, primitive-level test coverage, and operational observability. None are merge blockers, but addressing the high-severity items before or shortly after merge will prevent compounding maintainability debt.

---

## High-Severity Items

### 1. `user_message_suffix` in `conversation_matches_request` May Break Conversation Reuse

**Location:** `app/src-tauri/src/agents/openhands_server/mod.rs`

**Problem:** The new compatibility check includes `user_message_suffix`:

```rust
persisted_system_suffix == request.system_message_suffix.as_deref()
    && persisted_user_suffix == request.user_message_suffix.as_deref()
```

If `user_message_suffix` contains per-message dynamic content (timestamps, run IDs, turn counters), **every turn will recreate the conversation**, losing accumulated context. The design doc says `skill-creator-user-suffix.txt` is "app-owned and additive," but the implementation treats it as a stable compatibility key.

**Impact:** Silent performance degradation and context loss in Workflow, Refine, and eval scenario definition.

**Recommendation:**
- Verify that `user_message_suffix` is actually stable across turns for the same skill
- If it varies, either remove it from the match check or hash only stable portions
- Document which fields are expected to be stable in the design doc

---

### 2. No Unit Tests for Runtime Primitive Semantics

**Location:** `app/src-tauri/src/agents/openhands_server/mod.rs`

**Problem:** The new primitives (`prepare_openhands_session`, `start_openhands_session`, `openhands_send_message`, `run_throwaway_openhands_session`) have no direct unit tests. Tests exist at the product command layer (`refine/tests.rs`, `workflow/tests.rs`) but not at the primitive layer.

**What is untested:**
- `resolve_openhands_conversation_id` with `ResumeOrCreate` + matching saved conversation → resumes
- `ResumeOrCreate` + mismatching saved conversation → creates new
- `ResumeOrCreate` + missing saved conversation → creates new
- `SendExistingOnly` + missing conversation → errors
- `SendExistingOnly` + mismatching conversation → errors
- `send_user_message` serialization
- `create_prepared_conversation_for_request` clears prompt correctly

**Impact:** A bug in conversation selection logic breaks all product surfaces simultaneously. Product-level tests are too coarse to catch edge cases.

**Recommendation:** Add a `#[cfg(test)]` module in `openhands_server/mod.rs` covering the above scenarios. Mock `OpenHandsServerClient` or use a test double.

---

## Medium-Severity Items

### 3. String Errors Everywhere Prevent Programmatic Handling

**Location:** All public primitives in `app/src-tauri/src/agents/openhands_server/mod.rs`

**Problem:** Every public function returns `Result<T, String>`:

```rust
pub async fn prepare_openhands_session(...) -> Result<String, String>
pub async fn start_openhands_session(...) -> Result<String, String>
pub async fn openhands_send_message(...) -> Result<String, String>
```

**Impact:**
- Callers cannot distinguish retryable vs non-retryable errors
- Frontend receives opaque strings it cannot translate into user-friendly messages
- No error taxonomy for metrics/alerting

**Recommendation:** Introduce a structured `OpenHandsRuntimeError` enum:

```rust
#[derive(Debug)]
enum OpenHandsRuntimeError {
    ConversationNotFound { id: String },
    ConversationMismatch { id: String },
    Network(reqwest::Error),
    Timeout,
    Cancelled,
}
```

This is a pre-existing codebase pattern, but the clean-break refactor is the right moment to introduce it at the primitive layer.

---

### 4. Global Cancellation Registry Uses `std::sync::Mutex`

**Location:** `app/src-tauri/src/agents/openhands_server/mod.rs`

**Problem:**

```rust
type OpenHandsCancelRegistry =
    std::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>;
```

This is accessed from async contexts. A contended lock blocks the async executor thread.

**Impact:** Under high concurrency (multiple eval runs + refine + workflow), the cancel registry becomes a bottleneck.

**Recommendation:** Switch to `tokio::sync::Mutex` or `dashmap::DashMap`.

---

### 5. `RefineSession.has_dispatched_turn` Is Manual State That Can Drift

**Location:** `app/src-tauri/src/commands/refine/mod.rs`

**Problem:** `RefineSession` tracks `has_dispatched_turn: bool` to distinguish blank prepared sessions from active ones. If the app crashes between `start_refine_session` and first `send_refine_message`, the session restarts with the flag set to `false` even though the conversation may already have events.

**Impact:** First-turn prompt selection may be wrong after a crash recovery.

**Recommendation:** Derive this from conversation state instead:

```rust
fn is_blank_prepared_session(conversation: &serde_json::Value) -> bool {
    // Check if conversation has only system events, no user turns
}
```

---

### 6. `backfill_existing_events` Logic Is Subtle and Untested

**Location:** `app/src-tauri/src/agents/openhands_server/mod.rs`

**Problem:**

```rust
let backfill_existing_events = selection == OpenHandsConversationSelection::SendExistingOnly
    && request.prompt.trim().is_empty();
```

This condition determines whether to drain REST event history before reading the WebSocket. It is fragile — if someone removes the `prompt.trim().is_empty()` check, the chat replays entire history on every refine turn.

**Impact:** Potential for severe UX regression (chat replay) from a seemingly innocent change.

**Recommendation:** Extract into a named function with a descriptive unit test:

```rust
fn should_backfill_events(selection: OpenHandsConversationSelection, prompt: &str) -> bool {
    // Only backfill on first turn of a persistent session. Multi-turn
    // refine turns already saw prior events through the live WS.
    selection == OpenHandsConversationSelection::SendExistingOnly && prompt.trim().is_empty()
}
```

---

### 7. No Metrics or Telemetry on Primitive Usage

**Location:** All primitives

**Problem:** Beyond ad-hoc `log::info!` calls, there is no instrumentation to answer:
- How often do conversations get recreated vs resumed?
- What's the average throwaway run duration?
- How many concurrent sessions are active?

**Impact:** Operational debugging is hard. When users report "refine lost my conversation history," there is no data to distinguish mismatch recreation from a bug.

**Recommendation:** Add lightweight counters:
- `openhands_session_created` (with `reason: "new" | "mismatch" | "not_found"`)
- `openhands_session_resumed`
- `openhands_throwaway_run_duration_ms`

---

### 8. Spawned Tasks Have No `AbortHandle` Registry

**Location:** `app/src-tauri/src/agents/openhands_server/mod.rs`

**Problem:**

```rust
tokio::spawn(async move {
    let task = OpenHandsConversationTask { ... };
    let result = run_conversation_task(task, cancel_rx).await;
    // ...
});
// Handle is dropped — no way to await or abort on shutdown
```

**Impact:** On app shutdown, in-flight conversations may be orphaned. Tauri's shutdown hooks have no way to gracefully drain them.

**Recommendation:** Store `JoinHandle`s in a registry (similar to cancel registry) so the backend can `abort()` or `await` them during graceful shutdown.

---

## Low-Severity Items

### 9. `start_openhands_session` and `prepare_openhands_session` Are Redundant

**Location:** `app/src-tauri/src/agents/openhands_server/mod.rs`

**Problem:** `start_openhands_session` calls `prepare_openhands_session` then `dispatch_openhands_turn_with_request`. The two public functions have overlapping responsibilities. The design doc says `StartOpenHandsSession` is a single primitive.

**Recommendation:** Collapse into one primitive. If product commands need separation, they should call `resolve_openhands_conversation_id` directly.

---

### 10. `session_init_request` Wastes a Full Clone

**Location:** `app/src-tauri/src/agents/openhands_server/mod.rs`

**Problem:**

```rust
fn session_init_request(request: &OpenHandsOneShotRequest) -> OpenHandsOneShotRequest {
    let mut session_request = request.clone();
    session_request.prompt.clear();
    session_request
}
```

Clones the entire request (including potentially large prompt/suffix strings) just to clear one field.

**Recommendation:** Create `StartConversationRequest` directly without the intermediate clone, or make `from_one_shot` accept an optional prompt override.

---

### 11. `load_saved_skill_conversation_id` Couples to `AppHandle`

**Location:** `app/src-tauri/src/agents/openhands_server/mod.rs`

**Problem:** The helper takes `&tauri::AppHandle` just to extract `Db` state. This makes unit testing harder.

**Recommendation:** Take `&Db` directly. Callers already have access to it.

---

### 12. Old "One-Shot" Naming Persists in Throwaway Types

**Location:** `app/src-tauri/src/agents/openhands_server/mod.rs`

**Problem:**

```rust
pub struct OpenHandsOneShotRunParams { ... }
pub struct OpenHandsOneShotRun { ... }
```

The "one-shot" naming is from the old model and contradicts the new "throwaway session" terminology.

**Recommendation:** Rename to `OpenHandsThrowawayRunParams` and `OpenHandsThrowawayRun`. The clean-break plan says no compatibility shims.

---

## Summary Table

| # | Issue | Severity | Effort | Recommendation |
|---|-------|----------|--------|----------------|
| 1 | `user_message_suffix` in match check | **High** | Low | Verify stability or remove from match |
| 2 | No primitive-level unit tests | **High** | Medium | Add `#[cfg(test)]` module for `resolve_openhands_conversation_id` |
| 3 | String errors everywhere | Medium | Medium | Introduce `OpenHandsRuntimeError` enum |
| 4 | `std::sync::Mutex` in cancel registry | Medium | Low | Switch to `tokio::sync::Mutex` or `DashMap` |
| 5 | `has_dispatched_turn` manual flag | Medium | Low | Derive from conversation state |
| 6 | Untested `backfill_existing_events` | Medium | Low | Extract named function + unit test |
| 7 | No metrics/telemetry | Medium | Medium | Add session_created/resumed counters |
| 8 | No task abort handles | Medium | Medium | Store `JoinHandle`s in registry |
| 9 | `start_` / `prepare_` redundancy | Low | Low | Collapse into one primitive |
| 10 | `session_init_request` full clone | Low | Low | Avoid intermediate clone |
| 11 | `AppHandle` coupling in helpers | Low | Low | Take `&Db` directly |
| 12 | Old "one-shot" naming | Low | Low | Rename to "throwaway" |

---

## Pre-Merge Checklist (Minimum)

- [ ] **#1** Verified: `user_message_suffix` is stable across turns, OR removed from `conversation_matches_request`
- [ ] **#2** Added: At least 4 unit tests for `resolve_openhands_conversation_id` covering resume/create/mismatch/missing
- [ ] All existing tests still pass: `cargo test`, `npm run test:unit`, E2E `@workflow @refine @evals`

## Post-Merge Follow-Up (Recommended Within 2 Weeks)

- [ ] **#3** Structured error types for runtime primitives
- [ ] **#4** Async-safe cancel registry
- [ ] **#7** Runtime metrics/telemetry
- [ ] **#8** Task abort handle registry for graceful shutdown
- [ ] **#12** Rename `OneShot` types to `Throwaway`

---

## Verdict

**Approve with high-severity reservations.**

The architecture is correct and the implementation is functionally sound. Merge once #1 and #2 are addressed. The medium/low items can be tackled in follow-up PRs.
