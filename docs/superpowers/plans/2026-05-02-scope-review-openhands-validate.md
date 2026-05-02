# OpenHands Scope Review Validate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the create-skill `Validate` button work in OpenHands clean-break mode by moving scope review from the direct Anthropic API path onto the shared OpenHands SDK runner.

**Architecture:** Implementation happens on a new branch and worktree created from `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`. After deterministic tests pass, merge the feature branch back into the VU-1145 accumulation branch. Scope review keeps current UI semantics: the user explicitly clicks `Validate`, the button shows loading, existing advisory statuses and suggestion chips remain unchanged, and `Next`/`Create` behavior is not made stricter. Rust renders a compiled `agent-sources/prompts/scope-review.txt` prompt, sends it through the OpenHands one-shot runner, and parses the returned `ScopeReviewResult`.

**Tech Stack:** Tauri/Rust commands, Node sidecar runtime adapter, Python OpenHands SDK runner, React scope advisor UI, Vitest, cargo tests, agent structural tests.

---

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
OpenHands runner and selected model settings instead of direct Anthropic fields.

## Branch And Worktree

- [ ] Create the implementation branch from the VU-1145 accumulation branch:

```bash
cd /Users/hbanerjee/src/worktrees/feature/vu-1145-implement-openhands-native-clean-break-agent-runtime
./scripts/worktree.sh feature/vu-1145-openhands-scope-review-validate
```

- [ ] Implement and test in the new worktree.
- [ ] Merge the completed branch back into `feature/vu-1145-implement-openhands-native-clean-break-agent-runtime` after tests pass.

## File Structure

- Create: `agent-sources/prompts/scope-review.txt`
- Create or update: `agent-sources/prompts/skill-creator-user-suffix.txt`
- Modify: `app/src-tauri/src/commands/skill/scope_review.rs`
- Modify: `app/src-tauri/src/agents/sidecar.rs`
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

- [ ] Add Rust tests that render a scope-review prompt and assert it contains the submitted values and the required JSON response shape.
- [ ] Run: `cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill::scope_review`

## Task 2: Add Runner Request Fields

- [ ] Add `userMessageSuffix?: string` and `taskKind?: string` to the sidecar request types in Rust and TypeScript.
- [ ] Validate `userMessageSuffix` as an optional string in `app/sidecar/config.ts`.
- [ ] Keep `agentName` fixed to `skill-creator` for OpenHands scope-review requests.
- [ ] Add sidecar config/runtime tests proving `userMessageSuffix`, `taskKind: "scope_review"`, `llm`, and `agentName: "skill-creator"` are serialized to the runner.
- [ ] Run:

```bash
cd app/sidecar && npx vitest run __tests__/config.test.ts __tests__/runtime-types.test.ts __tests__/openhands-runtime.test.ts
```

## Task 3: Update Python OpenHands Runner Contract

- [ ] In `runner.py`, read `.agents/agents/skill-creator.md`, strip YAML frontmatter, and pass the markdown body as `AgentContext.system_message_suffix`.
- [ ] In `runner.py`, call OpenHands `load_skills_from_dir(str(Path(workspace_skill_dir) / ".agents" / "skills"))`.
- [ ] Pass `list(agent_skills.values())` to `AgentContext.skills`.
- [ ] Set `load_public_skills=False`.
- [ ] Pass `request.get("userMessageSuffix") or ""` to `AgentContext.user_message_suffix`.
- [ ] Keep tools on `Agent(tools=...)`, not `AgentContext`.
- [ ] Run one-shot scope review as a single-message `Conversation`:

```python
conversation = Conversation(agent=agent, workspace=workspace_skill_dir)
conversation.send_message(request["prompt"])
result = conversation.run(max_iterations=parse_max_iterations(request))
```

- [ ] Add runner tests for frontmatter stripping, skill loading, disabled public skills, user suffix passing, and `Conversation.send_message`.
- [ ] Run:

```bash
cd app/sidecar && npx vitest run __tests__/openhands-runner.test.ts
cd app/sidecar && python3 -m py_compile openhands/runner.py
```

## Task 4: Route `review_skill_scope` Through OpenHands

- [ ] Remove the direct `reqwest` call to `https://api.anthropic.com/v1/messages`.
- [ ] Read current app settings and project them into the existing clean-break OpenHands `WorkflowLlmConfig`.
- [ ] Use the existing workspace path from settings. Do not create a temporary validation workspace.
- [ ] Ensure workspace runtime artifacts are available by reusing the same `ensure_workspace_prompts` path used by app startup if artifacts are missing.
- [ ] Build a one-shot sidecar config with:
  - `runtimeProvider: "openhands"`
  - `mode: "one-shot"`
  - `agentName: "skill-creator"`
  - `taskKind: "scope_review"`
  - rendered `prompt`
  - rendered `userMessageSuffix`
  - `allowedTools` suitable for scope review
  - `maxTurns` small enough for validation
  - `outputFormat` for `ScopeReviewResult`
- [ ] Await the terminal result and parse the existing `ScopeReviewResult` shape.
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

## Task 6: Progress Event And Smoke Coverage

- [ ] Add sidecar event-processor coverage showing OpenHands scope-review progress/tool events are mapped before the terminal `run_result`.
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
