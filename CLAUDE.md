# Skill Builder — Developer Guide

This project supports **two frontends** for the same skill-building workflow:

1. **Claude Code Plugin** (`main` branch) - Production
2. **Desktop App** (`feature/desktop-ui` branch) - In development

## Quick Navigation

- **Working on the plugin?** → Read [`CLAUDE-PLUGIN.md`](CLAUDE-PLUGIN.md)
- **Working on the desktop app?** → Read [`CLAUDE-APP.md`](CLAUDE-APP.md)
- **New to the project?** → Keep reading this overview

## What is Skill Builder?

A multi-agent workflow for creating domain-specific Claude skills. Skills are domain knowledge packages that help data/analytics engineers build silver and gold layer models with proper functional context.

## Shared Components

Both frontends share the same core workflow logic and agent prompts (`agents/*.md`). No conversion needed — prompts work identically in both.

## Different Components

### Plugin (CLI)
- Location: Root directory
- Entry: `skills/start/SKILL.md`
- State: File-based (`workflow-state.md`)

### Desktop App (GUI)
- Location: `app/` directory
- Tech: Tauri 2 + React 19
- State: SQLite database

## Development

**Plugin**: See [`CLAUDE-PLUGIN.md`](CLAUDE-PLUGIN.md)  
**Desktop App**: See [`CLAUDE-APP.md`](CLAUDE-APP.md)

## Branch Strategy

- `main` - Plugin (production)
- `feature/desktop-ui` - Desktop app (in development)

Merge `main` → `feature/desktop-ui` periodically to sync agent prompt updates.
