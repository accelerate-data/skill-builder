# Business Analyst Patterns

Domain decomposition methodology for translating business domains into data engineering artifacts. Used by generate and validate agents when building domain and source skills.

## Contents
- [Silver/Gold Boundary per Skill Type](#silvergold-boundary-per-skill-type)
- [Domain-to-Data-Engineering Mapping](#domain-to-data-engineering-mapping)
- [Source and Platform Skills](#source-and-platform-skills)
- [Domain Decomposition Methodology](#domain-decomposition-methodology)
- [Completeness Validation](#completeness-validation)
- [Common Decomposition Mistakes](#common-decomposition-mistakes)

## Silver/Gold Boundary per Skill Type

Where the silver layer ends and the gold layer begins varies by skill type. Use this table when deciding which content belongs at which layer:

| Skill Type | Silver Layer | Gold Layer |
|---|---|---|
| **Domain** | Cleaned, typed, deduplicated entities | Business metrics, aggregations, denormalized for BI |
| **Platform** | Platform-specific extraction handling | Platform-agnostic business layer |
| **Source** | Source-specific field mapping, type coercion, relationship resolution | Source-agnostic entity models |
| **Data Engineering** | Pattern implementation (SCD, CDC) | Pattern consumption (query patterns, materialization) |

Skills should make this boundary explicit — state which models live in silver vs. gold and why, rather than leaving the layer assignment implicit.

---

## Domain-to-Data-Engineering Mapping

When a skill covers a business domain, translate domain concepts into medallion-aligned data engineering patterns. Every domain skill should address:

- **Entities to Models**: Identify domain entities. Classify as dimensions (`dim_`) or facts (`fct_`). Map mutable reference data to dimensions, events/transactions to facts. Define the grain (what is one row?).
- **Metrics to Gold aggregations**: Identify KPIs and business metrics. Specify exact formulas, not vague descriptions. Define where each metric is computed — intermediate models for reusable calculations, mart models for final business-facing aggregates.
- **Business rules to Silver transforms**: Domain-specific rules (rate calculations, adjudication logic, classification criteria) belong in `int_` models as testable, auditable SQL. Not in gold — gold consumes clean, rule-applied data.
- **Source systems to Bronze ingestion**: Identify source systems and their update patterns (full snapshot, CDC, event stream). This determines dlt write disposition (`append`, `merge`, `replace`) and dbt incremental strategy.
- **Historization to SCD patterns**: Which entities need historical tracking? Slowly changing dimensions to dbt snapshots (SCD2). Rapidly changing measures to incremental fact tables with effective dates.
- **Data quality to Elementary tests by layer**: Map domain-specific quality rules to concrete tests. "Account balance must never be negative" to `column_anomalies` on silver. "Revenue totals must reconcile" to custom test on gold.
- **Grain decisions are critical**: Every model needs an explicit grain statement. Mismatched grain is the #1 cause of wrong metrics. State the grain, the primary key, and the expected row count pattern.

## Source and Platform Skills

For skills about source systems (APIs, databases, SaaS platforms) or platform tools, Context7 already provides official API docs, data model references, and configuration examples. Skills must go beyond what's in those docs:

- **Undocumented behaviors** — rate limit patterns that aren't in the API docs, pagination quirks, eventual consistency windows, silent data truncation
- **Field semantics** — fields whose meaning isn't obvious from the schema (e.g., `status=3` means "soft-deleted", `amount` is in cents not dollars, `updated_at` only reflects metadata changes not data changes)
- **Integration patterns** — how this source's data lands in bronze (dlt resource config, write disposition, incremental cursor field), what breaks during schema evolution
- **Data quality traps** — fields that go null without warning, timestamp timezone inconsistencies, IDs that aren't actually unique, late-arriving records
- **Operational knowledge** — API outage patterns, backfill strategies, how to handle historical loads vs incremental, retry-safe vs non-idempotent endpoints

## Domain Decomposition Methodology

A systematic approach for extracting domain knowledge that Claude doesn't already have.

### Step 1: Identify the domain boundary

Define what's in scope and what's not. A domain skill should cover one functional area (e.g., "claims processing" not "insurance"). If the domain is too broad, the skill will be shallow everywhere. If too narrow, it won't justify its token cost.

### Step 2: Map entities and relationships

List every business entity in the domain. For each:
- Is it a **dimension** (slowly changing reference data) or a **fact** (event/transaction)?
- What is the **grain** — one row represents what?
- What is the **natural key** vs surrogate key?
- Which entities have **parent-child** relationships (hierarchies)?

### Step 3: Extract metrics and their formulas

For every KPI or business metric:
- What is the **exact formula** (not "revenue" but "SUM(line_amount) WHERE status != 'cancelled'")?
- What is the **time grain** (daily, monthly, trailing 12 months)?
- Where should it be **computed** — intermediate model (reusable) or mart (final)?
- Are there **standard breakdowns** (by region, product, customer segment)?

### Step 4: Locate business rules

Business rules are domain-specific logic that Claude cannot infer:
- Classification rules (what makes a customer "high value"?)
- Calculation rules (how is commission calculated?)
- Validation rules (what combinations are invalid?)
- Temporal rules (fiscal year boundaries, reporting periods)

Each rule maps to a specific medallion layer — typically `int_` models in silver.

### Step 5: Identify what the domain expert knows that Claude doesn't

The delta principle: only include knowledge that Claude cannot get from Context7 + its training data. Ask:
- "Would a data engineer joining this team need to be told this?"
- "Would Claude get this wrong without explicit guidance?"
- "Is this in the official docs for any tool we use?"

If the answer to the last question is yes, omit it.

## Completeness Validation

A domain decomposition is complete when:

- [ ] Every entity has a grain statement and key definition
- [ ] Every metric has an exact formula (not a vague description)
- [ ] Every business rule is mapped to a medallion layer
- [ ] Source systems are identified with update patterns
- [ ] Historization requirements are stated for each entity
- [ ] Data quality rules are mapped to elementary test types
- [ ] The skill adds nothing that Claude already knows from Context7/training data
- [ ] The skill omits nothing that a new data engineer would need to be told

## Common Decomposition Mistakes

- **Confusing derived metrics with raw measures** — "revenue" is a metric (computed from line items); "line_amount" is a raw measure from the source
- **Mixing grain levels** — a model that has both order-level and line-item-level rows will produce wrong aggregates
- **Conflating business rules with data quality rules** — "commission is 10% of revenue" is a business rule (silver transform); "commission must be positive" is a data quality rule (elementary test)
- **Describing the domain without bridging to data engineering** — a skill that explains "what fund transfer pricing is" without mapping it to dbt models is a Wikipedia article, not a skill
- **Over-scoping** — trying to cover an entire industry vertical in one skill produces shallow, generic content that Claude could generate without guidance
- **Under-scoping** — a skill about "how to calculate one specific metric" doesn't justify the token overhead of a full skill
