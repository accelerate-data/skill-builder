# Workspace UI Refinement

Design review and improvement plan for the Skills Overview and Refine pages.

## Scope

This document covers the three surfaces a user interacts with after selecting a completed skill:

1. **Skill List Panel** — left sidebar (`skill-list-panel.tsx`)
2. **Overview tab** — skill metadata, stats, actions (`workspace-overview.tsx`)
3. **Refine tab** — chat + preview split pane (`workspace-refine.tsx`, `chat-panel.tsx`, `preview-panel.tsx`)

## Current state

The UI is functional and well-structured: clean component decomposition, consistent design-system tokens, and solid accessibility (keyboard nav, ARIA roles on the split pane and skill rows). The architecture is sound. The issues below are visual polish, information density, and minor UX inconsistencies.

## Findings

### P1 — High impact, low effort

#### F1: Status bar text is nearly invisible — DONE

**Where:** `workspace-refine.tsx`

The status bar used `text-muted-foreground/60` — 60% opacity on an already muted color. Model name, cost, and elapsed time are useful operational info but required squinting to read.

**Fix:** Changed all status bar content spans to `text-muted-foreground` (full opacity). Dot separators kept at `/20`.

#### F2: Scope-blocked alert renders twice — DONE

**Where:** `workspace-refine.tsx` and `chat-panel.tsx`

Both components rendered an amber scope-blocked banner when `scopeBlocked` was true. Since the Refine tab nests ChatPanel inside WorkspaceRefine, both were visible simultaneously.

**Fix:** Removed the banner from `workspace-refine.tsx`. The ChatPanel banner remains — it's adjacent to the disabled input, making the cause-and-effect relationship clear. Cleaned up unused `AlertTriangle` import and `useNavigate`/`navigate` that were only used by the removed banner.

#### F3: Tags section renders noisy empty state — DONE

**Where:** `workspace-overview.tsx`

When a skill had no tags, the UI rendered `"No tags"` in muted text. This added visual clutter without value.

**Fix:** The entire Tags section now only renders when `tags.length > 0`.

#### F4: Skill row "More" button appears abruptly — DONE

**Where:** `skill-list-panel.tsx`

The More button used `opacity-0 group-hover:opacity-100` without a transition, causing an instant binary flip on hover.

**Fix:** Added `transition-opacity duration-150` to smooth the reveal.

### P2 — Medium impact

#### F5: Overview layout feels unbalanced

**Where:** `workspace-overview.tsx:71`

The `grid-cols-[3fr_2fr]` layout creates a wide left column with dense content and a narrow right column dominated by placeholder cards. The Stats card shows three dashes and a "coming soon" note. The Actions card has only two buttons.

**Recommendation:** Either collapse to a single-column layout with a horizontal action bar, or remove the Stats card entirely until Evals ships. Showing empty metrics takes up prime real estate to communicate nothing.

#### F6: Version History card is a stub

**Where:** `workspace-overview.tsx`

A v1 badge, "Initial", a date, and "Full history available in a future update". This communicates incompleteness without offering value and may undermine product confidence.

**Recommendation:** Remove until versioning ships, or repurpose the space as a compact activity timeline (e.g., "Created", "Workflow completed", "Last refined 2h ago").

#### F7: Chat empty state misses an onboarding opportunity — DONE

**Where:** `chat-message-list.tsx`

`"Send a message to start refining"` centered in a full-height panel was the first thing users saw in Refine. It provided no guidance on what to do.

**Fix:** Replaced with an onboarding hint showing a short description ("Describe what you want to change and the agent will update your skill files.") and three command/mention chips (`/rewrite`, `/validate`, `@SKILL.md`) styled as bordered mono-text badges.

#### F8: Preview panel empty state contradicts context — DONE

**Where:** `preview-panel.tsx`

The preview said `"Select a skill to preview its files"` while the user had already selected a skill.

**Fix:** Changed to `"Skill files will appear here after loading"`. Updated corresponding test assertion.

#### F9: ResizableSplitPane divider is hard to grab — DONE

**Where:** `resizable-split-pane.tsx`

The `w-1` (4px) separator was a small click target on high-DPI displays.

**Fix:** Kept `w-1` visually but added a `before:` pseudo-element extending 4px on each side (total ~12px grab area). Added `transition-colors duration-150` for smooth hover feedback.

### P3 — Low impact / cleanup

#### F10: Row height is tight for two-line content

**Where:** `skill-list-panel.tsx`

`h-[46px]` with name + purpose on two lines leaves tight vertical spacing. Longer names clip against the purpose label.

**Recommendation:** Use `min-h-[46px]` with `py-2` to allow natural expansion, or increase to `h-[52px]`.

#### F11: No loading state on Overview tab — DONE

**Where:** `workspace-shell.tsx` and `workspace-overview.tsx`

The Refine tab had skeleton loading via PreviewPanel, but the Overview tab rendered immediately with no loading indication.

**Fix:** Added an `isLoading` prop to `WorkspaceOverview` with a skeleton layout matching the card structure (mirroring the 3fr/2fr grid). `WorkspaceShell` passes the skill store's `isLoading` state.

#### F12: Inconsistent card spacing — DONE

**Where:** `workspace-overview.tsx` (multiple cards)

Cards used a mix of `space-y-2`, `space-y-3`, and manual `mb-3`/`mb-1` on headings.

**Fix:** Standardized all cards to `space-y-3` for internal spacing. Removed manual margin hacks (`mb-3`, `mb-1`) on headings. Stats inner list uses `space-y-1.5` for tighter key-value pairs.

#### F13: Date formatting inconsistency — DONE

**Where:** `workspace-overview.tsx` vs `skill-list-panel.tsx`

The Overview used `toLocaleDateString()` with no options (locale-dependent), while the Skill List Panel used a custom `formatRelativeDate` ("2h ago", "3d ago").

**Fix:** Replaced `formatDate` with a local `formatRelativeDate` in `workspace-overview.tsx` that matches the Skill List Panel's format (just now / Nm ago / Nh ago / Nd ago / "Mon DD").

#### F14: Card headers lack visual hierarchy

**Where:** `workspace-overview.tsx` (all cards)

Every card uses `text-sm font-semibold`. With 4+ cards visible, they blend together. The primary "Skill Details" card should stand out.

**Recommendation:** Use `text-base font-semibold` for the Skill Details heading and keep `text-sm font-semibold` for secondary cards (Stats, Version History, Actions).

## Implementation status

| Finding | Status | PR |
|---|---|---|
| F1 — Status bar legibility | Done | This PR |
| F2 — Duplicate scope alert | Done | This PR |
| F3 — Tags empty state | Done | This PR |
| F4 — More button transition | Done | This PR |
| F5 — Overview layout | Open | — |
| F6 — Version History stub | Open | — |
| F7 — Chat empty state | Done | This PR |
| F8 — Preview empty state | Done | This PR |
| F9 — Split pane grab area | Done | This PR |
| F10 — Row height | Open | — |
| F11 — Overview loading skeleton | Done | This PR |
| F12 — Card spacing | Done | This PR |
| F13 — Date formatting | Done | This PR |
| F14 — Card header hierarchy | Open | — |

## Files affected

| File | Findings |
|---|---|
| `app/src/components/workspace/workspace-refine.tsx` | F1, F2 |
| `app/src/components/workspace/workspace-overview.tsx` | F3, F11, F12, F13 |
| `app/src/components/workspace/workspace-shell.tsx` | F11 |
| `app/src/components/refine/chat-panel.tsx` | F2 (no change — kept this one) |
| `app/src/components/refine/chat-message-list.tsx` | F7 |
| `app/src/components/refine/preview-panel.tsx` | F8 |
| `app/src/components/refine/resizable-split-pane.tsx` | F9 |
| `app/src/components/skill-list-panel.tsx` | F4 |
| `app/src/__tests__/components/refine/preview-panel.test.tsx` | F8 (test update) |
