# Workflow overview

The workflow is a 4-step process for builder skills. Agents research the domain, collect clarifications, confirm decisions, and generate the final skill files.

---

## The four steps

| # | Name | What happens |
|---|---|---|
| 1 | **Research** | Agent researches your domain and generates clarification questions |
| 2 | **Detailed Research** | Agent follows up with deeper questions based on your first answers |
| 3 | **Confirm Decisions** | Agent analyzes your answers and produces structured decisions |
| 4 | **Generate Skill** | Agent writes the final `SKILL.md` and any reference files |

Step 2 can be skipped if Step 1 answers are already strong enough. The transition gate decides that.

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

The current step is highlighted.

- In **Review** mode, completed steps are navigable for read-only review.
- In **Update** mode, clicking an earlier completed step opens the reset flow so you can re-run from there.

---

## While an agent is running

The content area shows a live stream of the agent's activity:

- **Agent text** — rendered as markdown as it arrives
- **Tool calls** — shown as collapsible rows (e.g. "Reading SKILL.md", "Web search: …"). Click to expand and see details. Multiple consecutive tool calls are grouped.
- The footer shows status, agent metadata, and run timing.

---

## When a step finishes

A step completion view replaces the stream:

- **Step 1** shows the research summary plus the clarifications editor.
- **Step 2** shows the clarifications editor.
- **Step 3** shows the decisions summary and editable decision cards when needed.
- **Step 4** shows the generated files.

A **"Step N completed"** toast appears.

---

## Reset a step

Use this when you want to re-run a step from scratch.

1. Click a completed step in the sidebar (in update mode) **or** click **Re-run** at the bottom of the clarifications editor.
2. The **Reset to Earlier Step** dialog appears. It lists every file that will be deleted from that step onward.
3. Click **Delete N files & Reset** to confirm. All steps from that point forward reset to Pending.

> Resetting Step 2 (Detailed Research) also resets Step 1 (Research) because they share the same clarifications file.

---

## Error state

If a step fails, the content area shows:
*"Step N failed — An error occurred. You can retry this step."*

Two buttons appear:

- **Reset Step** — clears partial output and resets the step
- **Retry** — re-runs the step without clearing output

---

## Review and Update modes

When you open a completed skill from the dashboard, the workflow starts in **Review** mode. A **Review / Update** toggle appears in the header bar.

| Mode | What it does |
|---|---|
| **Review** | Read-only step review. |
| **Update** | Editable mode for re-running and continuing the workflow. |

The toggle is disabled while an agent is running or a gate evaluation is in progress.

> Skills opened from the dashboard always start in Review mode. To make changes, switch to Update mode first.

---

## Navigation guard

If you try to leave the workflow while an agent is running, a dialog appears:
*"An agent is still running. Leaving will abandon it and you may lose progress."*
Click **Stay** to remain, or **Leave** to exit.
