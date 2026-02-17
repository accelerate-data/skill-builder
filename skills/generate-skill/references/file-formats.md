## File Formats

IMPORTANT: All output files use YAML frontmatter (`---` delimited, first thing in file). Always include frontmatter with updated counts when rewriting.

### Clarifications (`clarifications.md`)

There is only one clarifications file. The detailed-research step inserts `#### Refinements` subsections in-place rather than creating a separate file.

```
---
question_count: 12
sections: ["Entity Model", "Metrics & KPIs"]
duplicates_removed: 3  # post-consolidation
---
## [Section]
### Q1: [Title]
**Question**: [text]
**Choices**:
  a) [Choice] — [rationale]
  b) [Choice] — [rationale]
  c) Other (please specify)
**Recommendation**: [letter] — [why]

**Answer**:

```
Every question MUST end with a blank `**Answer**:` line followed by an empty line. This is where the user types their reply in the in-app editor. Never omit it, never pre-fill it.

**Auto-fill rule:** Empty `**Answer**:` fields → use the `**Recommendation**:` as the answer. Do not ask for clarification — use the recommendation and proceed.

#### Refinements subsection format

After the user answers first-round questions, the detailed-research step inserts `#### Refinements` blocks under each answered question that warrants follow-up. Refinements drill deeper into the user's chosen direction.

```
### Q1: [Original question]
**Answer**: [User's first-round answer]

#### Refinements

**R1.1: Follow-up topic**
Rationale for why this matters given the answer above...
- [ ] Choice a
- [ ] Choice b
- [ ] Other (please specify)

**Answer**:

**R1.2: Another follow-up**
Rationale...
- [ ] Choice a
- [ ] Choice b
- [ ] Other (please specify)

**Answer**:

```

Each refinement question ID uses the parent question number as a prefix (e.g., R3.1 is the first refinement under Q3). Refinements follow the same `**Answer**:` convention -- blank line after for the user to fill in.

### Scope Recommendation (clarifications.md -- scope mode)

When the research planner selects more dimensions than the configured threshold, the scope-advisor agent writes a scope recommendation instead of normal clarifications. This file has `scope_recommendation: true` in its YAML frontmatter and contains:
- Explanation of why the scope is too broad
- 2-4 suggested narrower skill alternatives
- Instructions for the user to restart with a narrower focus

Downstream agents (detailed research, confirm decisions, generate skill, validate skill) detect `scope_recommendation: true` and gracefully no-op.

### Decisions (`decisions.md`)
Clean snapshot, not a log. Write the complete file from scratch each time.
```
---
decision_count: 5
conflicts_resolved: 2
round: 2
---
### D1: [Title]
- **Question**: [original question]
- **Decision**: [chosen answer]
- **Implication**: [design impact]
- **Status**: resolved | conflict-resolved | needs-review
```
Frontmatter counts give the user an at-a-glance summary: total decisions, how many had contradictions that the agent resolved (review these first). Each decision's `**Status**` field indicates whether it was straightforward (`resolved`), required the agent to pick between contradicting answers (`conflict-resolved`), or needs user input (`needs-review`).
