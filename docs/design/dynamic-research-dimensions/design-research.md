# Design Research: Dynamic Research Dimensions

Structured prompt for identifying and validating the research dimensions that each
skill type needs during the Skill Builder's Research step (Step 1).

**Output directory**: `docs/design/research-design/`

---

## Context Documents

Read these before starting:

| Document | Purpose | Key sections |
|----------|---------|--------------|
| Seed vs. Build synthesis (at `/Users/shwetanksheel/scratch/99_working/scratch-ssl/skill_exploration/research/seed_vs_build/synthesis.md`) | Defines what skills actually contain, the delta principle, template structures per type, and concrete failure modes | Section 2 (convergence), Section 6.1 (procedural annotations), Section 6.2 (template structures), Section 7 (delta filter) |
| `docs/design/dynamic-research-dimensions.md` | Current design doc — architecture, existing dimension catalog, assignment matrix | Section 2 (dimension catalog), dimension assignment matrix |
| Architecture spec section 6.2.4 (at `/Users/shwetanksheel/scratch/99_working/vd-specs-product-architecture/vibedata-architecture.md`) | Defines the 4 skill types: domain, platform, source, data-engineering | Section 6.2.4 |
| `README.md` | Skill Builder overview and workflow | "How It Works" section |

---

## Foundational Principles

These principles from the seed-vs-build synthesis constrain all dimension design:

### The Delta Principle

Skills must encode only the delta between Claude's parametric knowledge and the
customer's actual needs. Research dimensions must surface knowledge Claude *lacks*,
not restate what Claude already knows. A dimension that researches "standard Salesforce
object model" is actively harmful — it produces content that suppresses Claude's
existing (correct) knowledge.

**Test for every candidate dimension**: Would the clarification questions this dimension
produces surface knowledge that a senior data engineer who just joined the team would
need? If Claude can already answer those questions correctly without a skill loaded,
the dimension is redundant.

### Template Section Mapping

The synthesis identified concrete template sections that skills need. Research dimensions
should map to or inform these sections — a dimension that doesn't help populate any
template section has unclear output value.

**Known template sections (from synthesis):**

Source skills (6 sections):
1. Field Semantics and Overrides
2. Data Extraction Gotchas
3. Reconciliation Rules
4. State Machine and Lifecycle
5. System Workarounds
6. API/Integration Behaviors

Domain skills (6 sections):
1. Metric Definitions
2. Materiality Thresholds
3. Segmentation Standards
4. Period Handling
5. Business Logic Decisions
6. Output Standards

Platform skills: **No template structure exists yet.** The platform researcher
(Agent 3) should propose one.

Data-engineering skills: **No template structure exists yet.** The data-engineering
researcher (Agent 2) should propose one.

Bundle interaction contract (source + domain pairs, 4 dimensions):
1. Field-to-Metric Mapping
2. Semantic Translation Rules
3. Data Quality Contract
4. Refresh and Timing Alignment

### What Makes a Good Research Dimension

A research dimension is justified when it:
- Surfaces knowledge with a genuine **parametric gap** (Claude can't produce it reliably)
- Maps to one or more **template sections** that need customer-specific content
- Produces **meaningfully different questions** for different skill instances within the same type
- Would cause **silent failures** if skipped (not just missing information, but wrong outputs)

A research dimension is unjustified when it:
- Restates knowledge Claude already has (suppression risk)
- Always produces the same generic questions regardless of the specific domain/source/platform
- Is so narrow it applies to only one skill instance
- Produces questions whose answers don't change the skill's design

---

## Stage 1: Divergent Research — Identify Dimensions per Skill Type

**Goal**: For each of the 4 skill types, independently identify all research dimensions
that would produce meaningful clarification questions during skill creation.

### Setup

Create `docs/design/research-design/` output directory.

### Execution

Spawn **4 parallel subagents** (one per skill type). Each agent:

1. Reads the context documents above (especially the synthesis — it's the richest source)
2. Reads the existing dimension catalog in `dynamic-research-dimensions.md` Section 2 as a starting point
3. Independently reasons about what research dimensions their skill type needs
4. Evaluates each candidate dimension against the delta principle and template section mapping

#### Agent 1: Domain Skill Researcher

**Skill type**: Domain (functional business domains — e.g., sales pipeline analysis, supply chain, financial reporting)

**What domain skills contain**: Business entities and relationships, industry KPIs and metrics, business rules and regulatory constraints, modeling patterns for silver/gold layers.

**Known template sections** (from synthesis Section 6.2):
Metric Definitions, Materiality Thresholds, Segmentation Standards, Period Handling,
Business Logic Decisions, Output Standards.

**Concrete failure modes to reason about** (from synthesis, Customer Beta — pipeline
forecasting domain skill):
- Seeding "coverage target = 3x" when the customer targets 4.5x New Business / 2x Renewal
  makes every pipeline assessment wrong for both segments
- "Win rate = won / (won + lost)" when the customer excludes sub-$25K and sub-14-day deals
  produces systematically wrong analysis
- "PO Cycle Time from PO creation" when the customer measures from requisition approval
  shows cycle times 3-4 days shorter than reality
- Supplier scoring weights "33/33/33" contradicting board-approved 40/35/25

**Task**: Identify all research dimensions needed when building a domain skill. For each dimension:
- **Name and slug** — human-readable name and kebab-case slug
- **What it researches** — 2-3 sentences on what questions this dimension surfaces
- **Template sections it informs** — which of the 6 domain template sections this dimension helps populate
- **Delta justification** — why Claude can't produce this knowledge from parametric training data
- **What goes wrong if skipped** — concrete failure mode, not abstract risk
- **Example questions** — 2-3 sample clarification questions this dimension would produce for a "sales pipeline analysis" domain skill

Consider dimensions from the existing catalog but also think beyond it. Ask: what does
a data engineer need to know about a business domain to build correct silver/gold models?
What knowledge gaps cause the most rework? What customer-specific decisions does the
synthesis show are always variable?

Write output to `docs/design/research-design/stage1-domain.md`.

#### Agent 2: Data Engineering Skill Researcher

**Skill type**: Data Engineering (technical patterns — e.g., SCD implementation, accumulating snapshots, incremental loading)

**What data-engineering skills contain**: Pipeline load patterns, merge strategies, historization approaches, silver/gold layer design, data quality frameworks, transformation patterns.

**No template structure exists yet.** As part of this research, propose a 5-7 section
template structure for data-engineering skills, analogous to the source and domain
templates in the synthesis. Ask: what sections would a data-engineering skill template
need to guide an engineer through building a pipeline using this pattern?

**Delta context**: Data-engineering skills encode *how* to build pipelines. Claude knows
standard patterns (Kimball methodology, SCD types, incremental loading concepts) from
training data. The delta is: when to choose which pattern, what goes wrong with naive
implementations, and the non-obvious interactions between pattern choices (e.g., how
SCD type selection affects merge strategy selection).

**Task**: Identify all research dimensions needed when building a data-engineering skill. For each dimension:
- **Name and slug**
- **What it researches**
- **Proposed template section(s) it informs** — propose template sections as you identify dimensions
- **Delta justification** — what Claude knows vs. what the dimension surfaces beyond parametric knowledge
- **What goes wrong if skipped**
- **Example questions** — for an "SCD implementation patterns" skill

Write output to `docs/design/research-design/stage1-data-engineering.md`.

#### Agent 3: Platform Skill Researcher

**Skill type**: Platform (tool-specific — e.g., dbt, dlt, Fabric, Terraform, Kubernetes)

**What platform skills contain**: Tool capabilities and constraints, API patterns, configuration schemas, integration patterns, deployment strategies, version compatibility.

**No template structure exists yet.** As part of this research, propose a 5-7 section
template structure for platform skills. Ask: what sections would a platform skill
template need to capture the genuine delta between "reading the docs" and having
expert-level platform knowledge?

**Delta context**: Claude has extensive training data for popular platforms (dbt, Terraform,
Kubernetes). The delta is not "what does dbt do?" but rather: platform-specific gotchas
that aren't in the docs, version-specific behavioral changes, interactions between
platform features that produce unexpected results, and configuration patterns that look
correct but fail in specific environments (e.g., dbt on Fabric vs. dbt on Snowflake).

**Concrete reasoning anchor** (dbt on Fabric):
- Fabric-specific SQL dialect quirks that differ from Snowflake/BigQuery/Redshift docs
- Lakehouse vs. warehouse semantics affecting materialization choices
- CI/CD integration patterns specific to Fabric's deployment model
- The difference between "dbt docs say X" and "on Fabric, X actually behaves as Y"

**Task**: Identify all research dimensions needed when building a platform skill. For each dimension:
- **Name and slug**
- **What it researches**
- **Proposed template section(s) it informs**
- **Delta justification**
- **What goes wrong if skipped**
- **Example questions** — for a "dbt on Fabric" platform skill

Write output to `docs/design/research-design/stage1-platform.md`.

#### Agent 4: Source Skill Researcher

**Skill type**: Source (source-system-specific — e.g., Salesforce, Stripe, QuickBooks, SAP)

**What source skills contain**: Source system object models, API extraction patterns, authentication flows, schema mapping rules, data quality gotchas, change detection strategies.

**Known template sections** (from synthesis Section 6.2):
Field Semantics and Overrides, Data Extraction Gotchas, Reconciliation Rules,
State Machine and Lifecycle, System Workarounds, API/Integration Behaviors.

**Concrete failure modes to reason about** (from synthesis — both reference customers):

*Salesforce (Customer Beta):*
- CPQ (managed package) overrides Opportunity.Amount — the "standard" field is wrong
- SystemModstamp vs. LastModifiedDate for CDC — Claude inconsistently recommends the correct one
- queryAll() required for soft deletes — standard query() silently excludes IsDeleted records
- RecordTypeId filtering — omitting it silently mixes deal types in multi-record-type orgs
- ForecastCategory and StageName are independently editable — non-obvious, produces discrepant reports
- Managed package entropy: Steelbrick CPQ, Clari, Gong inject objects and override fields

*Oracle ERP (Customer Alpha):*
- ORG_ID filtering on PO_HEADERS_ALL — omitting returns cross-org data without error (~4/10 Claude responses miss this)
- WHO column CDC limitation — parent timestamps miss child-record changes
- Interface tables (*_INTERFACE) contain uncommitted transactions — extracting from them produces wrong data
- Flex field resolution via FND_DESCRIPTIVE_FLEXS — Claude knows flex fields exist but doesn't produce the resolution procedure

**Task**: Identify all research dimensions needed when building a source skill. For each dimension:
- **Name and slug**
- **What it researches**
- **Template sections it informs** — which of the 6 source template sections
- **Delta justification** — reference the concrete failure modes above where applicable
- **What goes wrong if skipped**
- **Example questions** — for a "Salesforce extraction" source skill

Consider: the synthesis shows source skills are more seedable than domain skills because
extraction patterns are procedural and less judgment-dependent. Research dimensions for
source skills should focus on surfacing the procedural traps and platform-specific gotchas
that produce silently wrong data.

Write output to `docs/design/research-design/stage1-source.md`.

### Stage 1 Output

After all 4 agents complete, synthesize their outputs into a **proposed dimension assignment matrix**:

`docs/design/research-design/stage1-proposed-matrix.md`

This should contain:
1. **Full dimension catalog** — union of all dimensions identified across all 4 agents, with descriptions and delta justifications
2. **Proposed assignment matrix** — which dimensions apply to which skill types
3. **Template section mapping** — for each type, how dimensions map to template sections (using existing sections for source/domain, proposed sections for platform/data-engineering)
4. **Cross-type dimensions** — dimensions that appear in multiple types, with notes on how focus differs per type
5. **Bundle considerations** — which dimensions help populate the bundle interaction contract (field-to-metric mapping, semantic translation, data quality contract, refresh alignment)
6. **Comparison to current** — what changed vs. the existing matrix in `dynamic-research-dimensions.md` Section 2, and why

---

## Stage 2: Adversarial Validation — Debate the Matrix

**Goal**: Use the debating-it-out skill to stress-test the proposed dimension matrix from Stage 1.

### Setup

Read the debating-it-out skill at:
`/Users/shwetanksheel/scratch/99_working/scratch-ssl/debating-it-out-plugin/skills/debating-it-out/SKILL.md`

Follow its 7-phase protocol exactly.

### Debate Parameters

**Framing question**: "Is the proposed research dimension matrix the right set of
dimensions per skill type — does each dimension surface genuine delta knowledge that
maps to template sections and produces meaningfully different clarification questions
across skill instances?"

**Research documents**:
- `docs/design/research-design/stage1-proposed-matrix.md` (the Stage 1 output)
- `docs/design/dynamic-research-dimensions.md` (the current design doc)
- `/Users/shwetanksheel/scratch/99_working/scratch-ssl/skill_exploration/research/seed_vs_build/synthesis.md` (the seed-vs-build synthesis — delta principle, template structures, failure modes)
- `/Users/shwetanksheel/scratch/99_working/vd-specs-product-architecture/vibedata-architecture.md` (section 6.2.4)

**Reference cases** (for agents to reason concretely about):

1. **Customer Beta: Pipeline Forecasting Domain Skill** — Domain type. Tech services
   company. Coverage targets segmented by deal type (4.5x New Business, 2x Renewal
   against forecast, not quota). Win rate excludes sub-$25K and sub-14-day deals.
   Velocity formula includes custom discount impact factor. Stage-to-forecast-category
   mapping is non-linear and varies by record type. The skill must help engineers build
   silver/gold models where every formula parameter is customer-specific.

2. **Customer Beta: Salesforce Source Skill** — Source type. Salesforce CRM with
   Steelbrick CPQ (overrides Opportunity.Amount), Clari (writes forecast values nightly
   to custom fields), Gong (activity data model), Territory2 with custom Named_Account_Tier__c.
   Standard extraction tutorials produce wrong data (LastModifiedDate misses system changes,
   query() misses soft deletes, Amount is the wrong field). Managed packages create
   unpredictable schema surface.

3. **dbt on Fabric Platform Skill** — Platform type. dbt-fabric adapter on Microsoft
   Fabric. Fabric-specific SQL dialect quirks, lakehouse vs warehouse semantics,
   materialization options, CI/CD integration. The difference between "dbt docs say X"
   and "on Fabric, X actually behaves as Y." No template structure exists yet.

**Constraints for debate agents**:
- **Delta filter**: For each dimension, ask: "Would Claude produce correct clarification
  questions for this dimension's topic without any research agent?" If yes, the dimension
  is redundant. The synthesis showed Claude produces correct Kimball methodology, standard
  formulas, and standard object models from parametric knowledge — dimensions restating
  these are suppression risks.
- **Template mapping**: Each dimension must map to at least one template section. A dimension
  that produces interesting research but doesn't help populate any template section has
  unclear output value.
- **Granularity**: A dimension that always produces the same questions regardless of the
  specific domain/source/platform is too generic (split it). A dimension so narrow it only
  applies to one skill instance is too specific (merge it or remove it).
- **Bundle interactions**: Consider whether any dimensions should explicitly surface
  cross-type knowledge needed for the bundle interaction contract.

### Debate Workspace

All debate outputs go to: `docs/design/research-design/debate/`

### Stage 2 Output

After the debate concludes, the synthesis and consolidated analysis will be in the debate
workspace. Extract the final validated dimension matrix from the synthesis recommendations.

---

## Stage 3: Final Output

After both stages complete, produce the final deliverable:

`docs/design/research-design/final-dimensions.md`

This should contain:

1. **Final dimension catalog** — each dimension with:
   - Name, slug, role, default focus, output description
   - Delta justification (why Claude can't produce this from parametric knowledge)
   - Template section mapping (which sections this dimension informs)

2. **Final assignment matrix** — which dimensions apply to which skill types

3. **Per-type template structures**:
   - Source skills: validated against synthesis Section 6.2 (6 known sections)
   - Domain skills: validated against synthesis Section 6.2 (6 known sections)
   - Platform skills: newly proposed template structure from Stage 1 + debate validation
   - Data-engineering skills: newly proposed template structure from Stage 1 + debate validation

4. **Per-type focus overrides** — how each dimension's focus changes per skill type

5. **Bundle dimension mapping** — which dimensions surface knowledge relevant to the
   bundle interaction contract (field-to-metric mapping, semantic translation, data
   quality contract, refresh alignment)

6. **Rationale** — key decisions from the debate that shaped the final matrix, including:
   - Dimensions added/removed/changed from the current design and why
   - How the delta principle affected dimension selection
   - How template section mapping affected dimension boundaries

7. **Comparison to current** — diff against `dynamic-research-dimensions.md` Section 2's matrix

This document becomes the input for updating `dynamic-research-dimensions.md`.
