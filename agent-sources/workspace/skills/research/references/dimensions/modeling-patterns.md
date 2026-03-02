# Modeling Patterns

## Focus

Investigate grain choices and their downstream consequences for silver/gold modeling. Determine whether the domain favors event-level grain, periodic snapshots, or accumulating snapshots, and how that choice affects query performance. Probe for field coverage decisions (which source fields surface at each layer) and identify where standard Kimball needs domain-specific adaptation.

## Delta Principle

Claude knows Kimball methodology and star schemas. The delta is domain-specific modeling decisions: stage-transition grain vs. daily-snapshot grain for pipeline, field coverage (which source fields to silver, which to gold), and the interaction between grain choices and downstream query patterns. Choosing the wrong grain produces models that are technically correct but unusable for the domain's primary queries.

## Coverage Targets

Research should surface: modeling approach trade-offs, grain decisions, snapshot strategy, and field coverage choices. Focus on decisions that change skill content.

## Questions to Research

1. What is the primary analysis pattern for this domain — event-level grain, periodic snapshot, or accumulating snapshot — and what downstream queries drive that choice?
2. For entities that could use either stage-transition or daily-snapshot grain, which does the domain's reporting actually require, and what are the performance trade-offs?
3. Which source fields must be preserved at the silver layer vs. which are only needed at gold, and what determines that decision?
4. Where does the standard Kimball star schema approach need domain-specific adaptation (e.g., degenerate dimensions, fact-to-fact joins, multi-valued dimensions)?
5. How should slowly changing dimension columns be handled at each layer — Type 1 overwrite, Type 2 versioning, or Type 3 attribute preservation?
6. Which aggregate patterns does the domain's primary query workload require (pre-aggregated summary tables, materialized rollups, etc.)?
7. Are there source fields that appear to be the right grain but are unreliable as grain keys (e.g., fields with duplicate values, late population, or system-assigned changes)?
