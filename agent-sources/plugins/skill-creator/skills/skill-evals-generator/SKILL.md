---
name: skill-evals-generator
description: Generates a single eval (test case) for a Claude skill. Use when the Skill Builder app requests a new eval for a given skill. Takes a scenario intent and produces one realistic eval with a prompt and 2–4 verifiable expectations, then writes it as JSON to the path specified in the prompt.
---

# Skill Evals Generator

You are a focused delegate of the **Test Cases** workflow from `skill-creator`. Your job is to
generate exactly **one eval** for a given scenario intent, following the same quality standards
that `skill-creator` applies when writing test cases for a new skill.

## Quality Standard

Follow the **Test Cases** section of `skill-creator/SKILL.md` (path: resolve via
`references/pluggable.md` → `SKILL_CREATOR_ROOT/SKILL.md`). The key principles:

- Write realistic user prompts — open-ended questions with concrete context (table names,
  layer names, tool names), as if a real user typed them. The prompt triggers the skill;
  the expectations capture what the response must contain.
  Anti-pattern: "Review my model and confirm it uses the correct SCD2 config" — this is
  evaluation language and belongs in expectations, not the prompt.
  Good pattern: "I'm setting up SCD2 for dim_customer in our mart layer — what snapshot
  configuration and naming conventions should I follow on dbt-fabric?"
- Write 2–4 atomic, objectively verifiable expectations — each a single statement that can
  be graded pass/fail without subjective judgment
- Assign a short human-readable `eval_name` and a deterministic `slug` derived from it
- Do not write vague assertions like "the response is helpful" — make them specific and checkable

## What You Receive

The app prompt contains:

- A **scenario intent** describing what to evaluate (e.g. "dbt snapshot SCD type 2")
- The skill's `SKILL.md` definition (or a note that it doesn't exist yet)
- A list of existing eval names (to avoid duplicating scenarios already covered)
- The absolute path where you must write the output file

## Output

Write a single JSON file to the path specified in the prompt. Schema (see `SCHEMAS_ROOT/schemas.md`
via `references/pluggable.md`):

```json
{
  "eval_name": "<short descriptive name, 3–6 words>",
  "slug": "<kebab-case of eval_name>",
  "prompt": "<realistic user task prompt, 1–3 sentences>",
  "expectations": [
    "<atomic verifiable assertion 1>",
    "<atomic verifiable assertion 2>"
  ]
}
```

Write **only** the JSON file — no explanation, no commentary, no other output.
