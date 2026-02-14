# Skill Builder

Codex repo instructions for developing Skill Builder. This repo still contains Claude-specific runtime components, but day-to-day coding guidance should come from this file when using Codex.

## Project Scope

Multi-agent workflow for creating domain-specific skills. Two frontends share the same prompt assets:
- Claude Code plugin (CLI)
- Tauri desktop app (GUI)

Shared assets:
- `agents/{type}/` and `agents/shared/`
- `references/shared-context.md`

## Workflow (9 steps)

0. Research Concepts -> `clarifications-concepts.md`
1. Concepts Review (human)
2. Research Patterns + Data + Merge
3. Human Review (merged questions)
4. Reasoning -> `decisions.md`
5. Build -> `SKILL.md` + references
6. Validate
7. Test
8. Refine Skill

## Model Tiers (source of truth in prompts/config)

| Role | Model |
|---|---|
| Research (steps 0, 2) | sonnet |
| Merge (step 2) | haiku |
| Reasoning (step 4) | opus |
| Build/Validate/Test (steps 5-7) | sonnet |

Desktop app can override with a global model preference in Settings.

## Dev Commands

```bash
# Desktop app
cd app && npm install && npm run sidecar:build
npm run dev

# App tests
./tests/run.sh
./tests/run.sh unit
./tests/run.sh integration
./tests/run.sh e2e
./tests/run.sh e2e --tag @workflow
npm run test:unit
npm run test:integration
npm run test:e2e
cd src-tauri && cargo test

# Plugin
./scripts/validate.sh
./scripts/test-plugin.sh
claude --plugin-dir .
```

## Desktop App Notes

- Architecture: React -> Tauri IPC -> Rust backend -> Node sidecar (`@anthropic-ai/claude-agent-sdk`).
- Runtime requirement: Node.js `18-24` (Node 25+ is unsupported for sidecar SDK stability).
- Sidecar logs are written per step to `{workspace}/{skill-name}/logs/*.jsonl` with redacted config on first line.
- App workspace defaults to `~/.vibedata/`; DB is at `~/.local/share/com.skillbuilder.app/skill-builder.db`.
- DB is the source of truth for metadata; filesystem artifacts are secondary.
- Before committing app/backend changes, verify:
  - `cd app && npx tsc --noEmit`
  - `cargo check --manifest-path app/src-tauri/Cargo.toml`

## Plugin Notes

- Entry point is `skills/start/SKILL.md` via `/skill-builder:start`.
- Plugin metadata/layout lives in `.claude-plugin/` and `.claude/`.
- Agent prompts are in `agents/`; coordinator orchestrates them via `Task(...)`.
- `references/shared-context.md` is read by all agents and is high-impact.
- Plugin install caching means file references must stay within plugin dir or user CWD.
- Automated structural checks run via `.claude/settings.json` hook and `./scripts/validate.sh`.

## Testing Rules

- Read existing tests for files you modify before adding new tests.
- Add tests for new behavior and regressions; remove obsolete tests.
- Do not add tests just to increase count.
- Keep `app/tests/TEST_MANIFEST.md` in sync when test mappings/counts change.

Quick routing:
- Store changes -> `./tests/run.sh unit` + mapped E2E tag
- Component changes -> `./tests/run.sh integration` + mapped E2E tag
- Rust command changes -> `cargo test` (+ E2E tag if UI-facing)
- Shared bridge/mocks changes -> `./tests/run.sh`
- Agent/coordinator/plugin manifest changes -> `./scripts/test-plugin.sh` appropriate tiers
- Tauri unit-test command mocking -> `app/src/test/mocks/tauri.ts`
- Tauri E2E mocking/overrides -> `app/src/test/mocks/tauri-e2e*.ts`, `window.__TAURI_MOCK_OVERRIDES__`

## Code Style

- Make granular commits (one concern per commit).
- Run relevant tests before commit.
- TypeScript strict mode; avoid `any`.

## Gotchas

- Claude Agent SDK has no team tools (`TeamCreate`, `TaskCreate`, `SendMessage`); use `Task`.
- Parallel worktrees: set `DEV_PORT=<port>` to avoid conflicts.

## Skills

Use these repo-local skills when requests match:

- `.claude/skills/create-linear-issue/SKILL.md`
  - Trigger: create/log/file Linear issue, bug, feature, ticket decomposition.
- `.claude/skills/implement-linear-issue/SKILL.md`
  - Trigger: implement/fix/work on Linear issue IDs like `VD-123`.
- `.claude/skills/close-linear-issue/SKILL.md`
  - Trigger: close/complete/ship/merge a Linear issue.
- `.claude/skills/tauri/SKILL.md`
  - Trigger: Tauri-specific implementation or debugging tasks.
- `.claude/skills/shadcn-ui/SKILL.md`
  - Trigger: shadcn/ui component work.

## Reference Docs

- `CLAUDE.md` (legacy Claude-focused dev guide)
- `CLAUDE-APP.md` (desktop app deep dive)
- `CLAUDE-PLUGIN.md` (plugin deep dive)
