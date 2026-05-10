---
functional-specs: [custom-plugin-management]
---

# OpenHands Turn Dispatch Semantics

> **Status:** Draft
> **Functional specs:** Not applicable; this design defines the contract for
> `OpenHandsSendMessage` under the runtime model.

## Overview

Skill Builder exposes three public OpenHands runtime operations:

- `StartOpenHandsSession`
- `OpenHandsSendMessage`
- `PauseOpenHandsSession`

`OpenHandsSendMessage` is the single owner of turn dispatch semantics. A
dispatched turn produces the same observable event envelope regardless of
whether an event arrived live over WebSocket or was recovered immediately after
send. Transport details — stream attach, message dispatch, missed-event
recovery — are internal to `OpenHandsSendMessage` and are not visible to
callers.

## Design Scope

**Covers**

- The internal contract for one dispatched OpenHands turn.
- How `OpenHandsSendMessage` and `StartOpenHandsSession` guarantee visible
  transcript consistency.
- Event capture rules for runtime setup, dispatched task message, live tool
  activity, and terminal state.
- The boundary between public runtime primitives and private transport helpers.

**Does not cover**

- Product behavior for individual Workflow or Refine steps.
- Prompt wording or prompt ownership.
- Eval rubric design or Promptfoo behavior.
- Implementation sequencing.

## Key Decisions

| Decision | Rationale |
|---|---|
| Keep exactly three public runtime primitives. | The product model is correct: open/start, send, and pause are the real lifecycle operations. |
| Treat one dispatched turn as one runtime-owned envelope. | The caller should not care whether transcript rows came from live WebSocket delivery or immediate recovery after send. |
| Make `OpenHandsSendMessage` atomic at the runtime layer. | Send owns stream attach, message dispatch, missed-event recovery, run start, and terminal observation as one operation. |
| Recovery is turn-scoped, not history-scoped. | Recovery must be based on turn boundaries, not whether the prompt string is blank. |
| Keep transport helpers private and boring. | Callers should never need to reason about `send_user_message`, `run_conversation`, or `pause_conversation` separately. |

## Public API

The runtime surface is:

| Primitive | Public contract |
|---|---|
| `StartOpenHandsSession` | Prepare or resume a persistent conversation and return the durable conversation handle. |
| `OpenHandsSendMessage` | Dispatch exactly one new turn on an existing persistent conversation and stream a complete visible event envelope for that turn. |
| `PauseOpenHandsSession` | Pause the current live run identified by `agent_id`. |

### Private Transport Helpers

These are internal details:

- `send_user_message(...)`
- `run_conversation(...)`
- `pause_conversation(...)`
- WebSocket connect/auth steps
- event backfill / recovery

No product command or frontend surface should need to know these helpers exist.

## Turn Envelope

Every successfully dispatched turn yields the same observable structure:

1. runtime setup row, if this turn is responsible for surfacing one
2. dispatched task message row
3. live tool / output / subagent activity
4. terminal conversation state

In UI terms:

- Workflow and Refine both see the dispatched task row.
- The task row does not depend on whether the event arrived live or was
  recovered right after send.
- Resume history preserves the same ordering.

## Internal Flow

```text
resolve conversation
-> attach/auth WebSocket
-> record turn watermark
-> send user message
-> recover only events for this turn that were emitted before WS delivery
-> run conversation
-> stream remaining events
-> emit terminal state
```

Recovery is **turn-scoped**, not **history-scoped**.

## Turn-Scoped Recovery

The runtime recovers the dispatched user `MessageEvent` without replaying the
full prior conversation.

### Option A: Pre-send watermark plus delta backfill (preferred)

Before sending the message:

- record a watermark for the current conversation event sequence
- send the message
- fetch only events newer than the watermark and mark them as seen before
  entering steady-state streaming

This is the preferred shape because:

- it preserves the current send-first REST model
- it avoids replaying prior turns
- it makes recovery independent of prompt contents

### Option B: Attach stream before send and rely on live capture

Attach and authenticate the WebSocket before sending the user message, so the
user `MessageEvent` is normally observed live.

This can work, but the runtime should still preserve a small recovery path for
rare races or server buffering behavior.

### Rejected: Backfill all `SendExistingOnly` turns

Do not widen backfill rules to replay all prior events on every non-empty send.
That would duplicate previous transcript rows for Refine and Workflow follow-up
turns.

## State Model

### Conversation Identity

`conversation_id` is the durable OpenHands thread.

### Run Identity

`agent_id` is the current live run on top of that durable conversation.

### Send Semantics

One `OpenHandsSendMessage` call creates one new current run for an existing
conversation and owns the transcript-visible effects for that run.

## Surface Expectations

### Workflow

Workflow shows:

- runtime setup
- the dispatched task row
- tool activity and output

### Refine

Refine follows the same model:

- runtime setup
- the dispatched contextual task row
- tool activity and output

The difference between Workflow and Refine is prompt content, not runtime
visibility rules.

### Eval Workbench

If Eval Workbench ever surfaces the conversation transcript directly, it
inherits the same turn-envelope contract rather than defining its own special
send semantics.

## Failure and Pause Behavior

- `PauseOpenHandsSession(agent_id)` is the public pause primitive
- pause is cooperative according to OpenHands behavior
- the runtime owns the eventual terminal lifecycle cleanup
- a turn's visible task row is stable even if the run is later paused,
  completed, or errors

## Relationship to Existing Design Specs

| Spec | Relationship |
|---|---|
| [README.md](README.md) | Parent runtime model. This document defines `OpenHandsSendMessage` semantics under that model. |
| [../backend-design/agent-event-contracts.md](../backend-design/agent-event-contracts.md) | Event-channel reference. This document defines how those event contracts must be produced for one dispatched turn. |
| [../openhands-event-display-projection/README.md](../openhands-event-display-projection/README.md) | Projection-level rendering rules. This document defines the upstream runtime guarantees needed for projection consistency. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/agents/openhands_server/mod.rs` | Runtime orchestration, send path, WebSocket stream, and backfill logic. |
| `app/src-tauri/src/commands/skill_session.rs` | Refine turn dispatch — builds contextual task prompt and calls `OpenHandsSendMessage`. |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Workflow step dispatch — same runtime primitives, same visible task-row semantics. |
| `app/src/lib/openhands-event-projection.ts` | Projects user `MessageEvent` into the visible `task_sent` row. |
| `app/src/components/workspace/workspace-refine.tsx` | Refine transcript hydration and local chat composition. |
