---
functional-specs: []
---

# OpenHands Event Display Projection

> **Status:** Implemented — projection, result detectors, store integration, and consumer migration complete.
> **Runtime prerequisite:** See [../openhands-runtime-contract/README.md](../openhands-runtime-contract/README.md) for session lifecycle, storage roots, normalized event ingress, and backend runtime ownership.

## Overview

This doc starts after the backend runtime contract has already done its work.
Its input is the **normalized runtime event stream** exposed to the frontend
agent store. Its output is the projected `DisplayItem` stream consumed by chat-
style and workflow-style UI surfaces.

This design defines a **product-wide frontend projection rule**: the
agent-store converts every normalized OpenHands runtime event into zero or more
`DisplayItem` mutations on `run.displayItems`, while preserving the raw event
stream on `run.conversationEvents` as an immutable frontend audit trail. All
UI surfaces consume `displayItems` uniformly via the existing `BaseItem` /
`ToolItem` / `SubagentItem` / `ThinkingItem` / `OutputItem` /
`ToolActivityGroupView` component set. There is no new design system, no
toggle, and no per-page rendering fork.

The decision was surfaced by the VU-1155 Refine migration but applies to **every UI surface that displays an OpenHands run** — Refine chat, Workflow output, feedback dialog, scope review chat, description optimization, and any future surface.

## Design Scope

**Covers**

- A single store-level projection that runs for every normalized runtime event stream regardless of `run_source`
- The projection contract from normalized runtime events to frontend `DisplayItem` mutations
- Pairing of `ActionEvent` + `ObservationEvent` by `tool_call_id` into a single `DisplayItem`
- Mapping rules per OpenHands `event_class` and `tool_name` (file_editor / terminal / invoke_skill / think / etc.)
- Result-summary detectors that produce a one-line outcome from `result_text` / `structured_output` for terminal `conversation_state`
- Lifecycle chip bound to `runs[agentId].status` on chat-style surfaces (replaces lifecycle-as-timeline-card)
- Migration of all production UI consumers to read `displayItems` exclusively (Refine `agent-turn-inline`, Workflow `agent-output-panel`, feedback dialog, status header)
- Retention of `run.conversationEvents` as an immutable raw audit trail with no production consumer post-migration

**Does not cover**

- Runtime session lifecycle, storage roots, or persistent-versus-throwaway behavior
- Backend event normalization or raw Agent Server wire-format details
- Typed workflow artifact persistence or terminal result extraction rules below the frontend boundary
- New rendering components — the existing component set is the visual surface for every UI consumer
- A toggle between "beautified" and "raw" rendering — the projected view is the only production path
- Translation of historical Claude Code-shaped `displayItems`
- A new dev-tools / debug surface that reads `conversationEvents` directly (out of scope; `ConversationEventList` is retained as the rendering primitive for that future surface)

## Key Decisions

| Decision | Rationale |
|---|---|
| Project events into `DisplayItem` at the agent-store layer rather than at the renderer | Reuses the entire `BaseItem`/`ToolItem`/`SubagentItem` component tree and the `groupDisplayItems` activity-group logic on main without forking. Renderer stays runtime-agnostic. |
| Keep `conversationEvents` populated alongside `displayItems` | The raw normalized event stream remains the frontend audit trail. The projection is a UI concern, not a data-model replacement. |
| Pair `ActionEvent` + `ObservationEvent` by `tool_call_id` into one `DisplayItem` | Matches the chat-conventional "single tool call card with observation inside" pattern and matches how the legacy Claude Code runtime already shaped `tool_call` items. |
| Hide `ConversationStateUpdateEvent` from chat; keep it in `conversationEvents` audit trail | Pure internal counter/state churn (token deltas, `execution_status` flips, `agent_state`). The lifecycle chip in the chat header already represents the user-facing transitions semantically; rendering each intermediate diff as a "Lifecycle update" row was noise. The Rust normalizer also promotes meaningful terminal state transitions to `conversation_state` — there is no information loss. |
| Keep `SystemPromptEvent`, `Condensation*Event`, `PauseEvent`, and user `MessageEvent` visible as collapsed rows | Each carries genuine user-facing meaning that `ConversationStateUpdateEvent` does not — system prompt is a one-time setup the user can audit, condensations explain why context shifted mid-turn, pause is a real user action with intent, and the user MessageEvent shows the exact text dispatched (including any system suffix). All collapsed by default, low visual weight. |
| Translate `InvokeSkillAction` to a `subagent` DisplayItem (not `tool_call`) | Semantic match: an AgentSkill activation loads a sub-context that drives subsequent actions, mirroring Claude Code's `Agent`/`Task` sub-agent invocations. The existing `SubagentItem` is the right shell. |
| Translate `ThinkAction` to a `thinking` DisplayItem | Matches the existing `ThinkingItem` shell (Brain icon, collapsed, low contrast). Reads as agent intent, not as a tool action. |
| Lifecycle chip on chat header, not a timeline card | `starting` / `running` / `completed` / `error` / `cancelled` is frame state, not content. A card per transition is noise. |
| Structured result detectors before markdown fallback | A workflow agent's final reply is JSON like `{"status":"research_complete","dimensions_selected":4,"question_count":10,...}`. A small detector tier turns that into "Research complete: 4 dimensions, 10 questions" in the chat header summary, with the full payload still available expanded. Generic markdown extraction is the fallback only. |

## Projection Contract

The agent-store owns the projection. Each incoming OpenHands event is processed by `addConversationEvent` which (a) appends to `run.conversationEvents` for the audit trail AND (b) drives a derived `DisplayItem` mutation on `run.displayItems`.

The projection assumes the backend/runtime boundary has already normalized the
incoming event shapes. This doc does not redefine wire-format cleanup.

**No event is dropped from the frontend audit trail.** Every normalized
`conversation_event` is appended to `run.conversationEvents`. The projection
layer then decides what the chat shows.

**Editorial rule for the chat surface:** every **user-facing** event becomes at least one `DisplayItem`; **pure internal-state events** (`ConversationStateUpdateEvent`) are suppressed. The projection decides **visual weight** for the rest — high-signal events (the agent's reply, errors, tool actions) become prominent cards; low-signal-but-meaningful events (system prompt, condensation, pause, user prompt echo) become collapsed low-contrast rows. Internal counter/state churn does not appear in the chat at all because the lifecycle chip already represents the user-facing transitions and the JSON diffs are not content.

`conversationEvents` is preserved as the immutable raw audit trail with **all** events including the suppressed `ConversationStateUpdateEvent`s; the projected `displayItems` is the editorial chat view.

### Event → store behavior → display output

| Input event | Store behavior | Display output |
|---|---|---|
| `conversation_state` `status: starting` / `running` | Update `run.status` only | Lifecycle chip only |
| `conversation_state` `status: completed` | Update status; append a `result` DisplayItem | `OutputItem`-style summary, e.g. "Research complete: 4 dimensions, 10 questions" |
| `conversation_state` `status: error` / `cancelled` | Update status; append an `error` DisplayItem if `error_detail` is meaningful | "OpenHands failed: {reason}" or "Cancelled by user" |
| `SystemPromptEvent` | Append both; project as a `tool_call`-shaped DisplayItem with `toolName: "system_prompt"`, `toolStatus: "ok"`, raw prompt text in `toolResult.content` | Collapsed "Runtime setup" row, low visual weight; expand to see the full system prompt |
| `Condensation*Event` | Append both; project as a `tool_call`-shaped DisplayItem with `toolName: "condensation"` | Collapsed "Context condensed" row; expand to see the summary if present |
| `ConversationStateUpdateEvent` | Append to `conversationEvents` only; **no DisplayItem** | **Hidden from chat.** Lifecycle chip in the chat header carries the user-facing transitions; intermediate token/state diffs are not content. Audit trail in `conversationEvents` is intact for any future dev-tools surface. |
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
| `app/src/lib/openhands-event-projection.ts` | Pure function `projectConversationEvent(event, pendingActionsByToolCallId) → { add, update }` returning DisplayItem mutations. Unit tested in isolation. |
| `app/src/lib/openhands-result-summary.ts` | Detector tiers for terminal results. Pure functions, unit tested. |
| `app/src/stores/agent-store.ts` | `addConversationEvent` invokes the projector and applies returned DisplayItem mutations alongside the existing append to `conversationEvents`. `applyConversationState` (terminal) appends a `result` or `error` DisplayItem via the result-summary detector. Both also keep `pendingActionsByToolCallId` per agent_id to handle pairing. |
| `app/src/components/refine/agent-turn-inline.tsx` | Reads `run.displayItems` and renders via `DisplayItemList`. |
| `app/src/components/agent-output-panel.tsx` | Reads `displayItems` and renders via `DisplayItemList` exclusively. |
| `app/src/components/agent-status-header.tsx` | Count uses `displayItems.length` only (single source). |
| `app/src/components/run-status-footer.tsx` + `agent-run-footer.tsx` | Common status footer pinned to the bottom of every agent-interactive surface (Refine, Evals, Workflow). Shows status dot, model, elapsed time, turns, tokens, and cost. Superseded the standalone `LifecycleChip` design. |
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
| `docs/design/openhands-runtime-contract/README.md` | Defines the runtime/session/storage contract and the normalized event/result boundary this projection consumes. |
| `app/src/lib/display-types.ts` | Canonical frontend definition of `DisplayItem`. The projection produces values matching this shape verbatim. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src/lib/openhands-event-projection.ts` | Event-to-DisplayItem projector |
| `app/src/lib/openhands-result-summary.ts` | Terminal result-summary detectors |
| `app/src/stores/agent-store.ts` | Drives the projection from `addConversationEvent` and `applyConversationState` |
| `app/src/lib/openhands-conversation-events.ts` | Frontend helpers over normalized runtime events (`getMessageText`, `getToolName`, `getToolInput`, `getCommandText`, etc.) |
| `app/src/lib/group-display-items.ts` | Activity-group logic — works unchanged on projected items |
| `app/src/components/refine/agent-turn-inline.tsx` | Reads `displayItems` via `DisplayItemList` |
| `app/src/components/run-status-footer.tsx` | Common status footer — status, model, elapsed time, turns, tokens, cost. Present on all agent-interactive surfaces. |

## Known limitations / follow-ups

| Issue | Symptom | Status |
|---|---|---|
| `LifecycleChip` implemented but not mounted | `app/src/components/refine/lifecycle-chip.tsx` exports `LifecycleChip` (wired to `runs[agentId]?.status`) and is unit tested, but no production parent component imports or renders it. The chat panel header shows no status pill during a run. | **Open** — wire `<LifecycleChip />` into the refine chat panel header (e.g., `workspace-refine.tsx` or the header bar above `ChatMessageList`). |

## Open Questions

1. `[design]` Should `MessageEvent` from the agent during the run (not the final terminal one) render as a standalone `output` DisplayItem, or be deferred to the terminal `conversation_state` summary path? The agent rarely emits mid-run MessageEvents in practice, but if it does they should appear immediately. Initial implementation: project mid-run agent MessageEvents as `output` items; the terminal summary takes over only when there is no agent MessageEvent at end of run.
