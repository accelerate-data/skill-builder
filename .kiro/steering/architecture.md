---
inclusion: always
---

# Skill Builder Architecture

## Project Overview

A multi-agent workflow for creating Anthropic Claude skills. Available as:
- **CLI** (Claude Code plugin) - Production
- **Desktop App** (Tauri) - In development on `feature/desktop-ui` branch

## Tech Stack

### Desktop App (app/)

**Frontend:**
- React 19 + TypeScript
- Vite 7
- Tailwind CSS 4 + shadcn/ui
- Zustand (state)
- TanStack Router + Query
- React Hook Form + Zod
- react-markdown

**Backend:**
- Tauri 2
- rusqlite (SQLite)
- notify (file watching)
- pulldown-cmark (markdown parsing)
- tokio

**Agent Runtime:**
- Node.js sidecar process
- `@anthropic-ai/claude-agent-sdk`
- Streams JSON messages via stdout

## Architecture

```
Frontend (WebView) → Zustand Store → Tauri IPC
                                        ↓
Backend (Rust) → Agent Orchestrator → Node.js Sidecar
                → File System Manager    (Claude SDK)
                → SQLite (settings)
```

## Key Directories

- `app/src/` - React frontend
- `app/src-tauri/` - Rust backend
- `app/sidecar/` - Node.js agent runner
- `prompts/` - Agent prompt files (CLI)
- `agents/` - Agent prompt files (plugin)
- `references/` - Shared context files

## Runtime Dependency

Requires **Node.js 18+** for the agent sidecar. Checked on startup.
