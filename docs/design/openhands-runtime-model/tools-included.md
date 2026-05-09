---
functional-specs: []
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

The default `agent.tools` set fires only when a surface passes an empty (or
fully-unrecognized) `allowed_tools`. In practice every surface today passes an
explicit allowlist, but the fallback is what `openhands_tools()` in
`app/src-tauri/src/agents/openhands_server/types.rs` emits when the resolved
list is empty:

### `agent.tools` default fallback

```rust
"terminal",
"file_editor",
"task_tracker",
"grep",
"glob",
"task_tool_set",
```

| Tool | Why it is included |
|---|---|
| `terminal` | Shell commands and search. |
| `file_editor` | Read/create/modify files. |
| `task_tracker` | Internal multi-step task tracking. |
| `grep` | Fast read-only search. |
| `glob` | Fast path discovery. |
| `task_tool_set` | Default subagent capability (modern replacement for the deprecated `delegate` tool). |

`browser_tool_set` and `planning_file_editor` are registered by the Agent
Server but **not in the default fallback**. They are opt-in via `allowed_tools`:

- `browser_tool_set` was misfiring on local `file://` paths (the model would
  try to "navigate" the workspace dir and the SDK's SecurityWatchdog blocked
  it), so it ships only when a surface explicitly needs web research. Today
  workflow research and detailed research are the only surfaces that opt in.
- `planning_file_editor` is `PLAN.md`-specific and stays opt-in.

`apply_patch` and `tom_consult` are **not** registered by the Agent Server, so
sending them raises `KeyError` from `resolve_tool` in the SDK. They must not
appear in any allowlist.

### `task_tool_set` is non-negotiable

If a surface passes a non-empty `allowed_tools` that omits `task_tool_set`,
the runtime appends it after normalization. File-based subagent invocation
(including `skill-verifier`) depends on it, so the contract is "always
present" regardless of the per-surface allowlist.

### `include_default_tools`

```rust
"FinishTool",
"ThinkTool",
```

`InvokeSkillTool` is not explicitly listed because OpenHands attaches it when
the active `agent_context.skills` set is non-empty.

## Override Policy

`allowed_tools` on `SidecarConfig` is an explicit backend override:

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
