# Canonical Workflow Artifact Formats

Authoritative format spec for all artifacts produced and consumed during the skill-builder workflow. This is the agent ↔ app contract: what agents write and what the app expects to parse.

---

# Canonical `clarifications.md` Format

Written by the research skill (via `research-orchestrator`, Step 0). Updated in-place by `detailed-research` (Step 3). Read by `answer-evaluator`, `detailed-research`, and `confirm-decisions`.

---

## YAML Frontmatter

```yaml
---
question_count: 26        # required — total Q-level questions
sections: 6               # required — number of ## sections
duplicates_removed: 17    # required — consolidation stat
refinement_count: 16      # required — total R-level items (0 for step 0)
status: pending           # optional — workflow status
priority_questions: [Q1, Q2, Q3]  # optional — IDs of questions under ### Required sub-headings
scope_recommendation: true        # optional — set by scope advisor, checked by downstream agents
---
```

### Required fields

| Field | Type | Description |
|---|---|---|
| `question_count` | integer | Total number of top-level Q-questions |
| `sections` | integer | Number of `## ` section headings |
| `duplicates_removed` | integer | Number of duplicates eliminated during consolidation |
| `refinement_count` | integer | Total R-level refinement items (0 before Step 3) |

### Optional fields

| Field | Type | Description |
|---|---|---|
| `status` | string | Workflow status (e.g. `pending`, `answered`) |
| `priority_questions` | list | IDs of questions under `### Required` sub-headings |
| `scope_recommendation` | boolean | Set by scope advisor; checked by Scope Recommendation Guard |

---

## Heading Hierarchy

```
# Research Clarifications          ← document title (H1)
## Section Name                    ← topic section (H2)
### Required                       ← required question group (H3, conditional)
### Q1: Short Title                ← question (H3)
### Optional                       ← optional question group (H3, conditional)
### Q3: Short Title                ← question (H3)
#### Refinements                   ← refinement container (H4)
##### R3.1: Refinement Title       ← refinement question (H5)
##### R3.1a: Sub-refinement Title  ← sub-refinement (H5, letter suffix)
```

Each section may have only `### Required`, only `### Optional`, or both. These sub-headings are conditional.

Each level nests under the previous. The `#### Refinements` heading appears only when a question has refinements.

---

## Question Template

```markdown
### Q1: MRR Definition by Service Type
How is MRR calculated across your three service categories?

A. Managed Services MRR = recurring monthly fee. PS <12mo = TCV / engagement months.
B. Managed Services MRR = monthly fee. PS <12mo treated as one-time (excluded).
C. MRR applies only to Managed Services. All PS deals tracked as TCV.
D. Other (please specify)

_Consolidated from: Metrics Q1, Segmentation Q2, Business Rules Q5_

**Recommendation:** A — Use recurring fee for MS; spread TCV for PS.

**Answer:**
```

### Field-by-field spec

| Field | Format | Required | Notes |
|---|---|---|---|
| Heading | `### Q{n}: Short Title` | yes | No inline tags. Required vs optional is indicated by the preceding `### Required` / `### Optional` sub-heading |
| Body text | Plain text on next line(s) | yes | The full question; heading is just a short title |
| Choices | `A. Choice text` | yes | 2-4 choices + `D. Other (please specify)`. Lettered with period, no label needed |
| Consolidated from | `_Consolidated from: ..._` | optional | Italicized, only on first-round consolidated questions |
| Recommendation | `**Recommendation:** Full sentence.` | yes | Between choices and answer. Colon inside bold |
| Answer | `**Answer:**` | yes | Colon inside bold. Empty until user fills in. Followed by a blank line |

### Rules

- No `**Choices**:` label. The `A.` / `B.` / `C.` pattern is self-evident.
- No checkbox syntax (`- [ ]`, `- [x]`). Just `A. text`.
- No `**(recommended)**` inline markers on choices. Recommendations go in the `**Recommendation:**` field.
- No `**Question:**` label. The question body is plain text after the heading.
- Every question ends with `**Answer:**` followed by a blank line (even if unanswered).

---

## Refinement Template

Refinements appear under a `#### Refinements` heading within their parent question block.

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

##### R1.2: Definition of "Year 1 Value" for PS Projects Over 12 Months
For PS projects longer than 12 months, how is "Year 1 value" defined?

A. First 12 months of contracted revenue
B. Annual contract value (ACV) regardless of term length
C. Other (please specify)

**Recommendation:** A — First 12 months is the most common convention.

**Answer:**
```

### Refinement ID scheme

| Level | Format | Example | Who creates it |
|---|---|---|---|
| Top-level question | `Q{n}` | `Q1`, `Q12` | research skill (Step 0) |
| Refinement | `R{n}.{m}` | `R1.1`, `R12.2` | detailed-research (Step 3) |
| Sub-refinement | `R{n}.{m}{a}` | `R12.1a`, `R12.2b` | detailed-research (Step 3) |

The parent is always embedded in the ID:
- `R1.1` → refinement 1 of **Q1**
- `R12.2b` → sub-refinement (b) of **R12.2**, which itself refines **Q12**

---

## Sub-refinement Template

Sub-refinements use the same `#####` heading level and follow the same format. They are generated when a refinement answer opens another gap.

```markdown
##### R12.1: Stage Threshold for Committed Pipeline
What pipeline stage marks "committed"?

A. Specific named stage (e.g. Proposal Sent, Negotiation)
B. Any stage after qualification
C. Forecast flag, not stage-based
D. Other (please specify)

**Recommendation:** A — Named stage gives the clearest threshold.

**Answer:** A (specific named stage)

##### R12.1a: Which Named Stage Is the Committed Pipeline Threshold?
The PM confirmed named stage — but which one?

A. Proposal Sent
B. Negotiation
C. Verbal Commit
D. Other (please specify)

**Recommendation:** A — Proposal Sent is the most common threshold.

**Answer:**
```

---

## `## Needs Clarification` Section

Appears at the end of the file when contradictions or critical gaps are found.

```markdown
## Needs Clarification

### Contradiction: Pipeline Entry vs. Committed Stage
Q2 says stage beyond "Prospecting" enters pipeline. Q12 says "Proposal Sent" is the committed threshold. These may be compatible (entry != commitment) but the PM should confirm.

### Critical Gap: Win Rate Definition
Q17 is a required question (listed in priority_questions) but has no answer. This is required for skill generation.
```

---

# Canonical `decisions.md` Format

Written by `confirm-decisions` (Step 5). Read by `generate-skill` and `validate-skill`.

---

## YAML Frontmatter

```yaml
---
decision_count: 12          # required — total D-level decisions
conflicts_resolved: 2       # required — number of conflict-resolved decisions
round: 1                    # required — iteration count (1 for first pass)
contradictory_inputs: true  # optional — set ONLY when answers are logically incompatible
scope_recommendation: true  # optional — set when scope is too broad (stub file)
---
```

### Required fields

| Field | Type | Description |
|---|---|---|
| `decision_count` | integer | Total number of `### D{N}:` decision entries |
| `conflicts_resolved` | integer | Count of decisions with `status: conflict-resolved` |
| `round` | integer | Iteration number (1 on first write, incremented on re-analysis) |

### Optional fields

| Field | Type | Description |
|---|---|---|
| `contradictory_inputs` | boolean | Set `true` only when user answers are logically incompatible — not just different approaches |
| `scope_recommendation` | boolean | Set `true` in the stub file when scope is too broad |

---

## Decision Entry Template

```markdown
### D1: Customer Hierarchy Depth
- **Original question:** How many levels should the customer hierarchy support?
- **Decision:** Two levels — parent company and subsidiary
- **Implication:** Need a self-referencing FK in dim_customer; gold layer aggregates must roll up at both levels
- **Status:** resolved
```

### Field-by-field spec

| Field | Format | Required | Notes |
|---|---|---|---|
| Heading | `### D{N}: Title` | yes | H3, D-numbered sequentially |
| Original question | `- **Original question:** text` | yes | Source question text (verbatim or summarized) |
| Decision | `- **Decision:** text` | yes | What was decided |
| Implication | `- **Implication:** text` | yes | Design/engineering consequence |
| Status | `- **Status:** value` | yes | One of: `resolved`, `conflict-resolved`, `needs-review` |

### Status values

| Value | When to use |
|---|---|
| `resolved` | Clean answer, direct derivation |
| `conflict-resolved` | Contradiction detected, agent picked most reasonable option with documented reasoning |
| `needs-review` | Ambiguous or insufficient information for a confident decision |

### Rules

- All field labels use `**Field:**` (colon inside bold), matching the clarifications convention.
- Every answered question (first-round and refinements) produces at least one decision with an implication.
- Contradictions are resolved with reasoning in the `**Implication:**` field — user reviews and can override.
- File is a clean snapshot, not a log — written from scratch each time.

---

## Scope Recommendation Stub

When the scope is too broad, `confirm-decisions` writes a minimal stub instead of decisions:

```markdown
---
scope_recommendation: true
decision_count: 0
---
## Scope Recommendation Active

The research planner determined the skill scope is too broad. See `clarifications.md` for recommended narrower skills. No decisions were generated.
```

---

# Canonical `research-plan.md` Format

Written by the research skill (via `research-orchestrator`, Step 0). Read by `companion-recommender` (Step 7). Rendered as markdown in the UI.

## YAML Frontmatter

```yaml
---
skill_type: domain                    # required — skill type
domain: Sales Pipeline                # required — domain name
topic_relevance: relevant             # required — "relevant" or "not_relevant"
dimensions_evaluated: 6               # required — total dimensions scored
dimensions_selected: 4                # required — dimensions chosen for research
---
```

## Structure

```markdown
# Research Plan

## Skill: [domain name] ([skill_type])

## Dimension Scores

| Dimension | Score | Reason | Companion Note |
|-----------|-------|--------|----------------|
| [slug] | [1-5] | [one-sentence] | [optional — for scores 2-3] |

## Selected Dimensions

| Dimension | Focus |
|-----------|-------|
| [slug] | [tailored focus line] |
```

---

# Canonical `test-skill.md` Format

Written by `validate-skill` orchestrator (Step 7). Rendered as markdown in the UI.

## YAML Frontmatter

```yaml
---
test_date: 2026-01-01        # required — ISO date
total_tests: 5                # required — total test count
passed: 4                     # required — PASS count
partial: 1                    # required — PARTIAL count
failed: 0                     # required — FAIL count
scope_recommendation: true    # optional — stub indicator
---
```

## Structure

```markdown
# Skill Test Report

## Summary
- **Total**: 5 | **Passed**: 4 | **Partial**: 1 | **Failed**: 0

## Test Results

### Test 1: [Prompt text]
- **Category**: [category] | **Result**: PASS | PARTIAL | FAIL
- **Skill coverage**: [evidence from skill files]
- **Gap**: [what's missing, or "None"]

## Skill Content Issues
### Uncovered Topic Areas
### Vague Content Needing Detail
### Missing SKILL.md Pointers

## Suggested PM Prompts
```

---

# Canonical `agent-validation-log.md` Format

Written by `validate-skill` orchestrator (Step 7). Rendered as markdown in the UI. No YAML frontmatter (unless scope recommendation stub).

## Structure

```markdown
# Validation Log

## Structural Checks
- [PASS] Check description
- [FAIL] Check description — details

## Content Quality Checks
### [filename]
- Actionability: N/5 — description
- Specificity: N/5 — description

## Decision Coverage
- D1 (Title): Covered in [file:section]
- D8 (Title): Not deeply covered (minor gap)

## Issues Found
- N critical issues
- N minor gaps
- N items auto-fixed

## Summary
[One-sentence verdict]
```

---

# Canonical `companion-skills.md` Format

Written by `validate-skill` orchestrator (Step 7). YAML frontmatter parsed programmatically by the app; markdown body rendered in the UI.

## YAML Frontmatter

```yaml
---
skill_name: sales-pipeline
skill_type: domain
companions:
  - name: Salesforce Extraction
    slug: salesforce-extraction
    type: source
    dimension: field-semantics
    dimension_score: 3
    priority: high
    reason: "Description of why this companion is needed"
    trigger_description: "When to use this companion skill"
    template_match: null
---
```

### Companion entry fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Human-readable companion name |
| `slug` | string | yes | Kebab-case identifier |
| `type` | string | yes | `domain`, `source`, `platform`, or `data-engineering` |
| `dimension` | string | yes | Research dimension slug this companion covers |
| `dimension_score` | integer | yes | Score from research planner (2-3 range) |
| `priority` | string | yes | `high`, `medium`, or `low` |
| `reason` | string | yes | Why this companion is needed |
| `trigger_description` | string | yes | When an engineer should use it |
| `template_match` | string/null | yes | Matched template slug, or null |

## Markdown Body

```markdown
# Companion Skill Recommendations

## 1. [Name] ([type] skill)

**Priority**: [High/Medium/Low] | **Dimension**: [slug] (score: N)

**Why**: [Reason text]

**Suggested trigger**: [Trigger description]

**Template match**: [Match or "No matching template found"]
```

---

# Canonical `user-context.md` Format

Generated at runtime by Rust (desktop app) or by the plugin coordinator's Scoping phase, written to the workspace directory (`~/.vibedata/{skill-name}/`) so agents can read it. Source data: user settings and intake/scoping answers.

## Structure

```markdown
# User Context
- **Industry**: Financial Services
- **Function**: Analytics Engineering
- **Target Audience**: Intermediate data engineers
- **Key Challenges**: Complex SCD patterns, late-arriving dimensions
- **Scope**: Silver and gold layer modeling
- **What Makes This Setup Unique**: Multi-region Snowflake deployment
- **What Claude Gets Wrong**: Assumes single-tenant architecture
```

### Rules

- All fields use `- **Label**: value` format (dash, bold label, colon inside bold, value)
- Fields are only included if the user provided a non-empty value
- The heading is always `# User Context` (H1)
- If no fields have values, the file is not written

---

# Canonical `answer-evaluation.json` Format

Written by `answer-evaluator`. Runs at two gates: after Step 2 (Q-level answers) and after Step 4 (Q-level and R-level answers). Read by the app and by `detailed-research`.

## JSON Schema

```json
{
  "verdict": "sufficient",
  "answered_count": 8,
  "empty_count": 0,
  "vague_count": 0,
  "total_count": 8,
  "reasoning": "All 8 questions have detailed, specific answers.",
  "per_question": [
    { "question_id": "Q1", "verdict": "needs_refinement" },
    { "question_id": "Q2", "verdict": "clear" }
  ]
}
```

### Field spec

| Field | Type | Required | Values |
|---|---|---|---|
| `verdict` | string | yes | `"sufficient"`, `"mixed"`, `"insufficient"` |
| `answered_count` | integer | yes | Count of substantive answers (`clear` + `needs_refinement`) |
| `empty_count` | integer | yes | Count of empty/whitespace answers |
| `vague_count` | integer | yes | Count of vague answers (<5 words, "TBD", etc.) |
| `total_count` | integer | yes | Total question count |
| `reasoning` | string | yes | Single sentence explaining the verdict |
| `per_question` | array | yes | Array of `{ question_id: string, verdict: string }` objects. Verdict values: `"clear"`, `"needs_refinement"`, `"not_answered"`, `"vague"` |

### Rules

- `answered_count + empty_count + vague_count == total_count` (where `answered_count` includes both `clear` and `needs_refinement`)
- `verdict` logic: `sufficient` when all answered, `insufficient` when none answered, `mixed` otherwise
- Output must be valid JSON with no markdown fences or extra text

---

# Canonical `logs/{step}-{timestamp}.jsonl` Format

Written by the Rust sidecar layer (`sidecar_pool.rs`) for every agent run. Stored at `{workspace}/{skill-name}/logs/`. Not read by agents — used for debugging and observability.

## Filename

```
{step-label}-{timestamp}.jsonl
```

- `step-label` — derived from the agent ID (e.g. `step0`, `step2`, `step4`, `step5`)
- `timestamp` — local time in `YYYY-MM-DDTHH-MM-SS` format

## Format

One JSON object per line (JSONL). The file is **not** valid JSON as a whole.

**Line 1** — request config (written before the agent runs):

```json
{
  "prompt": "The domain is: ...",
  "model": "claude-sonnet-4-5-20250929",
  "apiKey": "[REDACTED]",
  "cwd": "/Users/alice/.vibedata",
  "allowedTools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task", "Skill"],
  "maxTurns": 50,
  "permissionMode": "bypassPermissions",
  "sessionId": null,
  "agentName": "research-orchestrator"
}
```

`apiKey` is always redacted. All other fields are included as sent to the SDK.

**Lines 2+** — raw SDK stdout events, one per line. Each line is a JSON object emitted by the `@anthropic-ai/claude-agent-sdk`. Common event shapes:

```json
{ "type": "assistant", "message": { "content": [...] } }
{ "type": "tool_use", "name": "Read", "input": { "file_path": "..." } }
{ "type": "tool_result", "content": "..." }
{ "type": "result", "subtype": "success", "total_cost": 0.042 }
```

## Rules

- Line 1 is always the config object; agent output begins at line 2.
- The file is created before the agent runs; if the agent fails to start, line 1 may be the only content.
- Transcripts are non-fatal: if the log file cannot be created, the agent still runs.
