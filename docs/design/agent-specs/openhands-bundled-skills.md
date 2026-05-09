---
functional-specs: []
---

# Bundled OpenHands AgentSkills

> **Status:** Draft
> **Parent:** [README.md](README.md)
> **Functional specs:** Not applicable; this design documents the file-based AgentSkills Skill Builder ships and how they reach the OpenHands runtime.

## Overview

Skill Builder ships file-based AgentSkills under `agent-sources/workspace/skills/`. The deploy step copies them into the workspace layout, the runtime discovers them at conversation creation time, and the OpenHands SDK lists them under `<available_skills>` so the main agent can load them on demand through `InvokeSkillTool`.

The current bundle:

| Skill | Purpose | Deployed as AgentSkill? |
|---|---|---|
| `creating-skills` | Generation and verifier-loop guidance for workflow step 3. | Yes — `SKILL.md` present. |
| `researching-skill-requirements` | Clarification-quality rules for workflow steps 0 and 1. | Yes — `SKILL.md` present. |
| `shared/` | Cross-skill reference material (semantic invariants, generated JSON Schemas). | No — directory has no `SKILL.md`; ignored by skill discovery. |

`shared/` exists because the JSON-schema files and semantic-invariant doc must travel alongside the skills that consume them, but the SDK's auto-attach contract operates per-directory on the presence of `SKILL.md`.

## Design Scope

**Covers**

- The deploy contract from `agent-sources/workspace/skills/` to `<workspace_skill_dir>/.agents/skills/`.
- The discovery contract that turns deployed `SKILL.md` files into `agent_context.skills` entries.
- Per-skill responsibilities, inputs, and outputs.
- The role of `shared/` and how it relates to `canonical-format.md`.

**Does not cover**

- The agent files (`skill-creator.md`, `skill-verifier.md`). See [openhands-agents.md](openhands-agents.md).
- The workflow output JSON contracts. See [canonical-format.md](canonical-format.md).
- Session lifecycle and runtime primitives. See [`../openhands-runtime-model/README.md`](../openhands-runtime-model/README.md).
- The eval generation prompt or its scenario shape.

## Key Decisions

| Decision | Rationale |
|---|---|
| Discover AgentSkills by walking `<workspace_skill_dir>/.agents/skills/<dir>/SKILL.md` at conversation creation, not by request-time configuration. | The SDK's auto-load path covers user/public/org skills; project-scoped skills under `.agents/skills/` are not auto-loaded, so the runtime surfaces them in the request payload explicitly. Walking on every conversation creation keeps the request consistent with the deployed bundle even when source edits land mid-session. |
| Treat the `SKILL.md` frontmatter (`name`, `description`, `version`) as the runtime contract; everything else in `SKILL.md` is body text the SDK passes to the agent. | The SDK exposes only frontmatter fields when listing `<available_skills>`. Frontmatter is the trigger surface; body is loaded only when the agent invokes the skill. |
| Keep `shared/` outside the SkillSet contract. | `shared/` holds semantic invariants and JSON-Schema artifacts that supplement the skills. Promoting it to an AgentSkill would expose schema metadata as model-loadable instructions, which is wrong: schemas are validation contracts, not behavior. |
| Do not bundle eval cases or trigger-prompt drafts inside the bundled skills. | Eval Workbench owns scenario authoring after a skill exists. Skill bodies stay focused on capability/trigger/process guidance. |
| No per-skill subagent manifest is needed. Any `.md` under `agent-sources/workspace/agents/` is globally discoverable after deploy. | Skills locate subagents by name; the deploy step does not need to express ownership between a skill and the subagents it invokes. |
| Run the generator/verifier loop entirely inside the `creating-skills` skill via `task_tool_set`. | The verifier needs a fresh context to catch reasoning the generator has already passed; launching from inside the skill keeps the generator/verifier handshake out of the orchestrator and bounds the verification loop to one re-pass. |

## Deployment Contract

`app/src-tauri/src/commands/workflow/deploy.rs` runs a two-tier SHA-gated copy:

1. **Tier 1**: `agent-sources/workspace/{agents,skills}/` → `<workspace>/.agents/{agents,skills}/`. Fires when the SHA over the source dirs changes.
2. **Tier 2**: `<workspace>/.agents/` → `<workspace>/{plugin_slug}/skills/{skill_name}/.agents/`. Fires per skill_dir when the workspace-root SHA changes.

Both tiers preserve the source layout, so `.agents/skills/creating-skills/SKILL.md`, `.agents/skills/creating-skills/references/verifier-subagent-prompt.md`, and `.agents/skills/researching-skill-requirements/SKILL.md` all land under the per-skill workspace.

`shared/` is copied as a directory (no `SKILL.md`, so the discovery walk skips it). Other AgentSkills can reference its files by relative path.

## Discovery Contract

`discover_agentskills(workspace_skill_dir)` in `app/src-tauri/src/agents/openhands_server/types.rs`:

- walks `<workspace_skill_dir>/.agents/skills/<dir>/`
- skips directories with no `SKILL.md` (case-insensitive match for `SKILL.md` / `skill.md`)
- parses minimal YAML frontmatter (`name`, `description`, `version`); CRLF tolerant; tolerates missing closing delimiter
- builds `OpenHandsSkill { name, content, is_agentskills_format: true, source, description, version, resources }`
- emits `resources.references`, `resources.scripts`, `resources.assets` from sibling directories under the skill root

The result becomes `agent_context.skills` on the `StartConversationRequest`. When the list is non-empty the SDK auto-attaches `InvokeSkillTool`, so the main agent can call any discovered skill. When the list is empty the runtime logs a warning and `InvokeSkillTool` does not attach.

## Per-Skill Specs

### `creating-skills`

Source: `agent-sources/workspace/skills/creating-skills/SKILL.md`

Trigger surface (frontmatter description): used when the caller has gathered enough requirements and confirmed decisions to generate a durable, reusable skill package.

Body owns:

- the input contract (caller-provided generation brief, output directory, supporting workflow artifacts)
- the rule that confirmed decisions outweigh earlier clarifications
- the generation contract (write `SKILL.md` first, keep references focused, no eval cases or trigger-prompt drafts)
- the fresh-context verifier loop: launch the named `skill-verifier` subagent via `task_tool_set` with input from `references/verifier-subagent-prompt.md`; one re-verification pass max
- the return contract (raw JSON requested by the caller, with a `call_trace` entry covering generation and verification)

References shipped alongside the skill:

| File | Purpose |
|---|---|
| `references/verifier-subagent-prompt.md` | Verifier instruction body, severity model, and JSON output contract that `creating-skills` injects when launching `skill-verifier`. |

Consumed by: workflow step 3 (`workflow.skill_generation`).

### `researching-skill-requirements`

Source: `agent-sources/workspace/skills/researching-skill-requirements/SKILL.md`

Trigger surface (frontmatter description): used when deciding what to research and what clarification questions to ask so user intent, trigger conditions, examples, edge cases, dependencies, and guardrails inform skill creation or refinement.

Frontmatter sets `user_invocable: false` because this skill is the agent's clarification-quality guide, not something the user invokes by name.

Body owns:

- the core job: produce high-value clarification questions whose answers materially change the future skill
- the intent-capture surface (user context, prior clarifications, prior answers, references)
- eight invariants that constrain what the agent must not ask (no output formats, no eval design, no harness platform concerns, no file-format questions outside source/ingestion skills, no reporting-format questions outside analytics skills, etc.)
- defaults for data-platform skill assumptions
- purpose-specific lenses (business process, data engineering standards, source system semantics) and their drop rules
- the scope-guard rule for insufficient or out-of-scope context
- the candidate-question quality bar
- the clarifications model: top-level sections in initial research, append-only refinements in detailed research, choice and "Other" rules

Consumed by: workflow step 0 (`workflow.research`) and workflow step 1 (`workflow.detailed_research`). The step prompts own the exact JSON envelope, schema reference, and merge behavior; this skill owns the question-quality content.

### `shared/`

Source: `agent-sources/workspace/skills/shared/`

Not an AgentSkill. Two artifact families:

| Path | Purpose |
|---|---|
| `shared/schemas.md` | Semantic invariants enforced on top of the JSON-schema structural contracts in `canonical-format.md`. Covers version pin, metadata count consistency, ID patterns, refinement nesting, notes/evaluator-notes separation, warning/error channels, research-flow privacy, orchestrator envelope, and minimal-output rules for guard/error paths. |
| `shared/output-schemas/step-0-research.json`, `step-1-detailed-research.json`, `step-2-decisions.json` | Generated structural schemas referenced by step prompts. The Rust contract structs in `app/src-tauri/src/contracts/` are authoritative; these files exist so prompts can cite the structural shape inline. |

`canonical-format.md` documents the structural contracts; `shared/schemas.md` documents what the schemas cannot enforce.

## States

```text
SKILL.md present in source
  -> deploy copies into .agents/skills/<skill>/SKILL.md
  -> discovery includes in agent_context.skills
  -> SDK auto-attaches InvokeSkillTool
  -> agent can invoke the skill on demand

SKILL.md absent from a directory under skills/ (e.g. shared/)
  -> deploy copies the directory (no SKILL.md filter)
  -> discovery skips the directory
  -> directory still readable by other skills via relative paths

SKILL.md present but agent_context.skills empty (e.g. workspace not yet bootstrapped)
  -> runtime logs a warning
  -> InvokeSkillTool does not auto-attach
  -> the agent cannot invoke any AgentSkill for that turn
```

## Relationship To Existing Design Specs

| Spec | Relationship |
|---|---|
| [README.md](README.md) | Parent agent-specs index. |
| [openhands-agents.md](openhands-agents.md) | Defines the agent identity that depends on these skills. |
| [canonical-format.md](canonical-format.md) | Defines the structural JSON contracts; `shared/schemas.md` is its semantic-invariant partner. |
| [`../openhands-runtime-model/README.md`](../openhands-runtime-model/README.md) | Owns workspace ownership and `.agents/` deploy location. |

## Key Source Files

| File | Purpose |
|---|---|
| `agent-sources/workspace/skills/creating-skills/SKILL.md` | Generator + verifier-loop guidance. |
| `agent-sources/workspace/skills/creating-skills/references/verifier-subagent-prompt.md` | Verifier subagent input template. |
| `agent-sources/workspace/skills/researching-skill-requirements/SKILL.md` | Clarification-quality rules. |
| `agent-sources/workspace/skills/shared/schemas.md` | Semantic invariants for research output. |
| `agent-sources/workspace/skills/shared/output-schemas/*.json` | Generated structural schemas referenced by step prompts. |
| `app/src-tauri/src/agents/openhands_server/types.rs` | `discover_agentskills`, `parse_skill_md`, frontmatter scalar parser. |
| `app/src-tauri/src/commands/workflow/deploy.rs` | Two-tier SHA-gated deploy of skills into `.agents/skills/`. |
| `app/src-tauri/src/contracts/clarifications.rs` | Authoritative struct backing `step-0-research.json` and `step-1-detailed-research.json`. |
| `app/src-tauri/src/contracts/decisions.rs` | Authoritative struct backing `step-2-decisions.json`. |
