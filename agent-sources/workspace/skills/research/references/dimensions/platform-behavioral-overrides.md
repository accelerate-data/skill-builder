# Platform Behavioral Overrides

## Focus

Investigate platform features that silently degrade or behave differently than documented in the customer's environment and version. Look for features that work in one deployment mode but not another (e.g., warehouse vs. lakehouse), data type edge cases where implicit conversions cause silent corruption, and SQL dialect features documented as supported but producing incorrect results under specific conditions.

## Delta Principle

Claude's parametric knowledge comes from official documentation. When reality diverges from docs, Claude is confidently wrong. For dbt on Fabric: `merge` silently degrades on Lakehouse, datetime2 precision causes snapshot failures, warehouse vs. Lakehouse endpoints change available SQL features. Without surfacing these deviations the skill generates code that looks correct but fails or silently corrupts data in the customer's actual environment.

## Coverage Targets

Research should surface: known behavioral deviations contradicting documentation, undocumented limitations causing silent failures, and environment-specific behaviors differing across deployment modes. Focus on decisions that change skill content.

## Questions to Research

1. Which platform features behave differently in the customer's specific environment or version than the official documentation describes?
2. Are there features that work correctly in one deployment mode (e.g., warehouse) but silently fail or degrade in another (e.g., lakehouse)?
3. Which data type behaviors produce silent data corruption — implicit conversions, precision loss, or timezone handling that appears to work but yields wrong values?
4. Which SQL dialect features are documented as supported but produce incorrect results under specific conditions in this environment?
5. Are there undocumented row count, timeout, or resource limits that only manifest at production data volumes?
6. Which platform version boundaries introduced behavioral changes that are not reflected in the current documentation?
7. What workarounds have experienced operators developed for known behavioral deviations, and what signals indicate the deviation is occurring?
