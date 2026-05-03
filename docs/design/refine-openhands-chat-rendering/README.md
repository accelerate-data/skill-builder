---
functional-specs: []
---

# Refine Chat Rendering for OpenHands Events

> **Status:** Draft

## Overview

Once VU-1155 wired the Refine tab to the OpenHands Agent Server multi-turn conversation, every refine turn ran to completion on the backend but **nothing rendered in the chat panel**. The cause is a frontend rendering gap: the chat panel's `AgentTurnInline` was designed around the Claude Code `DisplayItem` shape (a transformed event format produced by the Node sidecar), and OpenHands events arrive on the wire as `conversation_event` payloads with an `event_class` discriminator that land in `run.conversationEvents`, not `run.displayItems`.

The first attempt at a fix replaced `DisplayItemList` with `ConversationEventList` in `agent-turn-inline.tsx`. That made events visible but produced a dense raw-event timeline — 30–45 cards per turn, with system prompts and intermediate state updates equally weighted with assistant messages. Unreadable as a chat.

This design replaces both approaches with a **projection layer in the agent-store** that converts raw OpenHands events into the existing `DisplayItem` shape, so the chat keeps using `BaseItem`, `ToolItem`, `SubagentItem`, `ThinkingItem`, `OutputItem`, and `ToolActivityGroupView` — the components that already define the chat UX on main. No new design system. No toggle. The native event stream stays available as an audit trail; the visible chat is the projection.

## Design Scope

**Covers**

- Agent-store projection: pair `ActionEvent` + `ObservationEvent` by `tool_call_id` and synthesize one `DisplayItem` per pair
- Filter rules for noise event classes (SystemPromptEvent, Condensation*, ConversationStateUpdateEvent, user MessageEvent)
- Result-summary detectors that produce a one-line outcome from `result_text` / `structured_output` for terminal `conversation_state`
- Lifecycle chip in the chat header bound to `runs[agentId].status` (replaces lifecycle-as-timeline-card)
- Revert of `agent-turn-inline.tsx` to read `run.displayItems` (the projection target)
- `run.conversationEvents` retained unchanged as the raw audit trail

**Does not cover**

- New rendering components — the existing component set on main is the visual surface
- Workflow surfaces — `agent-output-panel` continues to read `conversationEvents` directly via `ConversationEventList` for power-user runs
- Translation of historical Claude Code-shaped `displayItems` (no longer produced)

## Key Decisions

| Decision | Rationale |
|---|---|
| Project events into `DisplayItem` at the agent-store layer rather than at the renderer | Reuses the entire `BaseItem`/`ToolItem`/`SubagentItem` component tree and the `groupDisplayItems` activity-group logic on main without forking. Renderer stays runtime-agnostic. |
| Keep `conversationEvents` populated alongside `displayItems` | The raw native event stream is the audit trail and powers `agent-output-panel` for workflow debugging. The projection is a UI concern, not a data-model replacement. |
| Pair `ActionEvent` + `ObservationEvent` by `tool_call_id` into one `DisplayItem` | Matches the chat-conventional "single tool call card with observation inside" pattern and matches how Claude Code's sidecar already shaped `tool_call` items. |
| Filter SystemPromptEvent, Condensation*, ConversationStateUpdateEvent, and user MessageEvent | These are process noise. The Rust normalizer already promotes meaningful state transitions to terminal `conversation_state`. Hiding them is honest — chat is a different surface from a raw timeline. |
| Translate `InvokeSkillAction` to a `subagent` DisplayItem (not `tool_call`) | Semantic match: an AgentSkill activation loads a sub-context that drives subsequent actions, mirroring Claude Code's `Agent`/`Task` sub-agent invocations. The existing `SubagentItem` is the right shell. |
| Translate `ThinkAction` to a `thinking` DisplayItem | Matches the existing `ThinkingItem` shell (Brain icon, collapsed, low contrast). Reads as agent intent, not as a tool action. |
| Lifecycle chip on chat header, not a timeline card | `starting` / `running` / `completed` / `error` / `cancelled` is frame state, not content. A card per transition is noise. |
| Structured result detectors before markdown fallback | A workflow agent's final reply is JSON like `{"status":"research_complete","dimensions_selected":4,"question_count":10,...}`. A small detector tier turns that into "Research complete: 4 dimensions, 10 questions" in the chat header summary, with the full payload still available expanded. Generic markdown extraction is the fallback only. |

## Projection Contract

The agent-store owns the projection. Each incoming OpenHands event is processed by `addConversationEvent` which (a) appends to `run.conversationEvents` for the audit trail AND (b) drives a derived `DisplayItem` mutation on `run.displayItems`.

**No event is dropped.** Every `conversation_event` produces at least one `DisplayItem` mutation (an add or an update). The projection decides **visual weight** — high-signal events become prominent cards, low-signal events become collapsed low-contrast rows — but every native event is reachable in the rendered UI without leaving the chat surface. `conversationEvents` is preserved as the immutable raw audit trail; the projected `displayItems` is the rendered surface.

### Event → store behavior → display output

| Input event | Store behavior | Display output |
|---|---|---|
| `conversation_state` `status: starting` / `running` | Update `run.status` only | Lifecycle chip only |
| `conversation_state` `status: completed` | Update status; append a `result` DisplayItem | `OutputItem`-style summary, e.g. "Research complete: 4 dimensions, 10 questions" |
| `conversation_state` `status: error` / `cancelled` | Update status; append an `error` DisplayItem if `error_detail` is meaningful | "OpenHands failed: {reason}" or "Cancelled by user" |
| `SystemPromptEvent` | Append both; project as a `tool_call`-shaped DisplayItem with `toolName: "system_prompt"`, `toolStatus: "ok"`, raw prompt text in `toolResult.content` | Collapsed "Runtime setup" row, low visual weight; expand to see the full system prompt |
| `Condensation*Event` | Append both; project as a `tool_call`-shaped DisplayItem with `toolName: "condensation"` | Collapsed "Context condensed" row; expand to see the summary if present |
| `ConversationStateUpdateEvent` | Append both; project as a `tool_call`-shaped DisplayItem with `toolName: "state_update"` | Collapsed "Lifecycle update" row; expand to see the key/value transition. Terminal transitions still surface as the lifecycle chip via `conversation_state` |
| `MessageEvent` `source: user` | Append to `conversationEvents`; append a collapsed `tool_call`-shaped DisplayItem with `toolName: "task_sent"` | Collapsed "Task sent" row; expand to see the full prompt that was dispatched |
| `MessageEvent` `source: agent` (mid-run) | Append both | `output` DisplayItem with parsed-summary or markdown |
| `ActionEvent` (no observation yet) | Pending tool/subagent/thinking DisplayItem keyed on `tool_call_id` | Card in `pending` state with verb-target summary |
| `ObservationEvent` matching pending `ActionEvent` | Merge into the pending DisplayItem; set `toolStatus` from `is_error` / `exit_code`; populate `toolResult` | Card upgrades to `ok` or `error`; auto-expands if error |
| `ObservationEvent` `is_error: true` | Same as above but error styling | Auto-expanded, red border |
| Unmatched `ObservationEvent` (no pending action) | Append a standalone tool DisplayItem with the observation only | Tool result or error item |
| Multiple `ActionEvent`s sharing `llm_response_id` | Each becomes its own DisplayItem; `groupDisplayItems` already collapses adjacent tool items into a `ToolActivityGroupView` | "Tool Activity (N tools — M reads, K edits)" collapsed group |
| `AgentErrorEvent` / `ConversationErrorEvent` | Append `error` DisplayItem | `ErrorItem` |
| `PauseEvent` | No DisplayItem | Lifecycle chip flips to `cancelled` via the subsequent `conversation_state` |
| Unknown `event_class` | Append to `conversationEvents`; append a collapsed `tool_call`-shaped DisplayItem with `toolName: "unknown_event"` and the raw payload as `toolResult.content` | Collapsed "Unknown OpenHands event" row; preserves debuggability without polluting the main stream |

### Tool name → DisplayItem shape and label

| OpenHands `tool_name` (+ `action.command` if present) | DisplayItem `type` | `toolName` | `toolSummary` |
|---|---|---|---|
| `file_editor` cmd `view` | `tool_call` | `file_editor` | `Read file: {basename(path)}` |
| `file_editor` cmd `create` | `tool_call` | `file_editor` | `Create file: {basename(path)}` |
| `file_editor` cmd `str_replace` | `tool_call` | `file_editor` | `Edit file: {basename(path)}` |
| `file_editor` cmd `insert` | `tool_call` | `file_editor` | `Insert into {basename(path)}:{insert_line}` |
| `terminal` | `tool_call` | `terminal` | `Ran command: {first 60 chars of command}` (uses `event.summary` if provided) |
| `invoke_skill` | `subagent` | `invoke_skill` | `Using skill: {action.name}` (uses `event.summary` as `subagentDescription`) |
| `think` | `thinking` | `think` | Stable label `Reasoning step` (or `Planning checkpoint` if the thought begins with planning markers like "##" / "Plan" / "Step"). Full thought text lives in `thinkingText` for the expanded body. |
| `FinishTool` | not projected | – | Loop terminator only; surface as `completed` lifecycle |
| Other | `tool_call` | `{tool_name}` | `event.summary` if present, else first line of args |

The expanded body for each `tool_call` DisplayItem populates `toolInput` (from `action` / `tool_call.arguments`) and `toolResult.content` (from `observation.content[].text`) so the existing `ReadViewer`, `EditViewer`, `BashViewer`, and `DefaultViewer` render unchanged.

### Result summary detector tiers

When `conversation_state.status === "completed"` arrives, the projection synthesizes a `result` DisplayItem. The summary string is derived in this order:

| Tier | Trigger shape | Summary |
|---|---|---|
| 1 | JSON with `status: "research_complete"`, `dimensions_selected`, `question_count` | "Research complete: {N} dimensions, {M} questions" |
| 2 | JSON with `verdict`, `answered_count`, `total_count` (answer-evaluator) | "Answers {verdict}: {answered}/{total}" |
| 3 | JSON with `status: "skill_generated"` or generation success markers | "Skill generated" / "Skill updated" |
| 4 | Plain markdown / text in `result_text` | First non-empty line, capped at 80 chars |
| 5 | No `result_text`, no `structured_output` | "Run completed" |

Detectors live in a small standalone helper module so they're trivially extensible per task_kind.

### Lifecycle chip

A small status pill on the chat panel header bound to `runs[agentId]?.status`:

| Status | Label | Color |
|---|---|---|
| `starting` | "Starting" | muted |
| `running` | "Running" | pacific (pulsing dot) |
| `completed` | "Completed" | seafoam |
| `error` | "Error" | destructive |
| `cancelled` | "Cancelled" | muted |

This replaces the per-status timeline card; lifecycle is frame state, not content.

## Architecture

### Files touched

| File | Responsibility |
|---|---|
| `app/src/lib/openhands-event-projection.ts` (new) | Pure function `projectConversationEvent(event, pendingActionsByToolCallId) → { add, update }` returning DisplayItem mutations. Unit tested in isolation. |
| `app/src/lib/openhands-result-summary.ts` (new) | Detector tiers for terminal results. Pure functions, unit tested. |
| `app/src/stores/agent-store.ts` | `addConversationEvent` invokes the projector and applies returned DisplayItem mutations alongside the existing append to `conversationEvents`. `applyConversationState` (terminal) appends a `result` or `error` DisplayItem via the result-summary detector. Both also keep `pendingActionsByToolCallId` per agent_id to handle pairing. |
| `app/src/components/refine/agent-turn-inline.tsx` | Reverts to reading `run.displayItems` and rendering via `DisplayItemList`. Same component set the Claude Code path used. |
| `app/src/components/agent-output-panel.tsx` | Switches to read `displayItems` and render via `DisplayItemList` exclusively. The dual conversationEvents/displayItems branch is removed. Workflow gets the same beautified rendering as refine. |
| `app/src/components/agent-status-header.tsx` | Count uses `displayItems.length` only (single source). |
| Refine chat header (e.g. `components/refine/chat-panel.tsx` or the workspace shell) | Adds a lifecycle chip bound to `runs[agentId]?.status`. Workflow surfaces already have status indicators via the step UI. |
| `app/src/components/agent-items/*` (no changes) | All existing item shells, viewers, and the activity grouping work unchanged. |
| `app/src/components/agent-items/conversation-event-list.tsx` | Retained as a rendering primitive for future dev-tools / debug surfaces; no production consumer. |

### Why the projector is at the store layer

- The renderer stays runtime-agnostic (`DisplayItemList` doesn't need to know about OpenHands).
- The activity-group logic in `groupDisplayItems` Just Works on the projected items — sequential tool calls collapse into a `ToolActivityGroupView` as they always did.
- The pairing state (`pendingActionsByToolCallId`) lives next to the run state it belongs to, with no prop drilling or render-time mutation.
- Unit-testable as a pure function over the event sequence.

### Common, not per-page — and uniform UX across all surfaces

The projection is **store-level common infrastructure**, not surface-specific. It runs for every OpenHands run regardless of `run_source` (refine, workflow, scope review, etc.). The output of an OpenHands run lands on the `Run` object as **both** raw events and projected items.

**All UI surfaces consume `displayItems` uniformly.** The chat-shaped projected items are the production rendering path. `conversationEvents` is preserved as a pure audit trail — no production component reads it post-migration.

| Surface | Field consumed | Renderer | Effect of projection |
|---|---|---|---|
| `components/refine/agent-turn-inline.tsx` (refine chat) | `displayItems` | `DisplayItemList` | Begins rendering correctly — the surface the projection was designed for |
| `components/agent-output-panel.tsx` (workflow output) | `displayItems` | `DisplayItemList` | **Switches from dense raw timeline to the beautified projected view** — same Action+Observation pairing, error styling, parallel-action grouping, and lifecycle chip as refine |
| `components/feedback-dialog.tsx` (feedback capture) | `displayItems` (looking for `result` / `output`) | helper extraction | **Starts working** for OpenHands runs (the projected `result` item populates feedback content) |
| `components/workspace/workspace-refine.tsx::extractStructuredResultPayload` | `displayItems` (looking for structured output) | helper extraction | **Starts working** — `finalizeRefineRun` reads structured output from the projected `result` item |
| `components/agent-status-header.tsx` (count badge) | `displayItems.length` | – | Single-source count |
| `pages/workflow.tsx` (page indicator) | `displayItems.length` | – | Unchanged |

`ConversationEventList` becomes unused by production UI. It stays in the codebase as the rendering primitive for any future deep-debug / dev-tools surface that wants to see raw native events. There is no toggle; the beautified view is the only production path.

There is no per-page or per-`run_source` gating. A single projection rule applies to every OpenHands run, and a single `DisplayItemList` rendering path applies to every UI surface that displays a run.

### Pairing semantics

Pending actions are keyed by `tool_call_id` per `agent_id`. When `ObservationEvent` arrives:

1. Look up the pending DisplayItem.
2. If found: mutate in place — set `toolResult.content`, `toolStatus = is_error || exit_code != 0 ? "error" : "ok"`, `toolDurationMs = obs.timestamp - action.timestamp`. Remove from pending map.
3. If not found: append a standalone tool DisplayItem with observation-only content.

Mutating in place preserves React keys and any user-controlled expand state.

## Relationship to Existing Design Specs

| Spec | Relationship |
|---|---|
| `docs/design/refine-openhands-migration/README.md` | Parent migration. Wired the multi-turn conversation. This spec resolves the rendering gap that surfaced after the wire-up. |
| `docs/design/openhands-agent-server-runtime/README.md` | Defines the event shapes (`conversation_event`, `event_class`) this projection consumes. |
| Sidecar `app/sidecar/display-types.ts` | Canonical definition of `DisplayItem`. The projection produces values matching this shape verbatim. The frontend mirror at `app/src/lib/display-types.ts` stays in sync. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src/lib/openhands-event-projection.ts` (new) | Event-to-DisplayItem projector |
| `app/src/lib/openhands-result-summary.ts` (new) | Terminal result-summary detectors |
| `app/src/stores/agent-store.ts` | Drives the projection from `addConversationEvent` and `applyConversationState` |
| `app/src/lib/openhands-conversation-events.ts` | Existing extraction helpers (`getMessageText`, `getToolName`, `getToolInput`, `getCommandText`, etc.) — reused by the projector |
| `app/src/lib/group-display-items.ts` | Existing activity-group logic — works unchanged on projected items |
| `app/src/components/refine/agent-turn-inline.tsx` | Reverts to `DisplayItemList` |
| `app/src/components/refine/chat-panel.tsx` | Adds lifecycle chip |

## Open Questions

1. `[design]` Should the projection include a hidden `system` row for SystemPromptEvent (collapsed, never expanded by default) so power users can audit prompt setup without opening dev tools? Defer — current proposal hides them entirely; revisit when a user actually needs prompt-debug visibility in the UI.
2. `[design]` Should `MessageEvent` from the agent during the run (not the final terminal one) render as a standalone `output` DisplayItem, or be deferred to the terminal `conversation_state` summary path? The agent rarely emits mid-run MessageEvents in practice, but if it does they should appear immediately. Initial implementation: project mid-run agent MessageEvents as `output` items; the terminal summary takes over only when there is no agent MessageEvent at end of run.
