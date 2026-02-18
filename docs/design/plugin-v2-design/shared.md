# Plugin v2: Shared Agent and Content Changes

Changes to the 26 shared agents, research dimensions, reference files, and
content guidelines that impact both the plugin and the desktop app.

---

## 1. Dimension Scoring in the Research Planner

Replace binary (yes/no) dimension selection with a scoring mechanism. The
planner evaluates all 18 dimensions and assigns a relevance score (1-5):

| Score | Meaning | Action |
|-------|---------|--------|
| 5 | Critical delta — engineer will produce wrong models without this | Always include |
| 4 | High value — non-obvious knowledge that saves significant rework | Include if in top 5 |
| 3 | Moderate — useful but Claude's parametric knowledge covers 70%+ | Skip — note as companion candidate |
| 2 | Low — mostly standard knowledge, small delta | Skip |
| 1 | Redundant — Claude already knows this well | Skip |

The planner picks the **top 3-5 dimensions by score** with a hard cap. The
prompt frames scoring around: "What would a data engineer joining this team
need to know to build correct dbt silver/gold models on day one that Claude
can't already tell them?"

### Planner output format

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

**Scope-advisor as exception**: If the planner scores 6+ dimensions as 5s,
scope is genuinely too broad — scope-advisor kicks in.

**Companion gap coverage**: The validate-skill companion recommender reads
the planner's scoring output. Dimensions scored 2-3 that were skipped become
companion skill suggestions in `companion-skills.md`.

---

## 2. Adaptive Research Depth

| Signal | Action |
|--------|--------|
| User provides detailed domain spec | Skip research entirely |
| First-round answers are specific and complete | Skip refinement (Step 3) |
| User says "proceed with defaults" | Auto-fill, skip to decisions |
| Planner scoring selects ≤3 dimensions | Faster research, lower cost |

### Skip-refinement heuristic

Refinement is skipped when all first-round clarification answers are:
- Non-blank
- More than one sentence
- No vague keywords ("it depends", "not sure", "varies")

---

## 3. Model Tier Optimization

| Agent Group | Current | Proposed |
|-------------|---------|----------|
| Complex dimensions (entities, metrics, business-rules, modeling-patterns) | sonnet | sonnet (keep) |
| Simpler dimensions (config-patterns, reconciliation, field-semantics, lifecycle-and-state) | sonnet | haiku (~30% savings) |
| Research planner | opus | opus (keep) |
| Consolidation | opus | opus (keep) |

---

## 4. Validation Reduction

Consolidate validation sub-agents:

| Current | Proposed | Savings |
|---------|----------|---------|
| A (coverage) + B (SKILL.md quality) | Merge into 1 sonnet agent | -1 agent |
| D (boundary) + F (prescriptiveness) | Merge into 1 haiku agent | -1 agent |
| T1-T10 (10 test evaluators) | T1-T5 (5 evaluators, still all 6 categories) | -5 agents |
| E (companion recommender) | Keep | -- |
| C1-CN (per-reference) | Keep | -- |

Net: ~40% reduction in validation phase agents.

---

## 5. dbt Silver/Gold Specialization

### Silver/gold boundary guidance per skill type

| Skill Type | Silver Layer | Gold Layer |
|------------|-------------|------------|
| Domain | Cleaned, typed, deduplicated entities | Business metrics, aggregations, denormalized for BI |
| Platform | Platform-specific extraction handling | Platform-agnostic business layer |
| Source | Source-specific field mapping, type coercion, relationship resolution | Source-agnostic entity models |
| Data Engineering | Pattern implementation (SCD, CDC) | Pattern consumption (query patterns, materialization) |

### dbt-specific research sub-concerns

Enhance existing dimensions with dbt focus:

| Dimension | dbt Sub-concern |
|-----------|-----------------|
| `layer-design` | Staging vs intermediate vs marts; `ref()` dependency chains; naming conventions (`stg_`, `int_`, no prefix for marts); materialization per layer (view → table → incremental). With semantic layer: keep marts normalized (star schema), let MetricFlow denormalize dynamically |
| `modeling-patterns` | Model types (view, table, incremental, snapshot, ephemeral). **Semantic models**: entities (primary/foreign/unique/natural), dimensions (categorical/time/SCD2), measures (all agg types including non-additive with `window_groupings`). **Metrics**: simple, ratio, derived (with `offset_window` for period-over-period), cumulative (sliding window vs grain-to-date), conversion (funnel). Saved queries and exports for Fabric (dynamic semantic layer API not supported on Fabric). Decision tree: when does a model need a semantic model vs a denormalized mart? |
| `config-patterns` | `dbt_project.yml`, custom materializations, meta fields. **Model contracts**: enforced column types + constraints on public models. Platform-specific enforcement — most cloud warehouses only enforce `not_null` at DDL, everything else metadata-only (Snowflake, BigQuery, Redshift). Postgres enforces all. Skills must include platform-specific guidance on when contracts replace tests vs when both are needed. **Model access**: private/protected/public modifiers control `ref()` scope; groups define team ownership. **Model versioning**: breaking changes to contracted public models trigger versioning with migration windows and deprecation dates |
| `load-merge-patterns` | `is_incremental()` macros, merge predicates, `unique_key`; SCD2 via snapshots |
| `data-quality` | **Testing pyramid** (bottom to top): (1) dbt generic tests — unique, not_null, accepted_values, relationships + dbt-utils extras. (2) dbt singular tests — one-off SQL business rule assertions. (3) dbt unit tests (dbt 1.8+) — mocked inputs, YAML given/expect, `is_incremental` override. CI-only, not production. (4) Elementary anomaly detection — volume, freshness, schema_changes, column, dimension anomalies. Self-adjusting thresholds. **Layer-specific strategy**: sources get freshness + schema monitoring + volume; staging gets PK + accepted_values + schema_changes_from_baseline; intermediate gets grain validation; marts get unit tests + Elementary anomalies + contracts on public models. **Contract + test interaction**: on cloud warehouses, constraints beyond not_null are metadata-only — always pair with dbt tests. Elementary schema_changes complements contracts. **Test configuration**: severity, store_failures, warn_if/error_if, where, tags |
| `reconciliation` | `dbt_utils.equal_rowcount`, `dbt_utils.equality`; Elementary `volume_anomalies`; `edr monitor` → Slack/Teams alert chain |

### Activation trigger for generated skills

Generated SKILL.md descriptions should include:

```
Use when building dbt silver or gold layer models for [domain].
Also use when the user mentions "[domain] models", "silver layer",
"gold layer", "marts", "staging", or "[domain]-specific dbt".
```

---

## 6. Skill Templates

Pre-built starter skills hosted on a public GitHub repo, imported using the
existing `github_import.rs` infrastructure.

### Template repository structure

```
skill-builder-templates/              # Public GitHub repo
├── dbt-incremental-silver/
│   ├── SKILL.md
│   └── references/
├── dbt-snapshot-scd2/
├── dbt-semantic-layer/
├── dlt-rest-api-connector/
├── elementary-data-quality/
├── salesforce-extraction/
└── revenue-domain/
```

### Template frontmatter

```yaml
---
name: dbt-incremental-silver
description: "Incremental silver model patterns for dbt"
type: data-engineering
match_keywords: [incremental, silver, staging, is_incremental, merge]
match_types: [data-engineering, platform]
---
```

### Matching

After the user answers scoping questions, match templates using a **haiku
call** (~$0.01). Pass all scoping inputs (name, type, domain description,
power-user answers if provided) plus the template index. Haiku returns
ranked matches with reasoning.

### Flow (same for app and plugin)

1. User completes scoping
2. System fetches template repo index, matches via haiku
3. If matches: present 0-3 options ("Import as starting point, or build from scratch?")
4. If user picks a template: import files, pre-populate context, skip to clarification
5. If "from scratch" or no matches: full research flow

---

## 7. Skill Composition (Semantic Triggering)

Generated skills reference each other via the SKILL.md description field:

```yaml
name: managing-sales-pipeline
description: >
  Build dbt silver and gold models for sales pipeline analytics.
  Use this skill in conjunction with "extracting-salesforce-data" when
  building the ingestion layer, and with "dbt-on-fabric" when deploying
  to Microsoft Fabric.
```

No runtime dependency resolution — the user decides which skills to load.
Claude Code matches descriptions naturally.

### Companion skill report

The validate-skill step produces `<skill-dir>/context/companion-skills.md`
as a first-class artifact. The companion skill generator reads:

- The planner's dimension scores (skipped dimensions scored 2-3)
- The generated skill's scope
- The user's scoping answers (tool ecosystem, domain)

And produces a report listing recommended companions with reasoning, trigger
descriptions, and template match status.

---

## 8. Standalone Convention Skills

Tool best practices are standalone, publishable skills — not bundled reference
files. Each tool gets its own skill, independently versioned and deployable.
Generated skills declare dependencies via `conventions` frontmatter.

### Convention skill catalog

| Skill | Content | References |
|-------|---------|------------|
| `dbt-conventions` | Project structure, naming, materialization, SQL style, contracts, access, versioning | `project-structure.md`, `testing-contracts.md` |
| `dbt-semantic-layer` | Semantic model YAML, entity/dimension/measure types, MetricFlow, Fabric export limitations | `semantic-models.md` |
| `dlt-conventions` | `RESTAPIConfig`, write dispositions, merge strategies, incremental, schema contracts | `connector-patterns.md` |
| `fabric-conventions` | OneLake destination, ABFSS, auth patterns, delta format, notebook setup, deployment | `platform-patterns.md` |
| `elementary-conventions` | Anomaly test types, config parameters, priority order, alerts, dbt integration | `test-catalog.md` |
| `pipeline-integration` | dlt → dbt → Elementary flow, naming alignment, timestamp alignment, orchestration | `cross-tool-patterns.md` |

### Structure per skill

```
<tool>-conventions/
├── SKILL.md              # Description, when to use, activation trigger
└── references/
    └── *.md              # Tool-specific content
```

### Generated skill frontmatter

```yaml
---
description: Sales pipeline silver/gold layer design for dbt on Fabric
conventions:
  - dbt-conventions
  - fabric-conventions
  - elementary-conventions
---
```

The `conventions` field is deployment documentation — the deployer installs
convention skills alongside the generated skill. Claude Code's semantic
triggering handles loading at runtime.

### Publishing

Convention skills are published to the same GitHub template repo. The Skill
Builder ships bundled copies for offline use; the template repo is the
canonical source for updates.

---

## 9. Reference File Updates

Existing shared reference files (used by all agents) need content updates:

| File | Changes |
|------|---------|
| `protocols.md` | Update dispatch examples to use direct `Task` calls. Document `workspace_dir` and `skill_dir` parameters. |
| `file-formats.md` | Add `session.json` spec. Add workspace/skill dir layout. |
| `content-guidelines.md` | Add silver/gold boundary guidance per layer. Add dbt naming conventions. Add dbt activation trigger template. Add dlt source extraction guidance. Add Elementary DQ recommendations. Add Fabric OneLake context. |
| `best-practices.md` | Add gerund naming as default. Add skill composition guidance. |

---

## Related Linear Issues

| Issue | Title | Size |
|-------|-------|------|
| [VD-681](https://linear.app/acceleratedata/issue/VD-681) | Make refinement phase optional (adaptive depth) | S |
| [VD-682](https://linear.app/acceleratedata/issue/VD-682) | Add haiku tier for simple research dimensions | S |
| [VD-683](https://linear.app/acceleratedata/issue/VD-683) | Consolidate validation sub-agents | M |
| [VD-685](https://linear.app/acceleratedata/issue/VD-685) | Add silver/gold boundary guidance and dbt activation triggers | S |
| [VD-686](https://linear.app/acceleratedata/issue/VD-686) | Add dbt-specific research sub-concerns to dimensions | M |
| [VD-692](https://linear.app/acceleratedata/issue/VD-692) | Add adaptive depth: skip detailed research when answers sufficient | M |
| [VD-693](https://linear.app/acceleratedata/issue/VD-693) | Add dimension scoring to research planner with companion gap coverage | M |
| [VD-694](https://linear.app/acceleratedata/issue/VD-694) | Add standalone convention skills for dbt, dlt, Elementary, Fabric | L |
| [VD-696](https://linear.app/acceleratedata/issue/VD-696) | Add skill templates via GitHub import | L |

**Note:** VD-687 (original skill templates) is superseded by VD-696.

### Dependency order

VD-693 (dimension scoring) should be done first — it changes the planner
output format that VD-692 (adaptive depth) and companion gap coverage depend
on.

VD-694 (convention skills) and VD-696 (templates) are independent of each
other and of the planner changes.

VD-681, VD-682, VD-683 are independent optimizations — can run in parallel.

VD-685 and VD-686 are content changes to `content-guidelines.md` and
dimension agent prompts — can run in parallel.

```
VD-693 (dimension scoring)
   │
   ├──→ VD-692 (adaptive depth)
   └──→ companion gap → feeds VD-697 (app companion menu)

VD-694 (convention skills) ─── independent
VD-696 (skill templates) ──── independent

VD-681 (skip refinement) ┐
VD-682 (haiku tiers)     ├── all independent, parallel
VD-683 (consolidate)     ┘

VD-685 (silver/gold) ┐
VD-686 (dbt sub)     ┘── parallel content changes
```
