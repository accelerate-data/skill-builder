# Workflow overview

The workflow is a 4-step process where AI agents research your domain, gather your answers, and generate a skill file. Each step runs an agent, then waits for you to review or respond.

---

## The four steps

| # | Name | What happens |
|---|---|---|
| 1 | **Research** | Agent researches your domain and generates clarification questions |
| 2 | **Detailed Research** | Agent follows up with deeper questions based on your first answers |
| 3 | **Confirm Decisions** | Agent analyzes your answers and produces structured decisions |
| 4 | **Generate Skill** | Agent writes the final `SKILL.md` and any reference files |

Step 2 (Detailed Research) may be skipped if your Step 1 answers are thorough enough — the app asks you at the transition gate.

---

## The sidebar

The left sidebar lists all steps with their current status.

| Icon | Status |
|---|---|
| Hollow circle | Pending — not yet run |
| Spinning loader (blue) | In progress |
| Clock (blue) | Waiting for you |
| Filled checkmark (green) | Completed |
| Alert circle (red) | Error |
| Skip-forward arrow (dimmed, "Skipped") | Skipped |

The current step is highlighted. **Completed steps are clickable** — click one to jump back to it and review its output.

---

## What you see while an agent is running

The content area shows a live stream of the agent's activity:

- **Agent text** — rendered as markdown as it arrives
- **Tool calls** — shown as collapsible rows (e.g. "Reading SKILL.md", "Web search: …"). Click to expand and see details. Multiple consecutive tool calls are grouped.
- The **footer bar** shows: status dot, agent name, model, elapsed time, and turn count.

---

## When the agent finishes

A step completion view replaces the stream:

- Steps 1–2: the clarifications editor opens so you can answer questions.
- Step 3: a decisions summary card with expandable decision cards.
- Step 4: a file viewer showing the generated output files.

A **"Step N completed"** toast appears.

---

## How to reset a step

Use this when you want to re-run a step from scratch.

1. Click a completed step in the sidebar (in update mode) **or** click **Re-run** at the bottom of the clarifications editor.
2. The **Reset to Earlier Step** dialog appears. It lists every file that will be deleted from that step onward.
3. Click **Delete N file(s) & Reset** to confirm. All steps from that point forward reset to Pending.

> Resetting Step 2 (Detailed Research) also resets Step 1 (Research) because they share the same clarifications file.

---

## Error state

If a step fails, the content area shows:
*"Step N failed — An error occurred. You can retry this step."*

Two buttons appear:

- **Reset Step** — clears partial output and resets the step
- **Retry** — re-runs the step without clearing output

---

## Navigation guard

If you try to leave the workflow while an agent is running, a dialog appears:
*"An agent is still running. Leaving will stop the agent and you may lose progress."*
Click **Stay** to remain, or **Leave** to exit.
