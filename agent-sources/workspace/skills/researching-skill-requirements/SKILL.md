---
name: researching-skill-requirements
description: Use when deciding what to research and what clarification questions to ask so user intent, trigger conditions, outputs, examples, edge cases, tests, and dependencies can inform creation or refinement of a skill.
user_invocable: false
---

# Researching Skill Requirements

This skill helps the `skill-creator` agent decide what information is still
needed before a skill can be created or refined. It is shared by initial
research and detailed follow-up research. Step prompts own the exact JSON
envelope, schema path, and merge behavior.

## Core Job

Produce high-value clarification questions for skill-building. Focus on
questions whose answers would materially change the future skill's trigger
conditions, instructions, examples, inputs, outputs, tests, dependencies, or
guardrails.

Do not ask broad interview questions just to fill space. Prefer fewer
high-delta questions over a long generic questionnaire.

## Capture Intent

Start by understanding the user's intent from the available workflow context,
`user-context.md`, the current `clarifications.json` when present, user answers
when present, and any supplied reference documents.

Make sure the clarification record can answer:

- What should this skill enable Claude to do?
- When should this skill trigger, including expected user phrases and contexts?
- What input files, systems, tools, documents, or examples should it inspect?
- What output format, artifact contract, schema, naming, or handoff should it
  produce?
- What edge cases, exclusions, dependencies, or success criteria matter?
- Should test cases verify the skill? Skills with objectively verifiable
  outputs, such as file transforms, data extraction, code generation, or fixed
  workflow steps, usually benefit from tests. Skills with subjective outputs,
  such as writing style or art direction, often do not.

Suggest the appropriate default for tests based on the skill type, but let the
user decide.

## Scope Guard

Privately assess whether the available context is useful enough for
skill-building before adding questions.

Trigger the scope guard when:

- Context is missing, placeholder text, or unrelated to reusable agent behavior.
- The request is a one-off task rather than a reusable technique, pattern,
  reference, or workflow.
- The request is purely mechanical and should be enforced by validation or code
  instead of documented as a skill.
- The topic is too broad for one skill and needs narrowing.
- Candidate questions would mostly ask for generic best practices that the
  model or current documentation can already answer.
- Existing answers are sufficient and no material skill-building gap remains.

When the scope guard triggers, do not manufacture questions. Follow the current
step prompt for the exact output shape, warning fields, and preservation rules.

## Research And Interview

Distinguish user-owned decisions from researchable facts.

- Ask the user about organization-specific rules, preferences, examples,
  exceptions, trigger contexts, and expected outputs.
- Research public or tool-specific facts when that reduces burden on the user,
  such as current vendor behavior, API syntax, known best practices, or similar
  skill patterns.
- Do not use public research to replace organization-specific answers.
- Check available MCPs when they are useful for searching docs, finding similar
  skills, inspecting examples, or looking up best practices.
- Use parallel research via subagents if that capability is available;
  otherwise research inline.

Come prepared with context. A good question should show enough understanding
that the user can answer quickly and confidently.

## Candidate Question Quality

Good candidate questions clarify one of these:

- Capability: what the skill should enable Claude to do.
- Triggering: when future agents should load the skill.
- Inputs: files, systems, documents, tools, schemas, or examples to inspect.
- Outputs: format, artifact location, schema, naming, or downstream handoff.
- Process: ordered steps, decision rules, approvals, exceptions, or failure
  handling.
- Standards: organization-specific conventions, quality gates, review criteria,
  testing expectations, or platform constraints.
- Examples: representative good and bad cases.
- Validation: tests, evals, smoke checks, or manual review criteria.

Drop questions whose answer would not change the skill's behavior, examples,
triggering, or validation.

## Clarifications Model

Use the canonical clarification model described by the active step prompt and
shared schema reference.

Initial research should create top-level sections and questions. Detailed
follow-up research should preserve the existing clarification record and append
only the sections, questions, or refinements needed to close material gaps.

In both modes:

- Keep questions concrete and answerable.
- Prefer single-select decision questions when the UI expects choices.
- Include an "Other (please specify)" option when choices are presented.
- Do not reopen settled areas.
- Do not duplicate existing questions.
- Keep notes separate from evaluator notes.

Return exactly the object requested by the current step prompt.
