# Load & Merge Patterns

## Focus

Trace the full lifecycle of each load pattern -- initial load, steady-state incremental, failure recovery, and backfill -- to find where edge cases hide. Investigate merge failure midway through Type 2 updates, backfilling Type 2 history from current-state-only sources, and schema evolution interacting with versioned tables. Focus on operational concerns that only surface after months in production.

## Delta Principle

Claude knows generic MERGE INTO syntax and high-water marks. The delta is: watermark boundary duplicate handling (overlap window + dedup), MERGE failure recovery for Type 2 (duplicate current records), platform-specific merge characteristics, and day-2 operational concerns (backfilling Type 2 requires historical source snapshots). Without these specifics the skill produces pipelines that work initially but fail under operational stress.

## Coverage Targets

Research should surface: merge predicate design, watermark boundary handling, idempotency guarantees, failure recovery patterns, backfill strategies for historized data, and schema evolution concerns for versioned tables. Focus on decisions that change skill content.

## Questions to Research

1. Which column is used as the high-water mark for incremental loads, and how are records that arrive at the watermark boundary (duplicates across runs) handled?
2. What change detection approach is used — timestamp comparison, hash-based diffing, or CDC — and which source fields are reliable enough to serve that role?
3. How is MERGE predicate idempotency guaranteed — what prevents duplicate rows if a merge runs twice due to failure and retry?
4. If a Type 2 MERGE fails midway through, what is the recovery procedure to avoid duplicate current records?
5. How are Type 2 history backfills handled when the source system only retains current state — is historical source data available, and if not, what approximation strategy is used?
6. How does schema evolution (new columns, column renames, type changes) interact with versioned tables that use hash-based change detection?
7. Are there platform-specific merge behaviors or limitations (e.g., row-level locking, partition requirements, performance characteristics) that affect merge predicate design?
8. What monitoring exists to detect merge drift — situations where the pipeline runs successfully but the target table has diverged from source?
