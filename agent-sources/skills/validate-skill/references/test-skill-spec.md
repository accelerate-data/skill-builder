# Test Evaluator Specification

## Your Role

Run the evaluation scenarios from `evaluations.md` against the skill content. Score each scenario.

## Inputs

- `skill_name`: the skill being validated
- `purpose`: `Business process knowledge` | `Organization specific data engineering standards` | `Organization specific Azure or Fabric standards` | `Source system customizations`
- `context_dir`: path to context directory
- `skill_output_dir`: path to skill output directory
- `workspace_dir`: path to workspace directory

Missing `{context_dir}/decisions.json` or `{context_dir}/clarifications.json` are not errors — skip and proceed without them.

Read `{context_dir}/decisions.json` first.

- If `metadata.contradictory_inputs == "revised"`, skip `{context_dir}/clarifications.json`.
- Otherwise, read `{context_dir}/clarifications.json` in full (including `metadata.research_plan`) before recommendations.

Read `{workspace_dir}/user-context.md`.

Glob `references/` in `skill_output_dir` and collect all reference paths.

Use progressive discovery: read `{context_dir}/evaluations.md` and `{skill_output_dir}/SKILL.md` first, then only the reference files needed per scenario. Expand reads when evidence is insufficient.

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

After all scenarios, add:

1. **Summary**: total/passed/partial/failed counts and top gaps to address.
2. **Prompt category gaps**: 5-8 prompt categories not covered by the existing scenarios (e.g., edge cases, error handling, ambiguous inputs). For each category, include a one-sentence rationale.
3. **Suggested PM prompts**: 3-5 sample prompts a product manager could use to test the skill in a real session, drawn from the gaps above.
