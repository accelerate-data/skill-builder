# Logging Policy

Every new feature must include logging. Log at the boundary of side effects and at failure points.

## Rust

Use `tracing` macros from the `tracing` crate (already in scope via Tauri):

| Level | When |
|---|---|
| `info!` | Normal operation: command called, resource created/updated |
| `warn!` | Recoverable anomaly: fallback used, optional step skipped |
| `error!` | Non-recoverable failure: command returns `Err`, invariant broken |
| `debug!` | Internal state during development (strip in release) |

**Conventions:**

- Log command entry at `info!` with relevant IDs: `info!(skill_id, "export_skill: starting")`.
- Log errors before returning: `error!(err = ?e, "export_skill: failed to write file")`.
- Never log secrets (API keys, tokens, passwords).

## TypeScript / Sidecar

Use `console.*` directly — no logging library:

| Call | When |
|---|---|
| `console.log` | Normal operation milestones |
| `console.warn` | Unexpected but recoverable condition |
| `console.error` | Failure; always include the error object |

**Conventions:**

- Prefix with the function/module name: `console.log("[run-agent] starting step", stepIndex)`.
- Log errors with the full error: `console.error("[run-agent] failed", err)`.
- Do not log sensitive data.
