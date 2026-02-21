---
name: skill-builder-practices
description: >
  Skill structure rules, content principles, quality dimensions, and anti-patterns
  for generating data engineering skills. Use when generating, validating, refining,
  or rewriting a skill. Also use when reviewing skill quality or planning skill content.
  This skill ships with Skill Builder — do not modify name, description, or triggers.
trigger: >
  When working on any skill generation, validation, or refinement task,
  read and follow the skill at `.claude/skills/skill-builder-practices/SKILL.md`.
---

# Skill Builder Practices

Guidance for building effective data engineering skills. Agents reference this during generation, validation, and refinement. Users can deactivate this skill and import a customized replacement.

## Content Principles

1. **Omit what's already in Context7 or LLM training data** — standard SQL syntax, basic dbt commands, general Python, official API docs and data model references. Context7 provides current docs for dbt, dlt, elementary, Fabric, and GitHub Actions — don't duplicate it. Test: "Would Claude get this from Context7 + its training data?"
2. **Focus on domain-specific data engineering patterns** — how the domain's entities, metrics, and business rules map to medallion layers. Also: Fabric/T-SQL quirks, dlt-to-dbt handoff patterns, elementary test placement. These are where LLMs consistently fail.
3. **Guide WHAT and WHY, not HOW** — "Silver models need lookback windows for late-arriving data because..." not step-by-step dbt tutorials. Exception: be prescriptive when exactness matters (metric formulas, surrogate key macros, CI pipeline YAML).
4. **Calibrate to the medallion architecture** — every data skill has a layer context (bronze/silver/gold). Content should address the right layer's constraints and patterns.
5. **Translate domain knowledge into data engineering artifacts** — skills about business domains must bridge domain concepts to implementable dbt models, not just explain the domain.

## Skill Structure

### Naming and Description

- Gerund names, lowercase+hyphens, max 64 chars (e.g., `building-incremental-models`)
- Description follows the trigger pattern: `[What it does]. Use when [triggers]. [How it works]. Also use when [more triggers].` Max 1024 chars.
- Description is third person — injected into the system prompt.
- Trigger conditions live exclusively in the description frontmatter. Do NOT create a "When to Use This Skill" body section — it duplicates the description and wastes context budget.
- For dbt skills, include layer-specific triggers so the skill activates when users ask about silver/gold work: `Use when building dbt silver or gold layer models for [domain]. Also use when the user mentions "[domain] models", "silver layer", "gold layer", "marts", "staging", or "[domain]-specific dbt".`

### SKILL.md Anatomy

- Under 500 lines — concise enough to answer simple questions without loading references.
- If a section grows past a few paragraphs, extract to a reference file.
- Reference files one level deep. TOC for files over 100 lines.
- **Required sections:** Metadata (name, description) | Overview (scope, audience, key concepts — no trigger restatement) | Quick reference (top guidance) | Pointers to references (what each file covers, when to read it)
- **Decision Architecture skills** (Platform, Data Engineering): add a **Getting Started** checklist (5-8 ordered steps) after Quick Reference and before the Decision Dependency Map. Walk a first-time user through the decision sequence.
- **Interview Architecture skills** (Source, Domain): no Getting Started section — their sections are parallel and order-independent.

### Evaluations (mandatory)

Every skill must include `references/evaluations.md` with at least 3 evaluation scenarios:

```
### Scenario 1: [Short name]
**Prompt**: [Exact prompt to send to Claude with this skill active]
**Expected behavior**: [What Claude should do — specific, observable]
**Pass criteria**: [1-2 measurable signals the skill is working]
```

Scenarios must be runnable, grounded (exercise different skill sections), and observable (checkable without running code).

### Output Separation

The skill output directory must contain ONLY:
- `SKILL.md`
- `references/*.md` (including `evaluations.md`)

Never write to the skill output directory:
- `clarifications.md`, `decisions.md`, `research-plan.md` — these belong in context/
- Validation logs, test output, or companion recommendations
- Any file whose purpose is process documentation rather than skill content

## Quality Dimensions (scored 1-5)

- **Actionability** — could a data engineer build/modify a dbt model, dlt pipeline, or CI workflow from this?
- **Specificity** — concrete Fabric/T-SQL details, exact macro names, real config values vs "configure your warehouse"
- **Domain Depth** — stack-specific gotchas vs surface-level docs rehash
- **Self-Containment** — WHAT and WHY without needing Fabric docs or dlt source code

## Evaluation Methodology

### Build evaluations first

Create evaluations BEFORE writing extensive documentation. This ensures the skill solves real problems:

1. **Identify gaps**: Run Claude on representative tasks without the skill. Document failures.
2. **Create evaluations**: Build 3+ scenarios that test these gaps.
3. **Establish baseline**: Measure performance without the skill.
4. **Write minimal instructions**: Just enough to pass evaluations.
5. **Iterate**: Execute evaluations, compare against baseline, refine.

### Cross-model testing

Skills act as additions to models — effectiveness depends on the underlying model. Test with:
- **Haiku** (fast, economical): Does the skill provide enough guidance?
- **Sonnet** (balanced): Is the skill clear and efficient?
- **Opus** (powerful reasoning): Does the skill avoid over-explaining?

## Degrees of Freedom

Match specificity to task fragility:
- **High freedom** (text-based instructions): Multiple approaches valid, decisions depend on context.
- **Medium freedom** (pseudocode/templates): Preferred pattern exists, some variation acceptable.
- **Low freedom** (exact scripts): Operations fragile, consistency critical, specific sequence required.

Use templates for output format. Use examples for quality-dependent output.

## Content Rules

- No time-sensitive info. Consistent terminology ("Fabric" not "Synapse", "dlt" not "DLT" unless Databricks).
- Match specificity to fragility — be most precise where mistakes are costliest.

## Anti-patterns

### Skill structure
- Windows paths — always use forward slashes
- Too many options without a clear default
- Nested reference files (keep one level deep from SKILL.md)
- Vague descriptions like "configure your data warehouse"

### Content
- Over-explaining basic dbt/SQL that Claude already knows
- Mixing dlt (dlthub) with Databricks DLT terminology
- Generating `dbt-utils` macros instead of `tsql-utils`
- "When to Use This Skill" body section — triggers belong exclusively in description frontmatter
- "Questions for your stakeholder" blocks — skill files are consumed by Claude at runtime; stakeholder communication belongs in context/decisions.md
- Process artifacts in the skill directory (clarifications.md, decisions.md, research-plan.md, validation logs belong in context/)

## Reference Files

For deeper guidance on specific aspects:

- **[references/ba-patterns.md](references/ba-patterns.md)** — Domain decomposition methodology: how to translate business domains into data engineering artifacts. Entity identification, metric mapping, grain decisions, business rule placement, completeness validation.
- **[references/de-patterns.md](references/de-patterns.md)** — Stack conventions and anti-patterns for dbt, dlt, elementary, Microsoft Fabric, and GitHub CI/CD. The hard-to-find knowledge that improves every skill.
