# Skill Builder

A multi-agent workflow for creating domain-specific Claude skills. Skills are knowledge packages that help data and analytics engineers build silver and gold layer models with proper functional context.

Available as a **Claude Code plugin** (CLI) and a **Tauri desktop app** (GUI). Both share the same agent prompts and reference material.

## Quick Start

### Plugin

**Install from marketplace:**

```bash
# Inside a Claude Code session
/install-plugin hbanerjee74/skill-builder
```

**Install from local directory:**

```bash
# Start Claude Code with the plugin loaded from a local checkout
claude --plugin-dir /path/to/skill-builder

# Then trigger the workflow
/skill-builder:generate-skill
```

**Manual testing (development):**

```bash
# From the repo root (or a worktree)
claude --plugin-dir .

# Inside the session, run:
/skill-builder:generate-skill
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

**Mock mode** -- for UI development without API calls:

```bash
cd app && MOCK_AGENTS=true npm run dev
```

This replays bundled JSONL templates with short delays, writes mock output files, and advances the workflow through all steps without hitting the Anthropic API.

## How It Works

The workflow guides you through building a skill in 7 steps:

0. **Init** -- select skill type and name, detect previous progress
1. **Research** -- opus planner selects relevant research dimensions, parallel agents research them, opus consolidation produces clarification questions. If scope is too broad, recommends narrower skills instead
2. **Review** -- you answer clarification questions (or review scope recommendation)
3. **Detailed Research** -- agents dive deeper per section, produce refinement questions
4. **Review** -- you answer a second round of questions
5. **Confirm Decisions** -- agent analyzes your answers, detects gaps and contradictions
6. **Generate Skill** -- agent creates SKILL.md and reference files
7. **Validate & Test** -- agent checks against best practices, generates and evaluates test prompts

Skills are organized by type: **domain** (business knowledge), **platform** (tool-specific), **source** (extraction patterns), and **data-engineering** (technical patterns).

Completed skills are version-controlled locally (auto-commits via git2) and can be pushed to a shared GitHub repository via branch + PR from the desktop app.

## Architecture

```
skill-builder/
├── agents/                  # 26 agent prompts (shared by both frontends)
├── agent-sources/
│   └── workspace/CLAUDE.md  # Agent instructions (app: auto-loaded; plugin: packaged as references)
├── skills/generate-skill/
│   ├── SKILL.md             # Plugin coordinator (self-contained entry point)
│   └── references/          # Agent instructions packaged by scripts/build-plugin-skill.sh
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
