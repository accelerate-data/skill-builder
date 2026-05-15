---
name: creating-skills
description: Use when writing a new reusable skill from clarified requirements, confirmed decisions, examples, constraints, and expected outputs, including SKILL.md, focused references, and fresh-context verification.
---

# Creating Skills

Use this skill when the caller has already gathered enough requirements and confirmed decisions to generate a durable, reusable skill package. The caller provides a synthesized generation brief, the destination directory, and any workflow artifacts that should drive the content. The brief is an orientation layer; the raw user context, clarification answers, and decision records remain source material and should be used when exact wording or examples matter.

Do not use this skill for clarification interviews, detailed research, decision confirmation, benchmark aggregation, blind comparison, release tagging, workbench eval authoring, or standalone description-candidate generation.

## Inputs

Use the files and paths given by the caller as the source of truth. Typical inputs are:

- user context describing the requested capability
- clarification questions and user answers
- confirmed decisions
- examples, expected inputs, expected outputs, and edge cases
- the exact output directory for generated skill files

Use progressive, demand-driven reading. Start with the caller's brief and confirmed decisions, then read supporting files only when they are needed to preserve wording, examples, edge cases, or output details.

If the inputs conflict, prefer confirmed decisions over earlier clarifications. If a material conflict blocks generation, return a skipped result to the caller instead of inventing a rule.

## Generate

Create the skill package in the caller-provided output directory.

Write `SKILL.md` first. Keep it operational: future agents should be able to recognize when the skill applies and execute the workflow without reading the original conversation.

The generated skill should include:

- concise frontmatter with a trigger-focused `description`
- a clear statement of when to use the skill and when not to use it
- the minimum process needed to execute the skill reliably
- input and output expectations
- important constraints, assumptions, and edge cases
- references only when they make the skill easier to maintain or apply

Draft the description carefully as part of generation. Use user phrases, workflow context, trigger conditions, exclusions, and expected outputs from the confirmed decisions. The description is the primary trigger surface, so avoid a generic summary. Do not generate alternate description candidates or ranking artifacts here; the app Eval Workbench owns that follow-on workflow.

Keep reference files focused. Do not create many tiny files when one compact reference is easier to use.
Do not create eval cases, eval suggestions, or trigger-prompt drafts during skill generation. Those belong to the app Eval Workbench after the skill exists.

## Fresh-Context Verification

After generating files, launch the `skill-verifier` subagent for the verifier pass. Do not run the verifier inline in the same agent context.

Build the subagent prompt from `references/verifier-subagent-prompt.md`. Include only:

- the caller's synthesized generation brief
- the generated `SKILL.md`
- generated references that should be reviewed
- the verifier instructions from `references/verifier-subagent-prompt.md`

Do not pass the full workflow conversation history into the subagent prompt.

If the verifier returns material findings, fix them and run exactly one re-verification pass. Return the final verifier result from that last verifier pass in `verifier_result`. Do not run an unbounded verification loop. If material findings remain after that one re-verification pass, return the caller's skipped result and summarize the blocker instead of publishing a weak skill.

## Return

Return the raw JSON object requested by the caller. Unless the caller overrides it, the expected shape is:

```json
{
  "status": "generated",
  "benchmark_path": null,
  "skipped": false,
  "commit_summary": "one concise sentence describing generated files",
  "verifier_result": {
    "status": "pass",
    "findings": []
  },
  "call_trace": [
    "read-user-context",
    "read-decisions",
    "read-clarifications",
    "synthesize-generation-brief",
    "use-creating-skills",
    "write-skill",
    "write-references",
    "fresh-context-verifier-review"
  ]
}
```

`call_trace` must be a non-empty array of string values. Do not return objects inside `call_trace`.
If you include `verifier_result`, mirror the final `skill-verifier` result exactly. Use `{ "status": "pass", "findings": [] }` after a clean verifier pass, or `{ "status": "needs_fix", "findings": [ ... ] }` when returning a skipped result because material findings remain after the single re-verification pass.
