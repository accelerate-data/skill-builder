# Shared Context — Skill Builder

> **This file is read by all agents.** Changes affect every agent's behavior. Test with `./scripts/validate.sh` after editing.

## Domain
Provided by the user at workflow start. The coordinator asks the user which functional domain the skill covers (e.g., sales pipeline, supply chain, HR analytics, financial planning) and passes it to all agents.

## Skill Users
Data engineers and analytics engineers who need functional domain context to:
- Understand the key entities, metrics, and business rules in the domain
- Determine what silver layer models to build (cleaned, conformed entities)
- Determine what gold layer models to build (business-level aggregates, dimensions, facts, metrics)
- Know which source system fields matter and why
- Avoid common domain-specific modeling mistakes

They already know HOW to build tables technically (SQL, dbt, etc.) — the skill provides the WHAT and WHY: which domain concepts to model, what business logic to encode, and what pitfalls to avoid.

## Content Principles

1. **Omit what LLMs already know well:**
   - Standard API/object structures (e.g., Salesforce standard objects, ERP schemas)
   - Common tool documentation (dbt, SQL syntax, warehouse platforms)
   - Well-documented systems with extensive training data
   - **Test**: "Would Claude know this without the skill?" If yes, omit it.

2. **Focus on domain knowledge that's hard to find:**
   - Industry-specific business rules and edge cases
   - Metrics definitions that vary by company or vertical
   - Common modeling mistakes specific to this domain
   - Relationships between entities that aren't obvious from source schemas
   - Business context that affects how data should be interpreted

3. **Guide WHAT and WHY, not exact HOW:**
   - Prefer: "Your customer dimension needs these attributes because..."
   - Avoid: "Create table `dim_account` with columns..."
   - Rationale: Skills should work across different data platforms, naming conventions, team preferences, and implementation patterns.
   - Exception: Be prescriptive only when exactness matters (e.g., specific metric formulas, business rule logic).

## Folder Structure

Each skill has two directories — a **context directory** for working files and a **skill output directory** for the deployable skill:

```
context/                             # All intermediate/working files
├── clarifications-concepts.md       # Research: domain concepts agent
├── clarifications-patterns.md       # Research: business patterns agent
├── clarifications-data.md           # Research: data modeling agent
├── clarifications.md                # Merged questions + PM answers
├── decisions.md                     # Confirmed decisions (clean snapshot)
├── agent-validation-log.md          # Validate: best practices results
└── test-skill.md                    # Test: test prompts + results

<skillname>/                         # Deployable skill files (skill output directory)
├── SKILL.md                         # Entry point (<500 lines)
└── references/                      # Deep-dive content loaded on demand
    ├── <topic-a>.md
    ├── <topic-b>.md
    └── ...
```

Additionally:
- `<skillname>.skill` — final deployable zip archive (created after successful build)

**Important:** The coordinator provides the full **context directory** and **skill output directory** paths to each agent when spawning it. Agents write files to the directories they are given — no extra subdirectories should be created.

## File Formats

All agent output files use YAML frontmatter for structured metadata. The frontmatter block is delimited by `---` and must be the first thing in the file. When rewriting an existing file, always include the frontmatter block with updated counts — add it if the file you are rewriting does not already have one.

### `clarifications-*.md` (written by research agents to context directory)

```
---
question_count: 8
sections:
  - "Entity Model"
  - "Metrics & KPIs"
  - "Business Rules"
---

## [Section Heading]

### Q1: [Short question title]
**Question**: [Full question text]
**Choices**:
  a) [Choice] — [brief rationale]
  b) [Choice] — [brief rationale]
  c) Other (please specify)
**Recommendation**: [letter] — [why]
**Answer**:
```

### `clarifications.md` (merged file, PM answers inline)

```
---
question_count: 12
sections:
  - "Entity Model"
  - "Metrics & KPIs"
  - "Business Rules"
duplicates_removed: 3
---

## [Section Heading]

### Q1: [Short question title]
**Question**: [Full question text]
**Choices**:
  a) [Choice] — [brief rationale]
  b) [Choice] — [brief rationale]
  c) Other (please specify)
**Recommendation**: [letter] — [why]
**Answer**: [PM writes chosen letter and any notes here]
```

**Auto-fill rule:** If a question's `**Answer**:` field is empty or missing, treat the `**Recommendation**:` choice as the answer. Do not ask for clarification on unanswered questions — use the recommendation and proceed.

### `decisions.md` (in context directory)

This file is a **clean snapshot**, not a cumulative log. Each time the reasoning agent updates it, it rewrites the entire file by merging existing decisions with new ones. If a new decision supersedes or refines an earlier one, the earlier entry is replaced — not kept alongside.

```
---
decision_count: 5
round: 2
---

## Decisions

### D1: [Decision title]
- **Question**: [The original question]
- **Decision**: [The chosen answer]
- **Implication**: [What this means for the skill's design]

### D2: [Decision title]
- **Question**: [The original question]
- **Decision**: [The chosen answer]
- **Implication**: [What this means for the skill's design]
```

**Rules for updating:**
- Number decisions sequentially (D1, D2, D3...)
- If a new decision contradicts or refines an existing one, **replace** the old entry (keep the same D-number)
- If a new decision is entirely new, **add** it at the end with the next number
- The file should always read as a coherent, self-contained set of current decisions — no history, no "superseded by" notes
