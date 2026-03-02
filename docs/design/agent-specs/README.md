# Agent Architecture

## Two-layer model

The workflow runs on two layers:

**App-bundled agents** (`agents/`) — one agent per workflow step. Each owns file I/O: it reads context files from disk, does its work, and writes output files. Tied to the app release cycle.

**Bundled skills** (`agent-sources/workspace/skills/`) — pure computation units. No file I/O, no path knowledge. Each skill receives inputs inline, runs its logic (including spawning sub-agents via `Task`), and returns results as delimited inline text:

```text
=== SECTION NAME ===
[full content]
=== NEXT SECTION ===
[full content]
```

The calling agent extracts each section and writes the files to disk. Skills are marketplace-updatable — teams can replace them without an app release.

Two agents delegate to skills:

- `research-orchestrator` → `skills/research/` (dimension scoring, parallel research, consolidation)
- `validate-skill` → `skills/validate-skill/` (quality check, test evaluation, companion recommendations)

---

## Workflow

| Step | Agent | Reads | Writes |
|---|---|---|---|
| 0 | `research-orchestrator` (→ research skill) | [user-context.md](canonical-format.md#canonical-user-contextmd-format) | [research-plan.md](canonical-format.md#canonical-research-planmd-format), [clarifications.json](canonical-format.md#canonical-clarificationsjson-format) |
| 1 | `detailed-research` | [clarifications.json](canonical-format.md#canonical-clarificationsjson-format), [answer-evaluation.json](canonical-format.md#canonical-answer-evaluationjson-format) | [clarifications.json](canonical-format.md#canonical-clarificationsjson-format) (adds refinements) |
| 2 | `confirm-decisions` | [clarifications.json](canonical-format.md#canonical-clarificationsjson-format) | [decisions.md](canonical-format.md#canonical-decisionsmd-format) |
| 3 | `generate-skill` | [decisions.md](canonical-format.md#canonical-decisionsmd-format) | `SKILL.md`, `references/` |

`answer-evaluator` runs as a gate check before advancing from steps 0 and 1 — it is not a numbered step.

Canonical format for every artifact: [canonical-format.md](canonical-format.md).

Storage layout (workspace, skills path, database, file ownership, startup sequence): [storage.md](storage.md).

---

## Infrastructure Files

Files that span multiple steps or are written by infrastructure rather than agents.

**`{workspace}/{skill}/user-context.md`**
Written by Rust before each agent step (desktop app) or by the plugin coordinator at the end of Scoping Turn 2 (plugin). Contains skill name, purpose, description, tags, industry, function, and free-form context (what Claude needs to know). Agents read it from disk at the start of each step. This dual-source design keeps agent prompts identical across both frontends.

**`{workspace}/{skill}/logs/{step}-{timestamp}.jsonl`**
One file per agent run. Written by the Rust sidecar as the agent executes — each line is a JSON object capturing the full SDK conversation: prompt, assistant messages, tool use, and tool results. The first line is a config object (API key redacted). Used for debugging; inspect with `tail -f` or any JSONL viewer.

**`{skills_path}/{skill}/context/answer-evaluation.json`**
Written by `answer-evaluator` as a gate check before advancing from steps 0 and 1. Contains structured evaluation of the user's answers to clarification questions — gap analysis, contradiction detection, and readiness signal. Read by `detailed-research` (step 1) and `confirm-decisions` (step 2) to guide their work. Format: [canonical-format.md](canonical-format.md#canonical-answer-evaluationjson-format).
