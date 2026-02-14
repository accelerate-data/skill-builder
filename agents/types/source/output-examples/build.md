Example SKILL.md metadata block and pointer section:

```markdown
---
name: Stripe Data Extraction
description: Source system knowledge for extracting and modeling data from the Stripe API, covering API endpoints, webhooks, event schemas, and data quality patterns.
author: octocat
created: 2025-06-15
modified: 2025-06-15
---

# Stripe Data Extraction

## Overview
This skill covers Stripe data extraction patterns for engineers building data pipelines from the Stripe API. Key concepts: API endpoints, webhook events, charge lifecycle, and subscription modeling.

## When to Use This Skill
- Engineer asks about extracting data from Stripe's API
- Questions about webhook event handling or event schema structures
- Building incremental extraction pipelines for charges, subscriptions, or invoices
- Handling Stripe-specific data quality issues (currency formatting, timezone handling)

## Quick Reference
- Use the Events API for incremental extraction rather than polling individual resources...
- Webhook signatures must be verified before processing to prevent replay attacks...

## Reference Files
- **references/api-endpoints.md** — Core API endpoints, pagination strategies, and rate limit handling. Read when designing extraction pipelines.
- **references/webhook-events.md** — Webhook event types, delivery guarantees, and idempotency patterns. Read when building event-driven ingestion.
- **references/event-schemas.md** — Key object schemas (charges, subscriptions, invoices) and their relationships. Read when modeling source data.
```
