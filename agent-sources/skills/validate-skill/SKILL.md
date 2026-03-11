---
name: validate-skill
description: >
  Validates a completed skill against its decisions. Use when validating a skill for a domain and purpose. Returns a validation log and test results as a structured JSON payload.
version: 1.0.0
user-invocable: false
---

# Validate Skill

## Step 1 — Sub-agents

Derive the skill install directory from the path of this SKILL.md: the `references/` folder is a sibling of this file.

Call the **Task tool TWICE in the same response** (both calls in one turn, so they run in parallel). Do NOT read or execute the reference files yourself — delegate entirely.

**Task 1 — Quality checker prompt:**

```text
skill_name=<skill_name> skill_output_dir=<skill_output_dir> workspace_dir=<workspace_dir>
Read and follow the instructions at: <absolute_path_to_references>/validate-quality.md
Return your complete output as text. Do not write files.
```

**Task 2 — Test evaluator prompt:**

```text
skill_name=<skill_name> skill_output_dir=<skill_output_dir> workspace_dir=<workspace_dir>
Read and follow the instructions at: <absolute_path_to_references>/eval-skill.md
Return your complete output as text. Do not write files.
```

Wait for both Task results before proceeding to Step 2.

## Step 2 — Consolidate and Report

Combine sub-agent outputs into:

- Validation findings (FAIL/MISSING with concrete fixes)
- Boundary violations
- Prescriptiveness rewrites
- Test gap analysis with 5-8 prompt categories

## Output Format

Return JSON only with this shape:

```json
{
  "status": "validation_complete",
  "validation_log_markdown": "<full validation log content>",
  "test_results_markdown": "<full test results content>"
}
```

### `validation_log_markdown`

Include summary + coverage + structure + content quality + boundary + suggestions for rewrites + manual review items.

### `test_results_markdown`

Include summary + per-scenario outcomes + skill content gaps + suggested PM prompts.

## Success Criteria

### Validation

- Every decision mapped to file + section
- Structural and best-practice checks pass
- Content sections score >=3 on quality dimensions
- No process artifacts or stakeholder Q&A blocks in skill output

### Evaluations

- `{workspace_dir}/context/evaluations.md` exists with 3+ complete scenarios
- Scenarios include prompt, expected behavior, and pass criteria
- Results include PASS/PARTIAL/FAIL evidence

### Testing

- At least 5 test prompts across required categories
- Every result includes specific evidence and actionable next steps
