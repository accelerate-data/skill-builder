# Workflow Research Clean Break

> **Status:** Draft
> **Related issue:** VU-1150
> **Related plan:** [VU-1150 Workflow Research Clean-Break Implementation Plan](../../plans/2026-05-03-vu-1150-research-lens-clean-break.md)

## Overview

Workflow research is moving from the legacy Claude dimension-scoring flow to an
OpenHands-native clean break. The new design keeps the useful judgment from the
old flow, but makes it internal: the agent evaluates scope, checks relevant
knowledge lenses, scores candidate clarification topics, drops low-value notes,
and emits only the final clarifications JSON.

The app should not display, store, or depend on intermediate research planning
fields. Step 0 becomes a single research pass that either returns high-value
clarification questions or recommends narrowing the requested skill scope.

## Design Scope

**Covers**

- Step 0 research output shape.
- Internal research flow for the workspace `research` skill.
- Simplified app display for research completion.
- Deletion of workspace dimension and consolidation references.
- Eval updates for the clean-break contract.

**Does not cover**

- `agent-sources/plugins/`, which is the old Claude path.
- Downstream answer evaluation, decision synthesis, or skill generation output
  contracts.
- Broader OpenHands runtime execution mechanics covered by the runtime design
  docs.

## Key Decisions

| Decision | Rationale |
|---|---|
| Emit only final clarifications JSON | There is no longer a subagent handoff or consolidation consumer for intermediate JSON. |
| Remove dimensions and lens metadata from the contract | The app should not depend on internal research reasoning that may change with prompting. |
| Use all four lenses internally | Business process, data engineering standards, source customization, and platform standards are complementary checks, not mutually exclusive routing choices. |
| Score topics before asking questions | Broad or weak topics produce low-value skills; the agent should narrow or reject them early. |
| Score candidate clarification topics | The final output should include only questions with organization-specific knowledge delta. |
| Delete obsolete workspace references | Leaving dimension and consolidation docs discoverable risks the agent reusing the old flow. |
| Update evals with negative assertions | Prompt and contract drift is likely unless evals ban legacy fields explicitly. |

## Research Flow

The agent performs the following internal steps and emits only the final result.

1. Read the requested skill name, description, user context, and available
   reference material.
2. Score whether the topic is useful for a data, analytics, or data-engineering
   skill.
3. Return a scope recommendation if the topic is not useful, not data-relevant,
   or too broad for a skill to cover.
4. Check each internal lens for relevance:
   business process, data engineering standards, source system customizations,
   and platform standards.
5. Generate candidate clarification topics from every relevant lens.
6. Score each candidate by whether it captures knowledge that is organization
   specific, commonly misunderstood, absent from baseline LLM knowledge, or
   likely to change the generated skill.
7. Keep high-scoring candidates, drop low-scoring candidates, and keep score-3
   candidates only when needed for minimum useful coverage.
8. Emit `research_complete` with the canonical clarifications object.

## Topic Scope Gate

| Score | Meaning | Output behavior |
|---|---|---|
| 5 | Bounded data or analytics skill topic | Proceed to lens checks |
| 4 | Useful topic with modest ambiguity | Proceed and include targeted clarifications |
| 3 | Relevant but too broad | Ask narrowing clarification questions only |
| 2 | Weak data-engineering relevance | Return a scope recommendation |
| 1 | Not a useful skill topic | Return a scope recommendation |

Example: `HR analytics` is too broad because it could span workforce planning,
retention, recruiting, payroll, performance, engagement, privacy, metrics, and
source-specific semantics. The agent should narrow it before researching.

## Internal Lenses

| Lens | Consider when the topic may depend on |
|---|---|
| Business process | Business events, grain, lifecycle, metrics, rules, exceptions, segmentation, periods |
| Data engineering standards | Modeling standards, layers, quality gates, load patterns, historization, naming, tests |
| Source system customizations | Custom objects, custom fields, overridden semantics, lifecycle state, extraction, reconciliation |
| Platform standards | Azure, Fabric, orchestration, deployment, environments, configuration, operational failures |

Each lens starts with the question: "Is this lens relevant for this topic?"
Irrelevant lenses do not produce candidate topics. Multiple relevant lenses may
contribute candidates.

## Candidate Scoring

| Score | Keep? | Meaning |
|---|---|---|
| 5 | Yes | Organization-specific answer is likely essential to skill correctness |
| 4 | Yes | Answer would materially change generated skill behavior |
| 3 | Maybe | Keep only if needed for minimum useful coverage |
| 2 | No | Generic answer is likely enough |
| 1 | No | Nice-to-know or outside requested skill scope |

Candidates are scored against four questions:

- What do people typically get wrong?
- What is not in baseline LLM background knowledge?
- What is typically customized or unique to organizations?
- Would the answer materially change the generated skill?

The score is internal. The final clarifications output should not expose scores,
lens labels, dropped candidates, or consolidation notes.

## Output Contract

Successful research returns:

```json
{
  "status": "research_complete",
  "question_count": 5,
  "research_output": {
    "version": "1",
    "metadata": {
      "title": "Clarifications: Example",
      "question_count": 5,
      "section_count": 2,
      "refinement_count": 0,
      "must_answer_count": 2,
      "priority_questions": ["Q1", "Q2"],
      "scope_recommendation": false,
      "warning": null,
      "error": null
    },
    "sections": [],
    "notes": [],
    "answer_evaluator_notes": []
  }
}
```

The output must not include:

- `dimensions_selected`
- `metadata.research_plan`
- `metadata.research_lens`
- `dimension_scores`
- `selected_dimensions`
- emitted lens scoring, candidate scoring, intermediate JSON, consolidation, or
  handoff notes

## App Display

The research summary UI should show durable result fields:

- research completion, warning, error, or scope recommendation state
- question count
- must-answer count
- section count
- notes count
- warning, error, or scope recommendation copy when present

It should not show dimensions, selected lenses, dimension scores, research-plan
tables, or consolidation artifacts.

## Eval Strategy

Update the affected Promptfoo packages:

- `tests/evals/packages/skill-content-researcher-research`
- `tests/evals/packages/skill-content-researcher-skill-builder`
- `tests/evals/packages/workspace-workflow-step-prompt`

Each package should positively assert the final output envelope and negatively
assert legacy fields:

- `dimensions_selected`
- `research_plan`
- `research_lens`
- `dimension_scores`
- `selected_dimensions`
- `all_dimensions_low_score`
- `consolidation-handoff`
- `scoring-rubric`

The deterministic harness test remains `cd tests/evals && npm test`. Targeted
live evals should run for the three updated packages after prompt changes.

## Relationship to Existing Design Specs

| Spec | Relationship |
|---|---|
| [Agent runtime boundary](../agent-runtime-boundary/README.md) | Defines the OpenHands runtime boundary; this design narrows the step 0 research artifact. |
| [OpenHands SDK runner](../openhands-sdk-runner/README.md) | Defines runner invocation; this design affects the prompt and artifact contract consumed by that runner. |
| [Skills](../skills/README.md) | Describes bundled skills; this design updates the workspace research skill behavior. |
| [Agent specs](../agent-specs/README.md) | Defines agent artifacts and storage; this design removes obsolete research planning fields. |

## Key Source Files

| File | Purpose |
|---|---|
| `agent-sources/workspace/skills/research/SKILL.md` | Primary research skill instructions. |
| `agent-sources/workspace/skills/shared/schemas.md` | Shared workspace output schema guidance. |
| `agent-sources/prompts/research.txt` | Workflow step prompt for research. |
| `app/src-tauri/src/contracts/workflow_outputs.rs` | Rust step output contract. |
| `app/src-tauri/src/contracts/clarifications.rs` | Rust clarifications contract. |
| `app/src/components/research-summary-card.tsx` | Research summary UI. |
| `tests/evals/packages/skill-content-researcher-research/` | Direct research skill eval package. |
| `tests/evals/packages/skill-content-researcher-skill-builder/` | Skill Builder research eval package. |
| `tests/evals/packages/workspace-workflow-step-prompt/` | Workflow step prompt eval package. |
