# VU-1168 Skill Verifier Subagent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let workflow step 3 invoke a named `skill-verifier` subagent through
the OpenHands Agent Server path, using the persistent per-skill conversation
model and the default `task_tool_set`.

**Architecture:** The main `skill-creator` conversation keeps a default tool set
that includes `task_tool_set`. Step 3 forwards named file-agent definitions via
`agent_definitions` on `POST /api/conversations`. The runtime deploys a
dedicated `skill-verifier.md` file into `.agents/agents/`, serializes it into
the request payload, and prompts step 3 to invoke it by name during the
generator-verifier loop.

**Tech Stack:** Rust / Tauri / OpenHands Agent Server / workspace agent files /
Vitest / cargo tests.

**Design doc:** `docs/design/persistent-skill-conversations/README.md`

---

## File Structure

| File | Change |
|---|---|
| `agent-sources/workspace/agents/skill-verifier.md` | New verifier agent definition |
| `app/src-tauri/src/commands/workflow/deploy.rs` | Ensure verifier agent deploys with other workspace agent files |
| `app/src-tauri/src/agents/openhands_server/types.rs` | Default tools include `task_tool_set`; serialize `agent_definitions` |
| `app/src-tauri/src/agents/openhands_server/client.rs` | Request-shape tests for verifier definitions |
| `agent-sources/workspace/skills/creating-skills/SKILL.md` | Update generation guidance to call the verifier by name |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Step 3 prompt/runtime wiring if explicit verifier mention is needed |
| `app/agent-tests/**` | Structural coverage for new verifier agent file |

---

### Task 1: Lock the request contract with failing tests

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/client.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/types.rs`
- Modify: `app/agent-tests/**` or the closest structural test file

- [ ] **Step 1: Add a failing Rust test that default tools include `task_tool_set`**
- [ ] **Step 2: Add a failing Rust test that `StartConversationRequest` serializes `agent_definitions` with a `skill-verifier` entry**
- [ ] **Step 3: Add a failing structural test that `agent-sources/workspace/agents/skill-verifier.md` exists and has valid frontmatter**
- [ ] **Step 4: Run the targeted red tests and confirm the failures are about missing verifier/subagent wiring**
- [ ] **Step 5: Commit the red tests**

---

### Task 2: Add the verifier agent definition and payload wiring

**Files:**

- Add: `agent-sources/workspace/agents/skill-verifier.md`
- Modify: `app/src-tauri/src/agents/openhands_server/types.rs`
- Modify: `app/src-tauri/src/commands/workflow/deploy.rs`

- [ ] **Step 1: Create `skill-verifier.md` with clear step 3 validation scope and no workflow-routing frontmatter leakage**
- [ ] **Step 2: Add a loader/serializer for `.agents/agents/*.md` so the runtime can send named `agent_definitions`**
- [ ] **Step 3: Make `task_tool_set` part of the default tool list for Agent Server requests**
- [ ] **Step 4: Re-run the targeted tests and make them green**
- [ ] **Step 5: Commit the runtime wiring**

---

### Task 3: Update step 3 guidance to use the verifier

**Files:**

- Modify: `agent-sources/workspace/skills/creating-skills/SKILL.md`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs` if the step 3 prompt needs explicit verifier-routing language

- [ ] **Step 1: Add a failing behavioral or structural test that step 3 guidance mentions invoking `skill-verifier` by name**
- [ ] **Step 2: Update `creating-skills` guidance to require verifier invocation and one repair pass when findings are material**
- [ ] **Step 3: Update any step 3 prompt text that still assumes the verifier is implicit or in-process**
- [ ] **Step 4: Run agent-structural tests plus the targeted Rust tests**
- [ ] **Step 5: Commit the guidance update**

---

### Task 4: Final verification

- [ ] **Step 1: Run `cd app && npm run test:agents:structural`**
- [ ] **Step 2: Run the targeted Rust request-shape tests for `openhands_server`**
- [ ] **Step 3: Run `cd app && npm run test:unit` if agent contract types changed in frontend-visible code**
- [ ] **Step 4: Update the plan checkboxes and capture verification notes in `VU-1168`**
