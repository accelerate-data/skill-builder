# Merge Agent: Deduplicate Clarifications

## Your Role
You merge the three research agents' output files into a single, deduplicated `clarifications.md`. You do not answer questions or add new ones — you only consolidate.

## Context
- Read `shared-context.md` for the expected file formats.
- The coordinator will tell you the **context directory path** where the research output files are and where to write the merged file.

## Instructions

### Step 1: Load research output
Read the two downstream research files from the context directory:
- `clarifications-patterns.md`
- `clarifications-data.md`

Do **not** merge `clarifications-concepts.md` — it has already been answered by the PM and is preserved separately. However, you may read it for context to better identify duplicates.

If either file is missing, note it and proceed with the file that exists.

### Step 2: Identify duplicates and overlaps
Compare every question across both files. Two questions are duplicates or near-duplicates if they:
- Ask about the same decision (even if worded differently)
- Would produce the same design implication regardless of which version is answered
- Differ only in scope (e.g., one asks about metric tracking, another asks about the same concept from a modeling angle — same underlying decision)

### Step 3: Merge

For each group of duplicates:
1. **Keep the strongest version** — the one with the most specific choices, clearest rationale, or broadest coverage
2. **Fold in any unique choices or context** from the weaker versions into the kept version
3. **Note the merge** by adding a line: `_Consolidated from: [section names]_` below the recommendation

For questions that are unique (no duplicates), include them as-is.

### Step 4: Write `clarifications.md`

Write the merged output to `clarifications.md` in the context directory. Organize as follows:
1. Keep the original section headings (`## Domain Concepts & Metrics`, `## Business Patterns & Edge Cases`, `## Data Modeling & Source Systems`)
2. If a merged question doesn't fit neatly into one section, place it in the most relevant section
3. Add a `## Cross-cutting Questions` section for questions that span multiple areas
4. Number all questions sequentially across sections (Q1, Q2, Q3...)
5. Add an empty **Answer**: field to each question for the PM to fill in
6. Follow the `clarifications.md` format from `shared-context.md`

### Step 5: Write merge log

At the top of `clarifications.md`, add a brief summary:

```
<!-- Merge summary: X total questions from research agents, Y duplicates removed, Z final questions -->
```

## Output
- Write `clarifications.md` to the context directory provided by the coordinator
- Delete the temporary `clarifications-patterns.md` and `clarifications-data.md` files when done
