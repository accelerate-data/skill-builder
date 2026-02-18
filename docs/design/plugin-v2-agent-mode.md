# Plugin v2: Agent Mode Architecture

> The plugin and app share agents but need different flows. This doc designs
> the plugin's own coordinator: an agent-mode router that dynamically selects
> agents based on conversation context, supports offline clarifications, and
> follows Claude skill best practices.

---

## 1. Motivation

The plugin and the desktop app share the same 26 agents but have fundamentally
different runtime contexts. The app has a Tauri frontend with a sidecar runtime
that orchestrates agents through its own UI-driven flow. The plugin runs inside
Claude Code where the coordinator is a SKILL.md prompt. Trying to keep the
coordinator logic the same between both doesn't work -- the plugin needs its
own flow optimized for the Claude Code context.

### What's changing

1. **Agent mode** -- the current plugin coordinator is a rigid 7-step sequential
   script. Users must march through every phase even when they already have
   answers, want to skip research, or just need to regenerate one section. Real
   skill-building happens iteratively, over days, at the user's own pace. The
   new coordinator should work like an intelligent assistant: the user triggers
   it, describes what they need, and Claude dynamically selects which agents to
   bring in based on the conversation and filesystem state.

2. **Offline clarifications** -- the plugin generates clarification questions
   that users need domain expertise to answer. Users should be able to receive
   questions, close their terminal, answer over days, and resume seamlessly.
   The current flow assumes a single continuous session.

3. **dbt specialization** -- the generated skills should be targeted and
   directional, kicking in when someone uses Claude Code to build dbt silver
   and gold models. The output should focus on what a data engineer or analytics
   engineer actually needs. This benefits both the plugin and the app since the
   agents and content guidelines are shared.

### While we're here

- Rename the skill from `generate-skill` to `building-skills` to follow the
  gerund naming convention recommended by Claude skill best practices.

### Goals

- Design a plugin-specific coordinator flow (agent-mode router)
- Keep all 26 agents unchanged and shared between app and plugin
- Replace the rigid 7-step flow with a state-aware router that dynamically
  selects agents based on conversation context
- Support offline clarifications (user answers over days, resumes later)
- Follow Claude skill best practices (gerund naming, progressive disclosure,
  description-driven discovery)
- Specialize output for dbt silver/gold model building
- Make the plugin fast and flexible (adaptive depth, multiple workflow modes,
  lighter models where possible)

### Non-goals

- Changing agent prompts or frontmatter (shared with app)
- Changing the app's coordinator or sidecar runtime
- Changing the 4 skill types or research dimension catalog

---

## 2. Architecture: Hybrid Backbone with Conversational Flexibility

### Why this approach

Four architectures were evaluated:

| Option | Description | Verdict |
|--------|-------------|---------|
| **A: Smart Coordinator** | Current rigid flow + auto-detection | Too rigid -- just bolts routing onto sequential steps |
| **B: Micro-Skills** | 5-6 separate skills, one per phase | State coordination breaks; Claude's LLM skill matching too fragile for phase distinctions |
| **C: Pure Conversational** | Single agent, no phases, pure chat | Non-deterministic, untestable, risk of skipping critical steps |
| **D: Hybrid** | Structured phases as backbone, flexible entry/exit | Preserves domain knowledge, supports offline, testable, evolves toward C |

**Option D** is the recommendation. The phases encode real domain knowledge
about what must happen and in what order. Making them flexible (skippable,
resumable, non-linear) gives users freedom without losing quality guardrails.

### How the router works

```
User message arrives
  ├─ Read filesystem state (what artifacts exist?)
  ├─ Classify user intent (what do they want?)
  └─ Dispatch based on (state, intent) tuple

State × Intent → Action matrix:

| Filesystem State              | User Intent           | Action                              |
|-------------------------------|-----------------------|-------------------------------------|
| Empty                         | "Build me a skill"    | Scoping phase                       |
| Empty                         | Specific domain named | Scoping with pre-filled domain      |
| clarifications.md exists      | "I answered them"     | Check answers → decisions or refine |
| clarifications.md, unanswered | Continues session     | Show clarification status, prompt   |
| decisions.md exists           | Continues             | Generate skill                      |
| SKILL.md exists               | "Validate"            | Run validation only                 |
| SKILL.md exists               | "Improve X section"   | Targeted regeneration               |
| Any                           | Process question      | Answer about the process            |
| Any                           | "Skip ahead"          | Jump forward, auto-fill defaults    |
| Any                           | "Start fresh"         | Delete artifacts, begin scoping     |
```

### Phase backbone

The phases still exist conceptually, but the router navigates them adaptively:

```
Scoping → Research → Clarification → [Refinement] → Decisions → Generation → Validation
   │          │           │                │             │            │           │
   │          │           │                │             │            │           └─ Loop to Generation
   │          │           │                │             │            └─ Targeted regen possible
   │          │           │                │             └─ Auto-proceed if answers are unambiguous
   │          │           │                └─ OPTIONAL (skip if answers are detailed)
   │          │           └─ ASYNC (user can leave for days)
   │          └─ Skippable (user provides spec → jump to Decisions)
   └─ Can pre-fill from user's first message
```

### Agent dispatch

The router dispatches agents via the `Task` tool. Each `Task` call spawns a
sub-agent, runs it, and returns the result. Multiple `Task` calls in the same
turn run in parallel. This is how the agents themselves already work internally
(research-orchestrator spawns dimension agents via `Task`).

The current coordinator also uses `TeamCreate`, `TaskCreate`, `SendMessage`,
and `TeamDelete` for team lifecycle management around agent dispatch. The new
router replaces this with direct `Task` calls and filesystem-based state
tracking, which is simpler and sufficient for the plugin's needs:

| Current | Router Replacement |
|---------|-------------------|
| `TeamCreate` / `TeamDelete` | Not needed -- no team lifecycle to manage |
| `TaskCreate` | Not needed -- router tracks state via `.session.json` and filesystem artifacts |
| `SendMessage` | Not needed -- spawn a new `Task` with feedback context instead |

---

## 3. Directory Structure

### Two directories, clearly separated

The current design mixes internal state (`context/`) with deployable output
(`SKILL.md` + `references/`) inside a single `<skillname>/` directory. This
makes it hard to move the skill output, pollutes the deliverable with working
files, and gives agents no consistent place to look for things.

Formalize three concepts:

| Concept | Purpose | Contents |
|---------|---------|----------|
| **Plugin workspace** (`.vibedata/`) | Plugin internals — state, logs, config | Session manifests, logs, plugin config. Local only, never committed. |
| **Skill context** (`<skill-dir>/context/`) | User-facing working files | `clarifications.md`, `decisions.md`, `agent-validation-log.md`, `test-skill.md` — files the user reads and edits |
| **Skill output** (`<skill-dir>/`) | Deployable skill | `SKILL.md` + `references/` |

### Layout

```
.vibedata/                                  # Plugin workspace (local only)
├── plugin/                                 # Cross-skill plugin data
│   ├── config.json                         # Plugin settings, preferences
│   └── dimension-cache.json                # Cached planner selections (optional)
│
├── sales-pipeline/                         # Per-skill internal state
│   ├── session.json                        # Session state (phase, progress, skill-dir path)
│   └── logs/                               # Agent execution logs (optional)
│
└── revenue-recognition/                    # Another skill's internal state
    ├── session.json
    └── ...

./sales-pipeline/                           # Skill dir (location configurable)
├── SKILL.md                                # Deployable skill
├── references/                             # Deployable reference files
│   ├── entity-model.md
│   └── metrics.md
└── context/                                # User-facing working files
    ├── clarifications.md                   # Questions for the user to answer
    ├── decisions.md                        # Synthesized decisions for user review
    ├── agent-validation-log.md             # Validation results for user review
    └── test-skill.md                       # Test prompt results for user review
```

### Key principles

1. **Plugin workspace is internal** -- `.vibedata/` is a local plugin data
   directory. Users never need to look inside it. Session state, logs, and
   plugin config live here.

2. **Context is user-facing** -- `<skill-dir>/context/` contains files the user
   needs to read and edit: `clarifications.md` (answer questions here) and
   `decisions.md` (review decisions here). These live alongside the skill output
   so the user can find them naturally.

3. **Skill output is the deliverable** -- `SKILL.md` + `references/` at the
   skill dir root. Clean enough to copy, zip, or `git add` directly. The
   `context/` folder can be excluded from deployment.

4. **Skill dir location is configurable** -- `session.json` tracks where the
   skill dir lives via a `skill_dir` field. Default is `./<skill-name>/` in the
   user's CWD, but the user can move it anywhere.

5. **Moving the skill dir is first-class** -- the router supports:
   - "Move my skill to `./skills/sales-pipeline/`"
   - Updates `session.json.skill_dir`, moves the files, done. All agents
     resolve paths from the session manifest, so nothing else breaks.

6. **Cross-skill data persists** -- `.vibedata/plugin/` survives across skills.
   Dimension caching, user preferences, and plugin config live here.

### Path resolution for agents

The coordinator passes three paths to every agent:

| Parameter | Source | Example |
|-----------|--------|---------|
| `workspace_dir` | `.vibedata/<skill-name>/` | `.vibedata/sales-pipeline/` |
| `context_dir` | `<skill-dir>/context/` | `./sales-pipeline/context/` |
| `skill_dir` | from `session.json.skill_dir` | `./sales-pipeline/` |

Agents read/write internal state (session, logs) to `workspace_dir`.
Agents read/write user-facing files (clarifications, decisions, validation logs) to `context_dir`.
Agents write deployable output (SKILL.md, references) to `skill_dir`.
No agent constructs paths on its own — the coordinator provides them.

### Session manifest (`session.json`)

Lives at `.vibedata/<skill-name>/session.json`:

```json
{
  "skill_name": "sales-pipeline",
  "skill_type": "domain",
  "domain": "sales pipeline analytics",
  "skill_dir": "./sales-pipeline/",
  "created_at": "2026-02-15T10:30:00Z",
  "last_activity": "2026-02-18T14:20:00Z",
  "current_phase": "clarification",
  "phases_completed": ["scoping", "research"],
  "mode": "guided",
  "research_dimensions_used": ["entities", "metrics", "business-rules"],
  "clarification_status": {
    "total_questions": 15,
    "answered": 8
  },
  "auto_filled": false
}
```

### Artifact-to-phase mapping

State in `.vibedata/<skill-name>/`, user-facing files in `<skill-dir>/context/`:

| Artifact | Phase Completed |
|----------|-----------------|
| `session.json` with `phases_completed: ["scoping"]` | Scoping |
| `clarifications.md` (no Refinements) | Research |
| `clarifications.md` (answered, no Refinements) | Clarification |
| `clarifications.md` (with `#### Refinements`) | Refinement |
| `clarifications.md` (refinements answered) | Refinement review |
| `decisions.md` | Decisions |
| `SKILL.md` in skill dir | Generation |
| `agent-validation-log.md` + `test-skill.md` | Validation |

---

## 4. State Management

### Offline clarification flow

1. Research completes → coordinator writes `clarifications.md` to context dir + updates `session.json`
2. User told: "Questions are in `./sales-pipeline/context/clarifications.md`. Answer them whenever you're ready."
3. User closes terminal, answers over days
4. User returns, says "continue my skill" or triggers `/skill-builder:building-skills`
5. Router scans `.vibedata/` for skill workspaces, reads `session.json`, locates context dir
6. Counts answered vs unanswered questions in `clarifications.md`
7. Presents status: "Welcome back. 8 of 15 questions answered. 7 remaining."
8. User can: answer more, proceed with defaults for unanswered, or ask for help

### Auto-fill rule (existing, promote to first-class)

Empty `**Answer:**` fields use the `**Recommendation:**` as the answer. Surface
this as "express mode":

> "You have 7 unanswered questions. I can proceed using recommended defaults,
> or you can answer them first. Which do you prefer?"

---

## 5. Naming

### Skill rename

| Current | New |
|---------|-----|
| Skill directory | `skills/building-skills/` |
| Skill name (frontmatter) | `building-skills` |
| Plugin trigger | `/skill-builder:building-skills` |
| Description | "Build domain-specific Claude skills for dbt silver and gold layer modeling. Use when the user asks to create, build, or generate a new skill for data/analytics engineers. Handles domain, platform, source, and data-engineering skill types. Also use when the user says 'new skill', 'skill builder', 'I need a skill for [domain]', or 'help me build a skill'." |

### Agent names unchanged

Agent filenames (`agents/*.md`) stay as-is. Agents are not skills -- they don't
need gerund naming. The coordinator references them as
`skill-builder:<agent-name>`.

### Plugin manifest update

```json
{
  "name": "skill-builder",
  "version": "0.2.0",
  "description": "Multi-agent workflow for creating domain-specific Claude skills. Targets data/analytics engineers who need functional context for silver and gold table modeling.",
  "skills": "./skills/"
}
```

---

## 6. Workflow Modes

### Guided mode (default)

Full workflow with all phases. Best for first-time users or complex domains.

```
Scoping → Research → Clarification → Refinement → Decisions → Generation → Validation
```

### Express mode

User provides detailed requirements upfront or opts for recommended defaults.
Skips research and/or clarification phases.

```
Scoping → Decisions (from user spec) → Generation → Validation
```

Triggered by:
- User provides a detailed spec or existing documentation
- User says "proceed with defaults" at any clarification gate
- User says "skip research" or "I know what I want"

### Iterative mode

User has an existing skill and wants to improve it. Entry at any phase.

```
[Read existing skill] → Targeted Decisions → Targeted Generation → Validation
```

Triggered by:
- SKILL.md exists in the target directory
- User says "improve", "modify", "update", or "fix"

### Mode detection

The router infers the mode from the user's first message + filesystem state.
No explicit mode selection prompt needed -- it should feel natural.

---

## 7. Speed Optimizations

### Adaptive research depth

| Signal | Action |
|--------|--------|
| User provides detailed domain spec | Skip research entirely |
| First-round answers are specific and complete | Skip refinement (Step 3) |
| User says "proceed with defaults" | Auto-fill, skip to decisions |
| Skill type is data-engineering (narrow scope) | Use 3-5 dimensions, not 8+ |

### Model tier optimization

Current tiers are well-chosen but can be refined per dimension:

| Agent Group | Current | Proposed |
|-------------|---------|----------|
| Complex dimensions (entities, metrics, business-rules, modeling-patterns) | sonnet | sonnet (keep) |
| Simpler dimensions (config-patterns, reconciliation, field-semantics, lifecycle-and-state) | sonnet | haiku (save ~30% on research) |
| Research planner | opus | opus (keep -- critical reasoning) |
| Consolidation | opus | opus (keep -- cross-cutting synthesis) |

### Validation reduction

Current validation spawns ~15 sub-agents. Consolidate:

| Current | Proposed | Savings |
|---------|----------|---------|
| A (coverage) + B (SKILL.md quality) | Merge into 1 sonnet agent | -1 agent |
| D (boundary) + F (prescriptiveness) | Merge into 1 haiku agent | -1 agent |
| T1-T10 (10 test evaluators) | T1-T5 (5 test evaluators, still covering all 6 categories) | -5 agents |
| E (companion recommender) | Keep | -- |
| C1-CN (per-reference) | Keep | -- |

Net: ~40% reduction in validation phase agents.

### Progressive scoping

Before spawning the research planner, ask 2-3 scoping questions to give the
planner better input:

```
"What are the 2-3 most important things Claude gets wrong when working in this domain?"
"What makes your setup unique compared to standard [domain] implementations?"
```

Better planner input → fewer dimensions selected → fewer agents spawned → faster.

---

## 8. dbt Silver/Gold Specialization

### Current state

The plugin is already dbt-focused. Content guidelines target "data/analytics
engineers building silver and gold tables." The eval prompts are dbt-specific.

### Deepening the specialization

#### Silver/gold boundary guidance per skill type

Each generated skill should articulate where silver ends and gold begins:

| Skill Type | Silver Layer | Gold Layer |
|------------|-------------|------------|
| Domain | Cleaned, typed, deduplicated entities | Business metrics, aggregations, denormalized for BI |
| Platform | Platform-specific extraction handling | Platform-agnostic business layer |
| Source | Source-specific field mapping, type coercion, relationship resolution | Source-agnostic entity models |
| Data Engineering | Pattern implementation (SCD, CDC) | Pattern consumption (query patterns, materialization) |

#### dbt-specific research sub-concerns

Enhance existing dimensions with dbt focus:

| Dimension | dbt Sub-concern |
|-----------|-----------------|
| `layer-design` | Staging vs intermediate vs marts; `ref()` dependency chains |
| `modeling-patterns` | Model types (view, table, incremental, snapshot, ephemeral) |
| `config-patterns` | `dbt_project.yml`, custom materializations, meta fields |
| `load-merge-patterns` | `is_incremental()` macros, merge predicates, `unique_key` |

#### Activation trigger for generated skills

Skills built by this plugin should kick in when someone uses Claude Code to
build dbt models. The generated SKILL.md description should include:

```
Use when building dbt silver or gold layer models for [domain].
Also use when the user mentions "[domain] models", "silver layer",
"gold layer", "marts", "staging", or "[domain]-specific dbt".
```

---

## 9. Additional Improvements

### Skill templates

Pre-built partial skills for common dbt scenarios:

```
templates/
  dbt-incremental-silver/     # Incremental silver model patterns
  dbt-snapshot-scd2/          # SCD Type 2 with dbt snapshots
  salesforce-extraction/      # Salesforce → dbt pipeline
  revenue-domain/             # Revenue recognition domain
```

When a user's request matches a template, offer to start from it instead of
doing full research. Dramatically reduces time-to-value for common scenarios.

### Skill composition

Generated skills can declare dependencies:

```yaml
# In generated SKILL.md frontmatter
name: managing-sales-pipeline
depends_on:
  - salesforce-extraction    # Source skill
  - dbt-on-fabric           # Platform skill
```

Cross-references in the output: "For Salesforce-specific extraction patterns,
see the `salesforce-extraction` skill."

### Interactive + offline hybrid clarifications

Present the 3-4 most critical questions conversationally (right now), generate
the rest as a file for offline review:

```
Router: "Before I generate the full question set, let me ask the most
important ones. How do you define pipeline coverage?
  a) Open pipeline / Annual quota
  b) Open pipeline / Quarterly target
  c) Weighted pipeline / Adjusted target"

[user answers 3-4 questions]

Router: "Great. I've generated 12 more detailed questions in
./sales-pipeline/context/clarifications.md. Answer them whenever
you're ready -- I'll proceed with recommended defaults if you
want to skip ahead."
```

### Targeted regeneration

Instead of regenerating the entire skill, allow partial updates:

```
User: "The metrics section is missing win rate calculation"
Router: Spawns generate-skill with targeted prompt for just that section
        Uses Edit tool to update in-place rather than full rewrite
```

### Dimension caching

If a user builds multiple skills in the same domain family, cache the planner's
dimension selections:

```json
// .skill-builder-cache/dimension-selections.json
{
  "domain": {
    "common": ["entities", "metrics", "business-rules", "segmentation-and-periods"],
    "occasional": ["modeling-patterns", "layer-design"],
    "rare": ["extraction", "config-patterns"]
  }
}
```

---

## 10. Reference File Changes

### Current reference files (keep structure, update content)

| File | Changes |
|------|---------|
| `protocols.md` | Update dispatch examples to use direct `Task` calls. Document `workspace_dir` and `skill_dir` parameters that agents receive. |
| `file-formats.md` | Add `session.json` spec. Add workspace/skill dir layout. Keep clarifications/decisions format unchanged. |
| `content-guidelines.md` | Add silver/gold boundary guidance. Add dbt activation trigger template. |
| `best-practices.md` | Add gerund naming as default. Add skill composition guidance. |

### Build script update

`scripts/build-plugin-skill.sh` extracts from `agent-sources/workspace/CLAUDE.md`.
Update extraction boundaries if the source sections change. Add `.session.json`
format to the file-formats section.

---

## 11. Testing Impact

### Validation script (`scripts/validate.sh`)

| Check | Change |
|-------|--------|
| Skill directory name | Update from `generate-skill` to `building-skills` |
| Coordinator keywords | Replace team lifecycle checks with router pattern checks (filesystem state detection, intent classification). |
| Reference file content | Add `session.json` format check, workspace/skill dir layout check |

### Test tiers

| Tier | Impact |
|------|--------|
| T1 (Structural) | Update expected skill name, update coordinator keyword checks for router pattern |
| T2 (Plugin Loading) | Update trigger command to `/skill-builder:building-skills` |
| T3 (Start Mode) | Rewrite for new state detection (`.session.json` + artifacts) |
| T4 (Agent Smoke) | No change -- agents unchanged |
| T5 (Full E2E) | Rewrite for new flow (modes, adaptive depth) |

### New test scenarios

- **Offline resume**: Create artifacts, start new session, verify router detects state
- **Express mode**: Provide spec, verify research is skipped
- **Iterative mode**: Place existing SKILL.md, verify entry at decisions phase
- **Auto-fill**: Leave answers empty, verify recommendations are used
- **Targeted regen**: Request single-section improvement, verify partial update

---

## 12. Implementation Plan

18 Linear issues across 4 phases, tracked in the **Skill Builder** project.

### Phase 1: Structural Rename + Simplify Dispatch (Foundation)

Start here. VD-672 and VD-673 are independent and can be implemented in
parallel. VD-674 and VD-675 follow once both are done.

| Issue | Title | Size | Blocked By | Branch |
|-------|-------|------|------------|--------|
| [VD-672](https://linear.app/acceleratedata/issue/VD-672) | Rename skill from `generate-skill` to `building-skills` | S | -- | `feature/vd-672-rename-skill-from-generate-skill-to-building-skills` |
| [VD-673](https://linear.app/acceleratedata/issue/VD-673) | Simplify coordinator to direct Task dispatch | M | -- | `feature/vd-673-remove-team-primitives-from-coordinator-skillmd` |
| [VD-674](https://linear.app/acceleratedata/issue/VD-674) | Update validation script and T1/T2 tests for rename | S | VD-672, VD-673 | `feature/vd-674-update-validation-script-and-t1t2-tests-for-rename` |
| [VD-675](https://linear.app/acceleratedata/issue/VD-675) | Update plugin manifest and documentation for v2 | S | VD-672 | `feature/vd-675-update-plugin-manifest-and-documentation-for-v2` |

**Definition of done:** Plugin loads with `/skill-builder:building-skills`
trigger, coordinator uses direct `Task` dispatch, all T1/T2 tests pass.

### Phase 2: State-Aware Router (Core Architecture)

The critical path runs VD-676 → VD-677 → VD-678/VD-679 → VD-680. VD-677
(the router rewrite) is the largest and highest-priority issue.

| Issue | Title | Size | Blocked By | Branch |
|-------|-------|------|------------|--------|
| [VD-676](https://linear.app/acceleratedata/issue/VD-676) | Formalize workspace/skill dir structure and session tracking | M | VD-672, VD-673 | `feature/vd-676-implement-sessionjson-state-tracking` |
| [VD-677](https://linear.app/acceleratedata/issue/VD-677) | Replace step counter with state x intent router | **L** | VD-676 | `feature/vd-677-replace-step-counter-with-state-x-intent-router` |
| [VD-678](https://linear.app/acceleratedata/issue/VD-678) | Add workflow modes: guided, express, iterative | M | VD-677 | `feature/vd-678-add-workflow-modes-guided-express-iterative` |
| [VD-679](https://linear.app/acceleratedata/issue/VD-679) | Add auto-fill express flow for clarifications | S | VD-677 | `feature/vd-679-add-auto-fill-express-flow-for-clarifications` |
| [VD-680](https://linear.app/acceleratedata/issue/VD-680) | Update T3 tests for new state detection and router | M | VD-677, VD-678 | `feature/vd-680-update-t3-tests-for-new-state-detection-and-router` |

**Definition of done:** Router handles all state x intent combinations,
three workflow modes work, offline resume via `.session.json` works, T3 passes.

### Phase 3: Speed Optimizations

All four issues are independent and can be implemented in parallel. All
blocked by VD-677 (need the router in place first).

| Issue | Title | Size | Blocked By | Branch |
|-------|-------|------|------------|--------|
| [VD-681](https://linear.app/acceleratedata/issue/VD-681) | Make refinement phase optional (adaptive depth) | S | VD-677 | `feature/vd-681-make-refinement-phase-optional-adaptive-depth` |
| [VD-682](https://linear.app/acceleratedata/issue/VD-682) | Add haiku tier for simple research dimensions | S | VD-677 | `feature/vd-682-add-haiku-tier-for-simple-research-dimensions` |
| [VD-683](https://linear.app/acceleratedata/issue/VD-683) | Consolidate validation sub-agents | M | VD-677 | `feature/vd-683-consolidate-validation-sub-agents` |
| [VD-684](https://linear.app/acceleratedata/issue/VD-684) | Add progressive scoping questions before research | S | VD-677 | `feature/vd-684-add-progressive-scoping-questions-before-research` |

**Definition of done:** Research phase ~30% cheaper (haiku dimensions),
validation ~40% faster (consolidated agents), refinement skipped when
answers are specific, scoping questions improve dimension selection.

### Phase 4: dbt Specialization + Extras

All five issues are independent and can be implemented in parallel. All
blocked by VD-677.

| Issue | Title | Size | Blocked By | Branch |
|-------|-------|------|------------|--------|
| [VD-685](https://linear.app/acceleratedata/issue/VD-685) | Add silver/gold boundary guidance and dbt activation triggers | S | VD-677 | `feature/vd-685-add-silvergold-boundary-guidance-and-dbt-activation-triggers` |
| [VD-686](https://linear.app/acceleratedata/issue/VD-686) | Add dbt-specific research sub-concerns to dimensions | M | VD-677 | `feature/vd-686-add-dbt-specific-research-sub-concerns-to-dimensions` |
| [VD-687](https://linear.app/acceleratedata/issue/VD-687) | Add skill templates for common dbt scenarios | **L** | VD-677 | `feature/vd-687-add-skill-templates-for-common-dbt-scenarios` |
| [VD-688](https://linear.app/acceleratedata/issue/VD-688) | Add targeted regeneration for single skill sections | M | VD-677 | `feature/vd-688-add-targeted-regeneration-for-single-skill-sections` |
| [VD-689](https://linear.app/acceleratedata/issue/VD-689) | Add interactive + offline hybrid clarification flow | M | VD-677 | `feature/vd-689-add-interactive-offline-hybrid-clarification-flow` |

**Definition of done:** Generated skills include silver/gold boundaries and
dbt activation triggers, research dimensions produce dbt-specific questions,
templates available for common scenarios, targeted regen and hybrid
clarifications work.

### Dependency Graph

```
VD-672 (rename) ──┬──→ VD-674 (tests) ──→ done
                   │
VD-673 (simplify) ┤
                   │
                   ├──→ VD-675 (docs) ──→ done
                   │
                   └──→ VD-676 (.session.json)
                              │
                              └──→ VD-677 (ROUTER) ←── critical path
                                        │
                              ┌─────────┼─────────┐
                              │         │         │
                              ▼         ▼         ▼
                         VD-678    VD-679    VD-681-684
                         (modes)   (auto-   (speed opts,
                              │    fill)    all parallel)
                              │
                              ▼
                         VD-680    VD-685-689
                         (T3      (dbt + extras,
                         tests)    all parallel)
```

### Shared Agents — No Changes Needed

All 26 agents are environment-agnostic and work in both the app and plugin
without modification:

- All sub-agent dispatch uses the generic `Task` tool
- All path parameters accepted at runtime from the coordinator
- Zero references to app-specific paths, namespacing, or runtime assumptions

The agents are the shared foundation. Only the coordinator (SKILL.md) differs
between app and plugin — the app has its own orchestration in the sidecar, and
the plugin gets the new agent-mode router designed in this doc.

---

## 13. Open Questions

1. **Template sourcing**: Where do skill templates live? Bundled in the plugin,
   or fetched from a registry?
2. **Dimension caching scope**: Per-user (local) or shared (plugin-level)?
3. **Skill composition runtime**: Do dependent skills need to be installed, or
   is the cross-reference purely informational?
4. **Validation agent merging**: Does merging coverage + quality into one agent
   degrade quality, or is it fine because sonnet handles both well?
5. **Express mode quality**: When research is skipped, how much worse are the
   generated skills? Need eval harness data.
