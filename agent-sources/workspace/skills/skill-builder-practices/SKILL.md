---
name: skill-builder-practices
description: >
  Skill structure rules, content principles, quality dimensions, and anti-patterns
  for generating data engineering skills. Use when generating, validating, refining,
  or rewriting a skill. Also use when reviewing skill quality or planning skill content.
  This skill ships with Skill Builder — do not modify name, description, or triggers.
version: 1.0.0
tools: Read, Write, Edit, Glob, Grep, Bash
trigger: >
  When working on any skill generation, validation, or refinement task,
  read and follow the skill at `.claude/skills/skill-builder-practices/SKILL.md`.
---

# Skill Builder Practices

Guidance for building data engineering skills. Users can deactivate and import a customized replacement.

## Content Principles

1. **Omit what's in Context7 or LLM training data** — standard SQL, basic dbt, general Python, official API docs. Context7 covers dbt, dlt, elementary, Fabric, GitHub Actions.
2. **Focus on domain-specific data engineering patterns** — entity/metric/rule mapping to medallion layers, Fabric/T-SQL quirks, dlt-to-dbt handoffs, elementary test placement.
3. **Guide WHAT and WHY, not HOW** — no step-by-step tutorials. Exception: be prescriptive where exactness matters (metric formulas, surrogate key macros, CI pipeline YAML).
4. **Calibrate to medallion architecture** — every data skill has a layer context (bronze/silver/gold).
5. **Bridge domain to artifacts** — domain skills must map concepts to implementable dbt models.

## Skill Structure

### Naming and Description

- Gerund names, lowercase+hyphens, max 64 chars (e.g., `building-incremental-models`)
- Description pattern: `[What it does]. Use when [triggers]. [How it works]. Also use when [more triggers].` Max 1024 chars.
- Description is third person.
- Triggers live exclusively in description frontmatter. No "When to Use This Skill" body section.
- For dbt skills, include layer-specific triggers: `Use when building dbt silver or gold layer models for [domain]. Also use when the user mentions "[domain] models", "silver layer", "gold layer", "marts", "staging", or "[domain]-specific dbt".`

### SKILL.md Anatomy

- Under 500 lines.
- Extract sections past a few paragraphs to reference files.
- Reference files one level deep. TOC for files over 100 lines.
- **Required sections:** Metadata | Overview (scope, audience, key concepts) | Quick reference | Pointers to references
- **Standards skills**: add **Getting Started** checklist (5-8 ordered steps) after Quick Reference, before Decision Dependency Map.
- **Knowledge-capture skills**: no Getting Started section.

## Purpose and Structure Patterns

The user's purpose (from user-context.md) determines the structure pattern.

### Knowledge-Capture Skills

**Purposes:** Business process knowledge, Source system customizations

Capture **questions about the customer's environment**:

- Sections are **question-oriented and parallel**
- **Zero pre-filled assertions** — all content from user answers
- No Getting Started checklist, no dependency map
- Section themes (adapt to decisions.md):
  - Business process: Metric Definitions, Segmentation Standards, Period Handling, Business Logic, Output Standards
  - Source systems: Field Semantics, Extraction Gotchas, Reconciliation Rules, Lifecycle/State, System Workarounds, API Behaviors

### Standards Skills

**Purposes:** Organization specific data engineering standards, Organization specific Azure or Fabric standards

Capture **implementation decisions with dependency ordering**:

- Sections are **decision-oriented** — choices constrain downstream sections
- Include **Getting Started** checklist (5-8 ordered steps) after Quick Reference
- Include **Decision Dependency Map**
- **Up to 5 pre-filled factual assertions** where Claude's training data is wrong
- Section themes (adapt to decisions.md):
  - Data engineering: Pattern Selection, Key/Identity Decisions, Temporal Design, Implementation Approach, Edge Cases, Performance
  - Platform: Target Architecture, Materialization, Incremental Strategy, Platform Constraints, Capacity/Cost, Testing/Deployment

### Delta Rule (all skills)

Include only what Claude would get wrong without this skill. If it's in Context7, official docs, or training data — leave it out.

### Evaluations (mandatory)

Every skill must have `evaluations.md` in the **context directory**. At least 3 scenarios:

```text
### Scenario 1: [Short name]
**Prompt**: [Exact prompt to send to Claude with this skill active]
**Expected behavior**: [What Claude should do — specific, observable]
**Pass criteria**: [1-2 measurable signals the skill is working]
```

Scenarios must be runnable, grounded (exercise different skill sections), and observable (checkable without running code).

### Output Separation

Skill output directory contains ONLY:

- `SKILL.md`
- `references/*.md`

Context-only files (`clarifications.json`, `decisions.md`, `evaluations.md`, `research-plan.md`, validation logs) go in context/.

## Quality Dimensions (scored 1-5)

- **Actionability** — could a data engineer build/modify a dbt model from this?
- **Specificity** — concrete Fabric/T-SQL details, exact macro names, real config values
- **Domain Depth** — stack-specific gotchas vs surface-level docs rehash
- **Self-Containment** — WHAT and WHY without needing external docs

## Evaluation Methodology

### Build evaluations first

Create evaluations BEFORE writing documentation:

1. **Identify gaps**: Run Claude on representative tasks without the skill. Document failures.
2. **Create evaluations**: 3+ scenarios testing these gaps.
3. **Establish baseline**: Measure without the skill.
4. **Write minimal instructions**: Just enough to pass evaluations.
5. **Iterate**: Execute, compare against baseline, refine.

### Cross-model testing

Test with:

- **Haiku**: enough guidance?
- **Sonnet**: clear and efficient?
- **Opus**: avoiding over-explaining?

## Degrees of Freedom

- **High freedom** (text instructions): multiple valid approaches.
- **Medium freedom** (pseudocode/templates): preferred pattern, some variation ok.
- **Low freedom** (exact scripts): fragile operations, exact sequence required.

Use templates for output format. Use examples for quality-dependent output.

## Content Rules

- No time-sensitive info. Consistent terminology ("Fabric" not "Synapse", "dlt" not "DLT" unless Databricks).
- Most precise where mistakes are costliest.

## Anti-patterns

### Skill structure

- Windows paths — use forward slashes
- Too many options without a clear default
- Nested reference files
- Vague descriptions ("configure your data warehouse")

### Content

- Over-explaining basic dbt/SQL
- Mixing dlt (dlthub) with Databricks DLT
- `dbt-utils` macros instead of `tsql-utils`
- "When to Use This Skill" body section
- "Questions for your stakeholder" blocks — stakeholder communication belongs in context/decisions.md
- Process artifacts in skill directory (belong in context/)

## Reference Files

- **[references/ba-patterns.md](references/ba-patterns.md)** — Domain decomposition: entity identification, metric mapping, grain decisions, business rule placement, completeness validation.
- **[references/de-patterns.md](references/de-patterns.md)** — Stack conventions and anti-patterns for dbt, dlt, elementary, Fabric, GitHub CI/CD.
