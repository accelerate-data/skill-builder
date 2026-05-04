# Creating Skills Generator-Verifier

> **Status:** Draft

## Overview

Workflow step 3 should generate a shipped skill from already-confirmed
requirements and decisions without carrying the full legacy
`skill-creator` plugin behavior into the OpenHands clean-break path.

The existing plugin skill at
`agent-sources/plugins/skill-creator/skills/skill-creator/SKILL.md` remains
unchanged. It is broad legacy guidance that includes creation, eval review,
improvement loops, blind comparison, and trigger-description candidate work. The clean
break path should copy only the skill-writing guidance that belongs in step 3
into a focused runtime skill under `agent-sources/workspace/skills`.

The new skill should be a creation-time authoring helper for the single
OpenHands `skill-creator` agent. The app-owned step 3 prompt reads workflow
context files, synthesizes the generation brief, invokes the focused creation
guidance, and expects generated skill files. Durable eval cases are owned by the
app Eval Workbench after generation, not by step 3.

## Design Scope

**Covers**

- Creating a focused runtime skill under `agent-sources/workspace/skills`.
- How workflow step 3 passes already-loaded clarification and decision context
  into skill creation.
- The Generator-Verifier loop that validates generated artifacts in fresh
  context before step 3 returns.
- The description drafting responsibility inside generation.
- The hard boundary that step 3 does not create or suggest eval content.

**Does not cover**

- Editing the legacy plugin skill in place.
- Running evals, aggregating benchmarks, or opening review viewers.
- Iterative skill improvement after user feedback.
- Blind comparison.
- Standalone trigger-description candidate generation or ranking.
- Changing workflow step 0, step 1, or step 2 behavior.

## Key Decisions

| Decision | Rationale |
|---|---|
| Copy into `agent-sources/workspace/skills`, do not mutate the plugin skill. | The legacy plugin remains available for plugin-specific flows, while the OpenHands clean-break workflow gets a narrow, auditable creation primitive deployed with the runtime workspace. |
| Name the focused skill `creating-skills`. | The skill uses gerund naming and describes the action it teaches: writing new skills from confirmed requirements. |
| Keep workflow JSON loading in the step 3 prompt. | `clarifications.json`, `decisions.json`, and `user-context.md` are workflow artifacts. The prompt knows their exact paths and should read them before generation. The skill should receive the synthesized requirements, not rediscover workflow state. |
| Use the same OpenHands `skill-creator` agent. | Clean-break workflow routing varies task prompts and skills, not top-level agent identities. |
| Fold description quality into generation. | Trigger description quality is part of writing a usable skill. It should be handled while drafting `SKILL.md`, not by a separate candidate-generation flow. |
| Keep validation in the copied skill through a Generator-Verifier loop. | Fresh-context validation catches leakage, missing files, and weak descriptions before the workflow materializes the generated skill. |
| Keep eval creation out of step 3. | Step 3 should not create generation-owned eval artifacts or semi-structured eval suggestions. The app Eval Workbench owns durable prompt cases, assertions, runs, and trigger-description candidates after generation. |

## Target Runtime Shape

```text
workflow step 3
  └── app-owned prompt
      ├── read user-context.md
      ├── read context/decisions.json
      ├── read context/clarifications.json when needed
      ├── synthesize generation brief
      └── OpenHands Agent(name: skill-creator)
          └── use creating-skills guidance
              ├── generate SKILL.md and references
              ├── draft trigger description carefully
              ├── spawn fresh-context verifier subagent
              ├── fix material findings
              └── re-verify once if fixes were made
```

The prompt is responsible for workflow file access because it owns the exact
task context. The copied skill is responsible for how to create and verify a
skill once the requirements are available.

## Step 3 Prompt Contract

The step 3 prompt should give the `skill-creator` agent enough task framing to
avoid generic ReAct exploration:

- The agent is writing a skill named `<skill_name>`.
- The workflow already asked clarification questions and confirmed decisions.
- The prompt gives exact paths for:
  - `{workspace_dir}/user-context.md`
  - `{workspace_dir}/context/clarifications.json`
  - `{workspace_dir}/context/decisions.json`
  - `{skill_output_dir}/SKILL.md`
  - `{skill_output_dir}/references/`
- The prompt instructs the agent to read the workflow JSONs and produce a
  concise generation brief from them.
- The prompt instructs the agent to use the focused `creating-skills` guidance
  for authoring and verification.
- The prompt returns the existing step 3 JSON result shape only.

The prompt should not ask the skill to locate workflow files. It should also
not expose workflow artifacts in the shipped skill content.

## `creating-skills` Skill Contract

The copied skill should live at:

```text
agent-sources/workspace/skills/creating-skills/SKILL.md
```

Its frontmatter should describe when to use it, not the workflow step:

```yaml
---
name: creating-skills
description: Use when writing a new skill from already-clarified requirements, decisions, examples, constraints, and expected outputs, including drafting SKILL.md, shipped references, and validating generated files.
---
```

The body should focus on the "Creating a skill" guidance from the legacy skill
and should explicitly omit lifecycle flows. It should assume the caller already
provided:

- skill name and output directory;
- requirements and decisions;
- trigger contexts and exclusions;
- expected outputs;
- tools or external resources the skill may need;
- validation expectations.

The skill should generate:

- `{skill_output_dir}/SKILL.md`
- shipped references under `{skill_output_dir}/references/` only when they add
  reusable value.

It should not create `evals/evals.json`, iteration folders, review HTML, or
Promptfoo config files during skill generation. It should also avoid prompt
cases, assertion ideas, trigger/non-trigger eval examples, or manual eval
criteria. It should not generate alternate descriptions or ranking notes either.
Eval creation and trigger-description experiments are explicit app Eval
Workbench workflows after the skill exists.

## Generator-Verifier Loop

The loop belongs in `creating-skills` because it is part of creating a high
quality skill, not part of workflow JSON parsing.

1. Generate the skill artifacts from the caller-provided brief.
2. Draft the `description` carefully as a trigger surface:
   - when to use the skill;
   - relevant user phrases or contexts;
   - exclusions where the skill should not load;
   - expected output shape when that affects triggering.
3. Spawn a fresh-context verifier subagent.
4. Give the verifier only:
   - the generated artifacts;
   - the synthesized requirements and decisions;
   - the validation checklist.
5. Fix material verifier findings.
6. Re-run the verifier once if material fixes were made.
7. Stop after the second verification pass and return the generated result.

The verifier should not receive the full workflow conversation. It should review
the artifact as a future agent would see it.

## Verifier Checklist

The verifier should check:

- `SKILL.md` frontmatter is valid.
- `name` follows skill naming guidance.
- `description` is trigger-focused rather than a workflow summary.
- The body implements the confirmed decisions and expected outputs.
- Required tools, inputs, outputs, and constraints are clear.
- Reference files are necessary, linked, and shipped under `references/`.
- Workflow artifacts such as `clarifications.json` and `decisions.json` do not
  leak into shipped skill instructions.
- No eval definitions, eval suggestions, iteration folders, Promptfoo configs,
  eval execution, benchmark aggregation, review viewer, commit, tag, blind
  comparison, or trigger-description candidate artifact was created.

## Output And Failure Behavior

Step 3 should keep its existing JSON envelope:

```json
{
  "status": "generated",
  "commit_summary": "Create <skill-name> skill with SKILL.md and reference files",
  "version_bump": "1.0.0",
  "call_trace": [
    "read user context",
    "read decisions",
    "read clarifications when needed",
    "used creating-skills",
    "wrote SKILL.md",
    "verified generated files"
  ]
}
```

If verifier findings remain after the second pass, step 3 should fail before
materialization unless the existing workflow contract has an explicit non-fatal
warning channel. A generated skill that is known to violate the checklist should
not be silently accepted.

## Source Files

| Path | Role |
|---|---|
| `agent-sources/plugins/skill-creator/skills/skill-creator/SKILL.md` | Legacy source material. Keep unchanged. |
| `agent-sources/workspace/skills/creating-skills/SKILL.md` | Focused runtime skill deployed into the OpenHands workspace. |
| `agent-sources/workspace/agents/skill-creator.md` | Shared OpenHands agent identity and workflow overview. |
| `agent-sources/plugins/skill-creator/agents/skill-writer-agent.md` | Current legacy step 2/3 agent instructions to replace or bypass in the clean-break step 3 path. |
| `agent-sources/prompts/**` | App-owned workflow prompts. Step 3 generation prompt should live here in the clean-break path. |
| `app/agent-tests/**` | Structural tests for agent and skill instruction drift. |
| `tests/evals/packages/skill-creator-generate-skill/**` | Live eval package that should be aligned to the focused generation behavior. |

## Open Questions

- Whether the existing step 3 output schema needs a first-class
  `validation_findings` field, or whether unresolved verifier findings should
  remain terminal errors.
- Whether the verifier result should surface richer machine-readable findings
  than the current skipped/result summary.
