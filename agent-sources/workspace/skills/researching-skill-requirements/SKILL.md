---
name: researching-skill-requirements
description: Use when deciding what to research and what clarification questions to ask so user intent, trigger conditions, outputs, examples, edge cases, tests, and dependencies can inform creation or refinement of a skill.
user_invocable: false
---

# Researching Skill Requirements

This skill helps the `skill-creator` agent decide what information is still needed before a skill can be created or refined. It is shared by initial research and detailed follow-up research. Step prompts own the exact JSON envelope, schema path, and merge behavior.

## Core Job

Produce high-value clarification questions for skill-building. Focus on questions whose answers would materially change the future skill's trigger conditions, instructions, examples, inputs, outputs, tests, dependencies, or guardrails.

Do not ask broad interview questions just to fill space. Prefer fewer high-delta questions over a long generic questionnaire.

## Capture Intent

Start by understanding the user's intent from the available workflow context, the user context provided inline, the clarifications provided inline when present, user answers when present, and any supplied reference documents.

Make sure the clarification record can answer:

- What should this skill enable the agent to do?
- When should this skill trigger, including expected user phrases and contexts?
- What input files, systems, tools, documents, or examples should it inspect?
- What output format, artifact contract, schema, naming, or handoff should it produce?
- What edge cases, exclusions, dependencies, or success criteria matter?
- Should test cases verify the skill? Skills with objectively verifiable outputs, such as file transforms, data extraction, code generation, or fixed workflow steps, usually benefit from tests. Skills with subjective outputs, such as writing style or art direction, often do not.

Suggest the appropriate default for tests based on the skill type, but let the user decide.

## Purpose-Specific Lenses

When the requested skill supports data-platform work, choose questions through the lenses that match the purpose:

- Business process knowledge: clarify metrics, business rules, calculation logic, reporting hierarchies, grain, dimensions, lakehouse/dbt modeling implications, reconciliation expectations, edge cases, and exclusions.
- Data engineering standards: clarify data modeling concepts, reconciliation concepts, data quality rules, dbt standards, dlt standards, Fabric Lakehouse standards, operational standards, and deployment conventions.
- Source system customizations: clarify source entities, custom fields, custom statuses or stages, source business logic, extraction constraints, source-to-lakehouse mapping assumptions, and required transformations.
- Platform standards: clarify Fabric or Azure implementation choices, endpoint behavior, workspace and lakehouse conventions, security, deployment, orchestration, and monitoring standards.

For these lenses, preserve the user's domain vocabulary in question text instead of replacing it with generic wording. In particular:

- Data engineering standards questions should explicitly cover the relevant modeling, reconciliation, data quality, dbt, dlt, Fabric Lakehouse, and deployment standards when those concepts appear in the user context.
- Source system customization questions should explicitly cover the relevant source API or export mechanics, CDC, custom fields, custom status or stage values, schema drift, rate limits, extraction behavior, ingestion behavior, and transformations when those concepts appear in the user context.

## Invariants

1. Do not ask about CSV, JSON, or user-provided file formats unless the skill's purpose is explicitly source extraction, file ingestion, or file handling.
3. Do not ask about reporting formats like Dashboards, Charts unless the skill's purpose is explicitly about presentation of analytical data.
4. Data will be always extracted from the systems of record and stored in the lakehouse following the medallion architecture.
5. For business-process skills, ask about conceptual source entities, metric semantics, modeling implications, and validation instead.

## Scope Guard

Privately assess whether the available context is useful enough for skill-building before adding questions.

Trigger the scope guard when:

- Context is missing, placeholder text, or unrelated to reusable agent behavior.
- The request is a one-off task rather than a reusable technique, pattern, reference, or workflow.
- The request is purely mechanical and should be enforced by validation or code instead of documented as a skill.
- The topic is too broad for one skill and needs narrowing.
- Candidate questions would mostly ask for generic best practices that the model or current documentation can already answer.
- Existing answers are sufficient and no material skill-building gap remains.

Do not trigger the scope guard merely because the context is detailed or names many domain concepts. In initial research, ask questions whenever the available context does not explicitly settle the core intent, trigger conditions, expected outputs, test expectations, edge cases, exclusions, and purpose-specific decisions that would govern the final skill.

When the scope guard triggers, do not manufacture questions. Follow the current step prompt for the exact output shape, warning fields, and preservation rules.

## Research And Interview

Distinguish user-owned decisions from researchable facts.

- Ask the user about organization-specific rules, preferences, examples, exceptions, trigger contexts, and expected outputs.
- Research public or tool-specific facts when that reduces burden on the user, such as current vendor behavior, API syntax, known best practices, or similar skill patterns.
- Do not use public research to replace organization-specific answers.
- Check available MCPs when they are useful for searching docs, finding similar skills, inspecting examples, or looking up best practices.
- Use parallel research via subagents if that capability is available; otherwise research inline.

Come prepared with context. A good question should show enough understanding that the user can answer quickly and confidently.

## Candidate Question Quality

Good candidate questions clarify one of these:

- Capability: what the skill should enable the agent to do.
- Triggering: when future agents should load the skill.
- Inputs: files, systems, documents, tools, schemas, or examples to inspect.
- Outputs: format, artifact location, schema, naming, or downstream handoff.
- Process: ordered steps, decision rules, approvals, exceptions, or failure handling.
- Standards: organization-specific conventions, quality gates, review criteria, testing expectations, or platform constraints.
- Examples: representative good and bad cases.
- Validation: tests, evals, smoke checks, or manual review criteria.

Drop questions whose answer would not change the skill's behavior, examples, triggering, or validation.

## Clarifications Model

Use the canonical clarification model described by the active step prompt and shared schema reference.

Initial research should create top-level sections and questions. Detailed follow-up research should preserve the existing clarification record and append only the sections, questions, or refinements needed to close material gaps.

In both modes:

- Keep questions concrete and answerable.
- Prefer single-select decision questions when the UI expects choices.
- Include an "Other (please specify)" option when choices are presented.
- Do not reopen settled areas.
- Do not duplicate existing questions.
- Keep notes separate from evaluator notes.

Return exactly the object requested by the current step prompt.
