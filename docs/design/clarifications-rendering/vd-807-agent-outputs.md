# VD-807 — Agent Output Design: Numbering, Artifacts, and Responsibilities

## Clarifications Numbering Scheme

`clarifications.md` uses a hierarchical ID system that ties every item back to its origin:

### Three levels

| Level | Format | Example | Who creates it |
|---|---|---|---|
| Top-level question | `Q{n}` | `Q1`, `Q12` | **consolidate-research** (Step 1) |
| Refinement | `R{n}.{m}` | `R1.1`, `R12.2` | **detailed-research** sub-agents (Step 3) |
| Sub-refinement | `R{n}.{m}{a}` | `R12.1a`, `R12.2b` | **detailed-research** consolidation (Step 3) |

The parent is always embedded in the ID:
- `R1.1` → refinement 1 of **Q1**
- `R12.2b` → sub-refinement (b) of **R12.2**, which itself refines **Q12**

### Markdown structure

```markdown
### Q1: MRR Definition by Service Type [MUST ANSWER]
How is MRR calculated across your three service categories?

A. Managed Services MRR = recurring monthly fee. PS <12mo = TCV / engagement months.
B. Managed Services MRR = monthly fee. PS <12mo treated as one-time (excluded).
C. MRR applies only to Managed Services. All PS deals tracked as TCV.
D. Other (please specify)

_Consolidated from: Metrics Q1, Segmentation Q2, Business Rules Q5_

**Recommendation:** A — Use recurring fee for MS; spread TCV for PS.

**Answer:** Managed services is already MRR, PS projects < 12 months are total value / 10...

#### Refinements

##### R1.1: Why TCV/10 for PS Projects Under 12 Months
Rationale for why this matters given the answer above...

A. 10 is a fixed company-wide assumption for average PS engagement length
B. 10 approximates billable months after excluding ramp/close
C. It varies — divisor is negotiated or set at deal level
D. Other (please specify)

**Recommendation:** A — Fixed assumption simplifies the formula.

**Answer:** A

##### R1.2: Definition of "Year 1 Value" for PS Projects Over 12 Months
...

**Answer:** B
```

Sub-refinements follow the same pattern but are generated when a refinement answer opens another gap:

```markdown
##### R12.1: Stage Threshold for Committed Pipeline
...
**Answer:** A (specific named stage)

##### R12.1a: Which Named Stage Is the Committed Pipeline Threshold?
The PM confirmed named stage — but which one?
...
**Answer:** Proposal Sent
```

---

## Current Flow (Pre-VD-807)

```
Step 1: research-orchestrator
  └─ consolidate-research (opus) → writes clarifications.md with Q1..Qn

Step 2: Human gate — user answers questions

  ┌─ answer-evaluator (haiku) → writes answer-evaluation.json
  │   { verdict, answered_count, empty_count, vague_count, total_count }
  │   Verdict: sufficient → skip to Step 5
  │            mixed → user chooses: auto-fill & skip, or continue to Step 3
  │            insufficient → user chooses: auto-fill & skip, or answer more
  └─

Step 3: detailed-research (sonnet)
  ├─ Phase 1: Triage ALL answers from scratch (SOLID/CONTRADICTION/VAGUE/COMPLETE)
  ├─ Phase 2: Spawn sub-agents for sections with SOLID answers
  └─ Phase 3: Spawn consolidate-research (opus) → updates clarifications.md with R{n}.{m}

Step 4: Human gate — user answers refinements

Step 5: confirm-decisions (opus) → writes decisions.md from scratch
```

### Problem

When answer-evaluator returns `mixed` and the user continues to Step 3, detailed-research **re-triages everything from scratch**. The evaluator already knows which answers are clear vs unclear — detailed-research ignores that assessment and redoes the work.

---

## VD-807 Design: What Changes

### 1. answer-evaluator (Haiku) — enhanced output

**Current output** (`answer-evaluation.json`):
```json
{
  "verdict": "mixed",
  "answered_count": 15,
  "empty_count": 8,
  "vague_count": 3,
  "total_count": 26,
  "reasoning": "15 of 26 questions answered; 8 empty, 3 vague."
}
```

**New output** — adds `per_question` array using the same IDs from `clarifications.md`:
```json
{
  "verdict": "mixed",
  "answered_count": 15,
  "empty_count": 8,
  "vague_count": 3,
  "total_count": 26,
  "reasoning": "15 of 26 questions answered; 8 empty, 3 vague.",
  "per_question": [
    { "question_id": "Q1", "verdict": "clear" },
    { "question_id": "Q2", "verdict": "clear" },
    { "question_id": "Q3", "verdict": "clear" },
    { "question_id": "Q4", "verdict": "clear" },
    { "question_id": "Q5", "verdict": "clear" },
    { "question_id": "Q6", "verdict": "vague" },
    { "question_id": "Q7", "verdict": "not_answered" },
    { "question_id": "Q8", "verdict": "clear" },
    { "question_id": "Q9", "verdict": "not_answered" },
    { "question_id": "Q10", "verdict": "clear" },
    { "question_id": "Q11", "verdict": "clear" },
    { "question_id": "Q12", "verdict": "clear" },
    { "question_id": "Q13", "verdict": "not_answered" },
    { "question_id": "Q14", "verdict": "not_answered" }
  ]
}
```

**Rules** (mechanical, same as aggregate counting):
- `clear` — substantive, specific text (same as current "answered" classification)
- `not_answered` — empty or only whitespace / `(accepted recommendation)`
- `vague` — fewer than 5 words, or contains only "not sure", "default is fine", "TBD", "N/A", etc.

**No recommendations.** Haiku classifies; Sonnet interprets.

The `question_id` values match the heading IDs in `clarifications.md` (`Q1`, `Q2`, ... `Q23`). First-round evaluation runs before Step 3, so only top-level Q-numbers exist at this point — refinements (R{n}.{m}) don't exist yet.

### 2. detailed-research (Sonnet) — redesigned

Reads `answer-evaluation.json` instead of re-triaging.

#### Phase 1: Draft `decisions.md` from clear answers

For every question where `per_question[].verdict == "clear"`, write a structured draft entry:

```markdown
---
status: draft
decision_count: 12
---

### D1: MRR Calculation Formula
- **Source:** Q1
- **Section:** Core Concepts and Definitions
- **Answer:** Managed services is already MRR, PS < 12mo = TCV/10, PS > 12mo = Year 1 ACV / 12
- **Status:** draft

### D2: Committed Pipeline Signal
- **Source:** Q2
- **Section:** Core Concepts and Definitions
- **Answer:** Stage governs pipeline metrics, forecast flag governs commit calls, both tracked separately
- **Status:** draft
```

Draft entries are **structured, not reasoned** — no implications, no trade-off analysis. That's confirm-decisions' (Opus) job. Each entry records:
- The source `question_id` (e.g. `Q1`) — ties back to clarifications
- The section name
- The user's answer (verbatim or lightly summarized)
- `status: draft`

Also in Phase 1, detailed-research performs **cross-answer analysis** (which Haiku can't do):
- **Contradictions**: Two clear answers that conflict → flagged with both sides
- **Critical gaps**: `[MUST ANSWER]` questions that are `not_answered` → flagged as blocking

#### Phase 2: Spawn refinement sub-agents for non-clear items only

Group non-clear questions (`not_answered` + `vague`) by section. Spawn one sub-agent per section that has at least one non-clear item. Sections where all questions are `clear` get **no sub-agent**.

Each sub-agent receives:
- The full `clarifications.md` (for context)
- The per-question verdicts for their section (which items need refinement)
- The user's answers to clear questions in the same section (for cross-reference)

Sub-agents produce refinement questions using the canonical format:
```
Refinements for Q6:

##### R6.1: Follow-up topic
Rationale for why this matters given the answer above...

A. Choice a
B. Choice b
C. Other (please specify)

**Recommendation:** A — Reason.

**Answer:**

```

#### Phase 3: Inline consolidation into `clarifications.md`

**No separate consolidate-research agent.** With only non-clear items getting refinements, the sub-agent count is small — detailed-research does the consolidation itself:

1. Read existing `clarifications.md`
2. Insert `#### Refinements` blocks under each parent question
3. Deduplicate across sub-agents (same logic consolidate-research uses, but inline)
4. Add `## Needs Clarification` section for contradictions and critical gaps
5. Write updated `clarifications.md` in one pass

consolidate-research (Opus) is still used in **Step 1** where volume justifies a dedicated agent. Step 3 skips it.

### 3. confirm-decisions (Opus) — merge protocol

Currently writes `decisions.md` from scratch. With VD-807, it may find a draft already exists.

**On entry**, check if `decisions.md` exists:

| Scenario | Action |
|---|---|
| Draft decision **supported** by new refinement answers | Re-evaluate with full reasoning, add implications. Status → `resolved` |
| Draft decision **contradicted** by new answers | Rewrite decision based on new answer. Document the contradiction. Status → `conflict-resolved` |
| Draft decision with **no new information** | Keep item, add reasoning and implications. Status → `resolved` |
| New refinement answers **without** a corresponding draft | Create new decision entries as usual |

The draft is input, not output — confirm-decisions always produces the authoritative final file. All draft entries are re-evaluated; none are passed through unchanged.

### 4. Coordinator (SKILL.md) — minimal change

Add `answer-evaluation.json` path to the Step 3 prompt:

```
prompt: "...
  Context directory: ./<skillname>/context/
  Answer evaluation: ./<skillname>/context/answer-evaluation.json
  ..."
```

No other coordinator changes.

---

## ID Flow Across the Workflow

```
Step 1:  consolidate-research creates    Q1, Q2, ... Q23
Step 2:  user fills in                   **Answer:** fields
Gate:    answer-evaluator emits          per_question: [{ question_id: "Q1", verdict: "clear" }, ...]
Step 3:  detailed-research reads         per_question verdicts keyed by Q-numbers
         Phase 1: drafts                 D1 (source: Q1), D2 (source: Q2), ...
         Phase 2: sub-agents create      R6.1, R7.1, R9.1, ... (only for non-clear Q's)
         Phase 3: writes                 refinements into clarifications.md
Step 4:  user fills in                   **Answer:** fields for R{n}.{m}
Step 5:  confirm-decisions reads         draft decisions.md + answered refinements
         merges into final               D1 (resolved), D2 (resolved), ...
```

Every ID traces back to the original question. The `Source` field in decisions ties D-numbers to Q-numbers. Refinement R-numbers embed their parent Q-number. Sub-refinement R-numbers embed their parent R-number.

---

## Prerequisite: Canonicalize `clarifications.md` Format — RESOLVED

Completed in **VD-819** (PR #140). Was blocking VD-807 and VD-817.

Resolved 8+1 format inconsistencies between agent prompts, mock templates, E2E fixtures, and the Rust parser. Canonical spec at `canonical-format.md`. Compliance tests: plugin T1.11 (50 checks), vitest canonical-format.test.ts (124 tests), cargo test workflow (96 tests), vitest reasoning-parser.test.ts (23 tests).

### Decisions

#### 1. Answer field → `**Answer:**` (colon inside bold)

Agent prompts write `**Answer:**` (bold closes before colon). The Rust `autofill_answers` parser only matches `**Answer:**` (colon inside bold). Mock templates use `**Answer:**`.

**Decision:** `**Answer:**` is canonical. Fix agent prompts (`consolidate-research.md`, `detailed-research.md`) and all design doc examples.

#### 2. Choices → `A. Choice text` (lettered with period)

**Decision:** `A. Choice text` format. Clean, self-evident (no label needed), matches design mockups. Update mock templates (currently `- [ ] a) text`) and E2E fixture (currently `- a) text`). Agent prompts updated to specify this format.

No `**Choices**:` label needed — the `A.` / `B.` / `C.` pattern is unambiguous to both humans and parsers.

#### 3. Refinement heading → `##### R1.1: Title` (ATX level 5)

**Decision:** ATX heading `##### R1.1: Title`. Easier to parse (regex `^#####`), consistent heading hierarchy (`## section` → `### question` → `#### Refinements` → `##### refinement`). Update agent prompts (`detailed-research.md` currently specifies bold `**R1.1:**`) and mock templates.

#### 4. Recommendation field → `**Recommendation:** Full sentence.`

**Decision:** Include `**Recommendation:**` between choices and answer. Required for auto-fill (VD-782). Placed after choices, before answer. Format: `**Recommendation:** Full sentence.` (colon inside bold, matching the answer field convention).

#### 5. Question body → short heading + body text

**Decision:** `### Q1: Short Title` as the heading, question body text on the next line(s). The heading becomes the accordion card title; body text becomes expandable detail.

```markdown
### Q1: MRR Definition by Service Type [MUST ANSWER]
How is MRR calculated across your three service categories?
```

Update mock templates (currently question IS the heading) and E2E fixture (currently uses `**Question:**` label).

#### 6. Frontmatter fields → documented set

**Decision:** Canonical frontmatter fields:

```yaml
---
question_count: 26        # required — total Q-level questions
sections: 6               # required — number of ## sections
duplicates_removed: 17    # required — consolidation stat
refinement_count: 16      # required — total R-level items (0 for step 0)
status: pending           # optional — workflow status
priority_questions: [Q1, Q2, Q3]  # optional — MUST ANSWER question IDs
scope_recommendation: true        # optional — set by scope advisor, checked by downstream agents
---
```

`consolidate-research.md` spec updated to list all fields. `scope_recommendation` documented as valid (already checked by Scope Recommendation Guard protocol).

#### 7. Rust autofill parser → add `###` heading reset

**Decision:** Add `###` heading reset to `autofill_answers` so recommendations don't bleed between questions in the same `##` section. Add a unit test for this case.

#### 8. Draft decisions.md → contradiction and critical gap statuses

**Decision:** Add two new status values for draft entries:

```markdown
### D13: [Critical Gap] Win Rate Definition
- **Source:** Q17
- **Section:** Metrics and Calculations
- **Answer:** (not answered)
- **Status:** critical-gap
- **Note:** This is a [MUST ANSWER] question required for skill generation.

### D14: [Contradiction] Pipeline Entry vs. Committed Stage
- **Source:** Q2, Q12
- **Section:** Cross-cutting
- **Answer (Q2):** Stage beyond "Prospecting" enters pipeline
- **Answer (Q12):** "Proposal Sent" is the committed threshold
- **Status:** contradiction
- **Note:** Q2 implies early-stage entry; Q12 implies late-stage commitment. These may be compatible (entry ≠ commitment) but the PM should confirm.
```

### Canonical format reference

Authoritative spec: `docs/design/clarifications-rendering/canonical-format.md`. All agent prompts, mock templates, E2E fixtures, and parsers are aligned and validated by compliance tests.

---

## Open Design Questions

Surfaced during review. To be resolved before or during implementation of VD-807.

### 1. Second-pass evaluator and R-numbers

The answer-evaluator currently runs once before Step 3, when only Q-numbers exist. After Step 4 (user answers refinements), does the evaluator run again before Step 5? If so, `per_question` must handle R-numbers (`R1.1`, `R12.1a`), not just Q-numbers.

**Options:**
- **A.** Evaluator runs once (before Step 3 only). Step 5 always runs confirm-decisions regardless of refinement answer quality.
- **B.** Evaluator runs again after Step 4, extending `per_question` to include R-numbers. This lets confirm-decisions skip fully-clear refinements.

Option A is simpler and probably sufficient — confirm-decisions (Opus) can handle all refinement answers without pre-filtering.

### 2. Phase 2 sub-agent threshold

Currently: "spawn one sub-agent per section with at least one non-clear item." If a section has a single vague answer, the overhead of a sub-agent (prompt construction, SDK round-trip, response parsing) may exceed the benefit.

**Options:**
- **A.** No threshold — spawn a sub-agent even for 1 item. Simpler logic, consistent behavior.
- **B.** Minimum 2 non-clear items per section to justify a sub-agent. Single items handled inline by detailed-research.

Option A is recommended — the sub-agent overhead is small relative to the quality gain, and adding thresholds creates branching logic with edge cases.

### 3. Confirm-decisions partial support/contradiction

The merge protocol has 4 clean scenarios. A fifth case exists: a draft decision where the refinement answer _partially_ supports and _partially_ changes the draft (e.g., user confirms the main approach but changes a parameter value).

**Recommendation:** Treat as "supported" — re-evaluate with full reasoning, note the parameter change in the implication. The `resolved` status covers this. Only use `conflict-resolved` when the refinement answer genuinely contradicts the draft's core premise.
