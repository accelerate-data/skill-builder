# research.txt Refactor Plan

**Goal:** Remove stale file references and strip duplicate methodology from
`agent-sources/prompts/research.txt`. The prompt becomes a thin frame; the
`researching-skill-requirements` skill carries all research methodology.

---

## Background

Two changes in VU-1157 made parts of this prompt stale or redundant:

1. `user-context.md` and `clarifications.json` are no longer files on disk.
   Their content is injected inline into prompts via `{{user_context_block}}`
   and `{{clarifications_json}}`. Any prose that tells the agent to read those
   files is now wrong.

2. The `researching-skill-requirements` skill already contains the full
   research methodology (core job, capture intent, purpose-specific lenses,
   scope guard, research/interview guidance, question quality). The prompt
   duplicates much of that content, causing the agent to receive the same
   instructions twice.

3. `"You are in Step 0: Research."` is a UI-navigation label, not a behavioral
   instruction. Prompts must describe what the agent should do, not which step
   of the application UI it is in. This line is removed in Task 0.

**Ownership split after this change:**

| Layer | Owns |
|---|---|
| `research.txt` | Step identity, variables, `{{user_context_block}}`, execution constraints, output schema + structural constraints |
| `researching-skill-requirements` skill | Core job, capture intent, purpose-specific lenses, scope guard logic, research/interview guidance, question quality |

---

## Task 0 — Remove step-identity label

### `research.txt` line 3

Delete:
```
You are in Step 0: Research.
```

The label names a UI step rather than describing agent behavior. The agent's job is fully described by the skill reference, variables, and output schema that follow.

---

## Task 1 — Fix stale file references

### 1a. `research.txt` lines 23–27

Current:
```
Reasoning focus: do not answer user-owned decisions yourself. If the skill
writer needs a decision that is not available from user-context.md, supplied
reference documents, or reliable external documentation, ask a clarification
question. Keep questions focused on information that will materially affect the
future skill.
```

This entire paragraph is deleted in Task 2 (it duplicates the skill). No
separate edit needed — the stale reference disappears with the block.

### 1b. `researching-skill-requirements/SKILL.md` line 27

Current:
```
Start by understanding the user's intent from the available workflow context,
`user-context.md`, the current `clarifications.json` when present, user answers
when present, and any supplied reference documents.
```

Replace with:
```
Start by understanding the user's intent from the available workflow context,
the user context provided inline, the clarifications provided inline when
present, user answers when present, and any supplied reference documents.
```

---

## Task 2 — Strip duplicate content from `research.txt`

Each block below is already fully covered by the named skill section. Delete
it from the prompt.

### 2a. Lines 5–8 — Goal paragraph (covered by skill §Core Job)

Delete:
```
Goal: discover the minimum decisions needed before this skill can be written.
Ask high-value clarification questions that reveal the skill capability,
trigger conditions, domain vocabulary, workflow boundaries, source documents,
expected outputs, edge cases, dependencies, and success criteria.
```

### 2b. Lines 11–13 — Trailing sentence of skill-load instruction

Keep the first sentence. Delete the trailing description of what the skill
carries (the skill speaks for itself):

Keep:
```
Use the `researching-skill-requirements` skill to decide which clarification
questions matter.
```

Delete:
```
The skill carries the purpose-specific research lenses for
business process, source customization, data engineering, and platform
standards.
```

### 2c. Lines 15–27 — Domain lenses + reasoning focus (covered by skill §Purpose-Specific Lenses and §Core Job)

Delete the entire block:
```
When the user context names concrete platform or source-system concepts, preserve
those terms in the clarification questions. For data engineering standards,
questions should cover the relevant modeling, reconciliation, data quality,
dbt, dlt, Fabric Lakehouse, and deployment standards. For source-system
customization, questions should cover the relevant API or export mechanics,
CDC, custom fields, custom status or stage values, schema drift, rate limits,
extraction, ingestion, and transformation behavior.

Reasoning focus: do not answer user-owned decisions yourself. If the skill
writer needs a decision that is not available from user-context.md, supplied
reference documents, or reliable external documentation, ask a clarification
question. Keep questions focused on information that will materially affect the
future skill.
```

### 2d. Lines 29–46 — `## Capture Intent` section (covered by skill §Capture Intent)

Delete the entire section:
```
## Capture Intent

Start by understanding the user's intent from the user context provided above and any supplied
reference documents. The user may need to fill gaps, and should confirm before
proceeding to the next workflow step.

Make sure the clarification set can answer:

- What should this skill enable Claude to do?
- When should this skill trigger? Include expected user phrases and contexts.
- What is the expected output format?
- Should we set up test cases to verify the skill works? ...
```

### 2e. Lines 47–54 — `## Interview And Research` section (covered by skill §Research And Interview)

Delete the entire section:
```
## Interview And Research

Proactively ask questions about edge cases, input and output formats, example files, success criteria, and dependencies. Wait to write test prompts until these decisions are clear enough to avoid weak or misleading evals.

Check available MCPs when useful for research, such as searching docs, finding
similar skills, or looking up best practices. Use parallel research via
subagents if that capability is available; otherwise research inline. Come
prepared with context that reduces the burden on the user.
```

### 2f. Lines 73–77 — Verbose scope guard suppression (covered by skill §Scope Guard)

The skill already contains the full conditions for when to trigger or suppress
the scope guard. Replace the multi-line block with a single step-specific
sentence:

Current:
```
Do not trigger the scope guard merely because the user context is detailed. In
Step 0, produce clarification questions unless the context is missing,
placeholder-only, unrelated to reusable skill behavior, or already explicitly
answers the core intent, trigger, output, test, edge-case, and purpose-specific
decision points needed to write the skill.
```

Replace with:
```
Do not trigger the scope guard merely because the user context is detailed; the full conditions are in the researching-skill-requirements skill.
```

---

## Result — `research.txt` after all edits

```
EXECUTE IMMEDIATELY. Do not greet the user, ask questions, or offer options.

Use the `researching-skill-requirements` skill to decide which clarification
questions matter.

We are writing the skill {{skill_name}}.
Workspace directory: {{workspace_dir}}
Maximum research dimensions before scope warning: {{max_dimensions}}

All directories already exist. Do not create directories with mkdir. Do not list directories with ls.

{{user_context_block}}

Research must run as one inline flow and return only final output.
Do not emit intermediate JSON, markdown summaries, dimensions_selected,
research_plan, research_lens, dimension_scores, selected_dimensions,
topic_relevance, dimensions_evaluated, or consolidation handoff text.

Do not inspect old logs or previous run transcripts as research input. Use only
the user context provided above, any reference documents already listed there,
and external documentation when useful.

Do not trigger the scope guard merely because the user context is detailed; the full conditions are in the researching-skill-requirements skill.

Before returning, read
`.agents/skills/shared/output-schemas/step-0-research.json` and ensure the
final object follows that structural schema. Use
`.agents/skills/shared/schemas.md` for semantic invariants.

Return only a raw JSON object. Use this exact envelope shape:
{
  "status": "research_complete",
  "question_count": 0,
  "research_output": {
    "version": "1",
    "metadata": {
      "question_count": 0,
      "section_count": 0,
      "refinement_count": 0,
      "must_answer_count": 0,
      "priority_questions": [],
      "scope_recommendation": false,
      "scope_reason": null,
      "warning": null,
      "error": null
    },
    "sections": [],
    "notes": [],
    "answer_evaluator_notes": []
  }
}

[... full structural constraints unchanged from line 107 onward ...]
```

Lines removed: ~52 of 145 (36%).

---

## What does NOT change

- `researching-skill-requirements/SKILL.md` body content — the methodology is
  correct; only line 27's file references are updated (Task 1b).
- Lines 64–71 of `research.txt` (no-intermediate-output, no-old-logs) —
  kept as step-specific execution directives, not in the skill.
- Lines 79–145 of `research.txt` (full JSON schema and structural constraints)
  — unchanged; these are step-owned output spec.
- No other prompt files are touched by this change.

---

## Files changed

| File | Change |
|---|---|
| `agent-sources/prompts/research.txt` | Task 0 (remove step label) + Tasks 2a–2f (strip ~52 lines total) |
| `agent-sources/workspace/skills/researching-skill-requirements/SKILL.md` | Task 1b (fix stale refs on line 27) |
