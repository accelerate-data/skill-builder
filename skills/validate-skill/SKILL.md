---
name: validate-skill
description: >
  Validates a completed skill against its decisions and clarifications. Use when
  validating a skill for a domain and skill type. Returns a validation log, test
  results, and companion recommendations as inline text with === VALIDATION LOG ===,
  === TEST RESULTS ===, and === COMPANION SKILLS === delimiters.
domain: Skill Builder
type: skill-builder
---

# Validate Skill

## What This Skill Does

Given a completed skill, this skill produces three outputs as inline text:

1. Validation log (becomes `agent-validation-log.md`)
2. Test results (becomes `test-skill.md`)
3. Companion skill recommendations (becomes `companion-skills.md`)

This is a **read-only computation unit** — it reads skill files, runs validation, and returns findings as inline text. It does not modify any files. The caller (orchestrator) writes the three output files to disk.

---

## Inputs

| Input | Description |
|---|---|
| `domain` | Domain name |
| `skill_name` | Skill name |
| `skill_type` | `domain` \| `data-engineering` \| `platform` \| `source` |
| `context_dir` | Path to context directory (contains `decisions.md`, `clarifications.md`, `research-plan.md`) |
| `skill_output_dir` | Path to skill output directory (contains `SKILL.md` and `references/`) |
| `workspace_dir` | Path to workspace directory (contains `user-context.md`) |

---

## Step 1 — File Inventory

Glob `references/` in `skill_output_dir` to collect all reference file paths.

---

## Step 2 — Sub-agents

Read the full content of the three spec files in `references/`. Spawn one sub-agent per spec, passing the spec content as instructions plus the paths below.

**Quality checker** — `references/validate-quality-spec.md`. Paths:
- `decisions.md`: `{context_dir}/decisions.md`
- `clarifications.md`: `{context_dir}/clarifications.md`
- `SKILL.md`: `{skill_output_dir}/SKILL.md`
- Reference files: all paths from Step 1 glob
- Workspace directory: `{workspace_dir}`
- Skill type: `{skill_type}`

**Test evaluator** — `references/test-skill-spec.md`. Paths:
- `decisions.md`: `{context_dir}/decisions.md`
- `clarifications.md`: `{context_dir}/clarifications.md`
- `SKILL.md`: `{skill_output_dir}/SKILL.md`
- Reference files: all paths from Step 1 glob
- Workspace directory: `{workspace_dir}`

**Companion recommender** — `references/companion-recommender-spec.md`. Paths:
- `SKILL.md`: `{skill_output_dir}/SKILL.md`
- Reference files: all paths from Step 1 glob
- `decisions.md`: `{context_dir}/decisions.md`
- `research-plan.md`: `{context_dir}/research-plan.md`
- Workspace directory: `{workspace_dir}`
- Skill type: `{skill_type}`


---

## Step 3 — Consolidate and Report

After all sub-agents return their text, consolidate directly into the three output sections. Do not modify any skill files.

**Validation findings** — Consolidate all FAIL/MISSING items from the quality checker. For each, include the file, section, and a concrete suggested fix (so the caller can apply it).

**Boundary violations** — List each violation with the file, section, and what dimension it crosses into.

**Prescriptiveness rewrites** — For each flagged pattern, include the original text and the suggested informational rewrite.

**Test gap analysis** — Identify uncovered topic areas, vague content, and missing SKILL.md pointers. Include 5–8 suggested test prompt categories for future evaluation.

---

## Return Format

Return inline text with three clearly delimited sections. Delimiter lines must be exactly as shown:

```
=== VALIDATION LOG ===
[full agent-validation-log.md content]
=== TEST RESULTS ===
[full test-skill.md content]
=== COMPANION SKILLS ===
[full companion-skills.md content including YAML frontmatter]
```

All three sections must be present.

---

## Output Format

### `=== VALIDATION LOG ===`

Summary (decisions covered X/Y, structural checks, content checks, auto-fixed count, manual review count), then sections for:
- Coverage results
- Structural results
- Content results
- Boundary check
- Prescriptiveness rewrites
- Items needing manual review

### `=== TEST RESULTS ===`

Summary (total/passed/partial/failed counts), then:
- Test results (prompt, category, result, coverage, gap per test)
- Skill content issues
- Suggested PM prompts

### `=== COMPANION SKILLS ===`

YAML frontmatter with structured companion data (for UI parsing) plus markdown body with detailed reasoning per recommendation.

**YAML frontmatter schema:**

```yaml
---
skill_name: [skill_name]
skill_type: [skill_type]
companions:
  - name: [display name]
    slug: [kebab-case]
    type: [skill type]
    priority: High | Medium | Low
    dimension: [dimension slug]
    score: [planner score]
    template_match: null
---
```

If no recommendations, use `companions: []`.

---

## Success Criteria

### Validation
- Every decision and answered clarification is mapped to a specific file and section
- All Skill Best Practices checks pass
- Each content file scores 3+ on all Quality Dimensions
- All auto-fixable issues are fixed and verified
- `references/evaluations.md` is present with at least 3 complete evaluation scenarios
- Decision Architecture skills (Platform, DE) have a Getting Started section
- No process artifacts, stakeholder questions, or redundant discovery sections in skill output

### Testing
- 5 test prompts covering all 6 categories
- Each result has PASS/PARTIAL/FAIL with specific evidence from skill files
- Report identifies actionable patterns, not just individual results
- Suggested prompts target real gaps found during testing
