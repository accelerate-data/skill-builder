---
name: validate-skill
description: >
  Validates a completed skill against its decisions and clarifications. Use when
  validating a skill for a domain and purpose. Returns a validation log, test
  results, and companion recommendations as inline text with === VALIDATION LOG ===,
  === TEST RESULTS ===, and === COMPANION SKILLS === delimiters.
---

# Validate Skill

Read-only. Produces three inline text outputs (caller writes files):

1. Validation log (`agent-validation-log.md`)
2. Test results (`test-skill.md`)
3. Companion skill recommendations (`companion-skills.md`)

---

## Inputs

| Input | Description |
|---|---|
| `skill_name` | Skill name |
| `purpose` | `Business process knowledge` \| `Organization specific data engineering standards` \| `Organization specific Azure or Fabric standards` \| `Source system customizations` |
| `context_dir` | Path to context directory |
| `skill_output_dir` | Path to skill output directory |
| `workspace_dir` | Path to workspace directory |

---

## Step 1 — File Inventory

Glob `references/` in `skill_output_dir` to collect all reference file paths.

---

## Step 2 — Sub-agents

Read the three spec files in `references/`. Spawn one sub-agent per spec with the spec content as instructions plus these paths.

**Quality checker** — `references/validate-quality-spec.md`:
- `decisions.md`: `{context_dir}/decisions.md`
- `clarifications.md`: `{context_dir}/clarifications.md`
- `SKILL.md`: `{skill_output_dir}/SKILL.md`
- Reference files: all paths from Step 1 glob
- Workspace directory: `{workspace_dir}`
- Purpose: `{purpose}`

**Test evaluator** — `references/test-skill-spec.md`:
- `decisions.md`: `{context_dir}/decisions.md`
- `clarifications.md`: `{context_dir}/clarifications.md`
- `SKILL.md`: `{skill_output_dir}/SKILL.md`
- Reference files: all paths from Step 1 glob
- Workspace directory: `{workspace_dir}`

**Companion recommender** — `references/companion-recommender-spec.md`:
- `SKILL.md`: `{skill_output_dir}/SKILL.md`
- Reference files: all paths from Step 1 glob
- `decisions.md`: `{context_dir}/decisions.md`
- `research-plan.md`: `{context_dir}/research-plan.md`
- Workspace directory: `{workspace_dir}`
- Purpose: `{purpose}`


---

## Step 3 — Consolidate and Report

Consolidate sub-agent results into three output sections. Do not modify skill files.

**Validation findings** — All FAIL/MISSING items with file, section, and concrete suggested fix.

**Boundary violations** — Each violation with file, section, and crossed dimension.

**Prescriptiveness rewrites** — Original text and suggested informational rewrite.

**Test gap analysis** — Uncovered topics, vague content, missing SKILL.md pointers, and 5-8 suggested test prompt categories.

---

## Return Format

Return inline text with three delimited sections. Delimiters must be exactly as shown:

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

Summary (decisions covered X/Y, structural checks, content checks, auto-fixed count, manual review count), then:
- Coverage results, Structural results, Content results, Boundary check, Prescriptiveness rewrites, Manual review items

### `=== TEST RESULTS ===`

Summary (total/passed/partial/failed counts), then:
- Test results (prompt, category, result, coverage, gap per test), Skill content issues, Suggested PM prompts

### `=== COMPANION SKILLS ===`

YAML frontmatter (for UI parsing) plus markdown body with reasoning per recommendation.

**YAML frontmatter schema:**

```yaml
---
skill_name: [skill_name]
purpose: [purpose]
companions:
  - name: [display name]
    slug: [kebab-case]
    purpose: [purpose]
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
- Every decision and answered clarification mapped to a file and section
- All Skill Best Practices checks pass
- Each content file scores 3+ on all Quality Dimensions
- All auto-fixable issues fixed and verified
- Standards skills have a Getting Started section
- No process artifacts, stakeholder questions, or redundant discovery sections

### Evaluations
- `{context_dir}/evaluations.md` present with 3+ complete evaluation scenarios
- Each scenario actually run against Claude with the skill active
- Each result has PASS/PARTIAL/FAIL with specific evidence
- Actionable gaps identified

### Testing
- 5 test prompts covering all 6 categories
- Each result has PASS/PARTIAL/FAIL with specific evidence
- Report identifies actionable patterns
- Suggested prompts target real gaps
