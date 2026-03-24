---
name: evaluate-skill
description: Runs selected eval test cases 1 or 3 times against a skill, grades each run, and returns a benchmark summary with analyst notes. Emits structured progress JSON after each eval completes so the UI can update live.
model: sonnet
tools: Read, Write, Glob, Agent
---

# Evaluate Skill

## Role

You run a subset of eval test cases against a skill, grade the outputs, aggregate results into a benchmark, and produce analyst observations. You communicate progress back to the UI by outputting structured JSON after each eval is graded.

---

## Inputs

You receive these parameters in your prompt:

- **skill_name**: Skill slug (matches `skill_name` field in `evals.json`)
- **workspace_path**: Absolute path to the per-skill workspace directory (contains `evals/evals.json`)
- **eval_ids**: JSON array of integer eval IDs to run (subset selected by the user)
- **run_count**: `1` or `3` — number of repetitions for statistical confidence
- **skill_path**: Absolute path to the skill directory (contains `SKILL.md`)

---

## Phase 0 — Setup

### Step 1: Read evals

1. Read `{workspace_path}/evals/evals.json`
2. Parse the JSON and collect only the entries whose `id` appears in `eval_ids`
3. If no matching evals are found, output:

```json
{ "type": "error", "message": "No matching evals found for the provided eval_ids" }
```

…and stop.

### Step 2: Determine iteration number

1. Use Glob to list `{workspace_path}/evals/workspace/iteration-*/` directories
2. Parse the trailing integer from each directory name
3. Set `iteration_N` = max found + 1 (or `1` if none exist)
4. Set `iter_dir` = `{workspace_path}/evals/workspace/iteration-{iteration_N}`
5. Create the directory by writing a placeholder file `{iter_dir}/.keep` (then delete it — or simply proceed; Write will create parent dirs automatically)

---

## Phase 1 — Run loop

For each `run_index` from `0` to `run_count - 1`:

  Set `run_dir` = `{iter_dir}/run-{run_index}`

  For each `eval` in the filtered eval list (in the order they appear in `eval_ids`):

  Set `eval_dir` = `{run_dir}/eval-{eval.id}-{eval.slug}`

### Step A — Execute the skill

Spawn an executor subagent using the Agent tool. Provide this complete prompt:

```text
You are a skill executor. Complete the following task by strictly following the skill's instructions.

Skill location: {skill_path}/SKILL.md
Task prompt: {eval.prompt}
Input files (if any — copy to your working dir before starting): {eval.files as comma-separated list, or "none"}
Output directory: {eval_dir}/outputs/
Transcript path: {eval_dir}/transcript.md

Instructions:
1. Read SKILL.md completely before doing anything else.
2. Execute the task prompt following the skill's instructions exactly.
3. Write all output files to the Output directory.
4. Write a step-by-step markdown transcript of your work to the Transcript path.
   The transcript must capture: each tool call, what you found, what you decided, and the final result.
```

### Step B — Grade the output

Spawn a grader subagent using the Agent tool. Provide this complete prompt:

```text
Read skills/skill-creator/agents/grader.md and follow it exactly.

expectations: {eval.expectations serialized as a JSON array of strings}
transcript_path: {eval_dir}/transcript.md
outputs_dir: {eval_dir}/outputs/
```

The grader will write `grading.json` to `{eval_dir}/grading.json` (one level above `outputs/`, per grader.md instructions).

### Step C — Emit progress JSON

1. Read `{eval_dir}/grading.json`
2. Output the following JSON as your text output — the sidecar captures any JSON object
   you output as `structuredOutput` on the forwarded `DisplayItem`:

```json
{
  "type": "eval_graded",
  "runIndex": <run_index>,
  "evalIndex": <zero-based position of this eval within eval_ids>,
  "totalEvals": <length of eval_ids>,
  "totalRuns": <run_count>,
  "evalId": <eval.id>,
  "evalName": "<eval.eval_name>",
  "grading": {
    "passed": <summary.passed from grading.json>,
    "failed": <summary.failed from grading.json>,
    "total": <summary.total from grading.json>,
    "pass_rate": <summary.pass_rate from grading.json>
  }
}
```

---

## Phase 2 — Aggregate benchmark

After the run loop completes:

### Step 1: Read all grading results

For every combination of `run_index` (0..run_count-1) and `eval` in the filtered list,
read `{iter_dir}/run-{run_index}/eval-{eval.id}-{eval.slug}/grading.json`.

### Step 2: Build benchmark.json

Compute the following and write to `{iter_dir}/benchmark.json`:

```json
{
  "skill_name": "<skill_name>",
  "iteration": <iteration_N>,
  "run_count": <run_count>,
  "eval_ids": <eval_ids array>,
  "runs": [
    {
      "run_index": 0,
      "evals": [
        {
          "eval_id": <eval.id>,
          "eval_name": "<eval.eval_name>",
          "slug": "<eval.slug>",
          "grading_path": "run-0/eval-<id>-<slug>/grading.json",
          "summary": {
            "passed": <n>,
            "failed": <n>,
            "total": <n>,
            "pass_rate": <0.0..1.0>
          }
        }
      ],
      "run_summary": {
        "passed": <sum of passed across evals in this run>,
        "failed": <sum of failed across evals in this run>,
        "total": <sum of total across evals in this run>,
        "pass_rate": <passed / total>
      }
    }
  ],
  "aggregate_summary": {
    "avg_pass_rate": <mean of run pass_rates>,
    "total_passed": <sum across all runs and evals>,
    "total_failed": <sum across all runs and evals>,
    "total_assertions": <total_passed + total_failed>,
    "has_failures": <true if total_failed > 0>
  }
}
```

> Compute `aggregate_summary` as a pure calculation from the runs data before writing — never
> mutate state during computation.

---

## Phase 3 — Analyze

Spawn an analyzer subagent using the Agent tool. Provide this complete prompt:

```text
Read skills/skill-creator/agents/analyzer.md and follow the "Analyzing Benchmark Results" section exactly.

benchmark_data_path: {iter_dir}/benchmark.json
skill_path: {skill_path}
output_path: {iter_dir}/analyst-notes.json
```

Read `{iter_dir}/analyst-notes.json` (a JSON array of observation strings).

---

## Phase 4 — Return final structured output

Output the following JSON as your final text response.
The sidecar captures this as the terminal `structuredOutput` `DisplayItem`:

```json
{
  "type": "complete",
  "iteration": <iteration_N>,
  "benchmark": <full contents of benchmark.json>,
  "analyst_notes": <contents of analyst-notes.json>
}
```

---

## Error handling

- If the executor subagent fails to write a transcript or outputs directory, log the failure
  in a `{eval_dir}/error.json` file and continue to the next eval. Include a `"error": true`
  field in the `eval_graded` progress event for that eval.
- If a `grading.json` cannot be read after the grader subagent completes, treat that eval
  as `{ "passed": 0, "failed": 0, "total": 0, "pass_rate": 0, "grader_error": true }` in
  the aggregate.
- If the analyzer subagent fails, return `"analyst_notes": []` in the final output.

---

## Output summary

| Event | When | `type` field |
|---|---|---|
| Per-eval progress | After each grader subagent completes | `"eval_graded"` |
| Final result | After analyzer completes | `"complete"` |
| Fatal input error | If no evals match `eval_ids` | `"error"` |
