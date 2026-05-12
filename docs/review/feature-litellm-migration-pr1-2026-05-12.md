# Review: chore: remove LiteLLM subsystem

- **Branch:** `feature/litellm-migration`
- **PR:** N/A (branch-based review)
- **Review Date:** 2026-05-12
- **Reviewer:** code-reviewer agent

## Intent

Remove the entire LiteLLM proxy subsystem (agents, commands, DB modules, smoke scripts, startup/shutdown hooks) from the app while preserving the legacy direct-provider flow, as specified in PR 1 of the Model Catalog implementation plan.

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| **Plan PR 1** | Delete `litellm_proxy/`, `litellm_providers.rs`, `litellm_profiles.rs` (commands + DB), smoke script; update `mod.rs` exports, `lib.rs` hooks/registrations, and `implementation-gaps.md`; preserve direct-provider path |
| **Commit** | `d6e71ead chore: remove LiteLLM subsystem` — 19 files changed, -2671/+33 lines |
| **Claim (Plan Steps)** | Steps 1–4 all checked off in the working-tree plan file |

## Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Delete `app/src-tauri/src/agents/litellm_proxy/` | **Proven** | 7 files deleted (client, config, mod, process, tests, types, venv) |
| Delete `app/src-tauri/src/commands/litellm_providers.rs` | **Proven** | File deleted (71 lines removed) |
| Delete `app/src-tauri/src/commands/litellm_profiles.rs` | **Proven** | File deleted (172 lines removed) |
| Delete `app/src-tauri/src/db/litellm_providers.rs` | **Proven** | File deleted (103 lines removed) |
| Delete `app/src-tauri/src/db/litellm_profiles.rs` | **Proven** | File deleted (201 lines removed) |
| Delete `scripts/smoke/litellm-pr3-provisioning-smoke.mjs` | **Proven** | File deleted (300 lines removed) |
| Update `agents/mod.rs` — remove `litellm_proxy` export | **Proven** | Diff confirms `pub mod litellm_proxy;` removed |
| Update `commands/mod.rs` — remove LiteLLM command modules | **Proven** | Diff confirms both `pub mod litellm_profiles;` and `pub mod litellm_providers;` removed |
| Update `db/mod.rs` — remove LiteLLM DB module exports | **Proven** | Diff confirms both `pub mod` and `pub use` lines removed |
| Update `lib.rs` — remove startup/shutdown hooks and command registrations | **Proven** | Diff confirms `shutdown_litellm_proxy_for_exit`, `ensure_litellm_proxy` spawn, 12 command registrations, and 2 `rt.block_on(shutdown_litellm_proxy_for_exit())` calls all removed |
| Preserve legacy direct-provider settings path | **Proven** | `commands::settings::*` commands still registered; `db::read_settings` call in startup intact; no settings-path code touched |
| Update `implementation-gaps.md` | **Proven** | Gap 1 struck through with resolution note; remaining gaps intact |
| `rg` finds no active LiteLLM subsystem files | **Proven** | Only migration functions, OpenHands-internal `litellm_model` helper, and error-string parsing remain (see Findings) |
| Rust runtime-config tests PASS | **Proven** | `cargo test ... runtime_config` — 13 passed, 0 failed |
| Frontend settings tests PASS | **Proven** | `npm run test:unit -- settings` — 697 tests passed across 57 files |
| DB tests PASS | **Proven** | `cargo test ... db::tests` — 125 passed, 0 failed |
| Build compiles | **Proven** | `cargo check` — Finished with no errors |
| Markdown lint PASS | **Proven** | `markdownlint implementation-gaps.md` — no output (clean) |

## Findings

### Medium

1. **[Architect] Orphaned DB tables from migrations 52 and 53**

   `app/src-tauri/src/db/migrations.rs` still registers and executes migrations 52 (`run_litellm_provider_profile_migration`) and 53 (`run_litellm_pr3_schema_migration`), which create the `llm_providers`, `llm_profiles`, and `llm_profile_models` tables. These tables are now orphaned — no Rust code interacts with them after the DB module deletions.

   **Impact:** Existing databases will carry these tables indefinitely. No runtime harm (they're just unused), but they represent schema debt and could confuse future developers inspecting the DB.

   **Recommendation:** Add a follow-up migration (e.g., migration 54) that drops these three tables. This is out of scope for PR 1 but should be tracked for PR 2 or a dedicated cleanup PR.

2. **[Minimalist] Plan file checkmarks are unstaged**

   The plan document (`docs/plans/2026-05-12-model-catalog-implementation.md`) has Steps 1–4 checked off in the working tree but was not included in the commit. The commit only contains code changes.

   **Recommendation:** Include the plan file update in the same commit, or ensure it's committed before the PR lands.

### Low

3. **[Skeptic] `openhands_litellm_model` function naming is misleading post-removal**

   `app/src-tauri/src/agents/openhands_server/types.rs:324` — `fn openhands_litellm_model(...)` transforms model names for OpenHands' internal LiteLLM-based SDK (e.g., stripping `opencode-go/` prefix and prepending `openai/`). This is **not** part of the removed proxy subsystem — it's about OpenHands' own model-name conventions. However, the function name and the test name in `client.rs:400` (`conversation_payload_marks_opencode_zen_models_as_openai_compatible_for_litellm`) will now be the only "litellm" references in active Rust code, which could cause confusion about whether LiteLLM removal was complete.

   **Recommendation:** Rename to `openhands_model_identifier` or similar in a follow-up. Not a blocker — the function behavior is correct and unrelated to the removed subsystem.

4. **[Skeptic] LiteLLM error-string parsing in OpenHands process module**

   `app/src-tauri/src/agents/openhands_server/process.rs:697` — test fixture includes `"litellm.AuthenticationError:"` as a stderr line to parse. This is parsing error output from the OpenHands agent process (which internally uses LiteLLM), not from the removed proxy. Correct to keep, but worth noting as the third remaining "litellm" reference.

   **Recommendation:** No action needed. This is correctly scoped to OpenHands error handling, not the app's LiteLLM subsystem.

## What Went Well

1. **Surgical deletion** — All LiteLLM subsystem files removed cleanly with no dangling imports or broken references. The module export chain (`mod.rs` files) was updated consistently.
2. **Direct-provider path preserved** — Settings commands, DB read path, and startup settings initialization are untouched. The app still boots and routes model config through the legacy path as intended.
3. **Verification discipline** — All three verification commands from the plan (rg, Rust tests, frontend tests) pass cleanly. The `implementation-gaps.md` update is accurate and well-scoped.

## Verdict

**APPROVE** — with two follow-up items tracked.

The PR accomplishes exactly what PR 1 of the implementation plan specifies: the LiteLLM subsystem is fully removed, the direct-provider path is preserved, all tests pass, and the build is clean. The two medium findings (orphaned migration tables, unstaged plan file) are not blockers for this PR but should be addressed in follow-up work.

## Next Steps

1. **Commit the plan file update** — Add the checked-off Steps 1–4 in `docs/plans/2026-05-12-model-catalog-implementation.md` to the commit or a follow-up commit.
2. **Track orphaned table cleanup** — File a follow-up issue to add a migration that drops `llm_providers`, `llm_profiles`, and `llm_profile_models` tables (created by migrations 52/53).
3. **Optional rename** — Consider renaming `openhands_litellm_model` and its test to avoid confusion in post-LiteLLM-removal codebase audits.
