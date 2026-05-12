# Review: PR1 (Remove LiteLLM Subsystem) + PR2 (Model Catalog Cache Schema + Refresh Service)

- **Branch:** `feature/model-catalog-pr2`
- **Review Date:** 2026-05-12
- **Reviewer:** code-reviewer agent

## Intent

**PR1:** Remove the entire LiteLLM subsystem (proxy agent, commands, DB modules, smoke scripts, startup/shutdown hooks) while preserving the legacy direct-provider flow.

**PR2:** Add a SQLite-backed model catalog cache sourced from `models.dev/api.json`, with five tables (provider_catalog, provider_env, model_catalog, model_input_modalities, model_output_modalities), cascade FKs, filtering indexes, and a refresh service that fetches, parses, and persists the upstream payload.

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| PR1 Claim (plan) | Delete `agents/litellm_proxy/`, `commands/litellm_*.rs`, `db/litellm_*.rs`, smoke script; remove module exports, command registrations, startup/shutdown hooks; preserve direct-provider path |
| PR2 Claim (plan) | Add migration 55 with 5 tables + indexes; create `model_catalog.rs` (DB CRUD), `types/model_catalog.rs` (mirror structs + DTOs), `services/model_catalog.rs` (fetch/parse/refresh + filter); add fixture-backed tests; re-export new modules |
| Linear Issue | VU-1185 (inferred from commit messages) — model catalog implementation |
| Design Doc | `docs/design/backend-design/implementation-gaps.md` — gap 2 (catalog cache) and gap 3 (catalog commands) |

## Acceptance Criteria

### PR1: Remove LiteLLM Subsystem

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `agents/litellm_proxy/` deleted | Proven | `git diff --stat` shows all 7 files removed |
| `commands/litellm_providers.rs` deleted | Proven | File not found in tree |
| `commands/litellm_profiles.rs` deleted | Proven | File not found in tree |
| `db/litellm_providers.rs` deleted | Proven | File not found in tree |
| `db/litellm_profiles.rs` deleted | Proven | File not found in tree |
| `scripts/smoke/litellm-pr3-provisioning-smoke.mjs` deleted | Proven | File not found in tree |
| `agents/mod.rs` — LiteLLM export removed | Proven | `pub mod litellm_proxy;` line removed |
| `commands/mod.rs` — LiteLLM exports removed | Proven | Both `pub mod litellm_*` lines removed |
| `db/mod.rs` — LiteLLM exports removed, model_catalog added | Proven | Diff confirms removal + addition |
| `lib.rs` — startup/shutdown hooks removed | Proven | `ensure_litellm_proxy` spawn and `shutdown_litellm_proxy_for_exit` removed |
| `lib.rs` — command registrations removed | Proven | All 12 litellm_* command registrations removed |
| Direct-provider path preserved | Proven | `runtime_config.rs` tests pass (13 tests) |
| `implementation-gaps.md` updated | Proven | Gap 1 marked resolved, catalog gaps intact |
| No orphaned LiteLLM references in active code | **Open** | See Finding H1 — duplicate command registrations in `lib.rs` |

### PR2: Model Catalog Cache Schema + Refresh Service

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Migration 55 creates 5 tables | Proven | `migrations.rs` lines 2747-2810; test `test_migration_55_creates_catalog_tables` |
| FK cascades enabled | Proven | `ON DELETE CASCADE` on all FKs; test `test_migration_55_fk_cascade_deletes_children` |
| Model cascade deletes modalities | Proven | Test `test_migration_55_model_cascade_deletes_modalities` |
| Upstream mirror structs defined | Proven | `types/model_catalog.rs` — `CatalogProvider`, `CatalogModel`, `CatalogModalities`, `CatalogCost`, `CatalogLimit` |
| DB row structs defined | Proven | `ProviderCatalogRow`, `ModelCatalogEntry` |
| Filter DTO defined | Proven | `ModelFilter { field, op, value }` |
| `replace_model_catalog_snapshot` writes transactionally | Proven | `db/model_catalog.rs` — BEGIN IMMEDIATE / COMMIT / ROLLBACK |
| `read_cached_model_catalog` returns full vector with modalities | Proven | `db/model_catalog.rs` — main query + per-entry modality loads |
| `refresh_model_catalog` fetches from `models.dev` | Proven | `services/model_catalog.rs` — `fetch_models_dev_json()` + refresh flow |
| `refresh_model_catalog_from_fixture` for tests | Proven | Service exposes fixture path |
| `filter_models` pure function with eq/neq/contains/gte/lte | Proven | `services/model_catalog.rs` lines 54-122 |
| Serde fixture test covers api/no-api/structured_output/interleaved/modalities | Proven | `types/mod.rs` — `test_model_catalog_types_serde_fixture` |
| Fixture-backed refresh test proves all tables written | Proven | `services/model_catalog.rs` — `test_refresh_from_fixture_writes_all_tables` |
| Filter tests cover provider_id/reasoning/context_limit/modality/empty | Proven | 6 filter tests in service module |
| Rust tests pass | Proven | `cargo test model_catalog` — 7 passed; `cargo test db::tests` — 128 passed |
| Frontend tests pass | Proven | `npm run test:unit -- settings` — 697 passed |

## Findings

### High

1. **[Architect] Duplicate command registrations in `lib.rs`**

   `app/src-tauri/src/lib.rs` lines 427-454 and lines 464-491 register the **exact same block** of commands twice:
   - `commands::usage::*` (9 commands)
   - `commands::git::*` (3 commands)
   - `commands::refine::content::*` (2 commands)
   - `commands::skill_session::*` (2 commands)
   - `commands::refine::*` (1 command)
   - `commands::refine::output::*` (2 commands)
   - `commands::workflow::evaluation::*` (1 command)
   - `commands::imported_skills::upload::*` (2 commands)
   - `commands::eval_workbench::*` (6 commands)

   The `commands::documents::*` block (lines 456-462) is correctly new and appears only once. The duplication appears to be a merge-conflict-resolution error when the LiteLLM command block was removed — the post-LiteLLM block (usage→eval_workbench) was inadvertently copied instead of moved.

   **Recommendation:** Remove lines 464-491 (the duplicate block). Keep lines 427-454 (original) and lines 456-462 (documents). Verify with `cargo check` after removal.

2. **[Architect] Missing migration 54 test**

   Migration 54 (`run_drop_litellm_provider_profile_tables_migration`) drops `llm_providers`, `llm_profiles`, and `llm_profile_models`. There is no test proving this migration runs successfully on a database that has these tables from migrations 52/53. If a user's DB has these tables and migration 54 fails (e.g., FK constraint violation from unexpected data), the migration chain breaks.

   **Recommendation:** Add a test that runs migrations 52-54 in sequence on a fresh DB and confirms the tables are dropped without error.

### Medium

3. **[Skeptic] N+1 query pattern in `read_cached_model_catalog`**

   `app/src-tauri/src/db/model_catalog.rs` lines 155-171: For each model entry, a separate `SELECT` is issued to load input and output modalities. With ~2000+ models from the live `models.dev` API, this produces 4000+ individual queries.

   **Recommendation:** Use a single JOIN query or batch-fetch all modalities in two queries (one for input, one for output) and populate in-memory. For PR2 scope this is acceptable but should be fixed before PR3 exposes it to the UI.

4. **[Skeptic] Manual transaction management in `replace_model_catalog_snapshot`**

   `app/src-tauri/src/db/model_catalog.rs` lines 10-105 uses raw `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` strings instead of rusqlite's `Transaction` type. If `COMMIT` itself fails (line 100), the error from the inner closure is discarded and replaced with the COMMIT error, losing the original failure context.

   **Recommendation:** Use `conn.transaction()` or `conn.unchecked_transaction()` from rusqlite, which handles commit/rollback via Drop semantics and preserves the original error.

5. **[Skeptic] `unwrap_or_default()` on `serde_json::to_string` loses data silently**

   `app/src-tauri/src/db/model_catalog.rs` line 74:
   ```rust
   model.interleaved.as_ref().map(|v| serde_json::to_string(v).unwrap_or_default()),
   ```
   If serialization fails, an empty string is stored. On read-back (line 123-124), `serde_json::from_str("")` returns `Err`, which is swallowed by `.ok()`, producing `None`. The original `interleaved` data is silently lost.

   **Recommendation:** Propagate the serialization error instead of defaulting to empty string. This is a data-loss bug if `interleaved` contains non-serializable values (unlikely with `serde_json::Value`, but the pattern is fragile).

6. **[Minimalist] `services/model_catalog.rs` test fixture duplicates type test fixture**

   The fixture JSON in `services/model_catalog.rs` (line 129-171) and the fixture in `types/mod.rs` (test `test_model_catalog_types_serde_fixture`) cover overlapping but different provider sets. The service fixture has only one provider (anthropic), while the types fixture has two (anthropic + ollama). This is not wrong but creates maintenance burden — if the upstream API shape changes, both fixtures need updating.

   **Recommendation:** Consider sharing a single fixture file under `app/src-tauri/src/test-fixtures/` or at minimum document the relationship between the two.

7. **[Skeptic] `filter_models` unknown field returns `true` (pass-through)**

   `app/src-tauri/src/services/model_catalog.rs` line 93:
   ```rust
   _ => return true,
   ```
   An unknown field name causes the filter to always pass, silently ignoring the filter. Similarly, unknown `op` values (line 120) return `true`. This means a typo in a field name or op produces incorrect results without any warning.

   **Recommendation:** Return `Err(String)` for unknown fields/ops, or at minimum log a warning. For PR2 scope, consider adding a `Result` return type to `filter_models` and `apply_filter`.

8. **[Minimalist] `lte` fallback to `f64::MAX` is counterintuitive**

   `app/src-tauri/src/services/model_catalog.rs` line 116:
   ```rust
   a.as_f64().unwrap_or(f64::MAX) <= b.as_f64().unwrap_or(f64::MAX)
   ```
   When the field value is `None` (null), it defaults to `f64::MAX`, making `lte` comparisons always true for null fields. This means `context_limit <= 100000` matches models with no context limit at all.

   **Recommendation:** Null fields should not match numeric comparisons. Return `false` when either side is null, or make the behavior explicit and documented.

### Low

9. **[Minimalist] `CatalogLimit` and `CatalogCost` use `#[serde(default)]` beyond plan spec**

   The plan spec shows `context: Option<i64>` without `#[serde(default)]`. The implementation adds `#[serde(default)]` to `context`, `input`, and `output`. This is defensively correct (handles missing fields gracefully) but deviates from the spec without comment.

   **Recommendation:** No code change needed — this is a good defensive addition. Just note it as an intentional deviation from the plan.

10. **[Skeptic] `filter_models` test named `test_filter_models_reasoning_true` tests `reasoning = false`**

    `app/src-tauri/src/services/model_catalog.rs` line 268: The test name says "true" but the filter value is `serde_json::Value::Bool(false)`. The test only has one model with `reasoning: false`, so it passes, but the name is misleading.

    **Recommendation:** Rename to `test_filter_models_reasoning_false` or add a model with `reasoning: true` to the fixture and test both.

11. **[Architect] `services/` module is new but has no `README` or module-level doc**

    The `services/` directory was created as a new top-level module (`mod services;` in `lib.rs`). This is a structural change that introduces a new architectural layer. No module-level documentation explains what belongs in `services/` vs `commands/` vs `db/`.

    **Recommendation:** Add a module-level doc comment to `services/mod.rs` describing the layer's responsibility.

## What Went Well

1. **Clean LiteLLM removal** — All LiteLLM subsystem files, exports, registrations, and hooks were removed systematically. The direct-provider path remains intact and verified by 13 passing runtime_config tests.

2. **Migration 54 is thoughtful** — Dropping orphaned LiteLLM tables in a separate migration (54) before adding catalog tables (55) is correct ordering. Child-first DROP order (`llm_profile_models` → `llm_profiles` → `llm_providers`) avoids FK violations.

3. **Schema matches plan spec closely** — All five tables, FK constraints, UNIQUE constraints, and recommended indexes are present and correct. The `ModelCatalogEntry` struct faithfully reconstructs the flattened DB rows with modalities populated.

## Verdict

**REQUEST_CHANGES**

The duplicate command registrations in `lib.rs` (Finding H1) is a high-severity bug that must be fixed before this branch can be considered complete. It was introduced during the LiteLLM removal and indicates the command registration section was not carefully audited after the edit.

Additionally, the missing migration 54 test (Finding H2) is important for migration chain reliability, though it can be addressed as a follow-up if the team prefers.

## Next Steps

1. **Remove duplicate command block** in `lib.rs` (lines 464-491). The documents block (lines 456-462) should remain between the original usage/eval_workbench block and the end of the handler.

2. **Add migration 54 test** that proves `llm_providers`, `llm_profiles`, and `llm_profile_models` are dropped successfully after migrations 52/53 have created them.

3. **(Recommended) Fix N+1 query** in `read_cached_model_catalog` by batch-fetching modalities.

4. **(Recommended) Use rusqlite `Transaction`** type instead of manual BEGIN/COMMIT/ROLLBACK strings.

5. Re-run `cargo check`, `cargo test model_catalog`, `cargo test db::tests`, and `cargo test runtime_config` to confirm all pass after fixes.
