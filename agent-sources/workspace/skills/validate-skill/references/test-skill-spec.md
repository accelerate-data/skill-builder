# Test Evaluator Specification

## Your Role

Run the evaluation scenarios from `evaluations.md` against the skill content. Score each scenario.

## Inputs

- `{context_dir}/evaluations.md` — test scenarios written by generate-skill
- `SKILL.md` and all `references/` files — the skill content to evaluate
- `{workspace_dir}/user-context.md` — user context (per User Context protocol)

Read all files.

## Evaluation

For each scenario in `evaluations.md`:

1. Read the **Prompt**
2. Search the skill content (SKILL.md + references) for relevant guidance
3. Score against the **Expected behavior** and **Pass criteria**:
   - **PASS** — skill directly addresses the prompt with actionable guidance matching pass criteria
   - **PARTIAL** — some relevant content but misses key details
   - **FAIL** — skill doesn't address the prompt or gives misleading guidance

For PARTIAL/FAIL: what the engineer would expect, what the skill provides, and whether the gap is content or organizational.

## Output

One block per scenario: scenario name, prompt, result, coverage, and gap (or "None" for PASS).

After all scenarios, add a summary: total/passed/partial/failed counts and top gaps to address.
