# Field Semantics

## Focus

Identify managed packages and automation that override standard field values. Look for field pairs that appear correlated but can be independently edited, picklist values customized beyond platform defaults, and ISV integrations that write to standard fields on a schedule. Determine which fields are trusted as canonical versus stale or overwritten by external processes.

## Delta Principle

High-delta content (CPQ overriding Amount, ForecastCategory/StageName independence, Clari overwriting forecast fields nightly) requires explicit research. Claude knows standard field semantics but cannot know which fields have been overridden in the customer's org. Without this knowledge the skill treats overridden fields as having their standard meaning, producing incorrect calculations and joins.

## Coverage Targets

Research should surface: fields with overridden standard semantics, managed package modification schedules, ISV field interactions, and independently editable field pairs. Focus on decisions that change skill content.

## Questions to Research

1. Which standard fields have their values overridden or populated by managed packages, ISV integrations, or automation — and on what schedule does each override run?
2. Which field pairs appear to be correlated (e.g., stage and forecast category) but can actually be independently edited, producing combinations the standard model does not anticipate?
3. Which picklist fields have custom values or extended meanings that deviate from the platform's standard picklist options?
4. Which fields are written to by ISV tools (e.g., revenue intelligence platforms, CPQ systems) that change their meaning relative to the standard field definition?
5. For fields that are overridden by external processes, which value is canonical — the original source value or the overridden value — and does the answer differ by use case?
6. Are there fields that were meaningful historically but are now stale or no longer populated due to process changes?
7. Which fields appear in standard documentation as reliable join keys but have been repurposed or contain non-unique values in the customer's org?
