# Step 4: Generate Skill

The agent writes the final skill files based on all your answers and the confirmed decisions. Once complete, you can review the output and move to Refine.

---

## What's on screen after the agent finishes

A file viewer showing the generated output.

- A header row shows **Generate Skill Complete** with a checkmark, elapsed time, and cost.
- If the skill includes multiple files (a `SKILL.md` plus one or more `references/*.md` files), a **file selector dropdown** appears above the content. Select a file to view it.
- File content renders as formatted markdown.

---

## How to read the output

1. Review `SKILL.md` — this is the main skill file. It contains the instructions Claude will follow.
2. If a dropdown is shown, open each reference file to review supplementary content.
3. If something looks wrong, go back to an earlier step and correct your answers. See [How to reset a step](overview.md#how-to-reset-a-step).

---

## What to do next

Two buttons appear at the bottom right:

| Button | What it does |
|---|---|
| **Refine** | Opens the [Refine](../refine.md) page for this skill so you can make changes by chatting with an agent |
| **Done** | Returns to the [Dashboard](../dashboard.md) — the skill is marked as completed |

> **Refine** is not shown when one or more steps are marked as skipped.
