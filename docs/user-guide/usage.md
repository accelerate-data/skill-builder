# Usage

The Usage page shows a summary of API costs and token consumption across all skill builds, refine sessions, and test runs.

---

## What's on this screen

**Summary cards** (top row)

| Card | What it shows |
|---|---|
| Total Spent (USD) | Cumulative API cost across all runs |
| Total Runs | Number of agent runs |
| Avg Cost/Run | Average cost per individual agent run |

**Cost by Step** bar chart — lists each activity type with total cost, agent run count, and a proportional bar. Activity types include: Research, Review, Detailed Research, Confirm Decisions, Generate Skill, Refine, and Test.

**Cost by Model** bar chart — same breakdown grouped by Claude model (Haiku, Sonnet, Opus).

**Cost Over Time** chart — a daily bar chart showing cost or token usage over the selected date range. Use the **Cost / Tokens** toggle in the top-right corner of the chart to switch between the two views. Hover over a bar to see the date, value, and run count.

**Step History** table — a flat, sortable table of individual agent runs. Each row shows:

| Column | What it shows |
|---|---|
| Date | Timestamp of the run |
| Skill | Skill name |
| Step | Activity type with a color-coded dot |
| Model | Claude model used (Haiku, Sonnet, or Opus) |
| Status | Check icon (completed), X icon (error), or dimmed X (cancelled) |
| Cost | Total API cost for the run |
| Tokens | Total token count for the run |

Click any column header to sort; click again to reverse the sort direction.

---

## Filters

**Date range** — Select a time window using the segmented control: **7d**, **14d**, **30d**, **90d**, or **All time**. All charts and the table update to reflect the selected range.

**Skill filter** — When multiple skills have usage data, a dropdown appears to filter by a specific skill.

**Step filter** — In the Step History table header, a dropdown lets you filter by a specific activity type (e.g. only Research runs, only Refine sessions).

**Model filter** — When multiple models have been used, a dropdown in the Step History header filters by model family.

**Hide cancelled runs** checkbox — Filters out runs that were cancelled before completion. Useful for seeing only completed work.

---

## Controls

**Reset** button — Permanently deletes all usage data. A confirmation dialog appears before deletion. This action cannot be undone.

---

## Empty state

When no usage data exists for the selected date range and filters, the page shows a centered message: *"No usage data yet. Run an agent to start tracking costs."*
