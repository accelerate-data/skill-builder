# Dynamic Research Dimensions

> Architecture for the Skill Builder's research step. An opus planner evaluates
> 18 research dimensions against the domain, selects relevant ones with tailored
> focus lines, sonnet dimension agents run in parallel, and opus consolidation
> produces the clarifications file.

---

## 1. Overview

The research step uses dynamic dimensions to produce targeted clarification questions
for each skill build. Instead of a fixed set of research agents per skill type, a
planner agent evaluates a catalog of 18 dimensions against the specific domain and
selects the relevant subset. Each selected dimension runs as an independent research
agent in parallel. A consolidation agent cross-references all dimension outputs and
produces a cohesive `clarifications.md` file.

Every dimension encodes the **delta principle**: research what Claude gets wrong or
misses when working without the skill. Claude already knows standard methodologies
(Kimball, SCD types, star schemas, standard object models). Dimensions surface the
customer-specific and domain-specific knowledge that produces silently wrong outputs
when absent.

---

## 2. Architecture

Three phases execute sequentially within the research orchestrator:

```
                    Research Orchestrator (sonnet)
 ┌─────────────────────────────────────────────────────────┐
 │                                                         │
 │  Phase 0: Planning (opus)                               │
 │      Receives: skill type, domain, user context,        │
 │                type-scoped dimension set (5-6)          │
 │      Writes: context/research-plan.md                   │
 │      Returns: scored YAML with selected dimensions      │
 │                                                         │
 │  Phase 1: Parallel Research (sonnet x N)                │
 │      ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
 │      │dim 1 │ │dim 2 │ │dim 3 │ │dim 4 │ │dim N │       │
 │      └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘       │
 │         └────────┴────────┴────────┴────────┘           │
 │                        │ all text                       │
 │                        ▼                                │
 │  Phase 2: Consolidation (opus, effort: high)            │
 │      Cross-references all dimension outputs             │
 │      → clarifications.md                                │
 │                                                         │
 └─────────────────────────────────────────────────────────┘
```

**Phase 0 — Planning.** The opus planner receives the skill type, domain name, user
context, and the type-scoped dimension set (5-6 dimensions matching the skill type).
It scores each dimension on a 1-5 scale, writes `context/research-plan.md` for
auditability, and returns scored YAML with the `selected` list of top 3-5 dimensions.
If the planner fails, the orchestrator falls back to launching `entities` and the
second dimension from the type-scoped set with default focus lines.

**Phase 1 — Parallel Research.** The orchestrator parses the `selected` list from the
scored YAML output and spawns all selected dimension agents in a single turn via the
Task tool. Each agent
receives the domain name and its tailored focus line. Agents return clarification
questions as text -- they write no files.

**Phase 2 — Consolidation.** A fresh opus agent with extended thinking (`effort: high`)
receives all dimension outputs labeled by dimension name. It cross-references findings,
resolves overlapping questions, identifies cross-cutting concerns, and writes the
final `clarifications.md`.

---

## 3. Dimension Catalog

18 dimensions organized into five groups: cross-type (used by multiple skill types),
domain-specific, data-engineering-specific, platform-specific, and source-specific.

### Cross-Type Dimensions

#### `entities` — Entity & Relationship Research

| Field | Value |
|-------|-------|
| Agent | [`research-entities.md`](../../agents/research-entities.md) |
| Used by | **all 4 types** (domain, data-engineering, platform, source) |
| Role | Surface core entities, relationships, cardinality patterns, and entity classification decisions specific to the customer's environment |
| Default focus | Identify domain entities, their relationships, cardinality constraints, and cross-entity analysis patterns. Focus on what differs from the standard model Claude already knows. |
| Output | Questions about which entities to model, relationship depth, key cardinality decisions, and departures from textbook models |
| Delta justification | Claude knows standard entity models (Salesforce objects, Kimball star schema, dbt resources). The delta is the customer's specific entity landscape: custom objects, managed package extensions, entity classifications (dimension vs. fact), grain decisions, and non-obvious relationships. |
| Template sections | Varies by type — see per-type mapping |

#### `data-quality` — Data Quality Research

| Field | Value |
|-------|-------|
| Agent | [`research-data-quality.md`](../../agents/research-data-quality.md) |
| Used by | **data-engineering** (as `quality-gates`), **source** (as `data-quality`) |
| Role | Surface quality checks, validation patterns, and known quality issues specific to the skill's domain |
| Default focus | Identify pattern-specific quality checks (DE) and org-specific known quality issues (source) that go beyond generic data quality concepts |
| Output | Questions about validation rules, quality gate thresholds, known quality issues, pipeline failure response |
| Delta justification | Claude knows generic data quality concepts (null checks, uniqueness, referential integrity). The delta is pattern-specific checks (e.g., row multiplication accounting after MERGE into Type 2) and org-specific issues (e.g., fields commonly null due to validation rule workarounds). |
| Template sections | DE: Quality Gates & Testing. Source: Data Extraction Gotchas, System Workarounds |

---

### Domain-Specific Dimensions

#### `metrics` — Metrics & KPI Research

| Field | Value |
|-------|-------|
| Agent | [`research-metrics.md`](../../agents/research-metrics.md) |
| Used by | **domain** only |
| Role | Surface specific metrics and KPIs with emphasis on where calculation definitions diverge from industry standards — exact formula parameters, inclusion/exclusion rules, calculation nuances |
| Default focus | Identify key business metrics, their exact calculation formulas, parameter definitions (denominators, exclusions, modifiers), and where "approximately correct" defaults would produce wrong analysis |
| Output | Questions about which metrics to support, formula parameters, aggregation granularity, and metric presentation |
| Delta justification | Claude knows textbook formulas (coverage = open/quota, win rate = won/(won+lost)). The delta is every parameter: coverage denominator (quota vs. forecast vs. target), segmented targets (4.5x/2x), win rate exclusions ($25K floor, 14-day minimum), custom modifiers (discount impact factor). |
| Template sections | Metric Definitions (primary), Materiality Thresholds, Output Standards |

#### `business-rules` — Business Rules Research

| Field | Value |
|-------|-------|
| Agent | [`research-business-rules.md`](../../agents/research-business-rules.md) |
| Used by | **domain** only |
| Role | Surface business rules that constrain data modeling — conditional logic, regulatory requirements, organizational policies that override textbook logic |
| Default focus | Identify business rules that affect data modeling, industry-specific variations, regulatory constraints, and rules that engineers without domain expertise commonly implement incorrectly |
| Output | Questions about conditional business logic, regulatory requirements, exception handling rules |
| Delta justification | Claude knows standard business rules at textbook level. The delta is the customer's actual rule logic: pushed deals treated differently by deal type, maverick spend with a $5K threshold plus sole-source exception, co-sold deal attribution models. |
| Template sections | Business Logic Decisions (primary), Materiality Thresholds, Segmentation Standards |

#### `segmentation-and-periods` — Segmentation & Period Handling Research

| Field | Value |
|-------|-------|
| Agent | [`research-segmentation-and-periods.md`](../../agents/research-segmentation-and-periods.md) |
| Used by | **domain** only |
| Role | Surface how the organization segments business data for analysis and handles time-based logic: segmentation breakpoints, fiscal calendars, snapshot cadence, cross-period rules |
| Default focus | Identify specific segmentation breakpoints (not just "segmentation exists"), fiscal calendar structure, snapshot timing, and cross-period rules that constrain metric calculations |
| Output | Questions about segment definitions, fiscal calendar, period handling, snapshot cadence |
| Delta justification | Claude knows generic segmentation patterns and standard fiscal calendars. The delta is specific breakpoints (enterprise = 500+ employees AND $1M+ ACV), the customer's fiscal calendar (4-4-5? non-January fiscal year?), snapshot timing, and cross-period rules. Without knowing the segmentation, even correct formulas produce wrong answers. |
| Template sections | Segmentation Standards (primary), Period Handling (primary), Materiality Thresholds |

#### `modeling-patterns` — Modeling Patterns Research

| Field | Value |
|-------|-------|
| Agent | [`research-modeling-patterns.md`](../../agents/research-modeling-patterns.md) |
| Used by | **domain** only |
| Role | Surface silver/gold layer modeling patterns for the business domain: fact table granularity, snapshot strategies, source field coverage decisions |
| Default focus | Identify domain-specific modeling decisions: grain choices (stage-transition vs. daily-snapshot), field coverage (which source fields to silver vs. gold), and interactions between grain choices and downstream query patterns |
| Output | Questions about modeling approach, grain decisions, snapshot strategy, field coverage |
| Delta justification | Claude knows Kimball methodology and star schemas. The delta is domain-specific modeling decisions: stage-transition grain vs. daily-snapshot grain for pipeline, field coverage (which source fields to silver, which to gold), and the interaction between grain choices and downstream query patterns. |
| Template sections | Metric Definitions (secondary), Business Logic Decisions (secondary) |

---

### Data-Engineering-Specific Dimensions

#### `pattern-interactions` — Pattern Interaction & Selection Research

| Field | Value |
|-------|-------|
| Agent | [`research-pattern-interactions.md`](../../agents/research-pattern-interactions.md) |
| Used by | **data-engineering** only |
| Role | Surface non-obvious interactions between pattern choices (load strategy, merge approach, historization type, materialization) that constrain each other. Decision trees for pattern selection based on entity characteristics. |
| Default focus | Identify constraint chains between patterns: how SCD type selection constrains merge strategy, how merge strategy constrains key design, how historization choice constrains materialization. Focus on where choosing pattern A forces or precludes pattern B. |
| Output | Questions about pattern interactions, constraint chains, selection criteria |
| Delta justification | Claude knows each pattern individually. The delta is the interactions: SCD Type 2 forces hash-based surrogate keys, which forces MERGE INTO, which requires reliable change timestamps. Late-arriving fact handling depends on whether the joined dimension uses Type 1 (safe) or Type 2 (requires point-in-time lookup). |
| Template sections | Pattern Selection & Interaction Rules (primary), Load & Merge Patterns (secondary) |

#### `load-merge-patterns` — Load & Merge Strategy Research

| Field | Value |
|-------|-------|
| Agent | [`research-load-merge-patterns.md`](../../agents/research-load-merge-patterns.md) |
| Used by | **data-engineering** only |
| Role | Surface specific load strategy and merge implementation decisions, including failure recovery, backfill strategies, and schema evolution handling |
| Default focus | Identify high-water mark column selection, change detection approaches, merge predicate design, idempotency guarantees, failure recovery patterns, backfill strategies for historized data, schema evolution in versioned tables, and orchestration monitoring for pattern-specific drift |
| Output | Questions about merge predicates, watermark handling, failure recovery, backfill approach, schema evolution |
| Delta justification | Claude knows generic MERGE INTO syntax and high-water marks. The delta is: watermark boundary duplicate handling (overlap window + dedup), MERGE failure recovery for Type 2 (duplicate current records), platform-specific merge characteristics, and day-2 operational concerns (backfilling Type 2 requires historical source snapshots). |
| Template sections | Load & Merge Patterns (primary), Quality Gates & Testing (secondary — monitoring) |

#### `historization` — Historization & Temporal Design Research

| Field | Value |
|-------|-------|
| Agent | [`research-historization.md`](../../agents/research-historization.md) |
| Used by | **data-engineering** only |
| Role | Surface SCD type selection rationale per entity, effective date conventions, snapshot vs. row-versioning trade-offs, bitemporal modeling triggers, history retention policies |
| Default focus | Identify when Type 2 breaks down (>10M rows with 10% daily changes), when snapshots outperform row-versioning (wide tables with many changing columns), when bitemporal modeling is required vs. overkill, and retention policies |
| Output | Questions about SCD type selection per entity, snapshot strategy, bitemporal triggers, retention |
| Delta justification | Claude knows SCD Types 1/2/3/4/6. The delta is threshold decisions: when Type 2 breaks down at scale, when snapshots outperform row-versioning, when bitemporal modeling is required. |
| Template sections | Historization & Temporal Design (primary), Pattern Selection & Interaction Rules (secondary) |

#### `layer-design` — Silver/Gold Layer Design Research

| Field | Value |
|-------|-------|
| Agent | [`research-layer-design.md`](../../agents/research-layer-design.md) |
| Used by | **data-engineering** only |
| Role | Surface layer boundary decisions, conformed dimension governance, fact table granularity, materialization strategy, aggregate table design |
| Default focus | Identify where to draw the silver/gold boundary (source-conformed vs. business-conformed silver), physical vs. logical dimension conformance, materialization trade-offs specific to pattern choices (Type 2 dimensions make views expensive), and aggregate table design |
| Output | Questions about layer boundaries, conformed dimensions, materialization approach, aggregate patterns |
| Delta justification | Claude knows medallion architecture and star schema. The delta is where to draw the silver/gold boundary, physical vs. logical conformance, and materialization trade-offs specific to pattern choices. |
| Template sections | Layer Design & Materialization (primary) |

---

### Platform-Specific Dimensions

#### `platform-behavioral-overrides` — Platform Behavioral Override Research

| Field | Value |
|-------|-------|
| Agent | [`research-platform-behavioral-overrides.md`](../../agents/research-platform-behavioral-overrides.md) |
| Used by | **platform** only |
| Role | Surface cases where the platform behaves differently than its documentation states — the "docs say X, reality is Y" items |
| Default focus | Identify behavioral deviations from official documentation in the customer's specific environment. Focus on cases where following the docs produces wrong results. |
| Output | Questions about known behavioral deviations, undocumented limitations, environment-specific behaviors |
| Delta justification | Claude's parametric knowledge comes from official documentation. When reality diverges from docs, Claude is confidently wrong. For dbt on Fabric: `merge` silently degrades on Lakehouse, datetime2 precision causes snapshot failures, warehouse vs. Lakehouse endpoints change available SQL features. |
| Template sections | Platform Behavioral Overrides (primary), Environment-Specific Constraints (co-primary) |

#### `config-patterns` — Configuration Pattern Research

| Field | Value |
|-------|-------|
| Agent | [`research-config-patterns.md`](../../agents/research-config-patterns.md) |
| Used by | **platform** only |
| Role | Surface dangerous configuration combinations (valid syntax, wrong semantics), required settings with non-obvious defaults, version-dependent configuration constraints, and multi-axis compatibility requirements |
| Default focus | Identify configuration combinations that fail in practice, including version-dependent configuration requirements (which adapter/runtime versions change which configurations are valid), adapter version pinning, and breaking changes across version boundaries. Focus on configurations that look correct but produce unexpected behavior. |
| Output | Questions about dangerous configs, version-dependent configuration constraints, multi-axis compatibility |
| Delta justification | Claude generates syntactically valid configurations from documentation. It cannot reason about which configurations produce unexpected runtime behavior. The expanded scope includes version-dependent configuration interactions (e.g., adapter v1.6+ required for incremental materialization, which changes available config options). |
| Template sections | Configuration Patterns, Anti-Patterns & Version Compatibility (primary) |

#### `integration-orchestration` — Integration and Orchestration Research

| Field | Value |
|-------|-------|
| Agent | [`research-integration-orchestration.md`](../../agents/research-integration-orchestration.md) |
| Used by | **platform** only |
| Role | Surface how the platform connects to other tools, CI/CD pipeline patterns, authentication handoffs between tools, orchestration workflows |
| Default focus | Identify integration patterns, CI/CD pipeline configuration, authentication handoffs between tools, and multi-tool orchestration workflows specific to the customer's deployment |
| Output | Questions about CI/CD patterns, cross-tool integration, orchestration workflows |
| Delta justification | Claude knows individual tool documentation but not how tools interact in real deployments. The integration layer (CI/CD pipelines, auth flows across tool boundaries, artifact passing) lives in team-specific runbooks, not documentation. |
| Template sections | Integration and Orchestration (primary) |

#### `operational-failure-modes` — Operational Failure Mode Research

| Field | Value |
|-------|-------|
| Agent | [`research-operational-failure-modes.md`](../../agents/research-operational-failure-modes.md) |
| Used by | **platform** only |
| Role | Surface production failure patterns, debugging procedures, performance pitfalls — the "things that break at 2am" items |
| Default focus | Identify production failure patterns, undocumented timeout behaviors, concurrency issues, environment-specific error behaviors, and debugging procedures that come exclusively from operational experience |
| Output | Questions about production failure patterns, timeout behaviors, concurrency issues, debugging procedures |
| Delta justification | Claude describes happy paths; this dimension surfaces failure paths. Production-incident knowledge (Fabric's unconfigurable 30-minute query timeout, metadata lock contention from concurrent dbt runs, environment-specific test error format differences) comes exclusively from operational experience. |
| Template sections | Operational Gotchas and Failure Modes (primary), Environment-Specific Constraints (co-primary) |

---

### Source-Specific Dimensions

#### `extraction` — Data Extraction Research

| Field | Value |
|-------|-------|
| Agent | [`research-extraction.md`](../../agents/research-extraction.md) |
| Used by | **source** only |
| Role | Surface platform-specific extraction traps that produce silently wrong data, including CDC mechanism selection and change detection gotchas |
| Default focus | Identify platform-specific extraction traps (multi-tenant filtering, governor limits at scale, permission/scope affecting completeness), CDC field selection (which timestamp field captures all changes), soft delete detection mechanisms, and parent-child change propagation gaps. Focus on where the obvious approach silently misses data. |
| Output | Questions about extraction traps, CDC mechanisms, soft delete handling, completeness guarantees |
| Delta justification | The synthesis identified multiple failure modes: ORG_ID filtering (~4/10 Claude responses miss), SystemModstamp vs. LastModifiedDate (Claude inconsistently recommends the correct one), queryAll() for soft deletes, WHO column CDC limitation. These are platform-specific traps within each extraction pattern. |
| Template sections | Data Extraction Gotchas (primary), API/Integration Behaviors (primary) |

#### `field-semantics` — Field Semantic Override Research

| Field | Value |
|-------|-------|
| Agent | [`research-field-semantics.md`](../../agents/research-field-semantics.md) |
| Used by | **source** only |
| Role | Surface fields whose standard meaning is overridden or misleading, including managed package field overrides and their modification schedules |
| Default focus | Identify fields whose standard meaning is overridden or misleading: managed package field overrides (which packages modify which fields and on what schedule), independently editable field pairs, multi-valued fields with org-specific meanings, ISV field interactions |
| Output | Questions about field semantic overrides, managed package modifications, field independence |
| Delta justification | High-delta content (CPQ overriding Amount, ForecastCategory/StageName independence, Clari overwriting forecast fields nightly) requires explicit research. Claude knows standard field semantics but cannot know which fields have been overridden in the customer's org. |
| Template sections | Field Semantics and Overrides (primary), Reconciliation Rules (secondary), System Workarounds (secondary) |

#### `lifecycle-and-state` — Record Lifecycle & State Research

| Field | Value |
|-------|-------|
| Agent | [`research-lifecycle-and-state.md`](../../agents/research-lifecycle-and-state.md) |
| Used by | **source** only |
| Role | Surface record lifecycle patterns: state machines, custom stage progressions, lifecycle boundary behaviors, record type-specific lifecycle variations |
| Default focus | Identify state machine behaviors, custom stage progressions, lifecycle boundary conditions (can records regress? skip stages?), record type-specific lifecycle variations, and independently editable state fields |
| Output | Questions about state progressions, lifecycle variations, record type behaviors |
| Delta justification | Template section "State Machine and Lifecycle" previously had zero researching dimensions. RecordTypeId filtering, ForecastCategory/StageName independence, custom stage progressions are lifecycle behaviors Claude doesn't reliably flag. |
| Template sections | State Machine and Lifecycle (primary), Field Semantics and Overrides (secondary) |

#### `reconciliation` — Cross-System Reconciliation Research

| Field | Value |
|-------|-------|
| Agent | [`research-reconciliation.md`](../../agents/research-reconciliation.md) |
| Used by | **source** only |
| Role | Surface cross-table, cross-module, and cross-system reconciliation points where data should agree but often doesn't |
| Default focus | Identify which numbers should agree between systems but don't, source-of-truth resolution for conflicting data, tolerance levels for discrepancies, and reconciliation procedures |
| Output | Questions about reconciliation points, source-of-truth resolution, tolerance levels |
| Delta justification | Claude knows reconciliation as a concept but cannot know which specific tables/objects in a customer's system should agree but don't, or which system is the source of truth. For Customer Beta: SFDC pipeline numbers disagree with Clari and finance. |
| Template sections | Reconciliation Rules (primary), Data Extraction Gotchas (secondary) |

---

## 4. Per-Type Template Structures

Each skill type has a set of template sections that dimensions populate. Primary dimensions
drive the section's content; secondary dimensions contribute supplementary questions.

### Domain Skills (6 sections)

| # | Section | Primary | Secondary |
|---|---------|---------|-----------|
| 1 | Metric Definitions | `metrics` | `modeling-patterns` |
| 2 | Materiality Thresholds | `metrics`, `business-rules` | `segmentation-and-periods` |
| 3 | Segmentation Standards | `segmentation-and-periods` | `business-rules`, `entities` |
| 4 | Period Handling | `segmentation-and-periods` | — |
| 5 | Business Logic Decisions | `business-rules` | `entities`, `modeling-patterns` |
| 6 | Output Standards | *consolidation-synthesized* | `metrics`, `segmentation-and-periods`, `modeling-patterns` |

### Data-Engineering Skills (6 sections)

| # | Section | Primary | Secondary |
|---|---------|---------|-----------|
| 1 | Pattern Selection & Interaction Rules | `pattern-interactions` | `historization` |
| 2 | Entity & Grain Design | `entities` | `pattern-interactions` |
| 3 | Load & Merge Patterns | `load-merge-patterns` | `pattern-interactions` |
| 4 | Historization & Temporal Design | `historization` | `pattern-interactions` |
| 5 | Layer Design & Materialization | `layer-design` | — |
| 6 | Quality Gates & Testing | `data-quality` | `load-merge-patterns` |

### Platform Skills (5 sections)

| # | Section | Primary | Secondary |
|---|---------|---------|-----------|
| 1 | Platform Behavioral Overrides | `platform-behavioral-overrides` | `entities` |
| 2 | Configuration Patterns, Anti-Patterns & Version Compatibility | `config-patterns` | `entities` |
| 3 | Integration and Orchestration | `integration-orchestration` | — |
| 4 | Operational Gotchas and Failure Modes | `operational-failure-modes` | — |
| 5 | Environment-Specific Constraints | `platform-behavioral-overrides`, `operational-failure-modes` | `entities` |

### Source Skills (6 sections)

| # | Section | Primary | Secondary |
|---|---------|---------|-----------|
| 1 | Field Semantics and Overrides | `field-semantics` | `entities`, `lifecycle-and-state` |
| 2 | Data Extraction Gotchas | `extraction` | `data-quality`, `reconciliation` |
| 3 | Reconciliation Rules | `reconciliation` | `field-semantics` |
| 4 | State Machine and Lifecycle | `lifecycle-and-state` | — |
| 5 | System Workarounds | `data-quality` | `field-semantics` |
| 6 | API/Integration Behaviors | `extraction` | — |

---

## 5. Agent Structure

All agents are flat `.md` files in a single `agents/` directory. No subdirectories,
no generated files, no build system. 25 files total:

```
agents/
├── research-planner.md                  # opus planner
├── research-orchestrator.md             # sonnet orchestrator
├── consolidate-research.md              # opus consolidation
├── research-entities.md                 # dimension: cross-type
├── research-data-quality.md             # dimension: cross-type
├── research-metrics.md                  # dimension: domain
├── research-business-rules.md           # dimension: domain
├── research-segmentation-and-periods.md # dimension: domain
├── research-modeling-patterns.md        # dimension: domain
├── research-pattern-interactions.md     # dimension: DE
├── research-load-merge-patterns.md      # dimension: DE
├── research-historization.md            # dimension: DE
├── research-layer-design.md             # dimension: DE
├── research-platform-behavioral-overrides.md  # dimension: platform
├── research-config-patterns.md          # dimension: platform
├── research-integration-orchestration.md      # dimension: platform
├── research-operational-failure-modes.md      # dimension: platform
├── research-extraction.md               # dimension: source
├── research-field-semantics.md          # dimension: source
├── research-lifecycle-and-state.md      # dimension: source
├── research-reconciliation.md           # dimension: source
├── confirm-decisions.md                 # step 5
├── detailed-research.md                 # step 3
├── generate-skill.md                    # step 6
└── validate-skill.md                    # step 7
```

Each dimension agent follows the same structure:
- **Frontmatter**: name, description, `model: sonnet`, standard tool set
- **Role**: one-sentence role statement with a domain persona (e.g., "Senior Business Analyst", "Senior Data Engineer")
- **Context**: receives domain name and planner's tailored focus line; writes no files
- **Instructions**: goal, default focus, delta principle, research approach, constraints (5-8 questions, choices with "Other", return text only)
- **Success criteria**: dimension-specific quality checks

---

## 6. Focus Line Tailoring

The planner tailors focus lines for each dimension in the type-scoped set. Since each
type has its own dimension set, focus patterns are naturally type-specific. Two
dimensions that appear in multiple type sets (`entities` and `data-quality`) have
type-specific focus patterns. Four expanded dimensions include additional scope beyond
their catalog defaults.

### `entities` — focus varies by skill type

| Type | Planner focuses on |
|------|-------------------|
| **domain** | Business entities, customer hierarchies, organizational relationships, and cross-entity analysis patterns |
| **data-engineering** | Entity classification (dimension vs. fact vs. bridge vs. reference), grain decisions per entity, surrogate key strategy, natural key composition, conformed dimension identification |
| **platform** | Platform resources, environment-specific resource distinctions, configuration objects, and dependency relationships |
| **source** | Custom objects, managed package objects, record type subdivisions, and non-standard relationships. Do NOT enumerate standard objects Claude already knows. Include installed managed packages, schema extensions, and standard field overrides. |

### `data-quality` — focus varies by skill type

| Type | Planner focuses on |
|------|-------------------|
| **data-engineering** (as `quality-gates`) | Pattern-specific quality checks: per-layer validation rules, cross-layer reconciliation accounting for row multiplication, quality gate thresholds, pipeline failure response (halt vs. quarantine vs. continue) |
| **source** (as `data-quality`) | Known data quality issues in the source system: fields commonly null or unreliable, validation rules forcing incorrect data entry, data cleanup jobs, quality expectations for downstream consumers |

### Expanded dimensions — additional scope in focus lines

| Dimension | Planner includes |
|-----------|-----------------|
| **`extraction`** (source) | CDC field selection (which timestamp captures all changes including system-initiated), soft delete detection mechanisms, parent-child change propagation gaps |
| **`field-semantics`** (source) | Which managed packages modify which fields and on what schedule, ISV field interactions, package update impact on field semantics |
| **`config-patterns`** (platform) | Version-dependent configuration requirements, adapter version pinning, multi-axis compatibility (core x adapter x runtime), breaking changes across version boundaries |
| **`load-merge-patterns`** (DE) | Failure recovery patterns, backfill strategies for historized data (Type 2 backfill requires historical source snapshots), schema evolution in versioned tables, orchestration monitoring for drift |

