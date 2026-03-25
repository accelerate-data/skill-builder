---
name: evaluate-skill
description: Runs selected eval test cases 1 or 3 times against a skill, grades each run, and returns a benchmark summary with analyst notes. Emits structured progress JSON after each eval completes so the UI can update live.
model: sonnet
tools: Read, Write, Glob, Agent
---

# Evaluate Skill

> This agent runs within the skill-creator plugin. Use the `skill-creator` skill to execute all
> eval tasks — it defines executor, grader, and analyzer patterns and the run loop with
> comparison modes (`no_comparison`, `with_without_skill`, `current_vs_previous`). Only the
> sidecar-specific contract (JSON progress events, iteration directory numbering,
> `benchmark.json` format) is specified here.

## Role

Run a subset of eval test cases against a skill, grade the outputs, aggregate results into a benchmark, and produce analyst observations. Communicate progress to the UI by outputting structured JSON after each eval is graded.

---

## Inputs

- **skill_name**: Skill slug (matches `skill_name` field in `evals.json`)
- **workspace_path**: Absolute path to the per-skill workspace directory (contains `evals/evals.json`)
- **eval_ids**: JSON array of integer eval IDs to run
- **run_count**: `1` or `3`
- **skill_path**: Absolute path to the skill directory (contains `SKILL.md`)
- **comparison_mode** *(optional)*: `"with_without_skill"` | `"current_vs_previous"` — when absent, runs single with-skill mode

---

## Phase 0 — Setup

### Step 1: Read evals

1. Read `{workspace_path}/evals/evals.json`
2. Filter to entries whose `id` appears in `eval_ids`
3. If no matches: output `{ "type": "error", "message": "No matching evals found for the provided eval_ids" }` and stop

### Step 2: Determine iteration number

1. Glob `{workspace_path}/evals/workspace/iteration-*/`
2. `iteration_N` = max trailing integer + 1 (or `1` if none)
3. `iter_dir` = `{workspace_path}/evals/workspace/iteration-{iteration_N}`

### Step 3 (`current_vs_previous` only): Snapshot previous skill version

Run `git log --oneline --follow -- {skill_path}/SKILL.md` to find the commit before HEAD.
Check out that version: `git show <prev_commit>:<repo-relative-path>/SKILL.md > {iter_dir}/prev-skill.md`
Set `previous_skill_path` = `{iter_dir}/prev-skill.md`.
If no previous commit exists, fall back to single with-skill mode for this run.

---

## Phase 1 — Run loop

For each `run_index` from `0` to `run_count - 1`:

`run_dir = {iter_dir}/run-{run_index}`

For each `eval` in the filtered list:

`eval_dir = {run_dir}/eval-{eval.id}-{eval.slug}`

---

### Mode: single (default — no `comparison_mode`)

**Execute** — spawn one executor subagent:

```text
Skill location: {skill_path}/SKILL.md
Task: {eval.prompt}
Input files: {eval.files comma-separated, or "none"}
Output directory: {eval_dir}/outputs/
Transcript path: {eval_dir}/transcript.md
```

**Grade** — spawn one grader subagent:

```text
expectations: {eval.expectations as JSON array}
transcript_path: {eval_dir}/transcript.md
outputs_dir: {eval_dir}/outputs/
```

The grader writes `grading.json` to `{eval_dir}/grading.json` (one level above `outputs/`).

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
Skill location: {skill_path}/SKILL.md
Task: {eval.prompt}
Input files: {eval.files or "none"}
Output directory: {eval_dir}/with_skill/outputs/
Transcript path: {eval_dir}/with_skill/transcript.md
```

*without_skill:*

```text
Task: {eval.prompt}
Input files: {eval.files or "none"}
Output directory: {eval_dir}/without_skill/outputs/
Transcript path: {eval_dir}/without_skill/transcript.md

Complete this task using your own judgment — no skill provided.
```

**Grade (parallel)** — in the same Agent tool call, spawn two grader subagents:

*with_skill grader:*

```text
expectations: {eval.expectations as JSON array}
transcript_path: {eval_dir}/with_skill/transcript.md
outputs_dir: {eval_dir}/with_skill/outputs/
```

*without_skill grader:*

```text
expectations: {eval.expectations as JSON array}
transcript_path: {eval_dir}/without_skill/transcript.md
outputs_dir: {eval_dir}/without_skill/outputs/
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

- *current executor*: `Skill location: {skill_path}/SKILL.md`, outputs to `{eval_dir}/current/`
- *previous executor*: `Skill location: {previous_skill_path}`, outputs to `{eval_dir}/previous/`
- Grading paths: `{eval_dir}/current/grading.json`, `{eval_dir}/previous/grading.json`
- Variant field: `"current"` / `"previous"`

---

## Phase 2 — Aggregate benchmark

Read all grading.json files and write to `{iter_dir}/benchmark.json`.

**Single mode:**

```json
{
  "skill_name": "<skill_name>",
  "iteration": N,
  "run_count": N,
  "eval_ids": [...],
  "runs": [
    {
      "run_index": N,
      "evals": [ { "eval_id": N, "eval_name": "...", "slug": "...", "grading_path": "...", "summary": { "passed": N, "failed": N, "total": N, "pass_rate": 0.0 } } ],
      "run_summary": { "passed": N, "failed": N, "total": N, "pass_rate": 0.0 }
    }
  ],
  "aggregate_summary": { "avg_pass_rate": 0.0, "total_passed": N, "total_failed": N, "total_assertions": N, "has_failures": true }
}
```

**Comparison modes** — add `comparison_mode`, `baseline_runs`, and `baseline_aggregate_summary`:

```json
{
  "skill_name": "<skill_name>",
  "comparison_mode": "with_without_skill",
  "iteration": N, "run_count": N, "eval_ids": [...],
  "runs": [ ...primary (with_skill / current)... ],
  "baseline_runs": [ ...baseline (without_skill / previous)... ],
  "aggregate_summary": { ...primary... },
  "baseline_aggregate_summary": { "avg_pass_rate": 0.0, "total_passed": N, "total_failed": N, "total_assertions": N, "has_failures": true }
}
```

`runs` reads from `{eval_dir}/with_skill/grading.json` (or `{eval_dir}/current/`).
`baseline_runs` reads from `{eval_dir}/without_skill/grading.json` (or `{eval_dir}/previous/`).

Compute all aggregates as pure calculations before writing.

---

## Phase 3 — Analyze

Spawn an analyzer subagent:

```text
benchmark_data_path: {iter_dir}/benchmark.json
skill_path: {skill_path}
output_path: {iter_dir}/analyst-notes.json
```

Read `{iter_dir}/analyst-notes.json` (a JSON array of strings).

---

## Phase 4 — Return final structured output

Output this JSON as your final text response (the sidecar captures it as `structuredOutput`):

```json
{
  "type": "complete",
  "iteration": N,
  "benchmark": <full benchmark.json contents>,
  "analyst_notes": <analyst-notes.json contents>
}
```

---

## Error handling

- Executor fails to write outputs/transcript: write `{eval_dir}/error.json`, continue; set `"error": true` in the `eval_graded` event
- `grading.json` unreadable: treat as `{ "passed": 0, "failed": 0, "total": 0, "pass_rate": 0, "grader_error": true }` in the aggregate
- Analyzer fails: return `"analyst_notes": []`
