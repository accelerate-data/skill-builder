# Creating Skills Generator-Verifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a focused OpenHands skill-writing path for workflow step 3 by
copying only the creation guidance into `agent-sources/skills/creating-skills`
and updating generation to use a Generator-Verifier loop. As part of the same
clean-break scope, move answer-evaluator behavior out of a bundled skill and
into the app-owned answer-evaluator prompt.

**Architecture:** Keep one OpenHands top-level agent, `skill-creator`. The
app-owned step 3 prompt reads `user-context.md`, `clarifications.json`, and
`decisions.json`, then passes a synthesized generation brief into the
`creating-skills` guidance. The copied skill writes `SKILL.md`, shipped
references, and base eval definitions, then validates the generated artifacts
with a fresh-context verifier subagent before returning.

Step 3 generation must use the native Rust-owned OpenHands one-shot runtime
path. It must not invoke the legacy Node/TS sidecar, Claude-sidecar
compatibility path, or plugin-hosted `skill-writer-agent` as the runtime agent.
Answer evaluation must use the same single `skill-creator` OpenHands agent,
but its fixed app gate logic belongs in `agent-sources/prompts/answer-evaluator.txt`,
not in a deployed `answer-evaluator` skill.

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
- Move step 3 generation away from the legacy Node/TS sidecar path and onto the
  Rust-owned OpenHands one-shot runtime path.
- Fold the app-specific answer-evaluator classification and JSON gate contract
  into `agent-sources/prompts/answer-evaluator.txt`.
- Remove the bundled answer-evaluator skill from the workspace skill list; it
  has fixed app files, fixed JSON, and backend materialization semantics rather
  than reusable skill guidance.
- Add structural and eval coverage for the new contract.

**Out of scope**

- Running generated evals.
- Benchmark aggregation or review viewer generation.
- Iterative improvement loops.
- Blind comparison.
- Standalone description optimization.
- Refine/rewrite behavior.
- Changing step 0, step 1, or step 2 semantics.
- Changing the answer-evaluator backend output schema or materialization path.

## Current Code To Review

- `agent-sources/plugins/skill-creator/skills/skill-creator/SKILL.md`
  - Source material only. Do not edit.
- `agent-sources/workspace/skills/skill-creator/SKILL.md`
  - Current deployed broad skill. It includes lifecycle sections that should
    not govern clean-break step 3.
- `agent-sources/workspace/agents/skill-creator.md`
  - Shared OpenHands agent identity and workflow overview.
- `agent-sources/prompts/answer-evaluator.txt`
  - App-owned prompt for the answer-evaluator gate. This prompt should own the
    fixed file paths, classification rules, counts, verdict rules, and JSON
    envelope.
- `agent-sources/workspace/skills/answer-evaluator/SKILL.md`
  - Current bundled skill to remove. Its content is app-specific gate logic and
    should be folded into the prompt.
- `agent-sources/plugins/skill-creator/agents/skill-writer-agent.md`
  - Current step 2/3 instructions. Step 3 still says to follow the broad
    `skill-creator` skill.
- `app/src-tauri/src/commands/workflow/**`
  - Rust-owned workflow runtime path. Step 3 should be routed here through the
    native OpenHands provider, not through the Node/TS sidecar.
- `app/sidecar/**`
  - Legacy sidecar code to avoid for step 3 generation routing.
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

## Task 5: Route Step 3 Through Native OpenHands

- [ ] **Step 1: Add failing Rust routing coverage**

Add or update workflow tests proving step 3 generation config uses:

- `runtime_provider: "openhands"`
- `agent_name: "skill-creator"`
- a step 3 task kind such as `workflow.skill_generation`
- the app-owned step 3 prompt template
- the step 3 output format/parser contract

Also assert step 3 does not use:

- plugin-hosted `skill-writer-agent` as the runtime agent;
- the legacy Node/TS sidecar path;
- the Claude-sidecar compatibility path.

- [ ] **Step 2: Implement the Rust-owned runtime path**

Route step 3 generation through the same native OpenHands one-shot invocation
pattern used by migrated workflow steps:

- Rust builds the sidecar/runtime config.
- Rust renders the app-owned prompt.
- Rust starts the OpenHands runner directly.
- The runner creates the single `skill-creator` OpenHands agent.
- The backend validates and materializes the returned step 3 output.

- [ ] **Step 3: Remove step 3 dependencies on legacy runtime identity**

Ensure step 3 no longer depends on
`agent-sources/plugins/skill-creator/agents/skill-writer-agent.md` as the
runtime agent identity. The file may remain as legacy source material until the
broader cleanup removes obsolete plugin files, but clean-break step 3 must not
execute through it.

- [ ] **Step 4: Add guard coverage for no legacy sidecar bleed**

Add tests or structural guards that fail if step 3 generation is reintroduced
through the Node/TS sidecar or any Claude compatibility runner.

## Task 6: Align Evals And Fixtures

- [ ] **Step 1: Update `skill-creator-generate-skill` eval prompts**

Make the eval represent the clean-break step 3 path:

- one `skill-creator` agent;
- native OpenHands step 3 task routing;
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

## Task 7: Fold Answer Evaluator Into The App Prompt

- [ ] **Step 1: Move evaluator logic into `agent-sources/prompts/answer-evaluator.txt`**

The prompt must include:

- exact input files: `user-context.md` and `context/clarifications.json`;
- no-write and no-workflow-advance rules;
- `answer_text` as the single source of truth;
- verdict classes: `clear`, `needs_refinement`, `not_answered`, `vague`,
  `contradictory`;
- count rules for `answered_count`, `empty_count`, `vague_count`,
  `contradictory_count`, and `total_count`;
- `verdict` thresholds and automatic `gate_decision`;
- the final raw JSON envelope.

- [ ] **Step 2: Remove the bundled evaluator skill**

Delete `agent-sources/workspace/skills/answer-evaluator/SKILL.md` and remove
`answer-evaluator` from the `skills:` list in
`agent-sources/workspace/agents/skill-creator.md`.

- [ ] **Step 3: Update tests and eval copy**

Update structural tests, OpenHands static eval assertions, and
`skill-content-researcher-answer-evaluator` eval prompt wording so they refer
to prompt-owned answer-evaluator behavior rather than a bundled
`answer-evaluator` skill.

- [ ] **Step 4: Preserve backend gate semantics**

Do not change `run_answer_evaluator`, `workflow.answer_evaluator`, or the
answer-evaluator output schema/materialization contract except where tests need
to stop asserting that a bundled evaluator skill is loaded.

## Task 8: Run Quality Gates

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

- [ ] **Step 5: Run the affected answer-evaluator live eval**

```bash
cd tests/evals && npm run eval:skill-content-researcher-answer-evaluator
```

- [ ] **Step 6: Run markdown lint for changed docs**

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
- [ ] Step 3 generation routes through the native Rust-owned OpenHands one-shot
      path with `agentName = "skill-creator"`.
- [ ] Step 3 generation does not invoke the legacy Node/TS sidecar,
      Claude-sidecar compatibility path, or plugin-hosted `skill-writer-agent`
      as the runtime agent.
- [ ] Generated descriptions are drafted carefully as trigger surfaces.
- [ ] Generator-Verifier loop runs in fresh context and re-verifies once after
      material fixes.
- [ ] Base eval definitions are generated but not executed.
- [ ] Answer-evaluator behavior is prompt-owned, not a bundled workspace skill.
- [ ] Answer-evaluator still returns the existing backend gate JSON with
      `verdict`, counts, `gate_decision`, and `per_question`.
- [ ] Structural tests, Rust workflow tests, eval harness tests, markdownlint,
      and the affected live eval pass.
