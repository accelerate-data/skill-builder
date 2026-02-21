# Research Skill — Design Note

---

## Overview

`research-orchestrator` is the agent responsible for the research phase of the Skill Builder workflow. It is invoked in two contexts:

1. **Tauri app** — `workflow.rs` step 0 runs the agent via the sidecar. The output file (`context/clarifications.md`) is the app's contract for proceeding to step 1 (Review).
2. **Plugin workflow** — the coordinator (`skills/generate-skill/SKILL.md`) spawns it via `Task(subagent_type: "skill-builder:research-orchestrator")` during the Research phase.

In both cases the agent is identical; only the caller differs.

---

## Skill Structure

```
agent-sources/workspace/skills/research/
  SKILL.md                        ← coordinator with full instructions
  references/
    dimension-sets.md             ← type-scoped dimension tables (5–6 per type)
    scoring-rubric.md             ← scoring criteria (1–5) and selection rules
    consolidation-handoff.md      ← clarifications.md format spec for the consolidation step
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

The bundled skill is seeded into the workspace on startup by `seed_bundled_skills` alongside `validate-skill` and `skill-builder-practices`.

---

## How It Works

The research skill is a **pure computation unit** — it takes inputs, returns inline text, and writes nothing to disk. The orchestrator handles all file I/O.

**Step 1 — Select dimension set.** Read `references/dimension-sets.md`, identify the 5–6 candidate dimensions for the given `skill_type`.

**Step 2 — Score and select (inline, extended thinking).** Score each candidate against the domain using `references/scoring-rubric.md`. Select top 3–5 by score.

**Step 3 — Parallel dimension research.** For each selected dimension, read its spec from `references/dimensions/{slug}.md`. Spawn one sub-agent per dimension with the spec content plus domain and tailored focus line embedded inline. All sub-agents launch in the same turn.

**Step 4 — Consolidate.** Synthesize all dimension outputs into `clarifications.md` format, following `references/consolidation-handoff.md` — the canonical format spec covering YAML frontmatter fields, heading hierarchy, question template, ID scheme, and choice/recommendation/answer fields.

**Return format** — inline text with two delimited sections:

```
=== RESEARCH PLAN ===
[scored dimension table + selected dimensions]
=== CLARIFICATIONS ===
[complete clarifications.md content including YAML frontmatter]
```

**Orchestrator writes:** extracts each section and writes to disk:
- `=== RESEARCH PLAN ===` → `{context_dir}/research-plan.md`
- `=== CLARIFICATIONS ===` → `{context_dir}/clarifications.md`

After writing, the orchestrator checks whether `clarifications.md` contains `scope_recommendation: true` in its YAML frontmatter. If detected, it surfaces this to the caller and stops — the domain scope is too broad for skill generation.

Output file formats are defined in [`../agent-specs/canonical-format.md`](../agent-specs/canonical-format.md).

---

## Customization Model

When a team imports a replacement research skill from the marketplace:

1. `upload_skill_inner` extracts the zip to `.claude/skills/research/`
2. The orchestrator reads `.claude/skills/research/SKILL.md` — the custom skill's coordinator instructions now drive research
3. The custom skill's `references/dimensions/` specs control which questions get asked
4. The team can deactivate to revert to the bundled defaults

Teams can customise: which dimensions are included per skill type, the scoring rubric and selection threshold, the research approach and focus for each dimension, and the consolidation logic. The orchestrator and the `clarifications.md` format contract are app-controlled and not overridable.
