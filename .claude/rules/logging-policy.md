# Logging Rules

Keep logging useful, structured, and safe. Generic logging hygiene still
applies; this file records repo-specific requirements.

## Required Rules

- Every new feature must include logging at the runtime boundary it changes.
- Rust `#[tauri::command]` handlers log `info!` on entry with key non-sensitive
  params and `error!` on failure.
- Sidecar logs go to `stderr` only. `stdout` is reserved for the sidecar JSONL
  protocol.
- Multi-step operations should carry an existing `runId` or request id in
  significant frontend, Rust, and sidecar logs.
- Never log API keys, OAuth tokens, session tokens, passwords, private keys,
  connection strings, or raw sensitive payloads.

## File-Based Debug Logs

Autonomous multi-step features may add supplementary file logs when normal logs
are not enough for diagnosis. File-log writes must be best effort and must never
break the main feature.

Use the description-optimization pattern when applicable:

- create a timestamped file under the feature log directory
- append timestamped lines
- silently ignore write failures
- keep frontend fire-and-forget writes off the hot path
