# OpenHands Event Display Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` when implementing this plan. Steps use checkbox syntax for tracking.

**Goal:** Replace the current passthrough timeline with a semantic OpenHands event projection that matches the target-state design in `docs/design/openhands-event-display-projection/README.md`, using checked-in fixtures derived from real persisted conversations.

**Architecture:** Persisted `conversationEvents` + `conversationState` remain the canonical transcript source → a semantic projection layer classifies, suppresses, groups, and synthesizes display rows → the conversation timeline renders those semantic rows consistently in workflow and workspace.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, checked-in OpenHands conversation fixtures

## Gap Closure Map

This plan closes every gap in `docs/design/openhands-event-display-projection/implementation-gaps.md`:

- Gap 1: replace passthrough projection with a semantic classifier
- Gap 2: replace generic row rendering with target semantic rows and grouped containers
- Gap 3: implement explicit suppression and lifecycle-reduction rules for state updates
- Gap 4: separate `SystemPromptEvent` from the normal transcript
- Gap 5: add fixture-driven projection and accounting tests based on real saved conversations

---

### Task 1: Harvest real conversations into durable unit-test fixtures

**Files:**

- Create: `app/src/__tests__/fixtures/openhands-conversations/README.md`
- Create: `app/src/__tests__/fixtures/openhands-conversations/*.json`
- Create or update: `app/src/__tests__/fixtures/openhands-events/**`
- Create: `app/src/__tests__/lib/conversation-event-fixtures.test.ts`

- [ ] **Step 1: Audit the saved conversation corpus**

Use the real files under:

`/Users/hbanerjee/Library/Application Support/com.vibedata.skill-builder/openhands/conversations`

Select a small but representative fixture set that covers:

- `MessageEvent` from `user` and `assistant`
- `ActionEvent` and `ObservationEvent` for:
  - `terminal`
  - `file_editor`
  - `think`
  - `invoke_skill`
  - `task`
  - `finish`
- `ConversationStateUpdateEvent` for:
  - `stats`
  - `execution_status`
  - `last_user_message_id`
- `SystemPromptEvent`
- `PauseEvent`
- `ConversationErrorEvent`
- `AgentErrorEvent`

- [ ] **Step 2: Create checked-in fixture snapshots**

Copy or derive minimal checked-in fixtures from the saved conversations into `app/src/__tests__/fixtures/openhands-conversations/`.

Fixture set requirements:

- each fixture must be small enough for unit tests
- each fixture must preserve the real event structure
- each fixture must have a short note describing which semantic rows it is expected to produce
- fixture names must encode the behavior under test, not the original conversation id

Recommended fixture slices:

- `terminal-and-file-activity.json`
- `skill-and-subagent.json`
- `lifecycle-and-suppression.json`
- `system-prompt-and-errors.json`

- [ ] **Step 3: Document fixture provenance and invariants**

Add a small `README.md` in the fixture folder that states:

- fixtures were derived from real saved OpenHands conversations
- how they were reduced
- which event kinds must remain represented
- that fixture updates must preserve real upstream shape

- [ ] **Step 4: Add a fixture integrity test**

Create a dedicated test that verifies the checked-in fixtures still contain the intended raw event kinds and can be loaded by the projection tests without shape drift.

- [ ] **Step 5: Commit fixture baseline**

Verification:

```bash
cd app && npx vitest run src/__tests__/lib/conversation-event-fixtures.test.ts src/__tests__/lib/canonical-format.test.ts
```

Commit:

```bash
git add app/src/__tests__/fixtures/openhands-conversations app/src/__tests__/fixtures/openhands-events app/src/__tests__/lib/conversation-event-fixtures.test.ts
git commit -m "test: add openhands conversation projection fixtures"
```

---

### Task 2: Replace passthrough projection with a semantic classifier

**Files:**

- Modify: `app/src/lib/conversation-event-projection.ts`
- Modify: `app/src/lib/display-types.ts`
- Create: `app/src/lib/conversation-display-semantics.ts`
- Create or modify: `app/src/__tests__/lib/conversation-event-projection.test.ts`

- [ ] **Step 1: Define the semantic display node model**

Replace the current `DisplayNode.kind` passthrough contract with explicit semantic row types that reflect the target design. The projected model should distinguish at least:

- `task_sent`
- `agent_update`
- `skill`
- `subagent`
- `result`
- `terminal_activity`
- `file_activity`
- `reasoning`
- `runtime_setup`
- `lifecycle`
- `pause`
- `tool_error`
- `subagent_error`
- `unknown_event`

Each node must also encode the accounting needed by tests:

- source event ids
- grouped member event ids when the node represents a group
- suppressed event ids when the projection intentionally hides telemetry-only rows

- [ ] **Step 2: Move semantic classification out of the renderer**

Create a semantic helper module that:

- inspects raw event shape, not only `event.display.kind`
- classifies `MessageEvent`, `ActionEvent`, `ObservationEvent`, state updates, pauses, and errors
- groups related tool-call / observation pairs into semantic activity nodes
- preserves stable ordering
- produces explicit fallback `unknown_event` rows for shapes that are visible but not yet specialized

- [ ] **Step 3: Implement grouped activity synthesis**

Projection must synthesize grouped rows for:

- `Terminal activity`
- `File activity`
- `Reasoning`

Each grouped row must retain child summaries so the renderer does not need to re-interpret raw payloads.

- [ ] **Step 4: Implement first-class semantic rows**

Projection must synthesize first-class rows for:

- `Skill`
- `Subagent`
- `Result`
- `Task sent`
- `Agent update`
- `Paused`
- error rows

The classifier must use raw OpenHands event semantics so that rendering does not depend on generic `tool_call` or `tool_result` labels.

- [ ] **Step 5: Add projection unit coverage**

Update projection tests to assert:

- grouped rows for `terminal`, `file_editor`, and `think`
- visible `Skill`, `Subagent`, and `Result`
- fallback `unknown_event` behavior
- stable ordering and stable ids
- explicit event accounting for visible, grouped, and suppressed source events

- [ ] **Step 6: Commit semantic projection layer**

Verification:

```bash
cd app && npx vitest run src/__tests__/lib/conversation-event-projection.test.ts src/__tests__/lib/conversation-event-fixtures.test.ts
cd app && npx tsc --noEmit
```

Commit:

```bash
git add app/src/lib/conversation-event-projection.ts app/src/lib/display-types.ts app/src/lib/conversation-display-semantics.ts app/src/__tests__/lib/conversation-event-projection.test.ts
git commit -m "feat: add semantic openhands event projection"
```

---

### Task 3: Implement target semantic timeline rendering

**Files:**

- Modify: `app/src/components/conversation/conversation-event-row.tsx`
- Modify: `app/src/components/conversation/conversation-timeline.tsx`
- Create: `app/src/components/conversation/conversation-activity-group.tsx`
- Create: `app/src/components/conversation/conversation-semantic-row.tsx`
- Modify: `app/src/__tests__/components/conversation/conversation-event-row.test.tsx`
- Modify: `app/src/__tests__/components/conversation/conversation-timeline.test.tsx`

- [ ] **Step 1: Split generic row rendering into semantic row rendering**

Replace the current generic `kind`-driven rendering with target semantic presentation:

- right-aligned `Task sent`
- left-aligned `Agent update`
- first-class `Skill`
- first-class `Subagent`
- first-class `Result`
- explicit `Paused`
- destructive `Tool error`
- destructive `Subagent error`
- `Runtime setup` only in collapsed or debug-oriented presentation

- [ ] **Step 2: Add grouped activity containers**

Create grouped activity UI for:

- `Terminal activity`
- `File activity`
- `Reasoning`

Each group must show:

- a semantic title
- compact member summaries
- collapsed-by-default behavior where the design requires it
- expandable details without exposing raw event noise by default

- [ ] **Step 3: Render nested subagent and grouped-member context correctly**

The renderer must support:

- grouped member summaries from projection
- nested subagent member events when the projection includes them
- stable row identity for expanding, collapsing, and test selectors

- [ ] **Step 4: Preserve one canonical renderer across workflow and workspace**

Keep the timeline entrypoint shared. Do not fork workflow-specific and workspace-specific event renderers.

- [ ] **Step 5: Add UI tests for the semantic row set**

Update component tests to assert:

- `Task sent` and `Agent update`
- `Skill`, `Subagent`, and `Result`
- grouped `Terminal activity`, `File activity`, and `Reasoning`
- destructive error distinctions
- hidden telemetry rows not rendered in the main timeline

- [ ] **Step 6: Commit renderer changes**

Verification:

```bash
cd app && npx vitest run src/__tests__/components/conversation/conversation-event-row.test.tsx src/__tests__/components/conversation/conversation-timeline.test.tsx
cd app && npx tsc --noEmit
```

Commit:

```bash
git add app/src/components/conversation/conversation-event-row.tsx app/src/components/conversation/conversation-timeline.tsx app/src/components/conversation/conversation-activity-group.tsx app/src/components/conversation/conversation-semantic-row.tsx app/src/__tests__/components/conversation/conversation-event-row.test.tsx app/src/__tests__/components/conversation/conversation-timeline.test.tsx
git commit -m "feat: render semantic openhands timeline rows"
```

---

### Task 4: Implement suppression, lifecycle reduction, and system prompt rules

**Files:**

- Modify: `app/src/lib/conversation-event-projection.ts`
- Modify: `app/src/lib/conversation-display-semantics.ts`
- Modify: `app/src/__tests__/lib/conversation-event-projection.test.ts`
- Modify: `app/src/__tests__/components/conversation/conversation-timeline.test.tsx`

- [ ] **Step 1: Suppress telemetry-only state updates**

Implement explicit suppression for:

- `ConversationStateUpdateEvent.key === "stats"`
- `ConversationStateUpdateEvent.key === "last_user_message_id"`

Suppression must be deliberate and testable, not incidental.

- [ ] **Step 2: Reduce execution-status churn into meaningful lifecycle rows**

Projection must reduce `execution_status` noise to visible lifecycle markers for:

- `running`
- `paused`
- `finished`
- `error`

Repeated or non-meaningful churn should not produce transcript rows.

- [ ] **Step 3: Separate system prompt handling from the main transcript**

Implement one explicit target behavior:

- render `SystemPromptEvent` as collapsed `Runtime setup`

or

- keep it available through a dedicated debug disclosure while suppressing it from the normal transcript

Pick one consistent rule and encode it in tests. The implementation should not dump raw system prompt content into the default narrative flow.

- [ ] **Step 4: Add suppression and lifecycle coverage**

Tests must assert:

- `stats` is suppressed
- `last_user_message_id` is suppressed
- lifecycle rows are reduced to meaningful transitions only
- `SystemPromptEvent` follows the chosen target behavior

- [ ] **Step 5: Commit suppression and lifecycle behavior**

Verification:

```bash
cd app && npx vitest run src/__tests__/lib/conversation-event-projection.test.ts src/__tests__/components/conversation/conversation-timeline.test.tsx
cd app && npx tsc --noEmit
```

Commit:

```bash
git add app/src/lib/conversation-event-projection.ts app/src/lib/conversation-display-semantics.ts app/src/__tests__/lib/conversation-event-projection.test.ts app/src/__tests__/components/conversation/conversation-timeline.test.tsx
git commit -m "feat: suppress telemetry rows in openhands timeline"
```

---

### Task 5: Add end-to-end fixture-driven accounting tests

**Files:**

- Create: `app/src/__tests__/lib/conversation-event-projection-accounting.test.ts`
- Modify: `app/src/__tests__/lib/conversation-event-fixtures.test.ts`
- Modify: `app/src/__tests__/components/conversation/conversation-timeline.test.tsx`

- [ ] **Step 1: Build fixture-driven accounting assertions**

For each checked-in fixture, assert:

- visible standalone rows
- grouped member events
- nested subagent member events when present
- suppressed events
- the sum of visible, grouped, and suppressed source events matches the fixture slice

- [ ] **Step 2: Cover all required semantic cases**

Fixture coverage must explicitly include:

- `invoke_skill`
- `task`
- `finish`
- `stats`
- `execution_status`
- `SystemPromptEvent`
- `PauseEvent`
- `ConversationErrorEvent`
- `AgentErrorEvent`

- [ ] **Step 3: Add UI-level smoke assertions over the semantic projection**

Render the timeline from the harvested fixtures and assert the visible rows match the semantic target contract, not the raw passthrough display kinds.

- [ ] **Step 4: Commit fixture-driven regression coverage**

Verification:

```bash
cd app && npx vitest run src/__tests__/lib/conversation-event-fixtures.test.ts src/__tests__/lib/conversation-event-projection-accounting.test.ts src/__tests__/components/conversation/conversation-timeline.test.tsx src/__tests__/lib/canonical-format.test.ts
```

Commit:

```bash
git add app/src/__tests__/lib/conversation-event-fixtures.test.ts app/src/__tests__/lib/conversation-event-projection-accounting.test.ts app/src/__tests__/components/conversation/conversation-timeline.test.tsx
git commit -m "test: cover semantic openhands timeline accounting"
```

---

### Task 6: Close the design gap and verify the shared timeline end to end

**Files:**

- Modify: `docs/design/openhands-event-display-projection/implementation-gaps.md`
- Update if needed: `repo-map.json`

- [ ] **Step 1: Reconcile the implementation with the design doc**

After code lands, re-read:

- `docs/design/openhands-event-display-projection/README.md`
- `docs/design/openhands-event-display-projection/implementation-gaps.md`

Ensure the implementation matches the target-state design without adding a second renderer contract.

- [ ] **Step 2: Remove or reduce the gap doc**

If all gaps are closed in code and tests, delete `implementation-gaps.md`.

If any intentional gap remains, rewrite the file so it reflects only the true residual delta.

- [ ] **Step 3: Run the final validation set**

```bash
cd app && npx vitest run src/__tests__/lib/conversation-event-fixtures.test.ts src/__tests__/lib/conversation-event-projection.test.ts src/__tests__/lib/conversation-event-projection-accounting.test.ts src/__tests__/components/conversation/conversation-event-row.test.tsx src/__tests__/components/conversation/conversation-timeline.test.tsx src/__tests__/lib/canonical-format.test.ts
cd app && npm run test:unit
cd app && npx tsc --noEmit
```

- [ ] **Step 4: Run the repo metadata audit**

If any new files or structural moves were introduced under `app/src/lib/` or `app/src/components/`, update `repo-map.json` in the same implementation branch.

- [ ] **Step 5: Final commit**

```bash
git add docs/design/openhands-event-display-projection/implementation-gaps.md repo-map.json
git commit -m "docs: close openhands event display projection gaps"
```
