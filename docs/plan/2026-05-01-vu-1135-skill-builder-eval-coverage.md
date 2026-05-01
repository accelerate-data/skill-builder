# VU-1135 Skill Builder Eval Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Skill Builder eval coverage around durable model/runtime contracts for the OpenCode harness.

**Architecture:** Add one Promptfoo package per app-loaded prompt, plugin agent, or plugin skill. Package prompts must mirror the prompt or instruction shape the app sends to the agent runtime, not ask a separate meta-reviewer to inspect files. Keep providers suite-owned through `tests/evals/scripts/resolve-promptfoo-config.js`, and make the smoke command run exactly one `[smoke]` scenario from every package so contract changes map to an obvious eval target.

**Tech Stack:** Promptfoo, OpenCode, Node test runner, Markdown docs.

---

## Discovery

- Linear issue: VU-1135.
- Functional spec: not applicable; the repo has no `docs/functional/` tree and this is an eval-harness issue.
- Related design docs:
  - `docs/design/agent-runtime-boundary/README.md`
  - `docs/design/agent-specs/canonical-format.md`
  - `docs/design/skill-scope-review/README.md`
  - `docs/design/write-eval-test-refine-loop/README.md`
- Existing implementation plan: none; `docs/plan/` did not exist before this issue.
- Manual tests: No manual tests required. Smoke and regression evals are automated OpenCode/Promptfoo commands.

## Tasks

### Task 1: Inventory And Smoke Contract

**Files:**

- Create: `tests/evals/docs/scenario-inventory.md`
- Modify: `tests/evals/package.json`
- Modify: `tests/evals/scripts/eval-suite-contract.test.js`

- [x] Add the scenario inventory with keep/rewrite/drop decisions.
- [x] Define package-level smoke and regression scripts.
- [x] Add deterministic tests that require one `[smoke]` case per package.

### Task 2: Promptfoo Packages

**Files:**

- Remove: `tests/evals/packages/workflow-one-shot/promptfooconfig.json`
- Remove: `tests/evals/packages/refine-streaming/promptfooconfig.json`
- Remove: `tests/evals/packages/skill-output-paths/promptfooconfig.json`
- Remove: `tests/evals/packages/description-optimization/promptfooconfig.json`
- Remove: `tests/evals/packages/generated-skill-quality/promptfooconfig.json`
- Create: `tests/evals/packages/skill-content-researcher-skill-builder/promptfooconfig.json`
- Create: `tests/evals/packages/skill-content-researcher-research/promptfooconfig.json`
- Create: `tests/evals/packages/skill-content-researcher-answer-evaluator/promptfooconfig.json`
- Create: `tests/evals/packages/skill-content-researcher-detailed-research/promptfooconfig.json`
- Create: `tests/evals/packages/skill-content-researcher-confirm-decisions/promptfooconfig.json`
- Create: `tests/evals/packages/skill-creator-generate-skill/promptfooconfig.json`
- Create: `tests/evals/packages/skill-creator-rewrite-skill/promptfooconfig.json`
- Create: `tests/evals/packages/skill-creator-grader/promptfooconfig.json`
- Create: `tests/evals/packages/workspace-test-evaluator-prompt/promptfooconfig.json`
- Create: `tests/evals/packages/workspace-workflow-step-prompt/promptfooconfig.json`
- Create: `tests/evals/packages/workspace-refine-initial-prompt/promptfooconfig.json`
- Create: `tests/evals/packages/workspace-eval-initial-prompt/promptfooconfig.json`
- Create: `tests/evals/packages/workspace-description-evals-generator-prompt/promptfooconfig.json`
- Keep: `tests/evals/packages/scope-advisor/promptfooconfig.json`

- [x] Replace meta-inspection evals with app-shaped prompts rendered from app-loaded prompt/skill/agent contracts.
- [x] Validate JSON output payloads directly, including top-level status/verdict/schema keys for JSON-returning skills and prompts.
- [x] Mark one scenario per package as `[smoke]`.
- [x] Update package scripts so each artifact has an `npm run eval:<package>` command.

#### Package Rewrite Checklist

Each package below must stop using meta prompts such as "Inspect `<path>` and
return checks". The prompt should instead resemble the input shape the app sends
to the model, and assertions should validate the JSON object the skill, agent, or
prompt is supposed to emit.

- [x] `harness-smoke`: keep minimal OpenCode provider reachability; assert parseable JSON with `scenario`, `ok`, and `failures`.
- [x] `skill-content-researcher-skill-builder`: use the one-shot workflow wrapper prompt shape for the research step; assert `status`, `dimensions_selected`, `question_count`, and nested `research_output.version`.
- [x] `skill-content-researcher-research`: use the app's step-0 research prompt shape with a realistic `user-context.md` path/context; assert canonical `research_complete` output and `clarifications_json`/`research_output` schema fields.
- [x] `skill-content-researcher-answer-evaluator`: use the answer-evaluator prompt shape with an inline representative `clarifications.json`; assert `verdict`, counts, `gate_decision`, and `per_question` entries.
- [x] `skill-content-researcher-detailed-research`: use the detailed-research workflow step prompt shape with answered clarifications and an answer-evaluation verdict; assert `detailed_research_complete`, counts, and canonical nested clarifications JSON.
- [x] `skill-content-researcher-confirm-decisions`: use the decisions workflow step prompt shape with clarifications and research artifacts; assert `version`, `metadata.decision_count`, and `decisions[]` entries.
- [x] `skill-creator-generate-skill`: use the generate-skill step prompt shape with `skill_output_dir`, `user-context.md`, `clarifications.json`, `decisions.json`, and `research.json`; assert `status`, `call_trace`, `commit_summary`, and `version_bump`.
- [x] `skill-creator-rewrite-skill`: use the refine prompt shape for an eval-failure selection and target skill directory; assert the documented plain-text rewrite summary fields (`status: rewritten`, summary, description update, version bump, call trace, commit, tag).
- [x] `skill-creator-grader`: use the eval-loop grader subagent prompt shape with `expectations`, `plan_text`, and `grading_output_path`; assert grading JSON has strict `passed`, `expectations[]`, and feedback fields.
- [x] `workspace-test-evaluator-prompt`: use the app's skill tester plan comparison prompt shape; assert structured comparison output can be parsed into dimensions and recommendations.
- [x] `workspace-workflow-step-prompt`: render the actual workflow prompt with realistic path variables; assert final JSON matches the step's structured-output contract rather than boolean file checks.
- [x] `workspace-refine-initial-prompt`: render `refine-initial.txt` with eval failure feedback; assert the response preserves the `AskUserQuestion` gate instead of directly rewriting.
- [x] `workspace-eval-initial-prompt`: render `eval-initial.txt` with one eval id and one run; assert final JSON is `{status, iteration, results}`.
- [x] `workspace-description-evals-generator-prompt`: render `skill-description-evals-generator.md`; assert `{status:"generated", queries:[{query, should_trigger}]}` with the requested count.
- [x] `scope-advisor`: keep product behavior cases, but convert them to prompt-shaped scope review requests and assert the app-facing JSON response instead of repo-file proof booleans.

#### Deterministic Guardrails

- [x] Add a deterministic suite test that fails when package prompts contain meta-review wording (`Inspect`, `Do not edit files`, `checks`, or `evidence`) except for explicit harness internals.
- [x] Add deterministic assertions that every JSON-returning package parses the first JSON object from output and checks the artifact's top-level contract fields.

### Task 3: Repo Policy Updates

**Files:**

- Modify: `AGENTS.md`
- Modify: `TEST_MANIFEST.md`
- Modify: `repo-map.json`
- Modify: `app/src-tauri/src/commands/skill/scope_review.rs`

- [x] Remove manual-only smoke/eval restrictions.
- [x] Document that changed issues determine which evals to run.
- [x] Keep repo command references aligned with the new scripts.
- [x] Tighten the scope advisor prompt so context overrides broadness only when it explicitly establishes one company-specific workflow.

### Task 4: Verification

**Commands:**

- `cd tests/evals && npm test`
- `cd tests/evals && npm run eval:harness-smoke`
- `cd tests/evals && npm run eval:skill-content-researcher-skill-builder`
- `cd tests/evals && npm run eval:skill-content-researcher-research`
- `cd tests/evals && npm run eval:skill-content-researcher-answer-evaluator`
- `cd tests/evals && npm run eval:skill-content-researcher-detailed-research`
- `cd tests/evals && npm run eval:skill-content-researcher-confirm-decisions`
- `cd tests/evals && npm run eval:skill-creator-generate-skill`
- `cd tests/evals && npm run eval:skill-creator-rewrite-skill`
- `cd tests/evals && npm run eval:skill-creator-grader`
- `cd tests/evals && npm run eval:workspace-test-evaluator-prompt`
- `cd tests/evals && npm run eval:workspace-workflow-step-prompt`
- `cd tests/evals && npm run eval:workspace-refine-initial-prompt`
- `cd tests/evals && npm run eval:workspace-eval-initial-prompt`
- `cd tests/evals && npm run eval:workspace-description-evals-generator-prompt`
- `cd tests/evals && npm run eval:scope-advisor`
- `cd tests/evals && npm run eval:smoke`
- `markdownlint AGENTS.md TEST_MANIFEST.md docs/plan/2026-05-01-vu-1135-skill-builder-eval-coverage.md tests/evals/docs/scenario-inventory.md`
- `cd app && npm run sidecar:build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml scope_review`

- [x] Run deterministic harness tests.
- [x] `eval:harness-smoke`
- [x] Re-run `eval:skill-content-researcher-skill-builder` after app-shaped eval rewrite.
- [x] Re-run `eval:skill-content-researcher-research` after app-shaped eval rewrite.
- [x] Re-run `eval:skill-content-researcher-answer-evaluator` after app-shaped eval rewrite.
- [x] Re-run `eval:skill-content-researcher-detailed-research` after app-shaped eval rewrite.
- [x] Re-run `eval:skill-content-researcher-confirm-decisions` after app-shaped eval rewrite.
- [x] Re-run `eval:skill-creator-generate-skill` after app-shaped eval rewrite.
- [x] Re-run `eval:skill-creator-rewrite-skill` after app-shaped eval rewrite.
- [x] Re-run `eval:skill-creator-grader` after app-shaped eval rewrite.
- [x] Run `eval:workspace-test-evaluator-prompt` after replacing the stale `skill-test` package.
- [x] `eval:workspace-workflow-step-prompt`
- [x] `eval:workspace-refine-initial-prompt`
- [x] `eval:workspace-eval-initial-prompt`
- [x] `eval:workspace-description-evals-generator-prompt`
- [x] `eval:scope-advisor`
- [x] Run aggregate `eval:smoke` after all package suites are green.
- [x] Run markdown lint for changed Markdown.
- [x] Build the sidecar artifact required by Tauri's Rust build script.
- [x] Run the Rust scope-review compile/test filter.
