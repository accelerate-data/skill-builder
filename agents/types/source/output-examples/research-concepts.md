```markdown
## Domain Concepts & Metrics

### Q1: How should source system pagination be modeled?
The source API returns paginated results with varying page sizes and cursor strategies. How should the skill represent pagination handling?

**Choices:**
a) **Offset-based pagination** — Simple but risks missing or duplicating records when data changes between pages.
b) **Cursor-based pagination** — Handles concurrent modifications gracefully; requires storing cursor state.
c) **Timestamp-based incremental extraction** — Uses last-modified timestamps to fetch only changed records.
d) **Other (please specify)**

**Recommendation:** Option (b) — cursor-based pagination is the most reliable for source systems with frequent data changes and avoids duplication issues.

**Answer:**
```
