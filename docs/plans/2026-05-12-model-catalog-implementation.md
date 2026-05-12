# Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the LiteLLM-centered model-routing target with an app-owned `models.dev` catalog, cached in SQLite, filterable from the Settings UI, and used directly to build `OpenHandsRuntimeConfig`.

**Architecture:** Rust owns a SQLite-backed cache of provider and model metadata sourced from `https://models.dev/api.json`. The Settings UI reads the cached vector, applies field-based filters, and persists one final selected provider/model pair plus provider-specific overrides. OpenHands consumes only that resolved selection and no longer depends on LiteLLM proxy/profile/virtual-key concepts in the target design.

**Tech Stack:** Rust (Tauri), SQLite (`rusqlite`), Tokio, Reqwest, React/TypeScript, TanStack Query, shadcn/ui

---

## PR Decomposition

| PR | Title | Scope | Testable Outcome | Depends On |
|---|---|---|---|---|
| 1 | `chore: remove LiteLLM subsystem` | Delete LiteLLM-specific agents, commands, DB modules, smoke scripts, and active app wiring while preserving the legacy direct-provider flow | App builds and tests without any LiteLLM subsystem or command surface | None |
| 2 | `feat: model catalog cache schema + refresh service` | Add SQLite catalog tables, `models.dev` fetch/parse code, and transactional cache refresh | Rust can fetch `models.dev`, persist provider/model rows plus child tables, and read them back | PR 1 |
| 3 | `feat: model catalog commands + filtering` | Add `refresh_model_catalog`, `get_cached_model_catalog`, and `filter_models` Tauri commands | Tauri command tests can refresh the cache, read cached vectors, and filter them deterministically | PR 2 |
| 4 | `feat: settings model selection uses cached catalog` | Reshape settings contract to selected provider/model plus per-provider overrides; update Settings UI to use cached catalog and filters | User can load cached catalog, filter models, select a provider/model, and save settings without LiteLLM profile state | PR 3 |
| 5 | `feat: OpenHands runtime config resolves from selected provider/model` | Build `OpenHandsRuntimeConfig` directly from saved provider/model selection and overrides | Workflow/refine runtime config tests pass with catalog-driven provider/model resolution | PR 4 |

---

## File Map

### PR 1: Remove LiteLLM Subsystem

| File | Action |
|---|---|
| `app/src-tauri/src/agents/litellm_proxy/` | Delete — entire LiteLLM proxy subsystem |
| `app/src-tauri/src/agents/mod.rs` | Modify — remove LiteLLM module export |
| `app/src-tauri/src/commands/litellm_providers.rs` | Delete |
| `app/src-tauri/src/commands/litellm_profiles.rs` | Delete |
| `app/src-tauri/src/commands/mod.rs` | Modify — remove LiteLLM command modules from exports |
| `app/src-tauri/src/db/litellm_providers.rs` | Delete |
| `app/src-tauri/src/db/litellm_profiles.rs` | Delete |
| `app/src-tauri/src/db/mod.rs` | Modify — stop re-exporting LiteLLM DB modules |
| `app/src-tauri/src/lib.rs` | Modify — remove LiteLLM startup/shutdown hooks and command registration |
| `scripts/smoke/litellm-pr3-provisioning-smoke.mjs` | Delete |
| `docs/design/backend-design/implementation-gaps.md` | Modify — mark LiteLLM removal done and leave catalog gaps intact |
| `docs/plans/2026-05-12-model-catalog-implementation.md` | Modify — check off completed PR steps as work lands |

### PR 2: Model Catalog Cache Schema + Refresh Service

| File | Action |
|---|---|
| `app/src-tauri/src/db/migrations.rs` | Modify — add catalog cache tables and indexes |
| `app/src-tauri/src/db/mod.rs` | Modify — add/re-export model catalog DB module |
| `app/src-tauri/src/db/model_catalog.rs` | Create — SQLite CRUD for provider/model cache refresh and reads |
| `app/src-tauri/src/types/model_catalog.rs` | Create — Rust structs mirroring live `models.dev` payload plus DB row structs |
| `app/src-tauri/src/types/mod.rs` | Modify — export model catalog types |
| `app/src-tauri/src/services/model_catalog.rs` | Create — fetch/parse/refresh service using `models.dev/api.json` |
| `app/src-tauri/Cargo.toml` | Modify — ensure required serde/reqwest support is present for the service |
| `app/src-tauri/src/db/tests.rs` | Modify — add migration/DB round-trip tests for new tables |

### PR 3: Model Catalog Commands + Filtering

| File | Action |
|---|---|
| `app/src-tauri/src/commands/model_catalog.rs` | Create — Tauri commands for refresh/get/filter |
| `app/src-tauri/src/commands/mod.rs` | Modify — export model catalog commands |
| `app/src-tauri/src/lib.rs` | Modify — register model catalog commands |
| `app/src-tauri/src/services/model_catalog.rs` | Modify — expose filter helpers used by commands |
| `app/src-tauri/src/types/model_catalog.rs` | Modify — add filter DTOs |
| `app/src-tauri/src/commands/model_catalog.rs` (tests) | Create/modify — command-level tests with fixture vectors |

### PR 4: Settings Model Selection Uses Cached Catalog

| File | Action |
|---|---|
| `app/src-tauri/src/types/settings.rs` | Modify — replace LiteLLM/profile assumptions with selected provider/model + per-provider overrides |
| `app/src-tauri/src/db/settings.rs` | Modify — normalize/persist new settings shape |
| `app/src-tauri/src/commands/settings.rs` | Modify — diff/save logic for provider overrides and selected provider/model |
| `app/src/lib/types.ts` | Modify — TypeScript settings types |
| `app/src/lib/tauri-command-types.ts` | Modify — add model catalog command types and updated settings types |
| `app/src/lib/tauri.ts` | Modify — add frontend wrappers for model catalog commands |
| `app/src/lib/model-catalog.ts` | Modify — align frontend helpers with backend vector/filter contract |
| `app/src/hooks/use-settings-form.ts` | Modify — support selected provider/model and per-provider overrides |
| `app/src/stores/settings-store.ts` | Modify — persist/load the new settings shape |
| `app/src/components/settings/models-section.tsx` | Modify — read cached catalog, call `filter_models`, render provider/model/filter flow |
| `app/src/__tests__/hooks/use-settings-form.test.ts` | Modify — cover new settings shape |
| `app/src/__tests__/pages/settings.test.tsx` | Modify — cover provider selection, filtering, model selection, and override save flow |

### PR 5: OpenHands Runtime Config Resolves From Selected Provider/Model

| File | Action |
|---|---|
| `app/src-tauri/src/agents/runtime_config.rs` | Modify — build runtime config from selected provider/model and overrides |
| `app/src-tauri/src/agents/skill_creator.rs` | Modify — consume the updated runtime config params |
| `app/src-tauri/src/commands/workflow/settings.rs` | Modify — resolve runtime model config from the new settings contract |
| `app/src-tauri/src/commands/skill_session.rs` | Modify — keep selected-skill runtime boot aligned with the new config shape |
| `app/src-tauri/src/commands/api_validation.rs` | Modify — validate provider/model selections and overrides |
| `app/src-tauri/src/db/settings.rs` | Modify — update selected-workflow-llm tests and helpers |
| `app/src-tauri/src/agents/runtime_config.rs` (tests) | Modify — assert provider/model/base URL resolution |

---

## PR 1: Remove LiteLLM Subsystem

**Goal:** The codebase no longer contains a LiteLLM subsystem, while the existing direct-provider path remains usable until the catalog work lands.

### Task 1: Delete LiteLLM-specific modules and command surface

**Files:**

- Delete: `app/src-tauri/src/agents/litellm_proxy/`
- Delete: `app/src-tauri/src/commands/litellm_providers.rs`
- Delete: `app/src-tauri/src/commands/litellm_profiles.rs`
- Delete: `app/src-tauri/src/db/litellm_providers.rs`
- Delete: `app/src-tauri/src/db/litellm_profiles.rs`
- Modify: `app/src-tauri/src/agents/mod.rs`
- Modify: `app/src-tauri/src/commands/mod.rs`
- Modify: `app/src-tauri/src/db/mod.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Delete: `scripts/smoke/litellm-pr3-provisioning-smoke.mjs`
- Modify: `docs/design/backend-design/implementation-gaps.md`

- [ ] **Step 1: Delete LiteLLM proxy sources**

Delete:

- `app/src-tauri/src/agents/litellm_proxy/`
- `app/src-tauri/src/commands/litellm_providers.rs`
- `app/src-tauri/src/commands/litellm_profiles.rs`
- `app/src-tauri/src/db/litellm_providers.rs`
- `app/src-tauri/src/db/litellm_profiles.rs`
- `scripts/smoke/litellm-pr3-provisioning-smoke.mjs`

- [ ] **Step 2: Remove LiteLLM module exports and registrations**

Update:

- `app/src-tauri/src/agents/mod.rs`
- `app/src-tauri/src/commands/mod.rs`
- `app/src-tauri/src/db/mod.rs`
- `app/src-tauri/src/lib.rs`

to remove:

- LiteLLM module exports
- LiteLLM command registration
- LiteLLM startup hooks
- LiteLLM shutdown hooks

while preserving the legacy direct-provider settings path.

- [ ] **Step 3: Remove stale LiteLLM references from the active plan/gap docs**

Update `docs/design/backend-design/implementation-gaps.md` so it reflects:

- LiteLLM codepath is removed rather than merely disabled
- catalog/settings/runtime gaps remain open

Run:

```bash
markdownlint docs/design/backend-design/implementation-gaps.md
```

Expected: PASS with only still-true post-removal gaps left in the doc.

- [ ] **Step 4: Run targeted build/runtime verification**

Run:

```bash
rg -n "litellm" app/src-tauri/src scripts/smoke
cargo test --manifest-path app/src-tauri/Cargo.toml runtime_config -- --nocapture
cd app && npm run test:unit -- settings
```

Expected:

- `rg` finds no active LiteLLM subsystem files in the removed paths
- Rust runtime-config tests PASS
- frontend settings tests PASS

---

## PR 2: Model Catalog Cache Schema + Refresh Service

**Goal:** The backend can fetch `models.dev`, store the exact provider/model key set in SQLite, and read it back with child tables and cascade FKs intact.

### Task 1: Add the catalog cache schema

**Files:**

- Modify: `app/src-tauri/src/db/migrations.rs`
- Modify: `app/src-tauri/src/db/mod.rs`
- Test: `app/src-tauri/src/db/tests.rs`

- [ ] **Step 5: Add a numbered migration for catalog tables**

Create a migration that adds:

- `provider_catalog`
- `provider_env`
- `model_catalog`
- `model_input_modalities`
- `model_output_modalities`

Required constraints:

```sql
FOREIGN KEY (provider_id) REFERENCES provider_catalog(provider_id) ON DELETE CASCADE
FOREIGN KEY (full_id) REFERENCES model_catalog(full_id) ON DELETE CASCADE
UNIQUE(provider_id, model_id)
UNIQUE(provider_id, env_var)
UNIQUE(full_id, modality)
```

Recommended indexes:

```sql
CREATE INDEX model_catalog_provider_idx ON model_catalog(provider_id);
CREATE INDEX model_catalog_reasoning_idx ON model_catalog(reasoning);
CREATE INDEX model_catalog_tool_call_idx ON model_catalog(tool_call);
CREATE INDEX model_catalog_structured_output_idx ON model_catalog(structured_output);
```

- [ ] **Step 6: Re-export the new DB module**

Add the new module in `app/src-tauri/src/db/mod.rs`:

```rust
pub mod model_catalog;
pub use model_catalog::*;
```

- [ ] **Step 7: Add a migration test for the schema**

Write a DB test that asserts:

- all five tables exist
- FK cascades are enabled after init
- deleting a provider removes provider env rows and model rows
- deleting a model removes input/output modality rows

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml db::tests -- --nocapture
```

Expected: PASS with the new catalog schema present.

### Task 2: Add exact Rust types for the live `models.dev` payload

**Files:**

- Create: `app/src-tauri/src/types/model_catalog.rs`
- Modify: `app/src-tauri/src/types/mod.rs`
- Test: `app/src-tauri/src/db/tests.rs`

- [ ] **Step 8: Define upstream mirror structs**

Add provider/model structs mirroring the live payload fields:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogProvider {
    pub id: String,
    pub env: Vec<String>,
    pub npm: String,
    pub api: Option<String>,
    pub name: String,
    pub doc: String,
    pub models: std::collections::BTreeMap<String, CatalogModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogModel {
    pub id: String,
    pub name: String,
    pub family: Option<String>,
    pub attachment: bool,
    pub reasoning: bool,
    pub tool_call: bool,
    pub structured_output: Option<bool>,
    pub temperature: Option<bool>,
    pub knowledge: Option<String>,
    pub release_date: String,
    pub last_updated: String,
    pub modalities: CatalogModalities,
    pub open_weights: bool,
    pub cost: Option<CatalogCost>,
    pub limit: CatalogLimit,
    pub interleaved: Option<serde_json::Value>,
    pub provider: Option<String>,
    pub status: Option<String>,
    pub experimental: Option<bool>,
}
```

Also define row structs / DTOs that use the local names:

- `provider_id`
- `api_base_url`
- `model_id`

- [ ] **Step 9: Export the new types**

Add the module export from `app/src-tauri/src/types/mod.rs`.

- [ ] **Step 10: Add a serde fixture test**

Add a unit test that deserializes a real fixture containing:

- one provider with `api`
- one provider without `api`
- models containing `structured_output`
- one model with `interleaved`
- one model with audio/image modality values

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml model_catalog -- --nocapture
```

Expected: PASS with exact field coverage for the live key set.

### Task 3: Implement refresh/read service and DB writers

**Files:**

- Create: `app/src-tauri/src/db/model_catalog.rs`
- Create: `app/src-tauri/src/services/model_catalog.rs`
- Modify: `app/src-tauri/Cargo.toml`
- Test: `app/src-tauri/src/db/tests.rs`

- [ ] **Step 11: Add DB upsert/read functions**

Implement functions for:

- replacing the full provider/model snapshot in one transaction
- inserting provider env child rows
- inserting model modality child rows
- reading the cached model vector back as `Vec<ModelCatalogEntry>`

- [ ] **Step 12: Add the refresh service**

Implement:

```rust
pub async fn refresh_model_catalog(conn: &mut rusqlite::Connection) -> Result<Vec<ModelCatalogEntry>, String>
```

Behavior:

- GET `https://models.dev/api.json`
- deserialize into mirror structs
- write snapshot transactionally
- read back and return the cached vector

- [ ] **Step 13: Add a fixture-backed refresh test**

Structure the service so tests can refresh from fixture JSON without live network
dependency. Prove the service writes:

- provider row
- provider env rows
- model row
- input/output modality rows

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml model_catalog -- --nocapture
```

Expected: PASS with a persisted round-trip from fixture payload to SQLite to returned vector.

---

## PR 3: Model Catalog Commands + Filtering

**Goal:** The backend exposes testable Tauri commands for refresh, cached reads, and deterministic filtering over vectors.

### Task 1: Add `ModelFilter` and pure filtering logic

**Files:**

- Modify: `app/src-tauri/src/types/model_catalog.rs`
- Modify: `app/src-tauri/src/services/model_catalog.rs`
- Test: `app/src-tauri/src/commands/model_catalog.rs`

- [ ] **Step 14: Define the filter DTO**

Add a generic filter shape:

```rust
pub struct ModelFilter {
    pub field: String,
    pub op: String,
    pub value: serde_json::Value,
}
```

Supported v1 operations:

- `eq`
- `neq`
- `contains`
- `gte`
- `lte`

- [ ] **Step 15: Implement pure `filter_models`**

Implement:

```rust
pub fn filter_models(
    models: Vec<ModelCatalogEntry>,
    filters: Vec<ModelFilter>,
) -> Result<Vec<ModelCatalogEntry>, String>
```

Cover:

- scalar equality
- boolean capability fields
- numeric comparisons on cost/limit fields
- modality membership checks through reconstructed vectors on the entry

- [ ] **Step 16: Add deterministic filter tests**

Use a small fixed vector to test:

- `provider_id = ...`
- `reasoning = true`
- `structured_output = true`
- `context_limit >= ...`
- input modality contains `"image"`

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml filter_models -- --nocapture
```

Expected: PASS with stable filtered outputs.

### Task 2: Add Tauri command surface

**Files:**

- Create: `app/src-tauri/src/commands/model_catalog.rs`
- Modify: `app/src-tauri/src/commands/mod.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Test: `app/src-tauri/src/commands/model_catalog.rs`

- [ ] **Step 17: Create command module**

Expose:

```rust
#[tauri::command]
pub async fn refresh_model_catalog(...) -> Result<Vec<ModelCatalogEntry>, String>

#[tauri::command]
pub fn get_cached_model_catalog(...) -> Result<Vec<ModelCatalogEntry>, String>

#[tauri::command]
pub fn filter_models(
    models: Vec<ModelCatalogEntry>,
    filters: Vec<ModelFilter>,
) -> Result<Vec<ModelCatalogEntry>, String>
```

- [ ] **Step 18: Register commands**

Add the module in `commands/mod.rs` and register the commands in the invoke
handler in `app/src-tauri/src/lib.rs`.

- [ ] **Step 19: Add command tests**

Write tests covering:

- refresh from fixture-backed service
- get cached models after refresh
- filter round-trip through Tauri command entrypoints

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml model_catalog -- --nocapture
```

Expected: PASS with command-level behavior proven.

---

## PR 4: Settings Model Selection Uses Cached Catalog

**Goal:** The Settings UI can load the cached catalog, filter it, select a provider/model, and persist provider-specific overrides without LiteLLM profile concepts.

### Task 1: Replace the settings contract

**Files:**

- Modify: `app/src-tauri/src/types/settings.rs`
- Modify: `app/src-tauri/src/db/settings.rs`
- Modify: `app/src-tauri/src/commands/settings.rs`
- Modify: `app/src/lib/types.ts`
- Test: `app/src/__tests__/hooks/use-settings-form.test.ts`

- [ ] **Step 20: Define the new model settings shape**

Target persisted fields:

- `provider_id: Option<String>`
- `model_id: Option<String>`
- `provider_overrides: BTreeMap<String, ProviderOverride>`

Where `ProviderOverride` contains:

- `api_key`
- `base_url_override`
- `api_version`
- other provider-specific runtime overrides already supported today

- [ ] **Step 21: Update normalization and save paths**

Update Rust and TS normalization so:

- selected provider/model are saved directly
- provider overrides are keyed by provider id
- old LiteLLM/profile fields are not part of the active settings contract

- [ ] **Step 22: Add settings persistence tests**

Write tests proving:

- provider-specific overrides persist independently
- switching provider does not erase another provider’s saved overrides
- selected provider/model save and reload correctly

Run:

```bash
cd app && npm run test:unit -- use-settings-form
```

Expected: PASS with the new settings contract reflected in persisted payloads.

### Task 2: Update the Settings UI to use cached catalog + filtering

**Files:**

- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/tauri.ts`
- Modify: `app/src/lib/model-catalog.ts`
- Modify: `app/src/hooks/use-settings-form.ts`
- Modify: `app/src/stores/settings-store.ts`
- Modify: `app/src/components/settings/models-section.tsx`
- Test: `app/src/__tests__/pages/settings.test.tsx`

- [ ] **Step 23: Add frontend wrappers for model catalog commands**

Expose:

- `refreshModelCatalog`
- `getCachedModelCatalog`
- `filterModels`

- [ ] **Step 24: Refactor `models-section.tsx`**

Keep the existing UI shape, but drive it from:

- cached model vector
- backend filter API
- selected provider/model
- per-provider overrides

The provider dropdown should:

- filter models by `provider_id`
- show catalog default base URL via `provider_catalog`
- allow editing a provider-specific override

- [ ] **Step 25: Add Settings UI tests**

Cover:

- initial cached catalog load
- provider change updates visible config
- filter toggles narrow model list
- saving provider override does not overwrite another provider’s override
- selecting a model saves `provider_id` + `model_id`

Run:

```bash
cd app && npm run test:unit -- settings
```

Expected: PASS with the Settings page using cached catalog data instead of LiteLLM profile state.

---

## PR 5: OpenHands Runtime Config Resolves From Selected Provider/Model

**Goal:** OpenHands runtime config is built directly from the saved provider/model selection plus provider-specific overrides.

### Task 1: Update runtime config builders

**Files:**

- Modify: `app/src-tauri/src/agents/runtime_config.rs`
- Modify: `app/src-tauri/src/agents/skill_creator.rs`
- Modify: `app/src-tauri/src/commands/workflow/settings.rs`
- Modify: `app/src-tauri/src/commands/api_validation.rs`
- Test: `app/src-tauri/src/db/settings.rs`
- Test: `app/src-tauri/src/agents/runtime_config.rs`

- [ ] **Step 26: Resolve runtime config from selected provider/model**

Update the runtime builder so it resolves:

- provider id
- model id
- effective base URL = `base_url_override ?? provider_catalog.api_base_url`
- API key from the provider override map

- [ ] **Step 27: Remove active dependence on profile/virtual-key inputs**

Adjust the runtime config path so it no longer expects:

- LiteLLM proxy port
- virtual key
- profile id

in the active target flow.

- [ ] **Step 28: Add runtime config tests**

Cover:

- selected provider/model resolves correctly
- override base URL wins over catalog default
- missing API key for a remote provider fails validation
- local-compatible base URLs still allow no API key where existing rules intend that

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml runtime_config -- --nocapture
```

Expected: PASS with config built directly from selected provider/model state.

### Task 2: Run targeted verification for the full model-catalog slice

**Files:**

- Test only

- [ ] **Step 29: Run Rust backend tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml model_catalog runtime_config db::tests -- --nocapture
```

Expected: PASS

- [ ] **Step 30: Run frontend unit tests for settings/model selection**

Run:

```bash
cd app && npm run test:unit -- settings use-settings-form model-catalog
```

Expected: PASS

- [ ] **Step 31: Commit**

```bash
git add app/src-tauri app/src docs/design docs/plans
git commit -m "feat: replace litellm routing plan with model catalog"
```

---

## Manual Verification

- [ ] Open Settings → Models
- [ ] Load cached catalog without a live network call
- [ ] Refresh catalog manually and confirm provider/model list updates
- [ ] Select a provider and confirm the base URL field is populated from catalog default when available
- [ ] Enter a provider-specific API key override and confirm it persists when switching away and back
- [ ] Enable capability filters like reasoning/tool calling/structured output and confirm the model list narrows correctly
- [ ] Select a final model and restart the app
- [ ] Confirm the saved provider/model selection is restored
- [ ] Start a workflow/refine run and confirm OpenHands uses the selected provider/model config path
