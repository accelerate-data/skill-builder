# Backend Implementation Gaps

Current gaps between latest `main` and the target backend architecture
described in this folder.

## 1. Latest `main` Still Carries LiteLLM-Specific Runtime Plumbing

Target architecture assumes model selection is resolved through the app-owned
model catalog and that OpenHands is configured directly from the selected
provider/model pair.

Latest `main` still contains LiteLLM-specific runtime and admin concepts:

- `app/src-tauri/src/agents/litellm_proxy/`
- `app/src-tauri/src/commands/litellm_providers.rs`
- `app/src-tauri/src/commands/litellm_profiles.rs`
- `app/src-tauri/src/lib.rs`

Current consequence:

- target docs and implementation are intentionally divergent until the LiteLLM
  subsystem is removed or replaced
- runtime model resolution is not yet centered on the catalog contract

## 2. The Cached Model Catalog Does Not Exist Yet

Target design expects a cached `models.dev` snapshot in app-owned SQLite with:

- `provider_catalog`
- `model_catalog`
- modality child tables
- lossless upstream payload retention
- cascade foreign keys between parent and child tables

Latest `main` does not yet have that cache schema or refresh flow.

Relevant files:

- `app/src-tauri/src/db/`
- `app/src-tauri/src/types/settings.rs`

## 3. Catalog Commands Are Missing

Target architecture expects:

- `refresh_model_catalog`
- `get_cached_model_catalog`
- `filter_models`

Latest `main` does not yet expose those commands as first-class Tauri IPC
surface.

## 4. Settings Still Reflect Legacy Direct-Provider State

Target architecture keeps direct provider credentials/base-URL overrides and the
selected provider/model, but removes profile, proxy, and virtual-key concepts.

Latest `main` settings still mix older direct-provider selection with newer
LiteLLM-specific seams.

Relevant files:

- `app/src-tauri/src/types/settings.rs`
- `app/src-tauri/src/commands/settings.rs`
- `app/src/components/settings/models-section.tsx`

## 5. OpenHands Runtime Config Is Not Yet Catalog-Driven

Target architecture expects `OpenHandsRuntimeConfig` to be built from:

- selected provider
- selected model
- provider credentials
- optional base-URL override

Latest `main` does not yet resolve runtime configuration through the target
catalog boundary.

Relevant files:

- `app/src-tauri/src/agents/runtime_config.rs`
- `app/src-tauri/src/agents/skill_creator.rs`
- `app/src-tauri/src/commands/workflow/settings.rs`

## 6. Artifact Identity Still Allows Legacy Name-Based Resolution

Target architecture requires canonical skill resolution for clarifications and
decisions through `skills.id`.

Latest `main` has already moved the clarifications/decisions command surface to
`skill_id`, but the underlying resolver path still accepts legacy skill-name
fallback:

- canonical `skills.id`
- no redundant artifact parent identity
- no name-based ambiguity in artifact resolution

Relevant files:

- `app/src-tauri/src/db/skills.rs`
- `app/src-tauri/src/db/workflow_artifacts.rs`
- `app/src-tauri/src/commands/workflow/clarifications.rs`
- `app/src-tauri/src/commands/workflow/decisions.rs`
- `app/src-tauri/src/db/migrations.rs`
