# Creating Skills Generator-Verifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a focused OpenHands skill-writing path for workflow step 3 by
copying only the creation guidance into `agent-sources/skills/creating-skills`
and updating generation to use a Generator-Verifier loop. As part of the same
clean-break scope, move answer-evaluator behavior out of a bundled skill and
into the app-owned answer-evaluator prompt. The same VU-1152 clean-break work
also tightens the upstream research and decision process so generated skills
stay at the correct data-platform abstraction level for dbt, dlt, Microsoft
Fabric Lakehouse, source-system customization, platform standards, and
business-process modeling.

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

The workflow-wide `skill-creator` agent prompt should carry stable Skill
Builder context: generated skills are normally used by data and analytics
agents building durable pipelines and analytical artifacts, not one-off
calculators over pasted files. Purpose-specific research lenses belong in the
`researching-skill-requirements` skill. Purpose-specific normalization belongs
in Step 2 confirm-decisions so research can remain exploratory while
`decisions.json` becomes the build-ready canonical contract for Step 3.

**Design doc:** `docs/design/creating-skills-generator-verifier/README.md`

**Tech Stack:** OpenHands AgentSkills, app-owned prompt templates, Tauri Rust
workflow commands, agent structural tests, Promptfoo live evals.

---

## Post-Rebase Status Sweep

Updated after rebasing this branch onto
`feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`.

**Already implemented**

- `agent-sources/skills/creating-skills/SKILL.md` exists with creation-only
  scope, Generator-Verifier guidance, and no standalone skill-validator usage.
- `agent-sources/skills/creating-skills/references/verifier-subagent-prompt.md`
  exists and is used as the fresh-context verifier prompt.
- `agent-sources/prompts/skill-generation.txt` is the app-owned Step 3 prompt.
  It reads user context, decisions, and clarifications; synthesizes a
  generation brief; keeps raw artifacts in context; and instructs use of
  `creating-skills`.
- Step 3 runtime config routes through native OpenHands one-shot execution with
  `agent_name: "skill-creator"` and `task_kind: "workflow.skill_generation"`.
- `agent-sources/workspace/agents/skill-creator.md` includes the
  workflow-wide skill-building context and lists `creating-skills` and
  `researching-skill-requirements`.
- `agent-sources/workspace/skills/researching-skill-requirements/SKILL.md`
  contains purpose-specific lenses and the abstraction rule that
  business-process skills should not default to CSV/JSON file-format questions.
- `agent-sources/prompts/confirm_decisions.txt` contains purpose-aware
  decision normalization and the Salesforce CSV negative/positive example.
- `agent-sources/prompts/answer-evaluator.txt` owns the app-specific answer
  evaluator gate logic, and `answer-evaluator` has been removed from the
  deployed workspace skill list.
- Step 3 mock-agent and Rust parser tests include the new `version_bump` and
  `call_trace` contract.

**Pending after rebase**

- Completed: add strict publish tests proving generated `SKILL.md` must use
  `metadata.version: 1.0.0`, not legacy top-level `version` and not another
  metadata version.
- Completed: loosen the confirm-decisions smoke eval assertion so it checks the
  presence and usefulness of mandatory purpose/trigger decisions without
  overfitting to the UI's `needs-review` status.
- Completed: expand Step 0 research eval coverage for the supported purposes in
  product scope: business process, data engineering, source customization, and
  platform standards. Do not add semantic-model or ontology cases in VU-1152.
- Completed: rerun all mapped quality gates after those pending edits.

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
- Add workflow-wide data-platform context to the `skill-creator` OpenHands
  agent system prompt for currently supported product flows: business process,
  source customization, data engineering standards, and platform standards.
- Add purpose-specific research lenses to
  `agent-sources/workspace/skills/researching-skill-requirements/SKILL.md`.
- Add Step 2 purpose-aware decision normalization so source/export answers are
  converted into lakehouse/dbt/dlt build decisions when the selected purpose is
  business-process or data-engineering knowledge.
- Fold the app-specific answer-evaluator classification and JSON gate contract
  into `agent-sources/prompts/answer-evaluator.txt`.
- Remove the bundled answer-evaluator skill from the workspace skill list; it
  has fixed app files, fixed JSON, and backend materialization semantics rather
  than reusable skill guidance.
- Add structural and eval coverage for the new contract.
- Add positive and negative eval scenarios proving research/decision outputs
  preserve the intended abstraction level.
- Keep semantic-model and ontology eval coverage out of this issue. The main
  product does not support those flows yet.

**Out of scope**

- Running generated evals.
- Benchmark aggregation or review viewer generation.
- Iterative improvement loops.
- Blind comparison.
- Standalone description optimization.
- Refine/rewrite behavior.
- Changing Step 3 semantics to compensate for upstream research/decision
  mistakes. Step 3 should trust canonical decisions and supporting
  clarifications.
- Changing the answer-evaluator backend output schema or materialization path.

## Current Code To Review

- `agent-sources/plugins/skill-creator/skills/skill-creator/SKILL.md`
  - Source material only. Do not edit.
- `agent-sources/workspace/skills/skill-creator/SKILL.md`
  - Current deployed broad skill. It includes lifecycle sections that should
    not govern clean-break step 3.
- `agent-sources/workspace/agents/skill-creator.md`
  - Shared OpenHands agent identity and workflow overview.
- `agent-sources/workspace/skills/researching-skill-requirements/SKILL.md`
  - Shared research skill used by Step 0 and Step 1. Add purpose-aware research
    lenses here rather than duplicating them across prompts.
- `agent-sources/prompts/research.txt`
  - Step 0 prompt should remain focused on schema, paths, and task envelope.
    It should rely on the research skill for purpose-aware question selection.
- `agent-sources/prompts/detailed-research.txt`
  - Step 1 prompt should remain focused on additive repair and schema behavior.
    It should rely on the research skill for purpose-aware gap selection.
- `agent-sources/prompts/confirm_decisions.txt`
  - Step 2 prompt should normalize exploratory answers into build-ready,
    purpose-aware decisions.
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

- [x] **Step 1: Add a structural test for the focused skill**

Add coverage under `app/agent-tests/**` asserting:

- `agent-sources/skills/creating-skills/SKILL.md` exists.
- frontmatter `name` is `creating-skills`.
- the description is trigger-oriented and does not mention workflow step
  numbers.
- the skill includes the Generator-Verifier loop.
- the skill requires fresh-context verifier review.
- the skill instructs re-verification once after material fixes.

Status: covered by direct structural assertions for the focused skill
frontmatter, trigger-oriented description, Generator-Verifier loop, verifier
prompt reference, return shape, and one-reverification rule.

- [x] **Step 2: Add forbidden legacy lifecycle assertions**

Assert the copied skill does not include or instruct:

- `run_loop.py`
- `generate_report.py`
- `Blind comparison`
- `Description Optimization`
- benchmark aggregation
- running evals
- committing or tagging generated skills

Status: covered by direct structural assertions that the copied skill does not
include legacy scripts, lifecycle sections, commit/tag helpers, or release
mechanics.

- [x] **Step 3: Add prompt contract assertions for step 3**

Add or update tests proving the step 3 prompt:

- points to exact paths for `user-context.md`, `clarifications.json`, and
  `decisions.json`;
- tells the agent to synthesize a generation brief from those files;
- tells the agent to use `creating-skills`;
- does not tell `creating-skills` to discover workflow JSON files itself;
- keeps the existing step 3 JSON return shape.

- [x] **Step 4: Confirm tests fail before implementation**

Run:

```bash
cd app && npm run test:agents:structural
```

Expected before implementation: structural tests fail because
`creating-skills` does not exist and step 3 still references the broad
`skill-creator` guidance.

Status: superseded after rebase because implementation already exists. The
post-rebase quality gates now provide the proof point.

## Task 2: Add The Focused Copied Skill

- [x] **Step 1: Create `agent-sources/skills/creating-skills/SKILL.md`**

Use frontmatter:

```yaml
---
name: creating-skills
description: Use when writing a new skill from already-clarified requirements, decisions, examples, constraints, and expected outputs, including drafting SKILL.md, shipped references, base eval definitions, and validating generated files.
---
```

- [x] **Step 2: Copy only creation-relevant guidance**

Use the existing "Creating a skill" section as source material, but rewrite it
around this clean-break contract:

- caller supplies requirements and decisions;
- do not interview or rediscover intent;
- generate shipped skill files only;
- create references only when reusable value justifies them;
- create base eval definitions with stable slugs and frozen expectations;
- draft the `description` as a trigger surface.

- [x] **Step 3: Add explicit exclusions**

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

- [x] **Step 1: Add the generator pass**

The generator pass should write:

- `{skill_output_dir}/SKILL.md`
- `{skill_output_dir}/references/*` when needed
- `{eval_dir}/evals.json`

It should use the caller-provided brief and should not read
`clarifications.json` or `decisions.json` by itself.

- [x] **Step 2: Add the verifier subagent contract**

The skill should spawn a verifier subagent in fresh context with only:

- generated artifacts;
- the synthesized requirements and decisions;
- the verifier checklist.

The verifier should return structured findings, grouped by severity.

- [x] **Step 3: Add the fix-and-reverify rule**

The generator should fix material findings, then re-run the verifier once.
After the second verification pass, unresolved material findings should block
success instead of being silently accepted.

- [x] **Step 4: Add the verifier checklist**

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

- [x] **Step 1: Locate the clean-break step 3 prompt path**

Verify whether step 3 still uses
`agent-sources/plugins/skill-creator/agents/skill-writer-agent.md` or has been
moved to `agent-sources/prompts/**`.

If it has not moved yet, move the step 3 user prompt into
`agent-sources/prompts/skill-generation.txt` or the existing app-owned prompt
name used by workflow runtime code.

- [x] **Step 2: Make the prompt read workflow JSON**

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

- [x] **Step 3: Make the prompt use `creating-skills`**

Change step 3 instructions from the broad `skill-creator` skill to the focused
`creating-skills` guidance.

The prompt should preserve:

- `skill_output_dir` write boundaries;
- `{eval_dir}/evals.json` write location;
- step 3 JSON output shape;
- contradictory-input and scope-recommendation stub behavior.

- [x] **Step 4: Verify deployment of `agent-sources/skills`**

Inspect workspace deployment code. If `agent-sources/skills/**` is not copied
into runtime `.agents/skills/**`, add that directory to the deployment source
without changing plugin deployment behavior.

## Task 5: Route Step 3 Through Native OpenHands

- [x] **Step 1: Add failing Rust routing coverage**

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

- [x] **Step 2: Implement the Rust-owned runtime path**

Route step 3 generation through the same native OpenHands one-shot invocation
pattern used by migrated workflow steps:

- Rust builds the sidecar/runtime config.
- Rust renders the app-owned prompt.
- Rust starts the OpenHands runner directly.
- The runner creates the single `skill-creator` OpenHands agent.
- The backend validates and materializes the returned step 3 output.

- [x] **Step 3: Remove step 3 dependencies on legacy runtime identity**

Ensure step 3 no longer depends on
`agent-sources/plugins/skill-creator/agents/skill-writer-agent.md` as the
runtime agent identity. The file may remain as legacy source material until the
broader cleanup removes obsolete plugin files, but clean-break step 3 must not
execute through it.

- [x] **Step 4: Add guard coverage for no legacy sidecar bleed**

Add tests or structural guards that fail if step 3 generation is reintroduced
through the Node/TS sidecar or any Claude compatibility runner.

## Task 6: Align Evals And Fixtures

- [x] **Step 1: Update `skill-creator-generate-skill` eval prompts**

Make the eval represent the clean-break step 3 path:

- one `skill-creator` agent;
- native OpenHands step 3 task routing;
- task prompt reads user context, clarifications, and decisions;
- generation uses `creating-skills`;
- expected output includes `SKILL.md`, optional references, and `evals.json`;
- no eval execution, benchmark, blind comparison, description optimization,
  commit, or tag.

- [x] **Step 2: Update assertions**

Assert the output:

- returns the existing step 3 JSON envelope;
- has call trace entries for reading decisions, using `creating-skills`, writing
  `SKILL.md`, writing `evals.json`, and verifier review;
- does not mention forbidden lifecycle actions.

- [x] **Step 3: Update mock fixtures if parser tests require it**

If step 3 mock outputs include broad legacy lifecycle language, update them to
match the focused generation contract.

## Task 7: Fold Answer Evaluator Into The App Prompt

- [x] **Step 1: Move evaluator logic into `agent-sources/prompts/answer-evaluator.txt`**

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

- [x] **Step 2: Remove the bundled evaluator skill**

Delete `agent-sources/workspace/skills/answer-evaluator/SKILL.md` and remove
`answer-evaluator` from the `skills:` list in
`agent-sources/workspace/agents/skill-creator.md`.

- [x] **Step 3: Update tests and eval copy**

Update structural tests, OpenHands static eval assertions, and
`skill-content-researcher-answer-evaluator` eval prompt wording so they refer
to prompt-owned answer-evaluator behavior rather than a bundled
`answer-evaluator` skill.

- [x] **Step 4: Preserve backend gate semantics**

Do not change `run_answer_evaluator`, `workflow.answer_evaluator`, or the
answer-evaluator output schema/materialization contract except where tests need
to stop asserting that a bundled evaluator skill is loaded.

## Task 8: Add Purpose-Aware Research And Decision Normalization

- [x] **Step 1: Add workflow-wide data-platform context**

Update `agent-sources/workspace/agents/skill-creator.md` so the
Skill-Building Context says Skill Builder normally creates reusable guidance
for agents building data engineering and analytics artifacts:

- dlt pipelines;
- dbt models;
- Microsoft Fabric Lakehouse artifacts;
- business-process modeling.

State that generated skills should guide durable data artifacts and business
logic, not default to one-off calculators over pasted CSV/JSON files.

- [x] **Step 2: Add purpose-aware research lenses**

Update
`agent-sources/workspace/skills/researching-skill-requirements/SKILL.md` with
purpose-specific guidance:

- Business process knowledge: metrics, business rules, calculation logic,
  reporting hierarchies, grain, dimensions, lakehouse/dbt modeling
  implications, reconciliation expectations, edge cases, and exclusions.
- Data engineering standards: data modeling concepts, reconciliation concepts,
  data quality rules, dbt standards, dlt standards, Fabric Lakehouse standards,
  operational standards, and deployment conventions.
- Source system customizations: source entities, custom fields, custom
  statuses/stages, source business logic, extraction constraints, source-to-
  lakehouse mapping assumptions, and required transformations.
- Platform standards: Fabric/Azure implementation choices, endpoint behavior,
  workspace/lakehouse conventions, security, deployment, orchestration, and
  monitoring standards.

Add the abstraction rule: do not ask about CSV/JSON/user-provided file formats
unless the selected purpose is explicitly source extraction, file ingestion, or
file handling. For business-process skills, ask about conceptual source
entities, metric semantics, modeling implications, and validation instead.

- [x] **Step 3: Add Step 2 decision normalization**

Update `agent-sources/prompts/confirm_decisions.txt` so decision confirmation
normalizes exploratory answers into build-ready decisions:

- For business-process purpose, convert source/export answers into source
  domain, lakehouse, dbt, metric, calculation, reporting hierarchy, and
  reconciliation implications.
- For data-engineering purpose, convert general preferences into concrete
  modeling, quality, reconciliation, dbt/dlt, Fabric, and operational
  standards.
- For source-customization purpose, preserve extraction mechanics and source-
  specific customizations when they materially affect ingestion or
  transformation.
- For platform purpose, preserve Fabric/Azure environment and endpoint
  constraints.

Include a negative example in the prompt:

- Bad: "The skill accepts Salesforce CSV exports."
- Good: "The skill assumes Salesforce opportunity data is available in the
  Fabric Lakehouse and should define how opportunity stages, amounts,
  probabilities, close dates, and booking logic map into dbt models and
  business measures."

- [x] **Step 4: Add positive and negative eval coverage**

Update affected eval packages so the behavior is covered from both directions:

- Positive data-engineering scenario: research/decisions should mention data
  modeling, reconciliation, data quality, dbt/dlt, and Fabric Lakehouse
  standards for a data-engineering standards skill.
- Positive business-process scenario: decisions should convert a pipeline-value
  skill into metrics, calculation logic, reporting hierarchies, lakehouse/dbt
  model implications, and reconciliation checks.
- Negative business-process scenario: answers that mention Salesforce CSV,
  JSON, SOQL export, Workbench, or Data Loader must not become the operating
  input contract for the generated business-process skill.
- Positive source-customization scenario: source API/export/CDC mechanics may
  remain decisions when the selected purpose is source system customizations.

Prefer deterministic eval assertions for prompt contracts and one live eval per
affected package where model behavior is expected to change.

## Task 9: Post-Rebase Remaining Work

- [x] **Step 1: Add strict generated-version publish tests**

Add Rust tests near `publish_commit_and_tag_generated_skill_creates_initial_version_tag`
covering:

- generated `SKILL.md` with legacy top-level `version: 1.0.0` and no
  `metadata.version` is rejected;
- generated `SKILL.md` with `metadata.version: 2.0.0` is rejected.

Decision: this must be done. The implementation now enforces
`metadata.version`, but tests need to lock the regression down.

- [x] **Step 2: Loosen confirm-decisions smoke eval overfit**

Update
`tests/evals/packages/skill-content-researcher-confirm-decisions/promptfooconfig.json`
so the smoke eval verifies:

- a purpose/capability decision exists;
- a trigger decision exists;
- the trigger implication mentions description or trigger drafting;
- decision statuses are valid schema statuses.

Do not require those decisions to use `status: "needs-review"` in the eval
assertion. The prompt can still ask for editable decisions; the eval should not
be brittle to UI-specific status choices.

Decision: this must be done. The current eval assertion is too app-shaped.

- [x] **Step 3: Expand Step 0 research eval coverage**

Refactor
`tests/evals/packages/skill-content-researcher-research/prompt.txt` to use
package vars for `skill_name`, `skill_slug`, and `user_context`, then add
coverage in the package config for:

- business-process research: asks about metrics, calculation logic, reporting
  hierarchy, lakehouse/dbt modeling implications, reconciliation, edge cases,
  and exclusions; does not turn CSV/JSON/SOQL into the operating input
  contract;
- data-engineering research: asks about data modeling, reconciliation, data
  quality, dbt, dlt, Fabric Lakehouse, operations, and deployment standards;
- source-customization research: asks about source entities, custom fields,
  extraction mechanics, CDC/API/export behavior, source business logic, and
  transformation implications;
- platform research: asks about Fabric/Azure environment choices, endpoint
  behavior, workspace/lakehouse conventions, security, deployment,
  orchestration, and monitoring;
- insufficient or placeholder context triggers the scope guard instead of
  manufacturing questions.

Do not add semantic-model or ontology research cases in VU-1152.

Decision: this must be done. One Step 0 smoke eval is not enough for the four
currently supported purpose lenses.

- [x] **Step 4: Run an independent review after the pending edits**

Use a fresh independent review after Step 1 through Step 3 above are complete.
The reviewer should verify the current worktree and branch first, then check
for:

- no legacy Node/TS sidecar bleed in Step 3, Step 0, Step 1, Step 2, or
  answer-evaluator runtime paths;
- no stale bundled answer-evaluator skill dependency;
- no eval overfitting to implementation-only prompt lines;
- no semantic-model or ontology eval expansion in this issue.

Decision: this must be done before final quality-gate closeout.

Result: the first independent review found blockers in frontmatter guidance,
Step 3 eval scope, answer-evaluator tool selection, Step 3 eval schema
strictness, and static eval overfit. Those were fixed. A follow-up review
confirmed those fixes except it flagged the absence of semantic-model and
ontology Step 3 eval coverage; that absence is intentional for VU-1152 because
the product does not support those flows yet.

## Task 10: Run Quality Gates

- [x] **Step 1: Run agent structural tests**

```bash
cd app && npm run test:agents:structural
```

- [x] **Step 2: Run workflow Rust tests**

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

- [x] **Step 3: Run eval harness contract tests**

```bash
cd tests/evals && npm test
```

- [x] **Step 4: Run the affected live eval**

```bash
cd tests/evals && npm run eval:skill-creator-generate-skill
```

- [x] **Step 5: Run the affected answer-evaluator live eval**

```bash
cd tests/evals && npm run eval:skill-content-researcher-answer-evaluator
```

- [x] **Step 6: Run affected research and decision live evals**

```bash
cd tests/evals && npm run eval:skill-content-researcher-research
cd tests/evals && npm run eval:skill-content-researcher-confirm-decisions
```

- [x] **Step 7: Run markdown lint for changed docs**

```bash
npx markdownlint-cli2 docs/design/creating-skills-generator-verifier/README.md docs/plans/2026-05-03-creating-skills-generator-verifier.md
```

If this repo uses a different markdownlint entrypoint locally, use the repo's
existing command.

## Acceptance Criteria

- [x] Legacy plugin skill remains unchanged.
- [x] `agent-sources/skills/creating-skills/SKILL.md` exists with narrow
      creation-only scope.
- [x] Step 3 prompt reads workflow JSON files itself and passes a synthesized
      brief into creation guidance.
- [x] Step 3 uses `creating-skills`, not the broad legacy `skill-creator`
      lifecycle guidance.
- [x] Step 3 generation routes through the native Rust-owned OpenHands one-shot
      path with `agentName = "skill-creator"`.
- [x] Step 3 generation does not invoke the legacy Node/TS sidecar,
      Claude-sidecar compatibility path, or plugin-hosted `skill-writer-agent`
      as the runtime agent.
- [x] `skill-creator` system prompt includes the workflow-wide data-platform
      context for dlt, dbt, Fabric Lakehouse, and business-process modeling.
- [x] `researching-skill-requirements` contains purpose-specific research
      lenses for business process, data engineering, source customization, and
      platform standards.
- [x] Business-process research focuses on metrics, business rules,
      calculation logic, reporting hierarchies, grain, dimensions,
      lakehouse/dbt modeling implications, reconciliation, edge cases, and
      exclusions.
- [x] Data-engineering research focuses on data modeling, reconciliation, data
      quality, dbt/dlt standards, Fabric Lakehouse standards, operational
      standards, and deployment conventions.
- [x] Step 2 confirm-decisions normalizes source/export answers into
      build-ready lakehouse/dbt/business-rule decisions for business-process
      skills instead of preserving CSV/JSON/SOQL exports as the operating
      input contract.
- [x] Source-system customization decisions may preserve extraction mechanics
      when extraction is the selected purpose.
- [x] Generated descriptions are drafted carefully as trigger surfaces.
- [x] Generator-Verifier loop runs in fresh context and re-verifies once after
      material fixes.
- [x] Base eval definitions are generated but not executed.
- [x] Answer-evaluator behavior is prompt-owned, not a bundled workspace skill.
- [x] Answer-evaluator still returns the existing backend gate JSON with
      `verdict`, counts, `gate_decision`, and `per_question`.
- [x] Generated-skill publishing rejects legacy top-level `version` and any
      `metadata.version` other than `1.0.0`.
- [x] Confirm-decisions eval assertions are not overfit to UI-specific
      `needs-review` status while still verifying purpose/trigger decisions.
- [x] Step 0 research eval coverage includes business process, data
      engineering, source customization, platform standards, and scope-guard
      scenarios.
- [x] VU-1152 eval coverage intentionally excludes semantic-model and ontology
      scenarios until the product supports those flows.
- [x] Structural tests, Rust workflow tests, eval harness tests, markdownlint,
      and the affected live eval pass.
