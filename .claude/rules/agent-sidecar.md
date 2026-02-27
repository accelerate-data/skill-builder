---
paths:
  - "app/sidecar/**"
---

# Agent Sidecar

Node.js sidecar process that runs agents via `@anthropic-ai/claude-agent-sdk`. No hot-reload — restart `npm run dev` after edits.

## Key Files

| File | Purpose |
|---|---|
| `app/sidecar/agent-runner.ts` | Entry point — receives config JSON, calls SDK `query()`, streams JSON lines to stdout |
| `app/sidecar/stream-session.ts` | Async generator push pattern for multi-turn streaming conversations |
| `app/sidecar/persistent-mode.ts` | Message demultiplexer routing one-shot vs streaming requests |
| `app/sidecar/mock-agent.ts` | Mock mode — replays `mock-templates/` without API calls (`MOCK_AGENTS=true`) |
| `app/src-tauri/src/commands/agent.rs` | Rust: spawns sidecar, reads stdout, emits Tauri events |
| `app/src-tauri/src/agents/sidecar_pool.rs` | Rust: persistent sidecar lifecycle + stream methods |

## Operation Modes

**One-shot** (workflow steps): `agent_request` → SDK `query()` → `result`/`error`

**Streaming** (refine chat): `stream_start` → SDK `query({ prompt: AsyncGenerator })` → `stream_message` (repeating) → `stream_end`. SDK maintains full conversation state across turns. `turn_complete` signals each turn boundary; `session_exhausted` fires when maxTurns (400) is reached.

## Agent Logs

Per-request JSONL transcripts at `{workspace}/{skill-name}/logs/{step_label}-{timestamp}.jsonl`. First line is config with `apiKey` redacted. Debug with `tail -f <log>`.

## Testing

Sidecar unit tests: `cd app/sidecar && npx vitest run`. When changing agent invocation logic, also run `npm run test:agents:structural` from `app/`.
