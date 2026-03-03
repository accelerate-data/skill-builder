---
paths:
  - "app/src-tauri/**"
---

# Rust Backend

Tauri v2 backend in `app/src-tauri/`. Keep command modules grouped by concern under `src/commands/`.

## Command Conventions

Every `#[tauri::command]` function must:

- Log `info!` on entry with key params: `info!("skill_delete: deleting {}", skill_id)`
- Log `error!` on failure: `error!("skill_delete: failed: {}", e)`
- Use `debug!` for intermediate steps
- Never log secrets (API keys, tokens) or PII column values

Canonical logging requirements (levels, redaction, correlation IDs) are in `.claude/rules/logging-policy.md`.

## Error Types

Use `thiserror` for all new or refactored error types. Prefer command signatures that return
`Result<T, CommandError>` where `CommandError` derives `serde::Serialize` so Tauri serializes typed
errors to the frontend, not raw strings.

Legacy commands that currently return `Result<T, String>` can remain as-is unless touched by your
change. When modifying those commands, migrate toward `CommandError` incrementally.

Map external errors at boundaries with `map_err(CommandError::from)` where possible; use custom
message mapping only when adding user-facing context.

## Database Rules

- For any schema or persistence model change, follow `.claude/rules/db-schema-change.md` end-to-end.
- Define foreign keys with `ON DELETE CASCADE` for app table relationships so parent deletes clean up dependent rows.
- Exception: usage/log snapshot tables must not have foreign keys to mutable entities; they must preserve point-in-time records and remain unaffected by parent-row deletes.
- Never use `INSERT OR REPLACE` on parent rows that are referenced by `ON DELETE CASCADE` children. In SQLite, `REPLACE` is delete+insert and will trigger cascades. Use `INSERT ... ON CONFLICT (...) DO UPDATE` instead.
- Use parameterized SQL (`?1`, `?2`, `params![...]`) for SQLite writes; never build SQL by interpolating user input.
- Wrap multi-table write flows in a transaction and commit once; rollback on error via normal `?` propagation.

## Testing

Inline `#[cfg(test)]` tests in the same file as the command where practical. Use
`crate::db::open_in_memory()` to create a migrated in-memory SQLite connection:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn creates_workspace_and_retrieves_it() {
        let conn = db::open_in_memory().expect("in-memory db");
        // ... exercise command logic directly against conn
    }
}
```

Run tests with:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml     # all Rust tests
cargo test --manifest-path app/src-tauri/Cargo.toml db  # module filter
```

## Key Files

| File | Purpose |
|---|---|
| `src/commands/` | One file per command group (workflow, workspace, skill, settings, …) |
| `src/agents/sidecar_pool.rs` | Persistent sidecar lifecycle and stream dispatch |
| `src/db.rs` | SQLite via rusqlite — schema in `docs/design/backend-design/database.md` |
| `src/reconciliation.rs` | Startup state machine — see `docs/design/startup-recon/` |
| `src/types.rs` | Shared Rust types |
| `src/fs_validation.rs` | Filesystem validation helpers |

See `app/tests/TEST_MANIFEST.md` for the Rust module → E2E tag mapping.

## Tauri Mock Infrastructure

**Unit tests:** `src/test/setup.ts` (global) + `mockInvoke` from `src/test/mocks/tauri.ts`

**E2E tests:** Set `TAURI_E2E=true`. Mocks in `src/test/mocks/tauri-e2e*.ts`. Override per-test via `window.__TAURI_MOCK_OVERRIDES__`.
