# Model Catalog Schema

> **Status:** Draft
> **Parent:** [Model Catalog](README.md)

## Purpose

This child document separates two related but different schemas:

1. the upstream `models.dev` contract
2. Skill Builder's local SQLite projection of that contract

The upstream contract is the source of truth. Skill Builder should tolerate
upstream fields it does not project yet and should not invent narrower types
than the upstream schema allows.

## Upstream Source Of Truth

The canonical schema lives in the `models.dev` repository at:

- `packages/core/src/schema.ts`

That file defines the generated `api.json` payload consumed by Skill Builder at
startup through `refresh_model_catalog()`.

## Upstream Payload Shape

`https://models.dev/api.json` is a JSON object keyed by provider id, not a
top-level array.

```json
{
  "<provider-id>": {
    "id": "...",
    "env": ["..."],
    "npm": "...",
    "api": "...",
    "name": "...",
    "doc": "...",
    "models": {
      "<model-id>": { "...": "..." }
    }
  }
}
```

### Provider Fields

Each provider object includes:

- `id`
- `env`
- `npm`
- `api` when the provider schema allows it
- `name`
- `doc`
- `models`

### Model Fields

Each model object can include:

- `id`
- `name`
- `family`
- `attachment`
- `reasoning`
- `tool_call`
- `interleaved`
- `structured_output`
- `temperature`
- `knowledge`
- `release_date`
- `last_updated`
- `modalities`
- `open_weights`
- `limit`
- `cost`
- `status`
- `experimental`
- `provider`

Two fields that matter for Skill Builder's parser contract:

- `provider` is an optional object, not a string
- `experimental` is an optional object, not a boolean

They are wrapper-model metadata and mode-override metadata, not simple scalar
filter columns.

## SQLite Projection

Skill Builder does not need to persist the entire upstream object graph as
first-class columns. The local cache should only project the stable fields the
Settings UI and runtime resolution actually use.

Current projection:

### `provider_catalog`

Provider metadata used for display and runtime defaults.

| Column | Type | Description |
|---|---|---|
| `provider_id` | TEXT PRIMARY KEY | Stable provider identifier |
| `name` | TEXT NOT NULL | Provider display name |
| `npm` | TEXT NOT NULL | Upstream provider adapter family; used to derive the runtime model prefix for OpenHands/LiteLLM |
| `api_base_url` | TEXT | Upstream `api` value when present |
| `doc_url` | TEXT NOT NULL | Upstream provider documentation URL |

### `provider_env`

Repeated provider env-var values.

| Column | Type | Description |
|---|---|---|
| `provider_id` | TEXT NOT NULL | FK → `provider_catalog.provider_id` |
| `env_var` | TEXT NOT NULL | One upstream `env` value |

Constraints:

- `FOREIGN KEY (provider_id) REFERENCES provider_catalog(provider_id) ON DELETE CASCADE`
- `UNIQUE(provider_id, env_var)`

### `model_catalog`

Flat model rows used by the Settings catalog and runtime selection.

| Column | Type | Description |
|---|---|---|
| `full_id` | TEXT PRIMARY KEY | `<provider_id>:<model_id>` identity used locally |
| `provider_id` | TEXT NOT NULL | FK → `provider_catalog.provider_id` |
| `model_id` | TEXT NOT NULL | Provider-scoped model id |
| `name` | TEXT NOT NULL | Model display name |
| `family` | TEXT | Upstream family when present |
| `attachment` | INTEGER NOT NULL | Boolean capability column |
| `reasoning` | INTEGER NOT NULL | Boolean capability column |
| `tool_call` | INTEGER NOT NULL | Boolean capability column |
| `structured_output` | INTEGER | Optional boolean capability column |
| `temperature` | INTEGER | Optional boolean capability column |
| `knowledge` | TEXT | Upstream knowledge date string |
| `release_date` | TEXT NOT NULL | Upstream release date |
| `last_updated` | TEXT NOT NULL | Upstream update date |
| `open_weights` | INTEGER NOT NULL | Boolean capability column |
| `input_cost_per_token` | REAL | Projected `cost.input` when present |
| `output_cost_per_token` | REAL | Projected `cost.output` when present |
| `context_limit` | INTEGER | Projected `limit.context` when present |
| `interleaved` | TEXT | Serialized upstream `interleaved` value when present |
| `status` | TEXT | Upstream status when present |
| `experimental` | INTEGER | Legacy optional boolean slot; object-shaped upstream `experimental` metadata is not projected |

Constraints:

- `FOREIGN KEY (provider_id) REFERENCES provider_catalog(provider_id) ON DELETE CASCADE`
- `UNIQUE(provider_id, model_id)`

Suggested indexes:

- `model_catalog_provider_idx(provider_id)`
- `model_catalog_reasoning_idx(reasoning)`
- `model_catalog_tool_call_idx(tool_call)`
- `model_catalog_structured_output_idx(structured_output)`

### `model_input_modalities`

Repeated input modalities.

| Column | Type | Description |
|---|---|---|
| `full_id` | TEXT NOT NULL | FK → `model_catalog.full_id` |
| `modality` | TEXT NOT NULL | One input modality value |

Constraints:

- `FOREIGN KEY (full_id) REFERENCES model_catalog(full_id) ON DELETE CASCADE`
- `UNIQUE(full_id, modality)`

### `model_output_modalities`

Repeated output modalities.

| Column | Type | Description |
|---|---|---|
| `full_id` | TEXT NOT NULL | FK → `model_catalog.full_id` |
| `modality` | TEXT NOT NULL | One output modality value |

Constraints:

- `FOREIGN KEY (full_id) REFERENCES model_catalog(full_id) ON DELETE CASCADE`
- `UNIQUE(full_id, modality)`

## Projection Rules

The refresh path should follow these rules:

1. Parse against the upstream `models.dev` schema shape, not an older local
   approximation.
2. Persist provider-level defaults and the model fields the UI/runtime consume.
3. Ignore or serialize upstream object fields that are not yet part of the
   local filter contract.
4. Never fail refresh just because wrapper metadata or experimental-mode
   metadata uses nested objects.

## Runtime Qualification Rule

Skill Builder persists catalog ids in settings, then derives the runtime model
string from provider metadata in `provider_catalog`:

- `@ai-sdk/openai-compatible` -> `openai/<model_id>`
- `@ai-sdk/openai` -> `openai/<model_id>`
- `@ai-sdk/anthropic` -> `anthropic/<model_id>`
- already-qualified model ids containing `/` stay unchanged
- if the provider row is missing, fall back to `<provider_id>/<model_id>`

This is intentionally metadata-driven. The runtime seam must not hardcode
special provider-id exceptions like `opencode-go`.

That applies especially to:

- model-level `provider`
- model-level `experimental`
- richer `cost` subfields such as tiers and context-specific pricing

## Refresh Semantics

Refresh is transactional:

1. fetch `models.dev/api.json`
2. replace provider rows
3. replace model rows
4. replace modality child rows
5. commit the full snapshot

Because child tables use foreign keys with `ON DELETE CASCADE`, snapshot
replacement should not leave orphaned rows behind.

## Filtering Boundary

The local cache is intentionally narrower than the upstream schema.

Supported fast-path filters should stay limited to the projected columns:

- `provider_id`
- `model_id`
- `name`
- `family`
- `reasoning`
- `tool_call`
- `attachment`
- `structured_output`
- `temperature`
- `open_weights`
- `context_limit`
- `input_cost_per_token`
- `output_cost_per_token`
- `status`
- modality membership through child tables

Object-shaped upstream metadata should not be advertised as scalar filter fields
until Skill Builder intentionally adds a local projection for it.
