---
functional-specs: []
---

# Model Settings

> **Status:** Draft
> **Functional specs:** Not applicable; this design follows the VU-1145 clean-break runtime migration and is not tied to a User Flow.

## Overview

Skill Builder configures the language model used by backend-owned OpenHands
requests through one canonical app settings contract. This doc defines how
provider, model, credentials, and request-option settings are stored,
validated, and projected into runtime requests. It does not define session
lifecycle, workspace ownership, event transport, or persistent versus
throwaway execution semantics; those belong to
`docs/design/openhands-runtime-model/README.md`.

This design replaces the transitional Anthropic/OpenHands settings shape with one canonical model settings contract. It does not preserve upgrade compatibility for legacy Claude SDK fields.

## Design Scope

**Covers**

- The Settings UI shape for configuring workflow agent models.
- The app settings and DB contract for canonical model configuration.
- How Rust maps persisted settings into the OpenHands request `llm` payload.
- Model catalog, validation, and capability detection boundaries.
- Clean-break behavior for existing legacy model settings.

**Does not cover**

- Reintroducing Claude SDK as a selectable runtime.
- Using OpenHands `LLMProfileStore` as the app's settings store.
- Storing model profiles or secrets in the agent workspace directory.
- Migrating or backfilling legacy model settings.
- Session lifecycle, pause/resume semantics, or surface routing.
- Workspace/conversation ownership rules beyond the fact that secrets must stay
  outside agent-readable workspace paths.

## Key Decisions

| Decision | Rationale |
|---|---|
| Store one canonical model settings object in Skill Builder app settings. | The DB is already the app-owned source of truth for settings and is outside the agent-readable workspace. |
| Treat OpenHands `LLM` as the integration contract. | The app should configure `LLM(...)`; LiteLLM remains an OpenHands implementation detail rather than a product concept. |
| Do not use `LLMProfileStore` for primary persistence. | `LLMProfileStore` defaults to `~/.openhands/profiles` and creates a second settings location outside Skill Builder's settings lifecycle. |
| Do not store profiles in the workspace directory. | The workspace is readable and writable by agents and tools; model credentials must stay outside that boundary. |
| Make the migration a clean break. | The new OpenHands `LLM` API expects a different settings model. Keeping legacy fields creates hidden fallback behavior and a misleading hybrid UI. |
| Remove Anthropic-specific settings from the primary UI. | Anthropic is one provider option, not the runtime or settings category. |
| Keep provider as UI metadata, not the runtime authority. | The runtime value is the OpenHands `LLM.model` string; provider helps group models, choose defaults, and validate credentials. |
| Use `models.dev` as the provider and model catalog. | `https://models.dev/api.json` gives the app a stable provider/model registry with display names, provider docs, env-key hints, capabilities, pricing, and limits. |
| Keep runtime validation with OpenHands. | Catalog presence does not prove a user's key, endpoint, or installed OpenHands/LiteLLM version can run the model. The test command must still construct `LLM(...)` and validate the selected settings. |
| Default base URL only from explicit provider metadata. | `models.dev` exposes a provider `api` URL for some providers. When it is absent, Skill Builder leaves `baseUrl` unset and lets OpenHands/LiteLLM use its built-in provider default. |

## User-Facing Settings Design

The settings navigation item is `Models`, not `OpenHands`, `LiteLLM`, or `Runtime`.

```text
Models

Configure the language model used by workflow agents.
```

A small secondary note may explain the implementation boundary without creating a user choice:

```text
Workflow agents run in the app workspace using OpenHands. Model settings are stored in Skill Builder settings.
```

### Field Ownership

Settings fields are grouped by the system that owns the decision and the
surface that can validate it.

| Group | Owner | Fields | Validation source |
|---|---|---|---|
| Provider | Provider selection plus app provider rules | `provider`, `apiKey`, `baseUrl` | `models.dev` provider metadata, app-owned local-provider defaults, local settings validation |
| Model | Selected provider's model catalog | `model`, required model filters, read-only model details | `models.dev` model metadata plus custom-entry fallback |
| Request options | OpenHands `LLM` request knobs | `reasoningEffort`, `temperature`, `maxOutputTokens`, `timeoutSeconds`, `numRetries` | local type/range validation; unsupported knobs may be hidden or ignored |
| Advanced provider overrides | Provider/API-specific escape hatches | `apiVersion`, `extraHeaders`, optional cost overrides | no generic discovery; users provide values only when their provider requires them |
| OpenHands internals | App runtime boundary | `usageId`, runtime agent/workspace details | hardcoded or generated by Skill Builder, not user editable |

`apiVersion` means provider API version, not OpenHands or OpenCode version. It
is primarily for Azure-style provider endpoints and is not discoverable from
`models.dev`.

### Provider

The provider card contains the required provider configuration and credentials.

```text
Provider

Provider
[ Anthropic v ]

API Key
[ *************** ] [Test]
ANTHROPIC_API_KEY

Base URL
[ Optional ]
```

Provider selection drives credential labels, API-key requirement, and base URL
defaults. These fields are not model capabilities.

The provider control is populated from `https://models.dev/api.json`.
Providers are sorted by `name`, filtered to providers with at least one text
output model, and grouped with common providers first. The app includes a
`Custom` provider option for OpenHands/LiteLLM-compatible models that are not in
the catalog, local providers such as Ollama when absent from `models.dev`, and
private proxy deployments.

Base URL defaults follow these rules:

1. If the selected provider has `api` in `models.dev`, prefill `baseUrl` with
   that URL but let the user clear or override it.
2. If `api` is missing, leave `baseUrl` empty so OpenHands/LiteLLM uses its
   built-in provider endpoint.
3. If the selected provider is `Custom`, require the user to provide either a
   provider-prefixed model ID that OpenHands/LiteLLM understands or a base URL
   for an OpenAI-compatible endpoint.
4. If the selected provider is local, such as Ollama, use the app-owned local
   default (`http://localhost:11434`) because `models.dev` is a hosted model
   catalog and may not include local runtime providers.

### Model Selection

The model card contains required capability filters and model selection for the
selected provider.

```text
Model

Required capabilities
[x] Reasoning       Required
[x] Tool calling    Required

Model
[ Claude Sonnet 4.5 (latest) v ]
claude-sonnet-4-5
```

Required capability indicators appear before model selection because they explain
why the candidate model set is filtered. They are checked, disabled, and visually
muted because Skill Builder workflow agents require both reasoning and tool use.
The model combobox includes only models whose `models.dev` metadata satisfies
both required capabilities:

- `Reasoning` -> `reasoning: true`
- `Tool calling` -> `tool_call: true`

If the current saved model does not satisfy the required capability filters, the
UI shows it as invalid, clears the active selection for new saves, and asks for a
new model rather than silently changing providers or choosing a replacement.

The model control is a searchable combobox derived from the selected provider's
filtered `models` object with a custom-entry path:

```text
Recommended
  Claude Sonnet 4.5          claude-sonnet-4-5
  Claude Haiku 4.5           claude-haiku-4-5

Other supported
  ...

Custom model ID
  Enter any OpenHands-compatible model ID
```

The saved runtime value is the full provider/model ID passed to OpenHands
`LLM(model=...)`, for example `anthropic/claude-sonnet-4-5`. The UI may display
the provider-local model ID in the dropdown, but persistence must store the full
runtime string. Provider selection filters suggestions and sets placeholder
text, but the model card owns the final model value.

### Model Details

When metadata is available, the page shows read-only details.

```text
Model details

Tool calling      Supported
Reasoning         Supported
Context window    200k tokens
Max output        64k tokens
Pricing           $3 input / $15 output per 1M tokens
```

These rows come from `models.dev` model metadata:

- `tool_call` -> tool calling support.
- `reasoning` -> whether the model is a reasoning model.
- `temperature` -> whether the Temperature control is shown.
- `structured_output` -> structured output support when present.
- `limit.context`, `limit.input`, and `limit.output` -> context and output limits.
- `cost` -> input, output, cache-read, and cache-write pricing.
- `modalities`, `knowledge`, `release_date`, and `last_updated` -> secondary metadata.

`Model details` is read-only. It must not contain an editable `Reasoning` or
`Reasoning effort` control. The current UI has a read-only `Reasoning` row in
`Model Details` and an editable `Reasoning effort` field in `Capabilities`; the
intended design keeps only the read-only support indicator here and the editable
effort control below.

### Request Options

Request options are generic OpenHands `LLM` knobs. They are grouped separately
from model details because the catalog describes whether a model supports a
capability while request options describe how Skill Builder asks OpenHands to
call that model.

```text
Request options

Reasoning effort
[ Auto / Low / Medium / High ]

Temperature
[ Provider default ]

Max output tokens
[ Provider default ]

Timeout
[ 300 ] seconds

Retries
[ 5 ]
```

If the selected model does not support a control, the control is hidden or
disabled with specific helper text, for example:

```text
This model does not use temperature.
```

Rules:

- Show `Reasoning effort` for catalog-selected models because the picker filters
  out models without `reasoning: true`.
- Show extended thinking budget only for models that support OpenHands extended thinking.
- Show prompt cache retention only for models that support it.
- Do not expose provider beta names such as `interleaved thinking beta` in the default UI.
- Prefer `Auto` where OpenHands can safely decide.
- Do not show a second editable reasoning control elsewhere on the page.

Prompt suggestions is a Skill Builder app behavior, not a model request option.
It remains a separate app setting outside the model/provider grouping.

### Advanced Provider Overrides

Advanced options are collapsed by default.

```text
Advanced provider overrides

Provider API version
[ Optional ]

Custom headers
[ Add header ]

Input cost per token
[ Optional ]

Output cost per token
[ Optional ]
```

Provider API version is a provider/model API version override, not an
OpenHands/OpenCode API version. It is only useful for providers that require a
versioned endpoint, such as Azure OpenAI deployments. There is no generic
provider enquiry API that can validate this value across OpenHands/LiteLLM
providers.

Custom headers are sensitive. The UI must warn users not to add secrets unless
required by their provider, and logging must redact header values.

`usageId` is not user-visible. Skill Builder sets the OpenHands `LLM.usage_id` internally to the workflow usage slot so registry lookup and metrics stay stable.

## App Settings Contract

Skill Builder stores canonical model settings in the app settings JSON row (`settings.key = 'app_settings'`). This repo currently stores settings as JSON rather than one DB column per setting, so the clean break updates the JSON schema and Rust/TypeScript types rather than adding relational columns.

Target shape:

```ts
type ModelSettings = {
  provider?: string | null;
  model: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
  apiVersion?: string | null;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  timeoutSeconds?: number | null;
  numRetries?: number | null;
  reasoningEffort?: "auto" | "low" | "medium" | "high" | null;
  extraHeaders?: Record<string, string> | null;
  inputCostPerToken?: number | null;
  outputCostPerToken?: number | null;
};
```

`AppSettings` owns a single nested field:

```ts
type AppSettings = {
  modelSettings: ModelSettings;
  workspace_path: string | null;
  skills_path: string | null;
  ...
};
```

Rust mirrors the same shape:

```rust
pub struct ModelSettings {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub api_key: Option<SecretString>,
    pub base_url: Option<String>,
    pub api_version: Option<String>,
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<u32>,
    pub timeout_seconds: Option<u32>,
    pub num_retries: Option<u32>,
    pub reasoning_effort: Option<String>,
    pub extra_headers: Option<HashMap<String, String>>,
    pub input_cost_per_token: Option<f64>,
    pub output_cost_per_token: Option<f64>,
    pub usage_id: Option<String>,
}
```

`provider` is optional UI metadata. `model` is the runtime authority.

When a catalog provider/model is selected, `model` stores the full
provider-prefixed runtime ID. `provider` stores the selected catalog provider ID
for UI filtering and credential hints. If the user enters a custom full model
ID, the app may infer `provider` from the prefix for display, but workflow
selection must use `model` directly.

`baseUrl` is stored only when the user accepts an explicit provider `api`
default, chooses a local provider default, or enters a custom endpoint. A blank
`baseUrl` is meaningful: it delegates endpoint selection to OpenHands/LiteLLM.

## Clean-Break Settings Removal

The following fields are obsolete for workflow model configuration:

```text
anthropic_api_key
preferred_model
fallback_model
openhands_provider
openhands_api_key
openhands_model
openhands_base_url
extended_thinking
interleaved_thinking_beta
sdk_effort
```

The clean break removes workflow reads and writes for these fields. It does not backfill `modelSettings` from them. If `modelSettings.model` is missing, the app treats model configuration as incomplete even if old fields exist in the settings JSON.

Startup and workflow errors use direct guidance:

```text
Select a model in Settings before running workflow agents.
```

```text
Add an API key or configure a local provider base URL before running workflow agents.
```

Legacy fields may remain in older JSON blobs until a later cleanup, but they are ignored by workflow model selection.

## Backend Selection

Rust exposes one selection helper for workflow runs:

```rust
selected_workflow_llm(settings: &AppSettings) -> Result<WorkflowLlmConfig, String>
```

It reads only `settings.model_settings` and validates:

- `model` is present and non-empty.
- `base_url`, when present, is a valid HTTP(S) URL or an allowed local URL.
- API key is present unless the selected provider/model is explicitly local.
- `extra_headers` is a string-to-string map.
- numeric values are in supported ranges.
- `reasoning_effort` is one of the allowed values.

It returns a sidecar-safe config:

```rust
pub struct WorkflowLlmConfig {
    pub model: String,
    pub api_key: Option<SecretString>,
    pub base_url: Option<String>,
    pub api_version: Option<String>,
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<u32>,
    pub timeout_seconds: Option<u32>,
    pub num_retries: Option<u32>,
    pub reasoning_effort: Option<String>,
    pub extra_headers: Option<HashMap<String, String>>,
    pub input_cost_per_token: Option<f64>,
    pub output_cost_per_token: Option<f64>,
    pub usage_id: Option<String>,
}
```

## Runtime Request Projection

OpenHands-backed requests carry a required `llm` object:

```ts
type OpenHandsLlmConfig = {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutSeconds?: number;
  numRetries?: number;
  reasoningEffort?: "auto" | "low" | "medium" | "high";
  extraHeaders?: Record<string, string>;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  usageId?: string;
};

type OpenHandsRunRequest = {
  runtimeProvider: "openhands";
  llm: OpenHandsLlmConfig;
  ...
};
```

This doc only defines the shape of the `llm` projection. The surrounding
session API, event transport, and persistence behavior are defined in
`docs/design/openhands-runtime-model/README.md`.

The OpenHands request path no longer reads these top-level fields:

```text
model
apiKey
modelBaseUrl
fallbackModel
effort
betas
thinking
```

Those fields can continue to exist only for non-workflow legacy paths until those paths are separately removed or migrated.

Backend validation rejects OpenHands requests without `llm`. Redaction covers:

- `llm.apiKey`
- all `llm.extraHeaders` values
- legacy `apiKey`, while any legacy caller remains

The runtime layer omits null/empty optional values when building the actual
OpenHands request.

## Storage Boundary

Model settings live in app settings, not in the agent workspace.

- The database-backed app settings row is the source of truth.
- The agent workspace is execution space, not a profile or secret store.
- Skill Builder does not store model credentials under the workspace path.

The exact workspace and conversation ownership model lives in
`docs/design/openhands-runtime-model/README.md`.

## Model Catalog And Validation

The model picker uses `models.dev` as its catalog source:

1. Fetch `https://models.dev/api.json`.
2. Treat each top-level key as a provider ID.
3. Read provider metadata from `id`, `name`, `doc`, `env`, `api`, and `models`.
4. Treat each key under `provider.models` as a provider-local model ID.
5. Build the runtime model string as `${provider.id}/${model.id}`.
6. Use `https://models.dev/model-schema.json` as an optional validation aid for
   known catalog model IDs.

The app persists only `modelSettings`, not raw catalog entries. Catalog data is
cacheable display metadata and should refresh opportunistically. If the catalog
is unavailable, Settings keeps the current saved values and the custom model
entry path remains usable.

Catalog metadata drives UI affordances:

| `models.dev` field | UI use |
|---|---|
| `provider.name` | Provider dropdown label |
| `provider.env` | API key label/help text |
| `provider.doc` | Provider documentation link |
| `provider.api` | Base URL prefill when present |
| `model.name` | Model dropdown label |
| `model.reasoning` | Reasoning filter, `Reasoning effort`, and read-only reasoning support |
| `model.tool_call` | Tool-calling filter and read-only tool-calling support |
| `model.structured_output` | Read-only structured-output support |
| `model.temperature` | Show or hide Temperature |
| `model.cost` | Pricing display |
| `model.limit` | Context/output limit display and max-output helper text |
| `model.modalities` | Text/image/PDF capability labels |

Runtime validation remains separate:

- `models.dev` answers "what can the UI offer?"
- OpenHands `LLM(...)` answers "can this installed runtime and user credential
  actually use this model?"
- Provider-specific model-discovery APIs, such as Anthropic `/v1/models`,
  OpenRouter model listing, Ollama local tags, or LiteLLM Proxy `/v1/models`,
  may refine the model list when available, but they do not replace the catalog.

Model validation commands replace Anthropic-specific API commands:

```text
list_model_catalog
inspect_model
test_model_connection
```

`test_model_connection` constructs the same `LLM` config that workflow runs use and performs the smallest safe validation request or provider metadata check available for the selected model.

## States

```text
unconfigured
  modelSettings.model is empty

credentials_required
  model is set, but the provider/model requires credentials and apiKey is empty

invalid
  model settings fail local validation

ready
  model settings pass local validation

verified
  test_model_connection succeeds
```

Workflow agent runs require `ready` or `verified`. They never fallback to legacy fields.

## Relationship To Existing Design Specs

| Spec | Relationship |
|---|---|
| `docs/design/openhands-runtime-model/README.md` | Defines session lifecycle, workspace ownership, and the runtime boundary that consumes this `llm` contract. |
| `docs/design/agent-specs/storage.md` | Defines the broader DB/workspace/skills-path storage boundary that this settings contract fits within. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/types/settings.rs` | Rust `AppSettings`; target home for `ModelSettings`. |
| `app/src-tauri/src/db/settings.rs` | Settings JSON read/write and current transitional OpenHands normalization; target for clean-break selection. |
| `app/src-tauri/src/commands/settings.rs` | Tauri settings commands used by the Settings UI. |
| `app/src/lib/types.ts` | Frontend `AppSettings`; target home for `modelSettings`. |
| `app/src/stores/settings-store.ts` | Frontend settings state. |
| `app/src/components/settings/sdk-section.tsx` | Current model/API settings UI; target for replacement by `Models`. |
| `app/src-tauri/src/agents/openhands_server/types.rs` | Converts app-owned model settings into the OpenHands request `llm` JSON payload. |
| `docs/design/agent-specs/storage.md` | Existing storage boundary: DB is settings source of truth; workspace is transient agent execution space. |

## Open Questions

1. `[design]` Which local providers can omit `apiKey` besides Ollama, and should that rule live in the same app-owned provider override registry as local base URL defaults?
2. `[design]` Should provider-specific discovery APIs supplement `models.dev` in the first implementation, or should the first pass use the catalog plus custom entry only?
