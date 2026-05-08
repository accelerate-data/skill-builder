# OpenHands Runtime Clean-Break Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track what already landed from the OpenHands clean-break follow-up
work and keep only the real remaining cleanup items active.

**Current state:** The original clean-break implementation work is complete.
This file is now a status-and-follow-up tracker, not an execution plan for the
already-landed runtime split.

**Tech Stack:** Rust (Tauri commands, runtime helpers, SQLite), TypeScript/React (typed Tauri wrappers and eval workbench UI contracts), Vitest, cargo test, Playwright E2E tags, markdownlint.

---

## Historical Scope

The original workstreams in this plan were:

1. trigger-mode residue removal
2. throwaway naming cleanup
3. persistent-session orchestration tightening

Those workstreams are already implemented on this branch. They are kept below
only as completed status, not as active tasks.

## Completed Workstreams

The original implementation tasks below are now historical. The branch and the
merged clean-break work already completed the main follow-up workstreams, so
the old step-by-step execution checklist is no longer the right live tracker.
Only the post-clarifications cleanup todo below should be treated as active.

### Completed: Trigger-Mode Residue Removal

- [x] Trigger-mode residue was removed from the live eval workbench contract
      and backend paths.
- [x] The app-owned eval workbench surface is performance-only.
- [x] Migration coverage exists for removing legacy `should_trigger` storage
      from the app-owned schema.
- [x] Eval workbench command/UI paths were moved onto the performance-only
      model.

### Completed: Throwaway Naming Cleanup

- [x] Eval workbench, scope review, and settings model validation now use the
      throwaway runtime surface.
- [x] Runtime pathing now uses `.openhands/throwaway/...` instead of the old
      one-shot naming in the active code paths.
- [x] Sidecar/runtime naming has been normalized to `throwaway` in the active
      runtime builders.
- [ ] `repo-map.json` still needs stale one-shot wording removed.

### Completed: Persistent-Session Orchestration Tightening

- [x] OpenHands runtime now exposes separate persistent-session and throwaway
      surfaces.
- [x] Workflow persistent turns were moved to send-only behavior using the
      already-started selected-skill session.
- [x] Selected-skill OpenHands bootstrap was moved out of the Refine page and
      into global session-selection ownership.
- [x] Graceful OpenHands shutdown on app exit was implemented.
- [x] Stable OpenHands workspace secret persistence was implemented.
- [x] Redo/reset now recreate a fresh selected-skill OpenHands conversation
      instead of trying to reuse a deleted one.

### Completed: Local Validation Already Run On This Branch

- [x] `cd app && npx vitest run src/__tests__/components/skill-list-panel.test.tsx`
- [x] `cd app && npx vitest run src/__tests__/hooks/use-workflow-state-machine.test.ts`
- [x] `cd app && npx vitest run src/__tests__/pages/workflow.test.tsx`
- [x] `cd app && npx tsc --noEmit`

### Deleted / No Longer Useful From The Old Plan

The following old execution framing should not be used anymore and has been
removed as active work:

- the original task ordering that assumed the branch still needed the initial
  trigger-removal / throwaway-renaming / persistent-send-path implementation
- test-first checkpoint commit instructions for work that is already landed
- obsolete commit-by-task instructions for already-completed workstreams
- generic “run everything later” sequencing that has been superseded by the
  concrete post-clarifications cleanup todo below

## Post-Clarifications Cleanup Todo

Use this checklist after the clarifications work is closed. It is the explicit
follow-up list for the independent-agent findings and simplifier review.

### A. Skill Lock Ownership And Release

- [ ] Move skill-lock ownership to the same layout/session layer that owns
      selected-skill OpenHands lifecycle.
- [ ] On skill selection: acquire the selected skill lock before the surface
      becomes active.
- [ ] On skill deselection / skill switch: pause the selected skill OpenHands
      session and release that skill lock in the same cleanup path.
- [ ] On app shutdown: pause the selected skill OpenHands session and release
      the selected skill lock.
- [ ] Remove any remaining lock-ownership behavior from
      `app/src/components/workspace/workspace-refine.tsx` so Refine is only a
      surface over the selected skill, not a lifecycle owner.
- [ ] Add tests that prove:
      - selecting a skill acquires the lock
      - switching away releases the previous lock
      - app shutdown releases the active lock

### B. Transcript / Event Replay On Refine Reopen

- [ ] Stop discarding restore data in
      `app/src-tauri/src/commands/skill_session.rs`.
- [ ] Return real `restored_messages`, `restored_transcript_events`, and the
      correct dispatched-turn state when resuming an existing Refine
      conversation.
- [ ] On frontend bootstrap, hydrate restored transcript/messages into the
      Refine UI instead of clearing them unconditionally.
- [ ] Preserve resumed-session semantics so reopen does not reset the session
      to first-turn behavior or rebuild an initialization-style prompt for an
      existing thread.
- [ ] Replay the setup/runtime row and the contextual dispatched task row when
      reopening Refine, so restored sessions visibly match the intended Refine
      transcript contract.
- [ ] Add tests that prove:
      - resumed Refine restores transcript/messages/events
      - resumed Refine does not send a fresh bootstrap-style first turn
      - transcript visibility matches the documented Refine-vs-Workflow
        contract

### C. Canonical Session Ownership And Bootstrap Cleanup

- [ ] Make layout the only owner of selected-skill lifecycle:
      - selected skill identity
      - lock lifecycle
      - OpenHands bootstrap/resume
      - pause on deselect
- [ ] Remove split ownership between `app-layout.tsx` and
      `workspace-refine.tsx`.
- [ ] Collapse duplicated frontend bootstrap logic so there is one canonical
      helper for:
      - bootstrapping a selected skill session
      - hydrating the refine store
      - replaying restored transcript state
- [ ] Remove the duplicate bootstrap/hydration sequence currently present in
      `app/src/components/layout/app-layout.tsx`.
- [ ] Simplify `app/src/pages/workflow.tsx` by removing the current fallback
      merge/reconstruction logic for session restart once there is one
      canonical selected-skill source of truth.

### D. Backend Runtime / Session Plumbing Cleanup

- [ ] Remove duplicated refine-runtime setup plumbing between
      `app/src-tauri/src/commands/skill_session.rs` and
      `app/src-tauri/src/commands/refine/mod.rs`.
- [ ] Extract one shared internal helper for runtime/session preparation so the
      skill-session command layer and refine-specific send path do not rebuild
      the same setup independently.
- [ ] Keep the public boundary clear:
      - global selected-skill/session commands own selection bootstrap and
        pause
      - refine owns refine-specific send/content behavior
      - workflow/eval consume the selected skill session

### E. Reset / Redo Contract Hardening

- [x] Reset/redo now clear persisted conversation state and recreate a fresh
      selected-skill OpenHands session instead of trying to reuse the deleted
      conversation.
- [ ] Remove special-case restart behavior that only exists because canonical
      selection/session ownership is still split.
- [ ] Strengthen reset/redo tests so they verify the real fresh-conversation
      restart contract end to end, not only helper invocation.

### F. Test Coverage Gaps

- [ ] Add direct backend tests for
      `select_skill_openhands_session` in
      `app/src-tauri/src/commands/skill_session.rs` covering:
      - saved-conversation reuse
      - stale-session eviction
      - pause-time cleanup / session removal
- [ ] Add direct backend tests for `pause_openhands_session` side effects in
      the same module.
- [ ] Replace or supplement current mocked helper assertions in:
      - `app/src/__tests__/pages/workflow.test.tsx`
      - `app/src/__tests__/components/skill-list-panel.test.tsx`
      so the real restart helper/store hydration behavior is verified.
- [ ] Add backend or integration coverage for shutdown behavior after the
      selected-skill lifecycle refactor.

### G. Repo Metadata / Docs Follow-Through

- [ ] Update `repo-map.json` to include:
      - `app/src-tauri/src/commands/skill_session.rs`
      - `app/src/lib/skill-openhands-session.ts`
- [ ] Update `repo-map.json` descriptions to remove stale `one-shot`
      terminology and align with the throwaway/runtime naming used by the
      branch.
- [ ] Verify the runtime design docs and Refine follow-up docs still match the
      final implemented ownership and replay behavior.

### Coverage Check

This todo explicitly covers all outstanding findings:

- [ ] prior skill lock not released on skill switch
- [ ] resumed Refine loses transcript / resets first-turn semantics
- [ ] `skill_session` command layer lacks direct tests
- [ ] reset/redo tests mock away the real restart contract
- [ ] documented Refine visibility / replay contract still unmet
- [ ] `repo-map.json` stale after structural/runtime changes
- [ ] duplicated frontend bootstrap logic
- [ ] split ownership between layout and Refine
- [ ] awkward workflow restart fallback logic
- [ ] duplicated backend refine-runtime setup plumbing

Run:

```bash
markdownlint \
  docs/design/openhands-runtime-model/README.md \
  docs/design/openhands-runtime-model/send-turn-semantics.md \
  docs/plans/2026-05-08-openhands-runtime-clean-break-followups-plan.md
```

Expected:

- no markdownlint violations
