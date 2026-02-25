# Step 3: Confirm Decisions

The agent analyzes all your answers from Steps 1 and 2 and produces a structured set of decisions. Your job is to review them before the skill is generated.

---

## What's on screen after the agent finishes

**Decisions Complete summary card** (at top)

| Column | What it shows |
|---|---|
| **Decisions** | Total decisions, how many are resolved, how many had conflicts resolved, how many need review |
| **Quality** | Count of reconciled conflicts; "No unresolvable contradictions" or a red "Contradictions — review required" message |

**Contradiction banner** (appears in red if contradictions were found)
*"Contradictory inputs detected — some answers are logically incompatible. Review decisions marked 'needs-review' before generating the skill."*

**Decision cards** (listed below the summary)

Each card shows a decision ID (e.g. D1), a title, and a status badge.

| Badge | Meaning |
|---|---|
| **resolved** | Decision is clear and confirmed |
| **conflict-resolved** | Two conflicting answers were reconciled by the agent |
| **needs-review** | The agent could not resolve a contradiction — you should review this before continuing |

Click any card to expand it and see:
- **Original question**
- **Decision** — what was decided
- **Implication** — what this decision means for the skill

---

## How to edit a needs-review decision

Decisions marked **needs-review** are editable directly in the card — they open expanded by default. An amber banner confirms: *"N decisions need your review — edit the text below, changes save automatically."*

1. Click a **needs-review** card to expand it (it opens automatically).
2. Edit the **Decision** text and **Implication** text in the fields provided.
3. Changes save automatically. The contradiction banner turns green: *"Contradictions reviewed — skill will be generated with your edits."*

## How to continue to Step 4

Click **Next Step** at the bottom right. You can continue regardless of decision status.

> To change your original answers instead of editing decisions here, go back to an earlier step via the sidebar. See [How to reset a step](overview.md#how-to-reset-a-step).
