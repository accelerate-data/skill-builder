# Skill Builder Plugin

A Claude Code plugin that orchestrates a multi-agent workflow for building domain-specific skills. Install it, invoke `/generate-skill`, and the coordinator guides you through research, clarification, decisions, generation, and validation.

---

## Plugin Packages

Four installable plugins:

| Plugin | Contents | Customizable |
|---|---|---|
| `skill-builder` | Coordinator skill + 7 agents + workspace-context.md | No |
| `skill-builder-research` | Research skill (dimension scoring, parallel research, consolidation) | Yes — fork to customize dimensions |
| `skill-builder-validate` | Validate skill (quality check, test evaluation, companion recommendations) | Yes — fork to customize quality rules |
| `skill-builder-practices` | Content guidelines (skill structure, patterns, anti-patterns) | Yes — fork to customize for non-dbt stacks |

---

## Package Contents

### skill-builder

```text
.claude-plugin/
  plugin.json
skills/
  generate-skill/
    SKILL.md              ← coordinator (state router + workflow)
agents/
  *.md                    ← 7 agents (see ../agent-specs/)
references/
  workspace-context.md   ← injected inline into every agent Task call
```

### skill-builder-research

```text
.claude-plugin/
  plugin.json
skills/
  research/
    SKILL.md
    references/
      dimension-sets.md
      scoring-rubric.md
      consolidation-handoff.md
      dimensions/
        *.md              ← 18 dimension spec files
```

### skill-builder-validate

```text
.claude-plugin/
  plugin.json
skills/
  validate-skill/
    SKILL.md
    references/
      validate-quality-spec.md
      test-skill-spec.md
      companion-recommender-spec.md
```

### skill-builder-practices

```text
.claude-plugin/
  plugin.json
skills/
  skill-builder-practices/
    SKILL.md
    references/
      ba-patterns.md
      de-patterns.md
```

---

## Coordinator

The coordinator (`skills/generate-skill/SKILL.md`) is a state-aware router. On every invocation: detect state → classify intent → dispatch. For the full agent workflow (reads/writes per step), see [agent-specs](../agent-specs/).

### Working Directory Layout

```text
.vibedata/                    ← plugin internals, never committed
  <skill-name>/
    session.json
    answer-evaluation.json    ← written by answer-evaluator

<skill-dir>/                  ← default: ./<skill-name>/
  SKILL.md
  references/
  context/
    clarifications.md
    decisions.md
    research-plan.md
    agent-validation-log.md
    test-skill.md
    companion-skills.md
```

### session.json

```json
{
  "skill_name": "sales-pipeline",
  "purpose": "domain",
  "skill_dir": "./sales-pipeline/",
  "created_at": "2026-02-22T10:30:00Z",
  "last_activity": "2026-02-22T14:20:00Z",
  "current_phase": "clarification",
  "phases_completed": ["scoping", "research"],
  "mode": "guided",
  "research_dimensions_used": ["entities", "metrics", "business-rules"],
  "clarification_status": { "total_questions": 15, "answered": 8 },
  "auto_filled": false
}
```

### State Detection

Glob `.vibedata/*/session.json` on startup. Scan artifacts bottom-up, first match wins:

| Artifact present | Phase |
|---|---|
| `context/agent-validation-log.md` + `context/test-skill.md` + `context/companion-skills.md` | `validation` |
| `<skill-dir>/SKILL.md` | `generation` |
| `context/decisions.md` | `decisions` |
| `context/clarifications.md` with answered `#### Refinements` | `refinement` |
| `context/clarifications.md` with `#### Refinements` (unanswered) | `refinement_pending` |
| `context/clarifications.md` with any `**Answer:**` filled | `clarification` |
| `context/clarifications.md` with all answers empty | `research` |
| `session.json` only | `scoping` |
| nothing | `fresh` |

Artifact table overrides `session.json.current_phase` when they disagree.

### Intent Classification

| Signal in user message | Intent |
|---|---|
| "build", "create", "new skill", "I need a skill" | `new_skill` |
| "I answered", "continue", "ready", "done" | `resume` |
| "validate" | `validate_only` |
| "improve", "fix", "update", "missing" | `improve` |
| "start over", "start fresh", "reset" | `start_fresh` |
| "skip", "use defaults", "express" | `express` |
| "how does", "what is", "why" | `process_question` |

Default: `resume` when in-progress state exists, `new_skill` otherwise.

### State × Intent Dispatch

| State | Intent | Action |
|---|---|---|
| `fresh` | `new_skill` | → Scoping |
| `fresh` | `new_skill` + purpose in message | → Scoping (pre-fill purpose) |
| `scoping` | `resume` | → Research |
| `research` | `resume` | Show clarification status, prompt to answer |
| `clarification` | `resume` | → answer-evaluator → [detailed-research] → Decisions |
| `refinement_pending` | `resume` | Show refinement status, prompt to answer |
| `refinement` | `resume` | → answer-evaluator → Decisions |
| `decisions` | `resume` | → Generation |
| `generation` | `resume` | → Validation |
| `generation` | `validate_only` | → Validation |
| `validation` | `resume` | Offer: finalize / improve / regenerate |
| any + SKILL.md exists | `improve` | → Iterative |
| any + SKILL.md exists | `validate_only` | → Validation |
| any | `start_fresh` | Delete `.vibedata/<name>/` + `context/` → Scoping |
| any | `express` | Auto-fill empty answers → Decisions |
| any | `process_question` | Answer inline |

### Workflow Modes

| Mode | Trigger | Phase sequence |
|---|---|---|
| `guided` | default | Scoping → Research → Clarification → [Detailed research] → Decisions → Generation → Validation |
| `express` | "express", "skip research", detailed spec in first message | Scoping → Decisions → Generation → Validation |
| `iterative` | SKILL.md exists + "improve"/"fix"/"update" | → Iterative directly |

### Agent Call Format

Every agent call:

```text
Task(
  subagent_type: "skill-builder:<agent>",
  prompt: "
    Purpose: <purpose>
    Skill name: <skill_name>
    Context directory: <context_dir>
    Skill directory: <skill_dir>
    Workspace directory: .vibedata/<skill_name>/

    <agent-instructions>
    {content of $PLUGIN_ROOT/references/workspace-context.md}
    </agent-instructions>

    Return: ..."
)
```

For generate-skill, validate-skill, refine-skill — additionally:

```text
    <skill-practices>
    {content of $PLUGIN_ROOT/references/skill-builder-practices/SKILL.md}
    {content of $PLUGIN_ROOT/references/skill-builder-practices/references/ba-patterns.md}
    {content of $PLUGIN_ROOT/references/skill-builder-practices/references/de-patterns.md}
    </skill-practices>
```

No `TeamCreate`, `TaskCreate`, `SendMessage`, or `TeamDelete`.

---

## Marketplace

The four plugin packages are published to `https://github.com/hbanerjee74/skills`. For the full repo structure and `marketplace.json` schema, see [skills-marketplace design doc](../skills-marketplace/README.md).

**Install:**

```bash
claude plugin marketplace add hbanerjee74/skills
claude plugin install skill-builder
```

---

## Customization

Fork any of the three inner plugins, publish to a private marketplace, install at project scope:

```bash
claude plugin install skill-builder-research --scope project
```

Same plugin name = drop-in replacement. No coordinator changes needed.

---

## Source of Truth

| Source | Plugin |
|---|---|
| `agent-sources/workspace/CLAUDE.md` | `skill-builder/references/workspace-context.md` |
| `agent-sources/workspace/skills/research/` | `skill-builder-research` |
| `agent-sources/workspace/skills/validate-skill/` | `skill-builder-validate` |
| `agent-sources/workspace/skills/skill-builder-practices/` | `skill-builder-practices` |

`scripts/build-plugin-skill.sh` copies all outputs from source.

Agents in the plugin context do not get `.claude/CLAUDE.md` auto-loaded. The coordinator injects `references/workspace-context.md` inline into every agent `Task` call via `<agent-instructions>` tags.
