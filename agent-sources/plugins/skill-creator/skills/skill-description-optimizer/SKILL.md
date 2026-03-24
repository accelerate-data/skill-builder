---
name: skill-description-optimizer
description: Optimizes a skill's trigger description for better accuracy. Use when the user wants to improve how reliably their skill triggers — generate eval queries, review them, run the optimization loop, and apply the best description. Use this skill whenever the user mentions description accuracy, trigger rate, false positives, false negatives, or wants to tune when their skill fires, even if they don't say "optimize description" explicitly.
compatibility: Requires `uv` and the `claude` CLI on PATH.
---

# Skill Description Optimizer

<role>

Your role is to optimize a skill's trigger description for better triggering accuracy. You do NOT create, evaluate, or modify the skill's instructions — only its `description` frontmatter field.

</role>

---

<pluggable>

Before any script invocation, read `references/pluggable.md` in this skill directory. All script paths and asset paths in these instructions come from that file. Never hardcode paths to skill-creator scripts — the pluggable binding may change.

</pluggable>

---

<context>

## Inputs

- `skill_path`: absolute path to the skill directory containing `SKILL.md`
- `project_root`: repo root containing `.claude/` (required by `run_loop.py`)
- `model`: the model ID powering this session (from your system prompt)

Derive `skill_name` from the directory name of `skill_path`.
Save workspace artifacts to `<skill_path>/../<skill-name>-workspace/`.

</context>

---

<instructions>

## Step 1: Resolve pluggable

Read `references/pluggable.md`. Resolve `SCRIPTS_ROOT` and `ASSETS_ROOT` to absolute paths
using the path resolution instructions in that file.

## Step 2: Generate trigger eval queries

```bash
uv run "$SCRIPTS_ROOT/generate_eval_queries.py" \
  --skill-path <skill_path> \
  --model <model> \
  --count 20
```

Parse `{"ok": true, "queries": [...]}`. Show the user the query list with counts (N should-trigger,
M should-not-trigger) and ask them to review before continuing.

## Step 3: Review with user

**Claude Code (filesystem available):**

1. Read `$ASSETS_ROOT/eval_review.html`
2. Replace the three placeholders (see `references/pluggable.md` → Asset Interfaces)
3. Write to a temp file and open it: `open /tmp/eval_review_<skill-name>.html`
4. User edits queries and clicks "Export Eval Set"
5. Read from `~/Downloads/` — take the most recent `eval_set*.json`

**Headless / no browser:**

Present queries inline as a numbered list. User confirms, edits inline, or requests changes.

Save the final query set to `<workspace>/trigger-evals.json`.

## Step 4: Run optimization loop

Tell the user: "This will take a few minutes — running the optimization loop now."

```bash
uv run "$SCRIPTS_ROOT/run_loop.py" \
  --eval-set <workspace>/trigger-evals.json \
  --skill-path <skill_path> \
  --project-root <project_root> \
  --model <model> \
  --max-iterations 5 \
  --verbose
```

The output is JSONL. Periodically tail it to report progress to the user: iteration N,
current train score, current test score.

## Step 5: Apply result

Parse `best_description` from the final `{"type": "result", ...}` line.

Show the user:

- Current description vs `best_description`
- Train and test scores per iteration

If the user approves: update the `description:` field in `<skill_path>/SKILL.md` frontmatter.
If the user declines: present the runner-up descriptions from `history` for their choice.

</instructions>

---

<output>

Report: iterations run, final train score, final test score, whether the description was updated.

</output>
