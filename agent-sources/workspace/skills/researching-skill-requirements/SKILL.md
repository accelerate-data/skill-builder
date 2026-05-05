---
name: researching-skill-requirements
description: Use when deciding what to research and what clarification questions to ask so user intent, trigger conditions, examples, edge cases, dependencies, and guardrails can inform creation or refinement of a skill.
user_invocable: false
---

# Researching Skill Requirements

This skill helps the `skill-creator` agent decide what information is still needed before a skill can be created or refined. It is shared by initial research and detailed follow-up research. Step prompts own the exact JSON envelope, schema path, and merge behavior.

## Core Job

Produce high-value clarification questions for skill-building. Focus on questions whose answers would materially change the future skill's trigger conditions, instructions, examples, inputs, workflow decisions, dependencies, or guardrails.

Do not ask broad interview questions just to fill space. Prefer fewer high-delta questions over a long generic questionnaire.

## Capture Intent

Start by understanding the user's intent from the available workflow context, the user context provided inline, the clarifications provided inline when present, user answers when present, and any supplied reference documents.

Make sure the clarification record can answer:

- What should this skill enable the agent to do?
- When should this skill trigger, including expected user phrases and contexts?
- What input files, systems, tools, documents, or examples should it inspect?
- What workflow decisions, edge cases, exclusions, dependencies, or success criteria matter?

## Invariants

1. Do not ask about output formats, artifact contracts, schemas, naming contracts, naming layouts, or presentation layouts for this skill family.
2. Do not ask the user to design test cases, eval cases, or validation suites. Eval design belongs to the separate evaluation workflow.
3. Do not ask about harness-owned platform concerns: workspace naming, lakehouse naming, security boundaries, deployment topology, monitoring, managed identity or access model, endpoint behavior, environment promotion, or model organization.
4. Do not ask about CSV, JSON, or user-provided file formats unless the skill's purpose is explicitly source extraction, file ingestion, or file handling.
5. Do not ask about reporting formats such as dashboards or charts unless the skill's purpose is explicitly about presenting analytical data.
6. Preserve the user's domain vocabulary in question text instead of replacing it with generic abstractions.
7. Prefer questions about semantics, rules, transformations, constraints, grain, lineage, reconciliation, and operational behavior over deliverable formatting.
8. Ask only questions whose answers would materially change the skill's trigger conditions, reusable workflow, decision rules, assumptions, or guardrails.

## Defaults

- Assume these skills are used to build durable data engineering pipelines, not one-off deliverables.
- Assume data is extracted from systems of record and stored in the lakehouse following the medallion architecture unless the user context explicitly says otherwise.
- Assume workspace naming, lakehouse naming, security, deployment topology, monitoring, endpoint behavior, identity, and environment promotion are set by the harness unless the user context explicitly says the skill is about consuming an already-fixed contract.
- For business-process skills, default toward conceptual source entities, metric semantics, modeling implications, reconciliation expectations, and validation logic rather than extraction mechanics.
- For business-process skills, do not ask where raw system data lives or which extraction path loads it unless the user context explicitly makes source system semantics or ingestion mechanics part of the skill.
- For source-system-semantics skills, default toward business rules, custom semantics, flexfields, custom objects, stages, workflows, and mapping assumptions. Ask extraction mechanics only when the source is DB-based or legacy, or when the user context explicitly makes replication or ingestion behavior material.
- Treat eval design as downstream work. Research should gather the domain and workflow decisions that later evaluation can validate.

## Purpose-Specific Lenses

When the requested skill supports data-platform work, choose questions through the lenses that match the purpose:

- Business process knowledge: clarify metrics, business rules, calculation logic, reporting hierarchies, grain, dimensions, lakehouse/dbt modeling implications, reconciliation expectations, edge cases, and exclusions.
- Data engineering standards: clarify data modeling concepts, reconciliation concepts, data quality rules, dbt standards, dlt standards, Fabric Lakehouse standards, naming conventions, operational standards, and deployment conventions that affect skill behavior.
- Source system semantics: clarify source entities, source business rules, flexfields, custom fields, custom objects, custom statuses or stages, source-specific semantics, source-to-lakehouse mapping assumptions, and required transformations.

For these lenses, preserve the user's domain vocabulary in question text instead of replacing it with generic wording. In particular:

- Business-process questions should prioritize business semantics, modeling implications, and reconciliation logic rather than upstream raw-data location, ingestion paths, or API mechanics.
- Data engineering standards questions should explicitly cover the relevant modeling, reconciliation, data quality, dbt, dlt, Fabric Lakehouse, and deployment standards when those concepts appear in the user context.
- Source system semantics questions should explicitly cover business rules, flexfields, custom fields, custom objects, custom status or stage values, semantic mappings, ingestion behavior, and transformations when those concepts appear in the user context.
- Source system semantics questions should cover source API or export mechanics, CDC, delete handling, schema drift, rate limits, extraction behavior, or replication behavior only when the source is DB-based or legacy, or when the user context explicitly says those mechanics materially affect the skill.

## Scope Guard

Privately assess whether the available context is useful enough for skill-building before adding questions.

Trigger the scope guard when:

- Context is missing, placeholder text, or unrelated to reusable agent behavior.
- The request is a one-off task rather than a reusable technique, pattern, reference, or workflow.
- The request is purely mechanical and should be enforced by validation or code instead of documented as a skill.
- The topic is too broad for one skill and needs narrowing.
- Candidate questions would mostly ask for generic best practices that the model or current documentation can already answer.
- Existing answers are sufficient and no material skill-building gap remains.

Do not trigger the scope guard merely because the context is detailed or names many domain concepts. In initial research, ask questions whenever the available context does not explicitly settle the core intent, trigger conditions, workflow decisions, edge cases, exclusions, defaults, and purpose-specific decisions that would govern the final skill.

When the scope guard triggers, do not manufacture questions. Follow the current step prompt for the exact output shape, warning fields, and preservation rules.

## Research And Interview

Distinguish user-owned decisions from researchable facts.

- Ask the user about organization-specific rules, preferences, examples, exceptions, trigger contexts, workflow decisions, and domain constraints.
- Do not ask the user to specify output formats, artifact schemas, naming conventions, or test/eval cases in this research workflow.
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
- Process: ordered steps, decision rules, approvals, exceptions, or failure handling.
- Standards: organization-specific conventions, quality gates, review criteria, or operational constraints that change the skill's logic.
- Examples: representative good and bad cases.
- Validation semantics: reconciliation expectations, correctness checks, or review criteria that affect the skill's logic without turning research into eval design.

Drop questions whose answer would not change the skill's behavior, examples, triggering, assumptions, or validation semantics.
For business-process and data-engineering standards skills, drop questions about raw-data location, extraction paths, delivery format, workspace naming, lakehouse naming, or harness-owned deployment/security concerns unless the user context explicitly makes those part of the skill's purpose.
Drop generic audience or persona questions when unresolved domain rules, standards, transformations, or operational constraints would change the skill more materially.

## Clarifications Model

Use the canonical clarification model described by the active step prompt and shared schema reference.

Initial research should create top-level sections and questions. Detailed follow-up research should preserve the existing clarification record and append only the sections, questions, or refinements needed to close material gaps.

In both modes:

- Keep questions concrete and answerable.
- Prefer single-select decision questions when the UI expects choices. Use 3-5 concrete choices per question.
- When all listed choices could simultaneously apply, include an "All of the above" option as the penultimate choice (before "Other (please specify)").
- Include an "Other (please specify)" option when choices are presented.
- Do not reopen settled areas.
- Do not duplicate existing questions.
- Keep notes separate from evaluator notes.

Return exactly the object requested by the current step prompt.
