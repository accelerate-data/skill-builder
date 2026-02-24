# Business Analyst Patterns

Domain decomposition for translating business domains into data engineering artifacts.

## Contents
- [Silver/Gold Boundary per Skill Type](#silvergold-boundary-per-skill-type)
- [Domain-to-Data-Engineering Mapping](#domain-to-data-engineering-mapping)
- [Source and Platform Skills](#source-and-platform-skills)
- [Domain Decomposition Methodology](#domain-decomposition-methodology)
- [Completeness Validation](#completeness-validation)
- [Common Decomposition Mistakes](#common-decomposition-mistakes)

## Silver/Gold Boundary per Skill Type

| Skill Type | Silver Layer | Gold Layer |
|---|---|---|
| **Domain** | Cleaned, typed, deduplicated entities | Business metrics, aggregations, denormalized for BI |
| **Platform** | Platform-specific extraction handling | Platform-agnostic business layer |
| **Source** | Source-specific field mapping, type coercion, relationship resolution | Source-agnostic entity models |
| **Data Engineering** | Pattern implementation (SCD, CDC) | Pattern consumption (query patterns, materialization) |

Skills must state which models live in silver vs. gold explicitly.

---

## Domain-to-Data-Engineering Mapping

Every domain skill should address:

- **Entities to Models**: Classify as `dim_` (mutable reference data) or `fct_` (events/transactions). Define the grain.
- **Metrics to Gold aggregations**: Exact formulas for KPIs. Intermediate models for reusable calculations, marts for final aggregates.
- **Business rules to Silver transforms**: Domain-specific rules (rate calculations, adjudication logic, classification criteria) go in `int_` models. Gold consumes clean, rule-applied data.
- **Source systems to Bronze ingestion**: Identify update patterns (full snapshot, CDC, event stream) to determine dlt write disposition and dbt incremental strategy.
- **Historization to SCD patterns**: SCDs to dbt snapshots (SCD2). Rapidly changing measures to incremental fact tables with effective dates.
- **Data quality to Elementary tests by layer**: Map quality rules to concrete tests. "Balance must never be negative" to `column_anomalies` on silver. "Revenue totals must reconcile" to custom test on gold.
- **Grain decisions**: Every model needs an explicit grain statement, primary key, and expected row count pattern.

## Source and Platform Skills

Context7 covers official API docs, data models, and config examples. Skills must go beyond:

- **Undocumented behaviors** — rate limit patterns, pagination quirks, eventual consistency windows, silent truncation
- **Field semantics** — non-obvious meanings (e.g., `status=3` = soft-deleted, `amount` in cents, `updated_at` = metadata-only)
- **Integration patterns** — how data lands in bronze (dlt resource config, write disposition, cursor field), schema evolution breakage
- **Data quality traps** — surprise nulls, timezone inconsistencies, non-unique IDs, late-arriving records
- **Operational knowledge** — outage patterns, backfill strategies, historical vs incremental loads, idempotency

## Domain Decomposition Methodology

### Step 1: Identify the domain boundary

One functional area per skill (e.g., "claims processing" not "insurance"). Too broad = shallow. Too narrow = unjustified token cost.

### Step 2: Map entities and relationships

For each business entity:
- **Dimension** (slowly changing reference data) or **fact** (event/transaction)?
- **Grain** — one row represents what?
- **Natural key** vs surrogate key?
- **Parent-child** relationships (hierarchies)?

### Step 3: Extract metrics and formulas

For every KPI:
- **Exact formula** (not "revenue" but `SUM(line_amount) WHERE status != 'cancelled'`)
- **Time grain** (daily, monthly, trailing 12 months)
- **Compute location** — intermediate (reusable) or mart (final)
- **Standard breakdowns** (by region, product, segment)

### Step 4: Locate business rules

Domain-specific logic Claude cannot infer:
- Classification rules (what makes a customer "high value"?)
- Calculation rules (how is commission calculated?)
- Validation rules (what combinations are invalid?)
- Temporal rules (fiscal year boundaries, reporting periods)

Rules map to `int_` models in silver.

### Step 5: Apply the delta principle

Only include knowledge Claude cannot get from Context7 + training data:
- "Would a new data engineer need to be told this?"
- "Would Claude get this wrong without guidance?"
- "Is this in official docs?" — if yes, omit it.

## Completeness Validation

- [ ] Every entity has a grain statement and key definition
- [ ] Every metric has an exact formula
- [ ] Every business rule is mapped to a medallion layer
- [ ] Source systems identified with update patterns
- [ ] Historization requirements stated per entity
- [ ] Data quality rules mapped to elementary test types
- [ ] Nothing duplicated from Context7/training data
- [ ] Nothing omitted that a new data engineer would need

## Common Decomposition Mistakes

- **Derived metrics vs raw measures** — "revenue" is computed from line items; "line_amount" is a raw source measure
- **Mixed grain levels** — order-level and line-item-level rows in one model produce wrong aggregates
- **Business rules vs data quality rules** — "commission is 10% of revenue" = business rule (silver); "commission must be positive" = quality rule (elementary test)
- **Domain description without data engineering bridge** — explaining "what fund transfer pricing is" without mapping to dbt models
- **Over-scoping** — entire industry vertical in one skill = shallow generic content
- **Under-scoping** — single metric calculation doesn't justify a full skill
