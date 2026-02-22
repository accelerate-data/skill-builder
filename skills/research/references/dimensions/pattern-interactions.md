# Pattern Interactions

## Focus
Map the constraint graph for this domain: start with entity types and their historization choices, then trace forward to see which merge strategies, key designs, and materialization approaches each choice forces or eliminates. Look for "hidden couplings" -- pairs of patterns that are individually correct but produce incorrect combinations (e.g., Type 2 dimensions combined with view-based materialization at high query volume).

## Delta Principle
Claude knows each pattern individually. The delta is the interactions: SCD Type 2 forces hash-based surrogate keys, which forces MERGE INTO, which requires reliable change timestamps. Late-arriving fact handling depends on whether the joined dimension uses Type 1 (safe) or Type 2 (requires point-in-time lookup). Without this constraint graph the skill recommends individually valid patterns that are incompatible in combination.

## Coverage Targets
Research should surface: non-obvious constraint chains between pattern choices (e.g., SCD type -> merge strategy -> key design) and decision criteria for pattern selection based on entity characteristics. Focus on decisions that change skill content.

## Questions to Research
1. Which historization type choices (SCD Type 1, 2, 3, 4, 6) are used for the primary entities, and what merge strategy does each choice require?
2. How does the SCD type selection constrain surrogate key design — and specifically, does Type 2 usage force hash-based keys or natural key approaches?
3. How does the merge strategy interact with materialization choice — and where do Type 2 dimensions make view-based materialization prohibitively expensive?
4. When facts arrive late and the dimension has already changed, what point-in-time lookup strategy is required, and how does this interact with the dimension's historization approach?
5. Which pattern combinations appear individually correct but are incompatible in practice for this domain?
6. What decision criteria determine which historization type to apply to a new entity — what entity characteristics (change rate, volume, audit requirements) drive the selection?
7. Are there platform-specific constraints that eliminate certain pattern combinations even when they would be valid in other environments?
