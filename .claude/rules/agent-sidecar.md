---
paths:
  - "app/sidecar/**"
---

# Node Sidecar

Node.js + TypeScript sidecar process that runs Claude agents via
`@anthropic-ai/claude-agent-sdk`. No hot-reload — rebuild after edits:
`npm run sidecar:build`. Requires Node.js 18–24 (Node 25+ crashes the SDK).

## JSONL Protocol

Communicates with the Rust backend via stdin/stdout, one JSON object per line:

| Message | Direction | Purpose |
|---|---|---|
| `{"type":"sidecar_ready"}` | sidecar → Rust | Process started and ready |
| `{"type":"ping","id":"…"}` | Rust → sidecar | Heartbeat |
| `{"type":"pong","id":"…"}` | sidecar → Rust | Heartbeat response |
| `{"type":"agent_request","id":"…",…}` | Rust → sidecar | Run an agent |
| `{"type":"agent_response","id":"…",…}` | sidecar → Rust | Streaming agent output |
| `{"type":"agent_error","id":"…","error":"…"}` | sidecar → Rust | Agent failure |

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

## Build

```bash
npm run sidecar:build   # Compile TypeScript sidecar into `app/sidecar/dist/`
```

## Agent Logs

Per-request JSONL transcripts at `{workspace}/{skill}/logs/{step}-{timestamp}.jsonl`. First line is config with `apiKey` redacted. Debug with `tail -f <log>`.

Every agent request must produce a transcript. Response payloads stay in transcripts only — do not duplicate them in the app log.

## Testing

Sidecar unit tests: `cd app/sidecar && npx vitest run`. When changing agent invocation logic, also run `npm run test:agents:structural` from `app/`.

## Logging

Write structured log lines to stderr (not stdout — stdout is the JSONL protocol channel):

```typescript
console.error("[sidecar] agent_request: starting id=%s", id);  // significant events
```

Never write to stdout except via the JSONL protocol.

Canonical logging requirements (levels, redaction, correlation IDs) are in `.claude/rules/logging-policy.md`.
