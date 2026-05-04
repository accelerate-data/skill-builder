---
functional-specs: []
---

# OpenHands Tools Included

> **Status:** Draft
> **Issue:** VU-1155
> **Parent:** [openhands-agent-server-runtime/README.md](README.md)

## Overview

This document records what we send in `agent.tools` and `include_default_tools` on every conversation we open against the OpenHands Agent Server, why each entry is in or out, and what the SDK validation rules are. Use this as the source of truth when adjusting tool exposure.

The construction lives in `app/src-tauri/src/agents/openhands_server/types.rs::StartConversationRequest::from_one_shot` — both one-shot (workflow steps, scope review) and multi-turn (refine) requests pass through that function.

## SDK validation rules

Two separate registries gate what the agent server accepts:

- **Workspace tools (`agent.tools`)** are resolved through `openhands.sdk.tool.registry.resolve_tool` against `_REG`, a global dict populated by `register_tool(...)` calls. A tool name is only valid if some module imported during agent server boot ran the matching registration. Unknown names raise `KeyError: ToolDefinition '<name>' is not registered`.
- **Built-in tools (`include_default_tools`)** are resolved through `openhands.sdk.tool.builtins.BUILT_IN_TOOL_CLASSES`, a fixed map. Only `FinishTool`, `ThinkTool`, and `InvokeSkillTool` are accepted — anything else raises `ValueError: Unknown built-in tool class: '<name>'`.

The registry name is the snake-cased class name with a trailing `_tool` stripped. So `TerminalTool` → `terminal`, `BrowserToolSet` → `browser_tool_set`, `PlanningFileEditorTool` → `planning_file_editor`.

## What the agent server registers at boot

`openhands.agent_server.tool_router` runs at module-import time and registers tools through three preset functions plus the transitive imports in `openhands.tools.__init__`. The effective registered set is:

| Source | Registered tools |
|---|---|
| `register_default_tools(enable_browser=True)` | `terminal`, `file_editor`, `task_tracker`, `browser_tool_set` |
| `register_planning_tools()` | `glob`, `grep`, `planning_file_editor` |
| `register_gemini_tools(enable_browser=True)` | `read_file`, `write_file`, `edit`, `list_directory`, plus the four already in default |
| `import openhands.tools` (transitive) | `delegate`, `task`, `task_tool_set` |

Tools that ship in the `openhands-tools` wheel but are **not** registered:

- `apply_patch` — no preset imports `openhands.tools.apply_patch`
- `tom_consult` — no preset imports `openhands.tools.tom_consult`

Sending either name from the client raises `KeyError` and fails conversation creation.

## What we send

### `agent.tools`

```rust
// Default workspace toolkit emitted by openhands_tools() in types.rs
"terminal",
"file_editor",
"task_tracker",
"grep",
"glob",
"task_tool_set",
"browser_tool_set",
"planning_file_editor",
```

| Tool | Why we send it |
|---|---|
| `terminal` | Run shell commands; required for any non-trivial agent action. |
| `file_editor` | Read/create/modify files in the working directory. Standard "hands" tool. |
| `task_tracker` | Maintain an internal TODO list across turns. Improves multi-step coherence. |
| `grep` | Read-only code search. Cheap, fast, and the SDK ships it. |
| `glob` | Read-only path globbing. Pairs with `grep` for code discovery. |
| `task_tool_set` | Sub-agent spawn (the supported replacement for the deprecated `delegate`). |
| `browser_tool_set` | Web research and page reads. Heavy Playwright dependency, but it's already installed in the agent server image and we want it for refine/research flows. |
| `planning_file_editor` | Structured PLAN.md edits for planning-style sessions. |

`allowed_tools` on the legacy `SidecarConfig` (a Claude-Code-era field) is still honored as an explicit override: known names are normalized, unknowns are dropped, and an empty result falls back to the default toolkit above.

### `include_default_tools`

```rust
"FinishTool",
"ThinkTool",
```

`InvokeSkillTool` is intentionally **not** listed. `Agent._initialize` auto-attaches it whenever `agent_context.skills` contains an AgentSkills-format skill. Listing it explicitly would be redundant when a skill is loaded and would inject an unused tool when no skill is active.

## What we exclude and why

| Tool | Reason |
|---|---|
| `apply_patch` | Not registered by the agent server at boot — would raise `KeyError`. Atomic multi-file edits aren't worth a server-side patch to add the registration right now. |
| `tom_consult` | Not registered, and the underlying tool consults an external "Tom" service we don't run. |
| `delegate` | Deprecated in 1.16.0, removed in 1.23.0. `task_tool_set` is the supported replacement. |
| `task` | Same handler as `task_tool_set` but exposed as a single tool; `task_tool_set` is what the SDK docs recommend. |
| `read_file` / `write_file` / `edit` / `list_directory` | Gemini-style file editing variants. We standardize on `file_editor` to avoid mixing two editing models in one conversation. |
| `DelegateTool` in `include_default_tools` | Not a member of `BUILT_IN_TOOL_CLASSES`. The SDK rejects the request. (We previously sent this — see history below.) |

## Skill activation path

The Refine and workflow flows want the agent to invoke registered AgentSkills. That works without `DelegateTool`:

1. Skill markdown lives under `.agents/<plugin>/<skill>/SKILL.md` in the working directory the agent server can see.
2. The conversation request includes the skill in `agent_context.skills`.
3. `Agent._initialize` detects an AgentSkills-format skill and auto-attaches `InvokeSkillTool`.
4. The model invokes the skill via `invoke_skill` calls, which the SDK routes through the AgentSkill manifest.

If the skill isn't in `agent_context.skills`, no amount of tool wiring will activate it — `InvokeSkillTool` only auto-attaches when a skill is present.

## Open questions

- Should we register `apply_patch` server-side? Atomic patch application would be useful for refine multi-file edits, but it requires a small change to the server-side preset wiring (or a custom register call).
- Should planning workflows route through a separate agent that uses `get_planning_tools()` instead of mixing `planning_file_editor` into the default toolkit? Worth revisiting if we see the model reaching for it inappropriately during refine or workflow runs.

## History

- 2026-05-03 — `DelegateTool` removed from `include_default_tools` (rejected by `BUILT_IN_TOOL_CLASSES`; deprecated). `grep`, `glob`, `task_tool_set`, `browser_tool_set`, `planning_file_editor` added to `agent.tools`. `apply_patch` evaluated and excluded because the agent server doesn't register it. (Commit `2469b7ee`.)

## Source files

- `app/src-tauri/src/agents/openhands_server/types.rs` — `from_one_shot`, `openhands_tools`, `include_default_tools`
- `app/src-tauri/src/agents/openhands_server/client.rs` — unit test `default_tool_set_includes_search_and_subagent_spawn` pins the contract
- SDK references: `openhands/sdk/tool/registry.py`, `openhands/sdk/tool/builtins/__init__.py`, `openhands/agent_server/tool_router.py`, `openhands/tools/preset/{default,planning,gemini}.py`
