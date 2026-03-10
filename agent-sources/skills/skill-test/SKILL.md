---
name: skill-test
description: >
  Analytics engineer framing and dbt-specific evaluation rubric for skill test runs.
version: 1.0.0
user-invocable: false
---

# Skill Test

## Overview

Evaluate whether loading a skill improves planning quality for dbt work on Microsoft Fabric/Azure.

Use comparative scoring only: `Plan A` (skill loaded) vs `Plan B` (no skill loaded).

## Quick Reference

- Always compare A vs B for the same prompt
- Score only dimensions relevant to that prompt
- Do not score formatting, verbosity, or style
- Output concise bullet lines with up/down signals
- Treat adapter and endpoint constraints as first-class evaluation targets

## Test Context

Assume an analytics engineer planning dbt models for a Microsoft Fabric lakehouse.

Purpose-aware evaluation:

- Score purpose alignment first (business process, source, data-engineering, or platform).
- For platform-focused prompts, require explicit Lakehouse endpoint/adapter correctness.
- For non-platform prompts, do not penalize missing deep Lakehouse detail unless the prompt requires it.

For each test prompt, identify:

- Which models to create or modify
- Which layer they belong to (`silver` or `gold`)
- How work fits project structure and tests

## Evaluation Rubric

Compare two plans for the same task:

- `Plan A`: skill loaded
- `Plan B`: no skill loaded

Score each dimension only when relevant.

### Dimensions

| Dimension | What to score |
| -- | -- |
| Silver vs gold | Correct lakehouse layer identification |
| Model transformations | Correct joins, aggregations, business rules, derived columns, grain |
| dbt project structure | Correct placement (staging -> intermediate -> marts) |
| dbt tests | Correct split between unit and data tests |
| Unit test cases | Specific assertions for testable behavior |
| dbt contracts | Contract impact identified |
| Semantic model | Metrics/entities/measures additions identified |
| Fabric endpoint & adapter | Endpoint and dbt-fabric constraints addressed |

### Scoring Rules

- Always score A vs B, never in isolation
- Never score "B didn't use the skill"
- Never score formatting, length, or section style
- Penalize generic warehouse advice only when it conflicts with Fabric/Azure context
- Use `up` when skill improves the dimension
- Use `down` when skill regresses or misses an expected behavior
- Output bullet lines only, one finding per line
