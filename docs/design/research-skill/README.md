# Research Skill — Design Note

**Issue:** VD-851
**Status:** Design finalized, pending implementation

---

## Problem

The skill generation workflow's research phase is implemented as 21 separate agent files: `research-orchestrator.md`, `research-planner.md`, `consolidate-research.md`, and 18 dimension agents (`research-entities.md`, `research-metrics.md`, etc.). These are all deployed as flat files into `.claude/agents/` and belong to no clear ownership boundary.

This creates three problems:

1. **Not distributable.** Teams cannot swap out the research phase. All research logic is baked into the app bundle — if a team wants different dimensions or a different research strategy, they have to fork the app.
2. **Not updatable.** The orchestrator and all 19 research agents ship together and can only be updated via an app release.
3. **Spread logic.** Research behavior is defined across 21 files with no single document describing what the research phase does or how to customize it.

The research phase has a stable contract: given `skill_type` and `domain`, produce `clarifications.md`. It's a natural candidate to be packaged as a distributable skill.

---

## Approach

Split the research phase into two layers:

| Layer | What | Owned by |
|---|---|---|
| **App-bundled** | `research-orchestrator.md`, `consolidate-research.md` | App release |
| **Research skill** | `research-planner.md` + 18 dimension agents | Skill package (marketplace-updatable) |

The orchestrator and consolidator are the structural glue of the research phase — they define how it integrates with the workflow. They stay app-bundled. The planner and dimension agents contain the research *content* (what questions to ask, how to score dimensions) — these move into a distributable skill package.

The orchestrator's interface is unchanged: it still spawns `skill-builder:research-planner`, `skill-builder:research-entities`, etc. Those agent names are resolved from `.claude/agents/` as today. The only difference is *how* they get there — via skill deployment instead of the app's flat agent bundle.

---

## Skill structure

```
agent-sources/workspace/skills/research/
  SKILL.md                   ← metadata: name=research, type=skill-builder
  agents/
    research-planner.md      ← moved from agents/
    research-entities.md     ← moved from agents/
    research-metrics.md
    research-data-quality.md
    research-business-rules.md
    research-segmentation-and-periods.md
    research-modeling-patterns.md
    research-pattern-interactions.md
    research-load-merge-patterns.md
    research-historization.md
    research-layer-design.md
    research-platform-behavioral-overrides.md
    research-config-patterns.md
    research-integration-orchestration.md
    research-operational-failure-modes.md
    research-extraction.md
    research-field-semantics.md
    research-lifecycle-and-state.md
    research-reconciliation.md
```

`SKILL.md` is a minimal metadata file:

```yaml
---
name: research
type: skill-builder
description: >
  Research phase skill for Skill Builder. Provides the planner and 18 dimension
  agents used by the research orchestrator to generate clarifications.md.
---
```

No instructions. No trigger. The skill's entire effect is agent deployment — when active, its `agents/` are available at `.claude/agents/`. When a team imports a custom research skill from the marketplace, their agents replace the defaults.

---

## App changes

### Agent deployment pipeline — new layer

Today:
```
agents/*.md  →  copy_agents_to_claude_dir  →  .claude/agents/
```

After this change:
```
agents/*.md  →  copy_agents_to_claude_dir  →  .claude/agents/   (base: orchestrator, consolidator, etc.)
skills/research/agents/*.md  →  deploy_skill_agents  →  .claude/agents/   (overlay: planner + 18 dims)
```

Skill agents deploy on top of base agents. For the research skill, there are no name conflicts because the orchestrator and consolidator have distinct names.

### New functions in `skill.rs`

```rust
fn deploy_skill_agents(skill_dir: &Path, workspace_path: &str) -> Result<(), String>
```
Copies `{skill_dir}/agents/*.md` → `.claude/agents/`. Called when a skill-builder skill is activated.

```rust
fn remove_skill_agents(skill_dir: &Path, workspace_path: &str) -> Result<(), String>
```
Deletes matching agent filenames from `.claude/agents/`. Called when a skill-builder skill is deactivated or deleted.

### Wiring in `skill.rs`

| Function | Change |
|---|---|
| `upload_skill_inner` | After extraction: if `skill_type == "skill-builder"` and `agents/` exists → `deploy_skill_agents` |
| `seed_bundled_skills` | After copy: if skill-builder and active → `deploy_skill_agents` |
| `toggle_skill_active_inner` | Activate → `deploy_skill_agents`; deactivate → `remove_skill_agents` |
| `delete_imported_skill_inner` | Before dir deletion → `remove_skill_agents` |

### CLAUDE.md generation — `workflow.rs`

`generate_skills_section` must skip `type: skill-builder` skills. They have no user-facing trigger — adding them to CLAUDE.md would register them as conversation skills, which is incorrect. Skill-builder skills are agent bundles, not Claude Code skills.

### DB migration (migration 14) — `db.rs`

Add `skill_type TEXT` column to `imported_skills` table so `generate_skills_section` and toggle/delete don't need to read SKILL.md from disk on every operation.

```sql
ALTER TABLE imported_skills ADD COLUMN skill_type TEXT;
```

Backfill existing rows to `NULL` (treated as non-skill-builder). Add `skill_type` to `ImportedSkill` struct in `types.rs`.

### `ensure_workspace_prompts` ordering

No change needed. The existing flow already works:
1. `copy_agents_to_claude_dir` deploys base agents (orchestrator, consolidator, etc.)
2. `seed_bundled_skills` deploys bundled skills, including `deploy_skill_agents` for the research skill

Base agents deploy first; skill agents overlay second. On conflict, skill agents win — this is intentional (marketplace update overrides default).

---

## Plugin / T1-T4 compatibility

The Claude Code CLI plugin resolves `skill-builder:research-planner` from `agents/research-planner.md` in the plugin root. If the planner and dimension agents move out of `agents/`, T1-T4 tests break.

**Resolution: build-time sync via `scripts/build-research-skill.sh`**

The research skill (`skills/research/agents/`) is the source of truth for dimension agent content. A new script mirrors these files into `agents/` for plugin use:

```bash
scripts/build-research-skill.sh        # sync skills/research/agents/ → agents/
scripts/build-research-skill.sh --check # CI: verify agents/ matches skills/research/agents/
```

Same pattern as `scripts/build-plugin-skill.sh` which syncs `agent-sources/workspace/CLAUDE.md` into `skills/generate-skill/references/`.

Plugin tests (T1-T4) run after the build step. `agents/` entries for the planner and dimension agents become generated artifacts, not sources. Edits to dimension agents happen in `skills/research/agents/`.

---

## What stays in `agents/`

After the migration, `agents/` contains only app-owned agents:

```
agents/
  research-orchestrator.md   ← step 0 entry point
  consolidate-research.md    ← post-research consolidation
  detailed-research.md       ← step 3
  confirm-decisions.md       ← step 5
  generate-skill.md          ← step 6
  validate-skill.md          ← step 7
  answer-evaluator.md
  companion-recommender.md
  refine-skill.md
  test-skill.md
```

`research-planner.md` and the 18 dimension agents are removed.

---

## Customization model

When a team imports a replacement research skill from the marketplace:

1. `upload_skill_inner` extracts the zip to `.claude/skills/research/`
2. `deploy_skill_agents` copies the skill's `agents/*.md` to `.claude/agents/`, overwriting the defaults
3. The orchestrator spawns the same agent names — but now they execute the custom prompts
4. The team can deactivate to revert to the bundled defaults

The orchestrator and consolidator are never in the skill package — they cannot be overridden this way. Teams that need to change the orchestration structure would need a different mechanism (out of scope for VD-851).

---

## Files changed

| File | Change |
|---|---|
| `agents/research-planner.md` | Delete (moved to skill) |
| `agents/research-{dim}.md` × 18 | Delete (moved to skill) |
| `agent-sources/workspace/skills/research/SKILL.md` | Create |
| `agent-sources/workspace/skills/research/agents/*.md` | Create (19 files moved) |
| `scripts/build-research-skill.sh` | Create (sync skill agents → agents/ for plugin) |
| `app/src-tauri/src/db.rs` | Migration 14: skill_type on imported_skills |
| `app/src-tauri/src/types.rs` | skill_type field on ImportedSkill |
| `app/src-tauri/src/commands/skill.rs` | deploy/remove skill agents; wiring |
| `app/src-tauri/src/commands/workflow.rs` | Filter skill-builder from CLAUDE.md |
| `app/tests/TEST_MANIFEST.md` | Update notes on research agent source |

---

## Out of scope

- Changing the orchestrator's behavior or interface
- UI for browsing/previewing skill agents
- Multiple simultaneous research skill overrides
- Orchestrator or consolidator as marketplace-updatable (separate concern)
