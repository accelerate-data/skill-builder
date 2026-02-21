# Validate Skill — Design Note

**Issue:** VD-851
**Status:** Implemented

---

## Problem

The workflow's validation phase (step 7) was implemented as 4 separate agent files:
`validate-skill.md` (orchestrator), `validate-quality.md`, `test-skill.md`, and
`companion-recommender.md`. Like the research phase, these were deployed as flat files
into `.claude/agents/` with no ownership boundary and no way to update them
independently of an app release.

The three sub-agents (`validate-quality`, `test-skill`, `companion-recommender`) encode
the quality criteria, test generation approach, and companion recommendation logic.
These are the most likely parts of the pipeline to need iteration as Skill Best
Practices evolve — yet they were locked to the app release cycle.

---

## Approach

Same two-layer split as the research skill:

| Layer | What | Owned by |
|---|---|---|
| **App-bundled agent** | `validate-skill.md` (thin orchestrator) | App release |
| **Validate-skill skill** | Coordinator + 3 evaluation specs | Skill package (marketplace-updatable) |

**3 agent files deleted** (`validate-quality.md`, `test-skill.md`,
`companion-recommender.md`). Their logic now lives in
`agent-sources/workspace/skills/validate-skill/references/`.

---

## Skill Structure

```
agent-sources/workspace/skills/validate-skill/
  SKILL.md                              ← coordinator with full instructions
  references/
    validate-quality-spec.md            ← quality checker: 4-pass assessment
    test-skill-spec.md                  ← test evaluator: 5 test prompts + scoring
    companion-recommender-spec.md       ← companion recommender: gap analysis + recommendations
```

---

## How It Works

The validate-skill skill is a **read-only computation unit** — it reads skill files,
runs three parallel evaluations, and returns findings as inline text. It does not
modify any files. The orchestrator handles all file I/O.

**Step 1 — File inventory.** Glob `references/` in the skill output directory to collect
all reference file paths.

**Step 2 — Parallel evaluation.** Read the full content of each spec file. Spawn one
sub-agent per spec, passing the spec content as instructions plus the paths to the
skill files. All three launch in the same turn:

- **Quality checker** (`validate-quality-spec.md`) — 4-pass assessment: coverage &
  structure, content quality, boundary check, prescriptiveness check. Reads
  `decisions.md`, `clarifications.md`, `SKILL.md`, all reference files, and
  `user-context.md`.
- **Test evaluator** (`test-skill-spec.md`) — generates 5 realistic test prompts
  covering 6 categories, then evaluates each against the skill content (PASS/PARTIAL/FAIL).
  Reads same files.
- **Companion recommender** (`companion-recommender-spec.md`) — analyzes skipped
  dimensions (score 2–3 from `research-plan.md`) to identify knowledge gaps, then
  recommends complementary skills. Reads `SKILL.md`, reference files, `decisions.md`,
  `research-plan.md`, and `user-context.md`.

**Step 3 — Consolidate.** Synthesize all sub-agent findings into three output sections.
No skill files are modified — findings only.

**Return format** — inline text with three delimited sections:

```
=== VALIDATION LOG ===
[full agent-validation-log.md content]
=== TEST RESULTS ===
[full test-skill.md content]
=== COMPANION SKILLS ===
[full companion-skills.md content including YAML frontmatter]
```

**Orchestrator writes:** extracts each section and writes to disk:
- `=== VALIDATION LOG ===` → `{context_dir}/agent-validation-log.md`
- `=== TEST RESULTS ===` → `{context_dir}/test-skill.md`
- `=== COMPANION SKILLS ===` → `{context_dir}/companion-skills.md`

---

## Scope Recommendation Guard

The orchestrator (not the skill) checks for `scope_recommendation: true` in both
`decisions.md` and `clarifications.md` before invoking the skill. If detected, it
writes three stub files with `scope_recommendation: true` frontmatter and returns
immediately — no skill invocation, no sub-agents. The bundled skill has no awareness
of scope recommendation state.

---

## Output Formats

### `agent-validation-log.md`

Summary (decisions covered X/Y, check counts), then sections for: coverage results,
structural results, content results, boundary check, prescriptiveness rewrites, items
needing manual review.

### `test-skill.md`

Summary (total/passed/partial/failed), then per-test results (prompt, category,
result, coverage, gap) and suggested test prompt categories.

### `companion-skills.md`

YAML frontmatter with structured companion data for UI parsing, plus markdown body
with reasoning per recommendation.

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

---

## App Integration

The Rust workflow pipeline is unchanged:

```
workflow.rs step 7
  prompt_template: "validate-skill.md"   ← unchanged
  output_file: "context/agent-validation-log.md"  ← unchanged
```

The orchestrator's content changed (thin wrapper around the bundled skill), but no
code changes. No DB migrations, no new Rust commands.

The validate-skill skill is seeded into the workspace on startup by `seed_bundled_skills`
alongside `research` and `skill-builder-practices`.

---

## Customization Model

When a team imports a replacement validate-skill skill from the marketplace:

1. `upload_skill_inner` extracts the zip to `.claude/skills/validate-skill/`
2. The orchestrator invokes `.claude/skills/validate-skill/SKILL.md` — the custom
   skill's coordinator drives validation
3. The custom skill's reference specs control quality criteria, test categories, and
   companion recommendation logic
4. The team can deactivate to revert to the bundled defaults

Teams can customise: quality check criteria, test prompt categories and scoring
rubric, companion recommendation scoring. The output file names and YAML frontmatter
schemas are app-controlled contracts.
