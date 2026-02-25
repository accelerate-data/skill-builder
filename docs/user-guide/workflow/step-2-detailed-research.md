# Step 2: Detailed Research

The agent runs a second, deeper research pass and generates follow-up questions based on your Step 1 answers. This step may be skipped if Step 1 answers were thorough enough — the [Gate 1 dialog](step-1-research.md#gate-1-transition-dialog) gives you that choice.

---

## What's on screen after the agent finishes

The clarifications editor fills the content area. There is no summary card for this step — only the follow-up questions grouped into sections.

Questions marked with a red **must** badge must be answered before you can continue.

The toolbar shows a progress bar and an answered/total count.

---

## How to answer and continue

1. Answer all questions marked **must**.
2. Click **Continue** at the bottom right. The button shows **Evaluating answers...** while the gate check runs.
3. A transition gate dialog appears — see [Gate 2](#gate-2-transition-dialog) below.

Answers auto-save 1.5 seconds after you stop typing. The status shows **Unsaved changes**, **Saving...**, or **Saved**.

---

## Gate 2 transition dialog

**"Refinement Answers Complete"** — all answers look good
- **Back to Review** — returns to the editor
- **Continue to Decisions** — advances to Step 3

**"Some Refinements Unanswered"** — one or more questions were left blank
- **Let Me Answer** — returns to the editor
- **Continue Anyway** — advances to Step 3 with incomplete answers

**"Refinements Need Attention"** — answers are present but insufficient
- **Let Me Answer** — returns to the editor
- **Continue Anyway** — advances to Step 3

**"Contradictory Answers"** — answers conflict with each other
- **Let Me Answer** — returns to the editor (the only option; resolve the contradiction first)

---

## How to re-run Step 2

Click **Re-run** at the bottom left. The Reset Step dialog warns that resetting Step 2 also resets Step 1, because both steps share the same clarifications file. Click **Delete & Reset** to confirm.
