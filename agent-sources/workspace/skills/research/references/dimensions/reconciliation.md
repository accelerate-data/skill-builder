# Cross-System Reconciliation

## Focus

Identify data that flows between multiple systems or modules and should match but diverges in practice. Look for known discrepancies between source systems, conflicting metric definitions across teams, and accepted workarounds for data that never fully reconciles. Determine which system wins when numbers disagree, acceptable tolerance thresholds, and whether reconciliation is automated or manual.

## Delta Principle

Claude knows reconciliation as a concept but cannot know which specific tables/objects in a customer's system should agree but do not, or which system is the source of truth. For example: SFDC pipeline numbers disagree with Clari and finance — without knowing that this discrepancy exists and which system wins, the skill produces reports that will be challenged or rejected by different stakeholder groups.

## Coverage Targets

Research should surface: specific reconciliation points where data diverges, source-of-truth resolution when systems conflict, and tolerance levels with reconciliation procedures. Focus on decisions that change skill content.

## Questions to Research

1. Which numbers should agree between systems (e.g., CRM, finance, revenue intelligence platform) but are known to diverge — and by how much, typically?
2. When the same metric is defined differently across systems or teams, which system or definition is authoritative for each use case?
3. What tolerance thresholds are acceptable for reconciliation gaps — at what discrepancy level does a difference require investigation vs. being accepted as normal?
4. Are there known structural reasons for permanent or periodic reconciliation gaps (timing differences, scope differences, attribution model differences)?
5. How is reconciliation currently performed — automated checks, manual spreadsheet comparisons, or ad hoc investigation — and who is responsible?
6. Which discrepancies have accepted workarounds vs. which are actively being resolved, and does the data model need to accommodate the workaround logic?
7. Are there reconciliation points that break down at period boundaries (month-end, quarter-end) due to close processes, adjustments, or late-arriving data?
