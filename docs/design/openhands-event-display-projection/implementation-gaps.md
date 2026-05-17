# OpenHands Conversation Timeline Implementation Gaps

This document tracks the delta between the target state in [README.md](./README.md) and the current implementation.

## Current Gaps

### 1. Projection is still a passthrough, not a semantic classifier

Current code:

- `app/src/lib/conversation-event-projection.ts`

The current projection layer copies `event.display.kind`, `label`, and `payload` into UI rows without semantic regrouping, suppression, or row synthesis.

Missing target behavior:

- grouped `Terminal activity`
- grouped `File activity`
- grouped `Reasoning`
- visible `Skill`, `Subagent`, and `Result` rows based on raw event semantics
- visible fallback rows for unknown event shapes
- explicit suppression accounting for telemetry-only events

### 2. Row rendering still depends on generic display kinds

Current code:

- `app/src/components/conversation/conversation-event-row.tsx`

The row component still renders generic kinds like `tool_call`, `tool_result`, `state`, and `system`. It does not yet render the target semantic row set described in the design doc.

Missing target behavior:

- narrative `Task sent` and `Agent update` rows
- first-class `Skill` rows
- first-class `Subagent` rows
- first-class `Result` rows
- grouped activity containers with member summaries
- destructive `Tool error` and `Subagent error` distinctions

### 3. State-update suppression rules are not implemented

Current code:

- `app/src/lib/conversation-event-projection.ts`
- `app/src/components/conversation/conversation-event-row.tsx`

The target model suppresses `stats` and `last_user_message_id` and reduces `execution_status` to meaningful lifecycle transitions. The current timeline still treats all incoming state-like events as generic visible rows if they reach the renderer.

Missing target behavior:

- suppress `ConversationStateUpdateEvent.key === "stats"`
- suppress `ConversationStateUpdateEvent.key === "last_user_message_id"`
- reduce `execution_status` churn to `running`, `paused`, `finished`, and `error`

### 4. System prompt handling is not separated from the main transcript

Target behavior allows `SystemPromptEvent` to appear only as a collapsed `Runtime setup` row or through a dedicated debug disclosure.

Missing target behavior:

- explicit `Runtime setup` presentation rule
- or explicit debug-only treatment that keeps the setup accessible without dumping it into the normal transcript

### 5. Grouping and suppression are not fixture-tested against persisted conversations

Current tests:

- `app/src/__tests__/components/conversation/conversation-timeline.test.tsx`

These tests cover basic rendering of canonical frontend events, but they do not verify the target semantic mapping against real persisted OpenHands conversation fixtures.

Missing target behavior:

- fixture-driven projection tests over saved conversation event folders
- accounting assertions:
  - visible standalone rows
  - grouped member events
  - nested subagent member events
  - suppressed events
- assertions for `invoke_skill`, `task`, `finish`, `stats`, `execution_status`, and error-event handling

## Exit Criteria

This gap document is complete when:

- the timeline projection classifies raw events into the semantic row set described in [README.md](./README.md)
- telemetry and bookkeeping suppression rules are implemented explicitly
- grouped activity rows and nested subagent behavior are visible in the UI
- persisted conversation fixtures prove semantic mapping and event accounting
