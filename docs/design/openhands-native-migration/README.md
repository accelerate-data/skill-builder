# OpenHands-Native Migration

> **Status:** Draft

## Overview

Skill Builder currently uses `@anthropic-ai/claude-agent-sdk` and the Claude Code CLI binary as its agent runtime. This design describes a clean-break migration to OpenHands as the native runtime — covering both the **runtime layer** (replacing the execution engine behind the existing sidecar boundary) and the **agent layer** (replacing Claude Code-specific agent and skill files with OpenHands-native equivalents and simplifying the workflow topology).

The migration replaces the Claude SDK binary with a PyInstaller-bundled `openhands-runner` binary, adopts OpenHands file-based agent and AgentSkills conventions, and simplifies the multi-agent workflow from a sub-agent fan-out pattern to named inline agents. The sidecar boundary, JSONL protocol, and all app-owned runtime contracts are preserved.

The runtime boundary contract is detailed in `docs/design/agent-runtime-boundary/README.md`. This document is the full migration plan.

## Design Scope

**Covers**

- Target agent topology (named agents, named skills, step routing).
- How Claude Code agent/skill files map to OpenHands file-based agents and AgentSkills.
- The simplified inline research pattern replacing parallel sub-agent fan-out.
- Multi-model support through the LiteLLM provider string model.
- OpenHands-native runtime packaging via PyInstaller single binary.
- The output layout change from `.claude/plugins/` to `.agents/`.
- Which app-owned runtime contracts are preserved and how they are enforced in OpenHands.
- What is removed: the Claude SDK dependency, Claude Code tool names, the sub-agent coordination layer, and the confirm-decisions and generate-skill agent files.

**Does not cover**

- Refine/streaming session migration (separate ticket — requires `AskUserQuestion` custom tool).
- Eval harness changes beyond base eval generation in step 3.
- Skill import, marketplace, or GitHub-import flows.
- Production sandboxing (Docker runtime) — local workspace runtime is used throughout.

## Key Decisions

| Decision | Rationale |
|---|---|
| Clean break from Claude SDK, not from Skill Builder's runtime invariants. | Removing the Claude SDK dependency does not remove the execution contracts the app depends on: structured output, one-shot step isolation, artifact visibility, per-agent tool constraints. These are explicitly re-expressed in OpenHands terms. |
| No dual-runtime compatibility. | Maintaining two parallel execution paths adds indefinite carrying cost. A branch release with a 1-month test window validates OpenHands before it becomes the default. |
| PyInstaller single binary for the OpenHands runner. | Tauri already bundles a native binary (the Claude CLI). The same infra handles a PyInstaller-built `openhands-runner`. No Docker, no system Python, no `uv` first-launch step. |
| OpenHands file-based agents in `.agents/agents/` and AgentSkills in `.agents/skills/`. | OpenHands natively discovers these directories. `SKILL.md` is already in the AgentSkills standard format — no conversion needed. |
| Tool availability moves from `allowedTools` to agent frontmatter `tools:`. | The per-agent tool constraint is preserved — it moves from Rust configuration into the agent file. `allowedTools` is not dropped; it is replaced by the OpenHands-native equivalent. |
| Inline research replaces parallel sub-agent fan-out. | OpenHands action-observation loop is sequential. Inline research in one context is simpler, has better cross-dimension coherence, and produces equivalent quality output. The parallel spawning machinery and merge/deduplication logic are removed. |
| Four named agents replace six. | `skill-builder` (router), `research-orchestrator`, `detailed-research`, and `confirm-decisions` are eliminated. `research-agent` and `skill-writer-agent` absorb their responsibilities. |
| Confirm-decisions logic moves into `skill-writer-agent` base instructions. | Step 2 and step 3 are both one-shot calls to `skill-writer-agent`. The step number in the prompt distinguishes the phase. No separate agent file needed. |
| LiteLLM provider strings for multi-model support. | OpenHands routes all LLM calls through LiteLLM. Any provider string (`anthropic/claude-sonnet-4-6`, `openai/gpt-4o`, `google/gemini-2.0-flash`, `ollama/llama3.2`) works without runner changes. Settings adds a provider picker and per-provider API key. |
| `AGENTS.md` is the always-on context file. | Both Claude Code and OpenHands read `AGENTS.md` natively. No change to the always-on instruction layer. |
| `AskUserQuestion` gap is deferred. | Refine streaming depends on a custom interrupt tool. Until it is built, streaming sessions return a clear error. Workflow one-shot steps are unaffected. |

## Runtime Invariants

The app depends on a set of execution contracts that must hold regardless of which runtime is active. These are not Claude-specific — they are Skill Builder's runtime contract with the agent execution layer.

| Contract | Current enforcement | OpenHands enforcement |
|---|---|---|
| One-shot steps cannot interrupt for user input | `AskUserQuestion` absent from `allowedTools` for steps 0–3 | `AskUserQuestion` absent from `tools:` in all workflow step agent frontmatter |
| Structured output is required for steps 0–3 | Prompt instructions; frontend parser validates `run_result` payload | Same prompt instructions; `extractJsonFromText` fallback + `structured_output_missing` retry prompt if first attempt produces invalid JSON |
| Artifact parsing errors are app-visible | Parser emits `run_result` error event over JSONL | Unchanged — same JSONL protocol, same `run_result` envelope |
| Per-step turn budget is enforced | `max_turns` in `SidecarConfig` | `max_iterations` in `RunConfig`, populated from the same `max_turns` field |
| Tool availability is scoped per agent | `allowedTools` in `SidecarConfig`, per step | `tools:` in each agent's frontmatter |

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

Between steps the frontend calls `answer-evaluator` as a discrete agent.

All tool names (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `Agent`, `Skill`, `AskUserQuestion`) are Claude Code-specific. The `allowedTools` list in `step_config.rs` enforces per-step tool access. `permissionMode` is a Claude Code permission concept. Plugin discovery in the sidecar resolves `.claude/plugins/` paths from installed plugin directories.

## Target Architecture

```text
step_config.rs → [agent name per step]
  ├── step 0: research-agent      [research skill, initial pass]
  ├── step 1: research-agent      [research skill, refinement pass]
  ├── step 2: skill-writer-agent  [decisions phase — inline instructions]
  └── step 3: skill-writer-agent  [skill-creator skill]

between 0→1 and 1→2: answer-evaluator (discrete frontend call, unchanged)
```

The sidecar boundary, JSONL protocol, and `run_result`/`display_item` envelope shapes are unchanged. Rust and React do not observe the agent runtime change.

## Agent Model

OpenHands file-based agents live in `.agents/agents/*.md`. Each file has YAML frontmatter and a Markdown body that becomes the system prompt. Agents are registered automatically from that directory at runtime via `register_file_agents()`.

### `research-agent.md`

```markdown
---
name: research-agent
description: >
  Produces clarification questions for skill-building by researching
  relevant dimensions inline and consolidating them into clarifications.json.
  Also handles refinement passes when answer-evaluation.json is present.
tools:
  - file_editor
  - terminal
skills:
  - research
---
```

The body instructs the agent to use the `research` skill. The presence or absence of `answer-evaluation.json` in the workspace context dir tells the agent whether this is an initial research pass (step 0) or a refinement pass (step 1). No separate agent file is needed for refinements.

### `answer-evaluator.md`

No structural change. The agent reads `clarifications.json`, evaluates answer quality, and writes `answer-evaluation.json`. Tool list changes from Claude Code names to `file_editor`.

### `skill-writer-agent.md`

```markdown
---
name: skill-writer-agent
description: >
  Step 2: Analyzes clarification answers and surfaces structured decisions
  for user review. Step 3: Uses the skill-creator skill to write SKILL.md
  and base evals from approved decisions.
tools:
  - file_editor
  - terminal
skills:
  - skill-creator
---
```

The base instructions contain the confirm-decisions logic (currently in `confirm-decisions.md`). The prompt passed for step 2 asks for decisions output. The prompt passed for step 3 asks for skill generation. The `skill-creator` skill is active for step 3 via the `skills:` frontmatter.

### Deleted agents

| Agent file | Reason |
|---|---|
| `skill-content-researcher/agents/skill-builder.md` | Router — eliminated, step routing moves to `step_config.rs` |
| `skill-content-researcher/agents/research-orchestrator` (implicit) | Absorbed into `research-agent` |
| `skill-content-researcher/agents/detailed-research.md` | Absorbed into `research-agent` using same research skill |
| `skill-content-researcher/agents/confirm-decisions.md` | Absorbed into `skill-writer-agent` base instructions |
| `skill-creator/agents/generate-skill.md` | Absorbed into `skill-writer-agent` step 3 |

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

Used by `skill-writer-agent` in step 3. Writes `SKILL.md` and base evals from `decisions.json` and `clarifications.json`. No structural change to the skill's output contract.

### Retained reference files

All dimension reference files (`references/dimensions/*.md`), `references/scoring-rubric.md`, `references/consolidation-handoff.md`, `references/dimension-sets.md`, and `shared/schemas.md` are retained without change.

## Tool Name Mapping

| Claude Code tool | OpenHands equivalent | Notes |
|---|---|---|
| `Read`, `Write`, `Edit` | `file_editor` | Single built-in tool covers all file operations |
| `Glob`, `Grep`, `Bash` | `terminal` | Bash execution covers search and shell operations |
| `Agent`, `Skill` | Not needed | Inline execution replaces sub-agent delegation |
| `AskUserQuestion` | Deferred — custom tool | Required for refine streaming only; not used in one-shot workflow steps |

`allowedTools` in `SidecarConfig` is replaced by `tools:` in agent frontmatter. The per-agent tool constraint is preserved — it moves from Rust configuration into the agent file. `permissionMode` is removed with no equivalent needed: OpenHands does not have a global permission mode; tool access is scoped to each agent's frontmatter declaration. `requiredPlugins` is replaced by `skills:` in agent frontmatter.

## Workflow Step Routing

`step_config.rs` maps step numbers to agent names instead of routing through `skill-builder`. The `required_plugins` field is replaced by the agent's `skills:` frontmatter — the runner resolves skill paths from `.agents/skills/`.

| Step | Agent | Skill | Output file |
|---|---|---|---|
| 0 | `research-agent` | `research` | `context/clarifications.json` |
| — | `answer-evaluator` | — | `answer-evaluation.json` |
| 1 | `research-agent` | `research` | `context/clarifications.json` (refined) |
| — | `answer-evaluator` | — | `answer-evaluation.json` |
| 2 | `skill-writer-agent` | — | `context/decisions.json` |
| 3 | `skill-writer-agent` | `skill-creator` | `SKILL.md` + base evals |

## Multi-Model Support

OpenHands routes all LLM calls through LiteLLM. The `model` field in `SidecarConfig` accepts a LiteLLM provider string. The runner passes it directly to the OpenHands `LLMConfig`.

| Provider | Model string example | API key env var |
|---|---|---|
| Anthropic | `anthropic/claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai/gpt-4o` | `OPENAI_API_KEY` |
| Google | `google/gemini-2.0-flash` | `GEMINI_API_KEY` |
| Ollama (local) | `ollama/llama3.2` | None (base URL) |

Settings UI adds a provider dropdown and per-provider API key field. The `apiKey` field in `SidecarConfig` carries the selected provider's key. A `modelBaseUrl` field is added for local/custom endpoints. Rust emits the appropriate env var to the runner based on the provider prefix.

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

Generated skill artifacts move from `.claude/plugins/<plugin-slug>/` to `.agents/`:

| Current path | Target path |
|---|---|
| `.claude/plugins/<slug>/agents/*.md` | `.agents/agents/*.md` |
| `.claude/plugins/<slug>/skills/*/SKILL.md` | `.agents/skills/*/SKILL.md` |
| `.claude/plugins/<slug>/.claude-plugin/plugin.json` | Not needed — agents and skills are discovered directly |
| `CLAUDE.md` | `AGENTS.md` (already generated; OpenHands and Claude Code both read it) |

`plugin.json` and the `.claude-plugin/` directory are eliminated. Plugin identity is carried by agent and skill frontmatter names.

## AskUserQuestion Gap

`AskUserQuestion` is used only in refine streaming sessions (`stream-session.ts`) and in the `confirm-decisions` agent (now absorbed into `skill-writer-agent`). In `skill-writer-agent`, decisions are returned as structured output and rendered by the frontend without requiring a mid-run interrupt. No blocking question tool is needed for steps 2 or 3.

Refine streaming remains broken until a custom `AskUserQuestion` tool is implemented as a registered OpenHands tool that emits a `refine_question` JSONL event and blocks for an answer. That work is tracked separately.

## What Is Removed

| Artifact | Removed because |
|---|---|
| `@anthropic-ai/claude-agent-sdk` npm package | Runtime replaced by `openhands-runner` binary |
| Claude Code CLI binary in Tauri resources | Replaced by `openhands-runner` |
| `pathToClaudeCodeExecutable` in `SidecarConfig` | Replaced by `resolve_openhands_runner_path` |
| `allowedTools` in `SidecarConfig` and `step_config.rs` | Replaced by `tools:` in agent frontmatter — constraint is preserved, not dropped |
| `permissionMode` in `SidecarConfig` | Claude Code-specific concept with no OpenHands equivalent; per-agent tool scoping via frontmatter covers the same ground |
| `requiredPlugins` in `SidecarConfig` | Replaced by `skills:` in agent frontmatter |
| `.claude/plugins/` output layout | Replaced by `.agents/` |
| `plugin.json` and `.claude-plugin/` | Not needed by OpenHands |
| `skill-builder.md` agent | Router — step routing moves to `step_config.rs` |
| `confirm-decisions.md` agent | Absorbed into `skill-writer-agent` |
| `generate-skill.md` agent | Absorbed into `skill-writer-agent` step 3 |
| Parallel sub-agent spawning instructions | Replaced by inline sequential execution |
| Sub-agent merge and deduplication logic | Not needed with inline execution |
| `options.ts` Claude SDK option builder | Runner builds OpenHands config directly |

## Key Source Files

| File | Purpose |
|---|---|
| `app/sidecar/openhands/runner.py` | OpenHands runner — reads one JSON request, emits JSONL events |
| `app/sidecar/runtime/openhands-runtime.ts` | Spawns runner binary, maps JSONL to runtime sink |
| `app/sidecar/openhands-event-processor.ts` | Maps OpenHands events to sidecar protocol envelopes |
| `app/src-tauri/src/agents/sidecar.rs` | `SidecarConfig` — `allowedTools`, `permissionMode`, `requiredPlugins` removed; `modelBaseUrl` added |
| `app/src-tauri/src/commands/workflow/step_config.rs` | Step-to-agent-name routing table |
| `agent-sources/plugins/skill-content-researcher/agents/` | Agent files to rewrite in OpenHands format |
| `agent-sources/plugins/skill-creator/agents/` | Agent files to rewrite or remove |
| `agent-sources/plugins/skill-content-researcher/skills/research/SKILL.md` | Inline research — sub-agent sections removed |
| `agent-sources/plugins/skill-creator/skills/skill-creator/SKILL.md` | Skill writer — no structural change |
| `docs/design/agent-runtime-boundary/README.md` | Runtime boundary contract (prerequisite) |

## Risks

| Risk | Mitigation |
|---|---|
| `CodeActAgent` structured JSON reliability across non-Claude models | Smoke-test step 0 and step 3 on at least two providers before release cut. The `extractJsonFromText` fallback handles loose JSON. Add a `structured_output_missing` retry prompt if the first attempt fails to produce valid JSON. |
| PyInstaller binary size and startup time | Measure at CI build time. If startup latency is unacceptable, switch to a `uv`-managed venv with a first-launch install step instead. |
| Inline research quality vs parallel sub-agents | The agent has full cross-dimension context in one pass, which may improve coherence. Run a side-by-side eval on 3–5 representative skill topics before shipping. |
| `AskUserQuestion` gap affects refine UX | Clearly communicated in release notes. Refine returns an explicit error message directing users to use workflow mode. |

## Open Questions

1. Should `.agents/` be generated into the user's skills repository or into the app workspace? The current `.claude/plugins/` layout goes into the skills repo so users can version-control agent files. The same should apply to `.agents/`.
2. Should Skill Builder continue generating `CLAUDE.md` alongside `AGENTS.md` during the transition period, or is `AGENTS.md` sufficient?
3. Should the `model` field accept a bare model name (e.g. `claude-sonnet-4-6`) and have the runner infer the provider prefix, or should the Settings UI always emit full LiteLLM provider strings?
