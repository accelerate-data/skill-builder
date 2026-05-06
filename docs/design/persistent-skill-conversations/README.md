---
functional-specs: []
---

# Persistent OpenHands Skill Conversations

> **Status:** Draft
> **Issues:** `VU-1168`, `VU-1169`, `VU-1170`

## Overview

Skill Builder should treat each skill as one long-lived OpenHands conversation,
not as a sequence of unrelated one-shot runs. When a user opens a skill, the
app should attach to that skill's persistent OpenHands conversation, reuse it
across workflow, refine, and other skill-bound surfaces, and only create a new
conversation if the saved one cannot be found or recovered.

This design replaces two assumptions that are no longer correct:

1. The main agent can ignore `skill-creator.md` and rely only on
   `agent_context.skills`.
2. All OpenHands conversations should persist under one app-wide shared root.

Instead, the main agent should receive the `skill-creator.md` body as
`agent_context.system_message_suffix`, and each open skill should get its own
Agent Server instance plus its own on-disk conversation root under that skill's
workspace directory.

## Design Scope

**Covers**

- One persistent OpenHands conversation per skill.
- One Agent Server instance per open skill.
- Per-skill conversation persistence rooted inside the skill workspace.
- Main-agent `system_message_suffix` wiring from
  `agent-sources/workspace/agents/skill-creator.md`.
- Default subagent capability through `task_tool_set`.
- Named subagent registration through `agent_definitions`, including the step 3
  verifier path.
- Resume behavior when reopening a skill after app restart or crash.

**Does not cover**

- Pre-skill flows that run before a skill exists on disk, such as initial scope
  review during skill creation.
- UI redesign for resume state or history viewing.
- Prompt/content rewrites for individual workflow steps beyond the runtime
  contract needed to make persistence work.
- Final reset semantics for "start fresh" or destructive conversation deletion
  beyond the baseline persistence contract.

## Key Decisions

| Decision | Rationale |
|---|---|
| One conversation per skill across all skill-bound surfaces. | Old context is intentionally preserved. Workflow, refine, eval follow-ups, and other skill-bound surfaces should accumulate shared context instead of reconstructing it each time. |
| One Agent Server instance per open skill. | The OpenHands Agent Server persistence root is configured at process start, not per request. Starting one server for the currently open skill gives Skill Builder true per-skill conversation storage without requiring an upstream server API change. |
| Persist conversations under `{workspace_skill_dir}/conversations/`. | Conversation state should live next to the skill workspace that owns it, not under a shared app-global root. This keeps runtime state isolated per skill and makes crash recovery local to the skill. |
| Store one durable `conversation_id` per skill in the app DB. | Reopen should first try the known conversation. The app creates a new one only when the persisted conversation is missing or unrecoverable. |
| Main-agent instructions come from `skill-creator.md` via `agent_context.system_message_suffix`. | The current path does not reliably load those instructions for the main agent. Sending the suffix explicitly makes the contract deterministic while still preserving OpenHands' default system prompt template. |
| `user_message_suffix` stays app-owned and additive. | The suffix from `skill-creator-user-suffix.txt` remains a request-scoped app control surface. It complements, but does not replace, the main agent suffix. |
| `task_tool_set` is part of the default tool set for Agent Server calls. | Subagent capability should be consistently available without per-surface tool drift. |
| Subagents are supplied through `agent_definitions`. | Named file agents such as `skill-verifier` must be forwarded as explicit agent definitions if the main agent is expected to invoke them through the Agent Server contract. |
| Workflow and refine prompts become incremental turns on an existing thread. | When a conversation persists across surfaces, prompts must assume prior context exists. The design treats that prior context as a feature, not contamination. |
| Closing a skill view does not delete the conversation. | The default behavior is persistence and resume. Deletion should be reserved for an explicit future "start fresh" or skill-deletion flow. |

## Target Runtime Shape

```text
open skill
  -> resolve workspace_skill_dir
  -> start or attach per-skill Agent Server
     -> OH_CONVERSATIONS_PATH = {workspace_skill_dir}/conversations
  -> read saved conversation_id for {plugin_slug, skill_name}
  -> if found and recoverable: resume
  -> else: create new conversation, persist conversation_id
  -> all skill-bound surfaces send turns to the same conversation
```

Within that one conversation:

- the main agent is a materialized `Agent` request object;
- the main agent includes `agent_context.system_message_suffix` loaded from
  `skill-creator.md`;
- the main agent includes `agent_context.user_message_suffix` when the surface
  sets one;
- the main agent includes the default tool set plus `task_tool_set`;
- named file agents are serialized into `agent_definitions` for delegation.

## Skill Lifecycle

### Skill open

1. Resolve the canonical `workspace_skill_dir`.
2. Start or reattach the Agent Server process for that skill.
3. Read the saved `conversation_id` for the skill from the DB.
4. Query the server for that conversation.
5. If it exists, reattach and load its events/state.
6. If it does not exist, create a new conversation and persist the new
   `conversation_id`.

### Skill-bound runtime surfaces

All skill-bound surfaces target the same conversation:

- workflow step 0
- workflow step 1
- workflow step 2
- workflow step 3
- refine
- other post-creation skill surfaces that need agent access

Each surface sends a new prompt or event into the same thread rather than
creating a separate conversation with a separate identity.

### Skill close and app shutdown

- Navigating away from a skill keeps the conversation and its persisted ID.
- App shutdown stops the per-skill Agent Server process but does not delete the
  conversation state on disk.
- Reopening the same skill restarts the server and attempts resume.

## Agent Construction Contract

### Main agent

The `POST /api/conversations` request should include a fully materialized main
agent object with:

- the selected LLM config;
- the default tool set, including `task_tool_set`;
- `agent_context.skills` from the deployed `.agents/skills/**` files;
- `agent_context.system_message_suffix` populated from the markdown body of
  `agent-sources/workspace/agents/skill-creator.md`;
- `agent_context.user_message_suffix` populated from the existing
  app-owned suffix when a surface requires it.

The app should strip YAML frontmatter from `skill-creator.md` and send only the
markdown instruction body as the suffix.

### Subagents

The same `POST /api/conversations` request should include `agent_definitions`
for named workspace agents under `.agents/agents/*.md`.

That registry is what allows the main agent to invoke named subagents such as
`skill-verifier` through `task_tool_set`.

### Tool policy

The default OpenHands tools for Skill Builder should include:

- `terminal`
- `file_editor`
- `task_tracker`
- `grep`
- `glob`
- `browser_tool_set`
- `planning_file_editor`
- `task_tool_set`

Per-surface restrictions can still narrow behavior through prompt design and
higher-level policy, but the conversation should not be recreated just to swap
subagent capability on or off.

## Persistence Model

### Conversation storage

Each skill workspace owns its own conversation root:

```text
{workspace_root}/{plugin_slug}/skills/{skill_name}/
├── .agents/
├── logs/
├── conversations/
│   └── <conversation_id_hex>/
│       ├── meta.json
│       ├── base_state.json
│       └── events/
└── ...
```

This replaces the shared app-wide `workspace/conversations/` model.

### Conversation identity

The DB should persist exactly one active OpenHands `conversation_id` per skill.
At minimum the key needs:

- `plugin_slug`
- `skill_name`
- `conversation_id`

Optional metadata such as last-known status or last-opened timestamp can be
added if the implementation benefits from them, but the primary contract is the
stable saved ID.

## Recovery Rules

| Condition | Behavior |
|---|---|
| Saved conversation exists and server can load it | Reattach and continue. |
| Saved conversation is missing on disk or server returns not found | Create a new conversation and overwrite the saved `conversation_id`. |
| Server process died while the conversation persisted on disk | Restart the per-skill server, then reattach using the saved `conversation_id`. |
| Saved conversation is terminal but still present | Reattach to preserve history; the next surface prompt continues the same thread unless a future explicit reset flow says otherwise. |

## Impact On Existing Designs

This design changes the active assumptions in several existing docs:

- `openhands-workspace-management/README.md` is superseded because it assumes a
  shared app-wide conversation root.
- `openhands-native-migration/README.md` must no longer claim that
  `skill-creator.md` is ignored as a main-agent suffix.
- `refine-openhands-migration/README.md` must no longer claim that closing a
  refine session deletes the OpenHands conversation.
- `openhands-agent-server-runtime/README.md` must treat Agent Server lifecycle
  and conversation ownership as skill-scoped, not app-global.

## Issue Mapping

| Issue | Scope in this design |
|---|---|
| `VU-1168` | Add `skill-verifier` as a named subagent, send it via `agent_definitions`, and rely on default `task_tool_set` so step 3 can invoke it. |
| `VU-1169` | Load `skill-creator.md` and send its markdown body as `agent_context.system_message_suffix` on the main agent. |
| `VU-1170` | Persist one conversation per skill, start one Agent Server per open skill, and always resume when possible. |

## Source Files

| Path | Role |
|---|---|
| `app/src-tauri/src/agents/openhands_server/process.rs` | Agent Server lifecycle and process-level env var wiring. |
| `app/src-tauri/src/agents/openhands_server/types.rs` | `POST /api/conversations` request shape, including main agent, tools, and future `agent_definitions`. |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Workflow-side agent invocation and suffix inputs. |
| `app/src-tauri/src/commands/refine/mod.rs` | Refine-side conversation reuse and session behavior. |
| `agent-sources/workspace/agents/skill-creator.md` | Main-agent instruction source. |
| `agent-sources/workspace/agents/` | Named subagent definition source, including the future verifier agent. |
