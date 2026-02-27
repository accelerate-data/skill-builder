# Implementation Guide

## Error Handling Patterns

### Result Type Pattern

Use discriminated unions for type-safe error handling:

```typescript
type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

async function fetchUser(id: string): Promise<ApiResult<User>> {
  try {
    const response = await fetch(`/api/users/${id}`);
    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: `HTTP_${response.status}`,
          message: response.statusText,
          retryable: response.status >= 500,
        },
      };
    }
    return { ok: true, data: await response.json() };
  } catch (e) {
    return {
      ok: false,
      error: { code: "NETWORK_ERROR", message: String(e), retryable: true },
    };
  }
}
```

### Structured Logging

Use JSON logging with correlation IDs:

```typescript
const logger = {
  info: (message: string, context: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: "info", message, ...context, timestamp: Date.now() })),
  error: (message: string, error: Error, context: Record<string, unknown>) =>
    console.error(JSON.stringify({
      level: "error", message,
      error: { name: error.name, message: error.message, stack: error.stack },
      ...context, timestamp: Date.now(),
    })),
};
```

## Deployment Patterns

### Blue-Green Deployment

1. Deploy new version to inactive environment
2. Run health checks (HTTP 200, latency < 500ms, no error spike)
3. Switch traffic via load balancer
4. Monitor for 5 minutes
5. If error rate > 1%, automatic rollback to previous environment

### Database Migrations

- Forward-only migrations with explicit rollback scripts
- Test rollback in staging before production deploy
- Never drop columns in the same release that removes code usage
- Use a two-release strategy: release 1 stops writing, release 2 drops column

## Performance Optimization Sequence

When p95 latency exceeds thresholds:

1. **Measure**: Profile with APM tool, identify top 5 slow endpoints
2. **Identify**: Check database queries (N+1, missing indexes), external API calls, serialization
3. **Fix**: Apply targeted optimization (add index, batch queries, add cache layer)
4. **Validate**: Compare p95 before/after, ensure no regression in other metrics
