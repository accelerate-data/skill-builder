# OpenHands Native Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement each child slice. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** VU-1145

**Goal:** Finish the clean-break migration from Claude SDK workflow execution to an OpenHands-native runtime while preserving Skill Builder's app-owned runtime contracts.

**Architecture:** VU-1145 is an accumulation branch. Each implementation slice must be built in a child branch/worktree off `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`, tested independently, then merged back into the VU-1145 branch. The final runtime has one top-level OpenHands agent named `skill-creator`; task behavior comes from app-rendered prompt templates, request metadata, selected tools, output schemas, and file-based skills under `.agents/skills/`.

**Tech Stack:** Tauri v2, Rust, React/TypeScript, Node.js sidecar, Python OpenHands SDK runner, PyInstaller, Vitest, cargo test, agent structural tests, Promptfoo/OpenCode evals.

---

## Source Context

- Parent Linear issue: `VU-1145`
- Current child issue: `VU-1148`
- Primary design: `docs/design/openhands-native-migration/README.md`
- SDK runner design: `docs/design/openhands-sdk-runner/README.md`
- Runtime boundary design: `docs/design/agent-runtime-boundary/README.md`
- Model settings design: `docs/design/model-settings/README.md`
- Validate child plan: `docs/plans/2026-05-02-scope-review-openhands-validate.md`
- Event-shape child plan: `docs/plans/2026-05-02-openhands-event-shape-hardening.md`
- Workflow research child plan: `docs/plans/2026-05-02-openhands-workflow-research.md`

## Current State Snapshot

This snapshot reflects the VU-1145 accumulation branch after VU-1146 and
VU-1147 merged back. VU-1148 is the next child branch and migrates workflow
step 0 Research.

| Area | Status | Evidence |
|---|---|---|
| Runtime boundary types | Done for one-shot OpenHands | VU-1146 added task metadata, runtime LLM projection, terminal `conversation_state`, and the one-shot result boundary needed by Validate. |
| Sidecar config validation | Done for one-shot OpenHands | VU-1146 validates OpenHands request fields including `taskKind`, `agentName`, `llm`, workspace paths, and `userMessageSuffix`. |
| OpenHands runtime adapter | Done for one-shot OpenHands | The sidecar forwards app-framed `conversation_event` and `conversation_state` records without legacy OpenHands display/run-result mappings. |
| Python runner | Done for one-shot OpenHands | The runner uses one `skill-creator` agent, `AgentContext.system_message_suffix`, file-based workspace skills, disabled public skills, `LocalWorkspace`, SDK callbacks, and terminal `conversation_state`. |
| Runner packaging | Mostly done | `app/sidecar/openhands/build.sh`, `app/sidecar/openhands/requirements.txt`, `app/sidecar/build.js`, and `app/src-tauri/src/agents/sidecar.rs` stage and resolve `sidecar/dist/openhands/openhands-runner`. |
| Workspace startup/deploy | Done for root OpenHands workspace | App startup creates/refeshes the workspace and deploys `agent-sources/workspace/**`; task prompts live under `agent-sources/prompts/**` and are read by code, not copied into runtime `.agents`. |
| Workflow routing | Not done | `app/src-tauri/src/commands/workflow/step_config.rs` still routes to `research-agent`, `skill-writer-agent`, and `answer-evaluator`. |
| Create-skill Validate | Done | VU-1146 routes Validate through the shared OpenHands one-shot runner and parses the terminal `conversation_state` result. |
| Event-shape hardening | Done | VU-1147 hardens real SDK event rendering, nested tool/message extraction, parallel `ActionEvent` grouping, and raw payload preservation before workflow research migration. |
| Workflow research | Planned | VU-1148 migrates step 0 Research to the OpenHands one-shot runtime, keeps OpenHands events visible while running, and moves terminal JSON extraction/materialization into Rust. |
| Model settings UI | Mostly done | `app/src/lib/model-catalog.ts` and `app/src/components/settings/sdk-section.tsx` use `models.dev`, provider/model dropdowns, reasoning/tool-calling filters, model details, and hidden backend-owned `usageId`. Verify request-option controls during the final settings pass, but do not block workflow migration on this unless tests reveal a runtime LLM projection gap. |
| Eval coverage | Partial | Promptfoo/OpenCode packages and static OpenHands assertions exist. Workflow migration slices should update the existing targeted packages and assertions first; add new eval packages only when no existing package maps to the changed contract. |
| Repo docs/map | Partial | Runtime/model designs have been updated. `repo-map.json` still describes mixed Claude/OpenHands runtime and old plugin-hosted agent prompts. |

## Pre-Workflow Migration Gate

Before starting workflow research migration, merge these child branches back
into the VU-1145 accumulation branch:

- [x] VU-1146 Scope Review Validate. This proves the shared one-shot
  OpenHands runner, workspace, LLM, agent, and result boundary.
- [x] VU-1147 Event Shape Hardening. This must land before workflow research
  so the UI can display real OpenHands messages, reasoning, tool calls,
  observations, errors, internal events, and parallel action batches.

No other remaining 1145 slice is required ahead of workflow migration unless a
local re-check shows the workflow path cannot use the VU-1146 runner boundary.
Model-settings polish, broad eval updates, Claude compatibility removal, and
repo-map cleanup are follow-on or final-readiness tasks.

## Execution Rules

- [ ] Every child slice starts from the current VU-1145 worktree:

```bash
cd /Users/hbanerjee/src/worktrees/feature/vu-1145-implement-openhands-native-clean-break-agent-runtime
./scripts/worktree.sh feature/<child-branch-name>
```

- [ ] Implement and test inside the child worktree.
- [ ] Merge the child branch back into `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime` only after deterministic tests pass.
- [ ] Do not mark a task complete unless its tests have run or the skipped prerequisite is written down.
- [ ] Do not substitute manual UI testing for the OpenHands workflow smoke/eval.
- [ ] Keep marketplace/import compatibility out of workflow-runtime slices unless the slice explicitly calls it out.

## Slice 1: VU-1146 Scope Review Validate

Use this slice before continuing the broader workflow migration.

**Plan:** `docs/plans/2026-05-02-scope-review-openhands-validate.md`

**Branch:**

```bash
./scripts/worktree.sh feature/vu-1146-use-openhands-runner-for-create-skill-scope-validation
```

**Files:**

- Create: `agent-sources/prompts/scope-review.txt`
- Create: `agent-sources/prompts/skill-creator-user-suffix.txt`
- Modify: `app/src-tauri/src/commands/skill/scope_review.rs`
- Modify: `app/src-tauri/src/agents/sidecar.rs`
- Modify: `app/sidecar/config.ts`
- Modify: `app/sidecar/runtime/types.ts`
- Modify: `app/sidecar/runtime/openhands-runtime.ts`
- Modify: `app/sidecar/openhands/runner.py`
- Modify: `app/sidecar/openhands-event-processor.ts`

**Required behavior:**

- [x] Preserve existing Validate semantics: user-clicked, advisory, no hard gate, no create-dialog UI rewrite.
- [x] Route `review_skill_scope` through the OpenHands one-shot runner.
- [x] Reuse the existing app startup workspace creation/refresh path; do not create a temporary validation workspace.
- [x] Add `taskKind: "scope_review"` and `userMessageSuffix` to the runner request contract.
- [x] Load `.agents/agents/skill-creator.md` as `system_message_suffix`.
- [x] Load file-based skills with OpenHands `load_skills_from_dir(".agents/skills")`.
- [x] Set `load_public_skills=False`.

**Verification:**

```bash
markdownlint docs/plans/2026-05-02-scope-review-openhands-validate.md docs/design/openhands-sdk-runner/README.md
cd app/sidecar && npx vitest run __tests__/config.test.ts __tests__/runtime-types.test.ts __tests__/openhands-runtime.test.ts __tests__/openhands-runner.test.ts __tests__/openhands-event-processor.test.ts
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill::scope_review
cd app && npx vitest run src/__tests__/hooks/use-scope-advisor.test.ts src/__tests__/components/new-skill-dialog.test.tsx src/__tests__/components/scope-advisor.test.tsx
```

**Merge-back gate:**

- [x] VU-1146 branch is merged into VU-1145.
- [x] `scope_review.rs` no longer contains direct Anthropic HTTP calls.
- [x] The VU-1145 umbrella plan reflects the merged code before starting VU-1147.

## Slice 2: VU-1147 Event Shape Hardening

This slice is required before workflow research migration. It hardens the
visible OpenHands event stream that workflow users depend on while a research
step is running.

**Plan:** `docs/plans/2026-05-02-openhands-event-shape-hardening.md`

**Branch:**

```bash
./scripts/worktree.sh feature/vu-1147-openhands-event-shape-hardening
```

**Required behavior:**

- [x] Preserve SDK callback records as `conversation_event` payloads.
- [x] Render nested `MessageEvent`, `ActionEvent`, `ObservationEvent`,
  `AgentErrorEvent`, `ConversationErrorEvent`, common internal events, and
  unknown events.
- [x] Extract nested `tool_call.function.name`,
  `tool_call.function.arguments`, `tool_call_id`, `llm_response_id`,
  `reasoning_content`, and `thinking_blocks`.
- [x] Preserve non-object SDK payload fallbacks as raw payloads.
- [x] Group consecutive parallel `ActionEvent`s with the same
  `llm_response_id` only for display.

**Verification:**

```bash
cd app && npm run test:unit
cd app/sidecar && npx vitest run
cd app && npx tsc --noEmit
cd app && npm run test:agents:structural
cd app && npm run test:integration
markdownlint docs/design/openhands-sdk-runner/README.md docs/plans/2026-05-02-openhands-event-shape-hardening.md
```

**Merge-back gate:**

- [x] VU-1147 branch is merged into VU-1145.
- [x] Workflow research migration starts only after this gate is complete.

## Slice 3: VU-1148 Workflow Research One-Shot

This slice migrates workflow step 0 Research first. Later workflow steps remain
on their current path until their own migration slices.

**Plan:** `docs/plans/2026-05-02-openhands-workflow-research.md`

**Branch:**

```bash
./scripts/worktree.sh feature/vu-1148-openhands-workflow-research
```

**Required behavior:**

- [ ] Step 0 routes to `agentName: "skill-creator"` and
  `taskKind: "workflow.research"`.
- [ ] Step 0 uses an app-owned prompt template at
  `agent-sources/prompts/research.txt`.
- [ ] The research skill describes a single-agent inline flow and does not
  refer to subagents, delegated dimension agents, or sub-agent outputs.
- [ ] OpenHands `conversation_event` records remain visible in the UI while
  the research run is active.
- [ ] Rust extracts the final JSON from terminal
  `conversation_state.result_text`, validates it, and materializes
  `context/clarifications.json`.
- [ ] Frontend step 0 no longer calls `materializeWorkflowStepOutput(...)`.

**Verification:**

```bash
cd app && npm run test:agents:structural
cd app && npx vitest run src/__tests__/pages/workflow.test.tsx src/__tests__/hooks/use-agent-stream.test.ts src/__tests__/components/agent-output-panel.test.tsx
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

**Merge-back gate:**

- [ ] VU-1148 branch is merged into VU-1145.
- [ ] Workflow step 0 can complete a live OpenHands smoke without hanging.

## Slice 4: Harden Remaining OpenHands Runner Contract

This slice covers residual runner hardening that is not already done by
VU-1146 or VU-1147. Re-check the code before implementing; many original
runner-contract tasks were completed by VU-1146.

**Files:**

- Modify: `app/sidecar/runtime/types.ts`
- Modify: `app/sidecar/config.ts`
- Modify: `app/sidecar/runtime/openhands-runtime.ts`
- Modify: `app/sidecar/openhands/runner.py`
- Modify: `app/sidecar/openhands-event-processor.ts`
- Test: `app/sidecar/__tests__/runtime-types.test.ts`
- Test: `app/sidecar/__tests__/config.test.ts`
- Test: `app/sidecar/__tests__/openhands-runtime.test.ts`
- Test: `app/sidecar/__tests__/openhands-runner.test.ts`
- Test: `app/sidecar/__tests__/openhands-event-processor.test.ts`

**Required behavior:**

- [ ] Remove the "dev-only spike" runner warning once production packaging is the supported path.
- [ ] Reject OpenHands requests whose `agentName` is not `skill-creator`.
- [ ] Use only `.agents/agents/skill-creator.md` for base agent identity.
- [ ] Strip YAML frontmatter before assigning `AgentContext.system_message_suffix`.
- [ ] Pass `request.get("userMessageSuffix") or ""` as `AgentContext.user_message_suffix`.
- [ ] Remove `load_project_skills`; only deployed workspace skills are visible.
- [ ] Load skills with `load_skills_from_dir(str(Path(workspace_skill_dir) / ".agents" / "skills"))`.
- [ ] Pass `list(agent_skills.values())` to `AgentContext.skills`.
- [ ] Set `load_public_skills=False`.
- [ ] Keep tools on `Agent(tools=...)`, not `AgentContext`.
- [ ] Emit progress/tool/file/status JSONL events before terminal result whenever OpenHands exposes them.
- [ ] Keep structured-output missing/extraction error behavior outside Python. The runner emits terminal text; app code extracts JSON from `conversation_state.result_text` and Rust validates the typed contract.

**Verification:**

```bash
cd app/sidecar && npx vitest run __tests__/runtime-types.test.ts __tests__/config.test.ts __tests__/openhands-runtime.test.ts __tests__/openhands-runner.test.ts __tests__/openhands-event-processor.test.ts
cd app/sidecar && python3 -m py_compile openhands/runner.py
```

## Slice 5: Move Remaining Agent Sources To Final OpenHands Layout

This slice changes prompt/source ownership without changing workflow semantics.

**Files:**

- Create: `agent-sources/workspace/agents/skill-creator.md`
- Create or update: `agent-sources/prompts/research.txt`
- Create or update: `agent-sources/prompts/research-refinement.txt`
- Create or update: `agent-sources/prompts/answer-evaluation.txt`
- Create or update: `agent-sources/prompts/decision-confirmation.txt`
- Create or update: `agent-sources/prompts/skill-generation.txt`
- Modify: `agent-sources/workspace/skills/research/SKILL.md`
- Modify: `agent-sources/workspace/skills/skill-creator/SKILL.md`
- Modify: `app/src-tauri/src/commands/workflow/deploy.rs`
- Modify: `app/plugin-paths.json`
- Test: `app/agent-tests` structural suite

**Required behavior:**

- [ ] Copy only `agent-sources/workspace/**` into runtime `.agents/**`.
- [ ] Do not copy `agent-sources/prompts/**` into the runtime workspace.
- [ ] Keep exactly one top-level OpenHands agent file in runtime workflow workspaces: `.agents/agents/skill-creator.md`.
- [ ] Make `skill-creator.md` define identity and always-on rules only.
- [ ] Keep task-specific instructions in app-owned prompt templates under `agent-sources/prompts/**`.
- [ ] Remove workflow dependency on old plugin agent files: `research-agent.md`, `answer-evaluator.md`, and `skill-writer-agent.md`.
- [ ] Remove Claude Code sub-agent fan-out instructions from workflow file-based skills.

**Verification:**

```bash
cd app && npm run test:agents:structural
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

## Slice 6: Route Remaining Workflow Steps Through `skill-creator`

This slice changes workflow runtime behavior for steps not covered by VU-1148.

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/step_config.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/workflow/prompt.rs`
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
- Modify: `app/src-tauri/src/generated/schemas.rs` only if schema names need regeneration
- Test: Rust workflow tests

**Required behavior:**

- [ ] Step 0 is out of this slice; VU-1148 owns
  `agentName: "skill-creator"`, `taskKind: "workflow.research"`,
  `promptTemplate: "research.txt"`, and `context/clarifications.json`.
- [ ] Step 1 routes to `agentName: "skill-creator"`, `taskKind: "research_refinement"`, `promptTemplate: "research-refinement.txt"`, output `context/clarifications.json`.
- [ ] Answer evaluation routes to `agentName: "skill-creator"`, `taskKind: "answer_evaluation"`, `promptTemplate: "answer-evaluation.txt"`, output `context/answer-evaluation.json`.
- [ ] Step 2 routes to `agentName: "skill-creator"`, `taskKind: "decision_confirmation"`, `promptTemplate: "decision-confirmation.txt"`, output `context/decisions.json`.
- [ ] Step 3 routes to `agentName: "skill-creator"`, `taskKind: "skill_generation"`, `promptTemplate: "skill-generation.txt"`, output `skill/SKILL.md`.
- [ ] Workflow prompts are rendered by Rust and sent as explicit user messages.
- [ ] Workflow one-shot configs do not include `AskUserQuestion`.
- [ ] `permission_mode`, `required_plugins`, and Claude router directives are removed from OpenHands workflow one-shot configs.
- [ ] `allowed_tools` remains request-scoped and uses OpenHands tool names.

**Verification:**

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
cd app && npm run test:unit
```

## Slice 7: Verify And Patch Model Settings Gaps

Do not redo the model-settings implementation. It is mostly present; this slice closes the remaining gaps against the design.

**Files:**

- Modify: `app/src/components/settings/sdk-section.tsx`
- Modify: `app/src/hooks/use-settings-form.ts`
- Modify: `app/src/lib/model-catalog.ts`
- Modify: `app/src/lib/types.ts`
- Test: `app/src/__tests__/lib/model-catalog.test.ts`
- Test: `app/src/__tests__/pages/settings.test.tsx`
- Test: `app/src/__tests__/hooks/use-settings-form.test.ts`

**Required behavior:**

- [ ] Provider dropdown is backed by `models.dev`.
- [ ] Model dropdown is backed by provider-scoped `models.dev` entries.
- [ ] Required Reasoning and Tool calling indicators are checked, disabled, and shown before model selection.
- [ ] Model options are filtered to reasoning plus tool-calling plus text-output models.
- [ ] The saved runtime model string is provider-prefixed, for example `anthropic/claude-sonnet-4-5`.
- [ ] `base_url` defaults from provider `api`, app-owned local defaults such as Ollama, or blank.
- [ ] `usageId` is not user-visible and backend projection sets it to `workflow`.
- [ ] Request Options includes visible controls for Reasoning effort, Temperature, Max output tokens, Timeout, and Retries.
- [ ] Advanced Provider Overrides contains Provider API version, extra headers, and optional cost overrides if those are supported by persisted settings.

**Verification:**

```bash
cd app && npx vitest run src/__tests__/lib/model-catalog.test.ts src/__tests__/pages/settings.test.tsx src/__tests__/hooks/use-settings-form.test.ts
cd app && npm run test:unit
cargo test --manifest-path app/src-tauri/Cargo.toml db::settings types::settings
```

## Slice 8: Remove Workflow Claude Runtime Compatibility

Run this only after workflow steps, scope review, and answer evaluation all use the OpenHands runner.

**Files:**

- Modify: `app/sidecar/options.ts`
- Modify: `app/sidecar/runtime/claude-runtime.ts`
- Modify: `app/sidecar/run-agent.ts`
- Modify: `app/sidecar/persistent-mode.ts`
- Modify: `app/src-tauri/src/agents/sidecar.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/description/eval.rs` if it still requires Claude SDK path resolution
- Modify: `app/src/components/about-dialog.tsx`
- Modify: `app/sidecar/package.json`
- Modify: `app/sidecar/package-lock.json`
- Modify: `repo-map.json`

**Required behavior:**

- [ ] Workflow paths no longer import or construct Claude runtime options.
- [ ] `pathToClaudeCodeExecutable` is absent from workflow configs.
- [ ] `resolve_sdk_cli_path_public` remains only if non-workflow features still require it; otherwise remove it.
- [ ] About/credits text no longer says workflow execution is powered by Claude Agent SDK.
- [ ] Sidecar package dependencies remove `@anthropic-ai/claude-agent-sdk` only if no remaining non-workflow path imports it.
- [ ] Refine streaming either remains on its existing supported path or returns the explicit OpenHands unsupported gap. Do not silently degrade refine behavior.

**Verification:**

```bash
cd app/sidecar && npx vitest run
cd app && npm run test:agents:structural
cd app && npm run test:unit
cargo test --manifest-path app/src-tauri/Cargo.toml
```

## Slice 9: Refresh Existing OpenHands Smoke And Eval Coverage

This slice is required before final VU-1145 PR readiness.

**Files:**

- Modify: existing targeted `tests/evals/packages/*`
- Modify: `tests/evals/scripts/*` only if the current harness cannot exercise
  the migrated contract
- Modify: `tests/evals/docs/scenario-inventory.md`
- Modify: `tests/evals/assertions/workflow-openhands-static.test.js`
- Modify: `tests/evals/package.json`
- Modify: `TEST_MAP.md`

**Required behavior:**

- [ ] Review the existing eval inventory and targeted packages before adding
  any new package.
- [ ] Update existing automated coverage for OpenHands workflow step 0 and
  step 3 without manual UI interaction.
- [ ] Assert terminal `conversation_state`.
- [ ] Assert parseable expected artifact output.
- [ ] Assert no `AskUserQuestion` appears in one-shot workflow requests.
- [ ] Assert `.agents/agents/skill-creator.md` and `.agents/skills/**` artifact discovery.
- [ ] Assert at least one app-visible progress/tool event occurs before terminal result.
- [ ] Update existing eval packages that still mention `research-agent` or
  `skill-writer-agent`.
- [ ] Keep active static assertions pointed at `agent-sources/prompts/**` for
  app-owned prompt templates; do not assert against
  `agent-sources/workspace/prompts/**`.
- [ ] If live provider credentials are required, skip with a precise prerequisite message rather than failing opaquely.

**Verification:**

```bash
cd tests/evals && npm test
cd tests/evals && npm run eval:smoke
```

## Slice 10: Final Docs, Repo Map, And Release Readiness

Run this after all implementation slices have merged back into VU-1145.

**Files:**

- Modify: `docs/design/openhands-native-migration/README.md`
- Modify: `docs/design/openhands-sdk-runner/README.md`
- Modify: `docs/design/agent-runtime-boundary/README.md`
- Modify: `README.md`
- Modify: `TEST_MAP.md`
- Modify: `repo-map.json`

**Required behavior:**

- [ ] Design docs match the implemented runner, source layout, workflow routing, settings, and packaging choices.
- [ ] `TEST_MAP.md` maps all OpenHands runner, prompt, workspace layout, and eval validation surfaces.
- [ ] `repo-map.json` no longer describes stale Claude workflow routing or plugin-hosted workflow agents.
- [ ] The repo-map audit in `AGENTS.md` passes.
- [ ] The final PR body states whether live OpenHands smoke/eval ran, skipped, or blocked, with exact command/prerequisite.

**Verification:**

```bash
markdownlint docs/design/openhands-native-migration/README.md docs/design/openhands-sdk-runner/README.md docs/design/agent-runtime-boundary/README.md TEST_MAP.md README.md
cd app && npm run test:agents:structural
cd app && npm run test:unit
cd app/sidecar && npx vitest run
cargo test --manifest-path app/src-tauri/Cargo.toml
cd tests/evals && npm test
node scripts/verify-release-stage.mjs
```

## Acceptance Checklist

- [ ] VU-1145 acceptance criteria are checked against the final diff.
- [x] VU-1146 has merged back into VU-1145.
- [x] VU-1147 has merged back into VU-1145.
- [ ] `docs/design/openhands-native-migration/README.md` matches the implemented runtime decisions.
- [ ] `docs/design/openhands-sdk-runner/README.md` matches the Python runner call shape.
- [ ] `repo-map.json` reflects added, removed, and renamed sidecar/runtime/agent files.
- [ ] `TEST_MAP.md` maps the new validation surface.
- [ ] No workflow one-shot config includes `AskUserQuestion`.
- [ ] No workflow one-shot config names `research-agent`, `answer-evaluator`, or `skill-writer-agent`.
- [ ] No workflow prompt requires Claude Code `Agent` or `Skill` tools.
- [ ] OpenHands one-shot paths stream visible progress/tool activity through existing UI envelopes before terminal results.
- [ ] `.agents/agents/skill-creator.md` and `.agents/skills/**` are the generated workflow runtime layout.
- [ ] `agent-sources/prompts/**` templates are app-owned and not copied into the runtime workspace.
- [ ] Create-skill Validate uses the OpenHands runner and no direct Anthropic HTTP call.
- [ ] The app shows a clear unsupported error for OpenHands refine streaming until the separate `AskUserQuestion` issue is implemented.
- [ ] The PR body calls out whether the live OpenHands smoke was run, skipped, or blocked.
