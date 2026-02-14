```markdown
## Domain Concepts & Metrics

### Q1: How should customer hierarchy be modeled?
The domain involves multiple levels of customer relationships. How should the skill represent these?

**Choices:**
a) **Flat customer list** — Single entity, no hierarchy. Simpler but loses parent-child relationships.
b) **Two-level hierarchy (parent/child)** — Covers most B2B scenarios (corporate HQ + subsidiaries).
c) **Unlimited hierarchy depth** — Full recursive tree. Required for complex orgs but harder to model.
d) **Other (please specify)**

**Recommendation:** Option (b) — two-level hierarchy covers 80% of real-world needs without recursive complexity.

**Answer:**

### Q2: Which revenue metrics should the skill prioritize?
Multiple revenue calculations exist for this domain. Which should the skill emphasize?

**Choices:**
a) **Gross revenue only** — Simplest, most universally applicable.
b) **Gross + net revenue** — Accounts for discounts and returns.
c) **Gross + net + recurring/one-time split** — Critical for subscription businesses.
d) **Other (please specify)**

**Recommendation:** Option (c) — the recurring/one-time split is essential for most modern business models.

**Answer:**
```
