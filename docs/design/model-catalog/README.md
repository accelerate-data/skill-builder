---
functional-specs: [custom-plugin-management]
---

# Model Catalog

> **Status:** Draft
> **Functional specs:** [`custom-plugin-management`](../../functional/custom-plugin-management/README.md) — this design covers provider/model metadata ingestion, cached filtering, and the runtime model-selection contract consumed by OpenHands.

## Overview

Skill Builder owns model discovery directly through a cached catalog sourced from
`https://models.dev`.

The catalog has two responsibilities:

1. drive the Settings UI for provider and model selection
2. resolve the final provider/model pair that OpenHands should use at runtime

## Design Scope

**Covers**

- `models.dev` ingestion and refresh
- app-owned SQLite cache for provider and model metadata
- lossless preservation of upstream payloads
- vector-based filtering APIs used by the UI
- provider defaults such as display name and base URL
- OpenHands runtime resolution from the selected provider/model
- removal of LiteLLM-specific routing, profile, virtual-key, and proxy concepts from the target architecture

**Does not cover**

- provider account availability checks
- provider credential UX beyond the existing selected-provider settings flow
- OpenHands session lifecycle, pause/resume semantics, or workspace ownership
- usage/spend tracking redesign

## Key Decisions

| Decision | Rationale |
|---|---|
| `models.dev` is the canonical catalog source | It already exposes the provider/model capability metadata the app needs |
| The catalog is cached in app-owned SQLite | The Settings UI should work from a local snapshot and not depend on live network calls |
| The cache mirrors the live `models.dev` key set | The schema should match upstream fields instead of inventing a reduced catalog shape |
| Providers and models are cached in separate tables | Provider metadata drives defaults like base URL; model rows stay flat and filterable |
| Child tables use foreign keys with `ON DELETE CASCADE` | Refreshes and deletes should never leave orphaned child rows behind |
| Model rows keep both typed columns and the full upstream payload | Filtering needs first-class columns, but the cache must stay lossless |
| `provider` is just another filterable field | The backend API stays generic instead of hardcoding provider-specific list endpoints |
| OpenHands receives one resolved provider/model selection, not a filter expression | Catalog discovery belongs to the app; runtime execution belongs to OpenHands |
| LiteLLM proxy, profiles, and virtual keys are removed from the target design | The app is Rust-native and the model-catalog problem is independent of a Python sidecar |

## Architecture

```text
models.dev
    │
    ▼
Rust catalog refresh service
    │
    ├── provider_catalog
    ├── provider_env
    ├── model_catalog
    ├── model_input_modalities
    └── model_output_modalities
    │
    ▼
Tauri commands
    ├── refresh_model_catalog()
    ├── get_cached_model_catalog()
    └── filter_models(models, filters)
    │
    ▼
Settings UI
    ├── provider dropdown
    ├── capability filters
    ├── model list
    └── final model selection
    │
    ▼
OpenHands runtime config
```

## UI Contract

The Settings flow is:

1. load the cached model vector from the backend
2. apply field-based filters from the UI
3. render the filtered model list
4. persist the final selected provider and model
5. build OpenHands runtime config from that resolved selection

Provider selection is not a separate backend query shape. It is a filter on the
catalog, usually `provider_id = ...`, backed by `provider_catalog` so the UI
can show provider names and defaults.

The UI can filter on any `models.dev` field that the backend projects into the
cached schema. Typical examples:

- `provider_id = "opencode"`
- `reasoning = true`
- `tool_call = true`
- `structured_output = true`
- `context_limit >= 128000`
- input modality contains `"image"`

## Backend API Contract

The target command set is intentionally small:

```rust
refresh_model_catalog() -> Vec<ModelCatalogEntry>
get_cached_model_catalog() -> Vec<ModelCatalogEntry>
filter_models(
    models: Vec<ModelCatalogEntry>,
    filters: Vec<ModelFilter>,
) -> Vec<ModelCatalogEntry>
```

Semantics:

- `refresh_model_catalog()`
  Fetches `models.dev`, rewrites the SQLite cache transactionally, and returns
  the refreshed model vector.
- `get_cached_model_catalog()`
  Returns the last cached model vector without a network call.
- `filter_models(...)`
  Applies the backend-owned filter logic to any provided model vector. The UI
  can call this repeatedly as filter state changes.

The app boundary is vector-based on purpose. The UI does not need totals or
pagination metadata in v1.

## SQLite Cache Model

The cache is app-owned and lives in the main app database.

- `provider_catalog`
  Provider defaults and provider-level metadata from `models.dev`
- `provider_env`
  Child rows for repeated provider `env` values
- `model_catalog`
  Flat filterable model rows with a foreign key to `provider_catalog`
- `model_input_modalities`
  Child rows for repeated input-modality values
- `model_output_modalities`
  Child rows for repeated output-modality values

Detailed schema lives in [schema.md](schema.md).

## OpenHands Integration

The catalog becomes the source used to build `OpenHandsRuntimeConfig`.

Target runtime behavior:

1. the user selects a provider and model from the filtered catalog UI
2. the app persists that selected provider/model in settings
3. the backend resolves provider defaults from `provider_catalog`
4. the backend combines:
   - selected provider
   - selected model
   - user-entered provider credentials and optional base-URL override
5. the backend builds `OpenHandsRuntimeConfig` directly from that resolved selection

OpenHands does not know about cached catalogs, provider metadata refresh, or
filter expressions. It receives a final provider/model choice.

## Relationship To Other Design Docs

| Spec | Relationship |
|---|---|
| [`docs/design/openhands-runtime-contract/README.md`](../openhands-runtime-contract/README.md) | OpenHands consumes the resolved provider/model selection from this subsystem. It does not own catalog refresh or filtering. |
| [`docs/design/backend-design/README.md`](../backend-design/README.md) | Backend design owns the Tauri command surface, SQLite cache, and runtime config construction described here. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src/lib/model-catalog.ts` | Existing frontend catalog helper seam; target for alignment with the backend-owned catalog contract |
| `app/src/components/settings/models-section.tsx` | Existing Settings UI seam that will consume the cached vector and filtering APIs |
| `app/src-tauri/src/types/settings.rs` | Target for persisted selected provider/model settings contract |
| `app/src-tauri/src/commands/settings.rs` | Target for saving provider credentials/base-URL overrides and selected model settings |
| `app/src-tauri/src/agents/runtime_config.rs` | Target for building `OpenHandsRuntimeConfig` from selected provider/model rather than LiteLLM proxy state |
| `app/src-tauri/src/db/` | Target for catalog cache tables and migrations |

## Open Questions

1. Should provider-specific credential validation remain an explicit "Test" action in settings, or become part of model selection save/activation?
2. Should the app keep only one active provider credential set in settings, or persist per-provider overrides for quick switching?
