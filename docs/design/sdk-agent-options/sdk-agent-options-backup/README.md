# SDK Agent Options Wiring

Final wiring spec for Claude Agent SDK options in the sidecar.

Reference:

- [Agent SDK reference (TypeScript): Claude Agent options](https://platform.claude.com/docs/en/agent-sdk/typescript#claude-agent-options)

Scope:

- Sidecar call path: `query({ prompt, options })`
- Option builder: `app/sidecar/options.ts`
- Config producer paths:
  - Workflow and gate agents in Rust (`commands/workflow.rs`)
  - Refine streaming in Rust (`commands/refine.rs`)
  - Direct `start_agent` command (`commands/agent.rs`) used by frontend surfaces like Test and Feedback

## Option Matrix

| SDK option | Where set | Source value | Source type |
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
| `outputFormat` | `app/sidecar/options.ts` | `SidecarConfig.outputFormat` (JSON-contract agents only) | Backend/runtime code |
| `promptSuggestions` | `app/sidecar/options.ts` | `SidecarConfig.promptSuggestions` | Backend/runtime code |
| `stderr` | `app/sidecar/options.ts` | Sidecar `stderrHandler` callback | Hardcoded runtime behavior |

## Option Behavior

### `agent` and `model`

- `agent` is used for named workspace agents (workflow steps, refine, answer-evaluator, and explicit agent calls from `start_agent`).
- `model` is omitted when `agentName` is present so agent frontmatter remains authoritative.
- `model` is included for calls that do not provide `agentName`.

### `env` and `settingSources`

- `env.ANTHROPIC_API_KEY` is passed from persisted settings via backend config.
- `settingSources` is fixed to `["project"]` so project-level `CLAUDE.md` and project agents/skills resolve from `cwd`.

### `cwd`

- Workflow and refine use workspace-root `cwd`.
- Test/evaluator paths pass dedicated working directories.

### `allowedTools`, `maxTurns`, `permissionMode`

- Workflow tools and max-turn budgets are step-specific.
- Refine uses a dedicated tool allowlist and stream-session max-turn cap.
- Evaluator uses `["Read", "Write"]`.
- Test and feedback pass `[]` tools.
- `permissionMode` defaults to `bypassPermissions`; test paths can set `plan`.

### `abortController`, `stderr`, `executable`, `pathToClaudeCodeExecutable`

- `abortController` is created per request/session in sidecar runtime.
- `stderr` is always wired to sidecar event/log forwarding.
- `executable` is pinned to `process.execPath` so SDK `cli.js` uses the same Node runtime.
- `pathToClaudeCodeExecutable` is resolved by backend if not provided.

### `betas` and `thinking`

- Thinking behavior is derived from persisted Settings controls.
- Settings UI controls:
  - `extended_thinking`
  - `interleaved_thinking_beta`
- `thinking` is used instead of legacy `maxThinkingTokens`.
- Workflow uses per-step thinking budgets; refine and direct-agent paths use fixed thinking budget when enabled.
- `build_betas` adds interleaved-thinking beta for non-opus models when thinking budget is enabled.

### `effort` and `fallbackModel`

- Both options are present in the sidecar option contract and pass through when set in `SidecarConfig`.
- Both are configurable in Settings UI and persisted in app settings.

### `outputFormat`

- `outputFormat` is set only for JSON-contract agents.
- Feedback enrichment (`skill_name == "_feedback"`) is the explicit JSON-contract path.
- Refine and test flows do not set `outputFormat`.

### `promptSuggestions`

- `promptSuggestions` is available in sidecar config/options.
- Refine streaming sessions use the persisted Settings toggle (`refine_prompt_suggestions`).

### `resume` / `sessionId`

- Removed from sidecar config/options.
- `start_agent` no longer accepts `session_id`.

## UI-Wired vs Code-Wired

UI/persisted settings influence:

- API key (`env`)
- Preferred model (`model`)
- Extended thinking policy (`betas`, `thinking`)
- SDK effort (`effort`)
- Fallback model (`fallbackModel`)
- Refine prompt suggestions (`promptSuggestions`)
- Workspace/skills paths that influence `cwd` and prompt context

Code-controlled (not directly settings-UI wired):

- `allowedTools`
- `maxTurns`
- `permissionMode`
- `pathToClaudeCodeExecutable`
- `executable`
- `settingSources`
- `stderr`
- `abortController`
- `outputFormat` targeting

## Active Set

Active options:

- `agent`, `model` (only when no `agentName`), `env`, `settingSources`, `cwd`, `allowedTools`, `maxTurns`, `permissionMode`, `betas`, `thinking`, `effort`, `fallbackModel`, `outputFormat` (contract-only), `promptSuggestions`, `executable`, `pathToClaudeCodeExecutable`, `stderr`, `abortController`

Removed option path:

- `resume` / `sessionId`
