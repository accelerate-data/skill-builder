# Review: feature/vu-1183-settings-model-selection-uses-cached-catalog

- **Branch:** `feature/vu-1183-settings-model-selection-uses-cached-catalog`
- **PR:** (not yet created)
- **Review Date:** 2026-05-13
- **Reviewer:** code-reviewer agent

## Intent

Replace the flat `ModelSettings` contract (provider/model/api_key/base_url as top-level fields) with a provider-centric model: `provider_id` + `model_id` + `provider_overrides: BTreeMap<String, ProviderOverride>`. The Settings UI should load the cached model catalog from SQLite, filter models by provider and capabilities, and persist per-provider overrides independently.

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| **Plan (PR 4)** | Settings UI loads cached catalog, filters models, selects provider/model, persists provider-specific overrides. No LiteLLM/profile concepts. |
| **Linear Issue (VU-1183)** | Settings model selection uses cached catalog. |
| **Commit** | 17 files changed: Rust types/DB/commands, TS types/store/hook/component, tests. Replaces `provider`/`model`/`api_key`/`base_url` with `provider_id`/`model_id`/`provider_overrides`. |

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 20 | Define new model settings shape (`provider_id`, `model_id`, `provider_overrides` with `api_key`, `base_url_override`, `api_version`, etc.) | **Proven** | `app/src-tauri/src/types/settings.rs:135-143` (ModelSettings struct), `app/src-tauri/src/types/settings.rs:87-113` (ProviderOverride struct), `app/src/lib/types.ts:37-56` (TS interfaces) |
| 21 | Update normalization and save paths (Rust + TS) | **Proven** | `app/src-tauri/src/types/settings.rs:169-206` (normalized()), `app/src-tauri/src/db/settings.rs:4-7` (normalize_model_settings), `app/src-tauri/src/commands/settings.rs:370-374` (diff_settings), `app/src/hooks/use-settings-form.ts:35-43` (normalizeModelSettings) |
| 22 | Add settings persistence tests (independent overrides, switching doesn't erase, save/reload) | **Proven** | `app/src-tauri/src/db/settings.rs:273-314` (provider_specific_overrides_persist_independently), `app/src-tauri/src/db/settings.rs:317-376` (switching_provider_does_not_erase_other_overrides), `app/src-tauri/src/db/settings.rs:144-179` (selected_workflow_llm_accepts_canonical_model_settings), `app/src/__tests__/hooks/use-settings-form.test.ts:26-58` (initializes fields), `app/src/__tests__/hooks/use-settings-form.test.ts:144-177` (autoSave persists) |
| 23 | Add frontend wrappers for model catalog commands (refreshModelCatalog, getCachedModelCatalog, filterModels) | **Proven** | `app/src/lib/tauri-command-types.ts:500-502` (TauriCommandMap entries), `app/src/lib/tauri.ts:649-659` (wrapper functions), `app/src/lib/model-catalog.ts:84-93` (frontend helpers) |
| 24 | Refactor models-section.tsx (cached model vector, backend filter API, selected provider/model, per-provider overrides, provider dropdown filters by provider_id, shows catalog default base URL, allows editing provider-specific override) | **Proven** (with caveat) | `app/src/components/settings/models-section.tsx:143-148` (catalog state), `app/src/components/settings/models-section.tsx:196-221` (fetchCachedModelCatalog on mount), `app/src/components/settings/models-section.tsx:250-273` (handleProviderChange with catalog filtering), `app/src/components/settings/models-section.tsx:281-305` (handleOverrideFieldChange/Save). **Caveat:** `api_base_url` was hardcoded to `null` in the committed code (line 170); fixed in uncommitted changes by adding `get_cached_model_providers` command. |
| 25 | Add Settings UI tests (initial catalog load, provider change, filter toggles, cross-provider override preservation, selecting model saves provider_id + model_id) | **Partially Proven** | Initial catalog load: `app/src/__tests__/pages/settings.test.tsx:598-621`. Provider change: `app/src/__tests__/pages/settings.test.tsx:441-485`. Selecting model saves: same test. API key save: `app/src/__tests__/pages/settings.test.tsx:792-825`. **Missing:** No test for filter toggle interaction narrowing model list. No frontend test for cross-provider override preservation (covered by Rust tests only). |

## Findings

### High

1. **[Architect] `providerEntry` memo hardcodes `api_base_url: null` instead of reading from catalog**
   - **File:** `app/src/components/settings/models-section.tsx:166-177`
   - **Issue:** The committed code sets `api_base_url: null` in the `providerEntry` memo, meaning providers with a non-null `api` field in the catalog (e.g., OpenRouter with `https://openrouter.ai/api/v1`) would not auto-populate their base URL from catalog data. The `handleProviderChange` function calls `getProviderBaseUrlDefault(val, null)` which only has a hardcoded fallback for Ollama.
   - **Impact:** The plan explicitly states "show catalog default base URL via `provider_catalog`". This is not satisfied in the committed code.
   - **Fix:** Already implemented in uncommitted changes: added `get_cached_model_providers` Tauri command, `ProviderCatalogRow` type, and updated `providerEntry` to read `api_base_url` from the provider catalog.
   - **Recommendation:** Include the fix in the PR.

2. **[Skeptic] `ModelSettings::active_override()` resolves override by `provider_id` but `selected_workflow_llm()` doesn't validate that the selected provider has a matching override entry**
   - **File:** `app/src-tauri/src/types/settings.rs:217-226`
   - **Issue:** If a user sets `provider_id = "anthropic"` but the `provider_overrides` map has no entry for `"anthropic"`, `active_override()` returns `ProviderOverride::default()` (with `api_key: None`, `timeout_seconds: Some(300)`, etc.). This means the API key validation will fail even if the user previously saved an API key under a different provider key. This is by design (per-provider isolation), but could be confusing if the user expects their API key to persist across provider switches.
   - **Impact:** Low — this is intentional behavior per the plan ("provider-specific overrides persist independently"). The UI handles this by showing empty fields when switching to a provider without saved overrides.
   - **Recommendation:** No action needed. This is correct behavior per the plan.

### Medium

1. **[Minimalist] `ProviderOverride` derives `PartialEq` which requires `SecretString` to derive `PartialEq`**
   - **File:** `app/src-tauri/src/types/secret.rs:2`
   - **Issue:** The diff shows `SecretString` was changed to derive `PartialEq` to support `ProviderOverride` comparison in `diff_settings`. This is a subtle security-sensitive change — `SecretString` is meant to prevent accidental exposure. Deriving `PartialEq` is safe (it compares the inner values without exposing them), but the change should be reviewed for intent.
   - **Evidence:** `app/src-tauri/src/types/settings.rs:87` (`#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]`)
   - **Recommendation:** Acceptable. `PartialEq` on `SecretString` doesn't expose secrets — it just compares them.

2. **[Skeptic] `handleProviderChange` creates a new override with defaults, potentially overwriting existing overrides for the same provider**
   - **File:** `app/src/components/settings/models-section.tsx:250-273`
   - **Issue:** When switching to a provider, `handleProviderChange` creates `getDefaultProviderOverride()` and spreads it into `nextOverrides[val]`. If the user had previously configured that provider with custom values (e.g., custom timeout, retries), those would be reset to defaults.
   - **Impact:** This is a UX concern — switching away from and back to a provider would reset its overrides. The plan says "switching provider does not erase another provider's saved overrides" (tested in Rust), but the UI behavior of resetting the *current* provider's overrides on switch-back is not addressed.
   - **Recommendation:** Consider preserving existing overrides for the target provider instead of always creating defaults. Change `handleProviderChange` to merge with existing overrides if present.

3. **[Architect] `uniqueProviders` deduplicates from `catalog` (ModelCatalogEntry[]) but loses provider metadata**
   - **File:** `app/src/components/settings/models-section.tsx:307-314`
   - **Issue:** The provider dropdown uses `catalog.filter()` to deduplicate by `provider_id`, but this only gives access to `provider_id` from the model entries. The provider's display name, API base URL, and env vars are not available from `ModelCatalogEntry`.
   - **Impact:** The dropdown shows `provider_id` as the label (e.g., "anthropic" instead of "Anthropic"). The uncommitted fix partially addresses this by fetching `ProviderCatalogRow` and using `providerRow?.name`, but the committed code doesn't have this.
   - **Recommendation:** The uncommitted fix addresses this. Include it.

### Low

1. **[Minimalist] `ModelSettingsPatch` type is not explicitly defined**
   - **File:** `app/src/hooks/use-settings-form.ts`
   - **Issue:** `ModelSettingsPatch` is imported from `use-settings-form` but is implicitly `Partial<ModelSettings>`. This works but could be more explicit.
   - **Recommendation:** No action needed — TypeScript's `Partial` is sufficient.

2. **[Skeptic] `getProviderBaseUrlDefault` fallback logic is still Ollama-only**
   - **File:** `app/src/lib/model-catalog.ts:68-75`
   - **Issue:** Even with the uncommitted fix, `getProviderBaseUrlDefault(val, providerRow?.api_base_url)` will use the catalog's `api_base_url` if present. But the function's fallback logic (when `providerApiBaseUrl` is null) only checks for Ollama. This is correct — other providers don't have a hardcoded default.
   - **Recommendation:** No action needed.

## What Went Well

1. **Clean contract replacement:** The Rust `ModelSettings` → `provider_id` + `model_id` + `provider_overrides` migration is clean, with proper normalization, serialization, and debug formatting. The `BTreeMap` choice ensures deterministic ordering.
2. **Comprehensive Rust tests:** Three new DB-level tests cover the core persistence guarantees (independent overrides, switch preservation, canonical resolution). All 1169 Rust tests pass.
3. **Frontend test coverage for core flows:** The settings page tests cover provider selection, model selection, API key save, and test connection with the new contract. 655 frontend tests pass.

## Verdict

**APPROVED** (after fixes)

All high-severity gaps have been addressed:

1. **`api_base_url` not surfaced from catalog** — Fixed in commit `6078ca01`: added `get_cached_model_providers` Tauri command, `ProviderCatalogRow` type, frontend wrapper, and updated `providerEntry` memo to read `api_base_url` from the provider catalog.
2. **`handleProviderChange` resets provider overrides on re-select** — Fixed in commit `6078ca01`: now preserves existing overrides for the target provider when re-selecting, only applying catalog base URL as a fallback when no override exists.
3. **Filter toggle interaction** — Implemented as interactive checkboxes (reasoning, tool calling, structured output) with `filterByCapabilities()` wired to UI state. Tests added to `model-catalog.test.ts` verifying toggling capabilities narrows the model list.

Remaining open items (deferred):
- No frontend test for cross-provider override preservation (covered by Rust DB tests).

## Next Steps

1. ~~Include the uncommitted `get_cached_model_providers` fix in the PR~~ — **Done** (commit `6078ca01`).
2. ~~Consider updating `handleProviderChange` to preserve existing overrides for the target provider~~ — **Done** (commit `6078ca01`).
3. ~~Add a frontend test for filter toggle interaction~~ — **Done** — capability checkboxes are now toggleable, wired to `filterByCapabilities()`, and tested in `model-catalog.test.ts`.
4. Create PR for VU-1183.
