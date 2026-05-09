# Review: feature/vu-1176-clean-route-split-skill-surfaces

- **Branch:** `feature/vu-1176-clean-route-split-skill-surfaces`
- **Review Date:** 2026-05-09
- **Reviewer:** code-reviewer agent (4 independent subagent gates + local validation)

## Intent

This branch implements two sub-scopes under VU-1176:

1. **Immediate Escape interruption** — Make pressing `Esc` during Refine, Workflow, or Eval runs feel immediate by introducing an optimistic local `isStopping` state, a single Escape handler in `AppLayout`, a shared `RunStatusFooter` component, and removing per-page cancel buttons.
2. **Clean route split for skill surfaces** — Replace the overloaded `/` route with explicit `/`, `/workflow/$skillName`, and `/workspace/$skillName` routes. Split selected-skill routing state from active-session runtime identity. Move route ownership out of `AppLayout` into page-level surfaces. Remove Node sidecar package and rename Rust runtime modules.

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| **Linear Issue (VU-1176)** | 6 acceptance criteria covering optimistic `isStopping` state, UI distinction, steer-after-interrupt, shared contract, OpenHands limitation handling (struck through), and automated coverage |
| **Plan 1: Route Split** | `docs/plans/2026-05-09-clean-route-split-for-skill-surfaces.md` — 6 tasks, multiple unchecked steps. Explicit home/workflow/workspace routes, route/session coordinator, workspace subroutes, page-owned teardown removal |
| **Plan 2: Escape Interruption** | `docs/plans/2026-05-09-immediate-escape-interruption.md` — 12 tasks, all checked off. `isStopping` in 3 stores, single Escape handler, shared footer, cancel button removal |
| **Design Doc** | `docs/design/openhands-runtime-model/remove-node-sidecar.md` — Remove `app/sidecar/`, rename Rust `sidecar` → `runtime_*`, make frontend TS contract ownership explicit |
| **Code Changes** | 187 files, +5,773/-7,460 lines. 35 commits spanning route restructuring, state management, component refactors, sidecar removal, and Rust renames |

## Gate Results

| Gate | Result | Details |
|------|--------|---------|
| **Changed-area validation** | Mixed | Frontend unit: 643 passed (57 files) ✅ · TypeScript: no errors ✅ · Repo-map: passed ✅ · Agent structural: 22 passed ✅ · Rust: 1,092 passed ✅ · Markdown lint: 10 errors in plan doc |
| **Eval harness** | **FAIL** | 2 of 81 tests fail — `cancel_workflow_step` and `cancel_agent_run` removed from typed Tauri command contract but still referenced in VU-1140 eval assertions |
| **Code review subagent** | Findings | 2 High, 4 Medium, 4 Low |
| **Simplification subagent** | Findings | 1 S1, 2 S2, 4 S3, 5 S4 |
| **Test coverage subagent** | Findings | 1 Critical, 2 High, 2 Medium, 2 Low |
| **AC review subagent** | Findings | AC1–AC4 Proven, AC5 N/A, AC6 Proven with gap. Branch scope exceeds Linear issue. |

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Pressing `Esc` puts the active run into an immediate local `stopping` state without waiting for backend acknowledgement | **Proven** | `app-layout.tsx:101` sets `refineStore.setStopping(true)` synchronously before `pauseOpenHandsSession()`. Same pattern for workflow (line 122) and evals (line 136). Idempotency guards on all three paths. Tests verify synchronous state change (`app-layout.test.tsx:443-576`). |
| 2 | The UI clearly distinguishes `interrupt requested` from fully stopped terminal states | **Proven** | `RunStatusFooter` has `"stopping"` status with amber pulsing dot (`run-status-footer.tsx:37-40`, label `"stopping…"` at line 52). All three contexts wire it: refine (`workspace-refine.tsx:381-385`), workflow (`agent-run-footer.tsx:32`), evals (`workspace-evals.tsx:75-79`). |
| 3 | The runtime path supports redirecting the conversation after interrupt without requiring the user to infer hidden backend state | **Proven with caveat** | Refine clears `isStopping` on terminal events (`workspace-refine.tsx:232`) and has `pendingFollowupMessage` mechanism for steer-after-interrupt (`workspace-refine.tsx:327-337`). **But workflow has no equivalent `setStopping(false)` on terminal state** (see H1). |
| 4 | Refine and Workflow use the same interruption contract where applicable | **Proven** | Both stores have `isStopping: boolean` + `setStopping()`. Both handled by single Escape handler. Both use shared `RunStatusFooter`. Both reset on session init. |
| 5 | OpenHands preemption limitation handling | **N/A** | Struck through in Linear issue. |
| 6 | Automated coverage verifies the frontend state transition and backend pause/redirect integration contract | **Proven with gaps** | Store transitions tested. Escape handler tested. Footer rendering tested. **Gaps:** (a) workflow `isStopping` not cleared on completion, (b) `eval-running-state` cancel handler/subscriptions untested, (c) `home.tsx` and `workspace-route.tsx` have zero tests, (d) eval harness tests fail. |

## Findings

### Critical

1. **[Test Coverage] `eval-running-state` cancel handler and subscription API surface untested**
   - **Files:** `app/src/lib/eval-running-state.ts` (51 lines, 10 exports), `app/src/__tests__/lib/eval-running-state.test.ts` (33 lines, 4 functions tested)
   - **Problem:** `setEvalsCancelHandler`, `requestEvalsCancel`, `subscribeEvalsRunning`, `subscribeEvalsStopping` have zero test coverage. The cancel handler lifecycle is critical for Escape-key cancellation during eval runs.
   - **Impact:** A regression in eval cancellation could ship silently. Combined with the 2 eval harness failures, the eval interruption path is the least-verified part of this branch.
   - **Recommendation:** Add tests for cancel handler registration, invocation, and subscription cleanup.

### High

2. **[Skeptic] Workflow `isStopping` is never cleared when the run actually stops**
   - **Files:** `app/src/hooks/use-workflow-state-machine.ts:643-775`, `app/src/components/agent-run-footer.tsx:32`
   - **Problem:** When the workflow agent reaches `completed`, `error`, or `shutdown`, the state machine calls `setRunning(false)` but never `setStopping(false)`. `AgentRunFooter` gives `workflowIsStopping` absolute priority over actual run status, so the footer permanently shows "stopping…" even after the agent has completed.
   - **Contrast:** Refine correctly clears `isStopping` on terminal events (`workspace-refine.tsx:232`).
   - **Impact:** User sees a permanently stuck "stopping…" status after any workflow interrupt. Cannot tell when the run has actually stopped.
   - **Recommendation:** Add `setStopping(false)` alongside every `setRunning(false)` call in workflow terminal paths.

3. **[Skeptic] Eval harness tests fail — removed commands still in VU-1140 contract list**
   - **Files:** `tests/evals/assertions/tauri-command-contract.test.js:20-21,82`, `app/src/lib/tauri-command-types.ts`
   - **Problem:** `cancel_agent_run` and `cancel_workflow_step` were removed from `TauriCommandMap` (replaced by `pause_openhands_session`), but remain in `vu1140Commands` and `migratedCommands` lists in the eval test. Two eval tests fail, blocking CI.
   - **Impact:** CI will fail. The typed command contract test expects these commands to exist.
   - **Recommendation:** Remove both commands from `vu1140Commands` and `migratedCommands`. Verify `pause_openhands_session` is properly typed and tested.

4. **[Skeptic / Architect] Workflow Escape handler reads from refine store, not workflow state**
   - **Files:** `app/src/components/layout/app-layout.tsx:121-128`
   - **Problem:** The workflow Escape guard checks `refineStore.conversationId && refineStore.selectedSkill` and passes refine-store values to `pauseOpenHandsSession`. If a workflow is running without a refine session ever being mounted, the refine store is not hydrated and Escape silently does nothing.
   - **Impact:** Escape key is a no-op for workflow runs when the refine surface was never visited. This is a user-facing bug.
   - **Recommendation:** Derive workflow conversation ID and skill context from the workflow store or agent store, not from the refine store.

### Medium

5. **[Minimalist] `route-skill-session.ts` coordinator functions are dead code**
   - **Files:** `app/src/lib/route-skill-session.ts:33-64`
   - **Problem:** `navigateToSkillSurface` and `leaveActiveSkillForNonSkillRoute` are only imported by their own test file. `AppLayout` has its own `activateSkill` and `handleSelectSkill` that duplicate the same leave/enter/navigate logic inline. The coordinator module was planned but never wired into production.
   - **Impact:** Maintenance burden; misleading surface for future developers.
   - **Recommendation:** Either wire these functions into `AppLayout` (as the plan intended) or remove the module.

6. **[Minimalist] `WorkspaceShell` half-migrated — still owns local tab state**
   - **Files:** `app/src/components/workspace/workspace-shell.tsx:37-43`
   - **Problem:** The plan (Task 4) states "Stop owning tab-as-route state; consume routed surface identity instead." But `WorkspaceShell` still has `useState<WorkspaceSurface>(initialSurface)`, a sync `useEffect`, and `setActiveTab` in `handleTabChange`. The component is route-driven in name but manages its own tab state for rendering.
   - **Impact:** Inconsistent ownership model; potential for route state and local state to diverge.
   - **Recommendation:** Remove local `activeTab` state and derive surface directly from props/route.

7. **[Skeptic] `HomePage` reads `activeSkill` instead of `selectedSkillName`**
   - **Files:** `app/src/pages/home.tsx:8`
   - **Problem:** Variable is named `selectedSkillName` but reads `s.activeSkill` (runtime session identity). The plan says "redirects to the last selected skill workspace." If the user had a workflow running and navigated away, `activeSkill` may be stale or null while `selectedSkillName` has the intended value.
   - **Impact:** Users returning to the app may not be redirected to their last-selected skill.
   - **Recommendation:** Read `s.selectedSkillName` from the store.

8. **[Skeptic] `loadSkillFiles` logic duplicated in two places**
   - **Files:** `app/src/components/workspace/workspace-refine.tsx:36-58`, `app/src/components/workspace/workspace-shell.tsx:103-127`
   - **Problem:** Both components contain the same `getSkillContentForRefine` → `.map()` → `.sort(SKILL.md first)` → `SkillFile[]` transformation.
   - **Recommendation:** Extract to a shared utility.

9. **[Test Coverage] New page components have zero test coverage**
   - **Files:** `app/src/pages/home.tsx` (NEW, 23 lines), `app/src/pages/workspace-route.tsx` (NEW, 76 lines)
   - **Problem:** `workspace-route.tsx` contains non-trivial routing logic: surface derivation from pathname, skill resolution with `library_key` fallbacks, 4-way `skillType` branch, "skill not found" fallback. None of this is tested.
   - **Impact:** Routing regressions could ship undetected.
   - **Recommendation:** Add tests for `workspace-route.tsx` surface routing and skill resolution. Add a test for `home.tsx` redirect behavior.

10. **[Test Coverage] `enterSkill` error path untested**
    - **Files:** `app/src/lib/active-skill-transition.ts:83-98`
    - **Problem:** `enterSkill` has a `try/catch` that releases the lock on error. The test suite covers the happy path (1 test) but does not test what happens when `selectSkillOpenHandsSession` throws or when `acquireLock` throws (the catch calls `releaseLock` on a skill that was never acquired).
    - **Recommendation:** Add error-path tests for `enterSkill`.

11. **[Architect] `setActiveSkill` silently sets two store fields**
    - **Files:** `app/src/stores/skill-store.ts:22`
    - **Problem:** `setActiveSkill: (name) => set({ activeSkill: name, selectedSkillName: name })` couples `activeSkill` and `selectedSkillName` together, undermining the stated goal of splitting "selected-skill routing intent vs active-session runtime identity."
    - **Recommendation:** Separate the setters or document the coupling explicitly.

12. **[Skeptic] `eval-running-state.ts` breaks Zustand convention**
    - **Files:** `app/src/lib/eval-running-state.ts`
    - **Problem:** Uses module-level singletons (`let _isRunning`, `Set` of listeners) while every other store uses Zustand. Zustand's `getState()` provides the same cross-component access without custom pub/sub.
    - **Recommendation:** Migrate to Zustand for consistency, or document the rationale for the custom pattern.

### Low

13. **[Minimalist] Dead code in `chat-input-bar.tsx` — cancel button props and rendering remain**
    - **Files:** `app/src/components/refine/chat-input-bar.tsx:261,266,271,276,436-447`
    - **Problem:** The `onCancel` and `isRunning` props remain in the interface and the cancel button rendering logic still exists. `workspace-refine.tsx` doesn't pass these props, so the button is effectively hidden but the code is dead weight. `chat-panel.tsx` also passes them through.
    - **Recommendation:** Remove dead props and rendering code.

14. **[Minimalist] `use-workflow-session.ts` has dead interface parameters**
    - **Files:** `app/src/hooks/use-workflow-session.ts:13-16`
    - **Problem:** Interface declares `currentStep` and `steps` but they are never destructured or used. `skillName` is explicitly silenced with `_`.
    - **Recommendation:** Remove unused parameters from the interface.

15. **[Minimalist] Skill resolution logic duplicated across 3 locations**
    - **Files:** `app/src/pages/workspace-route.tsx:27-32`, `app/src/components/layout/app-layout.tsx:151-167`, `app/src/pages/home.tsx` (implicit)
    - **Problem:** Same `builderSkills.find(...) ?? importedSkills.find(...)` pattern in multiple places.
    - **Recommendation:** Extract to a shared `resolveSkill(name)` utility.

16. **[Minimalist] `RouteDestination` type adds no value over router native type**
    - **Files:** `app/src/lib/route-skill-session.ts:3-7`
    - **Problem:** Thin wrapper around TanStack Router's `NavigateOptions`. Forces callers to cast (`navigate(route as Parameters<typeof navigate>[0])` at `app-layout.tsx:239`).
    - **Recommendation:** Use the router's native type directly.

17. **[Minimalist] `runningWorkflow` computed twice in AppLayout**
    - **Files:** `app/src/components/layout/app-layout.tsx:56-59` vs `app-layout.tsx:117-120`
    - **Problem:** Computed once at the top of the component, then recomputed inline inside the Escape handler with a different data source (`useAgentStore.getState()` vs closure-captured `runs`).
    - **Recommendation:** Use a single source of truth.

18. **[Minimalist] Nested redundant div in workflow.tsx layout**
    - **Files:** `app/src/pages/workflow.tsx:623-628`
    - **Problem:** Two nested `div` elements with identical `flex min-h-0 flex-1 flex-col overflow-hidden` classes.
    - **Recommendation:** Merge into a single div.

19. **[Minimalist] Markdown lint errors in implementation plan**
    - **Files:** `docs/plans/2026-05-09-immediate-escape-interruption.md`
    - **Problem:** 10 MD032 errors (blanks around lists).
    - **Recommendation:** Add blank lines around list blocks.

20. **[Test Coverage] Skeleton components untested**
    - **Files:** `app/src/components/workflow-loading-skeleton.tsx` (NEW), `app/src/components/workspace/workspace-loading-skeleton.tsx` (NEW)
    - **Recommendation:** Add smoke tests verifying they render with correct test IDs.

21. **[Test Coverage] `AppLayout` mocks `WorkspaceShell`, hiding integration gaps**
    - **Files:** `app/src/__tests__/components/app-layout.test.tsx:70-74`
    - **Problem:** `WorkspaceShell` is mocked to a trivial div, so skill surface routing and Escape-key interaction with workspace-shell-level tab guards are not exercised through the actual component tree.
    - **Recommendation:** Add at least one integration test that renders the real `WorkspaceShell`.

22. **[Skeptic] Test note "interrupt followed by new steering message" not covered by automated tests**
    - **Files:** Linear issue Test Notes
    - **Problem:** The `pendingFollowupMessage` mechanism exists (`workspace-refine.tsx:327-337`) but no automated test asserts the full interrupt→steer-after-interrupt flow.
    - **Recommendation:** Add an integration test for the steer-after-interrupt flow.

## What Went Well

1. **Clean optimistic state pattern for refine** — The `setStopping(true)` → async pause → `setStopping(false)` on terminal/error flow is well-structured. The idempotency guard prevents double-cancel. Tests verify this thoroughly.

2. **Shared `RunStatusFooter` component** — Good consolidation. The component is well-typed with `FooterDisplayStatus`, handles all status variants consistently, and the amber pulsing dot provides clear visual distinction for the stopping state.

3. **Route split architecture is sound** — The explicit `/`, `/workflow/$skillName`, `/workspace/$skillName` route tree correctly separates concerns. The OpenHands lifecycle contract (same-skill navigation must not restart) is well-specified in the plan and tested in `route-skill-session.test.ts`.

4. **Sidecar removal is thorough** — The `app/sidecar/` deletion, Rust module renames, and repo metadata updates are comprehensive. Rust tests (1,092) all pass, confirming the rename didn't break functionality.

## Verdict

**REQUEST_CHANGES**

Two high-severity findings block a clean approval:

- **H2 (Workflow `isStopping` leak):** The workflow footer will show "stopping…" permanently after any interrupt because `isStopping` is never cleared on workflow completion. This is a visible user-facing bug.
- **H3 (Eval harness failures):** Two eval tests fail because `cancel_agent_run` and `cancel_workflow_step` were removed from the typed contract but remain in VU-1140 eval assertions. CI will fail.
- **H4 (Workflow Escape reads refine store):** The workflow Escape handler reads from `refineStore` instead of workflow state, making Escape a no-op when refine was never mounted. This is a user-facing bug.

Additionally, the **Critical** test coverage gap in `eval-running-state` (cancel handler untested) combined with the eval harness failures means the eval interruption path is the least-verified part of this branch.

The branch also exceeds the Linear issue scope — the route split (Plan 1) is a broader architectural change than "make Escape feel immediate." This is not necessarily wrong, but it should be acknowledged and tracked separately.

## Next Steps

1. **Add `setStopping(false)` to all workflow terminal paths** in `use-workflow-state-machine.ts` — alongside every `setRunning(false)` call that represents a terminal transition.

2. **Fix eval harness tests** — Remove `cancel_agent_run` and `cancel_workflow_step` from `vu1140Commands` and `migratedCommands` in `tests/evals/assertions/tauri-command-contract.test.js`.

3. **Fix workflow Escape handler** — Derive workflow conversation ID and skill context from the workflow store or agent store, not from `refineStore`.

4. **Add tests for `eval-running-state` cancel handler** — Test `setEvalsCancelHandler`, `requestEvalsCancel`, and subscription cleanup.

5. **Add tests for new page components** — `home.tsx` redirect behavior and `workspace-route.tsx` surface routing/skill resolution.

6. **Wire or remove `route-skill-session.ts` coordinator** — Either integrate `navigateToSkillSurface` into `AppLayout` as the plan intended, or remove the module.

7. **Remove dead code** — `chat-input-bar.tsx` cancel props, `use-workflow-session.ts` unused interface parameters, duplicate `loadSkillFiles` logic.

8. **Fix `HomePage` store read** — Use `s.selectedSkillName` instead of `s.activeSkill`.
