---
functional-specs: [custom-plugin-management]
---

# OpenHands Tools Included

> **Status:** Draft
> **Parent:** [README.md](README.md)

## Overview

This document records what Skill Builder sends in `agent.tools` and
`include_default_tools` on OpenHands requests, why each entry is included or
excluded, and which SDK validation rules matter when changing that set.

The request construction lives in
`app/src-tauri/src/agents/openhands_server/types.rs`.

## SDK Validation Rules

Two registries matter:

- **Workspace tools (`agent.tools`)** must be registered by the Agent Server at
  boot.
- **Built-in tools (`include_default_tools`)** must be valid OpenHands built-in
  tool class names.

Unknown tool names fail conversation creation.

## Default Tool Set

### `agent.tools`

```rust
"terminal",
"file_editor",
"task_tracker",
"grep",
"glob",
"task_tool_set",
"browser_tool_set",
"planning_file_editor",
```

| Tool | Why it is included |
|---|---|
| `terminal` | Shell commands and search. |
| `file_editor` | Read/create/modify files. |
| `task_tracker` | Internal multi-step task tracking. |
| `grep` | Fast read-only search. |
| `glob` | Fast path discovery. |
| `task_tool_set` | Default subagent capability. |
| `browser_tool_set` | Web reads and research where needed. |
| `planning_file_editor` | Structured plan editing support. |

### `include_default_tools`

```rust
"FinishTool",
"ThinkTool",
```

`InvokeSkillTool` is not explicitly listed because OpenHands attaches it when
the active `agent_context.skills` set requires it.

## Override Policy

`allowed_tools` on `OpenHandsRuntimeConfig` is an explicit backend override:

- known tool names are normalized and used
- unknown names are dropped
- if the result is empty, the runtime falls back to the default set above

## Notes

- `apply_patch` is not currently part of the Agent Server-registered default
  set
- `tom_consult` is not currently part of the Agent Server-registered default
  set

Any change here should be coordinated with the runtime request builder in
`types.rs` and the Agent Server boot-time registration behavior.
