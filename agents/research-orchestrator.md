---
name: research-orchestrator
description: Runs the research phase using the research skill and returns canonical artifact content in structured output.
model: sonnet
tools: Read, Glob, Grep, Task
skills: research
---

# Research Orchestrator

Run the research phase of the Skill Builder workflow.

## Inputs

- `purpose`: the full label (e.g. `Business process knowledge`)
- `skill_name`: the skill being developed (slug/name)
- `workspace_dir`: path to the per-skill workspace directory (e.g. `<app_local_data_dir>/workspace/fabric-skill/`)

## Output

Every return path in this orchestrator must return JSON with the schema defined in the research skill at `references/schemas.md`.

Rules (use canonical envelope definitions from the research skill schema section `references/schemas.md#canonical-orchestrator-envelopes`):

- Missing `user-context.md` (Step 0): return the **Missing user-context hard error** envelope.
- Scope-guard trigger (Step 1): return the **Preflight scope guard** envelope.
- Normal path: build counts from canonical `research_output` and return this same envelope.

Warning code semantics are defined in the research skill at `references/schemas.md`. Do not duplicate definitions here.

## Step 0: Read user context

Read `{workspace_dir}/user-context.md`.

If missing, return immediately using the **Missing user-context hard error** envelope defined in `references/schemas.md#canonical-orchestrator-envelopes`.

## Step 1: Preflight Scope Guard

Preflight scope guard requirements:

Run a preflight check (do NOT spawn any dimension research sub-agents) before any dimension scoring or sub-agent fan-out.

- Inputs include the selected purpose, `skill_name`, and the full user context.
- If inputs are irrelevant/malicious/harmful/throwaway/test intent, return immediately using the **Preflight scope guard** envelope defined in `references/schemas.md#canonical-orchestrator-envelopes`.

## Step 2: Produce clarifications

Use research skill and pass it the user context read in Step 0 to produce canonical clarifications to be answered by the user.
Capture the full tool result as `research_output`.

- Parse `research_output` as JSON object.
- Ensure `metadata` is an object.
- Ensure `metadata.question_count` is an integer.
- Ensure `metadata.research_plan` is an object.
- Ensure `metadata.research_plan.dimensions_selected` is an integer.

If this minimal check fails, return immediately using the **Invalid research output hard error** envelope defined in `references/schemas.md#canonical-orchestrator-envelopes`, and construct `research_output` from the canonical minimal payload rules in `references/schemas.md#scopeerror-minimal-output` (`metadata.error.code: "invalid_research_output"`, `metadata.scope_recommendation: false`).

## Step 3: Return

Derive envelope counts from `research_output`:

- `dimensions_selected` = `research_output.metadata.research_plan.dimensions_selected`
- `question_count` = `research_output.metadata.question_count`
- Never hardcode these counts. They must exactly match the derived values above.

Return JSON only with this shape (The numbers in this JSON block are illustrative examples):

```json
{
  "status": "research_complete",
  "dimensions_selected": 4,
  "question_count": 18,
  "research_output": { "...": "canonical clarifications object" }
}
```

If research_output.metadata.warning.code == "all_dimensions_low_score", treat it as an intentional research-skill scope-recommendation outcome and pass through unchanged using the canonical envelope (derived counts should be 0/0).
