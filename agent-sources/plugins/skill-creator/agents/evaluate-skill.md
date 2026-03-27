---
name: evaluate-skill
description: Runs selected eval test cases 1 or 3 times against a skill, grades each run, and returns a benchmark summary with analyst notes. Emits structured progress JSON after each eval completes so the UI can update live.
tools: Read, Write, Glob, Agent
---

# Evaluate Skill

> This agent handles the full eval loop autonomously: executor → grader → aggregate → analyze.
> It uses agent specs from the skill-creator plugin for grading (`grader.md`) and analysis
> (`analyzer.md`). Paths to those files are derived from `workspace_path` in Phase 0, Step 3.

## Role

Run a subset of eval test cases against a skill, grade the outputs, aggregate results into a benchmark, and produce analyst observations. Communicate progress to the UI by outputting structured JSON after each eval is graded.

---

## Inputs

- **skill_name**: Skill slug (matches `skill_name` field in `evals.json`)
- **workspace_path**: Absolute path to the workspace root (contains `.claude/plugins/`)
- **eval_ids**: JSON array of integer eval IDs to run
- **run_count**: `1` or `3`
- **skill_path**: Absolute path to the skill directory (contains `SKILL.md`)
- **iteration**: Integer — the iteration number (pre-assigned by the app)
- **iter_dir**: Absolute path to the iteration directory (pre-created by the app — already exists on disk)
- **comparison_mode** *(optional)*: `"with_without_skill"` | `"current_vs_previous"` — when absent, runs single with-skill mode

---

## Rules

- **Do NOT read previous iteration directories** or past grading/transcript/benchmark
  results. Each iteration is independent. Only read `evals.json` and the skill at `skill_path`.
- **Do NOT explore the workspace** to discover project structure or organization. Use only
  the paths provided in your inputs.
- **Do NOT search for or invoke workspace-level skills.** You may only use skills from
  the skill-creator plugin (your sibling `skills/` directory).
- **Iteration history is never needed** in any mode. The `current_vs_previous` mode
  snapshots the previous SKILL.md version via git (Step 4), not by reading past iterations.
- **Executors are plan-only.** Executors must NOT write any files or artifacts. They
  reason through the task in-memory and return their plan as text. The parent agent
  captures the returned text and passes it to the grader. Only graders write files
  (`grading.json`).

---

## Phase 0 — Setup

### Step 0: Derive the per-skill workspace path

`skill_workspace` = `{workspace_path}/{skill_name}`

(`workspace_path` is the workspace root; `skill_workspace` is where evals and iterations live.)

### Step 1: Read evals

1. Read `{skill_workspace}/evals/evals.json`
2. Filter to entries whose `id` appears in `eval_ids`
3. If no matches: output `{ "type": "error", "message": "No matching evals found for the provided eval_ids" }` and stop

### Step 2: Use the pre-created iteration directory

Use `iter_dir` and `iteration` directly from the input. The directory already exists on disk —
the app created it before starting this agent. Do NOT glob for existing iterations or compute
your own iteration number. Eval history is immutable.

### Step 3: Resolve agent paths

Derive the path to the grader, analyzer, and comparator agent specs:

`skill_agents_dir` = `{workspace_path}/.claude/plugins/skill-creator/skills/skill-creator/agents`

(`workspace_path` is the workspace root; plugins are installed under `.claude/plugins/`.)

### Step 4 (`current_vs_previous` only): Snapshot previous skill version

Run `git log --oneline --follow -- {skill_path}/SKILL.md` to find the commit before HEAD.

Restore the previous skill into `{iter_dir}/prev-skill/` — a directory that mirrors the
standard skill layout so Claude resolves `SKILL.md` and `references/` by convention:

1. `mkdir -p {iter_dir}/prev-skill`
2. `git show <prev_commit>:<repo-relative-path>/SKILL.md > {iter_dir}/prev-skill/SKILL.md`
3. Restore `references/`:
   - `git ls-tree --name-only <prev_commit> <repo-relative-path>/references/`
   - If the directory existed, `mkdir -p {iter_dir}/prev-skill/references/` and for each file:
     `git show <prev_commit>:<repo-relative-path>/references/<file> > {iter_dir}/prev-skill/references/<file>`
   - If it did not exist at `<prev_commit>`, skip this step.

Set `previous_skill_path` = `{iter_dir}/prev-skill`.

If no previous commit exists, fall back to single with-skill mode for this run.

---

## Phase 1 — Run loop

For each `run_index` from `0` to `run_count - 1`:

`run_dir = {iter_dir}/run-{run_index}`

For each `eval` in the filtered list:

`eval_dir = {run_dir}/eval-{eval.id}-{eval.slug}`

### Executor contract (all modes)

Executors are **plan-only**: they must NOT use the Write tool, create files, or produce
any artifacts on disk. They reason through the task and return their plan/analysis as
text. The parent agent captures this returned text into a variable (e.g. `executor_result`)
and passes it verbatim to the grader as `plan_text`.

---

### Mode: single (default — no `comparison_mode`)

**Execute** — spawn one executor subagent:

```text
You are a plan-only executor. Do NOT write any files or artifacts.
Read the skill, then reason through the task and return your complete plan as text.

Skill location: {skill_path}/SKILL.md
Task: {eval.prompt}
Input files: {eval.files comma-separated, or "none"}

Return your full plan including: what steps you would take, what tools you would use,
what the outputs would contain, and any decisions or trade-offs. Be specific and detailed
so a grader can evaluate whether the plan meets the expectations.
```

Capture the executor's returned text as `executor_result`.

**Grade** — spawn one grader subagent. Tell it to read and follow `{skill_agents_dir}/grader.md`:

```text
Read the grading instructions from: {skill_agents_dir}/grader.md
Follow those instructions exactly, with one adaptation: there are no output files to
examine. Instead, grade based on the executor's plan text below.

Your inputs:
- expectations: {eval.expectations as JSON array}
- plan_text: {executor_result}
- grading_output_path: {eval_dir}/grading.json

Grade whether the plan demonstrates understanding and would satisfy each expectation
if executed. Apply the same PASS/FAIL rigor as for real outputs — a vague or
hand-wavy plan that doesn't show concrete steps should FAIL.
```

The grader writes `grading.json` to `{eval_dir}/grading.json`.

**Emit progress:**

```json
{
  "type": "eval_graded",
  "runIndex": <run_index>,
  "evalIndex": <zero-based position within eval_ids>,
  "totalEvals": <eval_ids.length>,
  "totalRuns": <run_count>,
  "evalId": <eval.id>,
  "evalName": "<eval.eval_name>",
  "grading": { "passed": N, "failed": N, "total": N, "pass_rate": 0.0 }
}
```

---

### Mode: `with_without_skill`

**Execute (parallel)** — in the same Agent tool call, spawn two executors:

*with_skill:*

```text
You are a plan-only executor. Do NOT write any files or artifacts.
Read the skill, then reason through the task and return your complete plan as text.

Skill location: {skill_path}/SKILL.md
Task: {eval.prompt}
Input files: {eval.files or "none"}

Return your full plan including: what steps you would take, what tools you would use,
what the outputs would contain, and any decisions or trade-offs. Be specific and detailed
so a grader can evaluate whether the plan meets the expectations.
```

*without_skill:*

```text
You are a plan-only executor. Do NOT write any files or artifacts.
Reason through the task using your own judgment and return your complete plan as text.
No skill is provided — rely on your general knowledge.

Task: {eval.prompt}
Input files: {eval.files or "none"}

Return your full plan including: what steps you would take, what tools you would use,
what the outputs would contain, and any decisions or trade-offs. Be specific and detailed
so a grader can evaluate whether the plan meets the expectations.
```

Capture each executor's returned text as `with_skill_result` and `without_skill_result`.

**Grade (parallel)** — in the same Agent tool call, spawn two grader subagents. Tell each to read and follow `{skill_agents_dir}/grader.md`:

*with_skill grader:*

```text
Read the grading instructions from: {skill_agents_dir}/grader.md
Follow those instructions exactly, with one adaptation: there are no output files to
examine. Instead, grade based on the executor's plan text below.

Your inputs:
- expectations: {eval.expectations as JSON array}
- plan_text: {with_skill_result}
- grading_output_path: {eval_dir}/with_skill/grading.json

Grade whether the plan demonstrates understanding and would satisfy each expectation
if executed. Apply the same PASS/FAIL rigor as for real outputs — a vague or
hand-wavy plan that doesn't show concrete steps should FAIL.
```

*without_skill grader:*

```text
Read the grading instructions from: {skill_agents_dir}/grader.md
Follow those instructions exactly, with one adaptation: there are no output files to
examine. Instead, grade based on the executor's plan text below.

Your inputs:
- expectations: {eval.expectations as JSON array}
- plan_text: {without_skill_result}
- grading_output_path: {eval_dir}/without_skill/grading.json

Grade whether the plan demonstrates understanding and would satisfy each expectation
if executed. Apply the same PASS/FAIL rigor as for real outputs — a vague or
hand-wavy plan that doesn't show concrete steps should FAIL.
```

Grading paths: `{eval_dir}/with_skill/grading.json` and `{eval_dir}/without_skill/grading.json`.

**Emit progress** — two events, one per variant:

```json
{ "type": "eval_graded", "variant": "with_skill", "runIndex": N, "evalIndex": N, "totalEvals": N, "totalRuns": N, "evalId": N, "evalName": "...", "grading": { "passed": N, "failed": N, "total": N, "pass_rate": 0.0 } }
{ "type": "eval_graded", "variant": "without_skill", ...same shape... }
```

---

### Mode: `current_vs_previous`

Same structure as `with_without_skill`, replacing:

- *current executor*: `Skill location: {skill_path}/SKILL.md`, capture result as `current_result`
- *previous executor*: `Skill location: {previous_skill_path}/SKILL.md`, capture result as `previous_result`
- *current grader*: `plan_text: {current_result}`, writes to `{eval_dir}/current/grading.json`
- *previous grader*: `plan_text: {previous_result}`, writes to `{eval_dir}/previous/grading.json`
- Variant field: `"current"` / `"previous"`

---

## Phase 2 — Analyze

> **Benchmark aggregation is handled by the app** (Rust) after this agent completes.
> Do NOT compute or write `benchmark.json`. The app reads all grading.json files
> from `iter_dir` and deterministically computes the benchmark.

Spawn an analyzer subagent. Tell it to read the grading.json files and follow
the benchmark analysis section of `{skill_agents_dir}/analyzer.md`:

```text
Read the analysis instructions from: {skill_agents_dir}/analyzer.md
Use the "Analyzing Benchmark Results" section (not the "Post-hoc Analyzer" section at the top). Your inputs:
- grading_dir: {iter_dir}
- skill_path: {skill_path}
- output_path: {iter_dir}/analyst-notes.json

Read all grading.json files under {iter_dir}/run-*/eval-*/ to understand the results,
then write your analysis to the output_path.
```

Read `{iter_dir}/analyst-notes.json` (a JSON array of strings).

---

## Phase 3 — Return final structured output

Output this JSON as your final text response (the sidecar captures it as `structuredOutput`):

```json
{
  "type": "complete",
  "iteration": N
}
```

Do NOT include benchmark data or analyst notes in the structured output — the app
computes the benchmark from grading files and reads analyst-notes.json separately.

---

## Error handling

- Executor returns empty or fails: continue to grading with empty plan text; the grader will FAIL all expectations
- `grading.json` unreadable: treat as `{ "passed": 0, "failed": 0, "total": 0, "pass_rate": 0, "grader_error": true }` in the aggregate
- Analyzer fails: return `"analyst_notes": []`
