# Skill Builder -- Desktop App

Tauri v2 desktop application for building Claude skills. All code lives in `app/`.

## Architecture

React 19 (WebView) → Tauri IPC → Rust backend → spawns Node.js sidecar (`@anthropic-ai/claude-agent-sdk`)

## Tech Stack

**Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS 4, shadcn/ui, Zustand, TanStack Router, react-markdown

**Backend:** Tauri 2, rusqlite, git2, reqwest, notify, pulldown-cmark, tauri-plugin-shell, tokio

**Agent Runtime:** Node.js + `@anthropic-ai/claude-agent-sdk` (sidecar process). **No hot-reload** — restart `npm run dev` after editing `app/sidecar/` files.

**Runtime Dependency:** Node.js 18-24 (checked on startup; Node 25+ causes SDK crashes)

## Agent Orchestration

Agents run via the **Claude Agent SDK** in a Node.js sidecar. Two modes:

**One-shot mode** (workflow steps): `agent_request` → SDK `query()` → `result`/`error`
**Streaming mode** (refine chat): `stream_start` → SDK `query({ prompt: AsyncGenerator })` → `stream_message` (repeating) → `stream_end`. SDK maintains full conversation state across turns. `turn_complete` signals each turn boundary; `session_exhausted` fires when maxTurns (400) is reached.

Key files:
- **Sidecar entry:** `app/sidecar/agent-runner.ts` — receives config JSON, calls SDK `query()`, streams JSON lines to stdout
- **Streaming sessions:** `app/sidecar/stream-session.ts` — async generator push pattern for multi-turn conversations
- **Persistent mode:** `app/sidecar/persistent-mode.ts` — message demultiplexer routing one-shot vs streaming
- **Rust spawner:** `app/src-tauri/src/commands/agent.rs` — spawns sidecar, reads stdout, emits Tauri events
- **Rust pool:** `app/src-tauri/src/agents/sidecar_pool.rs` — persistent sidecar lifecycle + stream methods
- **Mock mode:** `app/sidecar/mock-agent.ts` + `mock-templates/` — set `MOCK_AGENTS=true` to replay without API calls
- **Agent logs:** `{workspace}/{skill-name}/logs/{step_label}-{timestamp}.jsonl` — debug with `tail -f`

## Key Directories

Full path reference (layout diagrams, file ownership, agent prompt variables): [`docs/design/agent-specs/storage.md`](../docs/design/agent-specs/storage.md)

Summary:
- **Workspace** (`~/.vibedata/` default, configurable): agent prompts, skill context, logs
- **Skill output** (`skills_path` in Settings, default `~/skill-builder/`): SKILL.md, references, git-managed
- **App database:** Tauri `app_data_dir()` + `skill-builder.db` — **not in `~/.vibedata/`**
  - macOS: `~/Library/Application Support/com.skillbuilder.app/skill-builder.db`
  - Linux: `~/.local/share/com.skillbuilder.app/skill-builder.db`
- **GitHub integration:** `commands/github_auth.rs` (OAuth device flow), `commands/github_import.rs` (marketplace skill discovery + import), `commands/team_import.rs` (team-scoped imports), `git.rs` (local git operations)

## User Guide

Source: `docs/user-guide/` (VitePress). Deployed via `docs.yml` on push to `main`.
Route → docs URL mapping: `app/src/lib/help-urls.ts`. New docs link: import `getHelpUrl`/`getWorkflowStepUrl`, call `openUrl()` from `@tauri-apps/plugin-opener`. New page: add to `docs/user-guide/`, `docs/.vitepress/config.ts`, and `help-urls.ts`.

## Code Style

- TypeScript strict mode, no `any`
- Zustand stores: one file per store in `app/src/stores/`
- Rust commands: one module per concern in `app/src-tauri/src/commands/`
- Tailwind 4 + shadcn/ui for all UI components
- **Error colors:** Always use `text-destructive` for error text — never hardcoded `text-red-*`. The `--destructive` CSS variable is tuned for both light and dark mode readability. Use `bg-destructive` for destructive backgrounds and `text-destructive-foreground` only for text ON destructive backgrounds (e.g., inside a red button).
- Verify before committing: `cd app && npx tsc --noEmit` (frontend) + `cargo check --manifest-path app/src-tauri/Cargo.toml` (backend)

## Testing

Tauri unit mocks: `src/test/setup.ts` (global) + `mockInvoke` from `src/test/mocks/tauri.ts`.
E2E: set `TAURI_E2E=true`, mocks in `src/test/mocks/tauri-e2e*.ts`, override via `window.__TAURI_MOCK_OVERRIDES__`.

