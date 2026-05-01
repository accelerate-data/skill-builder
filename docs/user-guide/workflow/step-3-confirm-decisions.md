# Step 3: Confirm Decisions

This step analyzes clarification answers and writes `context/decisions.json`.

---

## What you see after the run finishes

The completion view shows a decisions summary followed by decision cards.

| Column | What it shows |
|---|---|
| **Decisions** | Total decisions, how many are resolved, how many had conflicts resolved, how many need review |
| **Quality** | Whether contradictions remain or were reviewed |

The header state changes if contradictions remain, and can move to a reviewed state after you edit required fields.

**Decision cards** (listed below the summary)

Each card shows a decision ID (e.g. D1), a title, and a status badge.

| Badge | Meaning |
|---|---|
| **resolved** | Decision is clear and confirmed |
| **conflict-resolved** | Two conflicting answers were reconciled by the agent |
| **needs-review** | The agent could not fully resolve this and expects review |
| **revised** | You edited a previously blocked decision |

Click any card to expand it and see:

- **Original question**
- **Decision** — what was decided
- **Implication** — what this decision means for the skill

---

## Review and edit decisions

When a decision needs review, the card is editable in update mode and changes autosave.

1. Click a **needs-review** card to expand it (it opens automatically).
2. Edit the **Decision** text and **Implication** text in the fields provided.
3. Changes save automatically.

## Continue to Step 4

Click **Next Step** at the bottom right. You can continue regardless of decision status.

> To change your original answers instead of editing decisions here, go back to an earlier step via the sidebar. See [Reset a step](overview.md#reset-a-step).
