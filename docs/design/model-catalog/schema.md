# Model Catalog Schema

> **Status:** Draft
> **Parent:** [Model Catalog](README.md)

## Goals

The cache schema must satisfy three constraints:

1. fast filtering for the Settings UI
2. lossless preservation of `models.dev` payloads
3. referential integrity during refreshes and deletes

## Upstream Shape

The live `models.dev` payload currently has:

- provider fields: `id`, `env`, `npm`, `api`, `name`, `doc`, `models`
- model fields: `id`, `name`, `family`, `attachment`, `reasoning`,
  `tool_call`, `structured_output`, `temperature`, `knowledge`,
  `release_date`, `last_updated`, `modalities`, `open_weights`, `cost`,
  `limit`, `interleaved`, `provider`, `status`, `experimental`

This schema mirrors those fields as closely as possible while keeping the local
column names:

- provider `id` → `provider_id`
- provider `api` → `api_base_url`
- model `id` → `model_id`

## Tables

### `provider_catalog`

Provider-level metadata from `models.dev`.

| Column | Type | Description |
|---|---|---|
| `provider_id` | TEXT PRIMARY KEY | Stable provider identifier |
| `name` | TEXT NOT NULL | Provider display name |
| `npm` | TEXT NOT NULL | Upstream `npm` field |
| `api_base_url` | TEXT | Upstream `api` field when present |
| `doc` | TEXT NOT NULL | Upstream provider documentation URL |
| `provider_json` | TEXT NOT NULL | Lossless upstream provider payload |
| `fetched_at` | INTEGER NOT NULL | Unix timestamp for the snapshot refresh |

### `provider_env`

Child table for repeated provider env-var values.

| Column | Type | Description |
|---|---|---|
| `provider_id` | TEXT NOT NULL | FK → `provider_catalog.provider_id` |
| `env_var` | TEXT NOT NULL | One upstream `env` value |

Constraints:

- `FOREIGN KEY (provider_id) REFERENCES provider_catalog(provider_id) ON DELETE CASCADE`
- `UNIQUE(provider_id, env_var)`

### `model_catalog`

Flat filterable model cache keyed back to the owning provider.

| Column | Type | Description |
|---|---|---|
| `full_id` | TEXT PRIMARY KEY | Stable model identity |
| `provider_id` | TEXT NOT NULL | FK → `provider_catalog.provider_id` |
| `model_id` | TEXT NOT NULL | Provider-scoped model id |
| `name` | TEXT NOT NULL | Model display name |
| `family` | TEXT | Model family if present |
| `attachment` | INTEGER | Boolean capability column |
| `reasoning` | INTEGER | Boolean capability column |
| `tool_call` | INTEGER | Boolean capability column |
| `structured_output` | INTEGER | Boolean capability column |
| `temperature` | INTEGER | Boolean capability column |
| `open_weights` | INTEGER | Boolean capability column |
| `knowledge` | TEXT | Knowledge cutoff/date-like upstream field |
| `release_date` | TEXT | Upstream release date |
| `last_updated` | TEXT | Upstream update timestamp/date |
| `provider` | TEXT | Upstream model-level `provider` field when present |
| `status` | TEXT | Upstream status field when present |
| `experimental` | INTEGER | Upstream boolean field when present |
| `interleaved_json` | TEXT | Serialized upstream `interleaved` object when present |
| `context_limit` | INTEGER | Token/context limit if present |
| `output_limit` | INTEGER | Max output tokens if present |
| `input_limit` | INTEGER | Input-token limit if present |
| `cost_input` | REAL | Input cost if present |
| `cost_output` | REAL | Output cost if present |
| `cost_context_over_200k` | REAL | Upstream `cost.context_over_200k` when present |
| `cost_reasoning` | REAL | Reasoning cost if present |
| `cost_cache_read` | REAL | Cache read cost if present |
| `cost_cache_write` | REAL | Cache write cost if present |
| `cost_input_audio` | REAL | Upstream `cost.input_audio` when present |
| `cost_output_audio` | REAL | Upstream `cost.output_audio` when present |
| `payload_json` | TEXT NOT NULL | Lossless upstream model payload |
| `fetched_at` | INTEGER NOT NULL | Unix timestamp for the snapshot refresh |

Constraints:

- `FOREIGN KEY (provider_id) REFERENCES provider_catalog(provider_id) ON DELETE CASCADE`
- `UNIQUE(provider_id, model_id)`

Suggested indexes:

- `model_catalog_provider_idx(provider_id)`
- `model_catalog_reasoning_idx(reasoning)`
- `model_catalog_tool_call_idx(tool_call)`
- `model_catalog_structured_output_idx(structured_output)`

### `model_input_modalities`

Child table for repeated input-modality values.

| Column | Type | Description |
|---|---|---|
| `full_id` | TEXT NOT NULL | FK → `model_catalog.full_id` |
| `modality` | TEXT NOT NULL | One input modality value |

Constraints:

- `FOREIGN KEY (full_id) REFERENCES model_catalog(full_id) ON DELETE CASCADE`
- `UNIQUE(full_id, modality)`

### `model_output_modalities`

Child table for repeated output-modality values.

| Column | Type | Description |
|---|---|---|
| `full_id` | TEXT NOT NULL | FK → `model_catalog.full_id` |
| `modality` | TEXT NOT NULL | One output modality value |

Constraints:

- `FOREIGN KEY (full_id) REFERENCES model_catalog(full_id) ON DELETE CASCADE`
- `UNIQUE(full_id, modality)`

## Refresh Semantics

Refresh is transactional:

1. fetch `models.dev`
2. upsert/replace `provider_catalog`
3. upsert/replace `model_catalog`
4. replace child modality rows
5. commit the full snapshot

Because child tables reference parent rows with `ON DELETE CASCADE`, provider or
model replacement cannot leave orphaned modality rows behind.

## Filtering Model

The typed columns exist for fast filtering and sorting. `provider_json` and
`payload_json` exist so the cache remains lossless when upstream adds fields
that the app does not yet project into dedicated columns.

The target filter model supports:

- equality / inequality on scalar fields
- boolean capability filtering
- numeric comparisons on limits and costs
- modality membership checks through child tables
