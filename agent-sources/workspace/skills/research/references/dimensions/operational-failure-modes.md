# Operational Failure Modes

## Focus

Investigate failure modes discovered only after deploying to production: what breaks under load, during concurrent operations, and at scale boundaries. Look for undocumented timeout behaviors, metadata lock contention patterns, error formats that differ across environments, and debugging procedures experienced operators use but never document.

## Delta Principle

Claude describes happy paths; this dimension surfaces failure paths. Production-incident knowledge (Fabric's unconfigurable 30-minute query timeout, metadata lock contention from concurrent dbt runs, environment-specific test error format differences) comes exclusively from operational experience. Without this knowledge the skill generates code that works in development but fails in production under realistic conditions.

## Coverage Targets

Research should surface: production failure patterns (timeout, concurrency), undocumented debugging procedures, and environment-specific error behaviors at scale. Focus on decisions that change skill content.

## Questions to Research

1. What are the most common production failure patterns for this platform — which operations fail most frequently and under what conditions?
2. Are there undocumented timeout behaviors — operations that silently time out or are killed without a clear error message at production data volumes?
3. Which concurrent operations cause metadata lock contention or resource conflicts, and what are the symptoms and mitigations?
4. How do error messages differ across environments (dev, staging, prod), and which environment-specific error formats require different debugging approaches?
5. What debugging procedures do experienced operators use for rapid incident resolution that are not documented anywhere?
6. At what scale thresholds (row counts, query complexity, concurrency level) do specific operations degrade or fail?
7. Which failure modes produce wrong results silently (no error raised) vs. which produce explicit failures, and how are the silent ones detected?
