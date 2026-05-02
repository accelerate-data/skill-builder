# Workflow Detailed Research Clean Break

## Purpose

Detailed Research is workflow step 1. It runs after the user answers the initial
clarification questions and after the answer-evaluator gate decides the workflow
can continue with `gate_decision: "run_research"`.

The clean-break migration moves this step away from the plugin-hosted
`research-agent` routing model. The app should run the shared OpenHands
`skill-creator` agent with an app-owned detailed-research prompt, just as step 0
research and the answer-evaluator gate now do.

## Current State

Step 0 research already uses:

- app-owned prompt: `agent-sources/prompts/research.txt`
- OpenHands agent: `skill-creator`
- task kind: `workflow.research`

The answer-evaluator gate already uses:

- app-owned prompt: `agent-sources/prompts/answer-evaluator.txt`
- OpenHands agent: `skill-creator`
- task kind: `workflow.answer_evaluator`
- bundled skill: `answer-evaluator`

Detailed Research still uses the older shape:

- agent prompt: `agent-sources/plugins/skill-content-researcher/agents/research-agent.md`
- generic workflow prompt: `agent-sources/prompts/workflow-step.txt`
- step config agent name: `research-agent`
- no task kind for the OpenHands run

That leaves one remaining workflow research path coupled to a plugin-hosted
agent file instead of an app-owned prompt plus the shared `skill-creator` agent.

## Target Contract

Detailed Research must run as a clean-break OpenHands workflow task:

- app-owned prompt: `agent-sources/prompts/detailed-research.txt`
- OpenHands agent: `skill-creator`
- task kind: `workflow.detailed_research`
- runtime provider: `openhands`
- output schema: existing step 1 `DetailedResearchOutput`
- output file: `context/clarifications.json`
- transcript/log behavior: same workflow one-shot path as step 0 research

The prompt should instruct `skill-creator` to perform the detailed research pass
inline. It should not ask for subagents, delegated research, Claude routing, or a
separate OpenHands agent.

## Detailed Research Behavior

The step reads:

- `{workspace_dir}/user-context.md`
- `{workspace_dir}/answer-evaluation.json`
- `{workspace_dir}/context/clarifications.json`
- any reference documents named by `user-context.md` when they materially affect
  follow-up questions

The step uses the answer-evaluator verdicts as input. It does not reclassify
answers as clear, vague, missing, contradictory, or needing refinement.

The step may update the canonical clarifications object in three ways:

- add new sections when the user's answers reveal a new decision area that does
  not fit an existing section
- add new top-level questions to existing sections when the missing decision
  belongs in that section but is not a child of one existing question
- add refinement questions under existing questions when a specific answer needs
  a narrower follow-up

The step must preserve existing top-level question identity. Existing questions
must keep their IDs, order, answer fields, choices, recommendations, and
refinement arrays except for appended refinements.

## Additive Merge Rules

Detailed Research is additive relative to the incoming `clarifications.json`.

Allowed changes:

- append sections to `sections`
- append questions to an existing section's `questions`
- append refinements to an existing question's `refinements`
- append refinements to a newly added top-level question only when needed
- update canonical metadata to match the merged object
- add notes describing important assumptions or dropped duplicates

Disallowed changes:

- deleting existing sections
- deleting existing top-level questions
- renumbering existing question IDs
- rewriting existing question text, choices, answers, recommendations, or
  `must_answer` values
- moving an existing question to a different section
- replacing an existing `refinements` array instead of appending to it
- returning transient planning fields such as `parent_question_id` or
  `detailed_research_type`

## ID Rules

New IDs must be deterministic and scoped to their parent.

- New top-level questions in an existing section use the next available `Q`
  number after the highest existing top-level `Q` number.
- New top-level questions in a new section also use the same global top-level
  `Q` sequence; section boundaries do not reset question numbering.
- Refinements under `Q3` use `R3.1`, `R3.2`, and so on.
- If a parent already has refinements, the step appends after the highest
  existing refinement number for that parent.
- IDs must be unique across all top-level questions and refinements.

## Metadata Rules

The returned `clarifications_json.metadata` must be recomputed after merging.

- `question_count`: number of top-level questions only
- `section_count`: number of sections
- `refinement_count`: total number of refinement questions across all parents
- `must_answer_count`: top-level questions plus refinements where
  `must_answer: true`
- `priority_questions`: all top-level and refinement IDs where
  `must_answer: true`
- `duplicates_removed`: duplicate candidate questions or refinements dropped
  during the merge
- `scope_recommendation`: preserve the incoming value unless the incoming object
  is already a scope recommendation
- `warning` and `error`: preserve existing values unless the step is returning a
  schema-valid failure payload

If `clarifications_json.metadata.scope_recommendation == true`, the step returns
the existing canonical clarifications object unchanged with zero new additions.

## Output Contract

The final response is raw JSON only:

```json
{
  "status": "detailed_research_complete",
  "refinement_count": 0,
  "section_count": 0,
  "clarifications_json": {
    "version": "1",
    "metadata": {
      "question_count": 0,
      "section_count": 0,
      "refinement_count": 0,
      "must_answer_count": 0,
      "priority_questions": [],
      "scope_recommendation": false,
      "scope_reason": null,
      "warning": null,
      "error": null
    },
    "sections": [],
    "notes": [],
    "answer_evaluator_notes": []
  }
}
```

`refinement_count` at the top level must equal
`clarifications_json.metadata.refinement_count`. `section_count` at the top
level must equal `clarifications_json.metadata.section_count` and
`clarifications_json.sections.length`.

## Runtime Design

Step 1 should get a dedicated builder, parallel to the existing step 0 and
answer-evaluator builders:

- `build_step1_prompt(...)` loads `agent-sources/prompts/detailed-research.txt`
- `build_workflow_detailed_research_sidecar_config(...)` builds the OpenHands
  one-shot config
- the config sets `agent_name: "skill-creator"`
- the config sets `task_kind: "workflow.detailed_research"`
- the config uses `workflow_output_format_for_step(1)`
- the config keeps workflow logging and transcript paths

The generic `build_prompt(...)` path remains available for steps that have not
yet moved to app-owned task prompts, but step 1 should no longer use it.

## Eval Design

The deterministic detailed-research eval package must describe the clean-break
shape:

- mention `skill-creator`
- mention `workflow.detailed_research`
- mention `agent-sources/prompts/detailed-research.txt`
- stop referring to OpenHands `research-agent`

The smoke assertion should verify:

- raw JSON can be parsed
- status is `detailed_research_complete`
- top-level `section_count` matches the section array length
- top-level `refinement_count` matches metadata
- existing questions are preserved
- at least one of the allowed additions exists in the representative case:
  new section, new top-level question, or refinement
- all questions include `refinements`
- no transient merge-planning fields leak into the canonical object

The static OpenHands workflow canary should include detailed research in the
same topology checks that already cover research and answer evaluation.

## Non-Goals

- Do not create a new OpenHands `detailed-research` agent.
- Do not preserve a compatibility path through `research-agent`.
- Do not change the UI step order.
- Do not change downstream Confirm Decisions behavior except where it consumes
  the richer canonical `clarifications.json`.
- Do not reintroduce old schema reference files.

## Quality Gates

Required automated gates for the implementation:

- `cd app && npm run test:agents:structural`
- `cd app && npx tsc --noEmit`
- `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow`
- `cd app/sidecar && npx vitest run`
- `cd tests/evals && npm test`
- targeted detailed-research smoke eval:
  `cd tests/evals && ./scripts/promptfoo.sh eval --no-cache --filter-pattern '^\\[smoke\\]' -c packages/skill-content-researcher-detailed-research/promptfooconfig.json`

If the implementation changes shared workflow event handling, runtime config, or
materialization behavior, also run:

- `cd app && npm run test:unit`
- `cd app && bash tests/run.sh e2e --tag @workflow`
