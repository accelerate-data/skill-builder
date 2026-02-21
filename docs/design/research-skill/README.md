# Research Skill — Design Note

**Issue:** VD-851
**Status:** Implemented

---

## Problem

The workflow's research phase was implemented as 21 separate agent files:
`research-orchestrator.md`, `research-planner.md`, `consolidate-research.md`, and 18
dimension agents. These were deployed as flat files into `.claude/agents/` with no
ownership boundary and no way to update them independently of an app release.

This made the research phase impossible to distribute — teams could not swap it out,
extend it, or update it without forking the app.

---

## Approach

Split into two layers:

| Layer | What | Owned by |
|---|---|---|
| **App-bundled agent** | `research-orchestrator.md` | App release |
| **Research skill** | Coordinator + dimension specs + scoring + consolidation logic | Skill package (marketplace-updatable) |

The orchestrator is the app's entry point for step 0 — its external interface is
unchanged. Everything between the orchestrator and the output files — dimension
selection, scoring, parallel research, consolidation — moves into the research skill.

**20 agent files deleted** (`research-planner.md`, `consolidate-research.md`, 18
dimension agents). Their logic now lives in `agent-sources/workspace/skills/research/`.

---

## Skill Structure

```
agent-sources/workspace/skills/research/
  SKILL.md                        ← coordinator with full instructions
  references/
    dimension-sets.md             ← type-scoped dimension tables (5–6 per type)
    scoring-rubric.md             ← scoring criteria (1–5) and selection rules
    consolidation-handoff.md      ← canonical clarifications.md format spec
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

---

## How It Works

The research skill is a **pure computation unit** — it takes inputs, returns inline
text, and writes nothing to disk. The orchestrator handles all file I/O.

**Step 1 — Select dimension set.** Read `references/dimension-sets.md`, identify the
5–6 candidate dimensions for the given `skill_type`.

**Step 2 — Score and select (inline, extended thinking).** Score each candidate against
the domain using `references/scoring-rubric.md`. Select top 3–5 by score.

**Step 3 — Parallel dimension research.** For each selected dimension, read its spec
from `references/dimensions/{slug}.md`. Spawn one sub-agent per dimension with the spec
content plus domain and tailored focus line embedded inline. All sub-agents launch in
the same turn.

**Step 4 — Consolidate.** Synthesize all dimension outputs into `clarifications.md`
format, following `references/consolidation-handoff.md` exactly — the full canonical
format spec (YAML frontmatter fields, heading hierarchy, question template, ID scheme,
choice/recommendation/answer fields).

**Return format** — inline text with two delimited sections:

```
=== RESEARCH PLAN ===
[scored dimension table + selected dimensions]
=== CLARIFICATIONS ===
[complete clarifications.md content including YAML frontmatter]
```

**Orchestrator writes:** extracts each section and writes to disk:
- `=== RESEARCH PLAN ===` → `context/research-plan.md`
- `=== CLARIFICATIONS ===` → `context/clarifications.md`

Both files are format-identical to the previous implementation. No downstream agents
require any changes.

---

## App Integration

The Rust workflow pipeline is unchanged end-to-end:

```
workflow.rs step 0
  prompt_template: "research-orchestrator.md"   ← unchanged
  output_file: "context/clarifications.md"      ← unchanged
```

The orchestrator's content changed (it now invokes the research skill rather than
spawning 19 sub-agents directly), but this is a prompt change, not a code change. No
DB migrations, no new Rust commands, no changes to `workflow.rs`, `skill.rs`, or `db.rs`.

The research skill is seeded into the workspace on startup by `seed_bundled_skills` —
the same generic mechanism that seeds `skill-builder-practices`. No custom seeding logic.

---

## Customization Model

When a team imports a replacement research skill from the marketplace:

1. `upload_skill_inner` extracts the zip to `.claude/skills/research/`
2. The orchestrator reads `.claude/skills/research/SKILL.md` — the custom skill's
   coordinator instructions now drive research
3. The custom skill's `references/dimensions/` specs control which questions get asked
4. The team can deactivate to revert to the bundled defaults

Teams can customise: which dimensions are included per skill type, the scoring rubric
and selection threshold, the research approach and focus for each dimension, and the
format of the consolidation output.

The orchestrator and the `clarifications.md` format contract are app-controlled and
not overridable this way.
