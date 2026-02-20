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

~/skill-builder/sales-pipeline/             # Skill dir (default: ~/skill-builder/<skill-name>/)
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
   skill dir lives via a `skill_dir` field. Default is `~/skill-builder/<skill-name>/`,
   but the user can move it anywhere.

5. **Moving the skill dir is first-class** -- the router supports:
   - "Move my skill to `./skills/sales-pipeline/`"
   - Updates `session.json.skill_dir`, moves the files, done. All agents
     resolve paths from the session manifest, so nothing else breaks.

6. **Cross-skill data persists** -- `.vibedata/plugin/` survives across skills.
   Dimension caching, user preferences, and plugin config live here.

### Path resolution

Two layers of path resolution: coordinator-internal and agent-facing.

**Coordinator-internal** (not passed to agents):

| Path | Purpose |
|------|---------|
| `.vibedata/<skill-name>/` | Session state (`session.json`), logs. Only the coordinator reads/writes here. |
| `.vibedata/plugin/` | Cross-skill config, dimension cache. |

**Agent-facing** (passed to every agent by the coordinator):

| Parameter | Example | Purpose |
|-----------|---------|---------|
| `context_dir` | `~/skill-builder/sales-pipeline/context/` | User-facing working files (clarifications, decisions, validation logs) |
| `skill_dir` | `~/skill-builder/sales-pipeline/` | Deployable output (SKILL.md, references/) |

These are the same two paths agents receive today (`Context directory` and
`Skill directory`). No change to agent prompts or the app's coordinator.

### Session manifest (`session.json`)

Lives at `.vibedata/<skill-name>/session.json`:

```json
{
  "skill_name": "sales-pipeline",
  "skill_type": "domain",
  "domain": "sales pipeline analytics",
  "skill_dir": "~/skill-builder/sales-pipeline/",
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
2. User told: "Questions are in `~/skill-builder/sales-pipeline/context/clarifications.md`. Answer them whenever you're ready."
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

### Explicit mode override

Users can force a mode by naming it directly:

- "build a skill in express mode"
- "guided mode for this one"
- "iterate on my sales-pipeline skill"

An explicit mode override always wins over inference. The router sets
`session.json.mode` accordingly and skips mode detection.

---

## 7. Speed Optimizations

### Dimension scoring in the research planner

The current planner selects dimensions binary (yes/no). Replace with a scoring
mechanism: the planner evaluates all 18 dimensions and assigns a **relevance
score** (1-5) based on delta value for the target data engineer:

| Score | Meaning | Action |
|-------|---------|--------|
| 5 | Critical delta — data engineer will produce wrong models without this | Always include |
| 4 | High value — non-obvious knowledge that saves significant rework | Include if in top 5 |
| 3 | Moderate — useful but Claude's parametric knowledge covers 70%+ | Skip — note as companion candidate |
| 2 | Low — mostly standard knowledge, small delta | Skip |
| 1 | Redundant — Claude already knows this well | Skip |

The planner picks the **top 3-5 dimensions by score** with a hard cap. The
prompt frames scoring around: "What would a data engineer joining this team
need to know to build correct dbt silver/gold models on day one that Claude
can't already tell them?"

**Planner output format** changes from a list of selected dimensions to:

```yaml
dimensions:
  - slug: metrics
    score: 5
    reason: "Customer-specific KPI formulas — Claude defaults to industry standard"
  - slug: entities
    score: 5
    reason: "Custom object model with managed package overrides"
  - slug: business-rules
    score: 4
    reason: "Segmentation-dependent thresholds not in any docs"
  - slug: field-semantics
    score: 3
    reason: "Some overrides but mostly standard Salesforce fields"
    companion_note: "Consider a source skill for Salesforce extraction"
  ...
selected: [metrics, entities, business-rules]  # top 3-5
```

**Scope-advisor as exception**: The existing threshold guard still exists but
should rarely fire. If the planner scores 6+ dimensions as 5s, the scope is
genuinely too broad — scope-advisor kicks in. Under normal operation, the
scoring mechanism produces a focused 3-5 dimension selection without hitting
the threshold.

**Companion gap coverage**: The validate-skill companion recommender reads the
planner's scoring output. Dimensions scored 2-3 that were skipped become
companion skill suggestions:

> "This domain skill covers metrics and business rules. Consider building a
> companion source skill for Salesforce extraction gotchas (field-semantics
> scored 3, skipped from this skill)."

### Adaptive research depth

| Signal | Action |
|--------|--------|
| User provides detailed domain spec | Skip research entirely |
| First-round answers are specific and complete | Skip refinement (Step 3) |
| User says "proceed with defaults" | Auto-fill, skip to decisions |
| Planner scoring selects ≤3 dimensions | Faster research, lower cost |

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

Better planner input → fewer dimensions selected → fewer agents spawned → faster.

**Plugin**: The router asks 2-3 scoping questions conversationally before
spawning the planner.

**App**: The init step becomes a **two-level wizard** with progressive
disclosure. Level 1 is required, Level 2 is optional but improves results.

#### Init wizard (app)

**Level 1 — General Details** (required):

| Field | Type | Purpose |
|-------|------|---------|
| Skill name | text | Kebab-case identifier |
| Skill type | select | domain / platform / source / data-engineering |
| Domain description | textarea | What the skill covers |

**Level 2 — Power User Details** (optional, expandable):

| Field | Type | Purpose |
|-------|------|---------|
| What does Claude get wrong? | textarea | Top 2-3 things Claude produces incorrectly for this domain |
| What makes your setup unique? | textarea | How this differs from standard implementations |
| Tool ecosystem | checkboxes | dbt, dlt, Elementary, Fabric — controls which tool-conventions references are loaded |
| Workflow mode | select | Guided (default) / Express / Iterative — explicit mode override |

Level 2 is collapsed by default with a "More options" expander. Users who
skip it get reasonable defaults — the planner scores dimensions with less
context but still works. Users who fill it get better dimension selection
and faster research.

Both levels feed into `build_prompt()` which passes all answers to the
research planner's prompt template.

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

Enhance existing dimensions with dbt focus. Each sub-concern represents
knowledge the research planner should surface — things Claude's parametric
knowledge gets wrong or misses for the customer's specific setup.

| Dimension | dbt Sub-concern |
|-----------|-----------------|
| `layer-design` | Staging vs intermediate vs marts; `ref()` dependency chains; naming conventions (`stg_`, `int_`, no prefix for marts); materialization per layer (view → table → incremental). With semantic layer: keep marts normalized (star schema), let MetricFlow denormalize dynamically |
| `modeling-patterns` | Model types (view, table, incremental, snapshot, ephemeral). **Semantic models**: entities (primary/foreign/unique/natural), dimensions (categorical/time/SCD2), measures (all agg types including non-additive with `window_groupings`). **Metrics**: simple, ratio, derived (with `offset_window` for period-over-period), cumulative (sliding window vs grain-to-date), conversion (funnel). Saved queries and exports for Fabric (dynamic semantic layer API not supported on Fabric). Decision tree: when does a model need a semantic model vs a denormalized mart? |
| `config-patterns` | `dbt_project.yml`, custom materializations, meta fields. **Model contracts**: enforced column types + constraints on public models. Platform-specific enforcement — most cloud warehouses only enforce `not_null` at DDL, everything else is metadata-only (Snowflake, BigQuery, Redshift). Postgres enforces all. Skills must include platform-specific guidance on when contracts replace tests vs when both are needed. **Model access**: private/protected/public modifiers control `ref()` scope; groups define team ownership. **Model versioning**: breaking changes to contracted public models trigger versioning with migration windows and deprecation dates |
| `load-merge-patterns` | `is_incremental()` macros, merge predicates, `unique_key`; SCD2 via snapshots |
| `data-quality` | **Testing pyramid** (bottom to top): (1) dbt generic tests — unique, not_null, accepted_values, relationships + dbt-utils (unique_combination_of_columns, expression_is_true, recency, equal_rowcount). (2) dbt singular tests — one-off SQL business rule assertions in `tests/`. (3) dbt unit tests (dbt 1.8+) — validate model SQL logic on mocked inputs, YAML-defined given/expect, test incremental logic with `is_incremental` override. Use for complex transformations, edge cases, business logic. CI-only, not production. (4) Elementary anomaly detection — volume_anomalies, freshness_anomalies, schema_changes, column_anomalies, dimension_anomalies. Self-adjusting thresholds from training periods. **Layer-specific strategy**: sources get freshness + schema monitoring + volume; staging gets PK + accepted_values + schema_changes_from_baseline; intermediate gets grain validation (equal_rowcount); marts get unit tests for complex logic + Elementary anomaly detection + contracts on public models. **Contract + test interaction**: on cloud warehouses, constraints beyond not_null are metadata-only — always pair with dbt tests for enforcement. Elementary schema_changes complements contracts (visibility without blocking builds). **Test configuration**: severity, store_failures, warn_if/error_if, where, tags for selective runs |
| `reconciliation` | `dbt_utils.equal_rowcount`, `dbt_utils.equality` for cross-model validation; Elementary `volume_anomalies` for production monitoring; `edr monitor` → Slack/Teams alert chain |

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

### Skill templates (standalone feature — app + plugin)

Pre-built starter skills for common dbt/dlt/Elementary scenarios. This is a
**standalone feature** independent of the plugin v2 rewrite — it benefits
both the app and the plugin equally.

**Templates are hosted on GitHub** and imported using the same flow the app
already has for skill import (`github_import.rs`). The app supports:
- Public repo URL parsing (`owner/repo`, full GitHub URLs, branch/subpath)
- Skill discovery via `SKILL.md` search in the repo
- Batch import with frontmatter metadata extraction
- Auto-generated trigger text via Claude Haiku

The plugin gets the same capability: the coordinator can offer to import a
template from GitHub when the user's request matches a known scenario, then
customize it via the research/clarification flow instead of building from
scratch.

**Template repository structure:**

```
skill-builder-templates/              # Public GitHub repo
├── dbt-incremental-silver/           # Incremental silver model patterns
│   ├── SKILL.md
│   └── references/
├── dbt-snapshot-scd2/                # SCD Type 2 with dbt snapshots
│   ├── SKILL.md
│   └── references/
├── dbt-semantic-layer/               # Semantic models + MetricFlow metrics
│   ├── SKILL.md
│   └── references/
├── dlt-rest-api-connector/           # dlt REST API source → OneLake
│   ├── SKILL.md
│   └── references/
├── elementary-data-quality/          # Elementary anomaly detection setup
│   ├── SKILL.md
│   └── references/
├── salesforce-extraction/            # Salesforce → dbt pipeline
│   ├── SKILL.md
│   └── references/
└── revenue-domain/                   # Revenue recognition domain
    ├── SKILL.md
    └── references/
```

**Flow (same for app and plugin):**

After the user answers basic scoping questions (name, type, domain), the
system automatically checks the template repo for matches:

```
1. User completes scoping (name, type, domain keywords)
2. System fetches template repo index from GitHub
   - Matches on skill_type + domain keywords in template frontmatter
   - Returns 0-3 ranked matches
3. If matches found:
   "I found 2 starter skills that match your domain:
    • dbt-incremental-silver — Incremental silver model patterns
    • elementary-data-quality — Elementary anomaly detection setup
    Import one as a starting point, or build from scratch?"
4. If user picks a template:
   - Import SKILL.md + references/ into the skill dir
   - Pre-populate context/ with template-specific clarification questions
   - Continue at clarification step (skip research — template provides
     the foundation, clarifications customize it)
5. If user says "from scratch":
   - Full research flow as normal
6. If no matches:
   - Full research flow, no prompt shown
```

**App implementation:** After the init wizard (Step 0) completes, before
starting the research step, call the template repo API. Show a dialog with
matches. On import, populate the skill folder and advance to clarification.

**Plugin implementation:** After the router completes scoping, before
spawning the research planner, check the template repo. Present matches
conversationally. On import, write files to skill dir and proceed to
clarification.

**Template repo index:** Each template's `SKILL.md` frontmatter includes
matching metadata:

```yaml
---
name: dbt-incremental-silver
description: "Incremental silver model patterns for dbt"
type: data-engineering
match_keywords: [incremental, silver, staging, is_incremental, merge]
match_types: [data-engineering, platform]
---
```

Matching uses a **haiku call** — pass all scoping inputs (skill name, type,
domain description, and power-user answers if provided: "what does Claude
get wrong", "what makes your setup unique", tool ecosystem selections) plus
the template index (names + descriptions + match_keywords) to haiku, which
returns ranked matches with reasoning. Cheap (~$0.01), more accurate than
keyword grep, and the scoping context makes matches much sharper (e.g.,
"SCD2 with dbt snapshots on Fabric" directly matches "dbt-snapshot-scd2").

### Skill composition

Skills reference each other via **semantic triggering** — the SKILL.md
description field mentions related skills, and Claude Code's skill matching
picks them up naturally:

```yaml
# In generated SKILL.md frontmatter
name: managing-sales-pipeline
description: >
  Build dbt silver and gold models for sales pipeline analytics.
  Use this skill in conjunction with "extracting-salesforce-data" when
  building the ingestion layer, and with "dbt-on-fabric" when deploying
  to Microsoft Fabric. Also use when the user mentions "pipeline models",
  "sales forecasting", or "deal velocity".
```

No runtime dependency resolution — the user decides which skills to load.
The description text is the mechanism: Claude Code matches it when the user
asks about related topics.

#### Companion skill report (first-class output)

The validate-skill step produces a **companion skill report** as a
first-class artifact at `<skill-dir>/context/companion-skills.md`. This is
not a log entry — it's a standalone document the user reviews.

The companion skill generator reads:
- The planner's dimension scores (dimensions scored 2-3 that were skipped)
- The generated skill's scope (what it covers vs what it doesn't)
- The user's scoping answers (tool ecosystem, domain description)

And produces:

```markdown
# Companion Skills for: managing-sales-pipeline

## Recommended companions

### 1. Source skill: Salesforce extraction
- **Why**: This skill covers pipeline metrics and business rules but not
  Salesforce-specific extraction gotchas (field-semantics scored 3, skipped).
  CPQ overrides, soft delete handling, and SystemModstamp vs LastModifiedDate
  are not covered.
- **Trigger description**: "Use when extracting Salesforce data for the
  sales pipeline. Covers CPQ field overrides, CDC patterns, and managed
  package schema handling."
- **Template match**: dbt-salesforce-extraction (92% match)

### 2. Platform skill: dbt on Fabric
- **Why**: This skill assumes dbt but does not cover Fabric-specific
  materialization quirks or CI/CD patterns.
- **Trigger description**: "Use when running dbt models on Microsoft Fabric.
  Covers lakehouse vs warehouse, Fabric SQL dialect, and deployment patterns."
- **Template match**: No template available — build from scratch

## Already covered
- Metrics and business rules (research dimension scored 5)
- Entity model and relationships (research dimension scored 5)
```

#### App UI: companion skills menu

The app reads `companion-skills.md` and shows a dedicated menu/panel:

- List of recommended companion skills with reasoning
- For each: match status against existing skills in workspace and template
  repo (via haiku)
- Actions: "Build this skill" (starts a new workflow pre-filled with the
  companion's suggested scope) or "Import template" (if a template matches)
- Status tracking: which companions have been built, which are pending

This is a **helper for the user** — it surfaces what's missing and makes
it easy to act on, but the user decides what to build next.

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
~/skill-builder/sales-pipeline/context/clarifications.md. Answer
them whenever you're ready -- I'll proceed with recommended
defaults if you want to skip ahead."
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

### Two types of reference content

| Type | Purpose | Used by |
|------|---------|---------|
| **Customer-specific knowledge** | Research dimensions surface the customer's delta | Research agents (18 dimensions) |
| **Tool best practices** | How dbt/dlt/Elementary/Fabric should work | generate-skill, validate-skill |

Research agents don't need tool conventions — they research the customer's
setup. The generate-skill and validate-skill agents need tool knowledge via
reference files so generated skills align with dbt/dlt/Elementary best practices.

### Current reference files (keep structure, update content)

| File | Changes |
|------|---------|
| `protocols.md` | Update dispatch examples to use direct `Task` calls. Document `workspace_dir` and `skill_dir` parameters that agents receive. |
| `file-formats.md` | Add `session.json` spec. Add workspace/skill dir layout. Keep clarifications/decisions format unchanged. |
| `content-guidelines.md` | Add silver/gold boundary guidance per layer. Add dbt naming conventions (stg_, int_, no prefix for marts). Add dbt activation trigger template. Add dlt source extraction guidance (RESTAPIConfig as primary pattern). Add Elementary data quality test recommendations. Add Fabric context for OneLake destination. |
| `best-practices.md` | Add gerund naming as default. Add skill composition guidance. |

### Standalone convention skills

Tool best practices are **standalone, publishable skills** — not bundled
reference files. Each tool gets its own skill that can be independently
versioned, imported, and deployed. Generated skills declare which convention
skills they depend on in their frontmatter.

#### Why standalone skills

- **No duplication** — the same `dbt-conventions` skill works across all
  dbt-related generated skills instead of copying reference files into each
- **Independent versioning** — convention content evolves on its own cadence
  (e.g., dbt 1.9 changes don't require regenerating every dbt skill)
- **Composable** — a generated skill lists only what it actually needs
  (a pure dbt skill doesn't pull in dlt conventions)
- **Semantic triggering** — Claude Code naturally loads convention skills
  when working on tasks that match their descriptions

#### Convention skill catalog

| Skill | Content | References |
|-------|---------|------------|
| `dbt-conventions` | Project structure, naming, materialization, SQL style, model contracts, access modifiers, versioning | `project-structure.md`, `testing-contracts.md` |
| `dbt-semantic-layer` | Semantic model YAML, entity types, dimension types, measure aggregations, metric types, MetricFlow join inference, Fabric export limitations | `semantic-models.md` |
| `dlt-conventions` | `RESTAPIConfig` schema, write dispositions, merge strategies, `dlt.sources.incremental`, schema contracts | `connector-patterns.md` |
| `fabric-conventions` | OneLake filesystem destination, ABFSS URL format, auth patterns, delta table format, Fabric notebook setup, deployment via Notebook Activity | `platform-patterns.md` |
| `elementary-conventions` | All anomaly test types, YAML config with parameters, what-to-test-first priority, alert configuration, dbt integration | `test-catalog.md` |
| `pipeline-integration` | dlt → dbt → Elementary flow, shared naming conventions, timestamp alignment, credential sharing, orchestration chain | `cross-tool-patterns.md` |

Each skill follows the standard structure:

```
<tool>-conventions/
├── SKILL.md              # Description, when to use, activation trigger
└── references/
    └── *.md              # Tool-specific content
```

#### Generated skill frontmatter

When the Skill Builder generates a SKILL.md, it includes a `conventions`
field listing required convention skills:

```yaml
---
description: Sales pipeline silver/gold layer design for dbt on Fabric
conventions:
  - dbt-conventions
  - fabric-conventions
  - elementary-conventions
---
```

The `conventions` field serves as deployment documentation — the person
deploying the generated skill knows to also deploy the listed convention
skills in their Claude Code environment. Claude Code's semantic triggering
handles the actual loading at runtime; no dependency resolution mechanism
is needed.

#### How generate-skill uses convention skills

During skill building, the Skill Builder deploys the relevant convention
skills to the workspace based on the user's tool ecosystem selection
(from the init wizard). The generate-skill and validate-skill agents
then have access to the convention content via the workspace's
`.claude/skills/` folder. The `conventions` frontmatter in the generated
SKILL.md is written based on which convention skills were active during
generation.

#### Publishing and distribution

Convention skills are published to the same GitHub template repo used for
skill templates (Section 9). They can be imported via the existing GitHub
import infrastructure. The Skill Builder ships with bundled copies for
offline use — the template repo is the canonical source for updates.

### App deployment

`ensure_workspace_prompts()` in `workflow.rs` already copies agents to
`.claude/agents/`. Extend it to deploy convention skills to
`.claude/skills/<tool>-conventions/` based on the user's tool ecosystem
selection. Same copy-on-init pattern, no new mechanism needed.

### Plugin packaging

The build script packages the convention skills into the plugin's
reference structure. The plugin coordinator deploys the relevant
convention skills to `.vibedata/skills/` based on tool ecosystem
selection during init.

### Build script update

`scripts/build-plugin-skill.sh` extracts from `agent-sources/workspace/CLAUDE.md`.
Update extraction boundaries if the source sections change. Add `.session.json`
format to the file-formats section. Add convention skills to the build output.

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
