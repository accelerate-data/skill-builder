---
name: research
description: >
  ALWAYS use this skill when producing clarification questions for any skill-building purpose (domain, source,
  data-engineering, platform). Invoke immediately in the research phase: score candidate dimensions, select top
  dimensions, run parallel dimension research, and return the complete clarifications.json payload. Do not attempt to
  produce clarifications without using this skill.
user_invocable: false
---

# Research Skill

## Overview

Given a `purpose`, produce clarification questions to be answered by the user to create a skill fit for purpose for Vibedata.

Always apply the purpose-aware lens:

- Prioritize the selected purpose dimension set first.
- If purpose is `platform` or `data-engineering` enforce Lakehouse-first constraints explicitly.
- For other purposes include Lakehouse constraints only when they materially change design, risk, or validation.
- Avoid generic warehouse guidance and do not include any guidance that conflicts with Fabric Lakehouse, dbt Core or Azure context.

### Purpose → Dimension Set Mapping

| Purpose (label or token) | Dimension set |
| --- | --- |
| Business process knowledge (`domain`) | Domain Dimensions |
| Source system customizations (`source`) | Source Dimensions |
| Organization specific data engineering standards (`data-engineering`) | Data-Engineering Dimensions |
| Organization specific Azure or Fabric standards (`platform`) | Platform Dimensions |

## Quick Reference

- Resolve `purpose` to one dimension set from `references/dimension-sets.md`
- Score all candidate dimensions using `references/scoring-rubric.md`
- Emit scope recommendation output when rubric `topic_relevance` is `not_relevant`.
- Select top 3-5 dimensions when viable.
- Run parallel sub-agent research for selected dimensions
- Consolidate using `references/consolidation-handoff.md`
- Validate final payload against `references/schemas.md`
- Return the canonical `clarifications.json` object as top-level JSON

## Step 1 — Select Dimension Set

Read `references/dimension-sets.md` and select the matching section.

## Step 2 — Score dimensions

Use the `references/scoring-rubric.md` to produce scoring-only JSON for all candidate dimensions.
Use that scoring JSON to construct `metadata.research_plan` which is part of clarifications.json and schema defined in `references/schemas.md`.

- Set `topic_relevance` from scoring JSON (`relevant|not_relevant`).
- Set `dimensions_evaluated` from the count of entries in the candidate_dimension_scores array in scoring JSON
- Set `dimension_scores` from `candidate_dimension_scores` (`name`, `score`, `reason`, `focus`, `companion_skill`).
- If `topic_relevance` is `not_relevant`, return canonical minimal/scope-recommendation clarifications output per `references/schemas.md` with:
  - `metadata.scope_recommendation: true`
  - `metadata.warning.code: "all_dimensions_low_score"`
  - `metadata.warning.message`: concise explanation for UI
  - `metadata.research_plan` present and schema-valid with minimal values per `references/schemas.md` Scope/Error Minimal Output (including `topic_relevance: "not_relevant"`, zero counts, and empty selected arrays)
  - zero selected dimensions.

## Step 3 - Select dimensions for research

Apply these only when `topic_relevance` is `relevant`.

- Select top 3-5 dimensions by score.
- Prefer coverage quality over exact count.
- Prefer dimensions scored 4-5.
- Include score = 3 dimensions only when needed for minimum viable coverage.

Update the `metadata.research_plan` created in Step 2.

- Set `selected_dimensions` as an array of `{ name, focus }` objects copied from the selected `dimension_scores` entries.
- Set accurate counts `dimensions_selected`.

## Step 4 — Parallel Dimension Research

For each selected dimension object in `metadata.research_plan.selected_dimensions`:

- Read the dimension spec file `references/dimensions/{name}.md` (use the selected object's `name` field as the slug)
- Spawn one Task sub-agent per selected dimension
- Include in the sub-agent prompt: the full content of the dimension spec file, the full user context, and the tailored focus line from `metadata.research_plan.selected_dimensions`
- Require raw research text only (500-800 words)

Wait for all tasks before consolidation.

## Step 5 — Consolidate

Use `references/consolidation-handoff.md` to produce canonical `clarifications.json` and return.

### Output Contract

Return only the canonical clarifications JSON object as top-level output (no wrappers and no additional text).

Before returning:

- Validate against `references/schemas.md` exactly.
- Ensure `metadata.research_plan` is present and schema-valid.
- Ensure `metadata.research_plan.selected_dimensions` is present as `{ name, focus }` objects aligned to selected dimensions.
- Preserve note separation (`notes` vs `answer_evaluator_notes`).
- Keep warning/error channels separate (`metadata.warning` and `metadata.error`).

All-low-scores behavior:

- If `topic_relevance` is `not_relevant`, emit the minimal scope-recommendation payload from `references/schemas.md` with `metadata.scope_recommendation: true` and no dimension fan-out.

Runtime resilience:

- If a dimension task fails, score that dimension as `1` with reason `Research task failed`, then continue with available results.
