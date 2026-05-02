# OpenHands Answer Evaluator Clean-Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate answer evaluation onto the OpenHands-native clean-break workflow path while keeping one OpenHands runtime agent, `skill-creator`, and invoking the bundled `answer-evaluator` skill through an app-owned prompt.

**Architecture:** Do not create a new OpenHands agent for answer evaluation. The OpenHands runner should continue to execute the shared `skill-creator` agent, but the answer-evaluator run must use a task-specific user prompt that tells that agent to use the bundled `answer-evaluator` skill and return only the answer-evaluation JSON. App-owned prompts live in `agent-sources/prompts/**`; reusable skill instructions and references live under the deployed `.agents/skills/**` layout.

**Tech Stack:** Tauri Rust workflow commands, Python OpenHands SDK runner, OpenHands `.agents` workspace layout, bundled AgentSkills, Vitest sidecar tests, cargo workflow tests, agent structural tests.

---

## Linear And Branch Contract

- Parent issue: `VU-1145`
- Base branch: `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`
- Create a child Linear issue for this plan.
- Implement in a child branch/worktree off the VU-1145 branch.
- Raise the implementation PR against `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`.

Suggested implementation branch after the issue exists:

```bash
cd /Users/hbanerjee/src/worktrees/feature/vu-1145-implement-openhands-native-clean-break-agent-runtime
./scripts/worktree.sh feature/<issue-id>-openhands-answer-evaluator-clean-break
```

## Scope

**In scope**

- Keep `agentName = "skill-creator"` for answer-evaluator OpenHands runs.
- Route the answer-evaluator phase through the native OpenHands runtime provider.
- Put the answer-evaluator user prompt in `agent-sources/prompts/answer-evaluator.txt`.
- Ensure Rust only loads and substitutes the prompt template; do not embed prompt body text in Rust code.
- Make the answer-evaluator prompt explicitly instruct the shared `skill-creator` agent to use the bundled `answer-evaluator` skill.
- Ensure the deployed `.agents/skills/answer-evaluator/SKILL.md` is available to the shared agent.
- Create one canonical shared schema reference at `agent-sources/workspace/skills/shared/schemas.md`.
- Fix both research and answer-evaluator skill references to use the shared schema file.
- Remove stale `old-schemas.md` duplicates from both research and answer-evaluator references.
- Preserve backend output-format validation for answer-evaluator JSON.

**Out of scope**

- Creating a separate OpenHands `answer-evaluator` agent.
- Reintroducing Claude/Node compatibility paths for answer evaluation.
- Migrating workflow steps unrelated to answer evaluation.
- Changing the answer-evaluation UI beyond what is required for native runtime completion.
- Changing the research question quality model.

## Reviewed Current Code

- `app/src-tauri/src/commands/workflow/runtime.rs` already has `run_answer_evaluator(...)`, but it sets `agent_name: Some("answer-evaluator")`. That is not the clean-break model.
- `app/sidecar/openhands/runner.py` currently hardcodes `skill-creator` in request validation and agent instruction loading. For this plan, that hardcoding is acceptable for answer evaluation because the clean-break approach uses the same agent and a different skill, not a new agent.
- `agent-sources/prompts/answer-evaluator.txt` exists and is loaded by `build_evaluator_prompt(...)`.
- `agent-sources/prompts/research.txt` exists and is loaded by `build_step0_prompt(...)`.
- `agent-sources/workspace/skills/answer-evaluator/SKILL.md` tells the model to read `../shared/schemas.md`, but no workspace shared schema file currently exists.
- `agent-sources/workspace/skills/research/SKILL.md` and `research/references/consolidation-handoff.md` also reference shared schemas, but workspace skills still carry stale `old-schemas.md` files.
- Plugin-side `agent-sources/plugins/skill-content-researcher/skills/shared/schemas.md` already exists and should be the source for the workspace shared copy.

## File Structure

- Modify: `agent-sources/prompts/answer-evaluator.txt`
  - App-owned user prompt for the answer-evaluator phase.
- Verify/modify: `agent-sources/prompts/research.txt`
  - Research prompt remains file-based; no inline Rust prompt body.
- Modify: `app/src-tauri/src/commands/workflow/prompt.rs`
  - Keep prompt template loading and substitution only.
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
  - Build answer-evaluator native config with `agentName = "skill-creator"` and an answer-evaluator-specific prompt.
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
  - Add Rust tests for answer-evaluator prompt rendering and native config.
- Modify: `app/sidecar/__tests__/openhands-runner.test.ts`
  - Add guard coverage that answer evaluation does not require a separate OpenHands agent.
- Create: `agent-sources/workspace/skills/shared/schemas.md`
  - Canonical workspace shared schema reference.
- Modify: `agent-sources/workspace/skills/research/SKILL.md`
  - Keep `../shared/schemas.md` references and remove stale old-schema language.
- Modify: `agent-sources/workspace/skills/research/references/consolidation-handoff.md`
  - Keep `../../shared/schemas.md` references.
- Modify: `agent-sources/workspace/skills/answer-evaluator/SKILL.md`
  - Keep `../shared/schemas.md` references and clarify direct skill execution.
- Delete: `agent-sources/workspace/skills/research/references/old-schemas.md`
- Delete: `agent-sources/workspace/skills/answer-evaluator/references/old-schemas.md`
- Keep/align: `agent-sources/plugins/skill-content-researcher/skills/shared/schemas.md`
- Delete: `agent-sources/plugins/skill-content-researcher/skills/research/references/old-schemas.md`
- Delete: `agent-sources/plugins/skill-content-researcher/skills/answer-evaluator/references/old-schemas.md`
- Modify: `repo-map.json`
  - Update only if its inventory or descriptions mention the deleted reference files or changed prompt layout.

## Task 1: Add Prompt And Runtime Contract Tests

- [ ] **Step 1: Add Rust test for answer-evaluator prompt rendering**

Add a test in `app/src-tauri/src/commands/workflow/tests.rs` that calls:

```rust
let prompt = super::prompt::build_evaluator_prompt(
    "sales-analytics",
    "/tmp/workspace",
    crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    "/tmp/skills",
);

assert!(prompt.contains("Use the answer-evaluator skill"));
assert!(prompt.contains("Skill name: sales-analytics"));
assert!(prompt.contains("/tmp/workspace"));
assert!(prompt.contains("/user-context.md"));
assert!(prompt.contains("/context"));
assert!(prompt.contains("Return only a raw JSON object"));
assert!(!prompt.contains("You are answer-evaluator"));
```

- [ ] **Step 2: Add Rust test for native answer-evaluator config**

Add a test proving the answer-evaluator config uses:

```rust
agent_name: Some("skill-creator".to_string())
runtime_provider: Some("openhands".to_string())
run_source: Some("gate-eval".to_string())
output_format: Some(answer_evaluator_output_format())
```

It must also assert:

```rust
task_kind: Some("workflow.answer_evaluator".to_string())
path_to_claude_code_executable: None
```

- [ ] **Step 3: Run tests and confirm failure before implementation**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

Expected before implementation: tests fail because answer evaluator still uses `agentName = "answer-evaluator"` or lacks `task_kind`.

## Task 2: Put The Answer-Evaluator Prompt In The Prompts Folder

- [ ] **Step 1: Replace `agent-sources/prompts/answer-evaluator.txt` with the clean-break prompt**

Use this exact prompt body:

```text
EXECUTE IMMEDIATELY. Do not greet the user, ask questions, or offer options.

Use the answer-evaluator skill to evaluate the user's answers for this workflow gate.

Skill name: {{skill_name}}
Workspace directory: {{workspace_dir}}
Skill output directory: {{skill_output_dir}}
User context file: {{workspace_dir}}/user-context.md
Context directory: {{workspace_dir}}/context
Clarifications file: {{workspace_dir}}/context/clarifications.json

All directories already exist. Do not create directories with mkdir. Do not list directories with ls.

Read user-context.md and clarifications.json, then return only a raw JSON object with this envelope:
{
  "verdict": "sufficient|mixed|insufficient",
  "answered_count": number,
  "empty_count": number,
  "vague_count": number,
  "contradictory_count": number,
  "total_count": number,
  "reasoning": "single sentence",
  "gate_decision": "run_research|revise",
  "per_question": [
    { "question_id": "Q1", "verdict": "clear|needs_refinement|not_answered|vague|contradictory", "reason": "required for needs_refinement, vague, or contradictory" }
  ]
}
```

- [ ] **Step 2: Keep Rust prompt code as template loading only**

In `app/src-tauri/src/commands/workflow/prompt.rs`, keep the current `include_str!` pattern:

```rust
const ANSWER_EVALUATOR_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/answer-evaluator.txt"
));
```

Do not add prompt prose to Rust.

- [ ] **Step 3: Run prompt tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

Expected after implementation: prompt-rendering tests pass.

## Task 3: Keep The Same OpenHands Agent And Invoke The New Skill

- [ ] **Step 1: Update `run_answer_evaluator` config**

In `app/src-tauri/src/commands/workflow/runtime.rs`, change answer evaluation from:

```rust
agent_name: Some("answer-evaluator".to_string()),
task_kind: None,
```

to:

```rust
agent_name: Some("skill-creator".to_string()),
task_kind: Some("workflow.answer_evaluator".to_string()),
```

Keep:

```rust
runtime_provider: workflow_one_shot_runtime_provider(),
required_plugins: Some(vec!["skill-content-researcher".to_string()]),
output_format: Some(answer_evaluator_output_format()),
run_source: Some("gate-eval".to_string()),
```

- [ ] **Step 2: Keep runner hardcoded to `skill-creator` for now**

Do not add a new OpenHands agent loader for `answer-evaluator`. The answer-evaluator behavior comes from the prompt plus bundled skill.

- [ ] **Step 3: Run Rust workflow tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

Expected: answer-evaluator native config tests pass.

## Task 4: Add Shared Workspace Schema Reference

- [ ] **Step 1: Create workspace shared schema file**

Create:

```text
agent-sources/workspace/skills/shared/schemas.md
```

Copy the canonical semantic schema content from:

```text
agent-sources/plugins/skill-content-researcher/skills/shared/schemas.md
```

- [ ] **Step 2: Keep workspace research references pointed at shared schema**

Verify these references exist and are correct:

```text
agent-sources/workspace/skills/research/SKILL.md -> ../shared/schemas.md
agent-sources/workspace/skills/research/references/consolidation-handoff.md -> ../../shared/schemas.md
```

- [ ] **Step 3: Keep workspace answer-evaluator reference pointed at shared schema**

Verify:

```text
agent-sources/workspace/skills/answer-evaluator/SKILL.md -> ../shared/schemas.md
```

- [ ] **Step 4: Delete stale workspace old schema files**

Delete:

```text
agent-sources/workspace/skills/research/references/old-schemas.md
agent-sources/workspace/skills/answer-evaluator/references/old-schemas.md
```

- [ ] **Step 5: Run structural tests**

Run:

```bash
cd app && npm run test:agents:structural
```

Expected: no broken local reference paths.

## Task 5: Remove Plugin-Side Old Schema Duplicates

- [ ] **Step 1: Verify plugin shared schema references**

Verify:

```text
agent-sources/plugins/skill-content-researcher/skills/research/SKILL.md -> ../shared/schemas.md
agent-sources/plugins/skill-content-researcher/skills/research/references/consolidation-handoff.md -> ../../shared/schemas.md
agent-sources/plugins/skill-content-researcher/skills/answer-evaluator/SKILL.md -> ../shared/schemas.md
```

- [ ] **Step 2: Delete stale plugin old schema files**

Delete:

```text
agent-sources/plugins/skill-content-researcher/skills/research/references/old-schemas.md
agent-sources/plugins/skill-content-researcher/skills/answer-evaluator/references/old-schemas.md
```

- [ ] **Step 3: Run structural tests again**

Run:

```bash
cd app && npm run test:agents:structural
```

Expected: no broken plugin-side local reference paths.

## Task 6: Add Sidecar Regression Coverage For The Clean-Break Constraint

- [ ] **Step 1: Add a sidecar runner test proving answer evaluation uses skill-creator**

In `app/sidecar/__tests__/openhands-runner.test.ts`, add or update coverage so a request with:

```json
{
  "agentName": "skill-creator",
  "taskKind": "workflow.answer_evaluator",
  "prompt": "Use the answer-evaluator skill..."
}
```

loads `.agents/agents/skill-creator.md` and `.agents/skills/answer-evaluator/SKILL.md`.

- [ ] **Step 2: Do not add tests requiring `agentName = answer-evaluator`**

That is explicitly out of scope for this plan.

- [ ] **Step 3: Run sidecar tests**

Run:

```bash
cd app/sidecar && npx vitest run __tests__/openhands-runner.test.ts
```

Expected: clean-break runner behavior passes without introducing a new agent.

## Task 7: Quality Gates

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
cd app/sidecar && npx vitest run __tests__/openhands-runner.test.ts
cd app && npm run test:agents:structural
cd app && npm run test:unit
```

If the answer-evaluator prompt materially changes live model behavior, also run:

```bash
cd tests/evals && npm test
cd tests/evals && npm run eval:smoke
```

## Acceptance Criteria

- Answer-evaluator prompt lives in `agent-sources/prompts/answer-evaluator.txt`.
- Research prompt remains in `agent-sources/prompts/research.txt`.
- Rust prompt code only loads and substitutes prompt templates.
- Answer evaluation uses `agentName = "skill-creator"`.
- Answer evaluation uses `taskKind = "workflow.answer_evaluator"`.
- Answer evaluation runs through `runtimeProvider = "openhands"`.
- No new OpenHands `answer-evaluator` agent is created.
- The prompt instructs the shared agent to use the bundled `answer-evaluator` skill.
- Workspace `.agents/skills/shared/schemas.md` exists and is deployed.
- Research and answer-evaluator both reference the shared schema.
- Stale `old-schemas.md` files are removed from workspace and plugin skill references.
- Tests prove the prompt, runtime config, and reference layout.
