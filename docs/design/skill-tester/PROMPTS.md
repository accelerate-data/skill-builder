# Skill Tester — Prompts

Two plan agents run in parallel, then one evaluator compares their outputs.

---

## Workspaces

Before each run, `prepare_skill_test` (Rust) creates two temp directories under `$TMPDIR/skill-builder-test-{uuid}/`:

```text
baseline/
  .claude/
    CLAUDE.md          ← "# Test Workspace"
    skills/
      skill-test/      ← copied from bundled resources

with-skill/
  .claude/
    CLAUDE.md          ← "# Test Workspace"
    skills/
      skill-test/      ← copied from bundled resources
      {skill_name}/    ← copied from skills_path/{skill_name}/
```

`skill-test` is read from the **bundled skills dir** (`resolve_bundled_skills_dir`), not the workspace copy. This makes it immune to the skill being toggled inactive in the workspace.

The SDK starts with each directory as its `cwd` and auto-loads `.claude/CLAUDE.md` and `.claude/skills/` on startup — no inline embedding needed.

---

## Plan agents

Both agents run in parallel and receive the same wrapped prompt:

```text
You are a data engineer and the user is trying to do the following task:

{whatever the user typed}
```

The difference between the two runs is entirely in what the SDK loads from each workspace.

---

## Evaluator

Once both plan agents complete, a third agent runs in the **baseline** workspace (so it loads `skill-test` context including the Evaluation Rubric). It receives the raw user prompt (not the wrapped version) and both plan outputs:

```text
Task prompt:
"""
{whatever the user typed}
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

The evaluator does **not** receive the skill content — it judges the output, not the intent.

---

## skill-test content

`skill-test` is a bundled skill with two sections loaded by agents in both workspaces:

- **Test Context** — orients plan agents as analytics engineers working in a dbt lakehouse in plan mode. Defines five focus areas: silver vs gold layer, dbt project structure, dbt tests, dbt contracts, semantic model.
- **Evaluation Rubric** — used only by the evaluator. Six scoring dimensions, comparative-only rules (A vs B, no surface observations), ↑/↓ output format.

See [`docs/design/skills/README.md`](../skills/README.md) for the full skill-test spec.
