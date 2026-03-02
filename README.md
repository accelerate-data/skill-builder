# Skill Builder

A multi-agent workflow for creating domain-specific Claude skills. Skills are knowledge packages that help data and analytics engineers build silver and gold layer models with proper functional context.

Available as a **Tauri desktop app** (GUI) that orchestrates agents via a Node.js sidecar.

## Quick Start

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

The workflow guides you through building a skill in 6 steps:

0. **Research** -- opus planner selects relevant research dimensions, parallel agents research them, opus consolidation produces clarification questions. If scope is too broad, recommends narrower skills instead
1. **Review** -- you answer clarification questions (or review scope recommendation)
2. **Detailed Research** -- agents dive deeper per section, produce refinement questions
3. **Review** -- you answer a second round of questions
4. **Confirm Decisions** -- agent analyzes your answers, detects gaps and contradictions
5. **Generate Skill** -- agent creates SKILL.md and reference files

After Generate completes, you can **Refine** the skill (iterative chat with `/validate` and `/rewrite` commands) or mark it **Done**.

Skills are organized by type: **domain** (business knowledge), **platform** (tool-specific), **source** (extraction patterns), and **data-engineering** (technical patterns).

Completed skills are version-controlled locally (auto-commits via git2) and can be pushed to a shared GitHub repository via branch + PR from the desktop app.

## Architecture

```text
skill-builder/
├── agents/                          # Agent prompts
├── agent-sources/
│   └── workspace/
│       ├── CLAUDE.md                # Agent instructions (auto-loaded by SDK)
│       └── skills/                  # Skill references bundled into the app
├── app/                             # Desktop application
│   ├── src/                         # React 19 + Tailwind 4 + shadcn/ui
│   ├── src-tauri/                   # Rust backend (Tauri 2 + SQLite)
│   └── sidecar/                     # Node.js agent runner (Claude Agent SDK)
└── scripts/                         # Validation and eval scripts
```

Spawns agents via a Node.js sidecar process using the Claude Agent SDK. State tracked in SQLite. Agents stream JSON messages to the Rust backend, which emits Tauri events to the React frontend.

## Testing

```bash
cd app
npm run test:unit            # Frontend unit tests (Vitest)
cargo test                   # Rust tests (from app/src-tauri/)
npm run test:e2e             # E2E tests (Playwright)
npm run test:agents:structural  # Agent structural checks (free, no API key)
```

See [`app/tests/README.md`](app/tests/README.md) for all test levels.

## Contributing

Start with [`CLAUDE.md`](CLAUDE.md) for architecture, dev commands, testing strategy, and code style.

## License

See [LICENSE](LICENSE) for details.
