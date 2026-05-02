# OpenHands Workflow Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate workflow step 0 Research to the OpenHands-native clean-break runtime so the app streams OpenHands tool/reasoning events while Rust extracts the final JSON result and materializes `context/clarifications.json`.

**Architecture:** Implement this as a child branch/worktree off `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`, then merge the tested child branch back into the VU-1145 accumulation branch. Keep one OpenHands agent, `skill-creator`; route step behavior through app-owned prompts and `task_kind = "workflow.research"`. The frontend observes OpenHands `conversation_event` / `conversation_state` records and no longer owns research output materialization.

**Tech Stack:** Tauri Rust commands, Node/OpenHands sidecar protocol, Python OpenHands SDK runner, React/Zustand event stream UI, Vitest, cargo tests, live OpenHands smoke testing.

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
- Adding SDK `outputFormat` support. OpenHands terminal text is the source; Rust extracts and validates JSON.

## Reviewed Current Code

- `app/src-tauri/src/commands/workflow/runtime.rs:59` still loads old `StepConfig` and routes step 0 to `research-agent`.
- `app/src-tauri/src/commands/workflow/runtime.rs:124` constructs `SidecarConfig` manually instead of using the OpenHands one-shot helper.
- `app/src-tauri/src/commands/workflow/runtime.rs:180` leaves `task_kind` empty.
- `app/src-tauri/src/commands/workflow/runtime.rs:374` starts the sidecar and returns `agent_id`; no backend listener parses terminal `conversation_state` or materializes output.
- `app/src-tauri/src/commands/workflow/prompt.rs:72` hard-codes the step 0 prompt and says `You are research-agent`.
- `app/src/hooks/use-workflow-state-machine.ts:331` still extracts legacy `displayItems[].structuredOutput`.
- `app/src/hooks/use-workflow-state-machine.ts:349` still calls `materializeWorkflowStepOutput(...)` from the frontend.
- `app/src-tauri/src/agents/sidecar.rs:139` and `app/src-tauri/src/agents/sidecar.rs:265` already provide the clean OpenHands config and terminal wait boundaries used by scope review.
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
  - Extract reusable nonblocking one-shot start/listener pieces if needed so workflow can return `agent_id` immediately and still materialize in the backend after terminal state.
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

- [ ] Add Rust tests in `app/src-tauri/src/commands/workflow/tests.rs` proving the desired step 0 OpenHands contract:
  - rendered research prompt contains `skill_name`, `workspace_dir`, `context_dir`, `user-context.md`, and max dimensions;
  - rendered research prompt does not contain `research-agent`, `subagent`, or `delegate`;
  - config uses `runtimeProvider = "openhands"`;
  - config uses `agentName = "skill-creator"`;
  - config uses `taskKind = "workflow.research"`;
  - config uses `mode = "one-shot"`;
  - config uses `allowedTools = ["file_editor", "terminal"]`;
  - config carries `outputFormat` only as app-side schema metadata.
- [ ] Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow::tests::research
```

Expected: new tests fail because the code still routes step 0 through `research-agent` and the hard-coded prompt.

## Task 2: Externalize The Research Prompt

- [ ] Create `agent-sources/prompts/research.txt` with a single user-message template:

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

- [ ] Modify `app/src-tauri/src/commands/workflow/prompt.rs` to add:

```rust
const RESEARCH_PROMPT_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/research.txt"
));
```

- [ ] Replace the `format!(...)` body in `build_step0_prompt(...)` with template rendering using the same normalized `workspace_str` currently computed by the function.
- [ ] Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow::tests::research
```

Expected: prompt tests pass; config tests still fail until runtime routing is changed.

- [ ] Add or update deterministic assertions proving workflow prompt templates
  are rendered from `agent-sources/prompts/**`, not
  `agent-sources/workspace/prompts/**`.

Run:

```bash
cd tests/evals && npm test
```

Expected: static eval assertions pass after they are updated for the current
prompt layout.

## Task 3: Simplify The Research Skill For One-Agent Execution

- [ ] Update `agent-sources/workspace/skills/research/SKILL.md` to make the execution model explicit:
  - say this skill runs inside the single `skill-creator` OpenHands agent;
  - say all dimension scoring, selected-dimension research, and consolidation happen inline in this same run;
  - remove references to downstream agents except the existing data-field note that `answer_evaluator_notes` is populated later by the workflow;
  - keep the final JSON envelope and strict schema requirements.
- [ ] Update `agent-sources/workspace/skills/research/references/scoring-rubric.md` so “dimension research agent” becomes “dimension research focus”.
- [ ] Update `agent-sources/workspace/skills/research/references/consolidation-handoff.md` so “dimension sub-agent outputs” becomes “dimension research notes”.
- [ ] Run:

```bash
rg -n "subagent|sub-agent|delegate|delegation|dimension agent|dimension sub-agent" agent-sources/workspace/skills/research
```

Expected: no matches except acceptable historical references in files explicitly marked old/deprecated, if any.

- [ ] Run:

```bash
cd app && npm run test:agents:structural
```

Expected: agent-source structural tests pass.

## Task 4: Add Backend Research JSON Extraction

- [ ] Add a Rust helper that extracts the final research JSON from terminal OpenHands `conversation_state.result_text`.
- [ ] The helper must:
  - require `type = "conversation_state"`;
  - require `status = "completed"`;
  - read `result_text` or `resultText`;
  - strip a single surrounding Markdown JSON fence if present;
  - parse a JSON object;
  - reject missing, empty, non-object, or invalid JSON with a clear error.
- [ ] Add tests for:
  - raw JSON object text;
  - fenced JSON;
  - missing `result_text`;
  - terminal `error` with `error_detail`;
  - invalid JSON.
- [ ] Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow::tests::research
```

Expected: JSON extraction tests pass.

## Task 5: Build The OpenHands Research Request

- [ ] Add a step 0 research request builder in `app/src-tauri/src/commands/workflow/runtime.rs` or a small sibling module if the file becomes too large.
- [ ] Use `crate::agents::sidecar::build_openhands_one_shot_config(...)` with:
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
- [ ] Keep step 1-3 routing unchanged in this issue.
- [ ] Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow::tests::research
```

Expected: research config tests pass.

## Task 6: Add Nonblocking Backend Materialization For Research

- [ ] Preserve the current `run_workflow_step(...) -> agent_id` frontend contract so the UI can register the active run immediately and show streaming events.
- [ ] Start the OpenHands request as step 0, return `agent_id` immediately, and install a backend terminal listener before dispatching the sidecar request.
- [ ] When terminal `conversation_state` arrives for that `agent_id`:
  - extract research JSON from `result_text`;
  - call `materialize_workflow_step_output_value(&workspace_skill_dir, 0, &payload)`;
  - emit a new Tauri event such as `workflow-step-materialized` with `{ agent_id, skill_name, step_id: 0, success: true }`;
  - on parse/materialization failure, emit the same event with `success: false` and `error_detail`, and ensure the run finishes as an error.
- [ ] Remove the `WorkflowStepRunManager` entry after terminal completion, error, or shutdown.
- [ ] Keep cleanup and guard behavior from `run_workflow_step(...)` unchanged.
- [ ] Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

Expected: all workflow Rust tests pass.

## Task 7: Update Frontend Research Completion Semantics

- [ ] Update `app/src/lib/workflow-step-configs.ts` so step 0 no longer requires legacy frontend structured output.
- [ ] Add a typed listener for `workflow-step-materialized` in the workflow state machine or a focused hook.
- [ ] For step 0:
  - keep calling `agentStartRun(agentId, model)` immediately after `runWorkflowStep(...)`;
  - keep rendering OpenHands `conversation_event` records through the existing agent stream;
  - when the run completes, do not call `materializeWorkflowStepOutput(...)`;
  - require either the successful `workflow-step-materialized` event or `verifyStepOutput(...)` success before marking the step completed;
  - show `error_detail` when backend materialization fails.
- [ ] Keep steps 1-3 on the existing structured-output/materialize path until their own migration issues.
- [ ] Add tests in `app/src/__tests__/pages/workflow.test.tsx` for:
  - step 0 OpenHands `conversation_event` tool/reasoning records are visible while the run is active;
  - step 0 terminal `conversation_state` plus successful materialization completes the step;
  - step 0 does not call `materializeWorkflowStepOutput(...)`;
  - failed backend materialization shows an error and leaves the step in error state;
  - steps 1 and 3 still call `materializeWorkflowStepOutput(...)`.
- [ ] Run:

```bash
cd app && npx vitest run src/__tests__/pages/workflow.test.tsx src/__tests__/hooks/use-agent-stream.test.ts
```

Expected: workflow UI tests pass.

## Task 8: Verify Event Visibility End To End

- [ ] Add or update a test fixture that emits:
  - `conversation_event` with reasoning text;
  - `conversation_event` with a file read or edit tool call;
  - `conversation_event` with an observation;
  - terminal `conversation_state`;
  - `agent-exit`.
- [ ] Prove the UI displays the reasoning/tool/observation rows before completion.
- [ ] Prove the terminal result is not displayed as a legacy `display_item` result.
- [ ] Run:

```bash
cd app && npx vitest run src/__tests__/components/agent-output-panel.test.tsx src/__tests__/pages/workflow.test.tsx
```

Expected: OpenHands event display tests pass.

## Task 9: Update Existing Evals And Run Research Smoke

- [ ] Review the existing eval inventory before changing eval coverage:

```bash
cd tests/evals && npm test
cd tests/evals && npm run eval:skill-content-researcher-research
cd tests/evals && npm run eval:workspace-workflow-step-prompt
```

Expected: failures, if any, identify stale `research-agent`,
`skill-writer-agent`, or `agent-sources/workspace/prompts/**` assumptions.

- [ ] Update `tests/evals/packages/skill-content-researcher-research` so it
  validates the simplified single-agent research skill behavior and the
  `workflow.research` final JSON envelope.
- [ ] Update `tests/evals/packages/workspace-workflow-step-prompt` if the old
  shared `workflow-step.txt` package no longer covers the new step 0
  `research.txt` prompt. Prefer extending the existing package over adding a
  new one.
- [ ] Update `tests/evals/assertions/workflow-openhands-static.test.js` so it
  reads active prompt files from `agent-sources/prompts/**` and asserts the
  OpenHands topology no longer depends on `research-agent` for step 0.
- [ ] Run:

```bash
cd tests/evals && npm test
cd tests/evals && npm run eval:skill-content-researcher-research
cd tests/evals && npm run eval:workspace-workflow-step-prompt
```

Expected: deterministic assertions and targeted existing eval packages pass.

## Task 10: Live OpenHands Research Smoke

- [ ] Build the sidecar/runner if needed:

```bash
cd app && npm run sidecar:build
```

- [ ] Run the app in dev mode with real OpenHands settings configured:

```bash
cd app && npm run dev
```

- [ ] In the UI, create or reuse a focused test skill and start workflow step 0.
- [ ] Confirm:
  - tool calls and reasoning/progress events appear while the run is active;
  - the request does not hang after the agent returns;
  - `context/clarifications.json` exists in the skill workspace;
  - the UI advances to the completed research step state;
  - failures show an app-visible error message instead of silently hanging.
- [ ] Capture the transcript log path in the PR notes.

## Task 11: Docs, Plan, And Repo Map Audit

- [ ] Update `docs/design/openhands-sdk-runner/README.md` to document:
  - workflow research uses `skill-creator` with `task_kind = "workflow.research"`;
  - research streams `conversation_event` records directly to the UI;
  - Rust extracts terminal `conversation_state.result_text`, validates, and materializes output;
  - the frontend no longer materializes step 0 output.
- [ ] Update `docs/plans/2026-05-02-openhands-native-migration.md` to mark this child issue as the workflow research migration slice.
- [ ] Audit `repo-map.json` only if files are added/removed in mapped directories.
- [ ] Run:

```bash
npx markdownlint docs/design/openhands-sdk-runner/README.md docs/plans/2026-05-02-openhands-native-migration.md docs/plans/2026-05-02-openhands-workflow-research.md
```

Expected: markdownlint passes.

## Task 12: Final Verification And Commit

- [ ] Run the targeted verification set:

```bash
cd app && npm run test:agents:structural
cd app && npx vitest run src/__tests__/pages/workflow.test.tsx src/__tests__/hooks/use-agent-stream.test.ts src/__tests__/components/agent-output-panel.test.tsx
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
cd tests/evals && npm test
```

- [ ] Run broader checks if the implementation changes shared event types or generated command types:

```bash
cd app && npm run codegen
cd app && npm run test:unit
```

- [ ] Commit and push from the child worktree:

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
