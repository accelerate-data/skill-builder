---
functional-specs: [custom-plugin-management]
---

# Model Settings

> **Status:** Draft
> **Functional specs:** [`custom-plugin-management`](../../functional/custom-plugin-management/README.md) — this design covers the LLM infrastructure (provider routing, budget enforcement, spend tracking) that powers the skill-building workflow agents. It does not define the skill creation, refinement, evaluation, or distribution behavior itself.

## Overview

Skill Builder configures language models through a Rust-managed LiteLLM proxy sidecar. The proxy handles provider routing, fallbacks, virtual key generation, budget enforcement, and spend tracking. The app's existing `agent_runs` table and associated usage code are removed. Two new frontend pages — Providers and Models — replace the current single-model settings UI.

This design replaces the per-run provider+API-key model with a multi-provider, multi-profile architecture where LiteLLM owns usage tracking and budget enforcement.

## Design Scope

**Covers**

- LiteLLM proxy process lifecycle (startup, health check, shutdown, restart)
- Provider management UI and persistence (API keys, base URLs, enabled/disabled)
- Profile management UI and persistence (model selection, fallback order, budgets, rate limits)
- Virtual key generation and management via LiteLLM admin API
- OpenHands runtime config changes (proxy URL + virtual key instead of direct provider credentials)
- Usage page migration (drop `agent_runs`, read from LiteLLM spend APIs)
- App SQLite schema changes (new provider/profile tables, drop usage tables)
- LiteLLM config.yaml generation from app SQLite data

**Does not cover**

- Session lifecycle, pause/resume semantics, or surface routing
- Workspace/conversation ownership rules
- LiteLLM's Admin UI exposure (future enhancement)
- Redis-backed response caching (future enhancement)
- Team-based budgeting (single-user desktop app)

## Key Decisions

| Decision | Rationale |
|---|---|
| LiteLLM runs as a Rust-managed sidecar process | Matches existing OpenHands process management pattern; users don't manage external processes |
| Separate LiteLLM SQLite DB in `{app_data}/litellm/litellm.db` | Avoids schema conflicts, lock contention, and corruption risk from sharing `skill-builder.db` |
| Provider API keys stored in app SQLite, not LiteLLM config.yaml | Keys are sensitive; config.yaml is regenerated on every change. Keys passed via config at startup only |
| One virtual key per profile | LiteLLM tracks spend and enforces budgets per key; profiles map 1:1 to keys |
| Drop `agent_runs` table entirely | Dev mode; no migration needed. LiteLLM's `LiteLLM_SpendLogs` is the new usage source |
| OpenHands points to proxy, not direct provider | Single routing authority; fallbacks, budgets, and rate limits enforced centrally |
| Config regeneration triggers proxy restart | LiteLLM reads config at startup only; changes require restart. Virtual keys preserved via admin API |
| `uvx litellm[proxy]` at runtime (latest, no version pin) | Same pattern as OpenHands; LiteLLM auto-syncs model pricing from GitHub. Breaking changes are caught by proxy startup failure, not runtime errors |
| Proxy starts async on app launch, not blocking UI | App renders immediately. Background thread spawns proxy. Frontend shows "LLM proxy starting..." if user runs skill before healthy |
| No fallback to direct provider calls | Single proxy-only architecture. If proxy fails to start, agent runs are blocked with a clear error. No dual code path to maintain |

## Architecture / How It Works

### Process Model

```
┌─────────────────────────────────────────────────────┐
│                    Tauri App                        │
│                                                     │
│  ┌────────────┐    ┌────────────────────────────┐   │
│  │  Rust      │───▶│  LiteLLM Proxy Process     │   │
│  │  Backend   │    │  (uvx litellm[proxy])      │   │
│  │            │◀───│  :<port>/v1 + admin API    │   │
│  └─────┬──────┘    └──────────┬─────────────────┘   │
│        │                      │                     │
│        │ config.yaml          │ virtual key         │
│        │                      │                     │
│        ▼                      ▼                     │
│  ┌────────────┐    ┌────────────────────────────┐   │
│  │ OpenHands  │───▶│  LiteLLM Proxy (routing)   │   │
│  │ Process    │    │  → Provider API keys       │   │
│  └────────────┘    │  → Budget enforcement      │   │
│                    │  → Fallback chains         │   │
│                    └──────────┬─────────────────┘   │
│                               │                     │
│                    ┌──────────▼─────────────────┐   │
│                    │  {app_data}/litellm/       │   │
│                    │  ├── config.yaml           │   │
│                    │  └── litellm.db            │   │
│                    └────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Directory Layout

```
{app_local_data_dir}/
├── db/
│   └── skill-builder.db          ← App DB (skills, settings, workflow)
├── openhands/                    ← OpenHands conversations, logs
└── litellm/
    ├── config.yaml               ← Generated proxy config
    ├── .master_key               ← LiteLLM master key (0600 permissions)
    └── litellm.db                ← LiteLLM usage/budgets
```

### LiteLLM Proxy Lifecycle

**Startup** (runs on Tauri app launch, async background thread):

1. Rust spawns proxy setup on a background Tokio task; app UI renders immediately
2. Rust reads `llm_providers` + `llm_profiles` from app SQLite
3. Rust generates `{app_data}/litellm/config.yaml` from provider/profile data
4. Rust reads or generates `{app_data}/litellm/.master_key` (0600 permissions)
5. Rust selects a random available port (same pattern as `select_random_local_port()`)
6. Rust spawns: `uvx litellm[proxy] --config config.yaml --port <port>`
7. Rust polls `http://127.0.0.1:<port>/health` until healthy (5s timeout, 100ms intervals)
8. Rust calls LiteLLM admin API to ensure each profile has a virtual key:
   - `POST /user/new` → Create internal user per profile
   - `POST /key/generate` → Create virtual key with models, budget, rate limits
9. Rust stores virtual keys and user IDs back in `llm_profiles` table
10. Port and master key stored in static registry (pattern: `OpenHandsAgentServerRegistry`)
11. On completion, Rust emits a Tauri event (`litellm-proxy-ready`) that the frontend listens to for enabling "Run" buttons

**Shutdown** (on app quit):

1. Rust sends SIGTERM to LiteLLM proxy process group
2. Falls back to SIGKILL after 5s timeout
3. Same pattern as `OpenHandsAgentServerProcess::shutdown_with_outcome()`

**Config regeneration** (when user adds/edits/deletes provider or profile):

1. Rust updates app SQLite
2. Rust regenerates `config.yaml`
3. Rust blocks LiteLLM admin API to save virtual keys
4. Rust SIGTERMs proxy, waits for exit
5. Rust spawns new proxy with updated config
6. Rust restores virtual keys via admin API if lost

### Config Generation

Rust generates `config.yaml` from app SQLite data:

```yaml
model_list:
  - model_name: "claude-sonnet-4-5"
    litellm_params:
      model: "anthropic/claude-sonnet-4-5"
      api_key: "sk-ant-..."
  - model_name: "gpt-4o"
    litellm_params:
      model: "openai/gpt-4o"
      api_key: "sk-proj-..."

fallbacks:
  - ["claude-sonnet-4-5", "gpt-4o"]

general_settings:
  master_key: "sk-<from-.master_key-file>"
  database_url: "sqlite:///{app_data}/litellm/litellm.db"

litellm_settings:
  max_budget: 0
```

### OpenHands Runtime Config Changes

**Before (current):**

```rust
OpenHandsRuntimeConfig {
    model: Some("anthropic/claude-sonnet-4-5"),
    model_base_url: Some("https://api.anthropic.com/v1"),
    api_key: SecretString("sk-ant-..."),
}
```

**After:**

```rust
OpenHandsRuntimeConfig {
    model: Some("claude-sonnet-4-5"),
    model_base_url: Some("http://127.0.0.1:<litellm-port>/v1"),
    api_key: SecretString("sk-<virtual-key-for-selected-profile>"),
}
```

### App Settings Contract Changes

**`ModelSettings` struct:**

| Field | Before | After |
|---|---|---|
| `api_key` | `Option<SecretString>` | Removed (providers store keys) |
| `base_url` | `Option<String>` | Removed (proxy handles routing) |
| `profile_id` | N/A | `Option<String>` — selected profile |
| `model` | `Option<String>` — full runtime ID | `Option<String>` — LiteLLM `model_name` |
| `provider` | `Option<String>` | Removed (proxy handles routing) |

### App SQLite — New Tables

**`llm_providers`**

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PRIMARY KEY | UUID |
| `name` | TEXT NOT NULL | Provider name (e.g. "anthropic", "openai") |
| `api_key` | TEXT NOT NULL | API key (SecretString in Rust) |
| `base_url` | TEXT | Optional custom base URL |
| `enabled` | INTEGER DEFAULT 1 | 0 = disabled |
| `created_at` | INTEGER NOT NULL | Unix timestamp |

**`llm_profiles`**

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PRIMARY KEY | UUID |
| `name` | TEXT NOT NULL | Profile name (e.g. "Pro", "Dev Mode") |
| `budget_monthly` | REAL | Monthly budget in USD |
| `budget_total` | REAL | Lifetime budget in USD |
| `tpm_limit` | INTEGER | Tokens per minute limit |
| `rpm_limit` | INTEGER | Requests per minute limit |
| `virtual_key` | TEXT | Virtual key from LiteLLM (sk-...) |
| `litellm_user_id` | TEXT | Internal user ID in LiteLLM |
| `created_at` | INTEGER NOT NULL | Unix timestamp |

**`llm_profile_models`**

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PRIMARY KEY | UUID |
| `profile_id` | TEXT NOT NULL | FK → llm_profiles.id |
| `model_name` | TEXT NOT NULL | LiteLLM model name |
| `provider_id` | TEXT NOT NULL | FK → llm_providers.id |
| `priority` | INTEGER NOT NULL | Fallback order (1 = primary) |

### LiteLLM SQLite — Managed by LiteLLM

LiteLLM creates and manages its own tables via SQLAlchemy migrations:

- `LiteLLM_VerificationToken` — Virtual keys + spend
- `LiteLLM_UserTable` — Internal users + spend
- `LiteLLM_SpendLogs` — Individual transaction logs
- `LiteLLM_TeamTable` — Teams (unused in this app)

## States / Transitions

```
no_providers_configured
  No providers exist in app SQLite
  → "Run" buttons disabled
  → Banner: "Configure an LLM provider to get started" → link to Providers page

proxy_starting
  LiteLLM proxy spawning on background thread
  → App UI renders immediately
  → If user runs skill before proxy healthy: "LLM proxy starting..." loading state

proxy_ready
  LiteLLM proxy healthy, virtual keys generated
  → OpenHands routes through proxy
  → Budget enforcement active

budget_exceeded
  LiteLLM returns 400 ExceededBudget
  → OpenHands surfaces as terminal error
  → UI shows budget exceeded dialog with option to increase budget or switch profile

provider_auth_error
  LiteLLM returns 401 AuthenticationError
  → OpenHands surfaces as terminal error
  → UI shows provider auth error with link to Providers settings
```

## Frontend Pages

### Providers Page (`/settings/providers`)

**Purpose:** Define LLM providers and their API keys.

**Features:**

- Add/remove providers (Anthropic, OpenAI, Azure, Ollama, custom)
- Store API keys (masked in UI, SecretString in Rust)
- Toggle enabled/disabled per provider
- Custom base URL support (for Azure, Ollama, enterprise proxies)
- Test connection button (hit `/v1/models` via LiteLLM proxy)

**UI Components:**

- Provider list (table view with name, status, last tested)
- Add provider dialog (name, provider type, API key, base URL)
- Edit provider dialog
- Test connection indicator

### Models Page (`/settings/models`)

**Purpose:** Define profiles using providers, set budgets, generate virtual keys.

**Features:**

- Create profiles (e.g. "Pro", "Dev Mode", "Budget")
- Select models from available providers for each profile
- Set fallback order (drag to reorder)
- Set budget (monthly, total)
- Set rate limits (TPM, RPM)
- Generate virtual key (calls LiteLLM admin API via Rust)
- Test virtual key (send a test chat completion)
- View current spend for profile

**UI Components:**

- Profile list (cards with name, budget, current spend, status)
- Profile editor (model selection, fallback ordering, budget inputs)
- Virtual key display (masked, copy to clipboard)
- Test modal (model selector, prompt input, response display)
- Spend indicator (progress bar vs budget)

### Usage Page Migration

**Remove:**

- `agent_runs` table (migration to drop)
- `commands/usage.rs` — all Tauri commands
- `db/usage.rs` — all usage queries
- `queries/usage.ts` — frontend query hooks
- `stores/usage-store.ts` — frontend state
- Existing usage UI components
- All `UsageSummary`, `UsageByDay`, `UsageByModel`, `UsageByStep`, `AgentRunRecord`, `WorkflowSessionRecord` types

**New Tauri commands (Rust → LiteLLM admin API):**

| Command | LiteLLM Endpoint | Returns |
|---|---|---|
| `get_litellm_spend_summary` | `GET /global/spend/report` | Total spend, date range |
| `get_litellm_profile_spend` | `GET /key/info?key=<virtual-key>` | Spend per profile |
| `get_litellm_daily_activity` | `GET /user/daily/activity` | Daily breakdown by model/provider |
| `get_litellm_spend_logs` | `GET /spend/logs?summarize=false` | Individual transaction logs |
| `reset_litellm_spend` | `POST /global/spend/reset` | Reset all profile spend |

**New Usage Page UI:**

- Total spend summary (current period)
- Daily spend chart (from `/user/daily/activity`)
- Per-profile spend cards
- Model breakdown (which models cost the most)
- Transaction log table (individual calls)
- Reset spend button (with confirmation)

## Relationship To Existing Design Specs

| Spec | Relationship |
|---|---|
| `docs/design/openhands-runtime-model/README.md` | Defines session lifecycle, workspace ownership, and the runtime boundary that consumes the `llm` contract. This design changes how `llm` is constructed (proxy URL + virtual key instead of direct provider credentials). |
| `docs/design/agent-specs/storage.md` | Defines the broader DB/workspace/skills-path storage boundary. The new `litellm/` directory fits alongside `db/` and `openhands/` under `app_local_data_dir`. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/types/settings.rs` | Rust `AppSettings` and `ModelSettings`; target for `profile_id` addition, `api_key`/`base_url`/`provider` removal |
| `app/src-tauri/src/db/mod.rs` | DB initialization; target for new `llm_providers`, `llm_profiles`, `llm_profile_models` tables and `agent_runs` drop |
| `app/src-tauri/src/db/settings.rs` | Settings JSON read/write; target for new settings shape |
| `app/src-tauri/src/commands/settings.rs` | Tauri settings commands; target for provider/profile CRUD commands |
| `app/src-tauri/src/commands/usage.rs` | **Delete** — replaced by LiteLLM-backed usage commands |
| `app/src-tauri/src/agents/openhands_server/process.rs` | Pattern reference for LiteLLM proxy process management (port selection, health check, shutdown) |
| `app/src-tauri/src/agents/runtime_config.rs` | `OpenHandsRuntimeConfig`; target for proxy URL + virtual key instead of direct provider credentials |
| `app/src-tauri/src/agents/openhands_server/mod.rs` | `ensure_openhands_server` and runtime config resolution; target for LiteLLM proxy ensure step |
| `app/src/lib/types.ts` | Frontend `AppSettings`; target for `profile_id` addition |
| `app/src/stores/settings-store.ts` | Frontend settings state; target for provider/profile state |
| `app/src/stores/usage-store.ts` | **Delete** — replaced by LiteLLM-backed usage store |

## Error Handling

### Proxy Startup Failure

- Retry up to 3 times with 1s backoff
- If all retries fail, log error and set proxy state to `failed`
- Frontend shows persistent banner: "LLM proxy failed to start. Check providers configuration." with link to Providers page
- Agent runs remain blocked until proxy starts successfully (manual retry via app restart or provider change triggers restart)

### Proxy Health Check Failure During Runtime

- If proxy becomes unhealthy during runtime, Rust attempts restart (SIGTERM → new spawn)
- In-flight OpenHands conversations are paused and resumed after restart
- Virtual keys are preserved (stored in LiteLLM DB, not in-process)
- If restart fails after 3 retries, same failure banner as startup failure

### Budget Exceeded

- LiteLLM returns 400 with `ExceededBudget` error
- OpenHands surfaces this as a terminal error in the agent stream
- UI shows budget exceeded dialog with option to increase budget (opens Models page) or switch profile

### Provider API Key Invalid

- LiteLLM returns 401 with `AuthenticationError`
- OpenHands surfaces this as a terminal error
- UI shows provider auth error with link to Providers settings page
- Provider card shows "Invalid API key" status

### uvx Download Failure

- If `uvx` is not installed or network is unavailable, proxy startup fails
- Error message: "Python uv tool is required. Install uv from https://docs.astral.sh/uv/"
- Same blocked state as proxy startup failure

## Open Questions

1. ~~`[design]` Should we pin a specific LiteLLM version (e.g. `litellm[proxy]==1.60.0`) or use latest?~~ **Resolved:** Use latest (`uvx litellm[proxy]` with no version pin). LiteLLM auto-syncs model pricing from GitHub. Breaking changes are caught by proxy startup failure, not runtime errors.
2. ~~`[design]` Should we expose LiteLLM's built-in Admin UI (`/ui`) via a "View Detailed Usage" link that opens in the system browser?~~ **Resolved:** No. It would be confusing to bundle a generic LLM observability UI with a simple desktop app. All usage analytics stay in-app.
3. ~~`[design]` Should the proxy start on app launch or on-demand (first agent run)?~~ **Resolved:** On app launch, but on a background thread. App renders and becomes usable immediately. Proxy starts asynchronously. If the user tries to run a skill before the proxy is healthy, show a "LLM proxy starting..." loading state. Once healthy, proxy is ready for all subsequent runs.
4. ~~`[design]` How should we handle the case where the user has no providers configured?~~ **Resolved:** Block agent runs with guided redirect. If no providers are configured, disable "Run" buttons and show a banner: "Configure an LLM provider to get started" with a link to the Providers page. No fallback code path — single proxy-only architecture.
