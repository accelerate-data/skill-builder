# Consolidation Handoff — Canonical `clarifications.json` Format

---

## Your Role in Consolidation

Synthesize raw research text from multiple parallel dimension Tasks into a single, cohesive `clarifications.json` as inline text. Reason about the full findings — consolidate overlapping concerns, rephrase for clarity, organize into a logical flow a PM can answer efficiently.

Use extended thinking before writing. Consider cross-Task question interactions, hidden dependencies, and cognitive load.

---

## Step-by-Step Consolidation Instructions

### Step 1: Read all inputs

Read all dimension Task outputs (500-800 words each) before organizing.

### Step 2: Deduplicate and organize

For each cluster of related questions across dimension findings:

- **Identify the underlying decision** — different-looking questions may resolve the same design choice
- **Pick the strongest framing** — most specific choices, clearest implications
- **Fold in unique value** from weaker versions
- **Rephrase if needed** for natural reading

Arrange into logical sections: broad scoping first, then detailed design decisions. Add a `Cross-cutting` section for questions spanning multiple dimensions.

Within each section, mark questions as either:

- `must_answer: true` — questions critical to producing a correct skill
- `must_answer: false` — questions where a reasonable default exists

### Step 3: Handle contradictions

Put contradictions in a `notes` array entry with `type: "inconsistency"`. Do not silently resolve contradictions.

### Step 4: Build the complete JSON

Number questions sequentially (Q1, Q2, ...). Number sections sequentially (S1, S2, ...). Follow the JSON schema below exactly. For consolidated questions from multiple dimensions, list the source dimension names in the `consolidated_from` array.

**Always:**

- Every question must have 2-4 choices plus a final "Other (please specify)" choice with `is_other: true`
- Include a `recommendation` field with the recommended choice and rationale
- `answer_choice` and `answer_text` are always `null` at step 0
- `refinements` is always an empty array `[]` at step 0 (added by detailed-research in step 3)
- `metadata.must_answer_count` must equal the count of questions with `must_answer: true`
- `metadata.priority_questions` must list all question IDs where `must_answer: true`
- Produce the complete JSON content in a single pass as inline text

---

## Canonical `clarifications.json` Schema

```json
{
  "version": "1",
  "metadata": {
    "title": "Clarifications: {Domain Name}",
    "question_count": 26,
    "section_count": 6,
    "refinement_count": 0,
    "must_answer_count": 3,
    "priority_questions": ["Q1", "Q2", "Q3"],
    "duplicates_removed": 17,
    "scope_recommendation": false
  },
  "sections": [
    {
      "id": "S1",
      "title": "Section Name",
      "description": "Brief description of what this section covers.",
      "questions": [
        {
          "id": "Q1",
          "title": "Short Title",
          "must_answer": true,
          "text": "Full question text explaining what needs to be decided...",
          "consolidated_from": ["Metrics Research", "Segmentation Research"],
          "choices": [
            {"id": "A", "text": "Choice A text", "is_other": false},
            {"id": "B", "text": "Choice B text", "is_other": false},
            {"id": "C", "text": "Choice C text", "is_other": false},
            {"id": "D", "text": "Other (please specify)", "is_other": true}
          ],
          "recommendation": "A — Use recurring fee for MS; spread TCV for PS.",
          "answer_choice": null,
          "answer_text": null,
          "refinements": []
        }
      ]
    }
  ],
  "notes": [
    {
      "type": "inconsistency",
      "title": "Pipeline Entry vs. Committed Stage",
      "body": "Q2 says stage beyond 'Prospecting' enters pipeline. Q12 says 'Proposal Sent' is the committed threshold. These may be compatible (entry != commitment) but the PM should confirm."
    }
  ]
}
```

### Field Reference

#### `metadata` object

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Document title: `"Clarifications: {Domain Name}"` |
| `question_count` | integer | yes | Total questions across all sections |
| `section_count` | integer | yes | Number of sections |
| `refinement_count` | integer | yes | Total refinement items. Always 0 at Step 0 |
| `must_answer_count` | integer | yes | Count of questions with `must_answer: true` |
| `priority_questions` | string[] | yes | IDs of all questions where `must_answer: true` |
| `duplicates_removed` | integer | yes | Duplicates eliminated during consolidation. Count each collapsed group as (n-1) |
| `scope_recommendation` | boolean | yes | Set to `true` by scope advisor when scope is too broad; `false` otherwise |

#### `sections[]` array

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Sequential section ID: `S1`, `S2`, ... |
| `title` | string | yes | Section name |
| `description` | string | yes | Brief description of section scope |
| `questions` | array | yes | Questions in this section |

#### `questions[]` array

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Sequential question ID: `Q1`, `Q2`, ... |
| `title` | string | yes | Short title for the question |
| `must_answer` | boolean | yes | `true` for questions critical to a correct skill |
| `text` | string | yes | Full question text (title is just a short label) |
| `consolidated_from` | string[] | optional | Source dimension names when question draws from multiple dimensions |
| `choices` | array | yes | 2-4 choices + "Other (please specify)" |
| `recommendation` | string | yes | Recommended choice letter + rationale |
| `answer_choice` | string/null | yes | Always `null` at Step 0 |
| `answer_text` | string/null | yes | Always `null` at Step 0 |
| `refinements` | array | yes | Always `[]` at Step 0. Populated in Step 3 by detailed-research |

#### `choices[]` array

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Choice letter: `A`, `B`, `C`, `D`, etc. |
| `text` | string | yes | Choice text (keep short — reasoning belongs in `recommendation`) |
| `is_other` | boolean | yes | `true` only for the final "Other (please specify)" choice |

#### `notes[]` array

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | yes | Note type: `"inconsistency"`, `"critical_gap"`, or `"flag"` |
| `title` | string | yes | Short title describing the issue |
| `body` | string | yes | Detailed explanation |

#### Refinement objects (added in Step 3 — not Step 0)

| Field | Type | Description |
|---|---|---|
| `id` | string | Refinement ID: `R{n}.{m}` where `n` is parent question number |
| `parent_question_id` | string | The question this refines (e.g., `Q6`) |
| `title` | string | Short title |
| `text` | string | Rationale for why this refinement matters |
| `choices` | array | Same format as question choices |
| `recommendation` | string | Recommended choice + rationale |
| `answer_choice` | string/null | Always `null` when created |
| `answer_text` | string/null | Always `null` when created |

### Refinement ID scheme

| Level | Format | Example | Who creates it |
|---|---|---|---|
| Top-level question | `Q{n}` | `Q1`, `Q12` | Step 0 consolidation (this step) |
| Refinement | `R{n}.{m}` | `R1.1`, `R12.2` | Step 3 |

Parent is embedded in the ID: `R1.1` refines **Q1**, `R12.2` refines **Q12**.

---

## Complete Example (abbreviated)

```json
{
  "version": "1",
  "metadata": {
    "title": "Clarifications: CRM Analytics",
    "question_count": 8,
    "section_count": 3,
    "refinement_count": 0,
    "must_answer_count": 3,
    "priority_questions": ["Q1", "Q3", "Q5"],
    "duplicates_removed": 4,
    "scope_recommendation": false
  },
  "sections": [
    {
      "id": "S1",
      "title": "Entity Model",
      "description": "Customer hierarchy and account classification decisions.",
      "questions": [
        {
          "id": "Q1",
          "title": "Customer Hierarchy Depth",
          "must_answer": true,
          "text": "How many levels does your customer hierarchy support?",
          "consolidated_from": [],
          "choices": [
            {"id": "A", "text": "Single level — all accounts are peers", "is_other": false},
            {"id": "B", "text": "Two levels — parent company and subsidiaries", "is_other": false},
            {"id": "C", "text": "Three or more levels — full corporate hierarchy tree", "is_other": false},
            {"id": "D", "text": "Other (please specify)", "is_other": true}
          ],
          "recommendation": "B — Two levels covers most enterprise use cases without excessive complexity.",
          "answer_choice": null,
          "answer_text": null,
          "refinements": []
        },
        {
          "id": "Q2",
          "title": "Account Type Classification",
          "must_answer": false,
          "text": "How are accounts classified by type?",
          "consolidated_from": [],
          "choices": [
            {"id": "A", "text": "By industry vertical only", "is_other": false},
            {"id": "B", "text": "By account tier (Enterprise, Mid-Market, SMB)", "is_other": false},
            {"id": "C", "text": "By both industry and tier", "is_other": false},
            {"id": "D", "text": "Other (please specify)", "is_other": true}
          ],
          "recommendation": "C — Dual classification enables richer segmentation.",
          "answer_choice": null,
          "answer_text": null,
          "refinements": []
        }
      ]
    },
    {
      "id": "S2",
      "title": "Metrics",
      "description": "Metric definitions and calculation rules.",
      "questions": [
        {
          "id": "Q3",
          "title": "Win Rate Definition",
          "must_answer": true,
          "text": "How is win rate calculated?",
          "consolidated_from": [],
          "choices": [
            {"id": "A", "text": "Closed-won / all closed opportunities", "is_other": false},
            {"id": "B", "text": "Closed-won / all opportunities created in period", "is_other": false},
            {"id": "C", "text": "Closed-won / opportunities that reached a minimum qualification stage", "is_other": false},
            {"id": "D", "text": "Other (please specify)", "is_other": true}
          ],
          "recommendation": "C — Qualification-stage denominator removes noise from unqualified leads.",
          "answer_choice": null,
          "answer_text": null,
          "refinements": []
        }
      ]
    }
  ],
  "notes": [
    {
      "type": "inconsistency",
      "title": "Pipeline Entry vs. Committed Stage",
      "body": "Q2 says stage beyond 'Prospecting' enters pipeline. Q12 says 'Proposal Sent' is the committed threshold. These may be compatible (entry != commitment) but the PM should confirm."
    },
    {
      "type": "critical_gap",
      "title": "Win Rate Definition",
      "body": "Q3 is a must-answer question but has no answer. This is required for skill generation."
    }
  ]
}
```

---

## Output Checklist

- Valid JSON that parses without errors
- `metadata.question_count` matches actual question count across all sections
- `metadata.section_count` matches actual section count
- `metadata.must_answer_count` matches count of questions with `must_answer: true`
- `metadata.priority_questions` lists all question IDs where `must_answer: true`
- `metadata.refinement_count` is `0`
- `metadata.duplicates_removed` reflects actual deduplication count
- Every question has 2-4 choices + "Other (please specify)" with `is_other: true`
- Every question has a `recommendation` field
- All `answer_choice` and `answer_text` values are `null`
- All `refinements` arrays are empty `[]`
- Contradictions and critical gaps captured in `notes[]`
