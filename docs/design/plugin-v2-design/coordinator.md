# Coordinator Design

The coordinator (`skills/generate-skill/SKILL.md`) is a state-aware router. On every invocation: detect state → classify intent → dispatch.

---

## Directory Layout

```
.vibedata/                           ← plugin internals, never committed
  <skill-name>/
    session.json
    answer-evaluation.json           ← written by answer-evaluator

<skill-dir>/                         ← default: ./<skill-name>/
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

---

## session.json

```json
{
  "skill_name": "sales-pipeline",
  "skill_type": "domain",
  "domain": "Sales Pipeline Analytics",
  "skill_dir": "./sales-pipeline/",
  "created_at": "2026-02-22T10:30:00Z",
  "last_activity": "2026-02-22T14:20:00Z",
  "current_phase": "clarification",
  "phases_completed": ["scoping", "research"],
  "mode": "guided",
  "research_dimensions_used": ["entities", "metrics", "business-rules"],
  "clarification_status": {
    "total_questions": 15,
    "answered": 8
  },
  "auto_filled": false
}
```

---

## State Detection

On startup: glob `.vibedata/*/session.json`. For each found, derive `skill_dir` and scan artifacts. Artifact table — scan bottom-up, first match wins:

| Artifact present | Phase completed |
|---|---|
| `context/agent-validation-log.md` + `context/test-skill.md` | `validation` |
| `<skill-dir>/SKILL.md` | `generation` |
| `context/decisions.md` | `decisions` |
| `context/clarifications.md` with answered `#### Refinements` | `refinement` |
| `context/clarifications.md` with `#### Refinements` (unanswered) | `refinement_pending` |
| `context/clarifications.md` with any `**Answer:**` filled | `clarification` |
| `context/clarifications.md` with all answers empty | `research` |
| `session.json` only | `scoping` |
| nothing | `fresh` |

Artifact table overrides `session.json.current_phase` when they disagree.

---

## Intent Classification

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

---

## State × Intent Dispatch

| State | Intent | Action |
|---|---|---|
| `fresh` | `new_skill` | → Scoping |
| `fresh` | `new_skill` + domain in message | → Scoping (pre-fill domain) |
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

---

## Phases

### Scoping (inline — no agent)

1. Ask: skill type, domain, "what does Claude get wrong?" (optional)
2. Derive `skill_name` (kebab-case from domain), confirm with user
3. Create: `.vibedata/<skill-name>/`, `<skill-dir>/`, `<skill-dir>/context/`, `<skill-dir>/references/`
4. Write `session.json`
5. Detect mode
6. → Research (guided) or → Decisions (express)

### Research

```
Task(subagent_type: "skill-builder:research-orchestrator")
Passes: skill_type, domain, context_dir, workspace_dir
```

- Checks `clarifications.md` for `scope_recommendation: true` — surface to user and stop if found
- Tells user: questions are in `<context_dir>/clarifications.md`
- Updates `session.json`

### Clarification Gate (async-capable)

On resume with `clarifications.md` present:

```
Task(subagent_type: "skill-builder:answer-evaluator")
Passes: context_dir, workspace_dir
```

- Reads `answer-evaluation.json` from `.vibedata/<skill-name>/`
- If `empty_count > 0` and user wants auto-fill: copy `**Recommendation:**` → `**Answer:**` for empty fields; set `session.json.auto_filled: true`
- Routes to detailed-research if verdict is not `sufficient`; otherwise → Decisions

### Detailed Research (conditional)

Skipped when `answer-evaluation.json.verdict == "sufficient"`.

```
Task(subagent_type: "skill-builder:detailed-research")
Passes: skill_type, domain, context_dir, workspace_dir
```

- Tells user: refinement questions are in `context/clarifications.md` under `#### Refinements`
- On resume: re-run answer-evaluator for refinement answers → Decisions

### Decisions

```
Task(subagent_type: "skill-builder:confirm-decisions")
Passes: skill_type, domain, context_dir, skill_dir, workspace_dir
```

- Human gate: user reviews `context/decisions.md`
- If corrections: re-spawn with correction embedded in prompt
- Updates `session.json`

### Generation

```
Task(subagent_type: "skill-builder:generate-skill")
Passes: skill_type, domain, skill_name, context_dir, skill_dir, workspace_dir
        + skill-builder-practices content inline
```

- Human gate: user reviews generated structure
- Updates `session.json`

### Validation

```
Task(subagent_type: "skill-builder:validate-skill")
Passes: skill_type, domain, skill_name, context_dir, skill_dir, workspace_dir
        + skill-builder-practices content inline
```

- Writes: `agent-validation-log.md`, `test-skill.md`, `companion-skills.md`
- Offers: finalize / improve section / regenerate

### Iterative

```
Task(subagent_type: "skill-builder:refine-skill")
Passes: skill_dir, context_dir, workspace_dir, skill_type,
        conversation history, current user message
        + skill-builder-practices content inline
```

Supports `/rewrite`, `/validate`, `@file` targeting.

---

## Workflow Modes

| Mode | Trigger | Phase sequence |
|---|---|---|
| `guided` | default | Scoping → Research → Clarification → [Detailed research] → Decisions → Generation → Validation |
| `express` | "express", "skip research", detailed spec in first message | Scoping → Decisions → Generation → Validation |
| `iterative` | SKILL.md exists + "improve"/"fix"/"update" | → Iterative directly |

Mode is detected at Scoping and stored in `session.json.mode`. Explicit mode in user message always wins.

---

## Agent Call Format

Every agent call:

```
Task(
  subagent_type: "skill-builder:<agent>",
  prompt: "
    Skill type: <skill_type>
    Domain: <domain>
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

```
    <skill-practices>
    {content of skill-builder-practices:SKILL.md}
    {content of skill-builder-practices:ba-patterns.md}
    {content of skill-builder-practices:de-patterns.md}
    </skill-practices>
```

No `TeamCreate`, `TaskCreate`, `SendMessage`, or `TeamDelete`.
