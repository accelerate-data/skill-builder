---
name: creating-skills
description: Use when writing a new reusable skill from clarified requirements, confirmed decisions, examples, constraints, and expected outputs, including SKILL.md, focused references, base eval definitions, and fresh-context verification.
---

# Creating Skills

Use this skill when the caller has already gathered enough requirements and
confirmed decisions to generate a durable, reusable skill package. The caller
provides the generation brief, the destination directory, and any workflow
artifacts that should drive the content.

Do not use this skill for clarification interviews, detailed research, decision
confirmation, running evals, benchmark aggregation, blind comparison, release
tagging, or description-only optimization.

## Inputs

Use the files and paths given by the caller as the source of truth. Typical
inputs are:

- user context describing the requested capability
- clarification questions and user answers
- confirmed decisions
- examples, expected inputs, expected outputs, and edge cases
- the exact output directory for generated skill files
- the exact eval definitions path, when evals are expected

Use progressive, demand-driven reading. Start with the caller's brief and
confirmed decisions, then read supporting files only when they are needed to
preserve wording, examples, edge cases, or output details.

If the inputs conflict, prefer confirmed decisions over earlier clarifications.
If a material conflict blocks generation, return a skipped result to the caller
instead of inventing a rule.

## Generate

Create the skill package in the caller-provided output directory.

Write `SKILL.md` first. Keep it operational: future agents should be able to
recognize when the skill applies and execute the workflow without reading the
original conversation.

The generated skill should include:

- concise frontmatter with a trigger-focused `description`
- a clear statement of when to use the skill and when not to use it
- the minimum process needed to execute the skill reliably
- input and output expectations
- important constraints, assumptions, and edge cases
- references only when they make the skill easier to maintain or apply
- eval definitions when outputs can be checked objectively

Draft the description carefully as part of generation. Use user phrases,
workflow context, trigger conditions, exclusions, and expected outputs from the
confirmed decisions. The description is the primary trigger surface, so avoid a
generic summary.

Keep reference files focused. Do not create many tiny files when one compact
reference is easier to use.

## Eval Creation

Create base eval definitions when the skill has objectively verifiable behavior,
such as file transforms, data extraction, structured output, code generation, or
fixed workflow steps.

Write eval definitions only to the exact eval path provided by the caller. If
that parent directory does not exist yet, create it before writing the file. Do
not invent a different eval path and do not place app eval definitions inside
the generated skill package unless the caller explicitly asks for that.

Do not run evals from this skill. The caller decides when to run quality gates.

For subjective skills, document why an automated eval is not useful and include
manual review criteria if the caller expects them. Do not create a placeholder
eval file for subjective skills unless the caller explicitly requires one.

## Fresh-Context Verification

After generating files, spawn a fresh-context verifier subagent. Give it only:

- the caller's generation brief
- the generated `SKILL.md`
- generated references or eval definitions that should be reviewed
- the caller-provided eval path, when evals were expected
- the verifier instructions from `references/verifier-subagent-prompt.md`

Do not invoke a separate validator skill. Verification is owned by this
skill and runs through the reference prompt so the generator-verifier loop stays
inside the skill-writing flow.

If the verifier returns material findings, fix them and run the verifier again.
Repeat until the verifier passes or only minor findings remain that are
explicitly documented in the result.

## Return

Return the raw JSON object requested by the caller. Include a `call_trace` entry
for the main generation and verification steps so the app can verify that the
generator-verifier loop ran.
