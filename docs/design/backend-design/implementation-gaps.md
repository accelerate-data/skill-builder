# Backend Implementation Gaps

Current gaps between latest `main` and the target backend architecture described
in this folder.

## 1. LiteLLM Is Not Yet The Sole Runtime Gateway

Target architecture assumes all OpenHands traffic routes through the Rust-managed
LiteLLM proxy using a selected profile's virtual key.

Latest `main` still keeps the older direct-model settings path alive:

- `app/src-tauri/src/types/settings.rs`
- `app/src-tauri/src/commands/workflow/settings.rs`
- `app/src-tauri/src/agents/runtime_config.rs`

Current consequence:

- runtime config can still be built from direct `model` / `api_key` /
  `base_url` settings
- profile selection is not yet the single model-routing contract

## 2. LiteLLM Config Generation Is Partial

Target LiteLLM design expects config generation to honor:

- `litellm_provider_prefix`
- provider `base_url`
- provider and profile `settings_json`
- per-profile fallback order
- per-model budget semantics described in
  `docs/design/litellm-integration/budgets.md`

Latest `main` config generation in
`app/src-tauri/src/agents/litellm_proxy/config.rs` is still simpler:

- it derives provider routing from `provider.name` when `model_name` is not
  already fully-qualified
- it does not incorporate provider `base_url`
- it does not project `settings_json`
- it does not express the full target budget configuration in `config.yaml`

## 3. Provider/Profile Mutations Do Not Yet Own Proxy Reconfiguration

Target architecture expects provider/profile changes to regenerate LiteLLM
config and restart or refresh the proxy as needed.

Latest `main` provider/profile commands update SQLite rows, but that is not yet
the full lifecycle contract:

- `app/src-tauri/src/commands/litellm_providers.rs`
- `app/src-tauri/src/commands/litellm_profiles.rs`

Gap:

- config regeneration and proxy restart/refresh are not yet the obvious
  first-class side effect of every provider/profile mutation

## 4. No Frontend Readiness Event For The Proxy

The LiteLLM design expects an explicit readiness handshake so the frontend can
gate model-using actions until the proxy is healthy.

Latest `main` starts the proxy at app startup, but there is no dedicated
`litellm-proxy-ready` event contract emitted from the backend.

Relevant files:

- `app/src-tauri/src/lib.rs`
- `app/src-tauri/src/agents/litellm_proxy/mod.rs`

## 5. Usage Ownership Is Still Transitional

Target architecture moves budget enforcement and spend tracking to LiteLLM.

Latest `main` still has app-owned usage telemetry centered on:

- `agent_runs`
- `workflow_sessions`
- `app/src-tauri/src/commands/usage.rs`
- `app/src-tauri/src/agents/run_persist.rs`

Gap:

- the backend still presents app-owned usage aggregation as the primary usage
  surface instead of treating LiteLLM spend logs as the canonical spend source

## 6. Documentation Index Drift Exists Outside This Folder Too

The target backend design now points to the LiteLLM design under
`docs/design/litellm-integration/`, but the broader design index still needs to
reference that live directory correctly.

Relevant file:

- `docs/design/README.md`
