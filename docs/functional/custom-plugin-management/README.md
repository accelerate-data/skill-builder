---
id: custom-plugin-management
title: Custom Plugin Management
shape: journey
persona: FSA
---

# Custom Plugin Management (`custom-plugin-management`)

## Goal

Enable a user to build domain-specific Claude Code skills, validate and refine their behaviour, and distribute them — either as standalone skill archives or as a plugin published to a remote repository that Studio operators can register as a marketplace source.

## Primary Actor

FSA. Typically a consultant, data engineer, or solutions architect building skills for a specific organisation or customer context.

## Trigger

The actor decides to create a new skill tailored to a plugin's domain, or resumes work on an existing plugin to refine, evaluate, or distribute a skill already in progress. The actor may also enter this flow upon receiving a skill gap recommendation from the `ctx-context-retro-agent` flow in Studio.

## Phases

### 1. Plugin Setup

The actor creates a named plugin. A plugin is a namespace that groups related skills under a shared slug, and each plugin maps to a directory in the configured skills repository.

At creation the actor can optionally configure a remote GitHub repository URL as the plugin's publish target. This can also be added or updated at any time after creation.

> Not yet implemented.

### 2. Skill Creation

Within a plugin the actor creates a named skill and supplies intake context: a description, optional tags, industry, function role, and a free-text context block that tells the agent what makes the skill's domain distinctive. Reference documents — uploaded files or URLs — can be attached to provide domain material the agent reads during research.

### 3. Skill-Building Workflow

The skill-building workflow runs in four sequential agent-driven steps.

**Step 0 — Research.** The agent reads the skill context and reference documents and returns an initial set of clarification questions grouped into sections. Each question targets a gap in scope, trigger conditions, output format, or organisation-specific constraints.

**Step 1 — Detailed Research.** The actor answers the clarification questions. An answer-evaluator agent scores each answer and identifies material gaps. A detailed-research agent then reads the answers, the evaluation verdicts, and the clarification record, and appends targeted follow-up questions for answers that are vague, missing, or contradictory. The actor answers these refinements before proceeding.

**Step 2 — Confirm Decisions.** A decisions agent converts the full clarification record — first-round answers and refinements — into a set of actionable build decisions. Each decision captures a design commitment the skill writer must follow: capability scope, trigger conditions, output expectations, exclusions, and edge-case handling. The actor reviews the decisions and can edit them before proceeding.

**Step 3 — Skill Generation.** A skill-writing agent reads the decisions and clarification record and writes the `SKILL.md` file for the skill. The file contains frontmatter, a description, trigger conditions, instructions, and example prompts derived from the decisions.

### 4. Evaluate and Refine

After generation the actor iterates on the skill through a connected evaluate-and-refine loop. The three tools in this phase work together: evaluation surfaces what is wrong, description optimization fixes the trigger, and workflow refinement fixes the skill body.

**Evaluation.** The actor runs the skill against a set of test prompts in the Eval Workbench. Each run reports whether the skill triggered correctly and produced the expected output. The actor can author and iterate on prompt sets independently of the skill-building workflow.

**Description optimization.** When evaluation reveals that the skill is not triggering reliably, the actor can run description optimization. The optimizer generates candidate descriptions for the SKILL.md `description` field — the text that controls when Claude Code triggers the skill — evaluates each candidate against the prompt set, and surfaces the best-performing description for the actor to apply.

**Workflow refinement.** When evaluation reveals that the skill body needs correction, the actor re-enters the skill-building workflow. Refinement re-runs whichever steps are needed — adjusting clarification answers, re-confirming decisions, or regenerating the skill — without restarting from the beginning. The actor then re-evaluates to verify the change.

### 5. Distribution

**Export.** The actor can export any skill as a `.skill` archive. The archive is self-contained and can be imported into another Skill Builder instance or shared directly.

**Publish.** If the plugin has a remote GitHub repository configured, the actor can trigger a publish action. Publish pushes the plugin's current skill files to the remote repository using the GitHub credentials already stored in app settings — the same credentials used for marketplace imports. The entire plugin is the publish unit; individual skill selection is not supported.

Once the remote repository is populated, a Studio administrator can independently add its URL to Studio's marketplace registry so Studio users can discover and import skills from it. Skill Builder does not automate or assist with the Studio-side registry step.

> Not yet implemented.

## Alternate Flows

**Remote repository configured after creation.** The actor can add or update the publish target on any plugin at any time. Publish is available as soon as a remote URL is set and GitHub credentials are present in app settings.

> Not yet implemented.

**Refinement after decisions are confirmed.** If the actor edits clarification answers after decisions have been confirmed, the actor must re-run Step 2 and Step 3 to propagate the changes into the generated skill.

**Description optimization without an eval prompt set.** The optimizer requires at least one prompt set in the Eval Workbench to score candidates. If none exists, the actor must author a prompt set before running optimization.

## Failure Cases

**GitHub credentials absent.** If no GitHub credentials are configured in app settings, the publish action is blocked and the actor is directed to configure credentials.

> Not yet implemented.

**Remote repository unreachable or push rejected.** If the configured URL is invalid or the push fails, the action reports the error. No partial state is written to the remote.

> Not yet implemented.

**Skill-building step fails.** If an agent step returns an error, the workflow surfaces the failure and allows the actor to retry the step without losing earlier work.

## Invariants

- A plugin slug is immutable after creation.
- Publish always pushes the whole plugin; partial plugin publishes are not supported. *(Not yet implemented.)*
- The publish target repository must exist before it can be configured; Skill Builder does not create repositories. *(Not yet implemented.)*
- Evaluation results and description-optimization history are stored locally per skill and are not included in the published plugin or the exported `.skill` archive.

## Inputs

| Input | Source | System |
|---|---|---|
| Plugin name and slug | Actor, at plugin creation | Skill Builder (UI) |
| Remote repository URL | Actor, on plugin settings | Skill Builder (UI) |
| Skill name and intake context | Actor, at skill creation | Skill Builder (UI) |
| Reference documents | Actor, uploaded files or URLs | Skill Builder (UI) |
| Clarification answers | Actor, during Steps 0–1 | Skill Builder (UI) |
| Decision confirmations | Actor, at Step 2 | Skill Builder (UI) |
| Eval prompt set | Actor, in Eval Workbench | Skill Builder (UI) |
| GitHub credentials | App settings (shared with marketplace import) | Skill Builder (app settings) |

## Outputs

| Output | Destination | System |
|---|---|---|
| Clarification question set | Stored per skill; displayed for actor review | Skill Builder (local DB) |
| Build decisions | Stored per skill; passed to skill generation | Skill Builder (local DB) |
| Generated `SKILL.md` | Written to skills repository under plugin slug | Skills repository (local disk) |
| Eval run results | Stored per skill in local database | Skill Builder (local DB) |
| Optimised description | Applied to `SKILL.md` on actor confirmation | Skills repository (local disk) |
| `.skill` archive | Downloaded to actor-chosen path | Actor's filesystem |
| Published plugin | Written to remote GitHub repository | Remote GitHub repository |

## Cross-refs

- `github-import` — reading marketplace plugins from remote GitHub repositories; the complement to plugin publish.
- `ctx-context-retro-agent` (Studio) — surfaces skill gap recommendations to CDO persona; can trigger entry into this flow.
- Studio Marketplace settings — where Studio administrators register remote repository URLs as skill sources (out of scope for Skill Builder).
