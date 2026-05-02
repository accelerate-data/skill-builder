# OpenHands Workflow Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate workflow step 0 Research to the OpenHands-native clean-break runtime so the app streams OpenHands tool/reasoning events while Rust extracts the final JSON result and materializes `context/clarifications.json`.

**Architecture:** Implement this as a child branch/worktree off `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`, then merge the tested child branch back into the VU-1145 accumulation branch. Keep one OpenHands agent, `skill-creator`; route step behavior through app-owned prompts and `task_kind = "workflow.research"`. Use a clean-break Rust -> Python OpenHands runner boundary for OpenHands calls. Node is not in the OpenHands workflow research path. The frontend observes OpenHands `conversation_event` / `conversation_state` records and no longer owns research output materialization.

**Tech Stack:** Tauri Rust commands, Rust OpenHands process manager, Python OpenHands SDK runner, React/Zustand event stream UI, Vitest, cargo tests, live OpenHands smoke testing.

---

## Linear And Branch Contract

- Linear issue: `VU-1148`
- Parent issue: `VU-1145`
- Base branch: `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`
- Implementation branch: `feature/vu-1148-openhands-workflow-research`
- Worktree command after the issue exists:

```bash
cd /Users/hbanerjee/src/worktrees/feature/vu-1145-implement-openhands-native-clean-break-agent-runtime
./scripts/worktree.sh feature/vu-1148-openhands-workflow-research
```

- Implement and test only in the child worktree.
- Raise the PR with base `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`.
- Merge the tested child branch back into the VU-1145 accumulation branch.

## Scope

**In scope**

- Migrate workflow step 0 Research to OpenHands one-shot execution.
- Spawn the bundled Python `openhands-runner` directly from Rust for OpenHands one-shot calls; do not route OpenHands workflow research through the Node sidecar.
- Use the shared `skill-creator` OpenHands agent with `task_kind = "workflow.research"`.
- Keep the current UI progress behavior by streaming OpenHands `conversation_event` records for reasoning, tool calls, observations, and parallel action groups while the run is active.
- Move the research task prompt to `agent-sources/prompts/research.txt`.
- Ensure every app-owned prompt touched by this slice is compiled/rendered from
  `agent-sources/prompts/**`; do not introduce or revive
  `agent-sources/workspace/prompts/**`.
- Simplify `agent-sources/workspace/skills/research/SKILL.md` so it describes a single-agent inline research flow and does not refer to subagents, dimension agents, or delegated research outputs.
- Extract final JSON from terminal `conversation_state.result_text`.
- Validate and materialize the result in Rust by reusing `materialize_workflow_step_output_value(...)`.
- Preserve current step 0 semantics: cleanup before run, `user-context.md` refresh, scope recommendation behavior, output file verification, disabled downstream steps, and app-visible failure messages.

**Out of scope**

- Migrating workflow steps 1-3.
- Reworking answer evaluator / gate execution.
- Improving the quality of research questions beyond making the step run end to end.
- Reintroducing Claude-style `display_item`, `run_result`, or frontend-owned structured-output materialization for OpenHands.
- Preserving Node as an OpenHands runtime adapter. Existing Node/Claude files may remain until broader cleanup, but new or migrated OpenHands calls must use the direct Rust runner boundary.
- Adding SDK `outputFormat` support. OpenHands terminal text is the source; Rust extracts and validates JSON.

## Reviewed Current Code

- `app/src-tauri/src/commands/workflow/runtime.rs:59` still loads old `StepConfig` and routes step 0 to `research-agent`.
- `app/src-tauri/src/commands/workflow/runtime.rs:124` constructs `SidecarConfig` manually instead of using the OpenHands one-shot helper.
- `app/src-tauri/src/commands/workflow/runtime.rs:180` leaves `task_kind` empty.
- `app/src-tauri/src/commands/workflow/runtime.rs:374` starts the sidecar and returns `agent_id`; no backend listener parses terminal `conversation_state` or materializes output.
- `app/src-tauri/src/commands/workflow/prompt.rs:72` hard-codes the step 0 prompt and says `You are research-agent`.
- `app/src/hooks/use-workflow-state-machine.ts:331` still extracts legacy `displayItems[].structuredOutput`.
- `app/src/hooks/use-workflow-state-machine.ts:349` still calls `materializeWorkflowStepOutput(...)` from the frontend.
- `app/src-tauri/src/agents/sidecar.rs` owns the clean OpenHands config, direct runner dispatch, transcript logging, terminal wait, and event routing boundaries used by scope review and workflow research.
- `app/src/lib/openhands-conversation-events.ts` and `app/src/components/agent-items/conversation-event-list.tsx` already support OpenHands-native event rendering from VU-1147; workflow research must use that path directly.

## File Structure

- Create: `agent-sources/prompts/research.txt`
  - App-owned research task prompt rendered by Rust and sent as the user message.
- Modify: `agent-sources/workspace/skills/research/SKILL.md`
  - Simplify to one-agent inline research; remove subagent/delegation language.
- Modify: `agent-sources/workspace/skills/research/references/scoring-rubric.md`
  - Rename any “dimension research agent” wording to “dimension research focus” or equivalent single-agent wording.
- Modify: `agent-sources/workspace/skills/research/references/consolidation-handoff.md`
  - Rename “dimension sub-agent outputs” wording to “dimension research notes” or equivalent single-agent wording.
- Modify: `app/src-tauri/src/commands/workflow/prompt.rs`
  - Compile and render the new research prompt template.
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
  - Add the OpenHands research task builder and backend materialization listener.
- Modify: `app/src-tauri/src/commands/workflow/output_format.rs`
  - Add or expose a strict helper for parsing research JSON from terminal result text if keeping it near materialization is cleaner.
- Modify: `app/src-tauri/src/agents/sidecar.rs`
  - Add the Rust-owned OpenHands process dispatcher, stdout JSONL router, stderr logger, transcript writer, and reusable blocking one-shot helper. OpenHands calls must not pass through Node.
- Modify: `app/src/lib/workflow-step-configs.ts`
  - Stop requiring frontend structured output for step 0 after backend-owned materialization.
- Modify: `app/src/hooks/use-workflow-state-machine.ts`
  - For step 0, complete based on backend-materialized artifacts and OpenHands terminal state, not frontend structured output.
- Modify: `app/src/lib/tauri.ts` and `app/src/lib/tauri-command-types.ts`
  - Keep old `materialize_workflow_step_output` for non-migrated steps; avoid calling it for research.
- Modify: `app/src/__tests__/pages/workflow.test.tsx`
  - Add/update workflow research tests for OpenHands terminal state and event streaming.
- Modify: `app/src/__tests__/hooks/use-agent-stream.test.ts`
  - Ensure workflow OpenHands conversation events remain stored/renderable while terminal state completes the run.
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
  - Add Rust tests for prompt rendering, JSON extraction, backend materialization, and research config.
- Modify: `docs/design/openhands-sdk-runner/README.md`
  - Document workflow research as the first backend-materialized workflow one-shot.
- Modify: `docs/plans/2026-05-02-openhands-native-migration.md`
  - Mark workflow research as the next VU-1145 child slice and link this plan.
- Modify: `tests/evals/packages/skill-content-researcher-research/*`
  - Reuse the existing research eval package and update expectations for the
    `skill-creator` / `workflow.research` route.
- Modify: `tests/evals/packages/workspace-workflow-step-prompt/*`
  - Reuse the existing workflow prompt eval package or split its cases only if
    the new `research.txt` prompt makes that package ambiguous.
- Modify: `tests/evals/assertions/workflow-openhands-static.test.js`
  - Update static assertions to the current `agent-sources/prompts/**` layout
    and the new OpenHands research topology.

## Task 1: Add Research Runtime Contract Tests

- [x] Add Rust tests in `app/src-tauri/src/commands/workflow/tests.rs` proving the desired step 0 OpenHands contract:
  - rendered research prompt contains `skill_name`, `workspace_dir`, `context_dir`, `user-context.md`, and max dimensions;
  - rendered research prompt does not contain `research-agent`, `subagent`, or `delegate`;
  - config uses `runtimeProvider = "openhands"`;
  - config uses `agentName = "skill-creator"`;
  - config uses `taskKind = "workflow.research"`;
  - config uses `mode = "one-shot"`;
  - config uses `allowedTools = ["file_editor", "terminal"]`;
  - config carries `outputFormat` only as app-side schema metadata.
- [x] Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow::tests::research
```

Result: passed as part of `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow`.

## Task 2: Externalize The Research Prompt

- [x] Create `agent-sources/prompts/research.txt` with a single user-message template:

```text
EXECUTE IMMEDIATELY. Do not greet the user, ask questions, or offer options.

Use the research skill to produce workflow step 0 clarification output for this skill.

Skill name: {{skill_name}}
Workspace directory: {{workspace_dir}}
User context file: {{workspace_dir}}/user-context.md
Context directory: {{workspace_dir}}/context
Maximum research dimensions before scope warning: {{max_dimensions}}

All directories already exist. Do not create directories with mkdir. Do not list directories with ls.

Return only a raw JSON object with this envelope:
{
  "status": "research_complete",
  "dimensions_selected": number,
  "question_count": number,
  "research_output": { ...canonical clarifications.json object... }
}
```

- [x] Modify `app/src-tauri/src/commands/workflow/prompt.rs` to add:

```rust
const RESEARCH_PROMPT_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/research.txt"
));
```

- [x] Replace the `format!(...)` body in `build_step0_prompt(...)` with template rendering using the same normalized `workspace_str` currently computed by the function.
- [x] Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow::tests::research
```

Result: passed as part of `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow`.

- [x] Add or update deterministic assertions proving workflow prompt templates
  are rendered from `agent-sources/prompts/**`, not
  `agent-sources/workspace/prompts/**`.

Run:

```bash
cd tests/evals && npm test
```

Expected: static eval assertions pass after they are updated for the current
prompt layout.

## Task 3: Simplify The Research Skill For One-Agent Execution

- [x] Update `agent-sources/workspace/skills/research/SKILL.md` to make the execution model explicit:
  - say this skill runs inside the single `skill-creator` OpenHands agent;
  - say all dimension scoring, selected-dimension research, and consolidation happen inline in this same run;
  - remove references to downstream agents except the existing data-field note that `answer_evaluator_notes` is populated later by the workflow;
  - keep the final JSON envelope and strict schema requirements.
- [x] Update `agent-sources/workspace/skills/research/references/scoring-rubric.md` so “dimension research agent” becomes “dimension research focus”.
- [x] Update `agent-sources/workspace/skills/research/references/consolidation-handoff.md` so “dimension sub-agent outputs” becomes “dimension research notes”.
- [x] Run:

```bash
rg -n "subagent|sub-agent|delegate|delegation|dimension agent|dimension sub-agent" agent-sources/workspace/skills/research
```

Expected: no matches except acceptable historical references in files explicitly marked old/deprecated, if any.

- [x] Run:

```bash
cd app && npm run test:agents:structural
```

Expected: agent-source structural tests pass.

## Task 4: Add Backend Research JSON Extraction

- [x] Add a Rust helper that extracts the final research JSON from terminal OpenHands `conversation_state.result_text`.
- [x] The helper must:
  - require `type = "conversation_state"`;
  - require `status = "completed"`;
  - read `result_text` or `resultText`;
  - strip a single surrounding Markdown JSON fence if present;
  - parse a JSON object;
  - reject missing, empty, non-object, or invalid JSON with a clear error.
- [x] Add tests for:
  - raw JSON object text;
  - fenced JSON;
  - missing `result_text`;
  - terminal `error` with `error_detail`;
  - invalid JSON.
- [x] Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow::tests::research
```

Expected: JSON extraction tests pass.

## Task 5: Build The OpenHands Research Request

- [x] Add a step 0 research request builder in `app/src-tauri/src/commands/workflow/runtime.rs` or a small sibling module if the file becomes too large.
- [x] Use `crate::agents::sidecar::build_openhands_one_shot_config(...)` with:
  - `agent_name: "skill-creator"`;
  - `task_kind: Some("workflow.research")`;
  - `user_message_suffix: Some(skill-creator user suffix)`;
  - `allowed_tools: vec!["file_editor", "terminal"]`;
  - `max_turns: 50`;
  - `output_format: workflow_output_format_for_step(0)`;
  - `skill_name: Some(skill_name.to_string())`;
  - `step_id: Some(0)`;
  - `run_source: Some("workflow".to_string())`;
  - `workspace_root_dir` from the initialized workspace path;
  - `workspace_run_dir` as the skill-scoped workspace directory.
- [x] Keep step 1-3 routing unchanged in this issue.
- [x] Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow::tests::research
```

Expected: research config tests pass.

## Task 6: Add Nonblocking Backend Materialization For Research

- [x] Add a Rust-owned `dispatch_openhands_one_shot(...)` helper that:
  - resolves and spawns the bundled `openhands-runner` directly;
  - writes the runner request JSON to stdin;
  - treats stdout as JSONL protocol only and routes each line through the Rust event router;
  - writes redacted stderr to app logs only;
  - writes per-run transcript JSONL with the redacted config first line;
  - emits `agent-exit` from Rust after terminal state or runner exit;
  - supports direct cancellation for Rust-spawned OpenHands processes without falling back to the Node sidecar cancel path.
- [x] Update the shared blocking `run_openhands_one_shot(...)` helper used by scope review to use the direct Rust runner instead of the Node persistent sidecar.
- [x] Preserve the current `run_workflow_step(...) -> agent_id` frontend contract so the UI can register the active run immediately and show streaming events.
- [x] Start the OpenHands request as step 0, return `agent_id` immediately, and install a backend terminal listener before dispatching the direct runner request.
- [x] When terminal `conversation_state` arrives for that `agent_id`:
  - extract research JSON from `result_text`;
  - call `materialize_workflow_step_output_value(&workspace_skill_dir, 0, &payload)`;
  - emit a new Tauri event such as `workflow-step-materialized` with `{ agent_id, skill_name, step_id: 0, success: true }`;
  - on parse/materialization failure, emit the same event with `success: false` and `error_detail`, and ensure the run finishes as an error.
- [x] Remove the `WorkflowStepRunManager` entry after terminal completion, error, or shutdown.
- [x] Keep cleanup and guard behavior from `run_workflow_step(...)` unchanged.
- [x] Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

Expected: all workflow Rust tests pass.

## Task 7: Update Frontend Research Completion Semantics

- [x] Update `app/src/lib/workflow-step-configs.ts` so step 0 no longer requires legacy frontend structured output.
- [x] Add a typed listener for `workflow-step-materialized` in the workflow state machine or a focused hook.
- [x] For step 0:
  - keep calling `agentStartRun(agentId, model)` immediately after `runWorkflowStep(...)`;
  - keep rendering OpenHands `conversation_event` records through the existing agent stream;
  - when the run completes, do not call `materializeWorkflowStepOutput(...)`;
  - require either the successful `workflow-step-materialized` event or `verifyStepOutput(...)` success before marking the step completed;
  - show `error_detail` when backend materialization fails.
- [x] Keep steps 1-3 on the existing structured-output/materialize path until their own migration issues.
- [x] Add tests in `app/src/__tests__/pages/workflow.test.tsx` for:
  - step 0 OpenHands `conversation_event` tool/reasoning records are visible while the run is active;
  - step 0 terminal `conversation_state` plus successful materialization completes the step;
  - step 0 does not call `materializeWorkflowStepOutput(...)`;
  - failed backend materialization shows an error and leaves the step in error state;
  - steps 1 and 3 still call `materializeWorkflowStepOutput(...)`.
- [x] Run:

```bash
cd app && npx vitest run src/__tests__/pages/workflow.test.tsx src/__tests__/hooks/use-agent-stream.test.ts
```

Expected: workflow UI tests pass.

## Task 8: Verify Event Visibility End To End

- [x] Add or update a test fixture that emits:
  - `conversation_event` with reasoning text;
  - `conversation_event` with a file read or edit tool call;
  - `conversation_event` with an observation;
  - terminal `conversation_state`;
  - `agent-exit`.
- [x] Prove the UI displays the reasoning/tool/observation rows before completion.
- [x] Prove the terminal result is not displayed as a legacy `display_item` result.
- [x] Run:

```bash
cd app && npx vitest run src/__tests__/components/agent-output-panel.test.tsx src/__tests__/pages/workflow.test.tsx
```

Expected: OpenHands event display tests pass.

## Task 9: Update Existing Evals And Run Research Smoke

- [x] Review the existing eval inventory before changing eval coverage:

```bash
cd tests/evals && npm test
cd tests/evals && npm run eval:skill-content-researcher-research
cd tests/evals && npm run eval:workspace-workflow-step-prompt
```

Expected: failures, if any, identify stale `research-agent`,
`skill-writer-agent`, or `agent-sources/workspace/prompts/**` assumptions.

- [x] Update `tests/evals/packages/skill-content-researcher-research` so it
  validates the simplified single-agent research skill behavior and the
  `workflow.research` final JSON envelope.
- [x] Update `tests/evals/packages/workspace-workflow-step-prompt` if the old
  shared `workflow-step.txt` package no longer covers the new step 0
  `research.txt` prompt. Prefer extending the existing package over adding a
  new one.
- [x] Update `tests/evals/assertions/workflow-openhands-static.test.js` so it
  reads active prompt files from `agent-sources/prompts/**` and asserts the
  OpenHands topology no longer depends on `research-agent` for step 0.
- [x] Run:

```bash
cd tests/evals && npm test
cd tests/evals && npm run eval:skill-content-researcher-research
cd tests/evals && npm run eval:workspace-workflow-step-prompt
```

Expected: deterministic assertions and targeted existing eval packages pass.

## Task 10: Automated OpenHands Research Smoke

- [x] Build the sidecar/runner if needed:

```bash
cd app && npm run sidecar:build
```

- [x] Add live OpenHands SDK integration coverage for
  `agentName = "skill-creator"` and `taskKind = "workflow.research"`. The
  test resolves LLM config from explicit `SKILL_BUILDER_OPENHANDS_*` env vars
  first, then falls back to the app SQLite `model_settings` row so local live
  validation uses the configured app settings:

```bash
cd app/sidecar && npx vitest run __tests__/openhands-runner.integration.test.ts __tests__/openhands-workflow-smoke.test.ts
```

- [x] Confirm the automated suite covers:
  - OpenHands `conversation_event` records before terminal state;
  - terminal `conversation_state.result_text` extraction;
  - parseable research JSON, including fenced JSON tolerance;
  - backend `context/clarifications.json` materialization;
  - UI completion and error behavior without frontend `materializeWorkflowStepOutput(...)`.
- [x] Run the live SDK case using the DB-backed app settings and capture the
  transcript/log evidence in the PR notes.

Result: local automated command passed with both live SDK cases executed against
the configured app DB LLM settings. No manual-only test remains; the live
provider smoke is automated and uses env vars only as overrides.

## Task 11: Docs, Plan, And Repo Map Audit

- [x] Update `docs/design/openhands-sdk-runner/README.md` to document:
  - workflow research uses `skill-creator` with `task_kind = "workflow.research"`;
  - research streams `conversation_event` records directly to the UI;
  - Rust extracts terminal `conversation_state.result_text`, validates, and materializes output;
  - the frontend no longer materializes step 0 output.
- [x] Update `docs/plans/2026-05-02-openhands-native-migration.md` to mark this child issue as the workflow research migration slice.
- [x] Audit `repo-map.json` only if files are added/removed in mapped directories.
- [x] Run:

```bash
npx markdownlint docs/design/openhands-sdk-runner/README.md docs/plans/2026-05-02-openhands-native-migration.md docs/plans/2026-05-02-openhands-workflow-research.md
```

Expected: markdownlint passes.

## Task 12: Final Verification And Commit

- [x] Run the targeted verification set:

```bash
cd app && npm run test:agents:structural
cd app && npx vitest run src/__tests__/pages/workflow.test.tsx src/__tests__/hooks/use-agent-stream.test.ts src/__tests__/components/agent-output-panel.test.tsx
cargo test --manifest-path app/src-tauri/Cargo.toml agents::sidecar
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill
cd tests/evals && npm test
cd app/sidecar && npx vitest run __tests__/openhands-runner.integration.test.ts
```

- [x] Run broader checks if the implementation changes shared event types or generated command types:

```bash
cd app && npm run codegen
cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings
cd app && bash tests/run.sh e2e --tag @workflow
```

- [x] Commit and push from the child worktree:

```bash
git status --short
git add agent-sources app docs repo-map.json
git commit -m "VU-1148: migrate workflow research to OpenHands"
git push -u origin feature/vu-1148-openhands-workflow-research
```

- [ ] Raise a PR to `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`.

## Residual Risks

- Research prompt quality is intentionally not optimized in this slice; the acceptance bar is that OpenHands runs, streams events, returns JSON, and materializes artifacts.
- The new backend materialization event must be race-safe with fast terminal runs. Frontend tests should cover terminal/materialization events arriving before `agentStartRun(...)`.
- Step 1-3 still use the older workflow path, so code should avoid broad deletion of shared structured-output materialization until those steps migrate.
