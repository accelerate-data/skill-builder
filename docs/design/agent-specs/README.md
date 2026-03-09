# Agent Architecture

## Two-layer model

The workflow runs on two layers:

**App-bundled agents** (`agents/`) — one agent per workflow step. Agents read context files from disk; for JSON-contract steps they return structured payloads and Rust materializes files after validation. Tied to the app release cycle.

**Bundled skills** (`agent-sources/workspace/skills/`) — pure computation units. No file I/O, no path knowledge. Each skill receives inputs inline, runs its logic (including spawning sub-agents via `Task`), and returns results as delimited inline text:

```text
=== SECTION NAME ===
[full content]
=== NEXT SECTION ===
[full content]
```

The calling agent (or backend materializer, for JSON-contract paths) extracts each section/payload and writes files to disk. Skills are marketplace-updatable — teams can replace them without an app release.

Two agents delegate to skills:

- `research-orchestrator` → `skills/research/` (dimension scoring, parallel research, consolidation)
- `validate-skill` → `skills/validate-skill/` (quality check, test evaluation, companion recommendations)

---

## Workflow

| Step | Agent | Reads | Writes |
| --- | --- | --- | --- |
| 0 | `research-orchestrator` (→ research skill) | [user-context.md](canonical-format.md#canonical-user-contextmd-format) | [clarifications.json](canonical-format.md#canonical-clarificationsjson-format) |
| 1 | `detailed-research` | [clarifications.json](canonical-format.md#canonical-clarificationsjson-format), [answer-evaluation.json](canonical-format.md#canonical-answer-evaluationjson-format) | [clarifications.json](canonical-format.md#canonical-clarificationsjson-format) (adds refinements) |
| 2 | `confirm-decisions` | [clarifications.json](canonical-format.md#canonical-clarificationsjson-format) | [decisions.json](canonical-format.md#canonical-decisionsjson-format) |
| 3 | `generate-skill` | [decisions.json](canonical-format.md#canonical-decisionsjson-format) | `SKILL.md`, `references/`, `context/evaluations.md` |

`answer-evaluator` runs as a gate check before advancing from steps 0 and 1 — it is not a numbered step.

JSON contract write path:

- Steps 0, 1, and 2 return structured payloads.
- Rust validates payload shape and writes canonical files.
- `answer-evaluator` follows the same structured-output pattern for `answer-evaluation.json`.
- For Step 0 and Step 1, the SDK `structuredOutput` schema must use the same canonical clarifications schema as `agent-sources/plugins/skill-content-researcher/skills/research/references/schemas.md`.

Step-level structured payload keys:

- Step 0 (`research-orchestrator`): envelope includes `research_output` carrying canonical clarifications JSON.
- Step 1 (`detailed-research`): envelope includes `clarifications_json` carrying canonical clarifications JSON.

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
Written by `answer-evaluator` as a gate check before advancing from steps 0 and 1. Contains structured evaluation of the user's answers to clarification questions — gap analysis, contradiction detection, and readiness signal. Read by `detailed-research` (step 1) to guide targeted refinement generation. Format: [canonical-format.md](canonical-format.md#canonical-answer-evaluationjson-format).

---

## Contract Audit Snapshot (2026-03)

| Contract area | Prompt/runtime state | Documentation state | Status |
| --- | --- | --- | --- |
| Clarifications artifact type | Agents + runtime use `clarifications.json` | Canonical spec now defines `clarifications.json` | aligned |
| Decisions artifact type | Agents + runtime use `decisions.json` | Canonical spec now defines `decisions.json` | aligned |
| Structured-output materialization | Steps 0/1/2 + gate evaluator validated/written by backend | This page now documents backend materialization path | aligned |
| Workflow step outputs | Step 3 writes `SKILL.md`, `references/`, and `context/evaluations.md` | Workflow table includes all three outputs | aligned |
| `answer-evaluation.json` consumers | Used by `detailed-research` | Infrastructure note reflects `detailed-research` only | aligned |
| Mock transcript fixtures | Some sidecar mock transcripts still include legacy `clarifications.md`/`decisions.md` wording in sample text | Not yet fully normalized in fixtures/docs | follow-up |

## Remediation Plan

1. Normalize remaining legacy `clarifications.md` / `decisions.md` wording in sidecar mock transcript templates.
2. Add/extend tests to flag new legacy transcript references automatically.
3. Keep this page and `canonical-format.md` synchronized whenever agent I/O contracts change.
