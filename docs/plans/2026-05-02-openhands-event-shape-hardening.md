# OpenHands Event Shape Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Skill Builder's OpenHands event pipeline so workflow research can render and preserve real SDK event shapes, including nested message/tool payloads and parallel tool-call batches.

**Architecture:** Implement this as a child branch/worktree off `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`, then merge the tested child branch back into the VU-1145 accumulation branch. Keep the current clean-break protocol: Python emits app-framed `conversation_event` and `conversation_state`, Node forwards those records without Claude-style mapping, Rust forwards terminal state, and React renders OpenHands events directly.

**Tech Stack:** Python OpenHands runner, Node sidecar, Rust sidecar pool, React/TypeScript event rendering, Vitest, cargo tests, OpenHands SDK event fixtures.

---

## Branch And Merge Contract

- [x] Create the implementation worktree from the current VU-1145 branch:

```bash
cd /Users/hbanerjee/src/worktrees/feature/vu-1145-implement-openhands-native-clean-break-agent-runtime
./scripts/worktree.sh feature/vu-1147-openhands-event-shape-hardening
```

- [x] Implement and test only in the child worktree.
- [ ] Raise the PR with base `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`.
- [ ] Merge the tested child branch back into the VU-1145 accumulation branch.

## Scope

This slice prepares the OpenHands runtime for the workflow research step. It
does not migrate the research step itself.

**In scope**

- Preserve all OpenHands SDK callback events as raw payloads.
- Normalize and render nested SDK payloads from real `model_dump(...)` shapes.
- Handle parallel `ActionEvent` batches that share one `llm_response_id`.
- Add readable rendering for common internal/control events instead of showing
  only raw JSON.
- Add deterministic fixtures and tests for the event shapes the research step
  needs.

**Out of scope**

- Changing the terminal result contract.
- Reintroducing `display_item`, `run_result`, `openhands_event`, or
  `openhands_result` for OpenHands runtime events.
- Implementing workflow research execution through OpenHands.
- Tuning research prompt quality.

## Source Context

- OpenHands event docs: `https://docs.openhands.dev/sdk/arch/events`
- Runner design: `docs/design/openhands-sdk-runner/README.md`
- VU-1145 umbrella plan: `docs/plans/2026-05-02-openhands-native-migration.md`
- OpenHands event transport: `app/sidecar/openhands/runner.py`
- Node protocol forwarder: `app/sidecar/openhands-event-processor.ts`
- Rust forwarding/completion boundary: `app/src-tauri/src/agents/event_router.rs`
- Frontend normalization: `app/src/lib/openhands-conversation-events.ts`
- Frontend rendering: `app/src/components/agent-items/conversation-event-list.tsx`
- Event stream hook: `app/src/hooks/use-agent-stream.ts`
- Agent store: `app/src/stores/agent-store.ts`

## Current Gaps To Close

- `MessageEvent` text extraction reads shallow `message`, `content`, or `text`
  fields, but SDK events can carry nested `llm_message.content`.
- `ActionEvent` extraction reads shallow tool fields, but SDK payloads can carry
  nested `tool_call`, `tool_call_id`, `llm_response_id`, `reasoning_content`,
  and `thinking_blocks`.
- Parallel tool calls are preserved as separate raw events, but the UI does not
  group `ActionEvent`s that share one `llm_response_id`.
- `SystemPromptEvent`, `CondensationSummaryEvent`,
  `ConversationStateUpdateEvent`, `Condensation*`, and `PauseEvent` fallback to
  raw JSON instead of readable activity rows.
- Tests use simple synthetic payloads and do not prove behavior against
  realistic SDK `model_dump(...)` shapes.

## File Structure

- Create: `app/src/__tests__/fixtures/openhands-conversation-events.ts`
  - Realistic fixture records for OpenHands SDK event classes.
- Modify: `app/src/lib/openhands-conversation-events.ts`
  - Extraction helpers, event classification helpers, parallel batch grouping.
- Modify: `app/src/components/agent-items/conversation-event-list.tsx`
  - Render nested SDK message/tool/error/internal events and parallel action
    batches.
- Modify: `app/src/__tests__/components/agent-output-panel.test.tsx`
  - UI coverage for realistic event shapes and grouped parallel actions.
- Modify: `app/src/__tests__/hooks/use-agent-stream.test.ts`
  - Boundary coverage proving OpenHands event records are stored without
    display-item mapping.
- Modify: `app/sidecar/__tests__/openhands-runner.test.ts`
  - Runner serialization coverage for realistic SDK event classes.
- Modify: `app/sidecar/__tests__/openhands-event-processor.test.ts`
  - Transport-only coverage that raw OpenHands records are forwarded unchanged.
- Modify: `docs/design/openhands-sdk-runner/README.md`
  - Document event-shape handling and parallel `ActionEvent` grouping.
- Modify: `docs/plans/2026-05-02-openhands-event-shape-hardening.md`
  - Track completion while implementing.

## Task 1: Add Realistic Event Fixtures

- [x] Create `app/src/__tests__/fixtures/openhands-conversation-events.ts` with
  representative app-framed records:
  - `MessageEvent` with `event.llm_message.content[]`.
  - `ActionEvent` with `event.tool_call`, `event.tool_call_id`,
    `event.llm_response_id`, `event.reasoning_content`, and
    `event.thinking_blocks`.
  - Two parallel `ActionEvent`s sharing the same `llm_response_id`.
  - `ObservationEvent` linked by `tool_call_id`.
  - `AgentErrorEvent` and `ConversationErrorEvent`.
  - `SystemPromptEvent`.
  - `CondensationSummaryEvent`.
  - `ConversationStateUpdateEvent`.
  - `PauseEvent`.
- [x] Export fixtures as plain records shaped like messages received by
  `normalizeConversationEventMessage`.
- [x] Run:

```bash
cd app && npx vitest run src/__tests__/components/agent-output-panel.test.tsx
```

Expected: tests still pass before fixture usage.

## Task 2: Harden Event Extraction Helpers

- [x] Add tests in `app/src/__tests__/components/agent-output-panel.test.tsx`
  or a new focused lib test file for:
  - nested `llm_message.content` text extraction;
  - nested `tool_call.function.name` and
    `tool_call.function.arguments` extraction;
  - `tool_call_id` extraction;
  - `llm_response_id` extraction;
  - `reasoning_content` extraction;
  - `thinking_blocks` extraction, including blocks that use the SDK
    `thinking` field;
  - nested observation/error text extraction.
- [x] Update `app/src/lib/openhands-conversation-events.ts` with helper
  functions:
  - `getMessageText(event)`;
  - `getReasoningText(event)`;
  - `getToolName(event)`;
  - `getToolCallId(event)`;
  - `getLlmResponseId(event)`;
  - `getToolInput(event)`;
  - `getObservationText(event)`;
  - `getErrorText(event)`;
  - `getInternalEventSummary(event)`.
- [x] Keep `stringifyEventPayload` as the fallback for unknown shapes.
- [x] Preserve non-object SDK serialization fallbacks as raw payload records
  rather than dropping them during normalization.
- [x] Run:

```bash
cd app && npx vitest run src/__tests__/components/agent-output-panel.test.tsx src/__tests__/lib/agent-events-sync.test.ts
```

Expected: all tests pass, including new extraction assertions.

## Task 3: Render Common SDK Event Classes Readably

- [x] Add UI tests for readable rendering of:
  - `MessageEvent`;
  - `ActionEvent`;
  - `ObservationEvent`;
  - `AgentErrorEvent`;
  - `ConversationErrorEvent`;
  - `SystemPromptEvent`;
  - `CondensationSummaryEvent`;
  - other common `Condensation*` control events;
  - `ConversationStateUpdateEvent`;
  - `PauseEvent`;
  - unknown event fallback.
- [x] Update `ConversationEventList` so each known class has a compact,
  readable row.
- [x] Keep full raw payload access through fallback payload blocks when no
  readable field exists, including known event classes with unfamiliar
  payload shapes.
- [x] Run:

```bash
cd app && npx vitest run src/__tests__/components/agent-output-panel.test.tsx
```

Expected: event rendering tests pass.

## Task 4: Group Parallel Action Events

- [x] Add tests for two or more `ActionEvent`s with the same
  `llm_response_id`.
- [x] Implement grouping in `ConversationEventList` or a helper in
  `openhands-conversation-events.ts`:
  - consecutive `ActionEvent`s with the same non-empty `llm_response_id` render
    as one parallel action group;
  - the group shows reasoning/thinking once, from the first event that has it;
  - each tool call remains visible with its own tool name, input, and
    `tool_call_id`;
  - unrelated actions remain separate rows.
- [x] Do not mutate stored events; grouping is a render-time projection.
- [x] Run:

```bash
cd app && npx vitest run src/__tests__/components/agent-output-panel.test.tsx src/__tests__/hooks/use-agent-stream.test.ts
```

Expected: grouped action rendering passes and event stream storage remains
append-only.

## Task 5: Preserve Transport And Terminal Boundaries

- [x] Add sidecar tests proving `OpenHandsEventProcessor` still forwards
  `conversation_event` records unchanged, including unknown event classes and
  nested payloads.
- [x] Add runner tests proving `emit_conversation_event(...)` preserves
  `event_class`, nested payloads, `llm_response_id`, `tool_call_id`, and
  redacts secrets recursively.
- [x] Add a regression assertion that OpenHands stdout still contains only
  `conversation_event` and `conversation_state` records.
- [x] Run:

```bash
cd app/sidecar && npx vitest run __tests__/openhands-runner.test.ts __tests__/openhands-event-processor.test.ts __tests__/openhands-runtime.test.ts
```

Expected: all sidecar event tests pass.

## Task 6: Update Runner Design Documentation

- [x] Update `docs/design/openhands-sdk-runner/README.md` to document:
  - SDK callback events are preserved as raw payloads under
    `conversation_event.event`;
  - frontend extraction supports nested SDK `MessageEvent`, `ActionEvent`, and
    `ObservationEvent` payloads;
  - parallel `ActionEvent`s are grouped by `llm_response_id` only for display;
  - `conversation_state` remains the app terminal/result boundary;
  - stdout/stderr remain diagnostics and must not become frontend activity.
- [x] Run:

```bash
markdownlint docs/design/openhands-sdk-runner/README.md docs/plans/2026-05-02-openhands-event-shape-hardening.md
```

Expected: no markdownlint errors.

### Task 6 Implementation Notes

Current code evidence after implementation:

- `app/sidecar/openhands/runner.py` serializes SDK callback events with
  `emit_conversation_event(...)`, preserving the serialized SDK object under
  `event` and writing protocol records to stdout.
- `app/sidecar/openhands-event-processor.ts` forwards `conversation_event`
  records unchanged and treats unparseable or unknown stdout as diagnostics.
- `app/src/lib/openhands-conversation-events.ts` and
  `app/src/components/agent-items/conversation-event-list.tsx` extract nested
  SDK event payloads and group parallel `ActionEvent`s by `llm_response_id`
  only for display.

## Final Verification

- [x] Run:

```bash
cd app && npm run test:unit
cd app/sidecar && npx vitest run
cd app && npx tsc --noEmit
cd app && npm run test:agents:structural
cd app && npm run test:integration
python3 -m json.tool repo-map.json >/dev/null
markdownlint docs/design/openhands-sdk-runner/README.md docs/plans/2026-05-02-openhands-event-shape-hardening.md
```

- [ ] If implementation touches Rust event forwarding, also run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::
cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings
```

- [ ] Record any skipped live OpenHands smoke prerequisite in the PR body.
- [ ] Raise a PR back into
  `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`.
- [ ] Merge the tested child branch back into the VU-1145 accumulation branch.

## Acceptance-Criteria Coverage

| Requirement | Evidence |
|---|---|
| Real SDK payload shapes render useful text/tool activity | Frontend fixture tests using nested OpenHands event records. |
| Parallel tool calls are visible as grouped activity | UI test with shared `llm_response_id` action events. |
| Unknown SDK events are preserved | Sidecar processor test and fallback renderer test. |
| No legacy OpenHands event mapping returns | Sidecar tests assert no `display_item`, `run_result`, `openhands_event`, `openhands_result`, or `sdk_stderr` protocol records on OpenHands stdout. |
| Terminal result contract is unchanged | Existing one-shot `conversation_state` tests remain green. |
| Research migration can rely on visible activity | Fixture includes message/action/observation/error/internal events expected during research runs. |
