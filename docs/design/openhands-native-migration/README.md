# OpenHands-Native Migration

> **Status:** Draft

## Overview

Skill Builder currently uses `@anthropic-ai/claude-agent-sdk` and the Claude Code CLI binary as its agent runtime. This design describes a clean-break migration to OpenHands as the native runtime — covering both the **runtime layer** (replacing the execution engine behind the existing sidecar boundary) and the **agent layer** (replacing Claude Code-specific agent and skill files with OpenHands-native equivalents and simplifying the workflow topology).

The migration replaces the Claude SDK binary with a PyInstaller-bundled `openhands-runner` binary, adopts OpenHands file-based agent and AgentSkills conventions, and simplifies the workflow to one top-level OpenHands agent named `skill-creator`. Workflow phases, scope review, and other one-shot jobs are app-owned task prompts handled by that agent. OpenHands calls use a direct Rust -> Python runner boundary; Node is not part of the OpenHands runtime path. The JSONL protocol and all app-owned runtime contracts are preserved.

The runtime boundary contract is detailed in `docs/design/agent-runtime-boundary/README.md`. The concrete OpenHands SDK invocation contract is detailed in `docs/design/openhands-sdk-runner/README.md`. This document is the umbrella migration design.

## Design Scope

**Covers**

- Target agent topology: one top-level OpenHands agent plus app-owned task prompt templates.
- How Claude Code agent/skill files map to OpenHands file-based agents and AgentSkills.
- The simplified inline research pattern replacing parallel sub-agent fan-out.
- Multi-model support through the LiteLLM provider string model.
- OpenHands-native runtime packaging via PyInstaller single binary.
- The output layout change from `.claude/plugins/` to `.agents/`.
- Which app-owned runtime contracts are preserved and how they are enforced in OpenHands.
- Preserving visible run progress: reasoning/progress messages, tool calls, file operations, and terminal status for both one-shot and multi-message conversations.
- What is removed: the Claude SDK dependency, Claude Code tool names, the sub-agent coordination layer, and the confirm-decisions and generate-skill agent files.

**Does not cover**

- Refine/streaming session migration (separate ticket — requires `AskUserQuestion` custom tool).
- Broad eval harness redesign; this migration still adds targeted automated
  smoke/eval coverage for OpenHands workflow parity.
- Skill import, marketplace, or GitHub-import flows.
- Production sandboxing (Docker runtime) — local workspace runtime is used throughout.

## Key Decisions

| Decision | Rationale |
|---|---|
| Clean break from Claude SDK, not from Skill Builder's runtime invariants. | Removing the Claude SDK dependency does not remove the execution contracts the app depends on: structured output, one-shot step isolation, artifact visibility, per-agent tool constraints. These are explicitly re-expressed in OpenHands terms. |
| No dual-runtime compatibility. | Maintaining two parallel execution paths adds indefinite carrying cost. A branch release with a 1-month test window validates OpenHands before it becomes the default. |
| PyInstaller single binary for the OpenHands runner. | Tauri already bundles a native binary (the Claude CLI). The same infra handles a PyInstaller-built `openhands-runner`. No Docker, no system Python, no `uv` first-launch step. |
| One top-level OpenHands agent, `skill-creator`. | OpenHands `Agent` is the reasoning/action executor and `Conversation` is the stateful run boundary. Skill Builder should create one agent identity and vary task prompts, tools, and output schemas per request. |
| One-shot runs are single-message conversations. | A one-shot run is not a single OpenHands `step()`. It is a `Conversation` with one user message, no app-owned follow-up questions, and a bounded `run(max_iterations=...)` lifecycle. |
| Progress visibility is mandatory. | The UI must keep showing users that the agent is working. OpenHands reasoning/progress events, tool calls, file operations, and status updates must stream as `conversation_event` records before terminal `conversation_state`. |
| Workspace agent and skills mirror OpenHands `.agents/**`. | `agent-sources/workspace/**` is copied into `.agents/**`; only `.agents/agents/skill-creator.md` and `.agents/skills/**` are runtime workspace files. |
| Task prompts are app-owned templates. | Task-specific instructions live under `agent-sources/prompts/**`, are compiled/rendered by Rust, and are sent as explicit `Conversation.send_message(...)` content. They are not copied into `.agents/**`. |
| Tool availability is request scoped. | The one `skill-creator` agent can run with different allowed tool sets per one-shot task. The runner enforces the request's tool list when constructing the OpenHands `Agent`. |
| Inline research replaces parallel sub-agent fan-out. | OpenHands action-observation loop is sequential. Inline research in one context is simpler, has better cross-dimension coherence, and produces equivalent quality output. The parallel spawning machinery and merge/deduplication logic are removed. |
| One agent replaces the previous router and phase agents. | `skill-creator` replaces the router, orchestrator, detailed-research, confirm-decisions, generate-skill, and evaluator top-level agents. Phase behavior is selected by task prompt, tools, max turns, and output schema. |
| Confirm-decisions logic moves into app prompts. | Step 2 and step 3 are both one-shot conversations with `skill-creator`. The rendered task prompt and output schema distinguish decision confirmation from skill generation. |
| LiteLLM provider strings for multi-model support. | OpenHands routes all LLM calls through LiteLLM. Any provider string (`anthropic/claude-sonnet-4-6`, `openai/gpt-4o`, `google/gemini-2.0-flash`, `ollama/llama3.2`) works without runner changes. Settings adds a provider picker and per-provider API key. |
| `AGENTS.md` is the always-on context file. | Both Claude Code and OpenHands read `AGENTS.md` natively. No change to the always-on instruction layer. |
| `AskUserQuestion` gap is deferred. | Refine streaming depends on a custom interrupt tool. Until it is built, streaming sessions return a clear error. Workflow one-shot steps are unaffected. |
| Workspace, LLM, and agent invocation are backend-owned boundaries. | App startup initializes the workspace and deploys `.agents` artifacts; Rust projects settings into `WorkflowLlmConfig`; product features invoke app agents through one-shot or streaming runtime APIs instead of constructing raw runtime details. |

## Runtime Invariants

The app depends on a set of execution contracts that must hold regardless of which runtime is active. These are not Claude-specific — they are Skill Builder's runtime contract with the agent execution layer.

| Contract | Current enforcement | OpenHands enforcement |
|---|---|---|
| One-shot steps cannot interrupt for user input | `AskUserQuestion` absent from `allowedTools` for steps 0–3 | One-shot conversation requests omit the app-owned question tool and the runner rejects it for `mode: "one-shot"` |
| Structured JSON is required for steps 0–3 | Prompt instructions; parser validates terminal result payload | Same prompt instructions; extract JSON from terminal `conversation_state.result_text`, then Rust validates the typed contract |
| Artifact parsing errors are app-visible | Parser emits terminal failure over JSONL | OpenHands tasks emit terminal `conversation_state(status="error")` with `error_detail` |
| Users can see work in progress | Runtime messages stream while the run is active | OpenHands conversation events stream as `conversation_event` records for one-shot and multi-message conversations |
| Per-step turn budget is enforced | `max_turns` in `SidecarConfig` | `max_iterations` in `RunConfig`, populated from the same `max_turns` field |
| Tool availability is scoped per task | `allowedTools` in `SidecarConfig`, per step | Request-level tool list used to construct the OpenHands `Agent` |

## Stable Runtime Boundaries

The OpenHands migration establishes reusable boundaries for every current and
future feature that calls agents.

| Boundary | Owner | Contract |
|---|---|---|
| Workspace | App startup + Rust runtime API | `init_workspace` creates the workspace and deploys root `.agents` artifacts. Runtime callers use the initialized path and fail if it is missing; they do not create validation or task workspaces opportunistically. |
| LLM | Rust settings projection | Runtime callers use `WorkflowLlmConfig` produced by backend code such as `selected_workflow_llm`; frontend settings fields are storage/UI inputs, not runtime invocation contracts. |
| Agent invocation | Rust agent runtime API | Product features choose `agentName`, task kind, mode (`one-shot` or `streaming`), prompt, tool set, output schema, and persistence context. The runtime API supplies workspace, LLM, bundled runner path, transcript wiring, event forwarding, and terminal wait handling. Feature commands own task-specific result parsing. |

Create-skill `Validate` is the first caller of these boundaries. Because it
runs before a skill exists, it uses the initialized workspace root as the
OpenHands `LocalWorkspace`. Workflow steps continue using skill-scoped
workspace directories that the create/workflow lifecycle already created.

The same boundaries should be reused as answer evaluation, workflow steps,
description optimization, eval generation, and refine migrate to OpenHands. New
features should not read raw model settings or create runtime workspaces in the
feature command.

Nothing in this migration removes a runtime invariant. The mechanism changes; the contract does not.

## Current Architecture

The current workflow has six agent files across two plugins, a sub-agent fan-out pattern for parallel research, and a router agent (`skill-builder`) that dispatches steps to the correct downstream capability via the Claude Code `Skill` and `Agent` tools.

```text
step_config.rs → skill-builder agent
  ├── step 0: Skill tool → research-orchestrator → parallel Agent tool × N dimensions
  ├── step 1: Agent tool → detailed-research → parallel Agent tool × M sections
  ├── step 2: Agent tool → confirm-decisions
  └── step 3: Skill tool → generate-skill
```

Between steps the frontend currently calls `answer-evaluator` as a discrete
agent; the target OpenHands design converts that gate into an
`answer_evaluation` task prompt handled by `skill-creator`.

All tool names (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `Agent`, `Skill`, `AskUserQuestion`) are Claude Code-specific. The `allowedTools` list in `step_config.rs` enforces per-step tool access. `permissionMode` is a Claude Code permission concept. Plugin discovery in the sidecar resolves `.claude/plugins/` paths from installed plugin directories.

## Target Architecture

```text
step_config.rs → task kind + prompt + schema
  └── openhands-runner
      └── Agent(name: skill-creator)
          └── Conversation(workspace: skill workspace)
              ├── step 0 task: scope/research initial pass
              ├── answer-evaluation task: answer quality review
              ├── step 1 task: research refinement pass
              ├── step 2 task: decision confirmation
              └── step 3 task: skill generation
```

Each item above is a separate one-shot conversation: the runner constructs the
same top-level `skill-creator` agent, sends one rendered task prompt, streams
conversation events as normalized app-visible progress, runs to completion with
a bounded iteration count, and returns terminal `conversation_state`. The app can
later use the same runner to create a long-lived conversation for refine chat;
that mode keeps the same agent and workspace but permits repeated
`send_message` calls and the app-owned question tool.

The app JSONL protocol remains the boundary, but OpenHands-native requests use
`conversation_event` for progress and terminal `conversation_state` for
lifecycle/results. Legacy `run_result` and `display_item` envelopes are not part
of migrated OpenHands flows.

## Progress Visibility Contract

The OpenHands migration must preserve the current UI behavior where users can
watch the agent work instead of waiting on an opaque spinner. This applies to
both execution modes:

- **One-shot:** scope review, workflow steps, answer evaluation, eval runs, and
  background analysis stream progress until terminal `conversation_state`.
- **Conversation:** refine chat or future interactive sessions stream the same
  event types across multiple user messages.

The runner must emit JSONL progress events for:

- agent/conversation start and completion;
- assistant reasoning/progress messages when OpenHands exposes them;
- tool-call start with tool name and short summary;
- tool observations/results when safe to show;
- file operations and shell commands as displayable activity;
- warnings, validation failures, and retry attempts;
- terminal success, error, canceled, or max-turns status.

Rust spawns the bundled OpenHands runner directly and forwards runner stdout
JSONL into the app event stream. React renders `conversation_event` records for
activity and waits for terminal `conversation_state` to update lifecycle and
materialized outputs. Stderr remains redacted diagnostic app logging and is not
emitted as frontend activity. Cancellation for migrated one-shot OpenHands runs
targets the Rust-spawned runner process directly.

## Agent Model

OpenHands still constructs an `Agent`, but Skill Builder owns the agent
identity. The runner always creates one top-level agent named `skill-creator`.
OpenHands `Conversation` is the stateful execution boundary: a one-shot request
creates a conversation, sends one prompt, runs until finish, extracts the final
message, emits terminal `conversation_state`, and exits.

Only `skill-creator.md` lives in `<workspace-dir>/.agents/agents/`. Task
instructions are app-owned prompt templates under `agent-sources/prompts/**`.
Rust compiles those templates with `include_str!`, renders task inputs, and sends
the rendered text as the explicit user message.

### `skill-creator.md`

```markdown
---
name: skill-creator
description: >
  Executes Skill Builder skill creation tasks, including scope review,
  research, answer evaluation, decision confirmation, and skill generation.
tools:
  - file_editor
  - terminal
skills:
  - research
  - skill-creator
---
```

The body contains shared rules that apply to every task: obey the rendered task
prompt, respect the output schema, never ask user questions during one-shot
runs, and write only the files requested by the current task.

### App-Owned Prompt Templates

Task prompt templates live in `agent-sources/prompts/**` and are not copied into
the workspace.

| File | Task kind | Purpose |
|---|---|---|
| `scope-review.txt` | `scope_review` | Reviews whether a proposed skill is too broad, vague, or focused and returns split recommendations. |
| `research.txt` | `research` | Produces initial clarification questions using the `research` AgentSkill. |
| `research-refinement.txt` | `research_refinement` | Refines clarification questions using answer-evaluation results. |
| `answer-evaluation.txt` | `answer_evaluation` | Evaluates answer quality and writes `answer-evaluation.json`. |
| `decision-confirmation.txt` | `decision_confirmation` | Produces `decisions.json` from approved research and answers. |
| `skill-generation.txt` | `skill_generation` | Uses the `skill-creator` AgentSkill to write `SKILL.md` and base evals. |
| `skill-creator-user-suffix.txt` | all messages | Provides a no-op per-message suffix for future stable invariants. |

### Deleted agents

| Agent file | Reason |
|---|---|
| `skill-content-researcher/agents/skill-builder.md` | Router — eliminated, top-level agent is `skill-creator` and task routing moves to app-owned request metadata |
| `skill-content-researcher/agents/research-orchestrator` (implicit) | Converted into `research.txt` prompt and inline research instructions |
| `skill-content-researcher/agents/detailed-research.md` | Converted into `research-refinement.txt` prompt using the same research skill |
| `skill-content-researcher/agents/confirm-decisions.md` | Converted into `decision-confirmation.txt` prompt |
| `skill-creator/agents/generate-skill.md` | Converted into `skill-generation.txt` prompt |

## Skill Model

Skills follow the AgentSkills standard and live in `.agents/skills/*/SKILL.md`. The `SKILL.md` format is unchanged — existing files are already compliant.

### `research/SKILL.md`

The parallel sub-agent sections (step 6 of the current skill) are replaced with inline sequential dimension research:

```text
For each selected dimension:
  - Read references/dimensions/{name}.md
  - Research that dimension inline (500–800 words)

After all dimensions are researched, consolidate using
references/consolidation-handoff.md and return clarifications_json.
```

All merge, deduplication, absolute-path-passing, and sub-agent wait logic is removed. The dimension reference files, scoring rubric, consolidation handoff, and output schemas are unchanged.

For the refinement pass (step 1), the same skill is used with the `answer-evaluation.json` verdicts already read into context. The skill generates refinement questions inline for non-clear items per section.

### `skill-creator/SKILL.md`

Used by the `skill_generation` one-shot task in step 3. Writes `SKILL.md` and base evals from `decisions.json` and `clarifications.json`. No structural change to the skill's output contract.

### Retained reference files

All dimension reference files (`references/dimensions/*.md`), `references/scoring-rubric.md`, `references/consolidation-handoff.md`, `references/dimension-sets.md`, and `shared/schemas.md` are retained without change.

## Tool Name Mapping

| Claude Code tool | OpenHands equivalent | Notes |
|---|---|---|
| `Read`, `Write`, `Edit` | `file_editor` | Single built-in tool covers all file operations |
| `Glob`, `Grep`, `Bash` | `terminal` | Bash execution covers search and shell operations |
| `Agent`, `Skill` | Not needed as Claude Code tools | App-owned prompts and AgentSkills replace Claude sub-agent/tool delegation |
| `AskUserQuestion` | Deferred — custom tool | Required for refine streaming only; not used in one-shot workflow steps |

`allowedTools` remains an app-owned request field during the clean-break
implementation because tool scope varies by task. The runner maps that list to
OpenHands `Tool(...)` instances when constructing the one `skill-creator`
agent. Request validation is the runtime authority.

`permissionMode` is removed with no equivalent needed: OpenHands does not have
a global Claude Code permission mode. `requiredPlugins` is replaced by the
workspace `.agents/skills/` layout plus app-owned task prompt selection.

## Workflow Step Routing

`step_config.rs` maps app operations to task kinds, prompt templates, tool sets,
max turns, and output schemas. It no longer maps workflow phases to separate
top-level agents.

| Operation | Task kind | Prompt template | Skills | Output file |
|---|---|---|---|---|
| Scope validate | `scope_review` | `scope-review.txt` | none | returned JSON only |
| Step 0 | `research` | `research.txt` | `research` | `context/clarifications.json` |
| Answer eval | `answer_evaluation` | `answer-evaluation.txt` | none | `answer-evaluation.json` |
| Step 1 | `research_refinement` | `research-refinement.txt` | `research` | `context/clarifications.json` refined |
| Step 2 | `decision_confirmation` | `decision-confirmation.txt` | none | `context/decisions.json` |
| Step 3 | `skill_generation` | `skill-generation.txt` | `skill-creator` | `SKILL.md` + base evals |

## Multi-Model Support

OpenHands routes all LLM calls through LiteLLM. The `model` field in `SidecarConfig` always carries a full LiteLLM provider string. Bare model names are not accepted. The Settings UI assembles the string from a provider dropdown and model picker so users never write it manually.

| Provider | Model string | API key env var |
|---|---|---|
| Anthropic | `anthropic/claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai/gpt-4o` | `OPENAI_API_KEY` |
| Google | `google/gemini-2.0-flash` | `GEMINI_API_KEY` |
| Ollama (local) | `ollama/llama3.2` | None (base URL) |

The `apiKey` field in `SidecarConfig` carries the selected provider's key. A `modelBaseUrl` field is added for local/custom endpoints. The sidecar passes `model`, `apiKey`, and `modelBaseUrl` to `openhands-runner`; the runner builds the OpenHands `LLMConfig` directly from those fields. Provider-specific storage can remain a Settings UI concern, but the runner contract is model string plus key plus optional base URL.

## Runtime Packaging

The `openhands-runner` binary is built with PyInstaller at CI time and bundled as a Tauri external binary resource, replacing the Claude CLI binary and `pathToClaudeCodeExecutable` in `sidecar.rs`.

```text
app/src-tauri/
  binaries/
    openhands-runner-aarch64-apple-darwin
    openhands-runner-x86_64-apple-darwin
    openhands-runner-x86_64-pc-windows-msvc.exe
    openhands-runner-x86_64-unknown-linux-gnu
```

The build script (`app/sidecar/openhands/build.sh`) runs `pyinstaller runner.py --onefile --name openhands-runner` per platform. Binary size is approximately 80–150 MB per platform, comparable to the Claude CLI binary.

`resolve_sdk_cli_path` in Rust is replaced by `resolve_openhands_runner_path`, which resolves the bundled binary path using Tauri's resource resolver.

If startup latency from PyInstaller initialization is unacceptable in testing, the fallback is a `uv`-managed venv with a first-launch install step. The decision between these approaches is made at CI validation time, not deferred to production.

## Output Layout

The workspace directory path is unchanged. Agent and skill artifacts move from `.claude/plugins/<plugin-slug>/` to `.agents/` within the same workspace directory:

| Current path (relative to workspace dir) | Target path (relative to workspace dir) |
|---|---|
| `.claude/plugins/<slug>/agents/*.md` | `.agents/agents/*.md` |
| `.claude/plugins/<slug>/skills/*/SKILL.md` | `.agents/skills/*/SKILL.md` |
| `.claude/plugins/<slug>/.claude-plugin/plugin.json` | Not needed — agents and skills are discovered directly |
| `CLAUDE.md` | Not generated — `AGENTS.md` is the only always-on context file |

`plugin.json` and the `.claude-plugin/` directory are eliminated from the
OpenHands runtime layout. Plugin identity is carried by agent and skill
frontmatter names. During the migration, remaining legacy Claude rebuild paths
read their adapter template from `agent-sources/claude/**`; the OpenHands
workspace source tree does not contain `CLAUDE.md` or prompt templates.

## AskUserQuestion Gap

`AskUserQuestion` is used only in refine streaming sessions (`stream-session.ts`) and the old Claude confirm-decisions flow. In the OpenHands design, decision confirmation is a `decision_confirmation` one-shot task handled by `skill-creator` with the `decision-confirmation.txt` prompt. Decisions are returned as structured output and rendered by the frontend without requiring a mid-run interrupt. No blocking question tool is needed for steps 2 or 3.

Refine streaming remains broken until a custom `AskUserQuestion` tool is implemented as a registered OpenHands tool that emits a `refine_question` JSONL event and blocks for an answer. That work is tracked separately.

## What Is Removed

| Artifact | Removed because |
|---|---|
| `@anthropic-ai/claude-agent-sdk` npm package | Runtime replaced by `openhands-runner` binary |
| Claude Code CLI binary in Tauri resources | Replaced by `openhands-runner` |
| `pathToClaudeCodeExecutable` in `SidecarConfig` | Replaced by `resolve_openhands_runner_path` |
| `permissionMode` in `SidecarConfig` | Claude Code-specific concept with no OpenHands equivalent; task-level tool scoping covers the same ground |
| `requiredPlugins` in `SidecarConfig` | Replaced by `.agents/skills/` deployment plus app-owned task prompt selection |
| `.claude/plugins/` output layout | Replaced by `.agents/` |
| `plugin.json` and `.claude-plugin/` | Not needed by OpenHands |
| `skill-builder.md` agent | Router — step routing moves to `step_config.rs` |
| `confirm-decisions.md` agent | Converted into `decision-confirmation.txt` prompt |
| `generate-skill.md` agent | Converted into `skill-generation.txt` prompt |
| Parallel sub-agent spawning instructions | Replaced by inline sequential execution |
| Sub-agent merge and deduplication logic | Not needed with inline execution |
| `options.ts` Claude SDK option builder | Runner builds OpenHands config directly |
| OpenHands `CLAUDE.md` generation | Clean break — `AGENTS.md` is the only always-on context file; no compatibility shim in `.agents/**` |

## Key Source Files

| File | Purpose |
|---|---|
| `app/sidecar/openhands/runner.py` | OpenHands runner — reads one JSON request, emits JSONL events |
| `app/sidecar/runtime/openhands-runtime.ts` | Spawns runner binary, maps JSONL to runtime sink |
| `app/sidecar/openhands-event-processor.ts` | Maps OpenHands events to sidecar protocol envelopes |
| `app/src-tauri/src/agents/sidecar.rs` | `SidecarConfig` carrying rendered prompt, user suffix, model settings, task tools, and workspace paths |
| `app/src-tauri/src/commands/workflow/step_config.rs` | Step-to-task routing table |
| `agent-sources/workspace/agents/skill-creator.md` | One file-based OpenHands agent copied into `.agents/agents/` |
| `agent-sources/workspace/skills/` | File-based AgentSkills copied into `.agents/skills/` |
| `agent-sources/prompts/` | App-owned prompt templates compiled/rendered by code |
| `agent-sources/claude/` | Legacy Claude adapter templates for non-migrated rebuild paths; not part of OpenHands runtime |
| `agent-sources/plugins/skill-content-researcher/skills/research/SKILL.md` | Inline research — sub-agent sections removed |
| `agent-sources/plugins/skill-creator/skills/skill-creator/SKILL.md` | Skill writer — no structural change |
| `docs/design/agent-runtime-boundary/README.md` | Runtime boundary contract (prerequisite) |
| `docs/design/openhands-sdk-runner/README.md` | OpenHands SDK invocation contract |

## Risks

| Risk | Mitigation |
|---|---|
| `CodeActAgent` structured JSON reliability across non-Claude models | Smoke-test step 0 and step 3 on at least two providers before release cut. The `extractJsonFromText` fallback handles loose JSON. Add a `structured_output_missing` retry prompt if the first attempt fails to produce valid JSON. |
| PyInstaller binary size and startup time | Measure at CI build time. If startup latency is unacceptable, switch to a `uv`-managed venv with a first-launch install step instead. |
| Inline research quality vs parallel sub-agents | The agent has full cross-dimension context in one pass, which may improve coherence. Run a side-by-side eval on 3–5 representative skill topics before shipping. |
| `AskUserQuestion` gap affects refine UX | Clearly communicated in release notes. Refine returns an explicit error message directing users to use workflow mode. |
