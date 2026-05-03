# Skill Builder Eval Scenario Inventory

This inventory records the VU-1135 coverage rebuild decisions. Packages are
organized around app-loaded prompts, plugin agents, and plugin skills. When one
artifact changes, run and update the matching package.

## Decisions

| Package | Scenario | Decision | Rationale |
|---|---|---|---|
| `harness-smoke` | OpenCode provider reachability | Keep | Proves the tiered OpenCode provider can execute a minimal Promptfoo request. |
| `skill-content-researcher-research` | Research output | Rewrite | Covers OpenHands `skill-creator` step 0 output, canonical `clarifications_json`, scope recommendation output, and research metadata. |
| `skill-content-researcher-answer-evaluator` | Gate verdict | Rewrite | Covers OpenHands `skill-creator` answer-evaluator gate answer classification and `gate_decision` JSON. |
| `skill-content-researcher-detailed-research` | Detailed research merge | Rewrite | Covers OpenHands `skill-creator` step 1 `workflow.detailed_research` additive merge behavior. |
| `skill-content-researcher-confirm-decisions` | Decisions output | Rewrite | Covers OpenHands `skill-creator` step 2 decision confirmation analysis and canonical decisions JSON. |
| `skill-creator-generate-skill` | Generated skill output | Rewrite | Covers OpenHands `skill-creator` step 3 `workflow.skill_generation` using the `creating-skills` skill, `{skill_output_dir}/SKILL.md`, references, generated evals, fresh-context verification, `version_bump: "1.0.0"`, and no benchmark execution. |
| `skill-creator-rewrite-skill` | Refine rewrite | Add | Covers the rewrite agent contract used by refine sessions. |
| `skill-creator-grader` | Eval grading | Add | Covers strict grading and `grading.json` output used by app eval runs. |
| `workspace-test-evaluator-prompt` | Skill tester plan comparison | Add | Replaces the stale bundled-skill meta eval with the app-used tester evaluator prompt behavior. |
| `workspace-workflow-step-prompt` | Workflow prompt shell | Add | Covers app-injected workflow paths and one-shot constraints. |
| `workspace-refine-initial-prompt` | Refine prompt shell | Add | Covers refine routing, eval-failure triage, and `AskUserQuestion` handoff. |
| `workspace-eval-initial-prompt` | Eval loop prompt | Add | Covers executor/grader orchestration and structured eval-loop output. |
| `workspace-eval-generator-system-prompt` | Eval generator prompt | Add | Covers pending eval JSON generation from realistic skill-test user intent. |
| `workspace-description-evals-generator-prompt` | Description query generation | Add | Covers trigger-query generation for description optimization. |
| `workspace-skill-suggestions-prompt` | Skill field suggestions | Add | Covers the create-skill form suggestion JSON returned by the Rust prompt. |
| `scope-advisor` | Skill scope review prompt | Rewrite | Covers current Rust prompt behavior for focused, too-broad, name, description, context, and non-English cases. |

## Smoke Subset

The smoke subset is every test whose description starts with `[smoke]`.
There is exactly one smoke scenario per package. `npm run eval:smoke` runs the
smoke filter across every package config, including `harness-smoke`.

## Regression Subset

The regression subset is the full package list:

- `npm run eval:skill-content-researcher-research`
- `npm run eval:skill-content-researcher-answer-evaluator`
- `npm run eval:skill-content-researcher-detailed-research`
- `npm run eval:skill-content-researcher-confirm-decisions`
- `npm run eval:skill-creator-generate-skill`
- `npm run eval:skill-creator-rewrite-skill`
- `npm run eval:skill-creator-grader`
- `npm run eval:workspace-test-evaluator-prompt`
- `npm run eval:workspace-workflow-step-prompt`
- `npm run eval:workspace-refine-initial-prompt`
- `npm run eval:workspace-eval-initial-prompt`
- `npm run eval:workspace-eval-generator-system-prompt`
- `npm run eval:workspace-description-evals-generator-prompt`
- `npm run eval:workspace-skill-suggestions-prompt`
- `npm run eval:scope-advisor`

Use `npm run eval:regression` before high-risk model/runtime changes. Use the
targeted package script when the issue only touches one package's contract.

## Model-Change Validation Order

1. `npm test`
2. `npm run eval:smoke`
3. Targeted package evals for the changed runtime, workflow, or prompt surface
4. `npm run eval:regression` for model/runtime migrations

No manual validation is required for this suite. Live eval scripts are automated
OpenCode checks and may be run as normal validation whenever prompt, agent, or
runtime behavior changes. A failing live eval should be triaged against this
inventory before a scenario is dropped or rewritten. `npm test` provides the
deterministic static and harness gate.
