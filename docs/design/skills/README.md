# Bundled Skills

Both bundled skills follow the same pattern: receive inputs inline, spawn parallel sub-agents in one turn, return delimited sections. The calling orchestrator extracts each section and writes the files to disk.

Both are seeded into the workspace on startup by `seed_bundled_skills` alongside `skill-builder-practices`, and are replaceable via the marketplace.

Output file formats: [`../agent-specs/canonical-format.md`](../agent-specs/canonical-format.md).

---

## Research Skill

`research-orchestrator` runs at step 0. Invoked by:
- **Tauri app** — `workflow.rs` step 0 via the sidecar
- **Plugin workflow** — coordinator spawns it via `Task(subagent_type: "skill-builder:research-orchestrator")`

### Structure

```
agent-sources/workspace/skills/research/
  SKILL.md
  references/
    dimension-sets.md             ← type-scoped dimension tables (5–6 per type)
    scoring-rubric.md             ← scoring criteria (1–5) and selection rules
    consolidation-handoff.md      ← clarifications.md format spec for consolidation
    dimensions/
      entities.md                 ← 18 dimension specs (focus, approach, output format)
      metrics.md
      data-quality.md
      business-rules.md
      segmentation-and-periods.md
      modeling-patterns.md
      pattern-interactions.md
      load-merge-patterns.md
      historization.md
      layer-design.md
      platform-behavioral-overrides.md
      config-patterns.md
      integration-orchestration.md
      operational-failure-modes.md
      extraction.md
      field-semantics.md
      lifecycle-and-state.md
      reconciliation.md
```

### How It Works

**Step 1 — Select dimension set.** Read `dimension-sets.md`, identify the 5–6 candidate dimensions for the given `skill_type`.

**Step 2 — Score and select.** Score each candidate against the domain using `scoring-rubric.md`. Select top 3–5 by score. Extended thinking is used here.

**Step 3 — Parallel dimension research.** Spawn one sub-agent per selected dimension with its spec content plus domain and tailored focus line embedded inline. All sub-agents launch in the same turn.

**Step 4 — Consolidate.** Synthesize all dimension outputs into `clarifications.md` format per `consolidation-handoff.md`.

### Return Format

```
=== RESEARCH PLAN ===
[scored dimension table + selected dimensions]
=== CLARIFICATIONS ===
[complete clarifications.md content including YAML frontmatter]
```

Orchestrator writes:
- `=== RESEARCH PLAN ===` → `{context_dir}/research-plan.md`
- `=== CLARIFICATIONS ===` → `{context_dir}/clarifications.md`

If `clarifications.md` contains `scope_recommendation: true`, the orchestrator surfaces this to the caller and stops — the domain scope is too broad for skill generation.

### Customization

Marketplace replacement is extracted to `.claude/skills/research/`. Teams can customise: dimensions per skill type, scoring rubric and selection threshold, research approach per dimension, consolidation logic. The orchestrator and `clarifications.md` format contract are app-controlled.

Dimension catalog, per-type template mappings, focus line tailoring, and design guidelines: [`dimensions.md`](dimensions.md).

---

## Validate Skill

`validate-skill` runs at step 6. Invoked by:
- **Plugin workflow** — coordinator spawns it via `Task(subagent_type: "skill-builder:validate-skill")` after the Generation phase
- **Refine workflow** — `refine-skill.md` spawns it on `/validate` or a full `/rewrite` cycle

### Structure

```
agent-sources/workspace/skills/validate-skill/
  SKILL.md
  references/
    validate-quality-spec.md      ← quality checker: 4-pass assessment
    test-skill-spec.md            ← test evaluator: 5 test prompts + scoring
    companion-recommender-spec.md ← companion recommender: gap analysis + recommendations
```

### How It Works

**Step 1 — File inventory.** Glob `references/` in the skill output directory to collect all reference file paths.

**Step 2 — Parallel evaluation.** Spawn one sub-agent per spec, passing spec content as instructions plus paths to skill files. All three launch in the same turn:

- **Quality checker** (`validate-quality-spec.md`) — 4-pass assessment: coverage & structure, content quality, boundary check, prescriptiveness check. Reads `decisions.md`, `clarifications.md`, `SKILL.md`, all reference files, and `user-context.md`.
- **Test evaluator** (`test-skill-spec.md`) — generates 5 realistic test prompts across 6 categories, evaluates each against skill content (PASS/PARTIAL/FAIL). Reads the same files.
- **Companion recommender** (`companion-recommender-spec.md`) — analyzes skipped dimensions (score 2–3 from `research-plan.md`) to identify knowledge gaps and recommend complementary skills. Reads `SKILL.md`, reference files, `decisions.md`, `research-plan.md`, and `user-context.md`.

**Step 3 — Consolidate.** Synthesize all sub-agent findings into three output sections.

### Return Format

```
=== VALIDATION LOG ===
[full agent-validation-log.md content]
=== TEST RESULTS ===
[full test-skill.md content]
=== COMPANION SKILLS ===
[full companion-skills.md content including YAML frontmatter]
```

Orchestrator writes:
- `=== VALIDATION LOG ===` → `{context_dir}/agent-validation-log.md`
- `=== TEST RESULTS ===` → `{context_dir}/test-skill.md`
- `=== COMPANION SKILLS ===` → `{context_dir}/companion-skills.md`

### Scope Recommendation Guard

The orchestrator checks for `scope_recommendation: true` in both `decisions.md` and `clarifications.md` before invoking the skill. If detected, it writes three stub files with `scope_recommendation: true` frontmatter and returns immediately — no skill invocation, no sub-agents.

### Customization

Marketplace replacement is extracted to `.claude/skills/validate-skill/`. Teams can customise: quality check criteria, test prompt categories and scoring rubric, companion recommendation scoring. Output file names and YAML frontmatter schemas are app-controlled contracts.

---

## Skill-Test Skill

`skill-test` provides the test context and evaluation rubric injected into both workspaces during a skill test run. It contains no sub-agents and no references directory — it is a context-only skill consumed directly via workspace CLAUDE.md injection.

Used by:
- **Tauri app** — `prepare_skill_test()` reads its body and injects it into both temp workspaces before each test run

### Structure

```
skills/skill-test/
  SKILL.md     ← two sections: Test Context + Evaluation Rubric
```

### Sections

**Test Context** — loaded by both plan agents. Orients the agent as an analytics engineer working in a dbt lakehouse in plan mode. Defines five focus areas the agent should orient toward: silver vs gold layer, dbt project structure, dbt tests, dbt contracts, and semantic model.

**Evaluation Rubric** — loaded by the evaluator agent. Defines six scoring dimensions (silver vs gold, dbt project structure, dbt tests, unit test cases, dbt contracts, semantic model), scoring rules (comparative A vs B only, skip irrelevant dimensions, no surface observations), and output format (↑/↓ prefixed bullet points only).

Both plan agents see the full SKILL.md in their workspace context but are only instructed to respond to the user prompt. The evaluator is explicitly asked to use the rubric via its prompt.
