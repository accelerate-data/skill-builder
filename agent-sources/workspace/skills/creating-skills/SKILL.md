---
name: creating-skills
description: Use when writing a new reusable skill from clarified requirements, confirmed decisions, examples, constraints, and expected outputs, including SKILL.md, focused references, and fresh-context verification.
---

# Creating Skills

Use this skill when the caller has already gathered enough requirements and
confirmed decisions to generate a durable, reusable skill package. The caller
provides a synthesized generation brief, the destination directory, and any
workflow artifacts that should drive the content. The brief is an orientation
layer; the raw user context, clarification answers, and decision records remain
source material and should be used when exact wording or examples matter.

Do not use this skill for clarification interviews, detailed research, decision
confirmation, benchmark aggregation, blind comparison, release tagging,
workbench eval authoring, or standalone description-candidate generation.

## Inputs

Use the files and paths given by the caller as the source of truth. Typical
inputs are:

- user context describing the requested capability
- clarification questions and user answers
- confirmed decisions
- examples, expected inputs, expected outputs, and edge cases
- the exact output directory for generated skill files

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
- nested `metadata.version` in `SKILL.md` frontmatter, for example:

  ```yaml
  metadata:
    version: "1.0.0"
  ```

- a clear statement of when to use the skill and when not to use it
- the minimum process needed to execute the skill reliably
- input and output expectations
- important constraints, assumptions, and edge cases
- references only when they make the skill easier to maintain or apply

Draft the description carefully as part of generation. Use user phrases,
workflow context, trigger conditions, exclusions, and expected outputs from the
confirmed decisions. The description is the primary trigger surface, so avoid a
generic summary. Do not generate alternate description candidates or ranking
artifacts here; the app Eval Workbench owns that follow-on workflow.

Keep reference files focused. Do not create many tiny files when one compact
reference is easier to use.
Do not create eval cases, eval suggestions, or trigger-prompt drafts during
skill generation. Those belong to the app Eval Workbench after the skill exists.

## Fresh-Context Verification

After generating files, run a fresh-context verifier pass using
`references/verifier-subagent-prompt.md`. Give the verifier only:

- the caller's synthesized generation brief
- the generated `SKILL.md`
- generated references that should be reviewed
- the verifier instructions from `references/verifier-subagent-prompt.md`

Do not invoke a separate validator skill. Verification is owned by this
skill and runs through the reference prompt so the generator-verifier loop stays
inside the skill-writing flow.

If the verifier returns material findings, fix them and run exactly one
re-verification pass. Do not run an unbounded verification loop. If material
findings remain after that one re-verification pass, return the caller's skipped
result and summarize the blocker instead of publishing a weak skill.

## Return

Return the raw JSON object requested by the caller. Include a `call_trace` entry
for the main generation and verification steps so the app can verify that the
generator-verifier loop ran.
