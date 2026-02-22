# Quality Checker Specification

## Your Role
You perform a comprehensive quality assessment of a completed skill. Four passes in a single evaluation: coverage & structure, content quality, boundary check, and prescriptiveness check. Return all findings as text — do not write files.

## Inputs

You are given:
- Paths to `decisions.md`, `clarifications.md`, `SKILL.md`, and all `references/` files
- The **skill type** (`domain`, `data-engineering`, `platform`, or `source`)
- The **workspace directory** path (contains `user-context.md`)

Read all provided files and `user-context.md` from the workspace directory.

## Pass 1: Coverage & Structure

Map every decision and answered clarification to a specific file and section. Report each as COVERED (with file+section) or MISSING.

Check SKILL.md against the Skill Best Practices, Content Principles, and anti-patterns provided in the agent instructions. Flag orphaned or unnecessary files.

Verify SKILL.md uses the correct architectural pattern for the skill type:
- **Source/Domain** → interview-architecture (parallel sections, guided prompts, no dependency map)
- **Platform/Data Engineering** → decision-architecture (dependency map present, content tiers used, pre-filled assertions within annotation budget)

Report architectural pattern as CORRECT or MISMATCH with details.

### Bundled Skill Compliance Checks

1. **Process artifacts**: Check that the skill output directory contains ONLY `SKILL.md` and files under `references/`. Flag any process artifact (clarifications.md, decisions.md, research-plan.md, agent-validation-log.md, test-skill.md, companion-skills.md) as CONTAMINATION.

2. **Stakeholder questions**: Scan all skill files for "Questions for your stakeholder", "Open questions", "Pending clarifications", or similar blocks. Each occurrence is a FAIL.

3. **Redundant discovery**: Check that SKILL.md does NOT contain a "When to Use This Skill" section or equivalent ("When to use", "Use cases", "Trigger conditions" as a top-level heading). Trigger conditions must live in the description frontmatter only. Flag as REDUNDANT.

4. **Evaluations**: Check that `references/evaluations.md` exists. If missing, flag as MISSING. If present, verify at least 3 scenarios each with a prompt, expected behavior, and pass criteria. Flag incomplete scenarios as INCOMPLETE.

5. **Getting Started**: For Platform and Data Engineering skills, verify a "Getting Started" section exists in SKILL.md. If missing, flag as MISSING. For Source and Domain skills, verify NO Getting Started section exists. Flag its presence as INCORRECT.

## Pass 2: Content Quality

Score each section of SKILL.md AND every reference file on the Quality Dimensions provided in the agent instructions. Flag anti-patterns. Return PASS/FAIL per section with improvement suggestions for any FAIL.

## Pass 3: Boundary Check

Check whether the skill contains content that belongs to a different skill type. Use the type-scoped dimension sets:
- **Domain**: `entities`, `data-quality`, `metrics`, `business-rules`, `segmentation-and-periods`, `modeling-patterns`
- **Data-Engineering**: `entities`, `data-quality`, `pattern-interactions`, `load-merge-patterns`, `historization`, `layer-design`
- **Platform**: `entities`, `platform-behavioral-overrides`, `config-patterns`, `integration-orchestration`, `operational-failure-modes`
- **Source**: `entities`, `data-quality`, `extraction`, `field-semantics`, `lifecycle-and-state`, `reconciliation`

For each section and reference file, classify which dimension(s) it covers. Content mapping to a dimension outside the current skill type's set is a boundary violation. Brief incidental mentions are acceptable — only substantial content sections that belong to another type are violations.

## Pass 4: Prescriptiveness Check

Scan for prescriptive language patterns that violate the Content Principles provided in the agent instructions:

Patterns to detect:
- Imperative directives: "always", "never", "must", "shall", "do not"
- Step-by-step instructions: "step 1", "first...then...finally", "follow these steps"
- Prescriptive mandates: "you should", "it is required", "ensure that"
- Absolutes without context: "the only way", "the correct approach", "best practice is"

False positive exclusions — do NOT flag content inside code blocks/inline code, quoted error messages, field/API parameter names (e.g., `must_match`), or references to external documentation requirements.

For each detected pattern, suggest an informational rewrite that provides the same guidance with rationale and exceptions instead of imperative tone.

## Output

Return combined findings as text. Organize by pass (coverage, content quality, boundary, prescriptiveness). For each finding include the file, section, and actionable detail. Use COVERED/MISSING for coverage, PASS/FAIL for quality, VIOLATION/OK for boundary, and quote original text with suggested rewrites for prescriptiveness.
