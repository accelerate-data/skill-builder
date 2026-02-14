# Skill Builder

A multi-agent workflow for creating domain-specific Claude skills. Skills are knowledge packages that help data and analytics engineers build silver and gold layer models with proper functional context.

Available as a **Claude Code plugin** (CLI) and a **Tauri desktop app** (GUI). Both share the same agent prompts and reference material.

## Quick Start

### Plugin

```bash
# Install from marketplace
/plugin marketplace add hbanerjee74/skill-builder
/plugin install skill-builder@skill-builder-marketplace

# Or load from local directory
claude --plugin-dir /path/to/skill-builder

# Run the workflow
/skill-builder:start
```

### Desktop App

Requires: Node.js 18-24, Rust toolchain, [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
cd app
npm install
npm run sidecar:build   # Bundle the Node.js agent runner
npm run dev             # Start in dev mode
```

Configure your Anthropic API key and workspace folder in Settings before running workflows.

## How It Works

The workflow guides you through building a skill in 9 steps:

0. **Init** -- select skill type and name, detect previous progress
1. **Research concepts** -- agents identify key entities, metrics, and KPIs
2. **Review concept questions** -- you answer clarification questions
3. **Research patterns + data + merge** -- agents research business patterns and data models
4. **Review merged questions** -- you answer a consolidated set of questions
5. **Reasoning** -- agent analyzes your answers, detects gaps and contradictions
6. **Build** -- agent creates SKILL.md and reference files
7. **Validate & Test** -- agent checks against best practices, generates and evaluates test prompts
8. **Package / Refine** -- zip for distribution (plugin) or iterative improvement via chat (app)

Skills are organized by type: **domain** (business knowledge), **platform** (tool-specific), **source** (extraction patterns), and **data-engineering** (technical patterns).

## Architecture

```
skill-builder/
├── agents/                  # Agent prompts (shared by both frontends)
│   ├── {type}/              # 5 agents per skill type (4 types = 20 generated)
│   ├── templates/           # 5 phase templates (source of truth)
│   ├── types/               # 4 type configs (focus, examples)
│   └── shared/              # 3 shared sub-agents
├── references/              # Shared context for agents
├── skills/start/SKILL.md    # Plugin coordinator (entry point)
├── app/                     # Desktop application
│   ├── src/                 # React 19 + Tailwind 4 + shadcn/ui
│   ├── src-tauri/           # Rust backend (Tauri 2 + SQLite)
│   └── sidecar/             # Node.js agent runner (Claude Agent SDK)
└── scripts/                 # Plugin validation and test harness
```

**Plugin**: Uses Claude Code's native agent teams for orchestration. State tracked in `workflow-state.md`.

**Desktop App**: Spawns agents via a Node.js sidecar process using the Claude Agent SDK. State tracked in SQLite. Agents stream JSON messages to the Rust backend, which emits Tauri events to the React frontend.

## Testing

```bash
# Desktop app
cd app
npm test                     # Frontend unit tests (Vitest)
cd src-tauri && cargo test   # Rust tests
npm run test:e2e             # E2E tests (Playwright)

# Plugin
./scripts/validate.sh        # Structural validation
./scripts/test-plugin.sh     # Full test harness (T1-T5)
```

## Contributing

This project supports Codex and Claude-based AI-assisted development. For Codex sessions, start with [`AGENTS.md`](AGENTS.md). Legacy Claude-focused guidance remains in [`CLAUDE.md`](CLAUDE.md). Platform-specific guides:

- [`CLAUDE-APP.md`](CLAUDE-APP.md) -- desktop app development
- [`CLAUDE-PLUGIN.md`](CLAUDE-PLUGIN.md) -- plugin development

## License

See [LICENSE](LICENSE) for details.
