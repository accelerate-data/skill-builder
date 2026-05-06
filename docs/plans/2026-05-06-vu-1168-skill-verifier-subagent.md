# VU-1168 Skill Verifier Subagent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let workflow step 3 invoke a named `skill-verifier` subagent through
the OpenHands Agent Server path, using the persistent per-skill conversation
model and the default `task_tool_set`.

**Architecture:** The main `skill-creator` conversation keeps a default tool set
that includes `task_tool_set`. The Agent Server uses the skill-scoped
`workspace.working_dir` as the project root, so file agents deployed into
`{workspace_skill_dir}/.agents/agents/*.md` are discovered server-side via
OpenHands file-agent registration. The runtime therefore needs to deploy a
dedicated `skill-verifier.md` file into `.agents/agents/`, keep step 3 on the
skill-scoped workspace, and prompt the main conversation to invoke
`skill-verifier` by name during the generator-verifier loop. Because
conversations are persistent per skill, compatibility checks must recreate old
conversations that predate the verifier-enabled contract.

**Tech Stack:** Rust / Tauri / OpenHands Agent Server / workspace agent files /
Vitest / cargo tests.

**Design doc:** `docs/design/persistent-skill-conversations/README.md`

---

## File Structure

| File | Change |
|---|---|
| `agent-sources/workspace/agents/skill-verifier.md` | New verifier agent definition |
| `app/src-tauri/src/commands/workflow/deploy.rs` | Ensure verifier agent deploys with other workspace agent files |
| `app/src-tauri/src/agents/openhands_server/types.rs` | Preserve skill-scoped workspace contract for server-side file-agent discovery |
| `app/src-tauri/src/agents/openhands_server/mod.rs` | Treat missing verifier-capable contract as a resume mismatch for persistent conversations |
| `app/src-tauri/src/agents/openhands_server/client.rs` | Request-shape tests for skill-scoped workspace and default tool contract |
| `agent-sources/workspace/skills/creating-skills/SKILL.md` | Update generation guidance to call the verifier by name |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Step 3 prompt/runtime wiring if explicit verifier mention is needed |
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
- [x] **Step 3: Add a failing Rust test that persistent conversation compatibility rejects saved conversations that lack verifier-capable workspace agent state**
- [x] **Step 4: Run the targeted red tests and confirm the failures are about missing verifier/subagent wiring**
- [x] **Step 5: Commit the red tests**

---

### Task 2: Add the verifier agent definition and runtime compatibility wiring

**Files:**

- Add: `agent-sources/workspace/agents/skill-verifier.md`
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/commands/workflow/deploy.rs`

- [x] **Step 1: Create `skill-verifier.md` with clear step 3 validation scope and no workflow-routing frontmatter leakage**
- [x] **Step 2: Ensure workspace deployment copies `skill-verifier.md` into both workspace root and skill-scoped `.agents/agents/` layouts**
- [x] **Step 3: Extend persistent-conversation compatibility checks so old conversations without the verifier-enabled contract are recreated once**
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
- [x] **Step 2: Run the targeted Rust `openhands_server` tests for workspace contract and persistent-conversation compatibility**
- [x] **Step 3: Run `cd app && npm run test:unit` if agent contract types changed in frontend-visible code**
- [x] **Step 4: Run one smoke test that exercises step 3 verifier delegation end to end on the Agent Server path**
- [x] **Step 5: Update the plan checkboxes and capture verification notes in `VU-1168`**

## Verification Notes

- `cd app && npm run test:agents:structural`
- `cargo test --manifest-path app/src-tauri/Cargo.toml openhands_server -- --nocapture`
- `cargo test --manifest-path app/src-tauri/Cargo.toml skill_generation_prompt_renders_app_owned_openhands_task_context -- --nocapture`
- `cd app && npm run test:openhands:subagent-smoke`
- `cd app && OPENHANDS_AGENT_SERVER_LIVE_SMOKE=1 npm run test:openhands:subagent-smoke`
