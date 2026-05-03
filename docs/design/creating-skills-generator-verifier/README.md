# Creating Skills Generator-Verifier

> **Status:** Draft

## Overview

Workflow step 3 should generate a shipped skill from already-confirmed
requirements and decisions without carrying the full legacy
`skill-creator` plugin behavior into the OpenHands clean-break path.

The existing plugin skill at
`agent-sources/plugins/skill-creator/skills/skill-creator/SKILL.md` remains
unchanged. It is broad legacy guidance that includes creation, eval review,
improvement loops, blind comparison, and description optimization. The clean
break path should copy only the skill-writing guidance that belongs in step 3
into a new focused skill under `agent-sources/skills`.

The new skill should be a creation-time authoring helper for the single
OpenHands `skill-creator` agent. The app-owned step 3 prompt reads workflow
context files, synthesizes the generation brief, invokes the focused creation
guidance, and expects generated skill files plus base eval definitions.

## Design Scope

**Covers**

- Creating a focused copied skill under `agent-sources/skills`.
- How workflow step 3 passes already-loaded clarification and decision context
  into skill creation.
- The Generator-Verifier loop that validates generated artifacts in fresh
  context before step 3 returns.
- The description drafting responsibility inside generation.
- Base eval definition creation for future human or automated review.

**Does not cover**

- Editing the legacy plugin skill in place.
- Running evals, aggregating benchmarks, or opening review viewers.
- Iterative skill improvement after user feedback.
- Blind comparison.
- Standalone description optimization.
- Changing workflow step 0, step 1, or step 2 behavior.

## Key Decisions

| Decision | Rationale |
|---|---|
| Copy into `agent-sources/skills`, do not mutate the plugin skill. | The legacy plugin remains available for existing plugin paths, while the OpenHands clean-break workflow gets a narrow, auditable creation primitive. |
| Name the focused skill `creating-skills`. | The skill uses gerund naming and describes the action it teaches: writing new skills from confirmed requirements. |
| Keep workflow JSON loading in the step 3 prompt. | `clarifications.json`, `decisions.json`, and `user-context.md` are workflow artifacts. The prompt knows their exact paths and should read them before generation. The skill should receive the synthesized requirements, not rediscover workflow state. |
| Use the same OpenHands `skill-creator` agent. | Clean-break workflow routing varies task prompts and skills, not top-level agent identities. |
| Fold description quality into generation. | Trigger description quality is part of writing a usable skill. It should be handled while drafting `SKILL.md`, not by a separate optimization phase. |
| Keep validation in the copied skill through a Generator-Verifier loop. | Fresh-context validation catches leakage, missing files, weak descriptions, and eval drift before the workflow materializes the generated skill. |
| Create base eval definitions but do not run them. | Step 3 should leave useful test prompts and expectations for later review. Running or improving against evals belongs to later flows. |

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
              ├── generate SKILL.md, references, evals.json
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
  - `{workspace_dir}/evals/evals.json`
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
agent-sources/skills/creating-skills/SKILL.md
```

Its frontmatter should describe when to use it, not the workflow step:

```yaml
---
name: creating-skills
description: Use when writing a new skill from already-clarified requirements, decisions, examples, constraints, and expected outputs, including drafting SKILL.md, shipped references, base eval definitions, and validating generated files.
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
- validation and eval expectations.

The skill should generate:

- `{skill_output_dir}/SKILL.md`
- shipped references under `{skill_output_dir}/references/` only when they add
  reusable value;
- `{eval_dir}/evals.json` with base eval definitions, stable slugs, prompts, and
  fixed expectations.

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
- Base evals exist with stable names, slugs, prompts, and expectations.
- Workflow artifacts such as `clarifications.json` and `decisions.json` do not
  leak into shipped skill instructions.
- No eval execution, benchmark aggregation, review viewer, commit, tag, blind
  comparison, or description optimization artifact was created.

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
    "wrote evals.json",
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
| `agent-sources/skills/creating-skills/SKILL.md` | New focused copied skill. |
| `agent-sources/workspace/agents/skill-creator.md` | Shared OpenHands agent identity and workflow overview. |
| `agent-sources/plugins/skill-creator/agents/skill-writer-agent.md` | Current legacy step 2/3 agent instructions to replace or bypass in the clean-break step 3 path. |
| `agent-sources/prompts/**` | App-owned workflow prompts. Step 3 generation prompt should live here in the clean-break path. |
| `app/agent-tests/**` | Structural tests for agent and skill instruction drift. |
| `tests/evals/packages/skill-creator-generate-skill/**` | Live eval package that should be aligned to the focused generation behavior. |

## Open Questions

- Whether the existing step 3 output schema needs a first-class
  `validation_findings` field, or whether unresolved verifier findings should
  remain terminal errors.
- Whether `agent-sources/skills/**` is already part of the startup deployment
  path for workspace `.agents/skills/**`, or whether the implementation needs
  to add that source directory to deployment.
