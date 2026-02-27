---
name: mock-skill
description: A mock skill generated for UI development testing. Provides guidance on building well-structured applications with proper error handling, testing, and deployment patterns.
tools: Read, Write, Edit, Glob, Grep, Bash
---

# Mock Skill

Build well-structured applications following established patterns for error handling, testing, and deployment.

## Getting Started

### Prerequisites

- Node.js 18+ or Bun 1.0+
- Access to the project repository
- Familiarity with TypeScript and the project's coding standards

### Steps

When starting a new feature:

1. Check the architecture decision records in `docs/adr/`
2. Create a feature branch from `main`
3. Implement with the patterns below
4. Add tests following the tiered strategy
5. Submit for review

## Core Patterns

### Error Handling

Use result types for expected errors. Every error should have:

- **Detection**: How to identify the error
- **Impact**: What breaks downstream
- **Recovery**: Specific steps to fix
- **Prevention**: How to avoid in future

```typescript
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

// Helper for async operations
async function tryAsync<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
```

### Testing Strategy

Follow the test pyramid:

- **Unit tests** (70%): Business logic, pure functions, state transitions
- **Integration tests** (20%): API contracts, database queries, service interactions
- **E2E tests** (10%): Critical user flows only (login, checkout, data export)

### Performance Thresholds

- Response time p95: < 200ms
- Throughput: > 1000 req/s
- Error rate: < 0.1%
- When thresholds are exceeded, follow the optimization sequence in `references/implementation-guide.md`

## When to Read References

- **implementation-guide.md**: Detailed patterns for error handling, logging, and deployment. Read when implementing a new service or debugging production issues.
