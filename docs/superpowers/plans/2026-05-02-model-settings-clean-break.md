# Model Settings Clean Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace transitional Anthropic/OpenHands model settings with one app-owned OpenHands `LLM` settings contract used by workflow agents.

**Architecture:** Skill Builder stores canonical `model_settings` in the existing app settings JSON row. Rust validates and selects `WorkflowLlmConfig`, workflow calls send a required `llm` object to the sidecar, and the Python runner constructs OpenHands `LLM(...)` from that object. The Settings page becomes `Models` and no workflow path reads legacy Claude/OpenHands transitional fields.

**Tech Stack:** Tauri/Rust settings and workflow commands, React/Zustand settings UI, Node sidecar Vitest, Python OpenHands runner, Playwright mocked E2E, cargo tests.

---

## File Structure

Backend ownership:

- Modify `app/src-tauri/src/types/settings.rs` to add `ModelSettings` and remove workflow-facing legacy model fields from `AppSettings`.
- Modify `app/src-tauri/src/db/settings.rs` to normalize canonical settings only and add `selected_workflow_llm`.
- Modify `app/src-tauri/src/commands/workflow/settings.rs` and `app/src-tauri/src/commands/workflow/runtime.rs` to use `WorkflowLlmConfig`.
- Modify Rust settings/database tests under `app/src-tauri/src/db/tests.rs`, `app/src-tauri/src/db/settings.rs`, and workflow settings tests.

Sidecar ownership:

- Modify `app/sidecar/config.ts` and `app/sidecar/runtime/types.ts` to add required OpenHands `llm` config for workflow runs.
- Modify `app/sidecar/runtime/openhands-runtime.ts` to serialize `llm`, derive redaction from `llm.apiKey`, and stop sending top-level workflow `model/apiKey/modelBaseUrl`.
- Modify `app/sidecar/openhands/runner.py` to require `request["llm"]` for OpenHands runs and map non-null fields to `LLM(...)`.
- Modify sidecar tests in `app/sidecar/__tests__/openhands-runtime.test.ts`, `app/sidecar/__tests__/openhands-runner.test.ts`, `app/sidecar/__tests__/run-agent.test.ts`, and `app/sidecar/__tests__/persistent-mode.test.ts`.

Frontend ownership:

- Modify `app/src/lib/types.ts`, `app/src/stores/settings-store.ts`, `app/src/hooks/use-settings-form.ts`, and app startup/setup mapping to use `model_settings`.
- Replace `app/src/components/settings/sdk-section.tsx` with a generic `Models` settings section, or keep the filename while changing the component contract.
- Modify `app/src/pages/settings.tsx`, frontend unit tests, and `app/e2e/settings/settings.spec.ts` to use the `Models` page and canonical fields.

Integration ownership:

- Run `cd app && npm run codegen` after Rust type changes.
- Update generated files under `app/src/generated/contracts.ts` and `app/sidecar/generated/contracts.ts` only through codegen.
- Remove or update stale tests that assert legacy fallback.
- Run full validation gates from `TEST_MAP.md`.

## Task 1: Backend Canonical Model Settings

**Files:**

- Modify: `app/src-tauri/src/types/settings.rs`
- Modify: `app/src-tauri/src/db/settings.rs`
- Modify: `app/src-tauri/src/commands/workflow/settings.rs`
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Modify: `app/src-tauri/src/db/tests.rs`

- [ ] **Step 1: Add failing Rust tests for clean-break behavior**

Add tests that assert:

```rust
#[test]
fn selected_workflow_llm_ignores_legacy_fields() {
    let settings = AppSettings {
        anthropic_api_key: Some("sk-legacy".to_string()),
        preferred_model: Some("claude-sonnet-4-6".to_string()),
        skills_path: Some("/tmp/skills".to_string()),
        ..AppSettings::default()
    };

    let err = selected_workflow_llm(&settings).unwrap_err();
    assert!(err.contains("Select a model in Settings"));
}

#[test]
fn selected_workflow_llm_accepts_canonical_model_settings() {
    let settings = AppSettings {
        skills_path: Some("/tmp/skills".to_string()),
        model_settings: ModelSettings {
            provider: Some("anthropic".to_string()),
            model: Some("claude-sonnet-4-5".to_string()),
            api_key: Some(SecretString::new("sk-test".to_string())),
            ..ModelSettings::default()
        },
        ..AppSettings::default()
    };

    let llm = selected_workflow_llm(&settings).unwrap();
    assert_eq!(llm.model, "claude-sonnet-4-5");
    assert_eq!(llm.api_key.as_ref().unwrap().expose(), "sk-test");
}
```

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml db::settings::tests::selected_workflow_llm
```

Expected: FAIL because `ModelSettings` and `selected_workflow_llm` do not exist.

- [ ] **Step 2: Implement canonical Rust settings types**

Add `ModelSettings` to `app/src-tauri/src/types/settings.rs`:

```rust
#[derive(Clone, Serialize, Deserialize, Default)]
pub struct ModelSettings {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub api_key: Option<SecretString>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_version: Option<String>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub timeout_seconds: Option<u32>,
    #[serde(default)]
    pub num_retries: Option<u32>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub extra_headers: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    pub input_cost_per_token: Option<f64>,
    #[serde(default)]
    pub output_cost_per_token: Option<f64>,
    #[serde(default)]
    pub usage_id: Option<String>,
}
```

Add `#[serde(default)] pub model_settings: ModelSettings` to `AppSettings`.

- [ ] **Step 3: Replace runtime model selection**

In `app/src-tauri/src/db/settings.rs`, replace `normalize_openhands_settings` and `selected_openhands_runtime` workflow use with:

```rust
pub(crate) fn normalize_model_settings(mut settings: AppSettings) -> AppSettings {
    settings.model_settings.provider = trimmed_opt(settings.model_settings.provider);
    settings.model_settings.model = trimmed_opt(settings.model_settings.model);
    settings.model_settings.api_key = settings
        .model_settings
        .api_key
        .and_then(|key| {
            let trimmed = key.expose().trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(crate::types::SecretString::new(trimmed))
            }
        });
    settings.model_settings.base_url = trimmed_opt(settings.model_settings.base_url);
    settings.model_settings.api_version = trimmed_opt(settings.model_settings.api_version);
    settings.model_settings.reasoning_effort = trimmed_opt(settings.model_settings.reasoning_effort);
    settings.model_settings.usage_id = trimmed_opt(settings.model_settings.usage_id);
    settings
}
```

Add:

```rust
pub(crate) struct WorkflowLlmConfig {
    pub model: String,
    pub api_key: Option<crate::types::SecretString>,
    pub base_url: Option<String>,
    pub api_version: Option<String>,
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<u32>,
    pub timeout_seconds: Option<u32>,
    pub num_retries: Option<u32>,
    pub reasoning_effort: Option<String>,
    pub extra_headers: Option<std::collections::HashMap<String, String>>,
    pub input_cost_per_token: Option<f64>,
    pub output_cost_per_token: Option<f64>,
    pub usage_id: Option<String>,
}
```

Implement `selected_workflow_llm(settings: &AppSettings) -> Result<WorkflowLlmConfig, String>` that reads only `settings.model_settings`.

- [ ] **Step 4: Wire workflow settings and config**

Change `WorkflowSettings` to hold `llm: WorkflowLlmConfig` instead of `api_key`, `preferred_model`, `model_base_url`, `extended_thinking`, `interleaved_thinking_beta`, and `sdk_effort`.

In `run_workflow_step`, set:

```rust
llm: Some(settings.llm.clone()),
model: None,
model_base_url: None,
api_key: crate::types::SecretString::new("openhands-llm-config".to_string()),
betas: None,
thinking: None,
effort: None,
fallback_model: None,
```

Use a placeholder top-level `api_key` only until the sidecar contract makes `llm` authoritative.

- [ ] **Step 5: Run backend tests**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml db::settings
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow::settings
cargo test --manifest-path app/src-tauri/Cargo.toml test_workflow_step_config_uses_openhands_runtime_provider
```

Expected: PASS.

## Task 2: Sidecar And Runner LLM Contract

**Files:**

- Modify: `app/sidecar/config.ts`
- Modify: `app/sidecar/runtime/types.ts`
- Modify: `app/sidecar/runtime/openhands-runtime.ts`
- Modify: `app/sidecar/openhands/runner.py`
- Modify: sidecar tests under `app/sidecar/__tests__/`

- [ ] **Step 1: Add failing sidecar tests for required `llm`**

Update `openhands-runtime.test.ts` to build requests with:

```ts
llm: {
  model: "claude-sonnet-4-5",
  apiKey: "sk-test",
  baseUrl: "https://models.example.com/v1",
  timeoutSeconds: 300,
  numRetries: 5,
  reasoningEffort: "high",
}
```

Assert the runner stdin JSON contains `llm` and does not contain top-level workflow `model`, `apiKey`, or `modelBaseUrl`.

Run:

```bash
cd app/sidecar && npx vitest run __tests__/openhands-runtime.test.ts
```

Expected: FAIL until runtime serialization changes.

- [ ] **Step 2: Add `OpenHandsLlmConfig` to sidecar types**

In `config.ts` and `runtime/types.ts`, add:

```ts
export interface OpenHandsLlmConfig {
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
}
```

Add `llm?: OpenHandsLlmConfig` to `SidecarConfig` and make OpenHands one-shot validation reject missing or invalid `llm`.

- [ ] **Step 3: Serialize and redact `llm`**

Change `buildRunnerRequest` in `openhands-runtime.ts` to include `llm: request.llm` and omit top-level workflow model credentials. Change stderr redaction to redact `request.llm?.apiKey` and every `request.llm?.extraHeaders` value.

- [ ] **Step 4: Update Python runner**

In `runner.py`, replace top-level model/key parsing with:

```python
llm_config = request.get("llm")
if not isinstance(llm_config, dict):
    raise ValueError("OpenHands runner request missing llm config")
```

Build `llm_kwargs` from non-null `llm_config` fields and pass them to `LLM(**llm_kwargs)`.

- [ ] **Step 5: Run sidecar tests**

Run:

```bash
cd app/sidecar && python3 -m py_compile openhands/runner.py
cd app/sidecar && npx vitest run __tests__/openhands-runtime.test.ts __tests__/openhands-runner.test.ts __tests__/run-agent.test.ts __tests__/persistent-mode.test.ts
```

Expected: PASS.

## Task 3: Frontend Models Settings Page

**Files:**

- Modify: `app/src/lib/types.ts`
- Modify: `app/src/stores/settings-store.ts`
- Modify: `app/src/hooks/use-settings-form.ts`
- Modify: `app/src/pages/settings.tsx`
- Modify: `app/src/components/settings/sdk-section.tsx`
- Modify: `app/src/components/setup-screen.tsx`
- Modify: frontend tests and `app/e2e/settings/settings.spec.ts`

- [ ] **Step 1: Add failing frontend tests for canonical settings**

Update settings form tests to assert `update_user_settings` receives:

```ts
model_settings: {
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  api_key: "sk-test",
  base_url: null,
}
```

Update E2E settings tests to click `Models`, not `OpenHands`, and assert the old `Anthropic Model List` section is absent.

Run:

```bash
cd app && npx vitest run src/__tests__/hooks/use-settings-form.test.ts src/__tests__/components/setup-screen.test.tsx
cd app && bash tests/run.sh e2e --tag @settings
```

Expected: FAIL until UI/store changes.

- [ ] **Step 2: Update frontend settings types and store**

Add `ModelSettings` to `app/src/lib/types.ts` with snake_case JSON fields:

```ts
export interface ModelSettings {
  provider: string | null
  model: string | null
  api_key: string | null
  base_url: string | null
  api_version?: string | null
  temperature?: number | null
  max_output_tokens?: number | null
  timeout_seconds?: number | null
  num_retries?: number | null
  reasoning_effort?: string | null
  extra_headers?: Record<string, string> | null
  input_cost_per_token?: number | null
  output_cost_per_token?: number | null
  usage_id?: string | null
}
```

Replace store state `openhandsProvider/openhandsApiKey/openhandsModel/openhandsBaseUrl` with a single `modelSettings` object and derived convenience selectors only where needed.

- [ ] **Step 3: Replace settings form local fields**

Change `useSettingsForm` to read/write `modelSettings`. `autoSave` must send `model_settings` and must not send legacy workflow model fields.

- [ ] **Step 4: Redesign the settings section**

Keep the component filename if that minimizes churn, but render the page as `Models`:

```text
Models
Configure the language model used by workflow agents.

Model
Provider
Model
API Key
Base URL

Model details
Request settings
Capabilities
Advanced
```

Remove the `Anthropic Model List` card and Anthropic-specific feature labels.

- [ ] **Step 5: Run frontend tests**

Run:

```bash
cd app && npx vitest run src/__tests__/hooks/use-settings-form.test.ts src/__tests__/components/setup-screen.test.tsx
cd app && bash tests/run.sh e2e --tag @settings
```

Expected: PASS.

## Task 4: Integration, Codegen, And Final Gates

**Files:**

- Modify generated contracts through codegen.
- Modify any stale references found by `rg`.
- Update tests only when they assert legacy behavior.

- [ ] **Step 1: Generate contracts**

Run:

```bash
cd app && npm run codegen
```

Expected: generated TypeScript/Rust contract files update cleanly.

- [ ] **Step 2: Search for forbidden workflow fallback**

Run:

```bash
rg -n "selected_openhands_runtime|preferred_model|openhands_model|openhands_api_key|anthropic_api_key|fallback_model|extended_thinking|interleaved_thinking_beta|sdk_effort|Anthropic Model List|OpenHands\" \\}" app/src app/src-tauri app/sidecar app/e2e
```

Expected: no workflow model-selection path reads legacy fields. Remaining references must be non-workflow legacy paths, historical docs, or tests explicitly asserting clean-break ignore behavior.

- [ ] **Step 3: Run targeted gates**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
cargo test --manifest-path app/src-tauri/Cargo.toml commands::settings
cd app/sidecar && npx vitest run
cd app && npm run test:unit
cd app && bash tests/run.sh e2e --tag @settings
```

Expected: PASS.

- [ ] **Step 4: Run required broad gates**

Run:

```bash
git diff --check
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings
cd app && npm run test:agents:structural
cd tests/evals && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit and push**

Run:

```bash
git status --short
git add .
git commit --no-gpg-sign -m "VU-1145: implement clean-break model settings"
git push
```

Expected: branch pushed with clean working tree.
