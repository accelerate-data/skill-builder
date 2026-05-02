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

Runtime code reads the initialized workspace through a backend API such as
`read_initialized_runtime_context`. If the workspace path is missing or the
directory does not exist, the runtime returns an app-visible startup/config error
instead of creating a new workspace in the feature command.

For existing skills and workflow steps, the runtime may use a skill-scoped
workspace directory that was already created by the create/workflow lifecycle.
For create-skill `Validate`, there is no skill workspace yet, so the one-shot
run uses the initialized workspace root. Validation must not pre-create
`workspace/{plugin_slug}/{skill_name}` because that path is owned by skill
creation.

### LLM

The selected workflow LLM is also a backend-owned runtime boundary. Settings UI
stores user choices, but runtime callers do not read provider/model/API-key
fields directly. Rust projects settings into `WorkflowLlmConfig` through
`selected_workflow_llm` or a wrapper such as `read_initialized_runtime_context`.
That projection owns validation, backend-only defaults such as `usage_id`, local
provider API-key rules, and secret redaction.

Frontend code should not receive or construct the runtime `WorkflowLlmConfig`.
It may display and save settings, but OpenHands invocation receives the resolved
LLM only from Rust.

### Agent Invocation

Product features invoke agents through a stable app-agent runtime API. The call
site supplies:

- `agent_name`
- `mode`: `one-shot` or `streaming`
- rendered task prompt or conversation message
- task discriminator
- allowed tools
- output format
- persistence context

The runtime API supplies:

- initialized workspace path
- selected `WorkflowLlmConfig`
- sidecar/runner executable resolution
- transcript directory
- event forwarding
- terminal conversation state capture

One-shot and streaming are execution modes under this API. One-shot creates a
single-message SDK conversation and returns the terminal
`conversation_state`. Streaming keeps the conversation open across user
messages and can later host interactive tools such as `AskUserQuestion`.

Create-skill validation uses the one-shot mode through this API. It should not
construct a bespoke sidecar contract at the feature-command layer beyond the
task-specific invocation fields. Feature code may still own task-specific
result parsing, such as converting terminal `conversation_state.result_text` or
`conversation_state.structured_output` into `ScopeReviewResult`.

Current Rust boundaries:

| Boundary | Rust API | Responsibility |
|---|---|---|
| Workspace + LLM runtime context | `commands::workflow::read_initialized_runtime_context` | Read the startup-initialized workspace path, verify root `.agents` artifacts exist, and project settings into `WorkflowLlmConfig`. |
| OpenHands one-shot request shape | `agents::sidecar::build_openhands_one_shot_config` | Build the internal sidecar request from app-agent task fields plus backend-owned workspace and LLM context. |
| OpenHands one-shot execution | `agents::sidecar::run_openhands_one_shot` | Dispatch the sidecar request, allocate diagnostic transcript logs, resolve runner paths through the sidecar pool, wait for lifecycle completion, and return the terminal `conversation_state`. |
| Execution mode | `mode: "one-shot"` / `mode: "streaming"` | Select single-message completion versus long-lived conversation semantics. |

## Source And Runtime Layout

Source layout:

```text
agent-sources/
  workspace/
    agents/
      skill-creator.md
    skills/
      answer-evaluator/
        SKILL.md
      research/
        SKILL.md
      skill-creator/
        SKILL.md
      skill-validator/
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
      answer-evaluator/
        SKILL.md
      research/
        SKILL.md
      skill-creator/
        SKILL.md
      skill-validator/
        SKILL.md
```

`agent-sources/workspace/**` contains only OpenHands runtime-discoverable files
and is copied into `.agents/**` when the workflow workspace is prepared.
`agent-sources/prompts/**` is not copied. Prompt templates are compiled into
Rust with `include_str!`, rendered with request values, and sent to the
sidecar/runner as strings. Legacy Claude adapter templates live in
`agent-sources/claude/**`, outside the OpenHands workspace source tree.

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

## Conversation Event Mapping

The runner emits JSONL progress before terminal states for non-trivial runs.
Node forwards OpenHands SDK conversation events through app-framed
`conversation_event` envelopes and forwards lifecycle changes through
`conversation_state` envelopes.

OpenHands runtime code must not translate SDK activity into legacy
Claude-compatible envelopes such as `display_item`, `run_result`, or
`request_complete`. React renders OpenHands activity from conversation events,
and Rust reads task completion from terminal conversation state.

| Runner event | App envelope |
|---|---|
| SDK conversation event | `conversation_event` |
| startup / running lifecycle | `conversation_state` |
| terminal success, error, cancelled | terminal `conversation_state` |

### Event Handling

SDK callback events are preserved as raw SDK payloads under
`conversation_event.event`. The app envelope may add transport metadata such as
`event_class`, `timestamp`, `conversation_id`, or `agent_id`, but it must not
flatten or remap the SDK event body into Claude-style display records.

Frontend extraction handles OpenHands SDK shapes directly, including nested
`MessageEvent`, `ActionEvent`, and `ObservationEvent` payloads produced by
SDK serialization. Message text, tool-call metadata, reasoning text, tool
inputs, and observations may live under nested fields such as `llm_message`,
`tool_call`, `tool_call_id`, `llm_response_id`, `reasoning_content`, or
`thinking_blocks`.

Parallel `ActionEvent`s that share the same non-empty `llm_response_id` are
grouped only as a render-time display projection. The stored event stream
remains append-only and keeps each SDK callback as its own
`conversation_event`.

`conversation_state` remains the app boundary for lifecycle and terminal task
results. Product code reads final status, errors, `structured_output`, and
`result_text` from terminal state records, not from activity events.

Runner stdout is reserved for JSONL protocol records:
`conversation_event` and `conversation_state`. Runner stderr and transcript logs
remain diagnostics for operators and support; they must not become frontend
activity or result inputs.

## Output And Parsing

The OpenHands SDK final answer crosses the Rust boundary through the terminal
`conversation_state`, not by replaying JSONL logs. Diagnostic transcript files
remain useful for support and debugging, but product features must not scrape
them to discover task results.

The stable one-shot result contract is:

- terminal status is `completed`, `error`, or `cancelled`;
- `error_detail` carries terminal failure text for `error` and `cancelled`;
- `structured_output` carries provider or runner structured output when
  available;
- `result_text` carries final assistant text when structured output is absent.

When `outputFormat` is present, Rust task code first reads
`conversation_state.structured_output`. If it is null or missing, Rust parses
`conversation_state.result_text` as JSON. Completed states without either a
structured object or parseable JSON are hard failures. Structured-output errors
are represented as `conversation_state(status="error", error_detail=...)`, not
as `run_result`.

The Python runner does not hide progress behind final output and does not need
to enforce provider-native schema constraints for VU-1145.

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
| `app/sidecar/openhands-event-processor.ts` | Validates and forwards raw runner JSONL conversation envelopes. |
| `app/src-tauri/src/agents/sidecar.rs` | Rust `SidecarConfig` serialized to the sidecar. |
| `app/src-tauri/src/commands/workflow/prompt.rs` | Existing pattern for compile-time prompt templates. |
| `app/src-tauri/src/commands/skill/scope_review.rs` | Existing direct Anthropic scope-review command to migrate. |
| `agent-sources/workspace/` | Source files copied into `.agents/**`. |
| `agent-sources/prompts/` | App-owned prompt templates compiled/rendered by code. |
| `agent-sources/claude/` | Legacy Claude adapter templates; not copied into `.agents/**`. |

## Testing

Required coverage:

- Rust prompt rendering tests for every `agent-sources/prompts/*.txt` template.
- Rust tests proving prompt templates are compiled/rendered and not copied into
  `.agents/**`.
- Python runner tests proving it reads `skill-creator.md`, calls
  `load_skills_from_dir(".agents/skills")`, disables public skills, passes
  `user_message_suffix`, and uses `Conversation.send_message`.
- Sidecar tests for request serialization and conversation event forwarding.
- Automated smoke/eval proving a one-shot run emits progress before terminal
  `conversation_state`.

## Open Questions

None.
