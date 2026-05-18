# OpenHands Event Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Skill Builder’s conversation pipeline to the OpenHands TypeScript client event contract so live websocket events and restored history render with the same transcript, drawer, status-bar, and toast semantics.

**Architecture:** Rust becomes the canonical normalization boundary. Raw OpenHands websocket payloads and `/api/v1/conversation/{conversationId}/events/search` history payloads are both converted into the TypeScript client `ConversationEvent` union before they cross into the frontend. The frontend then renders from explicit transcript-visible versus internal event families, using action-success and action-failure outcome handling instead of repo-local `eventClass` heuristics.

**Tech Stack:** Rust, Tauri, React, TypeScript, Zustand, Vitest, OpenHands REST history API, OpenHands websocket stream

---

## Scope

This plan implements the target state in:

- [docs/design/openhands-event-display-projection/README.md](../design/openhands-event-display-projection/README.md)
- [docs/design/openhands-event-display-projection/implementation-gaps.md](../design/openhands-event-display-projection/implementation-gaps.md)

This plan covers only the remaining work. The current semantic timeline UI, activity drawer, dark-mode treatment, and status footer already exist and are not being redesigned here.

## Current Baseline

Already in code:

- semantic transcript UI with `Task sent`, `Activity trace`, and `Agent update`
- right-side drawer for activity details
- status footer
- grouped file, terminal, reasoning, skill, and subagent trace items
- fixture-backed projection tests for the current wrapper-based model
- `Escape` already issues a pause request for running workflow conversations via `pause_openhands_session`

Still pending:

- Rust-side normalization to TypeScript client event kinds
- removal of the frontend’s dependency on `eventClass`, `conversation_state`, and generic `event` blobs
- transcript/internal family split by canonical event kind
- action success/failure outcome modeling:
  - `ActionEvent` + `ObservationEvent`
  - `ActionEvent` + `AgentErrorEvent`
- canonical `ThinkEvent` handling
- contract-based tests for restore/live parity
- pause acknowledgement semantics:
  - `PauseEvent` / `ConversationStateUpdateEvent(paused)` should drive the status bar
  - pause must not be converted into cancelled or shutdown step reset

---

### Task 1: Define canonical OpenHands event types at the app boundary

**Files:**

- Modify: `app/src/lib/conversation-event-types.ts`
- Modify: `app/src/lib/openhands-conversation-events.ts`
- Test: `app/src/__tests__/lib/openhands-conversation-events.test.ts`

- [ ] **Step 1: Introduce app-local TypeScript types that mirror the OpenHands client contract**

Define local event interfaces that track the OpenHands TypeScript client `ConversationEvent` union by `kind`.

Required kinds:

- `MessageEvent`
- `ActionEvent`
- `ObservationEvent`
- `AgentErrorEvent`
- `SystemPromptEvent`
- `PauseEvent`
- `CondensationRequest`
- `CondensationSummaryEvent`
- `Condensation`
- `ConversationStateUpdateEvent`
- `ConversationErrorEvent`
- `LLMCompletionLogEvent`
- `UserRejectObservation`
- `ConfirmationRequestEvent`
- `ConfirmationResponseEvent`
- `TokenEvent`
- `StuckDetectionEvent`
- `FinishEvent`
- `ThinkEvent`
- `HookExecutionEvent`

- [ ] **Step 2: Remove the frontend-facing dependency on `eventClass` wrappers**

Replace the current frontend-facing wrapper assumptions:

- `OpenHandsConversationEvent`
- `OpenHandsConversationState`
- `eventClass`
- `event: Record<string, unknown>`

The canonical frontend payload must instead carry typed event `kind`.

- [ ] **Step 3: Keep optional diagnostics payloads separate from the canonical contract**

Preserve raw payload access only as optional diagnostics metadata. Do not require Python-only or persistence-only fields for correctness.

- [ ] **Step 4: Lock the canonical type set with unit tests**

Add or update tests to assert that the normalization layer produces the expected `kind`-based contract and no longer depends on `eventClass` to decide event family.

**Verification:**

```bash
cd app && npx vitest run src/__tests__/lib/openhands-conversation-events.test.ts
cd app && npx tsc --noEmit
```

---

### Task 2: Move primary event normalization into Rust

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/events.rs`
- Modify: `app/src-tauri/src/commands/skill_session.rs`
- Modify: `app/src/lib/skill-openhands-session.ts`
- Modify: `app/src/hooks/use-session-runtime-stream.ts`
- Test: `app/src/__tests__/lib/skill-openhands-session.test.ts`
- Test: `app/src/__tests__/hooks/use-session-runtime-stream.test.ts`

- [ ] **Step 1: Normalize websocket events in Rust**

When OpenHands websocket payloads arrive, convert them in Rust into one canonical event shape matching the TypeScript client event contract before emitting them through Tauri.

- [ ] **Step 2: Normalize restore history in Rust**

When resume history is fetched from:

`GET /api/v1/conversation/{conversationId}/events/search`

convert those payloads in Rust into the same canonical event kinds used for websocket delivery.

- [ ] **Step 3: Ensure the frontend no longer interprets raw transport envelopes**

Update the frontend ingestion path so it consumes already-normalized typed events instead of branching on:

- `message.type === "conversation_event"`
- `message.type === "conversation_state"`
- `eventClass`

- [ ] **Step 4: Prove restore/live parity at the boundary**

Add tests asserting that equivalent websocket and `/events/search` payloads arrive at the frontend in the same canonical shape.

**Verification:**

```bash
cd app && npx vitest run src/__tests__/lib/skill-openhands-session.test.ts src/__tests__/hooks/use-session-runtime-stream.test.ts
cd app && npx tsc --noEmit
```

---

### Task 3: Split transcript-visible and internal event families

**Files:**

- Modify: `app/src/lib/conversation-display-semantics.ts`
- Modify: `app/src/lib/conversation-event-projection.ts`
- Modify: `app/src/components/conversation/conversation-timeline.tsx`
- Test: `app/src/__tests__/lib/conversation-event-projection.test.ts`
- Test: `app/src/__tests__/components/conversation/conversation-timeline.test.tsx`

- [ ] **Step 1: Make transcript-visible kinds explicit**

Only these kinds should produce transcript content:

- `MessageEvent`
- `ActionEvent`
- `ObservationEvent`
- `AgentErrorEvent`
- `SystemPromptEvent`
- `CondensationSummaryEvent`
- `ThinkEvent`

- [ ] **Step 2: Make internal hidden kinds explicit**

These kinds must be normalized in Rust into the canonical TypeScript event contract, emitted to the frontend, and handled explicitly by frontend control-state logic. They must not render as transcript rows:

- `PauseEvent`
- `CondensationRequest`
- `Condensation`
- `ConversationStateUpdateEvent`
- `LLMCompletionLogEvent`
- `TokenEvent`
- `StuckDetectionEvent`
- `FinishEvent`
- `HookExecutionEvent`

- [ ] **Step 3: Make confirmation/reject handling explicit**

These events must also be normalized in Rust and emitted to the frontend as canonical event kinds. The frontend should explicitly accept or ignore them as non-transcript events; they must never show up in the transcript:

- `UserRejectObservation`
- `ConfirmationRequestEvent`
- `ConfirmationResponseEvent`

- [ ] **Step 4: Keep fallback rows only for transcript-capable unknown kinds**

Do not show fallback transcript rows for known internal kinds.

**Verification:**

```bash
cd app && npx vitest run src/__tests__/lib/conversation-event-projection.test.ts src/__tests__/components/conversation/conversation-timeline.test.tsx
cd app && npx tsc --noEmit
```

---

### Task 4: Implement canonical action outcome handling

**Files:**

- Modify: `app/src/lib/conversation-display-semantics.ts`
- Modify: `app/src/components/conversation/conversation-activity-group.tsx`
- Modify: `app/src/components/conversation/conversation-event-row.tsx`
- Test: `app/src/__tests__/lib/conversation-event-projection.test.ts`
- Test: `app/src/__tests__/components/conversation/conversation-event-row.test.tsx`

- [ ] **Step 1: Model successful tool calls as `ActionEvent` + `ObservationEvent`**

Pair successful tool calls using:

- primary pair key:
  - `ObservationEvent.action_id == ActionEvent.id`
- consistency key:
  - `ObservationEvent.tool_call_id == ActionEvent.tool_call_id`

- [ ] **Step 2: Model failed tool calls as `ActionEvent` + `AgentErrorEvent`**

Correlate tool-call failures using:

- `AgentErrorEvent.tool_call_id == ActionEvent.tool_call_id`

`AgentErrorEvent` remains transcript-visible and must not toast.

- [ ] **Step 3: Group parallel tool calls by `llm_response_id`**

When multiple actions share one `llm_response_id`:

- render one transcript activity batch
- show the batch-level `thought` in the main conversation
- show individual tool-call entries in the drawer

If an action has no `llm_response_id`, treat it as a one-item batch.

- [ ] **Step 4: Use one standard drawer structure for tool outcomes**

For all tool-backed action outcomes, the drawer should use:

- `Thought` when present
- `Action`
- `Observation` for success
- `Error` for tool-call failure

Tool-specific logic is allowed only for extracting readable text from raw payloads.

- [ ] **Step 5: Remove remaining structural special-casing**

Retain tool-specific text extraction for:

- `file_editor`
- `terminal`
- `invoke_skill`
- `task`

but remove tool-specific structural rules that change how pairing and batching work.

**Verification:**

```bash
cd app && npx vitest run src/__tests__/lib/conversation-event-projection.test.ts src/__tests__/components/conversation/conversation-event-row.test.tsx src/__tests__/components/conversation/conversation-timeline.test.tsx
cd app && npx tsc --noEmit
```

---

### Task 5: Implement canonical `ThinkEvent`, status-bar, and toast handling

**Files:**

- Modify: `app/src/lib/conversation-display-semantics.ts`
- Modify: `app/src/components/conversation/conversation-timeline.tsx`
- Modify: `app/src/hooks/use-session-runtime-stream.ts`
- Test: `app/src/__tests__/lib/conversation-event-projection.test.ts`
- Test: `app/src/__tests__/components/conversation/conversation-timeline.test.tsx`
- Test: `app/src/__tests__/hooks/use-session-runtime-stream.test.ts`

- [ ] **Step 1: Implement `ThinkEvent` as the canonical reasoning path**

Render reasoning from:

- `ThinkEvent { kind: "ThinkEvent", thought: string }`

Do not require reasoning to arrive as a tool-backed action/observation pair.

- [ ] **Step 2: Drive the status bar from canonical internal events, including `PauseEvent`**

Keep the existing `Escape -> pause_openhands_session` request path. The remaining work here is to consume the returned canonical internal events consistently instead of relying on legacy wrapper-specific handling.

Status bar inputs should come from:

- `ConversationStateUpdateEvent`
- `PauseEvent`
- `FinishEvent`

`PauseEvent` and `ConversationStateUpdateEvent` should be handled together as status-bar inputs. A user-triggered pause should surface as `paused` from the canonical internal event stream.

Pause acknowledgement must remain resumable runtime state. Do not collapse it into terminal `cancelled` or `shutdown`, and do not reset the active workflow step to `pending` as a side effect of receiving pause-related events.

The status bar should cover:

- `running`
- `paused`
- `idle`
- `finished`
- `error`

- [ ] **Step 3: Move `ConversationErrorEvent` fully to runtime error handling**

`ConversationErrorEvent` should:

- show a persistent toast
- optionally update run-level error state
- never render as a transcript row

**Verification:**

```bash
cd app && npx vitest run src/__tests__/lib/conversation-event-projection.test.ts src/__tests__/components/conversation/conversation-timeline.test.tsx src/__tests__/hooks/use-session-runtime-stream.test.ts
cd app && npx tsc --noEmit
```

---

### Task 6: Replace wrapper-based tests with contract-based tests

**Files:**

- Modify: `app/src/__tests__/lib/openhands-conversation-events.test.ts`
- Modify: `app/src/__tests__/lib/conversation-event-projection.test.ts`
- Modify: `app/src/__tests__/components/conversation/conversation-timeline.test.tsx`
- Modify: `app/src/__tests__/fixtures/openhands-conversations/**`
- Create or modify additional fixtures as needed under `app/src/__tests__/fixtures/`

- [ ] **Step 1: Replace wrapper-model tests with `kind`-based fixtures**

Test fixtures should model canonical TypeScript client event kinds, not repo-local wrapper shapes.

- [ ] **Step 2: Add restore/live parity tests**

Prove that equivalent websocket and `/events/search` payloads normalize to the same canonical event kinds and produce the same transcript projection.

- [ ] **Step 3: Add action success/failure coverage**

Tests must cover:

- `ActionEvent` + `ObservationEvent`
- `ActionEvent` + `AgentErrorEvent`
- `AgentErrorEvent.tool_call_id` correlation
- `llm_response_id` batch grouping

- [ ] **Step 4: Add canonical family coverage**

Tests must cover:

- transcript-visible kinds render
- internal kinds do not render
- `ConversationErrorEvent` toasts
- `ThinkEvent` renders as reasoning

**Verification:**

```bash
cd app && npx vitest run src/__tests__/lib/openhands-conversation-events.test.ts src/__tests__/lib/conversation-event-projection.test.ts src/__tests__/components/conversation/conversation-timeline.test.tsx src/__tests__/hooks/use-session-runtime-stream.test.ts
cd app && npx tsc --noEmit
```

---

### Task 7: Close the docs loop

**Files:**

- Modify: `docs/design/openhands-event-display-projection/README.md`
- Modify: `docs/design/openhands-event-display-projection/implementation-gaps.md`
- Modify: `docs/design/README.md` only if index wording drifts

- [ ] **Step 1: Update the design doc only for implementation-driven drift**

Do not rewrite architecture casually. Only patch the design if implementation uncovers a real contract difference.

- [ ] **Step 2: Reduce or remove closed gaps**

As implementation lands, prune completed items from `implementation-gaps.md` instead of leaving stale completed gaps in place.

- [ ] **Step 3: Verify docs stay lint-clean**

**Verification:**

```bash
markdownlint docs/design/openhands-event-display-projection/README.md docs/design/openhands-event-display-projection/implementation-gaps.md docs/plans/2026-05-18-openhands-event-contract-implementation.md
```

---

## Risks and Watchpoints

- The current frontend still assumes wrapper-style payloads, so the Rust normalization change and the frontend consumption change must land together or behind an adapter.
- Restore payloads may carry richer raw data than websocket events. The canonical contract must stay correct even when those extra fields are absent.
- The current semantic UI has a lot of useful behavior already. Preserve user-facing grouping, drawer, and footer behavior while replacing the event contract underneath it.
- `ThinkEvent` may be uncommon in existing saved samples. Add synthetic contract fixtures if needed.

## Completion Criteria

This plan is complete when:

- Rust normalizes websocket and `/events/search` payloads into the OpenHands TypeScript client event union before they reach the frontend
- the frontend no longer depends on `eventClass`, `conversation_state`, or generic `event` blobs for primary rendering
- transcript-visible and internal event families are explicit in code
- successful tool calls render as `Action` + `Observation`
- failed tool calls render as `Action` + transcript-visible tool-call failure via `AgentErrorEvent`
- `AgentErrorEvent` correlates to the failed action by `tool_call_id`
- `ConversationErrorEvent` shows a persistent toast and does not render in the transcript
- `ThinkEvent` is the canonical reasoning path
- status bar is driven by `ConversationStateUpdateEvent` and `FinishEvent`
- restore and live paths produce the same transcript semantics
- tests lock the contract-based event model and replace the old wrapper-based assumptions
