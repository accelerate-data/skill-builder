---
name: building-skills
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

```text
PLUGIN_ROOT = $CLAUDE_PLUGIN_ROOT
```

Directory layout:

```text
.vibedata/                    ← plugin internals, never committed
  <skill-name>/
    session.json
    user-context.md           ← written by coordinator during Scoping (Turn 2)
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

On startup: glob `.vibedata/*/session.json`. For each found, derive `skill_dir` from `session.json.skill_dir` and scan artifacts. Artifact table — scan top-to-bottom, first match wins (validation has highest priority, fresh is lowest):

| Artifact present | Phase |
|---|---|
| `context/agent-validation-log.md` + `context/test-skill.md` + `context/companion-skills.md` | `validation` |
| `context/agent-validation-log.md` + `context/test-skill.md` (no companion-skills.md) | `validation` |
| `<skill-dir>/SKILL.md` | `generation` |
| `context/decisions.md` | `decisions` |
| `context/clarifications.md` with answered `#### Refinements` | `refinement` |
| `context/clarifications.md` with `#### Refinements` (unanswered) | `refinement_pending` |
| `context/clarifications.md` with any `**Answer:**` filled | `clarification` |
| `context/clarifications.md` with all answers empty AND `session.json.interactive_questions_asked` non-empty | `clarification_interactive_pending` |
| `context/clarifications.md` with all answers empty | `research` |
| `session.json` only | `scoping` |
| nothing | `fresh` |

Check each row strictly, top-to-bottom. Use the first row where ALL artifact conditions are met. Stop immediately — do not continue checking lower rows. Examples:

- `SKILL.md` exists but no `agent-validation-log.md` → **generation** (not validation)
- `decisions.md` AND `SKILL.md` both exist → **generation** (SKILL.md row comes first)
- `decisions.md` exists but no `SKILL.md` → **decisions**

Artifact table overrides `session.json.current_phase` when they disagree. If multiple `.vibedata/*/session.json` files exist, ask the user which skill to continue.

---

## Intent Classification

| Signal in user message | Intent |
|---|---|
| "build", "create", "new skill", "I need a skill" | `new_skill` |
| "I answered", "continue", "ready", "done" | `resume` |
| "my answers are", "here are my answers", "answer above", "for Q" | `resume` |
| "validate" | `validate_only` |
| "improve [X] section", "update the [X] section", "fix [X] in", "add [X] to [section]" when SKILL.md exists | `targeted_edit` |
| "regenerate everything", "rewrite the whole skill", "redo from scratch" when SKILL.md exists | `full_rewrite` |
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
| `validation` | `new_skill` | → Scoping (pre-fill domain from message if present) |
| non-fresh, non-validation | `new_skill` | Guard: "You're currently in [phase] for [skill-name]. Say 'start over' to close this session first, then ask again to build [domain]." Do not start a new workflow. |
| `scoping` | `resume` | If `.vibedata/<skill-name>/user-context.md` does not exist: parse user message as user-context answers → write user-context.md → Research. Otherwise → Research |
| `research` | `resume` | Show clarification status, prompt to answer |
| `clarification_interactive_pending` | `resume` | → Capture Inline Answers |
| `clarification` | `resume` | → answer-evaluator → [detailed-research] → Decisions |
| `refinement_pending` | `resume` | Show refinement status, prompt to answer |
| `refinement` | `resume` | → answer-evaluator → Decisions |
| `decisions` | `resume` | → Generation |
| `generation` | `resume` | → Validation |
| `generation` | `validate_only` | → Validation |
| `validation` | `resume` | Offer: finalize / improve / regenerate |
| any + SKILL.md exists | `targeted_edit` | → Iterative (targeted) |
| any + SKILL.md exists | `full_rewrite` | → Iterative (full rewrite) |
| any + SKILL.md exists | `improve` | → Iterative |
| any + SKILL.md exists | `validate_only` | → Validation |
| any | `start_fresh` | Confirm reset, delete `.vibedata/<name>/` + `context/`, tell user session cleared → Scoping |
| `clarification_interactive_pending` | `express` | Auto-fill empty answers → Clarification Gate → Decisions |
| any | `express` | Tell user: "Switching to express mode — filling in recommended answers and skipping ahead to decisions." Auto-fill empty `**Answer:**` fields with their `**Recommendation:**` values → Decisions |
| any | `process_question` | Answer inline. When asked about current phase or state, always state the phase name explicitly: "The current phase is [phase-name]." Use exact names: fresh, scoping, research, clarification, refinement_pending, refinement, decisions, generation, validation. |

---

## Phases

### Scoping (inline — no agent)

1. Ask: purpose (platform / domain / source / data-engineering), skill topic, and optionally "what does Claude typically get wrong in this area?"
2. Derive `skill_name` (kebab-case from domain), confirm with user
3. Create directories: `.vibedata/<skill-name>/`, `<skill-dir>/`, `<skill-dir>/context/`, `<skill-dir>/references/`
   - Default `skill_dir`: `~/skill-builder/<skill-name>/`. Ask user only if they mention a different location.
4. Write `.vibedata/<skill-name>/session.json`:

   ```json
   {
     "skill_name": "<skill-name>",
     "purpose": "<purpose>",
     "skill_dir": "~/skill-builder/<skill-name>/",
     "created_at": "<ISO timestamp>",
     "last_activity": "<ISO timestamp>",
     "current_phase": "scoping",
     "phases_completed": [],
     "mode": "<guided|express>",
     "research_dimensions_used": [],
     "clarification_status": { "total_questions": 0, "answered": 0 },
     "auto_filled": false,
     "interactive_questions_asked": [],
     "interactive_questions_answered": false,
     "iterative_history": []
   }
   ```

5. Detect mode from user message (express if "express"/"skip research"/detailed spec provided)
6. If express mode: → Decisions (skip user-context collection)
   If guided mode: ask the following questions conversationally and **end the turn** (do not dispatch yet):

   ```text
   Before starting research, I'd like to understand your context so the research is tailored to your needs:

   1. What industry is this skill for?
   2. What is your function or role?
   3. Who is the target audience for this skill?
   4. What are the key challenges this skill should address?
   5. What should this skill cover in terms of scope?
   6. What makes your setup unique vs. standard implementations?
   7. What does Claude most often get wrong in this domain?

   Feel free to skip any that aren't relevant.
   ```

   When the user responds (next invocation, `scoping | resume`): parse their answers from the message, write `.vibedata/<skill-name>/user-context.md`:

   ```markdown
   # User Context

   - **Industry**: {answer}
   - **Function**: {answer}
   - **Target Audience**: {answer}
   - **Key Challenges**: {answer}
   - **Scope**: {answer}
   - **What Makes This Setup Unique**: {answer}
   - **What Claude Gets Wrong**: {answer}
   ```

   Skip any field with an empty or skipped answer. Then → Research.

### Research

```text
Task(subagent_type: "skill-builder:research-orchestrator")
Passes: purpose, context_dir, workspace_dir
```

- After agent returns: check `context/clarifications.md` for `scope_recommendation: true` in frontmatter — if found, surface to user and stop
- Read `context/clarifications.md` frontmatter.
  - If `priority_questions` list exists and has 1+ entries:
    - Read the full question block for each Q-ID (up to 4) from `clarifications.md`
    - Present conversationally:

      ```text
      Before you open the full question set, let me ask the most important ones:

      **Q1: [question title]**
      [question body]
      A. [choice A]
      B. [choice B]
      C. [choice C]
      D. Other (please specify)

      [repeat for each priority question]

      Answer above. I'll capture your responses and write the remaining questions to clarifications.md.
      ```

    - Update `session.json`: set `interactive_questions_asked` to the Q-IDs shown (e.g. `["Q1", "Q4", "Q7"]`), `current_phase = "research"`, append `"research"` to `phases_completed`
    - End turn — wait for user response
  - If `priority_questions` is empty or absent:
    - Tell user: questions are in `<context_dir>/clarifications.md` — fill in `**Answer:**` fields and say "done" when ready
    - Update `session.json`: `current_phase = research`, append `research` to `phases_completed`

### Capture Inline Answers (inline — no agent)

Triggered when state = `clarification_interactive_pending`.

1. Read `session.json` to get `interactive_questions_asked` (the list of Q-IDs presented, e.g. `["Q1", "Q4", "Q7"]`)
2. Parse the current user message to match answers to Q-IDs:
   - Explicit: "Q1: A", "first one: B", "1. weighted pipeline"
   - Positional: if user gives comma-separated answers, map to Q-IDs in order
   - Accept letter (A/B/C/D) or prose verbatim
   - If no answers can be matched: re-display the questions and ask the user to answer them, or say "use defaults" to proceed with recommendations.
   - Do not update session.json or clarifications.md until at least one answer is captured.
3. For each matched Q-ID: edit `context/clarifications.md`
   - Locate `### Q{n}:` heading
   - Find its `**Answer:**` line
   - Fill in the user's answer text after the colon
4. Update `session.json`:
   - `interactive_questions_answered`: true
   - `current_phase`: "research" (so the artifact-based detection takes over cleanly)
   - append "research" to `phases_completed`
5. Count remaining unanswered questions (question_count minus interactive ones already answered)
6. Tell user:
   "Got it — I've pre-filled your [N] answers. [M] more questions are in `[context_dir]/clarifications.md`. Answer when ready, or say 'use defaults' to proceed with recommendations."
7. Next invocation: state detected as `clarification` (some answers filled), Clarification Gate runs normally

### Clarification Gate

On resume from `clarification` state:

```text
Task(subagent_type: "skill-builder:answer-evaluator")
Passes: context_dir, workspace_dir
```

- Read `answer-evaluation.json` from `.vibedata/<skill-name>/`
- If `empty_count > 0` and user wants auto-fill: copy each empty `**Answer:**` from its question's `**Recommendation:**` value; set `session.json.auto_filled = true`
- If `verdict != "sufficient"` → Detailed Research
- If `verdict == "sufficient"` → Decisions

### Detailed Research (conditional)

Skipped when `answer-evaluation.json.verdict == "sufficient"`.

```text
Task(subagent_type: "skill-builder:detailed-research")
Passes: purpose, context_dir, workspace_dir
```

- Tell user: refinement questions added under `#### Refinements` in `context/clarifications.md` — answer them and say "done"
- On resume (`refinement` state): re-run answer-evaluator → Decisions

### Decisions

```text
Task(subagent_type: "skill-builder:confirm-decisions")
Passes: purpose, context_dir, skill_dir, workspace_dir
```

- Human gate: tell user decisions are in `context/decisions.md` — review and confirm or provide corrections
- If corrections: re-spawn confirm-decisions with correction text embedded in prompt
- Update `session.json`: `current_phase = decisions`, append `decisions` to `phases_completed`

### Generation

```text
Task(subagent_type: "skill-builder:generate-skill")
Passes: purpose, skill_name, context_dir, skill_dir, workspace_dir
        + skill-builder-practices content inline (see Agent Call Format)
```

- Human gate: relay generated structure to user, ask for confirmation or changes
- Update `session.json`: `current_phase = generation`, append `generation` to `phases_completed`

### Validation

```text
Task(subagent_type: "skill-builder:validate-skill")
Passes: purpose, skill_name, context_dir, skill_dir, workspace_dir
        + skill-builder-practices content inline (see Agent Call Format)
```

- Agent writes: `context/agent-validation-log.md`, `context/test-skill.md`, `context/companion-skills.md`
- Relay results summary to user
- Read `context/companion-skills.md` if present; check `companions` list in YAML frontmatter. If non-empty, present each companion conversationally — name, type, priority, and reason
- Offer options: finalize / improve a section (→ Iterative) / regenerate (→ Generation). If companions were presented, also offer: "Or say 'build the [name] skill' to start a new workflow for a companion skill."
- On finalize: tell user skill is ready at `<skill-dir>`

### Iterative

```text
Task(subagent_type: "skill-builder:refine-skill")
Passes: skill_dir, context_dir, workspace_dir, purpose,
        current user message (the improvement request)
        + skill-builder-practices content inline (see Agent Call Format)
```

- Supports `/rewrite` (full rewrite), `/validate` (re-run validation), `@file` (target specific file)
- After agent returns: ask user to review changes, offer further iterations or validation

**Targeted edit path (`targeted_edit` intent):**
Before dispatching: emit "Starting a targeted iterative edit of the [section] section — will refine and then validate the skill."

1. Glob `<skill_dir>/references/*.md` to find the reference file whose name best matches the section named in the user message. Append `@<filename>` to the user message passed to refine-skill so edits are constrained to that file. If no reference file closely matches, omit the `@` annotation and pass the user message as-is.
2. After refine-skill returns, automatically spawn validate-skill.
3. Append to `session.json.iterative_history`:

   ```json
   { "timestamp": "<ISO>", "type": "targeted", "description": "<section name>" }
   ```

**Full rewrite path (`full_rewrite` intent):**
Before dispatching: emit "Starting a full rewrite of the entire skill from scratch — will regenerate and validate."

1. Prepend `/rewrite` to the user message passed to refine-skill (it delegates to generate-skill + validate-skill internally).
2. Append to `session.json.iterative_history`:

   ```json
   { "timestamp": "<ISO>", "type": "full_rewrite", "description": "full rewrite" }
   ```

### Moving the Skill Directory

If the user reports they moved the skill dir, or asks to relocate it:

1. Confirm the new path with the user
2. Move the skill directory: `mv <old-skill-dir> <new-skill-dir>`
3. Update `session.json.skill_dir` to the new path
4. Confirm to the user: "Skill directory moved to `<new-skill-dir>`. Session updated."

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

For generate-skill, validate-skill, and refine-skill — also read and inject the skill-builder-practices content:

```text
    <skill-practices>
    {content of $PLUGIN_ROOT/references/skill-builder-practices/SKILL.md}
    {content of $PLUGIN_ROOT/references/skill-builder-practices/references/ba-patterns.md}
    {content of $PLUGIN_ROOT/references/skill-builder-practices/references/de-patterns.md}
    </skill-practices>
```

No `TeamCreate`, `TaskCreate`, `SendMessage`, or `TeamDelete`.
