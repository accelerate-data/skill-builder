# Test

The Test page runs your skill against a task and shows a side-by-side comparison of how Claude responds with the skill versus without it. An evaluator then highlights the differences and suggests improvements.

---

## What's on this screen

- **Top bar** — skill picker, task prompt textarea, and **Run Test** button
- **Left panel** — "Agent Plan / with skill" (green badge) — Claude's response when your skill is active
- **Right panel** — "Agent Plan / no skill" (orange badge) — Claude's response without any skill
- **Bottom panel** — "Evaluator" — comparison results and recommendations
- **Status bar** — shows current phase, selected skill name, model, and elapsed time while running

---

## How to run a test

1. Select a skill from the skill picker in the top bar.
2. Type a task description in the textarea (e.g. *"Analyze the Q3 revenue data and identify the top three growth drivers"*).
3. Click **Run Test**. Both plan panels stream responses simultaneously. The button shows **Running** while in progress.

> **"Run Test" disabled?** An amber scope warning may be blocking the test. Follow the **Go to Workflow →** link to resolve it first.

---

## How to read the results

Once both agents finish, the **Evaluator** panel populates:

**Comparison bullets** — each line compares the two plans on a specific dimension:

- **↑** — the plan with skill is better on this dimension
- **↓** — the plan without skill is better (indicates a potential regression or over-constraint)
- **→** — the two plans are similar on this dimension

**Recommendations** — 2–4 specific suggestions for improving your skill based on the comparison.

---

## How to act on recommendations

Click **Refine skill** inside the Recommendations block. This navigates to the [Refine](refine.md) page with the recommendations pre-filled in the input bar so you can immediately act on them.

---

## Controls reference

| Control | What it does |
|---|---|
| Skill picker | Select which skill to test |
| Task textarea | Describe the task to test the skill against |
| **Run Test** / **Running** | Start a test or indicates one is in progress |
| **Refine skill** | Opens the Refine page with recommendations pre-filled |
| **Stay** / **Leave** | Navigation guard when leaving mid-test |
