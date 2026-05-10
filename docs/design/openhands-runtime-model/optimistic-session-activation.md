---
functional-specs: [custom-plugin-management]
---

# Optimistic Session Activation

> **Parent design:** [openhands-runtime-model/README.md](README.md)

## Overview

Skill activation splits into a synchronous navigation phase and an asynchronous
session-boot phase. The UI responds immediately to a skill click instead of
blocking on Agent Server startup.

The sync phase (navigate) must complete before anything else. The async
phase (server ensure + conversation resolve + history hydration) runs in the
background while the target page shows its loading skeleton.

## Design Scope

**Covers**

- The sync/async split of `activateSkill` and its interaction with the
  three-layer runtime contract.
- Page loading states that wait for `conversationId` hydration.
- Failure handling and lock cleanup when background boot fails.
- Race conditions: double-click, navigate-away, concurrent skill switches.
- How the optimistic flow preserves the Active Skill Leave Contract.
- Advisory UI lock refresh so the menu usually prevents a click before the
  backend has to reject a lease conflict.

**Does not cover**

- Agent Server lifecycle or workspace path resolution — owned by the parent
  runtime model.

## Key Decisions

| Decision | Rationale |
|---|---|
| Lease acquisition moves to the backend product command. | The backend is the enforcement boundary. It must acquire or verify the skill lease before any OpenHands session work begins. |
| Navigation happens before session boot. | The target page already has loading skeletons. Navigating immediately eliminates the visible idle window while the Agent Server starts. |
| `leaveCurrentSkill` stays synchronous in `handleSelectSkill`. | The leave sequence (pause → release lock → clear UI) must complete before the next skill's backend bootstrap begins. Moving leave into the background would create a window where two skills appear active simultaneously. |
| Background boot errors navigate back to dashboard. | The user sees a brief skeleton flash, then an error toast and a return to `/`. This is preferable to leaving the page in a broken state with no conversation. |
| Stale hydration is harmless. | If the user navigates to a different skill before the background boot completes, the new skill's activation overwrites the refine store. The old hydration lands on inactive state. |
| UI lock state is advisory only. | A lightweight poller or focus-refresh keeps the skill menu mostly current, but the backend remains the source of truth for lease conflicts. |

## Flow

```text
click skill → navigate → page shows skeleton
                                ↓
                  background: selectSkillOpenHandsSession(skillId)
                                ↓
                  backend lease check/acquire
                                ↓
                  hydrate refine store → page shows content
```

### Sync Phase (blocks navigation)

| Step | Duration | Rationale |
|---|---|---|
| `setSelectedWorkspaceSkillName` | sync | Store update, no I/O. |
| `navigate` | sync | Route change is instant. The target page shows its existing loading skeleton. |

### Async Phase (background)

| Step | Duration | Rationale |
|---|---|---|
| `selectSkillOpenHandsSession` | 2-5s cold, <500ms warm | Backend product command. Acquires or verifies the skill lease, then calls `ensure_skill_session` and restores history. |
| `hydrateSelectedSkillOpenHandsSession` | <50ms | Store writes, no I/O. Populates `refineStore.conversationId`, `selectedSkill`, `messages`, and `availableAgents`. |
| `setActiveSessionSkillName` | sync | Marks the session as fully active. |

### Interaction with the Three-Layer Model

The optimistic flow preserves the [three-layer runtime contract](README.md#three-layer-architecture):

- **Frontend → Backend**: `selectSkillOpenHandsSession` is still called as a
  single product command. The frontend does not call runtime primitives directly.
- **Backend → OpenHands**: The backend still owns server ensure (via
  `ensure_skill_session`), lease acquisition/verification, conversation
  resolution, and event normalization. No changes to the runtime primitive
  layer.

The only change is *when* the product command is called relative to navigation,
not *what* it does.

### Interaction with the Active Skill Leave Contract

The [leave sequence](README.md#active-skill-leave-contract) remains synchronous
in `handleSelectSkill`:

1. Pause the current persistent conversation (`pause_openhands_session`)
2. Release the current skill lock (`release_lock`)
3. Clear app-level UI state (`teardownWorkflowSession`, `selectSkill(null)`, `setActiveSkill(null)`)

Only after leave completes does the new skill's sync phase begin:

1. Navigate immediately
2. Background: call `select_skill_openhands_session`
3. Backend acquires or verifies the new skill lease before any OpenHands
   session work

This ordering prevents a window where two skills appear active simultaneously.
The Agent Server stays alive during skill switches — `ensure_skill_session`
on the new skill reuses the running server if the conversations root matches,
or restarts it if the root changes.

### Page Loading States

`WorkflowPage` and `WorkspaceRoutePage` already show skeletons when
`isLoaded === false`. The `useWorkflowPersistence` hook sets `isLoaded = true`
after `getWorkflowState` resolves from the database.

The page must also wait for `refineStore.conversationId` to be non-null before
showing content. This prevents the page from rendering with an empty chat panel
or missing transcript history.

```typescript
const conversationId = useRefineStore((s) => s.conversationId);
const sessionReady = isLoaded && !!conversationId;

if (!sessionReady) {
  return <WorkflowLoadingSkeleton />;
}
```

The same pattern applies to `WorkspaceRoutePage` for the refine tab.

## Failure Handling

If the background session boot fails:

1. Show an error toast with the failure reason
2. Navigate back to the dashboard (`/`)
3. Clear `activeSessionSkillName` and `selectedWorkspaceSkillName`
4. Release the lock (best-effort, fire-and-forget) only if backend acquisition
   already succeeded

## Race Conditions

### Double-click on same skill

The existing `sessionAlreadyActive` check in `activateSkill` still
short-circuits if the session is already hydrated. Before hydration completes,
duplicate background boot requests are harmless because backend lease
acquisition is idempotent for the same app instance and rejects competing
instances before any OpenHands session work begins.

### Navigate away before session ready

If the user clicks a different skill before the background boot completes:

- The new skill's `handleSelectSkill` calls `leaveCurrentSkill` synchronously,
  which pauses the in-progress conversation (if any) and releases the lock
- The background `selectSkillOpenHandsSession` for the old skill will either
  succeed (and hydrate a store that's no longer active) or fail (and show a
  toast that the user has already navigated away from)
- The stale hydration is harmless — the new skill's activation will overwrite
  the refine store state

### Concurrent skill switches

The `pendingSkillSwitch` dialog already gates rapid switches when an agent is
running. For the optimistic flow, this dialog should still appear if the user
clicks a different skill while the background boot is in progress — the dialog
should offer "Switch now" which cancels the in-progress boot and activates the
new skill.

## States / Transitions

```text
idle ──click──> navigating ──navigate──> loading ──backend lease ok──> booting
                                                                          │
booting ──session ready────────────────────────────────────────────────────┘
     │
     └──session failed──> error ──toast + navigate──> idle
```

| State | Visible UI | Store state |
|---|---|---|
| `idle` | Dashboard or previous skill | `activeSessionSkillName = null` |
| `navigating` | Brief flash of previous route | Route changing |
| `loading` | Skeleton (workflow or workspace) | `conversationId = null` |
| `booting` | Skeleton (workflow or workspace) | backend command in flight |
| `active` | Full content | `conversationId` set, `activeSessionSkillName` set |
| `error` | Toast + dashboard | `activeSessionSkillName = null` |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src/components/layout/app-layout.tsx` | `activateSkill` and `handleSelectSkill` — sync/async split lives here. |
| `app/src/pages/workflow.tsx` | `WorkflowPage` — adds `conversationId` guard to loading state. |
| `app/src/pages/workspace-route.tsx` | `WorkspaceRoutePage` — adds `conversationId` guard for refine tab. |
| `app/src/components/skill-list-panel.tsx` | Advisory UI lock refresh/polling to disable skills locked by other instances. |
| `app/src/hooks/use-workflow-persistence.ts` | Sets `isLoaded` after DB hydration; unchanged. |
| `app/src/stores/refine-store.ts` | `conversationId` is the signal that session boot is complete. |
| `app/src-tauri/src/commands/skill_session.rs` | `select_skill_openhands_session` backend command — acquires/verifies lease before OpenHands session work. |
