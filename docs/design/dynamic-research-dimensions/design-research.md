# Dimension Design Principles

Reference for evaluating, adding, modifying, or removing research dimensions. Use this
when the dimension catalog needs to change — a new skill type is added, a dimension
consistently underperforms, or new failure modes reveal a knowledge gap not covered.

---

## The Delta Principle

Skills must encode only the delta between Claude's parametric knowledge and the
customer's actual needs. Dimensions must surface knowledge Claude *lacks*, not restate
what Claude already knows.

A dimension that researches "standard Salesforce object model" is actively harmful — it
produces content that suppresses Claude's existing (correct) knowledge.

**Test for every candidate dimension**: Would the clarification questions this dimension
produces surface knowledge that a senior data engineer who just joined the team would
need? If Claude can already answer those questions correctly without a skill loaded,
the dimension is redundant.

---

## Template Section Mapping

Dimensions should map to or inform template sections — a dimension that produces
interesting research but doesn't help populate any template section has unclear output
value.

**Source skills (6 sections):**
1. Field Semantics and Overrides
2. Data Extraction Gotchas
3. Reconciliation Rules
4. State Machine and Lifecycle
5. System Workarounds
6. API/Integration Behaviors

**Domain skills (6 sections):**
1. Metric Definitions
2. Materiality Thresholds
3. Segmentation Standards
4. Period Handling
5. Business Logic Decisions
6. Output Standards

**Platform skills (5 sections):**
1. Platform Behavioral Overrides
2. Configuration Patterns, Anti-Patterns & Version Compatibility
3. Integration and Orchestration
4. Operational Gotchas and Failure Modes
5. Environment-Specific Constraints

**Data-engineering skills (6 sections):**
1. Pattern Selection & Interaction Rules
2. Entity & Grain Design
3. Load & Merge Patterns
4. Historization & Temporal Design
5. Layer Design & Materialization
6. Quality Gates & Testing

---

## What Makes a Good Dimension

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

**Granularity check**: A dimension that always produces the same questions regardless of
the specific instance is too generic (consider splitting). A dimension so narrow it only
applies to one skill instance is too specific (merge or remove).

---

## Concrete Failure Modes

These reference cases ground dimension evaluation. When assessing whether a dimension
is justified, reason against cases like these.

### Domain: Pipeline Forecasting

*Tech services company. Coverage targets segmented by deal type (4.5x New Business,
2x Renewal). Win rate excludes sub-$25K and sub-14-day deals. Velocity formula includes
custom discount impact factor. Stage-to-forecast-category mapping is non-linear and
varies by record type.*

What goes wrong without the right dimensions:
- Seeding "coverage target = 3x" when the customer targets 4.5x New Business / 2x Renewal
  makes every pipeline assessment wrong for both segments
- "Win rate = won / (won + lost)" when the customer excludes sub-$25K and sub-14-day deals
  produces systematically wrong analysis
- "PO Cycle Time from PO creation" when the customer measures from requisition approval
  shows cycle times 3-4 days shorter than reality
- Supplier scoring weights "33/33/33" contradicting board-approved 40/35/25

### Source: Salesforce with Managed Packages

*Salesforce CRM with Steelbrick CPQ (overrides Opportunity.Amount), Clari (writes
forecast values nightly to custom fields), Gong (activity data model), Territory2 with
custom Named_Account_Tier__c.*

What goes wrong without the right dimensions:
- CPQ (managed package) overrides Opportunity.Amount — the "standard" field is wrong
- SystemModstamp vs. LastModifiedDate for CDC — Claude inconsistently recommends the correct one
- queryAll() required for soft deletes — standard query() silently excludes IsDeleted records
- RecordTypeId filtering — omitting it silently mixes deal types in multi-record-type orgs
- ForecastCategory and StageName are independently editable — produces discrepant reports
- Managed package entropy: Steelbrick CPQ, Clari, Gong inject objects and override fields

### Source: Oracle ERP

What goes wrong without the right dimensions:
- ORG_ID filtering on PO_HEADERS_ALL — omitting returns cross-org data without error (~4/10 Claude responses miss this)
- WHO column CDC limitation — parent timestamps miss child-record changes
- Interface tables (*_INTERFACE) contain uncommitted transactions — extracting from them produces wrong data
- Flex field resolution via FND_DESCRIPTIVE_FLEXS — Claude knows flex fields exist but doesn't produce the resolution procedure

### Platform: dbt on Fabric

*dbt-fabric adapter on Microsoft Fabric. Lakehouse vs. warehouse endpoints, custom SQL
dialect, CI/CD integration via GitHub Actions.*

What goes wrong without the right dimensions:
- `merge` strategy silently degrades on Lakehouse endpoints — standard dbt docs don't cover this
- `datetime2` precision causes snapshot failures in certain Fabric configurations
- Warehouse vs. Lakehouse endpoints change which SQL features and materializations are available
- Following official dbt documentation produces incorrect behavior in Fabric-specific cases

---

## Evaluating Dimension Assignments

When deciding which skill type(s) a dimension applies to:

**Cross-type**: A dimension applies across types only when its questions produce
meaningfully different answers per instance *for each type*. The `entities` dimension
works across all 4 types because entity landscape is always customer-specific. Generic
concepts like "data lineage" are not cross-type — they're things Claude already knows.

**Type-specific scope**: When a dimension's questions are the same for every instance
of a given type, it belongs to that type only. `metrics` always produces different
formulas for different domain skills — it's domain-specific. `field-semantics` always
surfaces different overrides for different source systems — it's source-specific.

**Overlap vs. duplication**: Two dimensions can cover related territory without being
redundant if their questions surface different knowledge. `extraction` (CDC mechanisms,
soft deletes) and `field-semantics` (which fields are overridden) both relate to
"getting data out of Salesforce" but produce non-overlapping questions.

---

## Scoring Guidance

Dimensions are scored 1–5 against a specific domain before research begins. See
`references/scoring-rubric.md` for the full rubric. Summary:

- **5** — High delta, multiple template sections, different questions per instance
- **4** — Clear delta, at least one template section, mostly instance-specific questions
- **3** — Some delta, narrow template section coverage, or partially generic questions
- **2** — Weak delta, mainly restates Claude's existing knowledge
- **1** — No meaningful delta; redundant with Claude's parametric knowledge

Top 3–5 dimensions by score are selected. Prefer quality of coverage over hitting an
exact count.
