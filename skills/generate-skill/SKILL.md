---
name: generate-skill
description: Generate domain-specific Claude skills through a guided multi-agent workflow. Use when user asks to create, build, or generate a new skill for data/analytics engineers. Orchestrates research, clarification, decision-making, skill generation, and validation phases with human review gates. Also use when the user mentions "new skill", "skill builder", or "create a domain skill".
---

# Skill Builder — Coordinator

You are the coordinator for the Skill Builder workflow. On every invocation: detect state → classify intent → dispatch.

## Contents
- [Path Resolution]
- [State Detection]
- [Intent Classification]
- [State × Intent Dispatch]
- [Phases]
- [Workflow Modes]
- [Agent Call Format]

---

## Path Resolution

```
PLUGIN_ROOT = $CLAUDE_PLUGIN_ROOT
```

Directory layout:

```
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

---

## State Detection

On startup: glob `.vibedata/*/session.json`. For each found, derive `skill_dir` from `session.json.skill_dir` and scan artifacts. Artifact table — scan bottom-up, first match wins:

| Artifact present | Phase |
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

Artifact table overrides `session.json.current_phase` when they disagree. If multiple `.vibedata/*/session.json` files exist, ask the user which skill to continue.

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

1. Ask: skill type (platform / domain / source / data-engineering), domain/topic, and optionally "what does Claude typically get wrong in this area?"
2. Derive `skill_name` (kebab-case from domain), confirm with user
3. Create directories: `.vibedata/<skill-name>/`, `<skill-dir>/`, `<skill-dir>/context/`, `<skill-dir>/references/`
4. Write `.vibedata/<skill-name>/session.json`:
   ```json
   {
     "skill_name": "<skill-name>",
     "skill_type": "<skill-type>",
     "domain": "<domain>",
     "skill_dir": "./<skill-name>/",
     "created_at": "<ISO timestamp>",
     "last_activity": "<ISO timestamp>",
     "current_phase": "scoping",
     "phases_completed": [],
     "mode": "<guided|express>",
     "research_dimensions_used": [],
     "clarification_status": { "total_questions": 0, "answered": 0 },
     "auto_filled": false
   }
   ```
5. Detect mode from user message (express if "express"/"skip research"/detailed spec provided)
6. → Research (guided) or → Decisions (express)

### Research

```
Task(subagent_type: "skill-builder:research-orchestrator")
Passes: skill_type, domain, context_dir, workspace_dir
```

- After agent returns: check `context/clarifications.md` for `scope_recommendation: true` in frontmatter — if found, surface to user and stop
- Tell user: questions are in `<context_dir>/clarifications.md` — fill in `**Answer:**` fields and say "done" when ready
- Update `session.json`: `current_phase = research`, append `research` to `phases_completed`

### Clarification Gate

On resume from `clarification` state:

```
Task(subagent_type: "skill-builder:answer-evaluator")
Passes: context_dir, workspace_dir
```

- Read `answer-evaluation.json` from `.vibedata/<skill-name>/`
- If `empty_count > 0` and user wants auto-fill: copy each empty `**Answer:**` from its question's `**Recommendation:**` value; set `session.json.auto_filled = true`
- If `verdict != "sufficient"` → Detailed Research
- If `verdict == "sufficient"` → Decisions

### Detailed Research (conditional)

Skipped when `answer-evaluation.json.verdict == "sufficient"`.

```
Task(subagent_type: "skill-builder:detailed-research")
Passes: skill_type, domain, context_dir, workspace_dir
```

- Tell user: refinement questions added under `#### Refinements` in `context/clarifications.md` — answer them and say "done"
- On resume (`refinement` state): re-run answer-evaluator → Decisions

### Decisions

```
Task(subagent_type: "skill-builder:confirm-decisions")
Passes: skill_type, domain, context_dir, skill_dir, workspace_dir
```

- Human gate: tell user decisions are in `context/decisions.md` — review and confirm or provide corrections
- If corrections: re-spawn confirm-decisions with correction text embedded in prompt
- Update `session.json`: `current_phase = decisions`, append `decisions` to `phases_completed`

### Generation

```
Task(subagent_type: "skill-builder:generate-skill")
Passes: skill_type, domain, skill_name, context_dir, skill_dir, workspace_dir
        + skill-builder-practices content inline (see Agent Call Format)
```

- Human gate: relay generated structure to user, ask for confirmation or changes
- Update `session.json`: `current_phase = generation`, append `generation` to `phases_completed`

### Validation

```
Task(subagent_type: "skill-builder:validate-skill")
Passes: skill_type, domain, skill_name, context_dir, skill_dir, workspace_dir
        + skill-builder-practices content inline (see Agent Call Format)
```

- Agent writes: `context/agent-validation-log.md`, `context/test-skill.md`, `context/companion-skills.md`
- Relay results summary to user
- Offer three options: finalize / improve a section (→ Iterative) / regenerate (→ Generation)
- On finalize: tell user skill is ready at `<skill-dir>`

### Iterative

```
Task(subagent_type: "skill-builder:refine-skill")
Passes: skill_dir, context_dir, workspace_dir, skill_type,
        current user message (the improvement request)
        + skill-builder-practices content inline (see Agent Call Format)
```

- Supports `/rewrite` (full rewrite), `/validate` (re-run validation), `@file` (target specific file)
- After agent returns: ask user to review changes, offer further iterations or validation

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

Every agent call uses this base structure. Read `$PLUGIN_ROOT/references/workspace-context.md` and inject inline:

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

For generate-skill, validate-skill, and refine-skill — also read and inject the skill-builder-practices content:

```
    <skill-practices>
    {content of $PLUGIN_ROOT/references/skill-builder-practices/SKILL.md}
    {content of $PLUGIN_ROOT/references/skill-builder-practices/references/ba-patterns.md}
    {content of $PLUGIN_ROOT/references/skill-builder-practices/references/de-patterns.md}
    </skill-practices>
```

No `TeamCreate`, `TaskCreate`, `SendMessage`, or `TeamDelete`.
