---
functional-specs: []
---

# OpenHands SDK Runner

> **Status:** Draft
> **Functional specs:** Not applicable; this design covers the VU-1145 runtime integration contract rather than an end-user flow.

## Overview

Skill Builder calls the OpenHands SDK through the bundled `openhands-runner`.
The runner always constructs one top-level OpenHands agent, `skill-creator`.
One-shot work is a single-message OpenHands `Conversation`: the app sends one
rendered task prompt, the runner streams progress and tool events, and the run
ends with one terminal result. Future multi-message conversations use the same
agent and SDK object model, but keep the `Conversation` open across messages.

This document defines the exact SDK invocation contract: where the agent system
prompt comes from, how file-based skills are loaded, how app-owned task prompts
are rendered, and how progress remains visible in the current UI.

## Design Scope

**Covers**

- OpenHands `LLM`, `Tool`, `AgentContext`, `Agent`, and `Conversation`
  construction.
- Source and runtime layout for the one `skill-creator` file-based agent and
  file-based AgentSkills.
- Prompt ownership: workspace-copied agent/skills versus app-owned task prompt
  templates.
- `system_message_suffix` and `user_message_suffix` usage.
- One-shot and multi-message conversation lifecycle differences.
- Progress event streaming and terminal result behavior.

**Does not cover**

- Product UI design for create-skill validation.
- The future `AskUserQuestion` custom tool for refine streaming.
- OpenHands SDK internals beyond the invocation surface Skill Builder uses.
- Prompt text content beyond ownership and loading contracts.

## Key Decisions

| Decision | Rationale |
|---|---|
| Use one OpenHands file-based agent named `skill-creator`. | The agent identity is stable; task routing belongs to app-owned prompts and request metadata. |
| Copy only `agent-sources/workspace/**` into the runtime workspace. | The workspace should mirror OpenHands `.agents/**` layout and contain only runtime-discoverable agent and skill files. |
| Keep task prompts under `agent-sources/prompts/**`. | Task prompts are app-owned templates rendered by Rust and sent as explicit user messages; they are not runtime workspace files. |
| Load `skill-creator.md` into `AgentContext.system_message_suffix`. | The file defines stable identity and always-on rules for the one top-level agent. |
| Define `user_message_suffix`, but keep it effectively no-op for VU-1145. | The SDK field is useful for future per-message invariants, but task instructions must stay explicit in `Conversation.send_message(...)`. |
| Load file-based skills in Python with OpenHands `load_skills_from_dir`. | The Python runner owns SDK construction; Rust and Node should not parse AgentSkills. |
| Disable public OpenHands skills. | Skill Builder must be deterministic and expose only skills deployed into the workspace. |
| Pass tools to `Agent(tools=...)`, not `AgentContext`. | Tools are part of OpenHands agent construction and cannot vary within a multi-message conversation. |
| Stream progress before terminal results. | The current UI shows work in progress; the OpenHands runner must preserve visible reasoning/progress, tool calls, file activity, and status updates. |

## Workspace Lifecycle

The runner does not create a separate validation workspace. Skill Builder
already initializes the workspace during app startup. `init_workspace` creates
`<data_dir>/workspace`, persists the path in settings, and calls
`ensure_workspace_prompts_sync` to deploy bundled runtime artifacts. The
OpenHands clean-break implementation should keep using that startup path and
change the deployed artifact layout from legacy Claude resources to `.agents/**`.

Create-skill validation uses the existing workspace path from settings and the
already deployed `.agents` files. If implementation finds the workspace
artifacts missing, it should call the same workspace prompt deployment helper
used by startup rather than creating a temporary workspace.

## Source And Runtime Layout

Source layout:

```text
agent-sources/
  workspace/
    agents/
      skill-creator.md
    skills/
      research/
        SKILL.md
      skill-creator/
        SKILL.md
  prompts/
    skill-creator-user-suffix.txt
    scope-review.txt
    research.txt
    research-refinement.txt
    answer-evaluation.txt
    decision-confirmation.txt
    skill-generation.txt
```

Runtime workspace layout:

```text
<workspace-skill-dir>/
  .agents/
    agents/
      skill-creator.md
    skills/
      research/
        SKILL.md
      skill-creator/
        SKILL.md
```

`agent-sources/workspace/**` is copied into `.agents/**` when the workflow
workspace is prepared. `agent-sources/prompts/**` is not copied. Prompt templates
are compiled into Rust with `include_str!`, rendered with request values, and
sent to the sidecar/runner as strings.

## SDK Object Contract

The Python runner constructs the OpenHands objects.

```python
skills_dir = Path(workspace_skill_dir) / ".agents" / "skills"
_, _, agent_skills = load_skills_from_dir(str(skills_dir))

system_prompt_source = (
    Path(workspace_skill_dir)
    / ".agents"
    / "agents"
    / "skill-creator.md"
).read_text(encoding="utf-8")
system_prompt = strip_yaml_frontmatter(system_prompt_source)

agent_context = AgentContext(
    skills=list(agent_skills.values()),
    system_message_suffix=system_prompt,
    user_message_suffix=request.get("userMessageSuffix") or "",
    load_public_skills=False,
)

agent = Agent(
    llm=llm,
    tools=tools,
    agent_context=agent_context,
)

conversation = Conversation(agent=agent, workspace=workspace_skill_dir)
conversation.send_message(request["prompt"])
conversation.run(max_iterations=max_turns)
```

The runner strips YAML frontmatter out of `skill-creator.md` before assigning
`system_message_suffix`. Frontmatter remains source metadata for file deployment
and inspection; it is not part of the stable system prompt text.

## Prompt Responsibilities

| Prompt or context | Source | Loaded by | SDK destination |
|---|---|---|---|
| Base agent identity | `.agents/agents/skill-creator.md` | Python runner | `AgentContext.system_message_suffix` |
| File-based skills | `.agents/skills/*/SKILL.md` | Python runner via OpenHands `load_skills_from_dir` | `AgentContext.skills` |
| Public skills | disabled | Python runner | `load_public_skills=False` |
| User message suffix | `agent-sources/prompts/skill-creator-user-suffix.txt` | Rust `include_str!` | `AgentContext.user_message_suffix` |
| Task prompt | `agent-sources/prompts/{task}.txt` | Rust `include_str!` plus rendering | `Conversation.send_message(...)` |
| Tools | Rust task config | Python runner maps names to `Tool(...)` | `Agent(tools=...)` |
| LLM config | Skill Builder model settings | Python runner | `LLM(...)` |

## User Message Suffix Contract

`skill-creator-user-suffix.txt` is part of the runner request contract but is
initially a deliberate no-op:

```text
Follow the current user message exactly. Do not infer a different task than the one stated in the message.
```

Rules:

- The suffix is compiled into Rust and sent as `userMessageSuffix`.
- The suffix is not copied into the workspace.
- The suffix must not contain task routing, task-specific schema instructions,
  tool choices, or workflow-step details.
- Future use is limited to stable per-message invariants that apply to every
  message in a multi-message conversation.
- The suffix is sent on every OpenHands runner request even while it is a
  no-op. Keeping the field populated from day one makes the request contract
  explicit and avoids a later shape change.

## Task Prompt Contract

Task prompts are explicit user messages. Rust owns prompt rendering.

```rust
const SCOPE_REVIEW_PROMPT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/scope-review.txt"
));
```

For scope review:

```text
agent-sources/prompts/scope-review.txt
  -> Rust renders skill name, description, purpose, context questions, industry
  -> SidecarConfig.prompt
  -> runner request["prompt"]
  -> Conversation.send_message(...)
```

There are no task-specific file agents in `.agents/agents/`. The only
file-based agent is `skill-creator.md`.

## Skill Loading

The Python runner loads all deployed workspace skills:

```python
_, _, agent_skills = load_skills_from_dir(str(workspace_skill_dir / ".agents" / "skills"))
```

The runner passes `list(agent_skills.values())` to `AgentContext.skills` and
sets `load_public_skills=False`. This means the agent can see only the
file-based skills Skill Builder deployed into the workspace.

Task-scoped skill filtering is not part of VU-1145. If needed later, it should
be implemented as an explicit runner option and covered with tests.

## Tool Loading

Tools are passed to `Agent(tools=...)`.

One-shot runs may choose tools per task because each one-shot creates a new
conversation. Multi-message conversations must choose a stable tool set at
conversation start; OpenHands conversations cannot safely change tools between
messages.

The runner maps app tool names such as `file_editor` and `terminal` to
OpenHands `Tool(...)` objects. Invalid tool names are request validation errors.

## One-Shot Execution

Lifecycle:

1. Rust renders the task prompt from `agent-sources/prompts/{task}.txt`.
2. Rust renders or includes `skill-creator-user-suffix.txt`.
3. Rust sends `SidecarConfig` with `prompt`, `userMessageSuffix`, `llm`,
   `workspaceSkillDir`, `allowedTools`, and `maxTurns`.
4. Node passes the request to `openhands-runner` and streams JSONL back through
   `OpenHandsEventProcessor`.
5. Python reads `.agents/agents/skill-creator.md`.
6. Python loads `.agents/skills` with OpenHands `load_skills_from_dir`.
7. Python builds `AgentContext`, `Agent`, and `Conversation`.
8. Python sends one user message with `Conversation.send_message(...)`.
9. Python runs the conversation to completion.
10. The runner streams progress/tool events and emits one terminal result.

One-shot is not one OpenHands `Agent.step()`. A single task may require several
OpenHands reasoning/action iterations before completion.

## Multi-Message Conversations

Multi-message conversations use the same SDK object model but keep the
`Conversation` open:

- one `skill-creator` agent per conversation;
- one stable tool set chosen at conversation start;
- repeated user messages use the same `user_message_suffix`;
- progress and tool events stream through the same app envelopes;
- the future `AskUserQuestion` custom tool belongs only in this mode.

VU-1145 does not implement interactive OpenHands refine. It establishes the SDK
contract that future refine work must use.

## Progress Event Mapping

The runner must emit JSONL progress before terminal results for non-trivial
runs. The Node `OpenHandsEventProcessor` maps runner events into the existing
app protocol:

| Runner event | App envelope |
|---|---|
| conversation start / progress message | `display_item` or `agent_event` |
| assistant reasoning/progress text when exposed | `display_item` |
| tool-call start | `display_item` plus `agent_event` when metadata is useful |
| safe tool observation / file activity | `display_item` |
| warning / retry / validation status | `agent_event` |
| terminal success, error, canceled, max-turns | `run_result` |

React and Rust continue consuming normalized Skill Builder envelopes. They must
not consume OpenHands-native event shapes directly.

## Output And Parsing

The OpenHands SDK returns final text. When `outputFormat` is present in
`SidecarConfig`, the Node event processor extracts JSON from the final text and
emits the existing structured `run_result`. The Python runner does not hide
progress behind final output and does not need to enforce provider-native schema
constraints for VU-1145.

## Errors And Validation

The runner and sidecar must produce app-visible errors for:

- missing `.agents/agents/skill-creator.md`;
- missing or unreadable `.agents/skills`;
- OpenHands SDK import failure;
- public skills accidentally enabled;
- invalid tool name;
- invalid or missing `llm`;
- unsupported runtime mode;
- no terminal result from the SDK;
- structured output missing when `outputFormat` is set.

## Relationship To Existing Design Specs

| Spec | Relationship |
|---|---|
| `docs/design/openhands-native-migration/README.md` | Umbrella migration design; this doc defines the SDK invocation details it relies on. |
| `docs/design/agent-runtime-boundary/README.md` | Defines one-shot versus streaming contracts and normalized app-facing event envelopes. |
| `docs/design/model-settings/README.md` | Defines the app-owned model settings projected into OpenHands `LLM(...)`. |
| `docs/design/skill-scope-review/README.md` | Describes the create-skill scope advisor behavior that will move onto this runner path. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/sidecar/openhands/runner.py` | Python OpenHands SDK construction and JSONL runner. |
| `app/sidecar/runtime/openhands-runtime.ts` | Node adapter that spawns the runner and forwards request JSON. |
| `app/sidecar/openhands-event-processor.ts` | Maps raw runner JSONL to Skill Builder envelopes. |
| `app/src-tauri/src/agents/sidecar.rs` | Rust `SidecarConfig` serialized to the sidecar. |
| `app/src-tauri/src/commands/workflow/prompt.rs` | Existing pattern for compile-time prompt templates. |
| `app/src-tauri/src/commands/skill/scope_review.rs` | Existing direct Anthropic scope-review command to migrate. |
| `agent-sources/workspace/` | Source files copied into `.agents/**`. |
| `agent-sources/prompts/` | App-owned prompt templates compiled/rendered by code. |

## Testing

Required coverage:

- Rust prompt rendering tests for every `agent-sources/prompts/*.txt` template.
- Rust tests proving prompt templates are compiled/rendered and not copied into
  `.agents/**`.
- Python runner tests proving it reads `skill-creator.md`, calls
  `load_skills_from_dir(".agents/skills")`, disables public skills, passes
  `user_message_suffix`, and uses `Conversation.send_message`.
- Sidecar tests for request serialization and progress event mapping.
- Automated smoke/eval proving a one-shot run emits progress before terminal
  `run_result`.

## Open Questions

None.
