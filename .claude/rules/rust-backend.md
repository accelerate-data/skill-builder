---
paths:
  - "app/src-tauri/**"
---

# Rust Backend

Tauri v2 backend in `app/src-tauri/`. One module per concern in `src/commands/`.

## Command Conventions

Every `#[tauri::command]` function must:

- Log `info!` on entry with key params: `info!("skill_delete: deleting {}", skill_id)`
- Log `error!` on failure: `error!("skill_delete: failed: {}", e)`
- Use `debug!` for intermediate steps
- Never log secrets (API keys, tokens)

## Testing

Inline `#[cfg(test)]` tests in the same file as the command. Run with:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml          # all Rust tests
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow  # module filter
```

See `app/tests/TEST_MANIFEST.md` for the Rust module → E2E tag mapping.

## Tauri Mock Infrastructure

**Unit tests:** `src/test/setup.ts` (global) + `mockInvoke` from `src/test/mocks/tauri.ts`

**E2E tests:** Set `TAURI_E2E=true`. Mocks in `src/test/mocks/tauri-e2e*.ts`. Override per-test via `window.__TAURI_MOCK_OVERRIDES__`.

## Key Files

| File | Purpose |
|---|---|
| `src/commands/` | One file per command group (workflow, workspace, skill, settings, …) |
| `src/agents/sidecar_pool.rs` | Persistent sidecar lifecycle and stream dispatch |
| `src/db.rs` | SQLite via rusqlite — schema in `docs/design/backend-design/database.md` |
| `src/reconciliation.rs` | Startup state machine — see `docs/design/startup-recon/` |
| `src/types.rs` | Shared Rust types |
| `src/fs_validation.rs` | Filesystem validation helpers |
