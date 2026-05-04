# Skill Builder

Skill Builder is a desktop app for turning domain expertise into reusable AI skills. It guides a product or domain owner through research, clarification, decision confirmation, skill generation, review, and refinement so the resulting `SKILL.md` and supporting references are useful in Claude Code-compatible workflows.

The app is designed for teams that need skills to carry business context, data-model vocabulary, operating rules, and implementation guidance into agent-assisted work. Generated skills are stored as local files, versioned with git, and can be reviewed or updated after the initial workflow completes.

## What It Helps You Do

- Research a skill topic and turn broad intent into concrete scope.
- Collect and review clarification answers before generation.
- Detect gaps or contradictory answers before those assumptions become skill instructions.
- Generate a skill package with `SKILL.md` and supporting reference files.
- Refine existing skills through the review and update surfaces.
- Run deterministic local tests and optional live eval smoke checks for the agent harness.

## Product Flow

1. **Research** surveys the domain and produces clarification questions.
2. **Detailed Research** deepens the unresolved areas and adds follow-up questions.
3. **Confirm Decisions** converts answers into a final decision set.
4. **Generate Skill** writes the skill package into the configured skills folder.
5. **Review and Refine** lets you inspect, update, benchmark, and improve the generated skill.

Skill files are written under the skills folder configured in Settings. The canonical layout is:

```text
{skills_path}/{plugin_slug}/{skill_name}/SKILL.md
```

The app also keeps a separate workspace under the application data directory for transcripts, intermediate artifacts, eval state, and other runtime files.

## Quick Start

Requires Node.js 18+, a Rust toolchain, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
cd app
npm install
npm run dev
```

Configure your Anthropic API key in Settings before running live workflows.

For UI development without API calls:

```bash
cd app
MOCK_AGENTS=true npm run dev
```

Mock mode returns fixed responses for refine operations without contacting an LLM provider.

## Development

Skill Builder is a Tauri desktop app:

- `app/src/` contains the React frontend.
- `app/src-tauri/` contains the Rust backend and SQLite persistence.
- `app/sidecar/` contains the Node.js agent runtime boundary.
- `agent-sources/` contains bundled agents, plugins, skills, and workspace instructions.
- `tests/evals/` contains the Promptfoo/OpenCode eval harness.

Common checks:

```bash
cd app && npm run test:unit
cd app && npm run test:agents:structural
cd tests/evals && npm test
cargo test --manifest-path app/src-tauri/Cargo.toml
```

Live eval smoke tests make model calls and should be run intentionally:

```bash
cd tests/evals && npm run eval:harness-smoke
```

## Contributor Docs

- Start with [`AGENTS.md`](AGENTS.md) for repository conventions, testing policy, and worktree setup.
- See [`repo-map.json`](repo-map.json) for the current code map and command reference.
- See [`TEST_MAP.md`](TEST_MAP.md) for test-selection guidance.
- See [`docs/design/`](docs/design/) for design notes and architecture details.

## License

See [LICENSE](LICENSE) for details.
