---
skill_type: data-engineering
domain: Dimensional Data Pipelines
dimensions_evaluated: 6
dimensions_selected: 4
---
# Research Plan

## Skill: Dimensional Data Pipelines (data-engineering)

## Dimension Scores

| Dimension | Score | Reason | Companion Note |
|-----------|-------|--------|----------------|
| entities | 5 | Pipeline components, dimension/fact tables, SCD structures require domain-specific entity modeling | |
| historization | 5 | SCD type selection, temporal design, and point-in-time patterns are central to dimensional modeling | |
| load-merge-patterns | 4 | Dimension load strategies and fact table merge patterns interact with historization choices | |
| pattern-interactions | 4 | Constraint chains between SCD type, merge strategy, and key design are non-obvious | |
| data-quality | 2 | Quality gates are important but largely covered by standard dbt testing patterns | Consider a companion data quality skill for complex pipeline monitoring |
| layer-design | 2 | Silver/gold boundary is secondary to core dimensional patterns for this domain | Consider a companion layer design skill for complex multi-hop lineage |

## Selected Dimensions

| Dimension | Focus |
|-----------|-------|
| entities | Pipeline components, dimension/fact tables, SCD structures, surrogate key strategies, and data lineage relationships specific to dimensional modeling. |
| historization | SCD Type 1/2/3 strategies, effective dating, snapshot vs. versioned rows, and temporal join patterns for dimensional queries. |
| load-merge-patterns | Dimension load strategies (full vs. incremental), fact table merge patterns, late-arriving dimension handling, and deduplication approaches. |
| pattern-interactions | Constraint chains between SCD type selection, merge strategy, key design, and materialization for dimensional pipelines. |
