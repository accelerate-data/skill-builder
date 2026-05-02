# OpenHands Scope Review Validate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the create-skill `Validate` button work in OpenHands clean-break mode by moving scope review from the direct Anthropic API path onto the shared OpenHands SDK runner.

**Architecture:** Implementation happens on a new branch and worktree created from `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`. After deterministic tests pass, merge the feature branch back into the VU-1145 accumulation branch. This is a clean-break OpenHands implementation for Validate: no Claude SDK, Anthropic API, legacy `anthropic_api_key`, or `preferred_model` fallback remains in the scope-review path. Scope review keeps current UI semantics: the user explicitly clicks `Validate`, the button shows loading, existing advisory statuses and suggestion chips remain unchanged, and `Next`/`Create` behavior is not made stricter. Frontend-to-Rust behavior should stay stable unless a real UI need appears, but Rust-to-sidecar and sidecar-to-runner contracts can change freely because they are internal to the OpenHands clean break. Rust renders a compiled `agent-sources/prompts/scope-review.txt` prompt, sends it through the OpenHands one-shot runner, and parses the returned `ScopeReviewResult`.

**Tech Stack:** Tauri/Rust commands, Node sidecar runtime adapter, Python OpenHands SDK runner, React scope advisor UI, Vitest, cargo tests, agent structural tests.

---

## Stable Boundaries For This Spike

This spike establishes reusable boundaries for later OpenHands migration work:

- **Workspace:** app startup initializes the workspace and deploys root
  `.agents` artifacts. Validate must use that initialized workspace root and
  must not pre-create `workspace/{plugin_slug}/{skill_name}`.
- **LLM:** runtime callers use backend-projected `WorkflowLlmConfig` from
  `selected_workflow_llm` / `read_initialized_runtime_context`. Validate must
  not read legacy settings or expose runtime LLM details to the frontend.
- **Agent invocation:** Validate uses the shared OpenHands one-shot request
  builder/API. Feature code supplies the app-agent task fields; runtime code
  supplies workspace, LLM, sidecar path, transcript/event plumbing, and terminal
  wait handling. Feature code keeps only task-specific result parsing.

These boundaries are part of the reusable migration contract for answer
evaluation, workflow steps, description optimization, eval generation, and
refine. Do not copy Validate-specific workspace, LLM, sidecar dispatch, or
terminal wait logic into later feature commands; extend the shared runtime API
when a new execution mode needs more behavior.

## Source Context

- Parent issue: `VU-1145`
- Runner design: `docs/design/openhands-sdk-runner/README.md`
- Umbrella migration design: `docs/design/openhands-native-migration/README.md`
- Current direct Anthropic implementation: `app/src-tauri/src/commands/skill/scope_review.rs`
- Current frontend hook: `app/src/hooks/use-scope-advisor.ts`
- Current create dialog: `app/src/components/skill-dialog.tsx`

The existing `Validate` behavior is advisory and user-triggered. This plan must
not make validation a hard gate and must not add a new transcript panel or other
create-dialog UI behavior. "Make Validate work" means the button uses the
OpenHands runner and canonical model settings instead of direct Anthropic
fields. Do not retain backward compatibility for this command or for internal
Rust-to-sidecar request fields that exist only to support the old Claude
runtime.

## Branch And Worktree

- [ ] Create the implementation branch from the VU-1145 accumulation branch:

```bash
cd /Users/hbanerjee/src/worktrees/feature/vu-1145-implement-openhands-native-clean-break-agent-runtime
./scripts/worktree.sh feature/vu-1145-openhands-scope-review-validate
```

- [ ] Implement and test in the new worktree.
- [ ] Merge the completed branch back into `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime` after tests pass.

## File Structure

- Create or update: `agent-sources/workspace/agents/skill-creator.md`
- Create or update: `agent-sources/workspace/skills/**`
- Create: `agent-sources/prompts/scope-review.txt`
- Create or update: `agent-sources/prompts/skill-creator-user-suffix.txt`
- Create or update: `agent-sources/workspace/agents/skill-creator.md`
- Modify: `app/src-tauri/src/commands/skill/scope_review.rs`
- Modify: `app/src-tauri/src/agents/sidecar.rs`
- Modify: `app/src-tauri/src/commands/workflow/settings.rs`
- Modify: `app/src-tauri/src/commands/workflow/deploy.rs`
- Modify: `app/sidecar/config.ts`
- Modify: `app/sidecar/runtime/types.ts`
- Modify: `app/sidecar/runtime/openhands-runtime.ts`
- Modify: `app/sidecar/openhands/runner.py`
- Modify: `app/sidecar/openhands-event-processor.ts`
- Test: `app/src-tauri/src/commands/skill/scope_review.rs`
- Test: `app/sidecar/__tests__/openhands-runtime.test.ts`
- Test: `app/sidecar/__tests__/openhands-runner.test.ts`
- Test: `app/sidecar/__tests__/openhands-event-processor.test.ts`
- Test: `app/src/__tests__/hooks/use-scope-advisor.test.ts`
- Test: `app/src/__tests__/components/new-skill-dialog.test.tsx`

## Task 1: Externalize Scope Review Prompt

- [ ] Move the current embedded scope-review prompt from `scope_review.rs` into `agent-sources/prompts/scope-review.txt`.
- [ ] Replace the direct Rust `format!(...)` prompt body with an `include_str!` template and a small renderer that fills:
  - `skill_name`
  - `description`
  - `purpose`
  - `context_questions`
  - `industry`
  - reference document snippets
- [ ] Create `agent-sources/prompts/skill-creator-user-suffix.txt` with the no-op invariant:

```text
Follow the current user message exactly. Do not infer a different task than the one stated in the message.
```

- [ ] Keep `agent-sources/workspace/**` limited to OpenHands runtime files:
  `agents/**` and `skills/**`. Keep app-owned task prompts in
  `agent-sources/prompts/**` and legacy Claude templates in
  `agent-sources/claude/**`.

- [ ] Add Rust tests that render a scope-review prompt and assert it contains the submitted values and the required JSON response shape.
- [ ] Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill::scope_review`

## Task 2: Define The Clean-Break Runner Request

- [ ] Define the OpenHands one-shot runner request around the fields the SDK
  path actually needs:
  - `mode`
  - `prompt`
  - `taskKind`
  - `userMessageSuffix`
  - `agentName`
  - `llm`
  - `workspaceRootDir`
  - `workspaceSkillDir`
  - `allowedTools`
  - `maxTurns`
  - `outputFormat`
- [ ] Keep frontend-to-Rust command semantics stable, but change Rust
  `SidecarConfig`, Node `SidecarConfig`, and runtime request types as needed to
  avoid carrying Claude-only fields through OpenHands requests.
- [ ] Add a backend-owned OpenHands one-shot request builder/API that accepts
  app-agent fields (`agentName`, task kind, prompt, tools, output format,
  persistence context) plus the resolved runtime context. Validate must use this
  API instead of hand-assembling Claude-era sidecar fields.
- [ ] Add a backend-owned one-shot execution helper that dispatches through the
  sidecar pool, owns transcript allocation, and waits for terminal `agent-exit`.
  Validate must use this helper instead of embedding one-shot listener plumbing
  in the feature command.
- [ ] Validate `userMessageSuffix` as an optional string in `app/sidecar/config.ts`.
- [ ] Keep `agentName` fixed to `skill-creator` for OpenHands scope-review requests.
- [ ] Add sidecar config/runtime tests proving `userMessageSuffix`, `taskKind: "scope_review"`, `llm`, and `agentName: "skill-creator"` are serialized to the runner.
- [ ] Run:

```bash
cd app/sidecar && npx vitest run __tests__/config.test.ts __tests__/runtime-types.test.ts __tests__/openhands-runtime.test.ts
```

## Task 3: Update Python OpenHands Runner Contract

- [ ] In `runner.py`, read `.agents/agents/skill-creator.md`, strip YAML frontmatter, and pass the markdown body as `AgentContext.system_message_suffix`.
- [ ] Treat a missing `skill-creator.md` as an error; do not run with an empty
  agent identity.
- [ ] In `runner.py`, call OpenHands `load_skills_from_dir(str(Path(workspace_skill_dir) / ".agents" / "skills"))`.
- [ ] Pass `list(agent_skills.values())` to `AgentContext.skills`.
- [ ] Set `load_public_skills=False`.
- [ ] Pass `request.get("userMessageSuffix") or ""` to `AgentContext.user_message_suffix`.
- [ ] Keep tools on `Agent(tools=...)`, not `AgentContext`.
- [ ] Construct an explicit SDK local workspace:

```python
workspace = LocalWorkspace(working_dir=workspace_skill_dir)
```

- [ ] Pass the `LocalWorkspace` object to `Conversation`, disable the default
  visualizer so stdout remains JSONL-only, and set `delete_on_close=False` so
  the app-managed workspace is not removed.
- [ ] Register a `Conversation(callbacks=[...])` SDK event callback that emits
  redacted `openhands_sdk_event` JSONL lines for all SDK events before the
  terminal result.
- [ ] Run one-shot scope review as a single-message `Conversation`:

```python
conversation = Conversation(
    agent=agent,
    workspace=workspace,
    callbacks=[emit_sdk_event],
    visualizer=None,
    delete_on_close=False,
)
conversation.send_message(request["prompt"])
result = conversation.run(max_iterations=parse_max_iterations(request))
```

- [ ] Add runner tests for frontmatter stripping, skill loading, disabled public
  skills, user suffix passing, `LocalWorkspace` construction,
  `Conversation(callbacks=...)`, `delete_on_close=False`, and
  `Conversation.send_message`.
- [ ] Run:

```bash
cd app/sidecar && npx vitest run __tests__/openhands-runner.test.ts
cd app/sidecar && python3 -m py_compile openhands/runner.py
```

## Task 4: Route `review_skill_scope` Through OpenHands

- [ ] Remove the direct `reqwest` call to `https://api.anthropic.com/v1/messages`.
- [ ] Read runtime workspace and LLM through a backend API such as
  `read_initialized_runtime_context`.
- [ ] Validate that startup deployed root `.agents/agents/skill-creator.md` and
  `.agents/skills/**`; if not, return an app-visible initialization error.
- [ ] Do not read `settings.anthropic_api_key`, `settings.preferred_model`, or any legacy Claude/Anthropic fallback for this command.
- [ ] Use the initialized workspace root as both `workspaceRootDir` and
  `workspaceSkillDir` for Validate. Do not create the candidate skill workspace
  during validation.
- [ ] Build a one-shot OpenHands invocation through the shared request
  builder/API with:
  - `runtimeProvider: "openhands"`
  - `mode: "one-shot"`
  - `agentName: "skill-creator"`
  - `taskKind: "scope_review"`
  - rendered `prompt`
  - rendered `userMessageSuffix`
  - `allowedTools` suitable for scope review
  - `maxTurns` small enough for validation
  - `outputFormat` for `ScopeReviewResult`
- [ ] Await the terminal result through the shared one-shot execution helper and
  parse the existing `ScopeReviewResult` shape from the transcript.
- [ ] Reject malformed structured results instead of defaulting to `focused`.
- [ ] Preserve existing error behavior exposed to `useScopeAdvisor`: failures reset advisor state and keep the create dialog behavior unchanged.
- [ ] Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill::scope_review
```

## Task 5: Preserve Create Dialog Semantics

- [ ] Keep `useScopeAdvisor.triggerCheck()` as the only path that calls `reviewSkillScope`.
- [ ] Do not require validation before `Next`.
- [ ] Do not change the advisory statuses or suggestion chip behavior.
- [ ] Do not add a progress transcript to the create dialog.
- [ ] Keep failure display behavior consistent with the current hook.
- [ ] Run:

```bash
cd app && npx vitest run src/__tests__/hooks/use-scope-advisor.test.ts src/__tests__/components/new-skill-dialog.test.tsx src/__tests__/components/scope-advisor.test.tsx
```

## Task 6: SDK Event And Smoke Coverage

- [ ] Add sidecar event-processor coverage showing OpenHands SDK
  `MessageEvent`, `ActionEvent`, `ObservationEvent`, `AgentErrorEvent`, and
  conversation-level error events are preserved as raw transcript events and
  mapped into visible display items before the terminal `run_result`.
- [ ] Ensure action events expose tool calls, reasoning/thought content, tool
  call ids, summaries, and security risk when present.
- [ ] Ensure observation and agent error events attach or emit tool result/error
  visibility rather than disappearing into raw logs only.
- [ ] Add deterministic smoke coverage for the runner request shape without requiring a live model.
- [ ] Add a live smoke/eval only if local OpenHands credentials are available; otherwise skip with a precise prerequisite message.
- [ ] Run:

```bash
cd app/sidecar && npx vitest run __tests__/openhands-event-processor.test.ts __tests__/openhands-runtime.test.ts __tests__/openhands-runner.test.ts
cd app && npm run test:agents:structural
```

## Final Verification

- [ ] Run:

```bash
markdownlint docs/design/openhands-sdk-runner/README.md docs/design/openhands-native-migration/README.md docs/superpowers/plans/2026-05-02-scope-review-openhands-validate.md
cd app && npm run test:unit
cd app/sidecar && npx vitest run
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill::scope_review
```

- [ ] Record any skipped live OpenHands smoke prerequisite in the PR body.
- [ ] Merge the branch back into the VU-1145 worktree after tests pass.
