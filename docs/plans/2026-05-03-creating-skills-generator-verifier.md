# Creating Skills Generator-Verifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a focused OpenHands skill-writing path for workflow step 3 by
copying only the creation guidance into `agent-sources/skills/creating-skills`
and updating generation to use a Generator-Verifier loop.

**Architecture:** Keep one OpenHands top-level agent, `skill-creator`. The
app-owned step 3 prompt reads `user-context.md`, `clarifications.json`, and
`decisions.json`, then passes a synthesized generation brief into the
`creating-skills` guidance. The copied skill writes `SKILL.md`, shipped
references, and base eval definitions, then validates the generated artifacts
with a fresh-context verifier subagent before returning.

**Design doc:** `docs/design/creating-skills-generator-verifier/README.md`

**Tech Stack:** OpenHands AgentSkills, app-owned prompt templates, Tauri Rust
workflow commands, agent structural tests, Promptfoo live evals.

---

## Linear And Branch Contract

- Parent issue: `VU-1145`
- Create a child Linear issue for this plan before implementation.
- Implement in a child branch/worktree off
  `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`.
- Raise the implementation PR against
  `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`.

Suggested implementation branch after the issue exists:

```bash
cd /Users/hbanerjee/src/worktrees/feature/vu-1145-implement-openhands-native-clean-break-agent-runtime
./scripts/worktree.sh feature/<issue-id>-creating-skills-generator-verifier
```

## Scope

**In scope**

- Add `agent-sources/skills/creating-skills/SKILL.md`.
- Keep
  `agent-sources/plugins/skill-creator/skills/skill-creator/SKILL.md`
  unchanged.
- Copy and narrow only the creation guidance needed to write new skills.
- Add the Generator-Verifier loop to the copied skill.
- Fold description drafting quality into skill generation.
- Create base eval definitions without running them.
- Update step 3 clean-break prompt wiring to use the focused creation skill.
- Add structural and eval coverage for the new contract.

**Out of scope**

- Running generated evals.
- Benchmark aggregation or review viewer generation.
- Iterative improvement loops.
- Blind comparison.
- Standalone description optimization.
- Refine/rewrite behavior.
- Changing step 0, step 1, or step 2 semantics.

## Current Code To Review

- `agent-sources/plugins/skill-creator/skills/skill-creator/SKILL.md`
  - Source material only. Do not edit.
- `agent-sources/workspace/skills/skill-creator/SKILL.md`
  - Current deployed broad skill. It includes lifecycle sections that should
    not govern clean-break step 3.
- `agent-sources/workspace/agents/skill-creator.md`
  - Shared OpenHands agent identity and workflow overview.
- `agent-sources/plugins/skill-creator/agents/skill-writer-agent.md`
  - Current step 2/3 instructions. Step 3 still says to follow the broad
    `skill-creator` skill.
- `agent-sources/prompts/**`
  - App-owned prompt location for clean-break workflow prompts.
- `app/agent-tests/**`
  - Structural tests for agent files, prompt rules, and skill layout.
- `tests/evals/packages/skill-creator-generate-skill/**`
  - Live eval package for step 3 generation behavior.

## Task 1: Add Failing Structural Coverage

- [ ] **Step 1: Add a structural test for the focused skill**

Add coverage under `app/agent-tests/**` asserting:

- `agent-sources/skills/creating-skills/SKILL.md` exists.
- frontmatter `name` is `creating-skills`.
- the description is trigger-oriented and does not mention workflow step
  numbers.
- the skill includes the Generator-Verifier loop.
- the skill requires fresh-context verifier review.
- the skill instructs re-verification once after material fixes.

- [ ] **Step 2: Add forbidden legacy lifecycle assertions**

Assert the copied skill does not include or instruct:

- `run_loop.py`
- `generate_report.py`
- `Blind comparison`
- `Description Optimization`
- benchmark aggregation
- running evals
- committing or tagging generated skills

- [ ] **Step 3: Add prompt contract assertions for step 3**

Add or update tests proving the step 3 prompt:

- points to exact paths for `user-context.md`, `clarifications.json`, and
  `decisions.json`;
- tells the agent to synthesize a generation brief from those files;
- tells the agent to use `creating-skills`;
- does not tell `creating-skills` to discover workflow JSON files itself;
- keeps the existing step 3 JSON return shape.

- [ ] **Step 4: Confirm tests fail before implementation**

Run:

```bash
cd app && npm run test:agents:structural
```

Expected before implementation: structural tests fail because
`creating-skills` does not exist and step 3 still references the broad
`skill-creator` guidance.

## Task 2: Add The Focused Copied Skill

- [ ] **Step 1: Create `agent-sources/skills/creating-skills/SKILL.md`**

Use frontmatter:

```yaml
---
name: creating-skills
description: Use when writing a new skill from already-clarified requirements, decisions, examples, constraints, and expected outputs, including drafting SKILL.md, shipped references, base eval definitions, and validating generated files.
---
```

- [ ] **Step 2: Copy only creation-relevant guidance**

Use the existing "Creating a skill" section as source material, but rewrite it
around this clean-break contract:

- caller supplies requirements and decisions;
- do not interview or rediscover intent;
- generate shipped skill files only;
- create references only when reusable value justifies them;
- create base eval definitions with stable slugs and frozen expectations;
- draft the `description` as a trigger surface.

- [ ] **Step 3: Add explicit exclusions**

State that the skill must not:

- run evals;
- run benchmark aggregation;
- create review HTML;
- optimize descriptions as a separate phase;
- run blind comparison;
- modify git state;
- create release or packaging artifacts;
- include workflow artifacts in shipped skill text.

## Task 3: Encode The Generator-Verifier Loop

- [ ] **Step 1: Add the generator pass**

The generator pass should write:

- `{skill_output_dir}/SKILL.md`
- `{skill_output_dir}/references/*` when needed
- `{eval_dir}/evals.json`

It should use the caller-provided brief and should not read
`clarifications.json` or `decisions.json` by itself.

- [ ] **Step 2: Add the verifier subagent contract**

The skill should spawn a verifier subagent in fresh context with only:

- generated artifacts;
- the synthesized requirements and decisions;
- the verifier checklist.

The verifier should return structured findings, grouped by severity.

- [ ] **Step 3: Add the fix-and-reverify rule**

The generator should fix material findings, then re-run the verifier once.
After the second verification pass, unresolved material findings should block
success instead of being silently accepted.

- [ ] **Step 4: Add the verifier checklist**

Require checks for:

- valid frontmatter;
- gerund-style or otherwise intentional skill name;
- trigger-focused description;
- clear tools, inputs, outputs, and constraints;
- decisions represented in the skill body;
- necessary references only;
- base eval definitions with stable slugs and expectations;
- no workflow artifact leakage;
- no lifecycle actions such as eval execution, benchmark aggregation, commits,
  tags, blind comparison, or description optimization.

## Task 4: Update Step 3 Prompt Wiring

- [ ] **Step 1: Locate the clean-break step 3 prompt path**

Verify whether step 3 still uses
`agent-sources/plugins/skill-creator/agents/skill-writer-agent.md` or has been
moved to `agent-sources/prompts/**`.

If it has not moved yet, move the step 3 user prompt into
`agent-sources/prompts/skill-generation.txt` or the existing app-owned prompt
name used by workflow runtime code.

- [ ] **Step 2: Make the prompt read workflow JSON**

The prompt should instruct the agent to read:

- `{workspace_dir}/user-context.md`
- `{workspace_dir}/context/decisions.json`
- `{workspace_dir}/context/clarifications.json` when needed

Then it should synthesize a concise generation brief containing:

- skill capability;
- trigger contexts and exclusions;
- expected output format;
- tools and dependencies;
- examples and edge cases;
- validation and eval expectations;
- unresolved constraints that must affect generation.

- [ ] **Step 3: Make the prompt use `creating-skills`**

Change step 3 instructions from the broad `skill-creator` skill to the focused
`creating-skills` guidance.

The prompt should preserve:

- `skill_output_dir` write boundaries;
- `{eval_dir}/evals.json` write location;
- step 3 JSON output shape;
- contradictory-input and scope-recommendation stub behavior.

- [ ] **Step 4: Verify deployment of `agent-sources/skills`**

Inspect workspace deployment code. If `agent-sources/skills/**` is not copied
into runtime `.agents/skills/**`, add that directory to the deployment source
without changing plugin deployment behavior.

## Task 5: Align Evals And Fixtures

- [ ] **Step 1: Update `skill-creator-generate-skill` eval prompts**

Make the eval represent the clean-break step 3 path:

- one `skill-creator` agent;
- task prompt reads user context, clarifications, and decisions;
- generation uses `creating-skills`;
- expected output includes `SKILL.md`, optional references, and `evals.json`;
- no eval execution, benchmark, blind comparison, description optimization,
  commit, or tag.

- [ ] **Step 2: Update assertions**

Assert the output:

- returns the existing step 3 JSON envelope;
- has call trace entries for reading decisions, using `creating-skills`, writing
  `SKILL.md`, writing `evals.json`, and verifier review;
- does not mention forbidden lifecycle actions.

- [ ] **Step 3: Update mock fixtures if parser tests require it**

If step 3 mock outputs include broad legacy lifecycle language, update them to
match the focused generation contract.

## Task 6: Run Quality Gates

- [ ] **Step 1: Run agent structural tests**

```bash
cd app && npm run test:agents:structural
```

- [ ] **Step 2: Run workflow Rust tests**

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

- [ ] **Step 3: Run eval harness contract tests**

```bash
cd tests/evals && npm test
```

- [ ] **Step 4: Run the affected live eval**

```bash
cd tests/evals && npm run eval:skill-creator-generate-skill
```

- [ ] **Step 5: Run markdown lint for changed docs**

```bash
npx markdownlint-cli2 docs/design/creating-skills-generator-verifier/README.md docs/plans/2026-05-03-creating-skills-generator-verifier.md
```

If this repo uses a different markdownlint entrypoint locally, use the repo's
existing command.

## Acceptance Criteria

- [ ] Legacy plugin skill remains unchanged.
- [ ] `agent-sources/skills/creating-skills/SKILL.md` exists with narrow
      creation-only scope.
- [ ] Step 3 prompt reads workflow JSON files itself and passes a synthesized
      brief into creation guidance.
- [ ] Step 3 uses `creating-skills`, not the broad legacy `skill-creator`
      lifecycle guidance.
- [ ] Generated descriptions are drafted carefully as trigger surfaces.
- [ ] Generator-Verifier loop runs in fresh context and re-verifies once after
      material fixes.
- [ ] Base eval definitions are generated but not executed.
- [ ] Structural tests, Rust workflow tests, eval harness tests, markdownlint,
      and the affected live eval pass.
