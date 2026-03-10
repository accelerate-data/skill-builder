---
name: validate-skill
description: >
  Validates a completed skill against its decisions and clarifications. Use when validating a skill for a domain and purpose. Returns a validation log, test results, and companion recommendations as a structured JSON payload.
version: 1.0.0
user-invocable: false
---

# Validate Skill

## Overview

Read-only validator that produces three inline outputs:

1. Validation log (`agent-validation-log.md`)
2. Test results (`test-skill.md`)
3. Companion recommendations (`companion-skills.md`)

Do not modify skill files.

## Quick Reference

- Run three focused sub-agents using the spec files
- Consolidate findings into the required three output sections
- Keep findings concrete: file + section + specific fix
- Require standards checks (structure, evaluations, anti-patterns)

## Inputs

| Input | Description |
|---|---|
| `skill_name` | Skill name |
| `purpose` | `Business process knowledge` \| `Organization specific data engineering standards` \| `Organization specific Azure or Fabric standards` \| `Source system customizations` |
| `context_dir` | Path to context directory |
| `skill_output_dir` | Path to skill output directory |
| `workspace_dir` | Path to workspace directory |

## Step 1 — Sub-agents

Spawn three sub-agents in the same turn. Mode: `bypassPermissions`. Pass `skill_name`, `purpose`, `context_dir`, `skill_output_dir`, `workspace_dir` to each. Add to every sub-agent prompt: "Return your complete output as text. Do not write files."

- Quality checker: read and follow `references/validate-quality-spec.md`
- Test evaluator: read and follow `references/test-skill-spec.md`
- Companion recommender: read and follow `references/companion-recommender-spec.md`

## Step 2 — Consolidate and Report

Combine sub-agent outputs into:

- Validation findings (FAIL/MISSING with concrete fixes)
- Boundary violations
- Prescriptiveness rewrites
- Test gap analysis with 5-8 prompt categories
- Companion skill recommendations

## Return Format

Return JSON only with this shape:

```json
{
  "status": "validation_complete",
  "validation_log_markdown": "[full agent-validation-log.md content]",
  "test_results_markdown": "[full test-skill.md content]",
  "companion_skills_markdown": "[full companion-skills.md content including YAML frontmatter]"
}
```

All four keys are required.

## Output Format

### `validation_log_markdown`

Include summary + coverage + structure + content + boundary + rewrites + manual review items.

### `test_results_markdown`

Include summary + per-scenario outcomes + skill content gaps + suggested PM prompts.

### `companion_skills_markdown`

Include YAML frontmatter with companion entries and markdown reasoning body.

YAML schema:

```yaml
---
skill_name: [skill_name]
purpose: [purpose]
companions:
  - name: [display name]
    slug: [kebab-case]
    purpose: [purpose]
    priority: High | Medium | Low
    dimension: [dimension slug]
    score: [planner score]
    template_match: null
---
```

If none, use `companions: []`.

## Success Criteria

### Validation

- Every decision and answered clarification mapped to file + section
- Structural and best-practice checks pass
- Content sections score >=3 on quality dimensions
- Standards skills include Getting Started section
- No process artifacts or stakeholder Q&A blocks in skill output

### Evaluations

- `{context_dir}/evaluations.md` exists with 3+ complete scenarios
- Scenarios include prompt, expected behavior, and pass criteria
- Results include PASS/PARTIAL/FAIL evidence

### Testing

- At least 5 test prompts across required categories
- Every result includes specific evidence and actionable next steps
