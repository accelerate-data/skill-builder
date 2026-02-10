# Skill Builder — Developer Guide

This is a merged repo containing **two frontends** for the same skill-building workflow:

1. **Claude Code Plugin** — Production CLI plugin
2. **Desktop App** — Tauri 2 + React 19 GUI

Both share the same agent prompts (`agents/`) and reference material (`references/`).

## Quick Navigation

- **Working on the plugin?** → Read [`CLAUDE-PLUGIN.md`](CLAUDE-PLUGIN.md)
- **Working on the desktop app?** → Read [`CLAUDE-APP.md`](CLAUDE-APP.md)

## What is Skill Builder?

A multi-agent workflow for creating domain-specific Claude skills. Skills are domain knowledge packages that help data/analytics engineers build silver and gold layer models with proper functional context.

## Shared Components

Both frontends use the same agents and references. No conversion needed.

| Directory | Purpose |
|---|---|
| `agents/{type}/` | Type-specific agents (domain, platform, source, data-engineering) — 6 per type |
| `agents/shared/` | Shared agents (merge, research-patterns, research-data) — used by all types |
| `references/shared-context.md` | Domain definitions, file formats, content principles |

### Agent Files

Each skill type directory (`domain/`, `platform/`, `source/`, `data-engineering/`) contains these 6 agents:

| File | Role |
|---|---|
| `research-concepts.md` | Orchestrator: spawns entity + metrics researchers, merges results |
| `research-patterns-and-merge.md` | Orchestrator: spawns patterns + data researchers + merger |
| `reasoning.md` | Gap analysis, contradiction detection, decisions |
| `build.md` | Skill file creation (spawns reference writers) |
| `validate.md` | Best practices validation (spawns parallel validators) |
| `test.md` | Test generation + evaluation (spawns parallel testers) |

Shared agents in `agents/shared/`:

| File | Role |
|---|---|
| `research-patterns.md` | Sub-agent: business patterns research |
| `research-data.md` | Sub-agent: data modeling research |
| `merge.md` | Sub-agent: question deduplication |

## Platform Differences

### Plugin (CLI)
- Location: Root directory (`skills/start/SKILL.md`)
- Workflow: 10 steps (init, research, Q&A, parallel research, merge, Q&A, reasoning, build, validate, test, package)
- State: File-based (`workflow-state.md`)
- Model selection: Per-agent (defined in coordinator)
- Orchestration: Agent teams (TeamCreate/SendMessage/TeamDelete)

### Desktop App (GUI)
- Location: `app/` directory
- Workflow: **9 steps** (0-8). Step 2 combines parallel research + merge into one orchestrator agent
- State: SQLite database
- Model selection: **Global user preference** in Settings (one model for all agents)
- Orchestration: Node.js sidecar via Claude Agent SDK

### Workflow Comparison

| App Step | Plugin Equivalent | What Happens |
|---|---|---|
| 0 | Step 1 | Research domain concepts (orchestrator) |
| 1 | Step 2 | Human reviews concept questions |
| 2 | Steps 3+4 | Research patterns + data + merge (single orchestrator) |
| 3 | Step 5 | Human reviews merged questions |
| 4 | Step 6 | Reasoning agent analyzes answers |
| 5 | Step 7 | Build agent creates skill files |
| 6 | Step 8 | Validate agent checks best practices |
| 7 | Step 9 | Test agent generates + evaluates tests |
| 8 | Step 10 | Package into .skill zip |

The plugin has a separate Init step (Step 0) where the user names the skill. In the app, this happens in the new-skill dialog before the workflow starts.

## Development

**Plugin**: See [`CLAUDE-PLUGIN.md`](CLAUDE-PLUGIN.md)
**Desktop App**: See [`CLAUDE-APP.md`](CLAUDE-APP.md)
