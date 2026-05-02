---
name: research
description: Use for workflow research that turns skill purpose and user context into final clarification JSON
user_invocable: false
---

# Research Skill

This skill runs inside the single `skill-creator` OpenHands agent for the
`workflow.research` task. It performs all research inline and returns only the
final `research_complete` JSON object.

Do not emit intermediate markdown, intermediate JSON, plans, scoring tables,
research lenses, dimension scores, selected dimensions, or handoff text. Keep
all reasoning private until the final JSON object is ready.

## Final Output Contract

Return exactly one raw JSON object with this envelope:

```json
{
  "status": "research_complete",
  "question_count": 5,
  "research_output": {
    "version": "1",
    "metadata": {
      "question_count": 5,
      "section_count": 2,
      "refinement_count": 0,
      "must_answer_count": 2,
      "priority_questions": ["Q1", "Q2"],
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

The payload must follow `../shared/schemas.md`. In particular:

- `status` is always `"research_complete"`.
- `research_output.version` is always `"1"`.
- `metadata.question_count` equals the total number of questions.
- `metadata.section_count` equals `sections.length`.
- `metadata.refinement_count` is `0`.
- `metadata.must_answer_count` equals the number of `must_answer: true`
  questions.
- `metadata.priority_questions` lists every must-answer question ID.
- `answer_evaluator_notes` is always `[]`.
- Do not include `metadata.research_plan`, `research_lens`,
  `dimension_scores`, `selected_dimensions`, `topic_relevance`,
  `dimensions_evaluated`, or consolidation handoff fields.

## Step 0: Read User Context

Read `{workspace_dir}/user-context.md`.

If `user-context.md` contains a `## Reference Documents` section with locations
for one or more user-provided documents, read those documents before forming
questions. If a document is missing or appears truncated, continue with the
available material and include a concise `notes` item only if that gap affects
the questions.

If `user-context.md` is missing, return the minimal error payload:

```json
{
  "status": "research_complete",
  "question_count": 0,
  "research_output": {
    "version": "1",
    "metadata": {
      "question_count": 0,
      "section_count": 0,
      "refinement_count": 0,
      "must_answer_count": 0,
      "priority_questions": [],
      "scope_recommendation": false,
      "scope_reason": "missing user-context.md",
      "warning": null,
      "error": {
        "code": "missing_user_context",
        "message": "user-context.md not found in workspace directory"
      }
    },
    "sections": [],
    "notes": [],
    "answer_evaluator_notes": []
  }
}
```

## Step 1: Scope Guard

After reading the available context, privately score whether the topic is useful
for skill-building:

- `0`: empty, placeholder, or unrelated to agent behavior.
- `1`: too vague to infer useful clarification topics.
- `2`: has a broad topic but lacks organization-specific or workflow-specific
  detail.
- `3`: useful enough to ask a small number of targeted clarifications.
- `4`: clearly useful with several organization-specific gaps.
- `5`: highly useful with multiple concrete workflows, artifacts, rules, or
  failure modes to clarify.

If the score is below `3`, return a minimal scope recommendation:

```json
{
  "status": "research_complete",
  "question_count": 0,
  "research_output": {
    "version": "1",
    "metadata": {
      "question_count": 0,
      "section_count": 0,
      "refinement_count": 0,
      "must_answer_count": 0,
      "priority_questions": [],
      "scope_recommendation": true,
      "scope_reason": "<one sentence explaining why the context is not yet useful for skill research>",
      "warning": {
        "code": "scope_guard_triggered",
        "message": "<concise explanation for UI>"
      },
      "error": null
    },
    "sections": [],
    "notes": [],
    "answer_evaluator_notes": []
  }
}
```

## Step 2: Decide Relevant Lenses

Privately evaluate all four lenses. A lens is relevant when it can produce
clarification topics that materially change the resulting skill instructions,
trigger rules, artifact handling, examples, tests, or guardrails.

The four lenses are:

1. **Business process** - domain workflows, user roles, decisions, approvals,
   process states, exceptions, and success criteria.
2. **Data engineering standards** - naming, modeling, testing, quality gates,
   layer rules, code review standards, CI expectations, and handoff artifacts.
3. **Source system customizations** - organization-specific fields,
   configuration, overrides, integrations, extracts, edge cases, and source
   semantics.
4. **Platform standards** - organization-specific Azure, Fabric, Databricks,
   dbt, deployment, workspace, environment, security, observability, and
   operational standards.

Keep the relevance decisions private. Do not return lens names, lens scores, a
research lens object, or any equivalent planning structure.

## Step 3: Generate Candidate Clarification Topics

For each relevant lens, privately generate candidate clarification topics. A
candidate topic is a specific knowledge gap that a user can answer and that
would change how the skill should behave.

Good candidates usually clarify one of these:

- What the skill should enable the agent to do.
- When the skill should trigger.
- What inputs, files, systems, or documents the skill should inspect.
- What output format, naming, schema, or artifact contract the skill must
  produce.
- What organization-specific standards, edge cases, exceptions, or approval
  paths matter.
- What examples or tests should be created with the skill.

Use web research only when current public context would materially reduce the
burden on the user, such as current vendor docs, tool behavior, or known best
practices. Do not use web research to replace organization-specific answers
that only the user can provide.

## Step 4: Score Candidate Knowledge Delta

Privately score each candidate topic by organization-specific knowledge delta:

- `0`: answer is already obvious from the context.
- `1`: answer would be generic best practice.
- `2`: answer is mildly useful but unlikely to change skill behavior.
- `3`: answer would change examples, trigger rules, or output details.
- `4`: answer would change core workflow instructions or guardrails.
- `5`: answer is essential to avoid the skill doing the wrong work.

Drop candidates scored below `3`. If no candidate remains, return a minimal
scope recommendation with `warning.code: "scope_guard_triggered"` and
`scope_reason` explaining that the available context does not expose useful
organization-specific research gaps.

## Step 5: Build Final Questions

Turn the remaining high-value candidates into concise clarification questions.

Question rules:

- Prefer 4-7 total questions.
- Keep only questions that the user can answer from organization knowledge.
- Mark must-answer questions when the answer changes core behavior, trigger
  conditions, required inputs, or required outputs.
- Group questions into 1-3 sections with sequential integer section IDs
  starting at `1`.
- Use question IDs `Q1`, `Q2`, and so on.
- Every question must include `id`, `title`, `text`, `must_answer`, `choices`,
  and `refinements`.
- Every question must have 2-4 concrete choices plus final
  `"Other (please specify)"` with `is_other: true`.
- Set every question `refinements` to `[]`.
- Include `notes` only for material caveats such as missing referenced
  documents, contradictory context, or a scope recommendation.

## Step 6: Validate And Return

Before returning, validate the final object against the output contract:

- Raw JSON object only. No markdown, no code fences, no preamble.
- No abbreviated values such as `"..."`.
- No intermediate structures or legacy fields:
  `research_plan`, `research_lens`, `dimension_scores`,
  `selected_dimensions`, `topic_relevance`, `dimensions_evaluated`.
- Counts and priority-question metadata are internally consistent.
- `metadata.warning` and `metadata.error` are separate channels with non-empty
  `code` and `message` when present.

Return the final JSON object immediately after validation.
