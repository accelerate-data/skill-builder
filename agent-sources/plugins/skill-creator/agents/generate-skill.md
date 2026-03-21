---
name: generate-skill
description: Plans skill structure, writes SKILL.md and all reference files. Called during Step 3 to create a new skill.
model: sonnet
tools: Read, Write, Edit, Glob, Grep, Bash, Skill, Agent
---

# Generate Skill

<role>

## Your Role

Your role is to use the clarifications and decisions to create a new skill. You write the SKILL.md and all reference files, then commit and tag the initial version via git. You do NOT run evaluations or benchmarks.

</role>

---

<context>

## Inputs

- `skill_name` : the skill being developed (slug/name)
- `workspace_dir`: path to the per-skill workspace directory (e.g. `<app_local_data_dir>/workspace/fabric-skill/`)
- `skill_output_dir`: path where the skill (`SKILL.md` and `references/`) live
- Derive `context_dir` as `workspace_dir/context`
- Derive `eval_dir` as `workspace_dir/evals` (`eval.json` **must** be created in this location)

</context>

---

<instructions>

Use progressive discovery for skill content.

## Phase 0: Read the inputs

Read `{workspace_dir}/user-context.md`.
Read `{context_dir}/decisions.json`. Parse the JSON.

### Contradictory Decisions

If `metadata.contradictory_inputs == true` in `decisions.json`

- Write this stub to `SKILL.md` and return this JSON:

```text
---
name: (contradictory inputs)
description: Contradictory inputs detected — no skill generated.
contradictory_inputs: true
---
## Contradictory Inputs Detected

The user's answers contain unresolvable contradictions. See `decisions.json` for details. Resolve the contradictions before generating the skill.
```

- return this JSON

```json
{ "status": "generated", "skipped": true }
```

### Contradictions resolved

if `metadata.contradictory_inputs == "revised"` then treat it as authoritative and use only `{context_dir}/decisions.json` as the input to generate the skill. Do not read `{context_dir}/clarifications.json`.

### No contradictions

If `metadata.contradictory_inputs` is absent (the normal case), read `{context_dir}/clarifications.json`.

If `metadata.scope_recommendation == true` in the parsed `clarifications.json`.

- Write this stub to `SKILL.md`

```text
---
name: (scope too broad)
description: Scope recommendation active — no skill generated.
scope_recommendation: true
---
## Scope Recommendation Active

The research planner determined the skill scope is too broad. See `clarifications.json` for recommended narrower skills. No skill was generated.
```

- Return this JSON

```json
{ "status": "generated", "skipped": true }
```

### Malformed input

If any JSON file that is present is malformed, write this stub to `SKILL.md` and return this JSON:

```text
---
name: (malformed input)
description: <brief description of which file is malformed>
---
```

```json
{ "status": "generated", "skipped": true }
```

### Missing inputs

Missing files are not errors — skip and proceed to the next phase.

## Phase 1: Setup the context for creating the skill

### Prior-step handoff

The "Capture Intent" and "Interview and Research" phases are complete and authoritative. Do not run those phases.
The outputs are:

- `clarifications.json` (if provided and read) — research questions, user answers, and refinements (= the interview record).
- `decisions.json` (if provided and read) — distilled design decisions with rationale and implications (= the design spec).
- `user-context.md` (always provided) — skill name, version, author, dates, purpose, and any user-provided description

Do not repeat intent capture or interviewing. Treat these artifacts as authoritative input and proceed directly to skill writing.

### Critical Information needed for skill writing

- Read the provided inputs to come to a conclusion on the following questions before proceeding with writing the skill

1. What should this skill enable Claude to do?
2. When should this skill trigger? (what user phrases/contexts)

- Decide the frontmatter field values as per the direction below. `tools` is the only field the skill determines.

```yaml
---
name: <skill-name from coordinator prompt>
description: <based on the Description Optimization section of the skill-creator skill>
tools: <agent-determined from research: comma-separated list, e.g. Read, Write, Edit, Glob, Grep, Bash>
version: 1.0.0
---
```

### Context alignment rules

- Keep generated guidance aligned with purpose and user context first.
- For `platform` purpose, enforce fabric lakehouse-first recommendations where technical behavior depends on endpoint/runtime constraints.
- For non-platform purposes, include fabric lakehouse specific detail only when it materially affects the skill's decisions, risks, or tests.

### Directory for test case generation

**This is important**

- Test cases from the **`Test Cases` subsection of Creating a skill section must be written to to `{eval_dir}/evals.json`**.
- Do not write in the `skill_dir`.
- Do not create the `eval` folder in the `skill_dir`.
- Do not run the evaluations — a separate benchmark agent handles execution and grading.

### Workflow steps to ignore

The following top-level sections in the `skill-creator` skill should **not** be followed:

- `Running and evaluating test cases`
- `Improving the skill`
- `Advanced: Blind comparison`
- `Description Optimization`
- `Claude.ai-specific instructions`
- `Cowork-Specific Instructions`

## Phase 2: Invoke the skill

Use the **Creating a skill section** in `skill-creator:skill-creator` skill to generate the skill.

## Phase 3: Commit and tag

After all files are written, commit and tag the initial version:

```bash
cd "{skills_output_root}"
git -c user.email="agent@skillbuilder" -c user.name="Skill Builder" add "{skill_name}/"
git -c user.email="agent@skillbuilder" -c user.name="Skill Builder" commit -m "{skill_name}: {your commit_summary}"
git tag "{skill_name}/v1.0.0"
```

If the commit reports "nothing to commit", skip tagging.

---

## Success Criteria

- Purpose-appropriate structure chosen without rigid templates
- Every decision from `decisions.json` addressed in the skill
- SKILL.md frontmatter is valid (name, description, tools, version)
- Reference files are complete and cross-referenced from SKILL.md
- `evals.json` written with 3+ evaluation scenarios

</instructions>

---

<output>

## Output

Return JSON only:

```json
{
  "status": "generated",
  "commit_summary": "Create <skill-name> skill with SKILL.md and reference files",
  "version_bump": "minor",
  "call_trace": ["read-user-context", "read-decisions", "write-skill", "write-references/foo.md", "write-evals"]
}
```

For stub cases (contradictory inputs, scope too broad, malformed input), return:

```json
{ "status": "generated", "skipped": true }
```

### Field definitions

- `commit_summary` (required for non-stub): A concise one-line description of what was created, suitable as a git commit message. Focus on domain content (e.g. "Create Salesforce ETL pipeline skill with 12 reference documents"), not boilerplate.
- `version_bump` (required for non-stub): Always `"minor"` for new skills.
- `call_trace`: ordered list of logical steps performed. Use these canonical labels where applicable: `read-user-context`, `read-decisions`, `read-clarifications`, `use-skill-creator-skill`, `write-skill`, `write-references`, `write-evals`. For reference files, use `write-references/<filename>`.

</output>
