---
functional-specs: []
---

# Model Settings

> **Status:** Draft
> **Functional specs:** Not applicable; this design follows the VU-1145 clean-break runtime migration and is not tied to a User Flow.

## Overview

Skill Builder configures the language model used by workflow agents through the OpenHands SDK `LLM` abstraction. The app owns settings persistence, validation, and secret handling. OpenHands owns agent execution, tool use, workspace operations, and provider-specific LLM behavior.

This design replaces the transitional Anthropic/OpenHands settings shape with one canonical model settings contract. It does not preserve upgrade compatibility for legacy Claude SDK fields.

## Design Scope

**Covers**

- The Settings UI shape for configuring workflow agent models.
- The app settings and DB contract for canonical model configuration.
- How Rust, the Node sidecar, and the Python OpenHands runner pass model settings to `LLM(...)`.
- The relationship between Skill Builder's workspace directory and OpenHands `Conversation.workspace`.
- Model catalog, validation, and capability detection boundaries.
- Clean-break behavior for existing legacy model settings.

**Does not cover**

- Reintroducing Claude SDK as a selectable runtime.
- Using OpenHands `LLMProfileStore` as the app's settings store.
- Storing model profiles or secrets in the agent workspace directory.
- Migrating or backfilling legacy model settings.
- Implementing refine streaming or the OpenHands `AskUserQuestion` custom tool.

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
| Use OpenHands SDK helpers as compatibility authority. | OpenHands `VERIFIED_MODELS`, `get_unverified_models`, `get_features`, and model-info helpers reflect the SDK's supported model surface. |
| Use external catalogs only for display enrichment. | Sources such as `models.dev` can provide friendly names, pricing, and context limits, but they should not replace OpenHands validation. |

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

### Model

The first card contains the required runtime model configuration.

```text
Model

Provider
[ Anthropic v ]

Model
[ Claude Sonnet 4.5 (latest) v ]
claude-sonnet-4-5

API Key
[ *************** ] [Test]

Base URL
[ Optional ]
```

The model control is a searchable combobox with a custom-entry path:

```text
Recommended
  Claude Sonnet 4.5          claude-sonnet-4-5
  Claude Haiku 4.5           claude-haiku-4-5

Other supported
  ...

Custom model ID
  Enter any OpenHands-compatible model ID
```

The saved runtime value is the model ID passed to OpenHands `LLM(model=...)`.
Provider selection filters suggestions, sets placeholder text, and controls credential labels.

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

OpenHands capability helpers determine runtime-relevant controls. Optional catalog metadata can enrich labels, pricing, context windows, provider docs, and release dates.

### Request Settings

Request settings are generic OpenHands `LLM` options.

```text
Request settings

Temperature
[ Provider default ]

Max output tokens
[ Provider default ]

Timeout
[ 300 ] seconds

Retries
[ 5 ]
```

If the selected model does not support a control, the control is hidden or disabled with specific helper text, for example:

```text
This model does not use temperature.
```

### Capabilities

The capabilities section replaces the Anthropic-specific agent features card.

```text
Capabilities

Reasoning effort
[ Auto / Low / Medium / High ]

Prompt caching
[ Auto ]

Prompt suggestions
[ toggle ]
```

Rules:

- Show `Reasoning effort` only when the selected model supports it.
- Show extended thinking budget only for models that support OpenHands extended thinking.
- Show prompt cache retention only for models that support it.
- Do not expose provider beta names such as `interleaved thinking beta` in the default UI.
- Prefer `Auto` where OpenHands can safely decide.

### Advanced

Advanced options are collapsed by default.

```text
Advanced

API version
[ Optional ]

Custom headers
[ Add header ]

Input cost per token
[ Optional ]

Output cost per token
[ Optional ]

Usage ID
[ workflow ]
```

Custom headers are sensitive. The UI must warn users not to add secrets unless required by their provider, and logging must redact header values.

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
  usageId?: string | null;
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

## Sidecar Contract

OpenHands workflow requests carry a required `llm` object:

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

The workflow OpenHands path no longer reads these top-level fields:

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

Sidecar validation rejects OpenHands workflow requests without `llm`. Redaction covers:

- `llm.apiKey`
- all `llm.extraHeaders` values
- legacy `apiKey`, while any legacy caller remains

## OpenHands Runner Mapping

The Python runner consumes only `request["llm"]` for OpenHands workflow runs:

```python
llm_config = request["llm"]

kwargs = {
    "model": llm_config["model"],
}

if llm_config.get("apiKey"):
    kwargs["api_key"] = SecretStr(llm_config["apiKey"])
if llm_config.get("baseUrl"):
    kwargs["base_url"] = llm_config["baseUrl"]
if llm_config.get("apiVersion"):
    kwargs["api_version"] = llm_config["apiVersion"]
if llm_config.get("temperature") is not None:
    kwargs["temperature"] = llm_config["temperature"]
if llm_config.get("maxOutputTokens") is not None:
    kwargs["max_output_tokens"] = llm_config["maxOutputTokens"]
if llm_config.get("timeoutSeconds") is not None:
    kwargs["timeout"] = llm_config["timeoutSeconds"]
if llm_config.get("numRetries") is not None:
    kwargs["num_retries"] = llm_config["numRetries"]
if llm_config.get("reasoningEffort") not in (None, "auto"):
    kwargs["reasoning_effort"] = llm_config["reasoningEffort"]
if llm_config.get("extraHeaders"):
    kwargs["extra_headers"] = llm_config["extraHeaders"]
if llm_config.get("inputCostPerToken") is not None:
    kwargs["input_cost_per_token"] = llm_config["inputCostPerToken"]
if llm_config.get("outputCostPerToken") is not None:
    kwargs["output_cost_per_token"] = llm_config["outputCostPerToken"]
if llm_config.get("usageId"):
    kwargs["usage_id"] = llm_config["usageId"]

llm = LLM(**kwargs)
```

The runner omits `None` values rather than passing nulls into the SDK.

## Workspace Boundary

Skill Builder's existing `workspace_path` maps to OpenHands `Conversation.workspace`.

```python
conversation = Conversation(
    agent=agent,
    workspace=workspace_skill_dir,
)
```

The workspace is for agent execution:

- `.agents/agents`
- `.agents/skills`
- per-skill scratch files
- `user-context.md`
- tool file reads and writes
- optional run logs

The workspace is not a profile or secret store. Skill Builder does not write `.openhands/profiles` under the workspace, and OpenHands user skills are not auto-loaded from `~/.openhands` unless the app explicitly enables that behavior.

If SDK event persistence is needed, the app may map a run-specific app-owned log directory to OpenHands `Conversation.persistence_dir`. That directory is separate from model settings.

## Model Catalog And Validation

The model picker uses layered metadata:

1. OpenHands `VERIFIED_MODELS` for recommended choices.
2. OpenHands `get_unverified_models()` for broader supported choices.
3. OpenHands `get_features(model)` for runtime capability flags.
4. OpenHands model-info helpers for provider/proxy metadata where available.
5. Optional `models.dev` metadata for labels, provider docs, pricing, context windows, modalities, and release dates.

The app persists only `modelSettings`, not raw catalog entries. External catalog data is cacheable display metadata.

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
| `docs/design/openhands-native-migration/README.md` | Refines the migration's model-settings portion into a clean-break OpenHands `LLM` contract. |
| `docs/design/agent-runtime-boundary/README.md` | Provides the runtime boundary this model settings contract feeds. |
| `docs/design/sdk-agent-options/README.md` | Superseded for workflow model settings; remains historical source tracing for Claude SDK options until removed. |
| `docs/design/agent-specs/storage.md` | Defines the existing DB/workspace/skills-path boundary. This design preserves DB settings as source of truth and maps workspace to OpenHands `Conversation.workspace`. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/types/settings.rs` | Rust `AppSettings`; target home for `ModelSettings`. |
| `app/src-tauri/src/db/settings.rs` | Settings JSON read/write and current transitional OpenHands normalization; target for clean-break selection. |
| `app/src-tauri/src/commands/settings.rs` | Tauri settings commands used by the Settings UI. |
| `app/src/lib/types.ts` | Frontend `AppSettings`; target home for `modelSettings`. |
| `app/src/stores/settings-store.ts` | Frontend settings state. |
| `app/src/components/settings/sdk-section.tsx` | Current model/API settings UI; target for replacement by `Models`. |
| `app/sidecar/config.ts` | Sidecar request validation; target for required OpenHands `llm` config. |
| `app/sidecar/runtime/openhands-runtime.ts` | Builds the OpenHands runner request. |
| `app/sidecar/openhands/runner.py` | Creates OpenHands `LLM`, `Agent`, and `Conversation`. |
| `docs/design/agent-specs/storage.md` | Existing storage boundary: DB is settings source of truth; workspace is transient agent execution space. |

## Open Questions

1. `[design]` Should the first implementation include `models.dev` enrichment, or should it start with OpenHands SDK model lists only?
2. `[design]` Which local providers can omit `apiKey` besides Ollama, and should that rule live in a provider registry?
3. `[design]` Should `Usage ID` be user-visible in Advanced, or should workflow runs set it internally?
