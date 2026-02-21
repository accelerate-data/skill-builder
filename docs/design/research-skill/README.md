# Research Skill — Design Note

**Issue:** VD-851
**Status:** Design finalized, pending implementation

---

## Problem

The skill generation workflow's research phase is implemented as 21 separate agent files: `research-orchestrator.md`, `research-planner.md`, `consolidate-research.md`, and 18 dimension agents (`research-entities.md`, `research-metrics.md`, etc.). These are all deployed as flat files into `.claude/agents/` and belong to no clear ownership boundary.

This creates three problems:

1. **Not distributable.** Teams cannot swap out the research phase. All research logic is baked into the app bundle — if a team wants different dimensions or a different research strategy, they have to fork the app.
2. **Not updatable.** All 21 files ship together and can only be changed via an app release.
3. **Spread logic.** Research behavior is defined across 21 files with no single document describing what the research phase does or how to customize it.

The research phase has a stable contract: given `skill_type` and `domain`, produce `clarifications.md`. It is a natural candidate to be packaged as a distributable skill.

---

## Approach

Split the research phase into two layers:

| Layer | What | Owned by |
|---|---|---|
| **App-bundled** | `research-orchestrator.md` | App release |
| **Research skill** | Coordinator + dimension specs + scoring + consolidation logic | Skill package (marketplace-updatable) |

The orchestrator is the app's entry point for step 0 — it stays app-bundled and unchanged from the app's perspective.

Everything between them — dimension selection, scoring, parallel research, and consolidation — moves into the research skill. The skill is a **proper coordinator** (`SKILL.md` with full instructions) backed by reference files. It has no spawnable agent files of its own: dimension specs live in `references/dimensions/` and are passed inline to `general-purpose` Tasks when research runs.

The result: 20 agent files (planner + 18 dimensions + consolidator) are replaced by one skill with reference files.

### How the orchestrator uses the skill

The orchestrator reads `.claude/skills/research/SKILL.md` and follows its instructions — the skill coordinator runs within the orchestrator's execution context. The orchestrator's external interface is unchanged:

- **Input** (from app): `skill_type`, `domain`, context directory
- **Output** (to app): `context/clarifications.md` written to disk

The app's Rust workflow pipeline (`workflow.rs` step 0) is **zero-change**.

---

## Skill structure

```
agent-sources/workspace/skills/research/
  SKILL.md                        ← coordinator with full instructions
  references/
    dimension-sets.md             ← type-scoped dimension tables (domain/de/platform/source)
    scoring-rubric.md             ← scoring criteria + research-plan.md format spec
    consolidation-handoff.md      ← canonical clarifications.md format spec (extracted from docs/design/clarifications-rendering/canonical-format.md)
    dimensions/
      entities.md                 ← dimension research spec (focus, approach, success criteria)
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

### SKILL.md instructions (summary)

The research skill is a **pure computation unit** — it takes inputs, returns inline text, and writes nothing to disk. It has no knowledge of context directories or file paths.

The coordinator does four things in sequence:

**1. Select dimension set**
Read `references/dimension-sets.md`, select the 5–6 dimensions for the given `skill_type`.

**2. Score and select**
Score each dimension against the domain inline (using `references/scoring-rubric.md`). No Opus planner sub-agent — the skill's own extended thinking handles this. Select top 3–5.

**3. Parallel dimension research**
For each selected dimension, spawn a `Task(subagent_type: "general-purpose")` with the dimension spec from `references/dimensions/{slug}.md` plus the domain and tailored focus line embedded inline. Launch all in the same turn for parallelism. Wait for all to return their research text.

**4. Consolidate**
Deduplicate and synthesize all dimension findings into `clarifications.md` format, following `references/consolidation-handoff.md` exactly. That reference contains the full canonical format spec (YAML frontmatter fields, heading hierarchy, question template, choice/recommendation/answer field rules, ID scheme). Produce the complete `clarifications.md` content as inline text — including the YAML frontmatter with `question_count`, `sections`, `duplicates_removed`, and `refinement_count`.

**Return to orchestrator** — inline text containing:
- Scored dimension table (scores, reasons, companion notes, tailored focus lines)
- Complete `clarifications.md` content, formatted per the canonical spec

The skill never calls Write. It has no knowledge of context directories.

### What the orchestrator does with the returned text

The orchestrator receives the skill's inline response and handles all file I/O:

1. Write `context/research-plan.md` from the scored dimension table in the response
2. Write `context/clarifications.md` from the formatted clarifications content in the response

---

## Outputs preserved

| Output | Written by | Format |
|---|---|---|
| `context/research-plan.md` | Orchestrator (from skill's inline response) | Scores table + selected dimensions (same as today) |
| `context/clarifications.md` | Orchestrator (from skill's inline response) | Canonical format — identical to today's output |

Both files are identical in format to the current implementation. No downstream agents (`detailed-research`, `confirm-decisions`, `generate-skill`, `validate-skill`) require any changes.

The skill produces correctly-formatted `clarifications.md` content because `references/consolidation-handoff.md` contains the full canonical spec: YAML frontmatter fields, heading hierarchy (`# Research Clarifications` → `## Section` → `### Q{n}:` → `#### Refinements` → `##### R{n}.{m}:`), question template (body, choices, `**Recommendation:**`, `**Answer:**`), and all formatting rules. This is the same spec the app's Rust parser and UI renderer depend on.

---

## App impact: zero

The Rust workflow pipeline is unchanged end-to-end:

```
workflow.rs step 0
  prompt_template: "research-orchestrator.md"   ← unchanged
  output_file: "context/clarifications.md"      ← unchanged
  max_turns: 50                                  ← unchanged
```

The orchestrator's **content** changes (it now loads and follows the research skill rather than spawning 19 sub-agents directly), but this is a prompt change not a code change. No DB migrations. No new Rust functions. No changes to `skill.rs`, `types.rs`, or `workflow.rs`.

The research skill does not need the `deploy_skill_agents` mechanism from the earlier design because it has no `agents/` directory to deploy. It is a pure `SKILL.md` + `references/` skill — the same shape as `skill-builder-practices`.

---

## Plugin / T1-T4 compatibility

The dimension agent files (`research-entities.md`, `research-planner.md`, etc.) currently live in `agents/` and are resolved by the Claude Code CLI via `skill-builder:{name}`. After this change, those files no longer exist — the research skill uses `general-purpose` Tasks with inline prompts instead.

The plugin's coordinator (`skills/generate-skill/SKILL.md`) calls `skill-builder:research-orchestrator`. The orchestrator now reads the research skill from `.claude/skills/research/SKILL.md`. For the plugin, this path resolves relative to `CLAUDE_PLUGIN_ROOT`.

**No build-sync script needed** — there are no agent files to mirror. The skill's reference files (`references/dimensions/*.md`) are read by the skill coordinator at runtime, not by the plugin CLI's agent resolution.

T1–T4 test impact: the orchestrator's prompt changes, so T1 (single-agent smoke test) will reflect the new behaviour. T2–T4 run through the full workflow and validate `clarifications.md` format — these pass as long as the output contract is unchanged.

---

## What stays in `agents/`

```
agents/
  research-orchestrator.md   ← step 0 entry point (content simplified, interface unchanged)
  detailed-research.md       ← step 3 (unchanged)
  confirm-decisions.md       ← step 5 (unchanged)
  generate-skill.md          ← step 6 (unchanged)
  validate-skill.md          ← step 7 (unchanged)
  answer-evaluator.md
  companion-recommender.md
  refine-skill.md
  test-skill.md
```

`research-planner.md`, `consolidate-research.md`, and the 18 dimension agents are deleted — their logic moves into the research skill.

---

## Customization model

When a team imports a replacement research skill from the marketplace (VD-696):

1. `upload_skill_inner` extracts the zip to `.claude/skills/research/`
2. The orchestrator reads `.claude/skills/research/SKILL.md` — it now follows the custom skill's coordinator instructions
3. The custom skill's `references/dimensions/` specs drive what questions get asked
4. The team can deactivate to revert to the bundled defaults

Teams can customise:
- Which dimensions are included per skill type
- The scoring rubric and selection threshold
- The research approach and focus for each dimension
- The format of the research text returned to the consolidator

Teams cannot override the orchestrator or consolidator this way — those remain app-controlled.

---

## Files changed

| File | Change |
|---|---|
| `agents/research-planner.md` | **Delete** |
| `agents/research-{dim}.md` × 18 | **Delete** (18 files) |
| `agents/consolidate-research.md` | **Delete** — consolidation absorbed into research skill |
| `agents/research-orchestrator.md` | **Rewrite** — loads research skill, writes both output files from returned text |
| `agent-sources/workspace/skills/research/SKILL.md` | **Create** |
| `agent-sources/workspace/skills/research/references/**` | **Create** (dimension-sets, scoring-rubric, consolidation-handoff with canonical clarifications.md spec, 18 dimension specs) |
| `skills/generate-skill/SKILL.md` | **No change** |
| `app/src-tauri/src/commands/workflow.rs` | **No change** |
| `app/src-tauri/src/commands/skill.rs` | **No change** |
| `app/src-tauri/src/db.rs` | **No change** |
| `app/tests/TEST_MANIFEST.md` | **Update** — note removed agent files, updated T1 scope |

---

## Out of scope

- Changing the consolidator's behaviour or interface
- Changing how `clarifications.md` is consumed downstream
- UI for browsing or editing research skill reference files
- Multiple simultaneous research skill overrides
- Making the orchestrator or consolidator marketplace-updatable (separate concern)
