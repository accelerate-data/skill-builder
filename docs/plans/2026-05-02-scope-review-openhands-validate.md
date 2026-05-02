# OpenHands Scope Review Validate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the create-skill `Validate` button work in OpenHands clean-break mode by moving scope review from the direct Anthropic API path onto the shared OpenHands SDK runner.

**Architecture:** Implementation happens on a new branch and worktree created from `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`. After deterministic tests pass, merge the feature branch back into the VU-1145 accumulation branch. This is a clean-break OpenHands implementation for Validate: no Claude SDK, Anthropic API, legacy `anthropic_api_key`, or `preferred_model` fallback remains in the scope-review path. Scope review keeps current UI semantics: the user explicitly clicks `Validate`, the button shows loading, existing advisory statuses and suggestion chips remain unchanged, and `Next`/`Create` behavior is not made stricter. Frontend-to-Rust behavior should stay stable unless a real UI need appears, but Rust-to-sidecar and sidecar-to-runner contracts can change freely because they are internal to the OpenHands clean break. Rust renders a compiled `agent-sources/prompts/scope-review.txt` prompt, sends it through the OpenHands one-shot runner, and parses the returned `ScopeReviewResult`.

**Tech Stack:** Tauri/Rust commands, Node sidecar runtime adapter, Python OpenHands SDK runner, React scope advisor UI, Vitest, cargo tests, agent structural tests.

---

## Delta: OpenHands Conversation Protocol

Validate must use the OpenHands-native protocol defined in
`docs/design/openhands-sdk-runner/README.md`.

The implementation is a clean break from transitional Claude-compatible event
shapes. The OpenHands path must not emit or consume:

- `openhands_event`
- `openhands_result`
- `display_item`
- `run_result`
- `request_complete` as the semantic terminal signal
- `sdk_stderr` as a UI or transcript event

The runtime protocol is:

- `conversation_event`: app-framed serialized OpenHands SDK conversation event.
- `conversation_state`: app-framed conversation lifecycle state. Terminal states
  are `completed`, `error`, and `cancelled`. For one-shot calls, the terminal
  state is also the product result boundary.

stdout and stderr are diagnostic process logs only. Python tracebacks,
OpenHands SDK logs, LiteLLM logs, and PyInstaller diagnostics stay in process
diagnostics after redaction; they are not converted into frontend activity.

The frontend must replace the OpenHands use of `DisplayItemList` with a
conversation-event renderer. OpenHands activity is rendered directly from SDK
events. Validate result parsing reads final output from terminal
`conversation_state`, not from `run_result.resultText` or transcript replay.

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
  supplies workspace, LLM, sidecar path, diagnostic transcript plumbing,
  terminal wait handling, and terminal `conversation_state` capture. Feature
  code keeps only task-specific result parsing from
  `conversation_state.structured_output` or JSON `conversation_state.result_text`.

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

- [x] Create the implementation branch from the VU-1145 accumulation branch:

```bash
cd /Users/hbanerjee/src/worktrees/feature/vu-1145-implement-openhands-native-clean-break-agent-runtime
./scripts/worktree.sh feature/vu-1146-use-openhands-runner-for-create-skill-scope-validation
```

- [x] Implement and test in the new worktree.
- [x] Merge the completed branch back into `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime` after tests pass.

Post-merge status: VU-1146 is complete and merged into the VU-1145
accumulation branch. The remaining OpenHands work should build on the shared
one-shot runner, terminal `conversation_state` result boundary, initialized
workspace boundary, and backend-owned LLM projection established by this plan.

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
- Modify or remove: `app/sidecar/openhands-event-processor.ts`
- Modify: `app/src/hooks/use-agent-stream.ts`
- Modify: `app/src/stores/agent-store.ts`
- Create: `app/src/components/agent-items/conversation-event-list.tsx`
- Create: `app/src/lib/openhands-conversation-events.ts`
- Test: `app/src-tauri/src/commands/skill/scope_review.rs`
- Test: `app/sidecar/__tests__/openhands-runtime.test.ts`
- Test: `app/sidecar/__tests__/openhands-runner.test.ts`
- Test: `app/sidecar/__tests__/openhands-event-processor.test.ts`
- Test: `app/src/__tests__/hooks/use-agent-stream.test.ts`
- Test: `app/src/__tests__/components/agent-output-panel.test.tsx`
- Test: `app/src/__tests__/hooks/use-scope-advisor.test.ts`
- Test: `app/src/__tests__/components/new-skill-dialog.test.tsx`

## Task 1: Externalize Scope Review Prompt

- [x] Move the current embedded scope-review prompt from `scope_review.rs` into `agent-sources/prompts/scope-review.txt`.
- [x] Replace the direct Rust `format!(...)` prompt body with an `include_str!` template and a small renderer that fills:
  - `skill_name`
  - `description`
  - `purpose`
  - `context_questions`
  - `industry`
  - reference document snippets
- [x] Create `agent-sources/prompts/skill-creator-user-suffix.txt` with the no-op invariant:

```text
Follow the current user message exactly. Do not infer a different task than the one stated in the message.
```

- [x] Keep `agent-sources/workspace/**` limited to OpenHands runtime files:
  `agents/**` and `skills/**`. Keep app-owned task prompts in
  `agent-sources/prompts/**` and legacy Claude templates in
  `agent-sources/claude/**`.

- [x] Add Rust tests that render a scope-review prompt and assert it contains the submitted values and the required JSON response shape.
- [x] Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill::scope_review`

## Task 2: Define The Clean-Break Runner Request

- [x] Define the OpenHands one-shot runner request around the fields the SDK
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
- [x] Keep frontend-to-Rust command semantics stable, but change Rust
  `SidecarConfig`, Node `SidecarConfig`, and runtime request types as needed to
  avoid carrying Claude-only fields through OpenHands requests.
- [x] Add a backend-owned OpenHands one-shot request builder/API that accepts
  app-agent fields (`agentName`, task kind, prompt, tools, output format,
  persistence context) plus the resolved runtime context. Validate must use this
  API instead of hand-assembling Claude-era sidecar fields.
- [x] Add a backend-owned one-shot execution helper that dispatches through the
  sidecar pool, owns diagnostics allocation, and waits for terminal
  `conversation_state`.
  Validate must use this helper instead of embedding one-shot listener plumbing
  in the feature command.
- [x] Validate `userMessageSuffix` as an optional string in `app/sidecar/config.ts`.
- [x] Keep `agentName` fixed to `skill-creator` for OpenHands scope-review requests.
- [x] Add sidecar config/runtime tests proving `userMessageSuffix`, `taskKind: "scope_review"`, `llm`, and `agentName: "skill-creator"` are serialized to the runner.
- [x] Run:

```bash
cd app/sidecar && npx vitest run __tests__/config.test.ts __tests__/runtime-types.test.ts __tests__/openhands-runtime.test.ts
```

## Task 3: Update Python OpenHands Runner Contract

- [x] In `runner.py`, read `.agents/agents/skill-creator.md`, strip YAML frontmatter, and pass the markdown body as `AgentContext.system_message_suffix`.
- [x] Treat a missing `skill-creator.md` as an error; do not run with an empty
  agent identity.
- [x] In `runner.py`, call OpenHands `load_skills_from_dir(str(Path(workspace_skill_dir) / ".agents" / "skills"))`.
- [x] Pass `list(agent_skills.values())` to `AgentContext.skills`.
- [x] Set `load_public_skills=False`.
- [x] Pass `request.get("userMessageSuffix") or ""` to `AgentContext.user_message_suffix`.
- [x] Keep tools on `Agent(tools=...)`, not `AgentContext`.
- [x] Construct an explicit SDK local workspace:

```python
workspace = LocalWorkspace(working_dir=workspace_skill_dir)
```

- [x] Pass the `LocalWorkspace` object to `Conversation`, disable the default
  visualizer so stdout remains JSONL-only, and set `delete_on_close=False` so
  the app-managed workspace is not removed.
- [x] Register a `Conversation(callbacks=[...])` SDK event callback that emits
  redacted `conversation_event` JSONL lines for all SDK events before terminal
  conversation state.
- [x] Emit `conversation_state(status="starting")` before SDK setup and
  `conversation_state(status="running")` once the conversation starts running.
- [x] Emit exactly one terminal `conversation_state(status="completed" |
  "error" | "cancelled")`.
- [x] Do not emit `openhands_event`, `openhands_result`, `display_item`, or
  `run_result` from the Python runner.
- [x] Run one-shot scope review as a single-message `Conversation`:

```python
conversation = Conversation(
    agent=agent,
    workspace=workspace,
    callbacks=[emit_sdk_event],
    max_iteration_per_run=parse_max_iterations(request),
    visualizer=None,
    delete_on_close=False,
)
conversation.send_message(request["prompt"])
result = conversation.run()
```

- [x] Add runner tests for frontmatter stripping, skill loading, disabled public
  skills, user suffix passing, `LocalWorkspace` construction,
  `Conversation(callbacks=...)`, `delete_on_close=False`, and
  `Conversation.send_message`.
- [x] Run:

```bash
cd app/sidecar && npx vitest run __tests__/openhands-runner.test.ts
cd app/sidecar && python3 -m py_compile openhands/runner.py
```

## Task 4: Route `review_skill_scope` Through OpenHands

- [x] Remove the direct `reqwest` call to `https://api.anthropic.com/v1/messages`.
- [x] Read runtime workspace and LLM through a backend API such as
  `read_initialized_runtime_context`.
- [x] Validate that startup deployed root `.agents/agents/skill-creator.md` and
  `.agents/skills/**`; if not, return an app-visible initialization error.
- [x] Do not read `settings.anthropic_api_key`, `settings.preferred_model`, or any legacy Claude/Anthropic fallback for this command.
- [x] Use the initialized workspace root as both `workspaceRootDir` and
  `workspaceSkillDir` for Validate. Do not create the candidate skill workspace
  during validation.
- [x] Build a one-shot OpenHands invocation through the shared request
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
- [x] Await the terminal `conversation_state` through the shared one-shot
  execution helper. Do not scrape JSONL transcript logs for product results.
- [x] Parse the existing `ScopeReviewResult` shape from
  `conversation_state.structured_output`, falling back to JSON parsed from
  `conversation_state.result_text`.
- [x] Reject malformed structured results instead of defaulting to `focused`.
- [x] Preserve existing error behavior exposed to `useScopeAdvisor`: failures reset advisor state and keep the create dialog behavior unchanged.
- [x] Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill::scope_review
```

## Task 4A: Clean-Break One-Shot Result Boundary

- [x] Change `OpenHandsOneShotRun` so the stable return value includes the
  terminal `conversation_state` payload, not only the transcript directory.
- [x] Capture the terminal state from the target request's `agent-message`
  event before using `agent-exit` or `agent-shutdown` only as lifecycle
  completion.
- [x] Keep transcript logs diagnostic-only. They may still be allocated and
  written, but Rust product features must not rely on replaying them.
- [x] Add shared helpers for one-shot output extraction:
  - completed + object `structured_output` -> return the object;
  - completed + JSON `result_text` -> parse and return object;
  - completed without object output -> clear error;
  - error/cancelled -> surface `error_detail`.
- [x] Add tests proving a completed OpenHands `conversation_state` with
  `result_text` is returned through `run_openhands_one_shot` and parsed by
  scope review without transcript scraping.

## Task 5: Preserve Create Dialog Semantics

- [x] Keep `useScopeAdvisor.triggerCheck()` as the only path that calls `reviewSkillScope`.
- [x] Do not require validation before `Next`.
- [x] Do not change the advisory statuses or suggestion chip behavior.
- [x] Do not add a progress transcript to the create dialog.
- [x] Keep failure display behavior consistent with the current hook.
- [x] Run:

```bash
cd app && npx vitest run src/__tests__/hooks/use-scope-advisor.test.ts src/__tests__/components/new-skill-dialog.test.tsx src/__tests__/components/scope-advisor.test.tsx
```

## Task 6: OpenHands Conversation Events In The App

- [x] Add OpenHands conversation event and state TypeScript types for the app
  boundary.
- [x] Route `conversation_event` through Rust and frontend IPC without mapping it
  to `display_item`.
- [x] Treat terminal `conversation_state` as the Rust sidecar-pool completion
  signal for OpenHands requests.
- [x] Update frontend agent state to keep OpenHands conversation events for
  OpenHands runs.
- [x] Replace the OpenHands use of `DisplayItemList` with
  `ConversationEventList`.
- [x] Add event renderers for `MessageEvent`, `ActionEvent`,
  `ObservationEvent`, `AgentErrorEvent`, `ConversationErrorEvent`, and unknown
  SDK events.
- [x] Ensure action events expose tool calls, reasoning/thought content, tool
  call ids, summaries, and security risk when present.
- [x] Ensure observation and agent error events render tool result/error
  visibility rather than disappearing into raw logs only.
- [x] Run:

```bash
cd app/sidecar && npx vitest run __tests__/openhands-runtime.test.ts __tests__/openhands-runner.test.ts
cd app && npx vitest run src/__tests__/hooks/use-agent-stream.test.ts src/__tests__/components/agent-output-panel.test.tsx
cd app && npm run test:agents:structural
```

## Task 7: OpenHands SDK Integration Smoke

- [x] Add a deterministic integration test or script that invokes the local
  OpenHands runner against the installed OpenHands SDK with a minimal
  workspace, `skill-creator` agent, and local `.agents/skills` directory.
- [x] The integration must assert:
  - at least one `conversation_state(status="starting")`;
  - at least one `conversation_state(status="running")`;
  - at least one `conversation_event` from the SDK callback;
  - exactly one terminal `conversation_state`;
  - stdout contains JSONL protocol only;
  - stderr diagnostics are not re-emitted as conversation events.
- [x] Add a live end-to-end smoke that uses the app's configured OpenHands LLM
  settings when credentials are available. If credentials are missing, skip
  with a precise prerequisite message.
- [x] Run:

```bash
cd app/sidecar && npx vitest run __tests__/openhands-runner.integration.test.ts
```

The live smoke is gated by `SKILL_BUILDER_OPENHANDS_MODEL` and
`SKILL_BUILDER_OPENHANDS_API_KEY`, with optional
`SKILL_BUILDER_OPENHANDS_BASE_URL` and
`SKILL_BUILDER_OPENHANDS_API_VERSION`. Without those environment variables, the
test is skipped in the normal sidecar suite.

## Final Verification

- [x] Run:

```bash
markdownlint docs/design/openhands-sdk-runner/README.md docs/design/openhands-native-migration/README.md docs/plans/2026-05-02-scope-review-openhands-validate.md
cd app && npm run test:unit
cd app/sidecar && npx vitest run
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill::scope_review
```

- [x] Record any skipped live OpenHands smoke prerequisite in the PR body.
- [x] Merge the branch back into the VU-1145 worktree after tests pass.
