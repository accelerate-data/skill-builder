---
functional-specs: []
---

# OpenHands Agents

> **Status:** Draft
> **Parent:** [README.md](README.md)
> **Functional specs:** Not applicable; this design documents the OpenHands agent identities Skill Builder ships, their wiring, and their runtime contracts.

## Overview

Skill Builder ships exactly two named OpenHands agents. Both live under `agent-sources/workspace/agents/` and reach the runtime through different mechanisms:

| Agent | Role | Wiring mechanism |
|---|---|---|
| `skill-creator` | Main agent identity for every product surface (workflow, refine, scope review, eval scenario suggest). | Compile-time `include_str!` of the markdown body, frontmatter stripped, injected as `agent_context.system_message_suffix`. |
| `skill-verifier` | Fresh-context subagent invoked by the `creating-skills` skill during workflow step 3. | Deployed as a `.md` file under `<workspace_skill_dir>/.agents/agents/` and discovered by the OpenHands SDK at conversation creation; invoked via `task_tool_set`. |

There is no `agent_definitions` payload field on the OpenHands request. Subagent registration is a file-on-disk contract enforced by the deploy step, not a request-time payload.

## Design Scope

**Covers**

- The contract between the markdown source files and the OpenHands runtime request.
- How each agent is loaded, injected, and invoked.
- Per-agent tool exposure constraints.
- The relationship between agent files and the bundled file-based skills they depend on.

**Does not cover**

- Session lifecycle, persistent versus throwaway behavior, or product-surface mapping. See [`../openhands-runtime-model/README.md`](../openhands-runtime-model/README.md).
- The bundled AgentSkills (`creating-skills`, `researching-skill-requirements`, `shared/`). See [openhands-bundled-skills.md](openhands-bundled-skills.md).
- The workflow output JSON contracts. See [canonical-format.md](canonical-format.md).
- Prompt-by-prompt content or wording.

## Key Decisions

| Decision | Rationale |
|---|---|
| Ship one main-agent identity (`skill-creator`) for every persistent and throwaway surface. | A single identity keeps the OpenHands `agent_context` stable across workflow, refine, scope review, and eval scenario generation. Per-step main agents would split the persistent skill conversation. |
| Inject the main-agent prose through `system_message_suffix` rather than `system_prompt` overwrite. | Preserves the OpenHands default system prompt and only appends Skill Builder's stable instructions. The runtime never owns the base system prompt. |
| Embed the main-agent markdown at compile time (`include_str!`). | The agent identity is part of the shipped binary, not a runtime-mutable input. Source edits during dev are picked up by the SHA-gated workspace deploy cache, not by a re-read of the agent file at request time. |
| Deploy `skill-verifier.md` as a file-based agent under `.agents/agents/`. | The SDK auto-discovers file-based agents in this directory at conversation creation; no `agent_definitions` payload is required and no second registration mechanism is introduced. |
| Strip YAML frontmatter from the main-agent markdown before injection. | The frontmatter (`name`, `description`, `tools`, `skills`) is documentation for human authors; sending it as runtime instruction would leak metadata into the LLM context. |
| Gate the system suffix on `agent_name == "skill-creator"`. | Other internal agent names (if any are added later) must not silently inherit the skill-creator persona. |
| The single `skill-creator` identity is a current simplification; separate identities for throwaway versus persistent surfaces is the intended long-term direction. | Throwaway surfaces (scope review, eval scenario suggest) and persistent surfaces (workflow, refine) have diverging prompt needs. A single identity is sufficient today but the split is expected. |
| No per-skill subagent manifest is needed. Any `.md` file under `agent-sources/workspace/agents/` is globally discoverable after deploy. | Discovery is name-based. A skill locates its subagent by name alone; the deploy step does not need to record ownership relationships between skills and the subagents they invoke. |

## `skill-creator` Agent

### Source

`agent-sources/workspace/agents/skill-creator.md`

The frontmatter declares author-facing intent only; the runtime ignores it:

```yaml
name: skill-creator
description: OpenHands-native worker for throwaway and conversational skill-building tasks.
tools:
  - file_editor
  - terminal
  - browser_tool_set
skills:
  - creating-skills
  - researching-skill-requirements
```

The body covers the skill-building stance, the four-stage workflow framing (research, detailed research, confirm decisions, generate skill), task-shape neutrality (validation, research, refinement, evaluation, generation are all valid), and the rule that workspace files are the source of truth for structured output.

### Loading and injection

Compile-time embedding plus runtime stripping happens in `app/src-tauri/src/agents/sidecar.rs`:

- `SKILL_CREATOR_AGENT_MARKDOWN` is `include_str!`-loaded from the repo path.
- `skill_creator_system_message_suffix()` strips the YAML frontmatter (CRLF tolerant, missing closing delimiter tolerant) and trims whitespace.
- `build_openhands_runtime_config()` injects the result into `SidecarConfig.system_message_suffix` only when `params.agent_name == "skill-creator"`.

The OpenHands request builder in `app/src-tauri/src/agents/openhands_server/types.rs` then mirrors that field into `agent_context.system_message_suffix` on the `StartConversationRequest` payload.

### Per-message user suffix

A separate per-turn suffix from `agent-sources/prompts/skill-creator-user-suffix.txt` is appended to user messages via `agent_context.user_message_suffix`. The current literal is one line:

```text
Follow the current user message exactly. Do not infer a different task than the one stated in the message.
```

The suffix is set per call, not per agent. Surfaces opt in:

| Surface | Sets `user_message_suffix`? |
|---|---|
| Workflow research / detailed research / confirm decisions / skill generation | Yes |
| Workflow answer evaluator | Yes |
| Refine | Yes |
| Scope review (throwaway) | Yes |
| Eval scenario suggest | **No** |

Eval scenario suggest deliberately omits the suffix because the scenario-generation prompt is fully self-contained and does not benefit from the "follow the current message exactly" guard.

### Tool exposure

Tool selection is per call, not per agent. The runtime resolves a name allowlist in `openhands_tools()` (`app/src-tauri/src/agents/openhands_server/types.rs`):

| Surface | `allowed_tools` passed in | Effective `agent.tools` after normalization |
|---|---|---|
| Research / detailed research | `file_editor`, `terminal`, `browser_tool_set` | Same plus `task_tool_set` (auto-appended). |
| Confirm decisions | `file_editor` | Same plus `task_tool_set`. |
| Answer evaluator | `file_editor` | Same plus `task_tool_set`. |
| Skill generation | `file_editor`, `terminal` | Same plus `task_tool_set`. |
| Refine | `file_editor`, `terminal` | Same plus `task_tool_set`. |
| Scope review | `file_editor` | Same plus `task_tool_set`. |
| Eval scenario suggest | `file_editor`, `terminal` | Same plus `task_tool_set`. |

`task_tool_set` is unconditionally part of the surface contract because file-based subagent invocation (including `skill-verifier`) depends on it.

`include_default_tools` is constant: `FinishTool`, `ThinkTool`. `InvokeSkillTool` is not listed — the SDK auto-attaches it when `agent_context.skills` is non-empty.

Refer to [`../openhands-runtime-model/tools-included.md`](../openhands-runtime-model/tools-included.md) for the full list of tools the Agent Server registers and for the override-empty-fallback rule.

### Bundled skill dependency

`skill-creator` relies on two AgentSkills being deployed into `<workspace_skill_dir>/.agents/skills/`:

- `creating-skills` — generation and verifier-loop guidance for workflow step 3.
- `researching-skill-requirements` — clarification-quality rules for steps 0 and 1.

Deployment is owned by `app/src-tauri/src/commands/workflow/deploy.rs` (two-tier SHA-gated copy). Discovery into the request payload is owned by `discover_agentskills()` in `openhands_server/types.rs`. See [openhands-bundled-skills.md](openhands-bundled-skills.md) for the per-skill contract.

### Task routing

The same agent identity handles every operation. The differentiator is `task_kind` and the prompt template:

| Operation | `task_kind` | Prompt template (`agent-sources/prompts/`) |
|---|---|---|
| Step 0 research | `workflow.research` | `research.txt` |
| Step 1 detailed research | `workflow.detailed_research` | `detailed-research.txt` |
| Workflow answer evaluator | `workflow.answer_evaluator` | `answer-evaluator.txt` |
| Step 2 confirm decisions | `workflow.confirm_decisions` | `confirm_decisions.txt` |
| Step 3 generate skill | `workflow.skill_generation` | `skill-generation.txt` |
| Refine turn | `refine` | (caller-provided message; no template) |
| Scope review | `scope_review` | `scope-review.txt` |
| Eval scenario suggest | `scenario-suggest` | `eval-workbench-suggest-scenario.txt` |

`task_kind` is metadata only — it does not change the agent identity, system suffix, or available tools beyond what the surface explicitly passes.

## `skill-verifier` Agent

### Source

`agent-sources/workspace/agents/skill-verifier.md`

The frontmatter declares the verifier's tool set:

```yaml
name: skill-verifier
description: Fresh-context verifier for generated skill packages during workflow step 3.
tools:
  - file_editor
  - terminal
```

The body defines the review focus (trigger frontmatter, when-to-use clarity, brief preservation, executable guidance, no lifecycle actions, no legacy-agent dependence), the severity model, and the pass/needs_fix JSON return shape.

### Loading and invocation

The verifier never reaches the OpenHands request as a payload field. The deploy step copies `skill-verifier.md` into `<workspace>/.agents/agents/skill-verifier.md` (and into every per-skill `<workspace_skill_dir>/.agents/agents/`) so that the OpenHands SDK can discover it as a file-based agent at conversation creation time. The `creating-skills` skill then launches it via `task_tool_set` — fresh context, separate from the generator's accumulated turn history.

Source paths:

- Deploy: `app/src-tauri/src/commands/workflow/deploy.rs::copy_workspace_agents_to_openhands_layout`
- Invocation guidance: `agent-sources/workspace/skills/creating-skills/SKILL.md` plus `agent-sources/workspace/skills/creating-skills/references/verifier-subagent-prompt.md`

### Return contract

The verifier returns a JSON object in one of two shapes:

```json
{ "status": "pass", "findings": [] }
```

```json
{
  "status": "needs_fix",
  "findings": [
    {
      "severity": "material",
      "file": "SKILL.md",
      "finding": "Concise issue description.",
      "recommendation": "Concrete change needed."
    }
  ]
}
```

Severity is `material` (would fail the skill, omit a confirmed requirement, include a forbidden lifecycle action, or depend on legacy machinery) or `minor` (wording, organization, polish).

The `creating-skills` skill consumes this JSON, applies fixes, runs at most one re-verification pass, and folds the verifier into a `call_trace` entry on the step 3 output.

## States

```text
agent_name resolved
  -> "skill-creator" -> system suffix injected, AgentSkills deployed
  -> any other       -> no system suffix; current code never reaches this branch

verifier requested
  -> file present at .agents/agents/skill-verifier.md -> SDK discovers, task_tool_set can invoke
  -> file missing                                      -> task_tool_set has no verifier; skill returns skipped
```

## Relationship To Existing Design Specs

| Spec | Relationship |
|---|---|
| [README.md](README.md) | Parent agent-specs index. |
| [openhands-bundled-skills.md](openhands-bundled-skills.md) | Defines the AgentSkills `skill-creator` depends on. |
| [canonical-format.md](canonical-format.md) | Defines the JSON output contracts these agents produce per workflow step. |
| [`../openhands-runtime-model/README.md`](../openhands-runtime-model/README.md) | Owns session lifecycle, persistent vs throwaway, and product-surface mapping. |
| [`../openhands-runtime-model/tools-included.md`](../openhands-runtime-model/tools-included.md) | Owns the registered-tool registry and default tool policy. |
| [`../openhands-model-settings/README.md`](../openhands-model-settings/README.md) | Owns the `llm` config the runtime projects onto requests these agents serve. |

## Key Source Files

| File | Purpose |
|---|---|
| `agent-sources/workspace/agents/skill-creator.md` | Main-agent identity prose. |
| `agent-sources/workspace/agents/skill-verifier.md` | File-based subagent prose. |
| `agent-sources/prompts/skill-creator-user-suffix.txt` | Per-turn user-message suffix. |
| `app/src-tauri/src/agents/sidecar.rs` | `include_str!` of skill-creator.md, frontmatter strip, suffix injection. |
| `app/src-tauri/src/agents/openhands_server/types.rs` | Mirrors suffixes and skills into `agent_context`; resolves tool name allowlist. |
| `app/src-tauri/src/commands/workflow/deploy.rs` | Two-tier SHA-gated deploy of `agent-sources/workspace/{agents,skills}/` into workspace `.agents/`. |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Builds workflow `SidecarConfig`s with `agent_name = "skill-creator"`. |
| `app/src-tauri/src/commands/refine/mod.rs` | Refine turn dispatch. |
| `app/src-tauri/src/commands/skill/scope_review.rs` | Scope review throwaway dispatch. |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Eval scenario suggest dispatch. |
