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

## Overview

Use this skill to keep generated skills concise, decision-oriented, and reusable.

Audience:

- Agents creating or updating data engineering skills
- Agents validating skill quality and structure

Core model:

- Put trigger logic in frontmatter description
- Keep SKILL.md concise and move details to references
- Include only knowledge Claude is likely to get wrong without this skill

## Quick Reference

- Keep `SKILL.md` under 500 lines
- Keep references one level deep from `SKILL.md`
- Avoid duplicating official docs or common training-data knowledge
- Match specificity to failure risk (degrees of freedom)
- Enforce the four quality dimensions at score >= 4
- Keep process artifacts in `context/`, not skill output

## Getting Started

1. Identify the skill purpose from `user-context.md` and classify as standards or knowledge-capture.
2. Define trigger behavior in frontmatter `description` using concrete usage phrases.
3. Draft `Overview` and `Quick Reference` with only high-signal constraints.
4. Map required sections from this skill and create reference files for long content.
5. Add only domain-specific guidance that Claude would likely miss without the skill.
6. Validate against Actionability, Specificity, Domain Depth, and Self-Containment.
7. Remove redundant explanations, process artifacts, and non-essential text before finalizing.

## Decision Dependency Map

1. Purpose classification: standards vs knowledge-capture
2. Structure pattern: decision-oriented vs question-oriented
3. Section inventory: required sections and reference split
4. Content detail level: enforce delta rule + degrees of freedom
5. Final quality gate: score all dimensions, then trim for concision

## Content Principles

1. Omit what's in Context7 or common training data (basic SQL/dbt/Python and official API docs).
2. Focus on domain-specific data engineering patterns and stack-specific gotchas.
3. Guide WHAT and WHY, not tutorials for basic mechanics.
4. Calibrate to medallion architecture constraints (bronze/silver/gold).
5. Bridge domain knowledge to implementable artifacts.

## Skill Structure

### Naming and Description

- Gerund names, lowercase+hyphens, max 64 chars (example: `building-incremental-models`)
- Description pattern: `[What it does]. Use when [triggers]. [How it works]. Also use when [more triggers].`
- Description is third person and is the primary trigger surface
- Keep trigger conditions in frontmatter description only
- For dbt skills, include layer-specific trigger terms

### SKILL.md Anatomy

- Required sections: Metadata | Overview | Quick Reference | Pointers to references
- Standards skills: include Getting Started (5-8 steps) and Decision Dependency Map
- Knowledge-capture skills: no Getting Started, no dependency map
- If content grows beyond a few paragraphs, extract it to `references/`

### Skill Writing Guideline

#### Frontmatter

- Include `name` and `description` as required fields.
- Keep "when to use" trigger language in `description`, not in body sections.
- Use explicit trigger phrasing in description and avoid vague trigger terms.
- Prefer trigger-complete descriptions over short generic summaries.

#### Body

- Use imperative guidance that explains what to do and why it matters.
- Keep SKILL.md concise; move deep detail to `references/` with clear pointers.
- Avoid repeating trigger guidance in body sections.
- Include examples only where they reduce ambiguity for high-risk decisions.

## Purpose and Structure Patterns

### Knowledge-Capture Skills

Purposes:

- Business process knowledge
- Source system customizations

Pattern:

- Question-oriented parallel sections
- Zero pre-filled assertions
- No dependency ordering sections

### Standards Skills

Purposes:

- Organization specific data engineering standards
- Organization specific Azure or Fabric standards

Pattern:

- Decision-oriented sections with dependency ordering
- Include Getting Started and Decision Dependency Map
- Allow up to 5 pre-filled factual assertions where model priors are wrong

## Delta Rule

Include only guidance Claude is likely to miss without this skill.
If it is already reliable from Context7 or model priors, omit it.

## Output Separation

Skill output directory contains only:

- `SKILL.md`
- `references/*.md`

Context-only files in `context/`:

- `clarifications.json`
- `decisions.md`
- `research-plan.md`
- validation/test logs

## Quality Dimensions

- Actionability: can a data engineer execute work from this guidance?
- Specificity: concrete stack details, not generic advice
- Domain Depth: real failure modes and non-obvious constraints
- Self-Containment: usable without external doc hunting

## Degrees of Freedom

- High freedom: heuristics where many approaches are valid
- Medium freedom: preferred pattern with constrained variation
- Low freedom: exact sequence for fragile operations

Use templates for output shape and examples for quality-critical behaviors.

## Content Rules

- No time-sensitive claims
- Use consistent terminology (`Fabric`, `dlt`)
- Be most precise where mistakes are costly

## Anti-patterns

### Structure

- Windows paths
- Too many options without defaults
- Nested references
- Vague section guidance

### Content

- Over-explaining basic SQL/dbt concepts
- Mixing dlt (dlthub) and Databricks DLT terminology
- Reintroducing process artifacts into skill output
- Duplicating trigger guidance in body sections

## Reference Files

- [references/ba-patterns.md](references/ba-patterns.md): domain decomposition and mapping patterns
- [references/de-patterns.md](references/de-patterns.md): stack conventions and anti-patterns
