```markdown
## Domain Concepts & Metrics

### Q1: How should pipeline failure recovery be handled?
Pipelines can fail at various stages during data processing. How should the skill represent failure recovery strategies?

**Choices:**
a) **Full reprocessing from scratch** — Simple but expensive; reprocesses all data regardless of where the failure occurred.
b) **Checkpoint-based recovery** — Resumes from the last successful checkpoint; requires checkpoint state management.
c) **Idempotent retry with deduplication** — Retries failed segments with built-in deduplication to prevent data corruption.
d) **Other (please specify)**

**Recommendation:** Option (c) — idempotent retry with deduplication balances reliability and efficiency, and prevents data quality issues from partial failures.

**Answer:**
```
