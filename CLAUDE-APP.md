# Skill Builder -- Desktop App

Tauri v2 desktop application for building Claude skills. All code lives in `app/`.

## Architecture

React 19 (WebView) → Tauri IPC → Rust backend → spawns Node.js sidecar (`@anthropic-ai/claude-agent-sdk`)

## Tech Stack

**Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS 4, shadcn/ui, Zustand, TanStack Router, react-markdown

**Backend:** Tauri 2, rusqlite, notify, pulldown-cmark, tauri-plugin-shell, tokio

**Agent Runtime:** Node.js + `@anthropic-ai/claude-agent-sdk` (sidecar process)

**Runtime Dependency:** Node.js 18-24 (checked on startup; Node 25+ causes SDK crashes)

## Agent Orchestration (Claude Agent SDK)

Agents run via the **Claude Agent SDK** in a Node.js sidecar process.

1. **Rust backend** spawns `node agent-runner.js` as a child process
2. Passes agent config as a CLI argument (JSON): prompt, model, API key, cwd, allowed tools
3. **Sidecar** uses SDK's `query()` function with the config
4. SDK handles the full tool execution loop (Read, Write, Glob, Grep, Bash, Task)
5. Sidecar streams `SDKMessage` objects as JSON lines to stdout
6. **Rust backend** reads stdout line by line, parses JSON, emits Tauri events
7. **Frontend** subscribes to Tauri events for real-time display
8. To cancel: frontend unmount triggers process cleanup; no IPC cancel command needed

### Agent logging

The sidecar creates log files under each skill's `logs/` directory: `{workspace}/{skill-name}/logs/{step_label}-{timestamp}.jsonl`. Each log file contains:
- First line: redacted config (API key replaced with `[REDACTED]`)
- Subsequent lines: raw JSON messages from stdout (same as Tauri events)
- stderr lines logged as `{"type":"stderr","content":"..."}`
- Final line: `{"type":"agent-exit","success":true|false}`

Debug with: `tail -f ~/.vibedata/my-skill/logs/step0-research-concepts-*.jsonl`

### Sidecar config (passed as CLI argument)

```json
{
  "prompt": "Read references/shared-context.md and agents/{type}/research-concepts.md...",
  "model": "sonnet",
  "apiKey": "sk-ant-...",
  "cwd": "/path/to/workspace",
  "allowedTools": ["Read", "Write", "Glob", "Grep"],
  "maxTurns": 50,
  "permissionMode": "bypassPermissions",
  "sessionId": "abc-123",
  "betas": ["interleaved-thinking"],
  "pathToClaudeCodeExecutable": "/path/to/sdk/cli.js"
}
```

Optional fields (`sessionId`, `betas`, `pathToClaudeCodeExecutable`) are omitted when not set. `sessionId` enables session resume (used by Step 4 reasoning). `pathToClaudeCodeExecutable` is auto-resolved by the Rust backend to the bundled SDK cli.js.

### Model selection

The app has a **global user preference** in Settings (Sonnet 4.5, Haiku 4.5, or Opus 4.6) that applies to all agent steps. This differs from the plugin, which uses per-agent model tiers defined in agent frontmatter. The Rust backend passes the user's selected model to every sidecar invocation.

## Workflow (9 steps)

0. **Research Concepts** -- research agent writes `clarifications-concepts.md`
1. **Concepts Review** -- user answers questions via form UI
2. **Research Patterns + Data + Merge** -- single orchestrator (spawns sub-agents internally)
3. **Human Review** -- user answers merged questions via form UI
4. **Reasoning** -- multi-turn conversation, produces `decisions.md`
5. **Build** -- creates SKILL.md + reference files
6. **Validate** -- checks against best practices
7. **Test** -- generates and evaluates test prompts
8. **Refine Skill** -- interactive chat to review, iterate, and polish the skill

## Directory Layout

**Workspace** (`~/.vibedata/` by default, configurable in Settings):
- `agents/`, `references/` — bundled from repo at startup
- `<skill-name>/context/` — intermediate working files (clarifications, decisions, validation logs)
- `<skill-name>/logs/` — agent execution logs (JSONL)

**Skill output** (configurable `skills_path` in Settings, falls back to workspace):
- `<skill-name>/SKILL.md` — final skill entry point
- `<skill-name>/references/` — deep-dive reference files
- `<skill-name>/<skill-name>.skill` — packaged zip

**App database** (`~/.local/share/com.skillbuilder.app/skill-builder.db`):
- Workflow runs, steps, artifacts, agent runs, chat sessions, settings, tags, imported skills
- DB is the source of truth for skill metadata; filesystem is secondary

The plugin uses the same skill output layout (`SKILL.md` + `references/`) but writes everything to the user's CWD with no separate workspace.

## Testing

### Mocking Tauri APIs

**Unit tests (Vitest):** `@tauri-apps/api/core` is globally mocked in `src/test/setup.ts`. Use `mockInvoke` from `src/test/mocks/tauri.ts` to configure return values per command.

**E2E tests (Playwright):** Vite aliases replace `@tauri-apps/api/core`, `@tauri-apps/api/event`, and `@tauri-apps/api/window` with mocks in `src/test/mocks/tauri-e2e*.ts` when `TAURI_E2E=true`. Override specific commands via `window.__TAURI_MOCK_OVERRIDES__` in tests. Agent lifecycle events can be simulated using the helpers in `e2e/helpers/agent-simulator.ts`.

### When to write tests

1. **New state logic** (store actions, derived state) -> store unit tests
2. **New Rust command** with testable logic -> `#[cfg(test)]` tests
3. **New UI interaction** (button states, form validation) -> component test
4. **New page or major flow** -> E2E test (happy path)
5. **Bug fix** -> regression test

Purely cosmetic changes or simple wiring don't require tests. If unclear, ask the user.

### Choosing which tests to run

Before committing, consult `app/tests/TEST_MANIFEST.md` to determine which tests cover the files you changed. The manifest maps every source file to its unit tests, integration tests, and E2E tags.

**Quick rules:**
- Changed a store? → `./tests/run.sh unit` + E2E tag from manifest
- Changed a component? → `./tests/run.sh integration` + E2E tag from manifest
- Changed a Rust command? → `cargo test` + E2E tag if UI-facing
- Changed `src/lib/tauri.ts` or test mocks? → `./tests/run.sh` (all levels)
- Unsure? → `./tests/run.sh` runs everything

**E2E tags:** `@dashboard`, `@settings`, `@workflow`, `@workflow-agent`, `@navigation`

