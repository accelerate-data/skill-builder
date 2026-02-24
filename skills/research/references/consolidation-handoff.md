# Consolidation Handoff — Canonical `clarifications.md` Format

---

## Your Role in Consolidation

Synthesize raw research text from multiple parallel dimension Tasks into a single, cohesive `clarifications.md` as inline text. Reason about the full findings — consolidate overlapping concerns, rephrase for clarity, organize into a logical flow a PM can answer efficiently.

Use extended thinking before writing. Consider cross-Task question interactions, hidden dependencies, and cognitive load.

---

## Step-by-Step Consolidation Instructions

### Step 1: Read all inputs

Read all dimension Task outputs (500–800 words each) before organizing.

### Step 2: Deduplicate and organize

For each cluster of related questions across dimension findings:

- **Identify the underlying decision** — different-looking questions may resolve the same design choice
- **Pick the strongest framing** — most specific choices, clearest implications
- **Fold in unique value** from weaker versions
- **Rephrase if needed** for natural reading

Arrange into logical sections: broad scoping first, then detailed design decisions. Add a `## Cross-cutting` section for questions spanning multiple dimensions.

Within each `##` section, group under:
- `### Required` — questions critical to producing a correct skill
- `### Optional` — questions where a reasonable default exists

Include only the relevant sub-heading(s) per section.

### Step 3: Handle contradictions

Put contradictions in a `## Needs Clarification` section. Do not silently resolve contradictions.

### Step 4: Build the complete file

Number questions sequentially (Q1, Q2, ...). Follow the format spec below exactly. For consolidated questions from multiple dimensions: `_Consolidated from: [dimension names]_`.

**Always:**
- Every question must have 2–4 lettered choices plus a final "Other (please specify)" choice
- Include a `**Recommendation:**` field between choices and answer
- Every question must end with `**Answer:**` followed by a blank line
- YAML frontmatter must include accurate counts for all required fields
- YAML frontmatter must include `priority_questions` listing all Required question IDs
- Do NOT use `[MUST ANSWER]` inline tags in question headings
- Produce the complete file content in a single pass as inline text

---

## Canonical `clarifications.md` Format

### YAML Frontmatter

```yaml
---
question_count: 26        # required — total Q-level questions
sections: 6               # required — number of ## sections
duplicates_removed: 17    # required — number of duplicate questions eliminated during consolidation
refinement_count: 16      # required — total R-level items (0 for step 0, which this is)
status: pending           # optional — workflow status
priority_questions: [Q1, Q2, Q3]  # optional — IDs of questions under ### Required sub-headings
scope_recommendation: true        # optional — set by scope advisor, checked by downstream agents
---
```

#### Required frontmatter fields

| Field | Type | Description |
|---|---|---|
| `question_count` | integer | Total `### Q{n}:` headings |
| `sections` | integer | Number of `## ` section headings |
| `duplicates_removed` | integer | Duplicates eliminated during consolidation. Count each collapsed group as (n-1) |
| `refinement_count` | integer | Total R-level items. Always 0 at Step 0 |

#### Optional frontmatter fields

| Field | Type | Description |
|---|---|---|
| `status` | string | Workflow status (e.g. `pending`, `answered`) |
| `priority_questions` | list | IDs of all questions under `### Required` sub-headings. Omit only when there are no Required questions |
| `scope_recommendation` | boolean | Set by scope advisor when scope is too broad |

---

### Heading Hierarchy

```
# Research Clarifications          ← document title (H1, always this exact text)
## Section Name                    ← topic section (H2)
### Required                       ← required question group (H3, conditional)
### Q1: Short Title                ← question (H3)
### Optional                       ← optional question group (H3, conditional)
### Q3: Short Title                ← question (H3)
#### Refinements                   ← refinement container (H4, added in Step 3 — not Step 0)
##### R3.1: Refinement Title       ← refinement question (H5, added in Step 3)
##### R3.1a: Sub-refinement Title  ← sub-refinement (H5, letter suffix, added in Step 3)
```

- Each section may have `### Required`, `### Optional`, or both
- Each level nests under the previous
- `#### Refinements` and `##### R{n}.{m}:` headings are added in Step 3. Do not create them in Step 0
- Document title is always exactly `# Research Clarifications`

---

### Question Template

```markdown
### Q1: MRR Definition by Service Type
How is MRR calculated across your three service categories?

A. Managed Services MRR = recurring monthly fee. PS <12mo = TCV / engagement months.
B. Managed Services MRR = monthly fee. PS <12mo treated as one-time (excluded).
C. MRR applies only to Managed Services. All PS deals tracked as TCV.
D. Other (please specify)

_Consolidated from: Metrics Research, Segmentation Research_

**Recommendation:** A — Use recurring fee for MS; spread TCV for PS.

**Answer:**
```

#### Field-by-field spec

| Field | Format | Required | Notes |
|---|---|---|---|
| Heading | `### Q{n}: Short Title` | yes | Sequential numbering, no inline tags |
| Body text | Plain text on next line(s) | yes | Full question (heading is just short title) |
| Choices | `A. Choice text` | yes | 2–4 choices + final "Other (please specify)". Lettered with period, no label |
| Consolidated from | `_Consolidated from: ..._` | optional | Only when question draws from multiple dimensions |
| Recommendation | `**Recommendation:** Full sentence.` | yes | Between choices and answer |
| Answer | `**Answer:**` | yes | Empty until user fills in. Followed by a blank line |

#### Rules

- No `**Choices**:` label
- No checkbox syntax (`- [ ]`, `- [x]`)
- No `**(recommended)**` inline markers on choices
- No `**Question:**` label
- Every question ends with `**Answer:**` followed by a blank line

---

### Refinement Template (Step 3 — do not create in Step 0)

Shown for format compatibility reference only.

```markdown
#### Refinements

##### R1.1: Why TCV/10 for PS Projects Under 12 Months
Rationale for why this matters given the answer above...

A. 10 is a fixed company-wide assumption for average PS engagement length
B. 10 approximates billable months after excluding ramp/close
C. It varies — divisor is negotiated or set at deal level
D. Other (please specify)

**Recommendation:** A — Fixed assumption simplifies the formula.

**Answer:**
```

#### Refinement ID scheme

| Level | Format | Example | Who creates it |
|---|---|---|---|
| Top-level question | `Q{n}` | `Q1`, `Q12` | Step 0 consolidation (this step) |
| Refinement | `R{n}.{m}` | `R1.1`, `R12.2` | Step 3 |
| Sub-refinement | `R{n}.{m}{a}` | `R12.1a`, `R12.2b` | Step 3 |

Parent is embedded in the ID: `R1.1` refines **Q1**, `R12.2b` is sub-refinement of **R12.2** under **Q12**.

---

### `## Needs Clarification` Section

At end of file when contradictions or critical gaps are found.

```markdown
## Needs Clarification

### Contradiction: Pipeline Entry vs. Committed Stage
Q2 says stage beyond "Prospecting" enters pipeline. Q12 says "Proposal Sent" is the committed threshold. These may be compatible (entry != commitment) but the PM should confirm.

### Critical Gap: Win Rate Definition
Q17 is a required question (listed in priority_questions) but has no answer. This is required for skill generation.
```

---

## Complete Example (abbreviated)

```markdown
---
question_count: 8
sections: 3
duplicates_removed: 4
refinement_count: 0
priority_questions: [Q1, Q3, Q5]
---
# Research Clarifications

## Entity Model

### Required

### Q1: Customer Hierarchy Depth
How many levels does your customer hierarchy support?

A. Single level — all accounts are peers
B. Two levels — parent company and subsidiaries
C. Three or more levels — full corporate hierarchy tree
D. Other (please specify)

**Recommendation:** B — Two levels covers most enterprise use cases without excessive complexity.

**Answer:**

### Optional

### Q2: Account Type Classification
How are accounts classified by type?

A. By industry vertical only
B. By account tier (Enterprise, Mid-Market, SMB)
C. By both industry and tier
D. Other (please specify)

**Recommendation:** C — Dual classification enables richer segmentation.

**Answer:**

## Metrics

### Required

### Q3: Win Rate Definition
How is win rate calculated?

A. Closed-won / all closed opportunities
B. Closed-won / all opportunities created in period
C. Closed-won / opportunities that reached a minimum qualification stage
D. Other (please specify)

**Recommendation:** C — Qualification-stage denominator removes noise from unqualified leads.

**Answer:**
```

---

## Parser Compatibility

These exact patterns are required. Do not deviate.

| Field | Regex | Notes |
|---|---|---|
| Section heading | `^## (.+)` | Resets recommendation state |
| Question heading | `^### (Q\d+): (.+)$` | Groups: ID, title |
| Required group | `^### Required$` | Marks start of required questions within a section |
| Optional group | `^### Optional$` | Marks start of optional questions within a section |
| Refinement heading | `^##### (R\d+\.\d+[a-z]?): (.+)$` | Groups: ID, title |
| Refinement container | `^#### Refinements$` | Marks start of refinement block |
| Choice | `^([A-Z])\. (.+)$` | Groups: letter, text |
| Consolidated from | `^_Consolidated from: (.+)_$` | Group: source list |
| Recommendation | `^\*\*Recommendation:\*\*\s*(.+)$` | Group: recommendation text |
| Answer | `^\*\*Answer:\*\*\s*(.*)$` | Group: answer text (may be empty) |
| Frontmatter | `^---$` delimited YAML block | Standard YAML frontmatter |
