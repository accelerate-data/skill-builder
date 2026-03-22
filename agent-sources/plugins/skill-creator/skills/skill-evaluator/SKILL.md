---
name: skill-evaluator
description: Runs evaluation pipeline (executor, grader, aggregation, review HTML) for a skill. Use when the user wants to benchmark, evaluate, or run evals on a skill.
---

# Skill Evaluator

<role>

## Your Role

Your role is to evaluate a skill that has already been written by running test cases, grading the results, and aggregating benchmarks. You do NOT write or modify the skill itself.

</role>

---

<context>

## Inputs

- `skill_name` : the skill being evaluated (slug/name)
- `workspace_dir`: path to the per-skill workspace directory (e.g. `<app_local_data_dir>/workspace/fabric-skill/`)
- `skill_output_dir`: path where the skill (`SKILL.md` and `references/`) live
- Derive `context_dir` as `workspace_dir/context`
- Derive `eval_dir` as `workspace_dir/evals`
- Derive `eval_results_dir` as `eval_dir/workspace`

</context>

---

<instructions>

## Overall Flow

0. **Validate inputs** — confirm SKILL.md, evals.json, and user-context.md exist; handle stubs/missing files and reject incomplete eval definitions.
1. **Resolve benchmark baseline** — detect prior versions via git tags and ask the user to choose baseline mode.
2. **Check for existing benchmark results** — reuse cached results when skill version + baseline version match.
3. **Create snapshot** — only when no cached results AND `prior_version` mode selected.
4. **Determine iteration number** — scan for existing `iteration-*` dirs in `{eval_results_dir}`, pick the next one.
5. **Setup context** — gather test cases, skill path, baseline mode, results directory.
6. **Execute** — spawn runs → grade → aggregate → analyst pass → generate review HTML. Each sub-step gates on the previous. The analyst pass writes `analyst-notes.md` and embeds it into `benchmark.json` `notes` field.
7. **Cleanup and verify** — remove snapshot, confirm `benchmark.json` has valid `run_summary` and non-empty `notes`.

## Step 0: Validate inputs

Read and verify that the required inputs exist before proceeding:

- Read `{skill_output_dir}/SKILL.md` — this is the skill being benchmarked. If it does not exist or is a stub (contains `contradictory_inputs: true` or `scope_recommendation: true` in frontmatter), return immediately:

```json
{ "status": "skipped", "call_trace": ["validate-inputs-stub"] }
```

- Read `{eval_dir}/evals.json` — this file is required and contains the frozen test case definitions. If it does not exist, return immediately with `{ "status": "skipped", "call_trace": ["validate-inputs-missing-evals"] }`. Validate every eval in `{eval_dir}/evals.json` before continuing: `eval_name` must be present and non-empty, `slug` must be present and non-empty (used directly in directory names), and `expectations` must contain at least one item. If any eval is missing any required field, return immediately with `{ "status": "skipped", "call_trace": ["validate-inputs-incomplete-evals"] }`.

- Read `{workspace_dir}/user-context.md` for skill metadata (name, purpose, description). If it does not exist, return immediately:

```json
{ "status": "skipped", "call_trace": ["validate-inputs-missing-user-context"] }
```

## Step 1: Resolve benchmark baseline

Detect available prior versions and let the user choose a baseline. The agent decides what to ask based on how many versions exist.

**Gather context:**

1. Find the skills git repo root. The skill lives at `{skill_output_dir}` — walk up to find the `.git` directory.
2. List all git tags matching the skill: `git tag --list "{skill_name}/v*" --sort=-v:refname` in the skills repo.
3. For each tag, run `git log --oneline {tag}..HEAD -- {skill_name}/` to count commits since that version.

**Decision rules:**

- **0-1 tags** → no prior version available. Default to `baseline_mode = "no_skill"` silently (do not prompt the user).
- **2 tags** → one prior version exists. Use `AskUserQuestion` to offer: compare against that version, compare against no skill, or skip. Include the tag name and commit summary so the user can see what changed.
- **3+ tags** → multiple prior versions exist. Use `AskUserQuestion` to offer: compare against the most recent prior version, choose a specific version, compare against no skill, or skip. If the user picks "specific version", show a follow-up listing all available tags with their commit counts since each tag, and let the user pick one.

**Prompt guidelines:**

- Always include the tag name(s) and a short summary of changes (commit list or count) so the user can make an informed choice.
- Use `AskUserQuestion` — do not hardcode exact question text. Craft the question naturally based on the available context.
- If the user chooses "Skip", return immediately with `{ "status": "skipped", "call_trace": ["user-skipped"] }`.

**Output:** Store `baseline_mode` (`"no_skill"` or `"prior_version"`) and, when applicable, the chosen `prior_tag` (e.g. `"my-skill/v1"`) for subsequent steps.

## Step 2: Check for existing benchmark results

Before running a new benchmark, check whether a matching result already exists.

1. Read the `version` field from `{skill_output_dir}/SKILL.md` frontmatter — this is the **skill version** (e.g. `"2.0.0"`).
2. Determine the **baseline version**:
   - If `baseline_mode` is `"no_skill"` → `baseline_version = "no_skill"`
   - If `baseline_mode` is `"prior_version"` → `baseline_version = prior_tag` (e.g. `"my-skill/v1"`)
3. Scan `{eval_results_dir}/iteration-*` directories.
4. For each iteration, read `benchmark.json` and check:
   - Contains a valid `run_summary`
   - `skill_version` matches the current version
   - `baseline_version` matches the selected baseline
5. **Match found** → return the existing results immediately. No new iteration, no snapshot. Report the cached iteration path and summary.
6. **No match** → proceed to Step 3.

## Step 3: Create snapshot

Only execute this step when **no cached results** were found (Step 2) AND `baseline_mode` is `"prior_version"`.

If `baseline_mode` is `"no_skill"`, skip this step entirely.

Create a temporary snapshot of the prior skill version:

```bash
PRIOR_TAG="<prior_tag from Step 1>"
SNAPSHOT_DIR=$(mktemp -d "/tmp/skill-snapshot-{skill_name}-XXXXXX")
git -C "<skills_repo_root>" archive "$PRIOR_TAG" -- "{skill_name}/" | tar -x -C "$SNAPSHOT_DIR"
```

The unique slug in `/tmp` prevents contention across concurrent runs and benefits from OS-level cleanup. Store the `SNAPSHOT_DIR` path as `prior_skill_snapshot_dir` for use in Step 5.

**Fallback**: If `git archive` or extraction fails, log a warning ("Prior version extraction failed — falling back to no_skill baseline") and switch `baseline_mode` to `"no_skill"`.

## Step 4: Determine iteration number

Scan `{eval_results_dir}` for existing `iteration-*` directories. Pick the next sequential number:

- If no `iteration-*` directories exist, use `iteration-1`.
- If `iteration-1` through `iteration-N` exist, use `iteration-{N+1}`.

Store the result as `{iteration}` (e.g. `iteration-3`) for use in all subsequent steps.
All generated files (test results, grading, benchmark) must only be written to `evals/workspace/{iteration}/`. This overrides any relative paths in the skill-creator SKILL.md.

## Step 5: Setup the context for benchmarking the skill

Key inputs for the eval pipeline:

- **Test cases**: from `{eval_dir}/evals.json` (read in Step 0). Do NOT create or overwrite `evals.json`. Treat `eval_name`, `slug`, and `expectations` as frozen benchmark inputs and only copy them into per-iteration metadata and deterministic directory names.
- **With-skill run**: provide skill path as `skill_output_dir`.
- **Baseline run**: depends on `baseline_mode`:
  - `"no_skill"`: same prompt, no skill at all. Save to `without_skill/` directories.
  - `"prior_version"`: point the baseline subagent at `{prior_skill_snapshot_dir}` (the `/tmp` snapshot from Step 3). Save to `old_skill/` directories.
- **Results directory**: `{eval_results_dir}/{iteration}/`
- **Environment**:
  - The skill is running in headless mode and environment has no display.
  - When executing Step 4 of the Running and evaluating test cases section, use `--static {eval_results_dir}/{iteration}/review.html` instead of starting a server. Do not open a browser.
  - Do not wait for user feedback.
- The `skill-creator` skill references files like `references/schemas.md` and `agents/grader.md` — these are internal to the `skill creator` skill and is present in `plugins/skill-creator/skills/skill-creator`.

## Step 6: Execute the test cases and generate the benchmark

Use the **Running and evaluating test cases** section in `skill-creator:skill-creator` skill to run the test cases and generate the benchmark. The benchmark run must consume the existing eval definitions only; it must not rename evals or rewrite assertions during execution.

After aggregation, write two additional fields into the top-level `benchmark.json`:

- `"skill_version"`: the version read from `{skill_output_dir}/SKILL.md` frontmatter in Step 2
- `"baseline_version"`: `"no_skill"` or the prior tag string (e.g. `"my-skill/v1"`)

These fields enable result reuse in future runs (Step 2).

## Step 7: Cleanup and verify

**Cleanup**: If a snapshot was created in Step 3, remove it:

```bash
rm -rf "$SNAPSHOT_DIR"
```

**Verify**: Read `{eval_results_dir}/{iteration}/benchmark.json`.

- If it exists and contains a valid `run_summary` with per-configuration statistics, report it as complete.
- If it exists but is missing some configurations or some evals had errors, report it as partial.
- If it does not exist after Step 6 completed (aggregation script failed), report it as partial.

---

## Success Criteria

- All test cases from `evals.json` executed with both configurations
- `benchmark.json` exists and contains a valid `run_summary`
- `benchmark.json` top-level `notes` array is populated with analyst observations
- `benchmark.json` contains `skill_version` and `baseline_version` fields

</instructions>

---

<output>

## Output

**Gate — do NOT return until:**

You have verified `benchmark.json` exists, contains a valid `run_summary`, and has a non-empty `notes` array — OR you are returning cached results from Step 2.

Return a short natural-language summary, not JSON.

The final response must:

- State whether the benchmark finished as complete, partial, skipped, or cached
- Include the relative benchmark path `evals/workspace/{iteration}` for non-skipped runs
- Briefly summarize the outcome in plain language

For skipped cases, say why it was skipped in plain language.
For cached results, state that matching results were found and which iteration was reused.

</output>
