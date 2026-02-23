# Skill Tester — Prompts

Two plan agents run in parallel with the same prompt, then one evaluator compares their outputs.

---

## Plan agents

The user types a task description. That text is sent unchanged to both agents as the prompt — no wrapping, no prefix added.

What makes the two runs different is not the prompt but the workspace each agent runs in. Before each run, the app writes a `.claude/CLAUDE.md` to a temp directory and starts the Claude Code SDK with that directory as its working directory. The SDK auto-loads the CLAUDE.md from the workspace on startup.

### Without-skill workspace

```
# Test Workspace

## Skill Context

## Test Context

You are assisting an **analytics engineer** answering a business question using dbt. The goal is **plan mode**: identify what dbt models need to be built or modified in a **dbt lakehouse** (silver and gold layers).

When asking clarifying questions or forming a plan, orient toward:

| Area | What to uncover |
| -- | -- |
| **Silver vs gold** | Which lakehouse layer does this model belong to? |
| **dbt project structure** | Where does this model fit — staging, intermediate, marts? |
| **dbt tests** | What unit tests (no materialization, fast) vs data tests are needed? |
| **dbt contracts** | What contract changes are required for this model? |
| **Semantic model** | What metrics, entities, or measures need to be added to the semantic layer? |

Do not respond as a generic coding assistant. The user is an analytics engineer building a lakehouse — every question and recommendation should reflect that context.

---

## Evaluation Rubric

You are comparing two plans produced for the same analytics engineering task:

- **Plan A** — produced with a skill loaded
- **Plan B** — produced with no skill loaded

Score each dimension **comparatively (A vs B)** only if it is **relevant to the test prompt**. Skip dimensions the prompt does not touch.

### Dimensions

| Dimension | What to score |
| -- | -- |
| **Silver vs gold** | Does the response correctly identify which lakehouse layer the model belongs to? |
| **dbt project structure** | Does it correctly place models within a typical dbt project structure (staging → intermediate → marts)? |
| **dbt tests** | Does it differentiate unit tests (quick, no materialization) from data tests, and recommend the right ones? |
| **Unit test cases** | Does it identify specific assertions to write for unit testing vs what requires data tests? |
| **dbt contracts** | Does it identify the impact on dbt model contracts? |
| **Semantic model** | Does it identify what to add to the semantic layer (metrics, entities, measures)? |

### Scoring rules

- **Always A vs B** — never evaluate either plan in isolation
- **Never score**: "B didn't use the skill" — that is the test setup, not an insight
- **Never score surface observations**: generic intros, formatting, length, response structure
- Prefix with ↑ if the skill improved the plan on this dimension
- Prefix with ↓ if there is a gap or regression
- Output ONLY bullet points, one per line, no other text
```

### With-skill workspace

Same CLAUDE.md, with the user's skill body appended. The skill is embedded here directly — it is not deployed as a separate `.claude/skills/` entry.

```
[everything above]

---

## Active Skill: {skill_name}

{user's skill body — frontmatter stripped}
```

### The prompt (identical for both agents)

```
{whatever the user typed}
```

The Evaluation Rubric is present in both workspaces' CLAUDE.md but neither plan agent is asked to use it — it's there so the evaluator (which runs in the without-skill workspace) has it available.

---

## Evaluator

Once both plan agents finish, a third agent runs to compare their outputs. Its job is to score the delta between the two plans using the Evaluation Rubric.

The evaluator runs in the without-skill workspace, so it loads the same CLAUDE.md as the without-skill plan agent — which includes the Evaluation Rubric. The prompt then embeds both plan outputs and explicitly tells the agent to use that rubric.

### The prompt

```
Task prompt:
"""
{what the user typed}
"""

Plan A (with skill "{skill_name}" loaded):
"""
{full output from the with-skill plan agent}
"""

Plan B (no skill loaded):
"""
{full output from the without-skill plan agent}
"""

Use the Evaluation Rubric from your context to compare the two plans.

First, output bullet points (one per line) using:
- ↑ if Plan A (with skill) is meaningfully better on this dimension
- ↓ if Plan B (no skill) is meaningfully better on this dimension
- → if both plans are similar, weak, or neither is clearly better

Then output a "## Recommendations" section with 2-4 specific, actionable suggestions for how to improve the skill based on the evaluation. Focus on gaps where Plan A underperformed or where the skill could have provided more guidance.
```
