# VU-1169 Skill Creator Main-Agent Suffix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the main OpenHands agent always receives the markdown body of
`agent-sources/workspace/agents/skill-creator.md` as
`agent_context.system_message_suffix` on the Agent Server path.

**Architecture:** Keep the default OpenHands system prompt template intact, but
materialize the app's shared agent instructions explicitly in the request
payload. The runtime loads `skill-creator.md`, strips YAML frontmatter, and
passes the body as `agent_context.system_message_suffix` on the main agent for
workflow, refine, and other skill-bound Agent Server calls.

**Tech Stack:** Rust / Tauri / OpenHands Agent Server / workspace agent files /
Vitest / cargo tests.

**Design doc:** `docs/design/persistent-skill-conversations/README.md`

---

## File Structure

| File | Change |
|---|---|
| `app/src-tauri/src/agents/openhands_server/types.rs` | Add `system_message_suffix` to the main-agent request payload |
| `app/src-tauri/src/agents/sidecar.rs` | Carry the optional suffix field through the app-owned config layer if needed |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Populate the suffix for workflow calls |
| `app/src-tauri/src/commands/refine/mod.rs` | Populate the suffix for refine calls |
| `app/src-tauri/src/commands/skill/scope_review.rs` | Populate the suffix for skill-bound scope review if it shares the main skill agent |
| `agent-sources/workspace/agents/skill-creator.md` | Source file only; no content changes unless the instructions themselves need repair |

---

### Task 1: Characterize the missing suffix with failing tests

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/types.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/refine/mod.rs`

- [x] **Step 1: Add a failing Rust test that the serialized main agent includes `agent_context.system_message_suffix`**
- [x] **Step 2: Add a failing Rust test that frontmatter is stripped and only the markdown body is sent**
- [x] **Step 3: Add a failing test that workflow and refine config builders both carry the suffix input**
- [x] **Step 4: Run the targeted red tests and confirm the failure is the missing suffix field**
- [x] **Step 5: Capture the red-test evidence**

---

### Task 2: Implement explicit suffix loading and request wiring

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/types.rs`
- Modify: `app/src-tauri/src/agents/sidecar.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/commands/refine/mod.rs`
- Modify: other skill-bound command files that create `SidecarConfig`

- [x] **Step 1: Add a helper that reads `skill-creator.md` and strips YAML frontmatter**
- [x] **Step 2: Thread `system_message_suffix` through the app-owned config/request structs**
- [x] **Step 3: Populate the suffix for every skill-bound Agent Server call site that uses the main `skill-creator` agent**
- [x] **Step 4: Re-run the targeted tests and make them green**
- [ ] **Step 5: Commit the suffix wiring**

---

### Task 3: Regression-proof the contract

**Files:**

- Modify: `docs/design/openhands-native-migration/README.md` only if implementation details materially differ from the design
- Modify: any nearby request-shape tests in `app/src-tauri/src/agents/openhands_server/`

- [x] **Step 1: Add or update a golden request-shape test that captures `system_message_suffix` next to `user_message_suffix`**
- [x] **Step 2: Verify no older path still claims the suffix is omitted**
- [x] **Step 3: Run the targeted Rust tests and any affected unit suites**
- [ ] **Step 4: Update the plan checklist and add verification notes to `VU-1169`**

## Verification Notes

- Verified the OpenHands TypeScript client contract directly from the upstream source:
  `AgentContext.system_message_suffix` lives on the main serialized `agent`
  object, and `CreateConversationRequest` accepts that `agent` object as part
  of `POST /api/conversations`.
- Captured the red-test failure before implementation:
  `build_refine_openhands_config` missing, `skill_creator_system_message_suffix`
  missing, and `system_message_suffix` absent from the sidecar/request structs.
- Green verification run:
  - `cargo test --manifest-path app/src-tauri/Cargo.toml test_skill_creator_system_message_suffix_strips_frontmatter -- --nocapture`
  - `cargo test --manifest-path app/src-tauri/Cargo.toml conversation_payload_contains_local_workspace_for_skill_directory -- --nocapture`
  - `cargo test --manifest-path app/src-tauri/Cargo.toml skill_generation_sidecar_config_uses_skill_creator_openhands_contract -- --nocapture`
  - `cargo test --manifest-path app/src-tauri/Cargo.toml test_refine_openhands_config_uses_skill_creator_system_message_suffix -- --nocapture`
  - `cargo test --manifest-path app/src-tauri/Cargo.toml commands::refine -- --nocapture`
  - `cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow -- --nocapture`
  - `cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill -- --nocapture`
  - `cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server -- --nocapture`
  - `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
  - `git diff --check`
