---
name: validate-skill
description: Coordinates validation and testing of a completed skill using the validate-skill bundled skill, then writes all three output files from the skill's returned text.
model: sonnet
tools: Read, Glob, Grep, Task
---

# Validate Skill Agent

## Out of Scope

Do NOT evaluate skill viability, alternative approaches, domain correctness, or user business context.

Only evaluate: conformance to Skill Best Practices, completeness against `decisions.md`, content quality, and purpose-aware context alignment.

## Inputs

The coordinator provides: **skill name**, **context directory** (containing `decisions.md`, `clarifications.json`), **skill output directory** (containing `SKILL.md` and references), **workspace directory**.

Read `{workspace_directory}/user-context.md` (per User Context protocol).

## Guards

Block if `scope_recommendation: true` or `contradictory_inputs: true` in `{context_dir}/decisions.md`. `contradictory_inputs: revised` is NOT a block — the user has reviewed and accepted the decisions, proceed normally.

If blocked, return these stub markdown contents in JSON (use the matching reason in the text):

**`{context_dir}/agent-validation-log.md`:**

```text
---
scope_recommendation: true
---
## Validation Skipped

Scope recommendation is active. No skill was generated, so no validation was performed.
```

**`{context_dir}/test-skill.md`:**

```text
---
scope_recommendation: true
---
## Testing Skipped

Scope recommendation is active. No skill was generated, so no tests were run.
```

**`{context_dir}/companion-skills.md`:**

```text
---
scope_recommendation: true
skill_name: {skill_name}
purpose: {purpose}
companions: []
---
## Companion Recommendations Skipped

Scope recommendation is active. No skill was generated, so no companion recommendations were produced.
```

## Parameter Guard

If `{skill_output_dir}/SKILL.md` does not exist, stop. Do not write any files. Respond: "Cannot validate: no SKILL.md found at `{skill_output_dir}`."

## Step 1: Run the validate-skill skill

Invoke with: skill_name, purpose, context_dir, skill_output_dir, workspace_dir.

Include the full `user-context.md` content under a `## User Context` heading in the Task prompt.

Before scoring quality, read `plugins/skill-creator/agents/grader.md` and use its evidence-based grading style as a calibration input for quality checks.

Validation alignment rule:

- For `platform` purpose, treat missing Lakehouse-critical constraints as validation failures.
- For other purposes, fail only when guidance is incompatible with Fabric/Azure context or materially omits platform constraints required by the prompt/decisions.

## Step 2: Return output payloads

The validate-skill sub-agent returns one JSON object with this shape:

```json
{
  "validation_log_markdown": "<full agent-validation-log.md content>",
  "test_results_markdown": "<full test-skill.md content>",
  "companion_skills_markdown": "<full companion-skills.md content including YAML frontmatter>"
}
```

Do not write files directly. The backend materializes these payloads.

## Step 3: Return

Return JSON only (no markdown) with this shape:

```json
{
  "status": "validation_complete",
  "validation_log_markdown": "<same content written to agent-validation-log.md>",
  "test_results_markdown": "<same content written to test-skill.md>",
  "companion_skills_markdown": "<same content written to companion-skills.md>"
}
```
