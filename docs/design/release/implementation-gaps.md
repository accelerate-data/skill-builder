# Release Packaging Implementation Gaps

> **Status:** All gaps resolved as of 2026-05-13. See [docs/design/release/README.md](/Users/hbanerjee/src/skill-builder/docs/design/release/README.md) for the current source of truth.

## Resolved Gaps

| # | Gap | Resolution |
|---|-----|------------|
| 1 | Release artifacts did not use a dedicated `runtime/` subtree | macOS packages under `Contents/Resources/runtime/`, Windows under `runtime/` |
| 2 | Bundled `uv` lookup expected old resource layout | `init_bundled_uv_path` checks `resource_dir/runtime/` first, with dev fallback |
| 3 | Startup dependency checks blocked on Node | Node removed from startup blockers; `node.rs` renamed to `startup.rs` |
| 4 | OpenHands probing assumed `uvx` or system Python | Probing uses `bundled_uv_tool_run_args()` from the runtime module |
| 5 | Release verification asserted old packaged shape | Verification script asserts `runtime/` subtree paths |
| 6 | Bundled workspace assets not under `runtime/` | Tauri config maps workspace to `runtime/workspace` |
| 7 | Startup status shape was dependency-check oriented | Redesigned to `BootstrapStatus` (Ready/Installing/Failed) + `BootstrapCheck` |
| 8 | Node-specific UI and error paths existed | Removed `node_missing`, `node_incompatible` cases and nodejs.org link |
| 9 | Package pin consistency drift | `requirements.txt` aligned with `process.rs` constants (1.21.0) |
| 10 | Release-pipeline docs and tests misaligned | All changes landed in one slice; this document updated |

The implementation now matches the target design in `docs/design/release/README.md`.
