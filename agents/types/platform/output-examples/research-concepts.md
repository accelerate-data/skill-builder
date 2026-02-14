```markdown
## Domain Concepts & Metrics

### Q1: How should API rate limiting be represented?
The platform enforces rate limits that affect how integrations consume data. How should the skill represent rate limit handling?

**Choices:**
a) **Fixed delay between requests** — Simple but wasteful; doesn't adapt to actual limit consumption.
b) **Token bucket with exponential backoff** — Adapts to rate limit headers and retries intelligently.
c) **Concurrency-based throttling** — Limits parallel requests rather than spacing sequential ones.
d) **Other (please specify)**

**Recommendation:** Option (b) — token bucket with backoff handles most platform APIs gracefully and adapts to varying rate limit windows.

**Answer:**
```
