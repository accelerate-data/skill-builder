# Skill Scope Review

**Status:** Design complete (VU-805). Implementation pending.

Advisory feature that evaluates whether a skill is too broad during creation and suggests focused alternatives using gerund-naming conventions.

---

## Overview

When users create skills they often define overly broad skills (e.g. `sales-analysis`) that cover too many concerns and produce diluted, generic output. This feature evaluates the skill name, description, and purpose against the user's business context and advises decomposition when needed.

The feature is **advisory only** — it never blocks submission. The user makes the final decision.

---

## Trigger Conditions

- **When:** Create mode only (not edit mode)
- **Fields required:** All three fields must have content — name, description, purpose
- **Debounce:** 1–2 seconds after the user stops typing in any of the three fields
- **Re-fires:** Yes — any change to name, description, or purpose re-triggers the check
- **Short description guard:** If the description is fewer than 2 sentences, skip the LLM call and show a hint instead:
  > *"Add more detail to your description to get scope feedback."*

---

## Inputs to the LLM

| Input | Source |
|---|---|
| Skill name | Create form |
| Skill description | Create form |
| Skill purpose | Create form |
| Industry | User settings |
| Uploaded documents | User settings |

Business context (industry + documents) can override a generic breadth signal. If the documents show that "revenue metrics" in this company is one tightly scoped workflow, the LLM should say it's focused — not broad.

---

## Evaluation Criteria

A skill is **too broad** when its description touches more than one distinct domain object.

Examples:

- `"analyzes revenue, headcount, and marketing spend"` → three unrelated domain objects → too broad
- `"forecasts churned customers using CRM data"` → one domain object → focused

The LLM uses industry and uploaded documents as context. A description that sounds multi-domain generically may resolve to a single workflow in the user's specific business context — that is a valid pass.

---

## Model

**Claude Sonnet** — the judgment call of "is this too broad given your business context" benefits from stronger reasoning. Haiku is insufficient for nuanced domain judgment.

---

## Response Contract

```json
{
  "is_too_broad": boolean,
  "reason": string,
  "suggested_skills": [
    {
      "name": string,
      "description": string
    }
  ]
}
```

- `suggested_skills` contains 3–5 items when `is_too_broad` is `true`, empty array otherwise
- `reason` is always populated — used for the banner message and "looks good" confirmation
- All suggested `name` values must use gerund-naming (see below)

---

## Gerund-Naming Convention

All suggested skill names must use the `verb-ing + object` pattern.

| Correct | Incorrect |
|---|---|
| `forecasting-churned-customers` | `churn-forecast` |
| `calculating-opportunity-mrr` | `opportunity-mrr-calculation` |
| `analyzing-rep-performance` | `rep-performance-analysis` |
| `segmenting-enterprise-accounts` | `enterprise-account-segmentation` |

Rules:

- Start with a present-participle verb (`forecasting`, `calculating`, `analyzing`, `segmenting`, `tracking`, `reporting`)
- Follow with a specific object — not a generic noun like `data`, `metrics`, `analysis`
- Kebab-case throughout
- No acronyms unless industry-standard (e.g. `mrr`, `arr`, `crm`)

The prompt must include these examples and the rule explicitly. The LLM must not suggest non-gerund names.

---

## UX Flow

### State 1 — Short description (guard)

Below description field:

> *"Add more detail to your description to get scope feedback."*

No LLM call made.

### State 2 — Focused skill (`is_too_broad: false`)

Subtle confirmation banner below description field:

> ✓ *"This skill looks focused."*

Encourages the user that their scoping is good.

### State 3 — Too broad (`is_too_broad: true`)

Inline advisory banner below description field:

> ⚠ *"This skill might be too broad. Consider splitting into more focused skills."*

User can **expand** the banner to see the suggestions.

### Expanded suggestions panel

Shows each suggested skill with:

- Gerund-named slug (e.g. `forecasting-churned-customers`)
- One-line description
- **Copy** button per suggestion (copies `name: description` to clipboard)

A **Copy all** button copies all suggestions as a formatted list.

A gerund-naming tip is shown in the footer: *"Gerund names: `verb-ing + object`"*

**Persistence:** Suggestions stay visible in the UI state after the panel is collapsed and re-expanded — they are not re-fetched until one of the three trigger fields changes.

### Chip interaction

Each suggestion is a clickable chip. Clicking a chip:

1. Replaces the current form's **name** and **description** fields with that suggestion's values
2. Marks the chip as "current" (highlighted, with a "current" badge)
3. **Does not** trigger a new debounced scope check — the debounce is suppressed when the form update originates from a chip click, not user typing
4. Keeps the suggestions panel open so the user can see all suggestions and swap to another

The user can cycle through suggestions by clicking different chips. The scope check re-arms only when the user manually edits the name, description, or purpose fields after a chip selection.

### Start workflow warning

When the user clicks "Start workflow" and the suggestions panel is visible:

- If **all suggestions have been copied or the panel was dismissed** — proceed normally
- If **uncopied suggestions remain** — show an inline warning in the dialog footer:

  > *"2 suggestions not saved."* **[Copy remaining]** **[Start anyway]**

  - "Copy remaining" copies all unselected suggestions as a formatted list to clipboard and proceeds
  - "Start anyway" proceeds without copying

**Persistent suggestions panel** (follow-up): saving remaining suggestions to the skills list screen for reference after the dialog closes is tracked in [VU-933](https://linear.app/acceleratedata/issue/VU-933).

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Description < 2 sentences | Show hint, skip LLM call |
| Already narrow skill | Show "looks focused" confirmation |
| Non-English input | Prompt instructs the LLM to respond in English only; suggested names must be English gerund-named slugs |
| LLM call fails / timeout | Fail silently — no banner shown, no error surfaced to user |
| User dismisses banner then edits a field | Banner re-evaluates on next debounce |
| Chip clicked then user edits fields | Debounce re-arms; new scope check fires after 1–2s |

---

## Out of Scope

- **Persistent suggestions panel** — saving suggestions to the skills list after dialog closes. Tracked in [VU-933](https://linear.app/acceleratedata/issue/VU-933).
- **Actionable suggestions** — pre-filling a new create form from a suggestion, queuing multiple workflows. Follow-up issue after VU-933.
- **Edit mode** — scope review fires in create mode only.
- **Implementation of the workflow steps or agent prompts** — this feature evaluates the skill metadata, not the generated skill content.
