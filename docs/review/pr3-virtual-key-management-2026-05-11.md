# Review: PR3 — Virtual Key Management + Profile Activation

- **Branch:** `feature-litellm-migration-pr3`
- **Review Date:** 2026-05-11
- **Reviewer:** code-reviewer agent

## Intent

Replace the per-profile LiteLLM user/key model (from PR2) with a **single shared user** (`"skill-builder"`) architecture, generate **per-profile virtual keys** with **per-model budget caps**, and run provisioning in a **detached async task** so it doesn't block proxy startup. Also add a `verify_profile_virtual_key` command to replace `test_profile_connection`.

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| **PR Body / Commits** | `feat: virtual key provisioning and profile activation` — adds shared user bootstrap, per-profile virtual keys, per-model budgets, detached provisioning, `verify_profile_virtual_key` command, schema migration 53 |
| **Implementation Plan (PR3)** | 9 tasks: (1) remove `deny_unknown_fields`, (1b) drop `urlencoding`, (1c) add `model_max_budget`, (2) DB migration drop `litellm_user_id` + add `budget`, (3) update DB types, (4) single shared user + detached provisioning, (5) `verify_profile_virtual_key` command, (6) update design docs, (7) reset plan checkboxes, (8) run tests, (9) commit |
| **Design Doc** | Single shared user `"skill-builder"` with no budget cap; per-profile keys from `budget_total` or `budget_monthly`; per-model budgets from `llm_profile_models.budget`; detached provisioning; `verify_profile_virtual_key` replaces `test_profile_connection` |
| **Functional Spec** | N/A (covered by design doc) |

## Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Remove `deny_unknown_fields` from response types | **Proven** | `types.rs` — no `deny_unknown_fields` on any struct |
| Drop `urlencoding` dependency from Cargo.toml | **Open** | `Cargo.toml` still contains `urlencoding = "1"`; `Cargo.lock` still has `urlencoding` package |
| Revert `urlencoding::Encoded` in `key_info` | **Open** | `client.rs:84` still uses `urlencoding::Encoded(key)` |
| Add `model_max_budget` to `GenerateKeyRequest` | **Proven** | `types.rs:64` — `model_max_budget: Option<std::collections::HashMap<String, f64>>` |
| DB migration drops `litellm_user_id`, adds `budget` | **Proven** | `migrations.rs` migration 53 — table rebuild without `litellm_user_id`, `ALTER TABLE` for `budget` |
| `LlmProfile` struct drops `litellm_user_id` | **Proven** | `litellm_profiles.rs:5-15` — no `litellm_user_id` field |
| `LlmProfileModel` struct adds `budget` | **Proven** | `litellm_profiles.rs:24` — `pub budget: Option<f64>` |
| Single shared user `"skill-builder"` bootstrap | **Proven** | `mod.rs:103-116` — `CreateUserRequest { user_id: "skill-builder" }` with 409 handling |
| Per-profile virtual keys with per-model budgets | **Proven** | `mod.rs:136-156` — `model_max_budget` HashMap built from profile models, `budget_total.or(budget_monthly)` |
| Provisioning runs in detached task | **Proven** | `mod.rs:71-77` — `tokio::spawn(async move { ... })` after registry registration |
| `verify_profile_virtual_key` command added | **Proven** | `litellm_profiles.rs:146-165` — uses `get_profile`, calls `key_info` |
| `test_profile_connection` replaced in lib.rs | **Proven** | `lib.rs:501` — `verify_profile_virtual_key` registered; `test_profile_connection` NOT registered |
| Design docs updated | **Proven** | `docs/design/litellm-integration/README.md` renamed, `budgets.md` created |
| Tests pass | **Proven** | `cargo test litellm` — 19 passed; `cargo clippy` — clean |
| Config generator uses `litellm_provider_prefix` | **Open** | `config.rs:64` still uses `provider.name` instead of `provider.litellm_provider_prefix` |

## Findings

### High

1. **[Skeptic] `urlencoding` dependency NOT removed — plan task 1b is incomplete**
   - **Files:** `app/src-tauri/Cargo.toml:51`, `app/src-tauri/src/agents/litellm_proxy/client.rs:84`
   - The plan explicitly says: *"Remove `urlencoding = "1"` from `Cargo.toml` and revert `key_info` to `.join(&format!("/key/info?key={}", key))`"*. The diff actually **added** `urlencoding` (it was not present before this branch). The current code uses `urlencoding::Encoded(key)` in `key_info`.
   - **Why it matters:** The plan's rationale is correct — virtual keys are `sk-<uuid>` format with no special characters, and the `url` crate already handles encoding. Adding an unnecessary dependency increases the dependency surface.
   - **Recommendation:** Remove `urlencoding = "1"` from `Cargo.toml` and revert `client.rs:84` to `.join(&format!("/key/info?key={}", key))`. Run `cargo check` to confirm no other references exist.

2. **[Skeptic] Detached provisioning has no retry — permanent failure on transient API error**
   - **File:** `app/src-tauri/src/agents/litellm_proxy/mod.rs:71-77`
   - The provisioning task is spawned with `tokio::spawn` and errors are only logged: `log::error!("[litellm-proxy] provisioning failed: {e}")`. If the LiteLLM admin API is temporarily unavailable (network blip, proxy not fully ready), provisioning fails permanently. Profiles created before the failure will never get virtual keys until the app is restarted.
   - **Design doc says:** *"Rust calls LiteLLM admin API to bootstrap a single shared user... then provisions virtual keys for each profile in a detached task"*. The design doesn't specify retry behavior, but the error handling is effectively fire-and-forget.
   - **Recommendation:** Add at least one retry with backoff (e.g., 3 attempts, 1s intervals) inside the detached task, or emit a Tauri event (`litellm-provisioning-failed`) so the frontend can surface the error to the user.

3. **[Skeptic] Partial provisioning is unrecoverable — skip logic masks failures**
   - **File:** `app/src-tauri/src/agents/litellm_proxy/mod.rs:125-127`
   - `if profile.virtual_key.is_some() { continue; }` — if provisioning succeeds for profile A but fails for profile B (e.g., API rate limit), on restart profile A is skipped (correct) but profile B is retried (correct). However, if provisioning succeeds for profile A, the key is saved, but the app crashes before the log message, the state is consistent. The real issue is that there's no way to distinguish "never attempted" from "attempted and failed" — both result in `virtual_key = NULL`.
   - **Recommendation:** Add a `provisioning_attempted_at` timestamp or `provisioning_error` column to `llm_profiles` to distinguish unattempted profiles from failed ones. Alternatively, the retry in finding #2 would mitigate this.

### Medium

4. **[Architect] Dead code: `test_profile_connection` command still defined**
   - **File:** `app/src-tauri/src/commands/litellm_profiles.rs:145-165`
   - The `test_profile_connection` function is defined but NOT registered in `lib.rs` (replaced by `verify_profile_virtual_key`). It will compile but is unreachable. The `#[tauri::command]` attribute on an unregistered function is misleading.
   - **Recommendation:** Delete the `test_profile_connection` function from `litellm_profiles.rs`.

5. **[Architect] `LlmProfile` manual reconstruction in provisioning is fragile**
   - **File:** `app/src-tauri/src/agents/litellm_proxy/mod.rs:161-172`
   - The provisioning code manually constructs an `LlmProfile` struct to update just the `virtual_key` field, copying all other fields from the original. If a new field is added to `LlmProfile`, this code will silently drop it (compile error would catch it, but it's still a maintenance hazard).
   - **Recommendation:** Add an `update_profile_virtual_key(conn, profile_id, key)` helper function in `litellm_profiles.rs` that does a targeted `UPDATE llm_profiles SET virtual_key = ? WHERE id = ?`. This is both safer and more efficient.

6. **[Architect] Config generator still uses `provider.name` instead of `litellm_provider_prefix`**
   - **File:** `app/src-tauri/src/agents/litellm_proxy/config.rs:64`
   - `format!("{}/{}", provider.name, pm.model_name)` — uses the display name, not the LiteLLM prefix. If a user names a provider "My Custom Provider", the generated model name becomes `My Custom Provider/claude-sonnet` which LiteLLM won't recognize.
   - **Note:** This is a known limitation from PR2 (listed in the plan's "Known limitations / follow-ups"). The `litellm_provider_prefix` column exists in the DB (migration 53) and the `LlmProvider` struct has the field, but the config generator doesn't use it yet.
   - **Recommendation:** This is a known follow-up, but it should be tracked as a blocking issue for PR5 (Providers UI) since users won't be able to use custom provider names without it.

7. **[Minimalist] `ensure_litellm_proxy` takes `Db` by value**
   - **File:** `app/src-tauri/src/agents/litellm_proxy/mod.rs:34`
   - `db: Db` — the function signature takes `Db` by value (cloning it from the caller). The caller at `lib.rs:359` does `(*db).clone()`. This works because `Db` is `Arc<Mutex<Connection>>`, but it's an unusual pattern that could confuse readers about ownership semantics.
   - **Recommendation:** Consider changing to `db: &Db` or documenting why by-value is intentional (clone is cheap for Arc).

### Low

8. **[Minimalist] `model_max_budget` HashMap uses `String` keys — could use `&str`**
   - **File:** `app/src-tauri/src/agents/litellm_proxy/types.rs:64`
   - `model_max_budget: Option<std::collections::HashMap<String, f64>>` — the keys are cloned `model_name` strings. Since this is serialized to JSON, `String` is correct for serde, so this is fine. No action needed.

9. **[Skeptic] No test for `bootstrap_shared_user_and_provision_keys`**
   - **File:** `app/src-tauri/src/agents/litellm_proxy/mod.rs:96-179`
   - The core PR3 logic (shared user bootstrap + per-profile key provisioning with per-model budgets) has no unit tests. The existing tests in `tests.rs` only cover port selection, master key, and config dir creation (from PR1).
   - **Recommendation:** Add at least one test that verifies the `model_max_budget` HashMap construction logic and the `budget_total.or(budget_monthly)` resolution.

10. **[Architect] `verify_profile_virtual_key` returns `bool` — no diagnostic info**
    - **File:** `app/src-tauri/src/commands/litellm_profiles.rs:146-165`
    - Returns `Ok(true)` on success, `Err(String)` on failure. The caller gets no structured info about what failed (key info, spend, models). This is fine for a simple "is it working?" check, but if the frontend wants to display spend or model info, it would need to call `key_info` again.
    - **Recommendation:** Consider returning the `KeyInfo` data (spend, models) instead of just `bool`. This is a low-priority enhancement.

## What Went Well

1. **Detached provisioning pattern** — Spawning provisioning in a detached `tokio::spawn` task after registering the proxy in the registry is the correct approach. It prevents blocking `ensure_litellm_proxy` while ensuring the proxy handle is immediately available for other callers.

2. **Single shared user architecture** — The design decision to use a single `"skill-builder"` user instead of per-profile users simplifies the architecture significantly. The 409 conflict handling for idempotent re-runs is correct.

3. **Per-model budget support** — The `model_max_budget` HashMap construction from `LlmProfileModel.budget` fields is clean and correctly sends `None` when no per-model budgets are set, avoiding unnecessary serialization overhead.

## Verdict

**REQUEST_CHANGES**

Two high-severity findings block a clean merge:

1. **`urlencoding` dependency was added instead of removed** — this is the opposite of what the plan specifies and introduces an unnecessary dependency.
2. **Detached provisioning has no retry** — transient LiteLLM API failures during startup will permanently orphan profiles without virtual keys, with no user-facing signal.

Additionally, the dead `test_profile_connection` command should be cleaned up before merge.

## Next Steps

1. **Remove `urlencoding`** from `Cargo.toml` and revert `client.rs:84` to plain string interpolation. Run `cargo check` and `cargo test litellm` to confirm.
2. **Add retry logic** to the detached provisioning task (e.g., 3 attempts with 1s backoff). At minimum, emit a Tauri event on failure so the frontend can alert the user.
3. **Delete `test_profile_connection`** function from `litellm_profiles.rs`.
4. **(Optional but recommended)** Add a targeted `update_profile_virtual_key` DB helper to avoid manual `LlmProfile` reconstruction in provisioning.
5. **(Optional)** Add unit tests for the `model_max_budget` construction and budget resolution logic.
