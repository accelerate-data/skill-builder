# OpenHands Agent Server API Reference

Source snapshot: `openhands-agent-server==1.19.1`, inspected on 2026-05-03 for VU-1153.

## Local Server

Start the local Agent Server on an app-owned random port:

```bash
OPENHANDS_SUPPRESS_BANNER=1 \
SESSION_API_KEY=<token> \
OH_SESSION_API_KEYS_0=<token> \
OH_SECRET_KEY=<token> \
python3 -m openhands.agent_server --host 127.0.0.1 --port <port>
```

The wheel also exposes an `agent-server` console script. The docs mention an
`openhands-agent-server` executable, but the inspected package installs
`agent-server`.

## Auth

When `SESSION_API_KEY` or `OH_SESSION_API_KEYS_0` is configured:

- REST requests must include `X-Session-API-Key: <token>`.
- WebSocket clients authenticate by sending the first message as:

```json
{"type":"auth","session_api_key":"<token>"}
```

The deprecated WebSocket query/header option also exists, but the Rust client
should use first-message auth.

If no session keys are configured, the local server runs unsecured. Skill
Builder should always generate and configure an instance-scoped token so local
REST and WebSocket calls are authenticated.

## Routes

Health and server details:

- `GET /alive`
- `GET /health`
- `GET /ready`
- `GET /server_info`

Conversation API:

- `POST /api/conversations`
- `GET /api/conversations/{conversation_id}`
- `POST /api/conversations/{conversation_id}/run`
- `POST /api/conversations/{conversation_id}/pause`
- `DELETE /api/conversations/{conversation_id}`
- `GET /api/conversations/{conversation_id}/agent_final_response`
- `POST /api/conversations/{conversation_id}/switch_llm`
- `POST /api/conversations/{conversation_id}/secrets`

Event API:

- `GET /api/conversations/{conversation_id}/events`
- `GET /api/conversations/{conversation_id}/events/search`
- `GET /api/conversations/{conversation_id}/events/count`
- `POST /api/conversations/{conversation_id}/events`

WebSocket stream:

- `WS /sockets/events/{conversation_id}`
- `WS /sockets/bash-events`

## Workspace Semantics

The inspected package does not expose a separate `/workspaces` route. The
workspace is bound when the conversation is created:

```json
{
  "workspace": {
    "kind": "LocalWorkspace",
    "working_dir": "/absolute/skill/workspace"
  }
}
```

Skill Builder keeps workspace ownership in Rust. The Agent Server receives the
already-created folder path and uses it as the local workspace for tool
execution.

## One-Shot Flow

1. Rust starts or reuses the local Agent Server for the current app process.
2. Rust creates a conversation with `LocalWorkspace`, `Agent`, `LLM`, tools, and
   an `initial_message`.
3. Rust opens `WS /sockets/events/{conversation_id}` and authenticates.
4. Rust calls `POST /api/conversations/{conversation_id}/run`.
5. Rust normalizes socket events to Skill Builder `conversation_event` and
   terminal `conversation_state` messages.
6. Rust deletes the conversation after terminal state or cancellation.

## Packaging Note

In a clean target install, `openhands-agent-server==1.19.1` required
`openhands-tools==1.19.1` and `libtmux` to import route modules successfully.
Verify the final release packaging in a clean Python 3.12+ environment before
shipping the dependency bundle.

The package imports `StartConversationRequest` from
`openhands.sdk.conversation.request`; generated JSON must follow the pinned
package schema, not older docs examples.
