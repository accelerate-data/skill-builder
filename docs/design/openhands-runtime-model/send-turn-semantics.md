---
functional-specs: []
---

# OpenHands Turn Dispatch Semantics

> **Status:** Draft
> **Functional specs:** Not applicable; this design refines the OpenHands
> runtime model shared by Workflow, Refine, and Eval Workbench.

## Overview

Skill Builder exposes three public OpenHands runtime operations:

- `StartOpenHandsSession`
- `OpenHandsSendMessage`
- `PauseOpenHandsSession`

Those public primitives are correct, but the current `OpenHandsSendMessage`
implementation leaks internal sequencing details into product behavior.
Specifically, the runtime sends the user task message before the WebSocket
stream is attached, then conditionally backfills only some missed early
events. That makes the visible transcript semantics differ by surface and by
turn timing.

This design makes `OpenHandsSendMessage` the single owner of turn dispatch
semantics. A dispatched turn must always produce the same observable event
envelope regardless of whether an event arrived live over WebSocket or was
recovered immediately after send.

## Design Scope

**Covers**

- The internal contract for one dispatched OpenHands turn.
- How `OpenHandsSendMessage` and `StartOpenHandsSession` should guarantee
  visible transcript consistency.
- Event capture rules for runtime setup, dispatched task message, live tool
  activity, and terminal state.
- The boundary between public runtime primitives and private transport
  helpers.

**Does not cover**

- Product behavior for individual Workflow or Refine steps.
- Prompt wording or prompt ownership.
- Eval rubric design or Promptfoo behavior.
- Implementation sequencing.

## Problem Statement

Today the runtime mixes three concerns inside one path:

1. transport setup
2. message dispatch
3. recovery of events emitted before the stream is ready

That creates a visible inconsistency:

- Workflow expects the initial dispatched task row to appear.
- Refine also expects the dispatched contextual task row to appear.
- The actual `task_sent` row comes from projecting a user `MessageEvent`.
- That user `MessageEvent` may be emitted before the WebSocket is attached.
- The current backfill rule is prompt-sensitive instead of turn-sensitive.

The result is that the same public primitive can appear to behave differently
depending on:

- whether the conversation is fresh or existing
- whether the prompt was empty or non-empty
- whether the early event arrived before stream attach

That is a runtime-layer design flaw, not a product-surface distinction.

## Key Decisions

| Decision | Rationale |
|---|---|
| Keep exactly three public runtime primitives. | The product model is already correct: open/start, send, and pause are the real lifecycle operations. |
| Treat one dispatched turn as one runtime-owned envelope. | The caller should not care whether transcript rows came from live WebSocket delivery or immediate recovery after send. |
| Make `OpenHandsSendMessage` atomic at the runtime layer. | Send must own stream attach, message dispatch, missed-event recovery, run start, and terminal observation as one operation. |
| Remove prompt-sensitive backfill logic. | Prompt content is the wrong proxy for event recovery. Recovery must be based on turn boundaries, not whether the prompt string is blank. |
| Keep transport helpers private and boring. | Callers should never need to reason about `send_user_message`, `run_conversation`, or `pause_conversation` separately. |

## Desired Runtime Contract

### Public API

The runtime surface remains:

| Primitive | Public contract |
|---|---|
| `StartOpenHandsSession` | Prepare or resume a persistent conversation and return the durable conversation handle. |
| `OpenHandsSendMessage` | Dispatch exactly one new turn on an existing persistent conversation and stream a complete visible event envelope for that turn. |
| `PauseOpenHandsSession` | Pause the current live run identified by `agent_id`. |

### Private Transport Helpers

These remain internal details:

- `send_user_message(...)`
- `run_conversation(...)`
- `pause_conversation(...)`
- WebSocket connect/auth steps
- event backfill / recovery

No product command or frontend surface should need to know these helpers
exist.

## Turn Envelope

Every successfully dispatched turn must yield the same observable structure:

1. runtime setup row, if this turn is responsible for surfacing one
2. dispatched task message row
3. live tool / output / subagent activity
4. terminal conversation state

In UI terms:

- Workflow and Refine should both see the dispatched task row.
- The task row must not depend on whether the event arrived live or was
  recovered right after send.
- Resume history should preserve the same ordering.

## Proposed Internal Flow

### Current Shape

```text
resolve conversation
-> send user message
-> attach/auth WebSocket
-> maybe backfill some earlier events
-> run conversation
-> stream events
```

This shape is vulnerable because the user `MessageEvent` may happen before the
stream is ready, and current recovery only handles some cases.

### Proposed Shape

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

The key point is that recovery is **turn-scoped**, not **history-scoped**.

## Turn-Scoped Recovery

The runtime must be able to recover the dispatched user `MessageEvent` without
replaying the full prior conversation.

Two acceptable strategies:

### Option A: Pre-send watermark plus delta backfill

Before sending the message:

- record a watermark for the current conversation event sequence
- then send the message
- then fetch only events newer than the watermark and mark them as seen before
  entering steady-state streaming

This is the preferred shape because:

- it preserves the current send-first REST model
- it avoids replaying prior turns
- it makes recovery independent of prompt contents

### Option B: Attach stream before send and rely on live capture

Attach and authenticate the WebSocket before sending the user message, so the
user `MessageEvent` is normally observed live.

This can work, but the runtime should still preserve a small recovery path for
rare races or server buffering behavior. A pure “live only” assumption is too
fragile for a product transcript contract.

### Rejected Option: Backfill all `SendExistingOnly` turns

Do not widen current backfill rules to replay all prior events on every
non-empty send. That would duplicate previous transcript rows for Refine and
Workflow follow-up turns.

## State Model

### Conversation Identity

- `conversation_id` is the durable OpenHands thread.

### Run Identity

- `agent_id` is the current live run on top of that durable conversation.

### Send Semantics

One `OpenHandsSendMessage` call creates one new current run for an existing
conversation and owns the transcript-visible effects for that run.

## Surface Expectations

### Workflow

Workflow should continue to show:

- runtime setup
- the dispatched task row
- tool activity and output

### Refine

Refine should follow the same model:

- runtime setup
- the dispatched contextual task row
- tool activity and output

The difference between Workflow and Refine should be prompt content, not
runtime visibility rules.

### Eval Workbench

If Eval Workbench ever surfaces the conversation transcript directly, it
should inherit the same turn-envelope contract rather than defining its own
special send semantics.

## Failure and Pause Behavior

This design does not change pause semantics:

- `PauseOpenHandsSession(agent_id)` remains the public pause primitive
- pause remains cooperative according to OpenHands behavior
- the runtime still owns the eventual terminal lifecycle cleanup

What this design does require is that a turn’s visible task row is stable even
if the run is later paused, completed, or errors.

## Relationship to Existing Design Specs

| Spec | Relationship |
|---|---|
| [README.md](README.md) | Parent runtime model. This document refines `OpenHandsSendMessage` semantics under that model. |
| [../backend-design/agent-event-contracts.md](../backend-design/agent-event-contracts.md) | Event-channel reference. This document defines how those event contracts must be produced for one dispatched turn. |
| [../openhands-event-display-projection/README.md](../openhands-event-display-projection/README.md) | Projection-level rendering rules. This document defines the upstream runtime guarantees needed for projection consistency. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/agents/openhands_server/mod.rs` | Runtime orchestration, send path, WebSocket stream, and backfill logic. |
| `app/src-tauri/src/commands/refine/mod.rs` | Refine turn dispatch builds the contextual task prompt and calls `OpenHandsSendMessage`. |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Workflow step dispatch uses the same runtime primitives and should keep the same visible task-row semantics. |
| `app/src/lib/openhands-event-projection.ts` | Projects user `MessageEvent` into the visible `task_sent` row. |
| `app/src/components/workspace/workspace-refine.tsx` | Refine transcript hydration and local chat composition. |

## Open Questions

1. `[runtime]` Should turn-scoped recovery use a server event watermark, event
   id comparison, or timestamp-based delta query?
2. `[runtime]` Is there an existing OpenHands server capability for querying
   events after a cursor that we can rely on directly instead of ad hoc local
   filtering?
3. `[testing]` What is the narrowest automated test that proves a non-empty
   `OpenHandsSendMessage` turn still surfaces its `task_sent` row without
   replaying prior history?
