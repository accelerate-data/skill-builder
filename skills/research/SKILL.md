---
name: research
description: >
  Runs the research phase for a skill. Use when researching dimensions and producing
  clarifications for a skill type and domain. Returns a scored dimension table and
  complete clarifications.md content as inline text with === RESEARCH PLAN === and
  === CLARIFICATIONS === delimiters.
domain: Skill Builder
type: skill-builder
---

# Research Skill

## What This Skill Does

Given a `skill_type` and `domain`, this skill produces two outputs as inline text:

1. A scored dimension table (becomes `research-plan.md`)
2. Complete `clarifications.md` content in canonical format (becomes the clarifications file)

This is a **pure computation unit** — it takes inputs, returns inline text, and writes nothing to disk. It has no knowledge of context directories or file paths. The caller (orchestrator) handles all file I/O.

---

## Inputs

| Input | Values | Example |
|-------|--------|---------|
| `skill_type` | `domain` \| `platform` \| `source` \| `data-engineering` | `domain` |
| `domain` | Free text domain name | `"Sales Pipeline Analytics"` |

---

## Step 1 — Select Dimension Set

Read `references/dimension-sets.md`.

Based on `skill_type`, identify the 5–6 candidate dimensions for this skill type. The file contains four named sections (Domain Dimensions, Data-Engineering Dimensions, Platform Dimensions, Source Dimensions) each with a table of slugs and dimension names.

Note the dimension slugs — you will use them in Step 3 to locate dimension spec files at `references/dimensions/{slug}.md`.

---

## Step 2 — Score and Select (Inline, Extended Thinking)

Read `references/scoring-rubric.md`.

Use **extended thinking** for this step. Score each candidate dimension against the domain inline — do not spawn a sub-agent for this step.

### Pre-check: topic relevance

Before scoring, determine whether the domain is a legitimate topic for the skill type. If clearly not relevant (e.g., a non-data topic for any skill type), produce a `=== RESEARCH PLAN ===` section with `topic_relevance: not_relevant` and an empty selected list, then stop. Do not proceed to Steps 3 or 4.

### Scoring

For each of the 5–6 candidate dimensions, apply the rubric and follow the step-by-step instructions in `references/scoring-rubric.md`. The rubric defines scores 1–5, the scoring frame, tailored focus line guidelines, and selection criteria.

### Selection

Select the top 3–5 dimensions by score. Prefer quality of coverage over meeting an exact count.

---

## Step 3 — Parallel Dimension Research

For each selected dimension, read the full content of `references/dimensions/{slug}.md` for that dimension.

Then spawn a Task sub-agent for that dimension. Construct the Task prompt as follows:

```
You are researching the {dimension_name} dimension for a {skill_type} skill about {domain}.

{full content of references/dimensions/{slug}.md}

Tailored focus: {tailored focus line from Step 2}

Return detailed research text covering the dimension's questions and decision points for this domain. 500–800 words. Return raw research text only — no headings, no JSON, no structured format. Write as if briefing a colleague who needs to understand the key questions and tradeoffs for this dimension in the context of {domain}.
```

Wait for all Tasks to return before proceeding to Step 4.

---

## Step 4 — Consolidate

Read `references/consolidation-handoff.md`. This file contains the full `clarifications.md` format spec (frontmatter, heading hierarchy, question template, ID scheme, parser-compatibility regex patterns) and step-by-step consolidation instructions.

Follow the consolidation instructions in that file to deduplicate and synthesize all dimension Task outputs into canonical `clarifications.md` content.

---

## Return Format

Return inline text with two clearly delimited sections. The delimiter lines must be exactly as shown:

```
=== RESEARCH PLAN ===
---
skill_type: [skill_type]
domain: [domain name]
topic_relevance: relevant
dimensions_evaluated: [count]
dimensions_selected: [count]
---
# Research Plan

## Skill: [domain name] ([skill_type])

## Dimension Scores

| Dimension | Score | Reason | Companion Note |
|-----------|-------|--------|----------------|
| [slug] | [score] | [one-sentence reason] | [optional] |

## Selected Dimensions

| Dimension | Focus |
|-----------|-------|
| [slug] | [tailored focus line] |

=== CLARIFICATIONS ===
---
question_count: [n]
sections: [n]
duplicates_removed: [n]
refinement_count: 0
priority_questions: [Q1, Q3, ...]
---
# Research Clarifications

[full clarifications content]
```

The `=== RESEARCH PLAN ===` section is extracted by the orchestrator and written to `context/research-plan.md`.

The `=== CLARIFICATIONS ===` section is extracted by the orchestrator and written to `context/clarifications.md`.

Both sections must be present. Both must be well-formed per their respective canonical formats.

---

## Error Handling

**Topic not relevant**: Return `=== RESEARCH PLAN ===` with `topic_relevance: not_relevant` and an empty selected list. Return `=== CLARIFICATIONS ===` with a minimal frontmatter (`question_count: 0`, `sections: 0`, `duplicates_removed: 0`, `refinement_count: 0`, `scope_recommendation: true`) and a single section explaining the domain is not applicable for this skill type.

**Dimension Task failure**: Proceed with available outputs. Note any failed dimensions in the scored table with `score: 0` and reason `"Research task failed"`. Do not include them in selected dimensions.

**No dimensions selected**: If all dimensions score 2 or below, select the single highest-scoring dimension (score 2 at minimum) and run research for it. A clarifications file with at least some questions is better than an empty file.

---

## Output Checklist

Before returning, verify:

- Both `=== RESEARCH PLAN ===` and `=== CLARIFICATIONS ===` sections present
- Frontmatter counts accurate in both sections
- Every question has 2–4 choices + "Other (please specify)", a `**Recommendation:**`, and an `**Answer:**` field
- `priority_questions` lists all Required question IDs
- `refinement_count: 0` (refinements are added in Step 3 by `detailed-research`)
- No inline tags (`[MUST ANSWER]`) in question headings
- Format passes the Rust parser patterns in `references/consolidation-handoff.md`
