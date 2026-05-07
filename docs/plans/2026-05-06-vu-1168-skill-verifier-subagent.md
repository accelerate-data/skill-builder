# VU-1168 Skill Verifier Subagent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let workflow step 3 invoke a named `skill-verifier` subagent through
the OpenHands Agent Server path, surface the verifier's nested tool activity in
the UI, and remove the stale generated-skill `metadata.version` /
`version_bump` contract from step 3.

**Architecture:** The main `skill-creator` conversation keeps a default tool set
that includes `task_tool_set`. The Agent Server uses the skill-scoped
`workspace.working_dir` as the project root, so file agents deployed into
`{workspace_skill_dir}/.agents/agents/*.md` are discovered server-side via
OpenHands file-agent registration. The runtime therefore needs to deploy a
dedicated `skill-verifier.md` file into `.agents/agents/`, keep step 3 on the
skill-scoped workspace, and prompt the main conversation to invoke
`skill-verifier` by name during the generator-verifier loop. Parent
conversation events only stream the `task`/`TaskObservation` boundary; nested
subagent tool activity is persisted under
`{parent_conversation}/subagents/<conversation_id>/events/`, so the backend
must replay those child events through the same `conversation_event` pipe used
for the parent conversation. Normalized events should expose `toolCallId` and
`parentToolCallId`, letting the frontend attach child items under the matching
parent subagent row without introducing a separate event type or file-scanning
UI path. Because conversations are persistent per skill and OpenHands only
rereads workspace file agents when a conversation is rebuilt, changes to skill
or agent definitions require an app restart to take effect on an existing
conversation. Generated skill frontmatter should no longer include
`metadata.version`, and the step 3 output contract should stop requiring
`version_bump`.

**Tech Stack:** Rust / Tauri / OpenHands Agent Server / workspace agent files /
Vitest / cargo tests.

**Design doc:** `docs/design/openhands-runtime-model/README.md`

---

## File Structure

| File | Change |
|---|---|
| `agent-sources/workspace/agents/skill-verifier.md` | New verifier agent definition |
| `app/src-tauri/src/commands/workflow/deploy.rs` | Ensure verifier agent deploys with other workspace agent files |
| `app/src-tauri/src/agents/openhands_server/types.rs` | Preserve skill-scoped workspace contract for server-side file-agent discovery |
| `app/src-tauri/src/agents/openhands_server/mod.rs` | Keep persistent-conversation reuse focused on the main agent config |
| `app/src-tauri/src/agents/openhands_server/client.rs` | Request-shape tests for skill-scoped workspace and default tool contract |
| `agent-sources/workspace/skills/creating-skills/SKILL.md` | Update generation guidance to call the verifier by name |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Step 3 prompt/runtime wiring if explicit verifier mention is needed |
| `app/src-tauri/src/commands/workflow/output_format.rs` | Remove generated-skill metadata.version / version_bump validation |
| `app/src/lib/openhands-event-projection.ts` | Project task-tool subagents and attach nested child events |
| `app/src/lib/openhands-conversation-events.ts` | Normalize `toolCallId` / `parentToolCallId` for parent and child events |
| `app/src/stores/agent-store.ts` | Route child conversation events into `subagentItems` on the parent subagent row |
| `app/src/components/agent-items/subagent-item.tsx` | Render nested verifier tool activity consistently |
| `app/agent-tests/**` | Structural coverage for new verifier agent file |
| `tests/evals/**` or a repo-local smoke harness | Minimal end-to-end smoke coverage for verifier delegation |

---

### Task 1: Lock the request contract with failing tests

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/client.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/agent-tests/**` or the closest structural test file

- [x] **Step 1: Add a failing structural test that `agent-sources/workspace/agents/skill-verifier.md` exists and has valid file-agent frontmatter**
- [x] **Step 2: Add a failing structural or behavioral test that step 3 guidance explicitly invokes `skill-verifier` by name**
- [x] **Step 3: Add a failing Rust test that pins the persistent conversation reuse contract to the supported main-agent config checks**
- [x] **Step 4: Run the targeted red tests and confirm the failures are about missing verifier/subagent wiring**
- [x] **Step 5: Commit the red tests**

---

### Task 2: Add the verifier agent definition and runtime wiring

**Files:**

- Add: `agent-sources/workspace/agents/skill-verifier.md`
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/commands/workflow/deploy.rs`

- [x] **Step 1: Create `skill-verifier.md` with clear step 3 validation scope and no workflow-routing frontmatter leakage**
- [x] **Step 2: Ensure workspace deployment copies `skill-verifier.md` into both workspace root and skill-scoped `.agents/agents/` layouts**
- [x] **Step 3: Keep runtime behavior simple: rely on app restart to reload changed workspace agent files for persistent conversations**
- [x] **Step 4: Re-run the targeted tests and make them green**
- [x] **Step 5: Commit the runtime wiring**

---

### Task 3: Update step 3 guidance to use the verifier

**Files:**

- Modify: `agent-sources/workspace/skills/creating-skills/SKILL.md`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs` if the step 3 prompt needs explicit verifier-routing language

- [x] **Step 1: Update `creating-skills` guidance to require `task_tool_set` delegation to the named `skill-verifier` agent**
- [x] **Step 2: Preserve the one-repair-pass contract when findings are material**
- [x] **Step 3: Update any step 3 prompt text that still assumes the verifier is implicit, inline, or unnamed**
- [x] **Step 4: Run agent-structural tests plus the targeted Rust tests**
- [x] **Step 5: Commit the guidance update**

---

### Task 4: Final verification

- [x] **Step 1: Run `cd app && npm run test:agents:structural`**
- [x] **Step 2: Run the targeted Rust `openhands_server` tests for workspace contract and persistent-conversation reuse**
- [x] **Step 3: Run `cd app && npm run test:unit` if agent contract types changed in frontend-visible code**
- [x] **Step 4: Run one smoke test that exercises step 3 verifier delegation end to end on the Agent Server path**
- [x] **Step 5: Update the plan checkboxes and capture verification notes in `VU-1168`**

---

## Follow-up Scope Expansion

### Task 5: Remove stale generated-skill version contract

**Files:**

- Modify: `agent-sources/prompts/skill-generation.txt`
- Modify: `agent-sources/workspace/skills/creating-skills/SKILL.md`
- Modify: `app/src-tauri/src/commands/workflow/output_format.rs`
- Modify: `app/src-tauri/src/commands/workflow/tests.rs`
- Modify: any generated contract/schema files touched by the shape change

- [x] **Step 1: Remove `metadata.version` generation instructions from the step 3 prompt and `creating-skills` skill guidance**
- [x] **Step 2: Remove `version_bump` from the generated-skill output contract and backend validation**
- [x] **Step 3: Update materialization/publish validation so generated skills no longer fail on missing or non-`1.0.0` metadata.version**
- [x] **Step 4: Add or update tests that prove a generated skill without `metadata.version` is accepted**
- [x] **Step 5: Re-run the targeted Rust tests for step 3 output parsing/materialization**

### Task 6: Surface nested subagent tool calls inside the subagent row

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/**`
- Modify: `app/src/lib/openhands-event-projection.ts`
- Modify: `app/src/lib/openhands-conversation-events.ts`
- Modify: `app/src/stores/agent-store.ts`
- Modify: `app/src/components/agent-items/subagent-item.tsx`
- Modify: `app/src/__tests__/lib/openhands-conversation-events.test.ts`
- Modify: `app/src/__tests__/lib/openhands-event-projection.test.ts`
- Modify: `app/src/__tests__/components/agent-items/subagent-item.test.tsx`

- [x] **Step 1: Normalize parent and child conversation events with `toolCallId` and `parentToolCallId` so the same `conversation_event` path can carry nested subagent activity**
- [x] **Step 2: Confirm the parent-to-child mapping strategy for persisted task-tool subagents using the existing `subagents/` directory layout and match child conversations to parent task launches deterministically**
- [x] **Step 3: Replay child subagent event streams from the backend as normal `conversation_event` messages carrying `parentToolCallId`**
- [x] **Step 4: Project nested child tool events into `subagentItems` so verifier tool calls render inside the parent subagent row, not as sibling timeline rows**
- [x] **Step 5: Preserve the current parent task row as the subagent summary while adding nested child activity and conclusion text inside it**
- [x] **Step 6: Add focused tests for normalization, projection, and rendering of nested subagent tool activity**
- [x] **Step 7: Run a real OpenHands-backed smoke or manual persisted-conversation check proving verifier child events are visible**

### Task 7: Stream nested subagent tool calls live while the subagent is running

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/events.rs`
- Modify: `app/src/__tests__/lib/openhands-conversation-events.test.ts` if normalized linkage coverage expands
- Modify: `app/src/__tests__/stores/agent-store.test.ts` if store semantics need additional live-stream assertions

- [x] **Step 1: Add failing backend tests that pin the current bug: child subagent events must emit before the parent task observation completes**
- [x] **Step 2: Introduce a dedicated async subagent event streaming worker owned by the parent conversation task, not a separate UI path**
- [x] **Step 3: Have that worker poll the persisted `subagents/*/events/*.json` tree incrementally, dedupe child event ids, and emit normal `conversation_event` messages with `parentToolCallId`**
- [x] **Step 4: Keep the existing parent WebSocket loop focused on parent conversation events and lifecycle while sharing launch state/cancellation cleanly with the child worker**
- [x] **Step 5: Verify that the UI shows nested verifier tool calls while the subagent row is still `Running...`, not only after completion**

## Verification Notes

- `cd app && npm run test:agents:structural`
- `cd app && npx tsc --noEmit`
- `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
- `cargo test --manifest-path app/src-tauri/Cargo.toml openhands_server -- --nocapture`
- `cargo test --manifest-path app/src-tauri/Cargo.toml live_subagent_scan -- --nocapture`
- `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow -- --nocapture`
- `cargo test --manifest-path app/src-tauri/Cargo.toml skill_generation_prompt_renders_app_owned_openhands_task_context -- --nocapture`
- `cd app && bash tests/run.sh e2e --tag @workflow`
- `cd app && npm run test:openhands:subagent-smoke`
- `cd app && OPENHANDS_AGENT_SERVER_LIVE_SMOKE=1 npm run test:openhands:subagent-smoke`
