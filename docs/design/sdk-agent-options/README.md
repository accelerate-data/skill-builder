# SDK Agent Options Wiring

This note traces every Claude Agent SDK option currently set in `app/sidecar/options.ts` back to its source.

Reference: [Agent SDK options (TypeScript)](https://platform.claude.com/docs/en/agent-sdk/typescript#claude-agent-options).

Scope:

- Sidecar call path: `query({ prompt, options })`
- Option builder: `app/sidecar/options.ts`
- Config producer paths:
  - Workflow and gate agents in Rust (`commands/workflow.rs`)
  - Refine streaming in Rust (`commands/refine.rs`)
  - Direct `start_agent` command (`commands/agent.rs`) used by frontend surfaces like Test and Feedback

## Settings to SDK Wiring

| Setting | Why | Where set |
|---|---|---|
| `preferred_model` | Primary model choice for skill-building, refine, and test runs | UI: `app/src/pages/settings.tsx` (`Skill Building -> Model`); read in backend: `commands/workflow.rs::read_workflow_settings()`, `commands/refine.rs::send_refine_message()`, `commands/agent.rs::start_agent()` |
| `fallback_model` (derived) | Keep fallback aligned to selected primary model | Derived from `preferred_model` in UI save path: `app/src/pages/settings.tsx::autoSave()`; passed into sidecar config in `commands/workflow.rs`, `commands/refine.rs`, `commands/agent.rs` |
| `extended_thinking` | Enable/disable thinking budgets | UI: `app/src/pages/settings.tsx` (`Skill Building -> Agent Features`); consumed in `commands/workflow.rs`, `commands/refine.rs`, `commands/agent.rs` |
| `interleaved_thinking_beta` | Allow interleaved-thinking beta when thinking is enabled on supported models | UI: `app/src/pages/settings.tsx` (`Skill Building -> Agent Features`); applied by `commands/workflow.rs::build_betas()` |
| `sdk_effort` | Control SDK effort level for reasoning | UI: `app/src/pages/settings.tsx` (`Skill Building -> Agent Features`); passed via `SidecarConfig.effort` in `commands/workflow.rs`, `commands/refine.rs`, `commands/agent.rs` |
| `refine_prompt_suggestions` | Enable prompt suggestions specifically for refine chat sessions | UI: `app/src/pages/settings.tsx` (`Skill Building -> Agent Features`); used in `commands/refine.rs::build_refine_config()` as `prompt_suggestions` |
| `anthropic_api_key` | Authenticate SDK calls | UI: `app/src/pages/settings.tsx` (`General -> API Configuration`); loaded in backend settings reads; emitted in sidecar options as `env.ANTHROPIC_API_KEY` in `app/sidecar/options.ts::buildQueryOptions()` |
| `outputFormat` targeting (code policy) | Enforce structured JSON only where strict contracts exist; avoid harming chat/text flows | Backend policy in `commands/agent.rs::start_agent()` (`_feedback` path only); omitted for refine and test flows |
| `settingSources` (code policy) | Force project-level CLAUDE/agent/skill resolution from `cwd` | Hardcoded in `app/sidecar/options.ts::buildQueryOptions()` as `["project"]` |
| `executable` (code policy) | Ensure SDK `cli.js` runs with same Node runtime as sidecar | Hardcoded in `app/sidecar/options.ts::buildQueryOptions()` as `process.execPath` |

## Current Option Matrix

| SDK option | Where it is set | Source of value | Source type |
|---|---|---|---|
| `agent` | `app/sidecar/options.ts` | `SidecarConfig.agentName` | Backend/runtime code |
| `model` | `app/sidecar/options.ts` | `SidecarConfig.model` (only when `agentName` is absent) | UI setting + backend/runtime code |
| `env.ANTHROPIC_API_KEY` | `app/sidecar/options.ts` | `SidecarConfig.apiKey` | UI setting (persisted), read by backend |
| `settingSources` | `app/sidecar/options.ts` | `["project"]` | Hardcoded |
| `cwd` | `app/sidecar/options.ts` | `SidecarConfig.cwd` | Backend/runtime code |
| `allowedTools` | `app/sidecar/options.ts` | `SidecarConfig.allowedTools` | Backend/runtime code |
| `maxTurns` | `app/sidecar/options.ts` | `SidecarConfig.maxTurns ?? 50` | Backend/runtime code + hardcoded default |
| `permissionMode` | `app/sidecar/options.ts` | `SidecarConfig.permissionMode \|\| "bypassPermissions"` | Backend/runtime code + hardcoded default |
| `abortController` | `app/sidecar/options.ts` | Created per request/session in sidecar | Hardcoded runtime behavior |
| `executable` | `app/sidecar/options.ts` | `process.execPath` | Hardcoded |
| `pathToClaudeCodeExecutable` | `app/sidecar/options.ts` | `SidecarConfig.pathToClaudeCodeExecutable` | Backend/runtime code |
| `betas` | `app/sidecar/options.ts` | `SidecarConfig.betas` | UI setting (extended thinking) + backend logic |
| `thinking` | `app/sidecar/options.ts` | `SidecarConfig.thinking` | Backend/runtime code |
| `effort` | `app/sidecar/options.ts` | `SidecarConfig.effort` | Backend/runtime code |
| `fallbackModel` | `app/sidecar/options.ts` | `SidecarConfig.fallbackModel` | Backend/runtime code |
| `outputFormat` | `app/sidecar/options.ts` | `SidecarConfig.outputFormat` (only on JSON-contract agents) | Backend/runtime code |
| `promptSuggestions` | `app/sidecar/options.ts` | `SidecarConfig.promptSuggestions` | Backend/runtime code |
| `stderr` | `app/sidecar/options.ts` | Sidecar `stderrHandler` callback | Hardcoded runtime behavior |

## Per-Option Trace

### `agent`

- Workflow sets `agent_name` from prompt template phase (`research-orchestrator`, `confirm-decisions`, etc.).
- Refine sets `agent_name` to refine agent.
- Answer evaluator sets `agent_name` to `answer-evaluator`.
- `start_agent` accepts optional `agent_name` from caller (Test passes explicit agent names).

Decision candidate: **keep** (required for workspace agents).

### `model`

- Workflow/refine/evaluator derive model from settings (`preferred_model`) with fallback behavior.
- `start_agent` requires `model` argument from caller.
- Sidecar omits `model` whenever `agent` is present so agent frontmatter remains authoritative.

Decision candidate: **keep** (core control surface, wired to settings).

### `env` (`ANTHROPIC_API_KEY`)

- API key comes from persisted app settings in backend and is passed into sidecar config.

Decision candidate: **keep** (required auth path).

### `settingSources`

- Hardcoded to `["project"]` so SDK loads project-level settings and `CLAUDE.md` from `cwd`.
- This is intentional and aligns with SDK guidance for loading project instructions.

Decision candidate: **keep hardcoded**.

### `cwd`

- Workflow and refine set this to workspace path roots.
- Test/evaluator direct calls pass dedicated working directories.

Decision candidate: **keep** (anchors project settings resolution and file context).

### `allowedTools`

- Workflow: hardcoded per step from `FULL_TOOLS`.
- Refine: hardcoded refine tool allowlist.
- Evaluator: hardcoded `["Read", "Write"]`.
- Test and feedback direct calls pass `[]`.

Decision candidate: **keep**, but this is backend-controlled (not settings UI).

### `maxTurns`

- Workflow: step-specific hardcoded limits.
- Refine: stream-session max-turn constant.
- Evaluator/Test/Feedback: call-site specific limits.
- Sidecar default is `50` only when value omitted.

Decision candidate: **keep**, backend-controlled (not settings UI).

### `permissionMode`

- Workflow and evaluator force `"bypassPermissions"`.
- Refine sets `None` and sidecar defaults to `"bypassPermissions"`.
- Test calls use `"plan"` explicitly.
- Feedback passes `undefined`.

Decision candidate: **keep**, but default/fallback can be centralized/documented.

### `abortController`

- Injected by sidecar for cancellation and request lifecycle management.

Decision candidate: **keep hardcoded**.

### `executable`

- Hardcoded to `process.execPath` so SDK `cli.js` is launched with the same Node runtime as sidecar.

Decision candidate: **keep hardcoded**.

### `pathToClaudeCodeExecutable`

- Usually not set by callers.
- Backend fills it automatically via SDK `cli.js` path resolution:
  - `spawn_sidecar` sets it if missing.
  - Refine stream path also sets it before `send_stream_start`.

Decision candidate: **keep backend-wired, not user-facing**.

### `betas` and `thinking`

- Thinking behavior is derived from persisted Settings controls.
- Settings UI controls:
  - `extended_thinking`
  - `interleaved_thinking_beta`
- `thinking` is now passed as structured config (`{ type: "enabled", budgetTokens }`) instead of legacy `maxThinkingTokens`.
- Workflow uses per-step thinking budgets.
- Refine/start_agent use fixed thinking budget when enabled.
- `build_betas` adds interleaved-thinking beta for non-opus models when thinking budget is enabled.

Decision candidate: **keep** (aligned to SDK `thinking` option and Settings controls).

### `effort` and `fallbackModel`

- `effort` is configurable in Settings UI and persisted in app settings.
- `fallbackModel` is derived from the selected Skill Building model (`preferred_model`).

Decision candidate: **keep** (`effort` configurable, `fallbackModel` derived).

### `outputFormat`

- Set only for agents with strict JSON response contracts.
- Current explicit JSON-contract path is feedback enrichment (`_feedback`).
- Refine chat and test plan/evaluator runs intentionally omit `outputFormat`.

Decision candidate: **keep selective** (avoid forcing JSON on conversational/text agents).

### `promptSuggestions`

- Available in sidecar config/options.
- Refine streaming sessions use the persisted Settings toggle (`refine_prompt_suggestions`).

Decision candidate: **keep** (refine-specific user control).

### `stderr`

- Always passed by sidecar runtime as callback to route SDK stderr into structured system events/transcripts.

Decision candidate: **keep hardcoded**.

## What Is Actually UI-Wired vs Code-Wired

UI/persisted settings influence:

- API key (`env`)
- Preferred model (`model`)
- Extended thinking (`betas`, `thinking`)
- Workspace/skills paths that indirectly shape `cwd` and prompts

Not directly settings-UI wired (code-controlled):

- `allowedTools`
- `maxTurns`
- `permissionMode`
- `pathToClaudeCodeExecutable`
- `executable`
- `settingSources`
- `stderr`
- `abortController`

## Specific Simplification Proposal

If the goal is "only options that are hardcoded or wired to backend/settings UI", keep:

- `agent`, `model` (none check), `env`, `settingSources`, `cwd`, `allowedTools`, `maxTurns`, `permissionMode`, `betas`, `thinking`, `executable`, `pathToClaudeCodeExecutable`, `stderr`, `abortController`, `outputFormat` (contract-only)
