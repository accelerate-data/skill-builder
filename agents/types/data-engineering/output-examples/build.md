Example SKILL.md metadata block and pointer section:

```markdown
---
name: Streaming Pipeline Patterns
description: Data engineering knowledge for building and operating streaming data pipelines, covering exactly-once semantics, windowing strategies, backpressure handling, and state management.
author: octocat
created: 2025-06-15
modified: 2025-06-15
---

# Streaming Pipeline Patterns

## Overview
This skill covers streaming pipeline design patterns for engineers building real-time data processing systems. Key concepts: exactly-once semantics, windowing, backpressure, and stateful processing.

## When to Use This Skill
- Engineer asks about designing streaming data pipelines
- Questions about exactly-once processing guarantees or deduplication strategies
- Choosing windowing strategies for time-series aggregations
- Handling backpressure and flow control in high-throughput pipelines

## Quick Reference
- Exactly-once semantics require idempotent writes and transactional checkpointing...
- Tumbling windows are simplest but late-arriving data requires watermark strategies...

## Reference Files
- **references/exactly-once-semantics.md** — Delivery guarantees, checkpoint strategies, and idempotent sink patterns. Read when designing pipeline reliability.
- **references/windowing-strategies.md** — Tumbling, sliding, and session windows with watermark and late data handling. Read when building time-based aggregations.
- **references/backpressure-handling.md** — Flow control patterns, buffer management, and scaling strategies. Read when handling variable throughput.
```
