# Research Dimensions

Reference for the 18 research dimensions: catalog, per-type template mappings, focus line tailoring, and design guidelines.

---

## The Delta Principle

Skills must encode only the **delta** between Claude's parametric knowledge and the customer's actual needs. Dimensions surface knowledge Claude *lacks* — not what Claude already knows from training data.

A dimension that researches "standard Salesforce object model" is actively harmful — it produces content that suppresses Claude's existing (correct) knowledge.

**Test for every dimension**: Would the clarification questions surface knowledge that a senior engineer who just joined the team would need? If Claude can answer those questions correctly without a skill loaded, the dimension is redundant.

---

## Skill Structure

The research skill lives at `agent-sources/workspace/skills/research/`. Its reference files:

| File | Purpose |
|------|---------|
| `references/dimension-sets.md` | Maps each skill type to its 5–6 candidate dimensions |
| `references/scoring-rubric.md` | Rubric for scoring dimensions 1–5 and selecting top 3–5 |
| `references/dimensions/{slug}.md` | One file per dimension — role, default focus, research approach, output format |
| `references/consolidation-handoff.md` | Format spec for `clarifications.md` and consolidation instructions |

---

## Dimension Catalog

18 dimensions organized into five groups.

### Cross-Type Dimensions

#### `entities` — Entity & Relationship Research

| Field | Value |
|-------|-------|
| Used by | **all 4 types** (domain, data-engineering, platform, source) |
| Role | Surface core entities, relationships, cardinality patterns, and entity classification decisions specific to the customer's environment |
| Default focus | Identify domain entities, their relationships, cardinality constraints, and cross-entity analysis patterns. Focus on what differs from the standard model Claude already knows. |
| Output | Questions about which entities to model, relationship depth, key cardinality decisions, and departures from textbook models |
| Delta justification | Claude knows standard entity models (Salesforce objects, Kimball star schema, dbt resources). The delta is the customer's specific entity landscape: custom objects, managed package extensions, entity classifications, grain decisions, and non-obvious relationships. |

#### `data-quality` — Data Quality Research

| Field | Value |
|-------|-------|
| Used by | **data-engineering** (as `quality-gates`), **source** (as `data-quality`) |
| Role | Surface quality checks, validation patterns, and known quality issues specific to the skill's domain |
| Default focus | Identify pattern-specific quality checks (DE) and org-specific known quality issues (source) that go beyond generic data quality concepts |
| Output | Questions about validation rules, quality gate thresholds, known quality issues, pipeline failure response |
| Delta justification | Claude knows generic data quality concepts (null checks, uniqueness, referential integrity). The delta is pattern-specific checks (e.g., row multiplication accounting after MERGE into Type 2) and org-specific issues (e.g., fields commonly null due to validation rule workarounds). |

---

### Domain-Specific Dimensions

#### `metrics` — Metrics & KPI Research

| Field | Value |
|-------|-------|
| Used by | **domain** only |
| Role | Surface specific metrics and KPIs with emphasis on where calculation definitions diverge from industry standards — exact formula parameters, inclusion/exclusion rules, calculation nuances |
| Default focus | Identify key business metrics, their exact calculation formulas, parameter definitions (denominators, exclusions, modifiers), and where "approximately correct" defaults would produce wrong analysis |
| Output | Questions about which metrics to support, formula parameters, aggregation granularity, and metric presentation |
| Delta justification | Claude knows textbook formulas (coverage = open/quota, win rate = won/(won+lost)). The delta is every parameter: coverage denominator, segmented targets, win rate exclusions, custom modifiers. |

#### `business-rules` — Business Rules Research

| Field | Value |
|-------|-------|
| Used by | **domain** only |
| Role | Surface business rules that constrain data modeling — conditional logic, regulatory requirements, organizational policies that override textbook logic |
| Default focus | Identify business rules that affect data modeling, industry-specific variations, regulatory constraints, and rules that engineers without domain expertise commonly implement incorrectly |
| Output | Questions about conditional business logic, regulatory requirements, exception handling rules |
| Delta justification | Claude knows standard business rules at textbook level. The delta is the customer's actual rule logic: pushed deals treated differently by deal type, maverick spend thresholds, co-sold deal attribution models. |

#### `segmentation-and-periods` — Segmentation & Period Handling Research

| Field | Value |
|-------|-------|
| Used by | **domain** only |
| Role | Surface how the organization segments business data and handles time-based logic: segmentation breakpoints, fiscal calendars, snapshot cadence, cross-period rules |
| Default focus | Identify specific segmentation breakpoints, fiscal calendar structure, snapshot timing, and cross-period rules that constrain metric calculations |
| Output | Questions about segment definitions, fiscal calendar, period handling, snapshot cadence |
| Delta justification | Claude knows generic segmentation patterns. The delta is specific breakpoints (enterprise = 500+ employees AND $1M+ ACV), the customer's fiscal calendar, snapshot timing, and cross-period rules. |

#### `modeling-patterns` — Modeling Patterns Research

| Field | Value |
|-------|-------|
| Used by | **domain** only |
| Role | Surface silver/gold layer modeling patterns for the business domain: fact table granularity, snapshot strategies, source field coverage decisions |
| Default focus | Identify domain-specific modeling decisions: grain choices (stage-transition vs. daily-snapshot), field coverage (which source fields to silver vs. gold), and interactions between grain choices and downstream query patterns |
| Output | Questions about modeling approach, grain decisions, snapshot strategy, field coverage |
| Delta justification | Claude knows Kimball methodology and star schemas. The delta is domain-specific grain and field coverage decisions and their downstream interactions. |

---

### Data-Engineering-Specific Dimensions

#### `pattern-interactions` — Pattern Interaction & Selection Research

| Field | Value |
|-------|-------|
| Used by | **data-engineering** only |
| Role | Surface non-obvious interactions between pattern choices (load strategy, merge approach, historization type, materialization) that constrain each other |
| Default focus | Identify constraint chains between patterns: how SCD type selection constrains merge strategy, how merge strategy constrains key design, how historization choice constrains materialization |
| Output | Questions about pattern interactions, constraint chains, selection criteria |
| Delta justification | Claude knows each pattern individually. The delta is the interactions: SCD Type 2 forces hash-based surrogate keys, which forces MERGE INTO, which requires reliable change timestamps. |

#### `load-merge-patterns` — Load & Merge Strategy Research

| Field | Value |
|-------|-------|
| Used by | **data-engineering** only |
| Role | Surface specific load strategy and merge implementation decisions, including failure recovery, backfill strategies, and schema evolution handling |
| Default focus | Identify high-water mark column selection, change detection approaches, merge predicate design, idempotency guarantees, failure recovery patterns, backfill strategies for historized data, schema evolution in versioned tables |
| Output | Questions about merge predicates, watermark handling, failure recovery, backfill approach, schema evolution |
| Delta justification | Claude knows generic MERGE INTO syntax. The delta is watermark boundary duplicate handling, MERGE failure recovery for Type 2, platform-specific merge characteristics, and day-2 operational concerns. |

#### `historization` — Historization & Temporal Design Research

| Field | Value |
|-------|-------|
| Used by | **data-engineering** only |
| Role | Surface SCD type selection rationale per entity, effective date conventions, snapshot vs. row-versioning trade-offs, bitemporal modeling triggers, history retention policies |
| Default focus | Identify when Type 2 breaks down at scale, when snapshots outperform row-versioning, when bitemporal modeling is required vs. overkill, and retention policies |
| Output | Questions about SCD type selection per entity, snapshot strategy, bitemporal triggers, retention |
| Delta justification | Claude knows SCD Types 1/2/3/4/6. The delta is threshold decisions: when Type 2 breaks down at scale, when snapshots outperform row-versioning, when bitemporal is required. |

#### `layer-design` — Silver/Gold Layer Design Research

| Field | Value |
|-------|-------|
| Used by | **data-engineering** only |
| Role | Surface layer boundary decisions, conformed dimension governance, fact table granularity, materialization strategy, aggregate table design |
| Default focus | Identify where to draw the silver/gold boundary, physical vs. logical dimension conformance, materialization trade-offs specific to pattern choices, and aggregate table design |
| Output | Questions about layer boundaries, conformed dimensions, materialization approach, aggregate patterns |
| Delta justification | Claude knows medallion architecture and star schema. The delta is where to draw the silver/gold boundary, physical vs. logical conformance, and materialization trade-offs specific to pattern choices. |

---

### Platform-Specific Dimensions

#### `platform-behavioral-overrides` — Platform Behavioral Override Research

| Field | Value |
|-------|-------|
| Used by | **platform** only |
| Role | Surface cases where the platform behaves differently than its documentation states — the "docs say X, reality is Y" items |
| Default focus | Identify behavioral deviations from official documentation in the customer's specific environment. Focus on cases where following the docs produces wrong results. |
| Output | Questions about known behavioral deviations, undocumented limitations, environment-specific behaviors |
| Delta justification | Claude's parametric knowledge comes from official documentation. When reality diverges from docs, Claude is confidently wrong. For dbt on Fabric: `merge` silently degrades on Lakehouse, datetime2 precision causes snapshot failures. |

#### `config-patterns` — Configuration Pattern Research

| Field | Value |
|-------|-------|
| Used by | **platform** only |
| Role | Surface dangerous configuration combinations (valid syntax, wrong semantics), required settings with non-obvious defaults, version-dependent configuration constraints |
| Default focus | Identify configuration combinations that fail in practice, version-dependent configuration requirements, adapter version pinning, and breaking changes across version boundaries |
| Output | Questions about dangerous configs, version-dependent configuration constraints, multi-axis compatibility |
| Delta justification | Claude generates syntactically valid configurations from documentation. It cannot reason about which configurations produce unexpected runtime behavior or version-dependent interaction effects. |

#### `integration-orchestration` — Integration and Orchestration Research

| Field | Value |
|-------|-------|
| Used by | **platform** only |
| Role | Surface how the platform connects to other tools, CI/CD pipeline patterns, authentication handoffs between tools, orchestration workflows |
| Default focus | Identify integration patterns, CI/CD pipeline configuration, authentication handoffs between tools, and multi-tool orchestration workflows specific to the customer's deployment |
| Output | Questions about CI/CD patterns, cross-tool integration, orchestration workflows |
| Delta justification | Claude knows individual tool documentation but not how tools interact in real deployments. The integration layer lives in team-specific runbooks, not documentation. |

#### `operational-failure-modes` — Operational Failure Mode Research

| Field | Value |
|-------|-------|
| Used by | **platform** only |
| Role | Surface production failure patterns, debugging procedures, performance pitfalls — the "things that break at 2am" items |
| Default focus | Identify production failure patterns, undocumented timeout behaviors, concurrency issues, environment-specific error behaviors, and debugging procedures from operational experience |
| Output | Questions about production failure patterns, timeout behaviors, concurrency issues, debugging procedures |
| Delta justification | Claude describes happy paths. Production-incident knowledge (unconfigurable timeouts, metadata lock contention from concurrent runs, environment-specific error format differences) comes exclusively from operational experience. |

---

### Source-Specific Dimensions

#### `extraction` — Data Extraction Research

| Field | Value |
|-------|-------|
| Used by | **source** only |
| Role | Surface platform-specific extraction traps that produce silently wrong data, including CDC mechanism selection and change detection gotchas |
| Default focus | Identify platform-specific extraction traps (multi-tenant filtering, governor limits at scale, permission/scope affecting completeness), CDC field selection, soft delete detection mechanisms, and parent-child change propagation gaps |
| Output | Questions about extraction traps, CDC mechanisms, soft delete handling, completeness guarantees |
| Delta justification | Multiple failure modes: ORG_ID filtering (~4/10 Claude responses miss), SystemModstamp vs. LastModifiedDate (Claude inconsistently recommends the correct one), queryAll() for soft deletes, WHO column CDC limitation. |

#### `field-semantics` — Field Semantic Override Research

| Field | Value |
|-------|-------|
| Used by | **source** only |
| Role | Surface fields whose standard meaning is overridden or misleading, including managed package field overrides and their modification schedules |
| Default focus | Identify fields whose standard meaning is overridden: managed package field overrides (which packages modify which fields and on what schedule), independently editable field pairs, multi-valued fields with org-specific meanings |
| Output | Questions about field semantic overrides, managed package modifications, field independence |
| Delta justification | High-delta content (CPQ overriding Amount, ForecastCategory/StageName independence, Clari overwriting forecast fields nightly) requires explicit research. Claude knows standard field semantics but not customer-specific overrides. |

#### `lifecycle-and-state` — Record Lifecycle & State Research

| Field | Value |
|-------|-------|
| Used by | **source** only |
| Role | Surface record lifecycle patterns: state machines, custom stage progressions, lifecycle boundary behaviors, record type-specific lifecycle variations |
| Default focus | Identify state machine behaviors, custom stage progressions, lifecycle boundary conditions (can records regress? skip stages?), record type-specific variations, and independently editable state fields |
| Output | Questions about state progressions, lifecycle variations, record type behaviors |
| Delta justification | RecordTypeId filtering, ForecastCategory/StageName independence, custom stage progressions are lifecycle behaviors Claude doesn't reliably flag. |

#### `reconciliation` — Cross-System Reconciliation Research

| Field | Value |
|-------|-------|
| Used by | **source** only |
| Role | Surface cross-table, cross-module, and cross-system reconciliation points where data should agree but often doesn't |
| Default focus | Identify which numbers should agree between systems but don't, source-of-truth resolution for conflicting data, tolerance levels for discrepancies, and reconciliation procedures |
| Output | Questions about reconciliation points, source-of-truth resolution, tolerance levels |
| Delta justification | Claude knows reconciliation as a concept but cannot know which specific tables/objects in a customer's system should agree but don't, or which system is the source of truth. |

---

## Per-Type Template Structures

Each skill type has a set of template sections that dimensions populate. Primary dimensions drive the section's content; secondary dimensions contribute supplementary questions.

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

## Focus Line Tailoring

The scoring step tailors a focus line for each selected dimension. Two dimensions appear in multiple type sets (`entities` and `data-quality`) and have type-specific focus patterns. Four dimensions have expanded scope beyond their catalog defaults.

### `entities` — focus varies by skill type

| Type | Focus |
|------|-------|
| **domain** | Business entities, customer hierarchies, organizational relationships, and cross-entity analysis patterns |
| **data-engineering** | Entity classification (dimension vs. fact vs. bridge vs. reference), grain decisions per entity, surrogate key strategy, natural key composition, conformed dimension identification |
| **platform** | Platform resources, environment-specific resource distinctions, configuration objects, and dependency relationships |
| **source** | Custom objects, managed package objects, record type subdivisions, and non-standard relationships. Do NOT enumerate standard objects Claude already knows. Include installed managed packages, schema extensions, and standard field overrides. |

### `data-quality` — focus varies by skill type

| Type | Focus |
|------|-------|
| **data-engineering** (as `quality-gates`) | Pattern-specific quality checks: per-layer validation rules, cross-layer reconciliation accounting for row multiplication, quality gate thresholds, pipeline failure response (halt vs. quarantine vs. continue) |
| **source** (as `data-quality`) | Known data quality issues in the source system: fields commonly null or unreliable, validation rules forcing incorrect data entry, data cleanup jobs, quality expectations for downstream consumers |

### Expanded dimensions — additional scope in focus lines

| Dimension | Additional scope |
|-----------|-----------------|
| **`extraction`** (source) | CDC field selection (which timestamp captures all changes including system-initiated), soft delete detection mechanisms, parent-child change propagation gaps |
| **`field-semantics`** (source) | Which managed packages modify which fields and on what schedule, ISV field interactions, package update impact on field semantics |
| **`config-patterns`** (platform) | Version-dependent configuration requirements, adapter version pinning, multi-axis compatibility (core × adapter × runtime), breaking changes across version boundaries |
| **`load-merge-patterns`** (DE) | Failure recovery patterns, backfill strategies for historized data (Type 2 backfill requires historical source snapshots), schema evolution in versioned tables, monitoring for drift |

---

## Dimension Design Guidelines

Use this section when evaluating, adding, modifying, or removing dimensions.

### What makes a good dimension

A dimension is justified when it:

- Surfaces knowledge with a genuine **parametric gap** (Claude can't produce it reliably)
- Maps to one or more **template sections** that need customer-specific content
- Produces **meaningfully different questions** for different skill instances within the same type
- Would cause **silent failures** if skipped — not just missing information, but wrong outputs

A dimension is unjustified when it:

- Restates knowledge Claude already has (suppression risk)
- Always produces the same generic questions regardless of the specific domain/source/platform
- Is so narrow it applies to only one skill instance
- Produces questions whose answers don't change the skill's design

**Granularity check**: A dimension that always produces the same questions regardless of the specific instance is too generic. A dimension so narrow it only applies to one skill instance is too specific.

### Evaluating dimension assignments

**Cross-type**: A dimension applies across types only when its questions produce meaningfully different answers per instance *for each type*. `entities` works across all 4 types because entity landscape is always customer-specific.

**Type-specific**: When a dimension's questions are the same for every instance of a given type, it belongs to that type only.

**Overlap vs. duplication**: Two dimensions can cover related territory without being redundant if their questions surface different knowledge. `extraction` and `field-semantics` both relate to "getting data out of Salesforce" but produce non-overlapping questions.

### Scoring summary

Dimensions are scored 1–5 against a specific domain before research begins. See `references/scoring-rubric.md` for the full rubric.

| Score | Meaning |
|---|---|
| **5** | High delta, multiple template sections, different questions per instance |
| **4** | Clear delta, at least one template section, mostly instance-specific questions |
| **3** | Some delta, narrow template section coverage, or partially generic questions |
| **2** | Weak delta, mainly restates Claude's existing knowledge |
| **1** | No meaningful delta; redundant with Claude's parametric knowledge |

Top 3–5 dimensions by score are selected. Prefer quality of coverage over hitting an exact count.

---

## Concrete Failure Modes

Reference cases that ground dimension evaluation. When assessing whether a dimension is justified, reason against cases like these.

### Domain: Pipeline Forecasting

*Tech services company. Coverage targets segmented by deal type (4.5x New Business, 2x Renewal). Win rate excludes sub-$25K and sub-14-day deals. Velocity formula includes custom discount impact factor.*

What goes wrong without the right dimensions:

- "Coverage target = 3x" when the customer targets 4.5x New Business / 2x Renewal — every pipeline assessment is wrong
- "Win rate = won / (won + lost)" when the customer excludes sub-$25K and sub-14-day deals — systematically wrong analysis
- "PO Cycle Time from PO creation" when the customer measures from requisition approval — cycle times 3-4 days short

### Source: Salesforce with Managed Packages

*Salesforce CRM with Steelbrick CPQ (overrides Opportunity.Amount), Clari (writes forecast values nightly), Gong (activity data model), Territory2 with custom Named_Account_Tier__c.*

What goes wrong without the right dimensions:

- CPQ overrides Opportunity.Amount — the "standard" field is wrong
- SystemModstamp vs. LastModifiedDate for CDC — Claude inconsistently recommends the correct one
- queryAll() required for soft deletes — standard query() silently excludes IsDeleted records
- RecordTypeId filtering — omitting it silently mixes deal types
- ForecastCategory and StageName are independently editable — produces discrepant reports

### Source: Oracle ERP

What goes wrong without the right dimensions:

- ORG_ID filtering on PO_HEADERS_ALL — omitting returns cross-org data without error (~4/10 Claude responses miss this)
- WHO column CDC limitation — parent timestamps miss child-record changes
- Interface tables (*_INTERFACE) contain uncommitted transactions — extracting produces wrong data

### Platform: dbt on Fabric

*dbt-fabric adapter on Microsoft Fabric. Lakehouse vs. warehouse endpoints, custom SQL dialect, CI/CD via GitHub Actions.*

What goes wrong without the right dimensions:

- `merge` strategy silently degrades on Lakehouse endpoints — standard dbt docs don't cover this
- `datetime2` precision causes snapshot failures in certain Fabric configurations
- Warehouse vs. Lakehouse endpoints change which SQL features and materializations are available
