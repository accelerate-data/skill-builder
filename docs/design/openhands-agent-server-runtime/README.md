---
functional-specs: []
---

# OpenHands Agent Server Runtime

> **Status:** Draft
> **Issue:** VU-1153
> **Functional specs:** Not applicable; this design covers the runtime integration contract rather than an end-user flow.

## Overview

Skill Builder uses an auto-managed local OpenHands Agent Server as the only
OpenHands runtime boundary. Rust starts one Agent Server process per app
instance on a random localhost port, calls the server over REST, receives live
conversation events over WebSocket, and shuts the process down with the app.

This is a clean break from the Node sidecar, the Python stdin/stdout runner, and
the PyInstaller `openhands-runner` packaging path. Rust owns Skill Builder
workspace management and passes the selected workspace directory to Agent
Server. Agent Server owns OpenHands conversation execution, SDK object
construction, server-side event streaming, and optional server-side workspace
registration when the installed package exposes that API.

Reference docs:

- OpenHands Agent Server architecture:
  <https://docs.openhands.dev/sdk/arch/agent-server>
- Local Agent Server guide:
  <https://docs.openhands.dev/sdk/guides/agent-server/local-server>
- OpenHands workspace architecture:
  <https://docs.openhands.dev/sdk/arch/workspace>

## Design Scope

**Covers**

- Local Agent Server process lifecycle owned by Rust.
- Random localhost port allocation so multiple Skill Builder app instances can
  run at the same time.
- REST/WebSocket transport replacing stdin/stdout JSONL.
- Rust-owned workspace path semantics and OpenHands workspace binding.
- Conversation request shape for one-shot workflow runs and future interactive
  sessions.
- Event normalization into Skill Builder's existing app-visible
  `conversation_event` and terminal `conversation_state` semantics.
- Test replacement strategy before deleting the old runtime path.

**Does not cover**

- Docker workspace adoption. This migration uses local folders on disk.
- Remote or hosted Agent Server deployment.
- Marketplace/import behavior outside the existing workspace deployment path.
- Product UI changes beyond preserving current workflow/refine event behavior.

## Key Decisions

| Decision | Rationale |
|---|---|
| Use OpenHands Agent Server as the process boundary. | The OpenHands docs define Agent Server as the HTTP/WebSocket execution surface. Using it avoids maintaining a custom Python stdin/stdout runner. |
| Rust owns the Agent Server process. | The Tauri backend already owns app lifecycle, settings, workspace paths, logging, cancellation, and event delivery to React. |
| Bind to `127.0.0.1:<random-free-port>` per app instance. | A fixed port blocks parallel app instances and worktrees. Random local ports make the runtime instance-scoped. |
| Delete the Node sidecar for OpenHands runtime. | The target branch is a clean break. Keeping Node as a compatibility adapter preserves the old boundary and leaves the runtime migration incomplete. |
| Rust owns durable workspace management. | Skill Builder already creates `{data_dir}/workspace`, skill-scoped workspace folders, `.agents/**` deployment, logs, and app settings. Agent Server must not choose the product workspace path. |
| Agent Server owns conversation execution. | Rust sends API requests; it does not reconstruct OpenHands SDK internals after the server boundary is adopted. |
| Prefer conversation-level local workspace binding. | The installed Agent Server API is authoritative. If it supports explicit `POST /workspaces`, Rust may register the existing folder first. If the installed API takes a `LocalWorkspace` in `StartConversationRequest`, Rust passes it there. In both cases the folder originates in Rust. |
| Preserve app-facing event semantics. | Workflow UI and artifact parsers should continue consuming `conversation_event` progress and terminal `conversation_state` results rather than learning transport-specific server details. |
| Replace tests before deletion. | Current tests intentionally assert the old Node/runner/stdout behavior. The first branch step creates Rust Agent Server contract tests so deletion has an executable target. |
| Treat local API-key auth as version-dependent. | If the installed Agent Server supports API-key auth locally, Rust generates an instance-scoped token and sends it on every REST/WebSocket call. If not, the server still binds only to loopback and Rust validates that the selected port is local-only. |

## Target Runtime Shape

```text
React UI
  -> Tauri command
    -> Rust workflow/refine/scope-review command
      -> Rust OpenHands runtime API
        -> Rust Agent Server process manager
          -> openhands-agent-server on 127.0.0.1:<random>
            -> REST: create workspace binding when supported
            -> REST: create conversation / send message / run
            -> WebSocket: stream conversation events
```

The Agent Server process is persistent for the app instance. Individual
workflow steps are conversations, not processes. A one-shot workflow run creates
a conversation, sends one rendered prompt, starts the run, streams events until
terminal state, then closes or deletes the conversation according to the server
API. A future refine session keeps the conversation open across multiple user
messages.

## Workspace Ownership

Rust is the source of truth for all Skill Builder workspace folders.

| Folder | Owner | Use |
|---|---|---|
| `{data_dir}/workspace` | Rust startup/settings | App workspace root and pre-skill validation workspace. |
| `{workspace}/{plugin_slug}/{skill_name}` | Rust skill/workflow lifecycle | Skill-scoped OpenHands `LocalWorkspace` for workflow steps. |
| `{workspace_skill_dir}/.agents/agents` | Rust deployment | OpenHands file-based agent files copied from `agent-sources/workspace/agents`. |
| `{workspace_skill_dir}/.agents/skills` | Rust deployment | OpenHands AgentSkills copied from `agent-sources/workspace/skills`. |
| `{workspace_skill_dir}/logs` | Rust runtime/logging | App transcript and diagnostic output. |

The existing path contract comes from `app/plugin-paths.json`:

```json
{
  "workspace_skill_dir": "{workspace}/{plugin_slug}/{skill_name}"
}
```

Implementation rules:

- Runtime callers pass an already-created `workspace_skill_dir`.
- Pre-skill scope review uses the initialized workspace root because no skill
  directory exists yet.
- Workflow steps use the skill-scoped workspace directory.
- Rust ensures `.agents/**` is deployed before creating the Agent Server
  conversation.
- Agent Server receives the folder as a local workspace binding. If the
  installed API supports `POST /workspaces`, Rust registers the existing folder
  and uses the returned workspace identifier. If it only supports
  conversation-level workspace objects, Rust sends `LocalWorkspace` with
  `working_dir = workspace_skill_dir`.
- Agent Server must not create, rename, delete, or relocate Skill Builder
  product workspaces.

## Server Lifecycle

Rust owns a single `OpenHandsAgentServerManager` per Tauri app instance.

Lifecycle:

1. Resolve the Agent Server executable or module from the bundled runtime.
2. Reserve or request a random free local port.
3. Generate an instance token when supported.
4. Start Agent Server with loopback host, selected port, workspace mode, and
   redacted logging.
5. Poll the health endpoint until ready or timeout.
6. Serve all OpenHands conversations for the app instance through that server.
7. On app shutdown, cancel active runs, close conversations, and terminate the
   Agent Server process.

Failure handling:

- Startup timeout surfaces as an app-visible dependency/runtime error.
- Unexpected process exit fails all active runs with terminal
  `conversation_state(status = "error")`.
- Port binding failure retries with a new random port before surfacing an
  error.
- Stderr is written to app logs after redacting API keys, model keys, and the
  optional local server token.

## API Contract

The installed Agent Server package version is authoritative for endpoint paths.
The current OpenHands docs describe REST operations for workspace and
conversation management plus WebSocket streaming. Implementation must verify the
actual OpenAPI/schema exposed by the pinned dependency before wiring production
calls.

The Rust runtime client owns the version-specific endpoint details behind a
small app-owned interface:

```rust
pub trait OpenHandsAgentServerClient {
    async fn bind_workspace(&self, working_dir: &Path) -> Result<WorkspaceBinding, RuntimeError>;
    async fn start_conversation(
        &self,
        request: StartConversationRequest,
    ) -> Result<ConversationHandle, RuntimeError>;
    async fn send_message(
        &self,
        conversation_id: &str,
        message: ConversationMessage,
    ) -> Result<(), RuntimeError>;
    async fn run_conversation(&self, conversation_id: &str) -> Result<(), RuntimeError>;
    async fn pause_conversation(&self, conversation_id: &str) -> Result<(), RuntimeError>;
    async fn close_conversation(&self, conversation_id: &str) -> Result<(), RuntimeError>;
}
```

The one-shot request includes the same semantic fields the Python runner used:

- selected LLM model, API key, optional base URL, and runtime settings;
- one `skill-creator` agent definition;
- file-based skills from the deployed `.agents/skills` directory;
- task prompt rendered by Rust from `agent-sources/prompts/**`;
- max iteration budget from the current `max_turns` field;
- workspace binding pointing at the Rust-owned folder;
- persistence/conversation tags that let logs and usage map back to the app
  run.

## Conversation Modes

### One-Shot

Used by scope review, workflow steps, answer evaluation, skill generation,
description optimization, and eval generation.

Lifecycle:

1. Rust renders the app-owned prompt.
2. Rust ensures the workspace folder and `.agents/**` are ready.
3. Rust creates or binds the Agent Server workspace.
4. Rust creates a conversation with the workspace and agent config.
5. Rust sends one user message.
6. Rust starts the run.
7. Rust reads WebSocket events and forwards app-visible progress.
8. Rust waits for terminal state.
9. Rust parses `result_text` when a typed output contract is expected.
10. Rust closes the conversation unless the call explicitly requests retention.

One-shot conversations cannot expose app-owned user-question tools.

### Interactive

Used by future OpenHands refine.

Lifecycle:

- Rust creates one conversation per refine session.
- The frontend sends additional user messages through Tauri.
- Rust forwards them to Agent Server.
- The same WebSocket event adapter streams conversation events.
- App-owned question tools are allowed only after that custom tool is
  implemented and tested.

## Event Contract

Agent Server events are normalized at the Rust runtime boundary.

| Agent Server event | Skill Builder event |
|---|---|
| Conversation created/running | `conversation_state(status = "running")` |
| SDK message/tool/action/observation event | `conversation_event` with raw payload preserved |
| Run completed | terminal `conversation_state(status = "completed", result_text = ...)` |
| Run errored | terminal `conversation_state(status = "error", error_detail = ...)` |
| Run cancelled/paused by app | terminal `conversation_state(status = "cancelled", error_detail = ...)` |

Rules:

- Preserve raw server/SDK payloads for debugging.
- Add app metadata such as `agent_id`, `run_id`, `task_kind`,
  `conversation_id`, and timestamp.
- Do not remap OpenHands events into legacy Claude `display_item` or
  `run_result` envelopes.
- Product code reads terminal results from `conversation_state`, not from
  activity events.
- Transcript files are diagnostics, not the product result source.

## Deletion Boundary

The clean-break branch removes these runtime surfaces after replacement tests
exist:

- Node sidecar process pool for OpenHands calls.
- `app/sidecar/runtime/openhands-runtime.ts`.
- `app/sidecar/openhands/runner.py` and PyInstaller build scripts.
- `path_to_openhands_runner` and bundled runner dependency validation.
- Sidecar tests whose only purpose is proving stdin/stdout runner behavior.

The branch may keep unrelated frontend mock fixtures and agent structural tests
when they still validate app-owned artifact or prompt contracts.

## Test Strategy

The first implementation step is test replacement, not runtime deletion.

Required replacement coverage:

- Agent Server process manager starts on a random local port, reports ready,
  retries port conflicts, and shuts down.
- Local auth behavior is covered for both supported and unsupported Agent Server
  versions.
- Rust client serializes the expected workspace binding and conversation
  request.
- `workspace_skill_dir` is passed as the OpenHands local workspace working
  directory for workflow steps.
- Scope review uses the initialized workspace root.
- WebSocket events normalize to `conversation_event` and terminal
  `conversation_state`.
- Workflow and scope-review commands call the Rust Agent Server runtime instead
  of the old sidecar/runner path.
- Dependency validation checks Agent Server availability, not
  `openhands_runner`.

The existing Rust workflow, scope-review, workspace deployment, and structural
agent tests remain useful. Existing Node/Python runner tests should be removed
or replaced in the same branch because they assert deleted behavior.

## Relationship To Existing Design Specs

| Spec | Relationship |
|---|---|
| `docs/design/openhands-native-migration/README.md` | Umbrella OpenHands migration design. This document supersedes its PyInstaller runner execution model. |
| `docs/design/openhands-sdk-runner/README.md` | Superseded for runtime execution. Its agent/prompt/workspace intent remains useful background where not contradicted here. |
| `docs/design/agent-runtime-boundary/README.md` | Earlier Node-sidecar boundary design. This document keeps the app-facing event semantics but moves the runtime boundary into Rust plus Agent Server. |
| `docs/design/model-settings/README.md` | Continues to define model selection projected into the OpenHands request. |

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/agents/sidecar.rs` | Current OpenHands one-shot config and runner path to replace with Agent Server runtime. |
| `app/src-tauri/src/agents/sidecar_pool/` | Current persistent Node sidecar pool to delete or stop using for OpenHands. |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Workflow runtime call sites that should route through the new Rust Agent Server API. |
| `app/src-tauri/src/commands/skill/scope_review.rs` | Scope review call site that should route through the new Rust Agent Server API. |
| `app/src-tauri/src/commands/workflow/deploy.rs` | Workspace `.agents/**` deployment path Rust must preserve before creating conversations. |
| `app/src-tauri/src/skill_paths.rs` | Canonical workspace and `.agents/**` path helpers. |
| `app/plugin-paths.json` | Source of truth for workspace skill directory layout. |
| `agent-sources/workspace/` | Source files copied into runtime `.agents/**`. |
| `agent-sources/prompts/` | App-owned task prompt templates rendered by Rust. |

## Resolved Package And API Decisions

1. `[version]` The branch pins local startup to
   `openhands-agent-server==1.19.1` through `uvx --from ... --with ... python
   -m openhands.agent_server`. The command includes
   `openhands-tools==1.19.1` and `libtmux` explicitly because the inspected
   server package imports them at startup.
2. `[api]` The inspected package does not expose `POST /workspaces`; Rust binds
   the existing local folder through `StartConversationRequest.workspace` with
   `kind: "LocalWorkspace"`.
3. `[auth]` The inspected package supports local API-key auth through
   `SESSION_API_KEY`/`OH_SESSION_API_KEYS_0`; Rust generates an instance token,
   sends `X-Session-API-Key` on REST calls, and sends the WebSocket auth message
   before starting the run.
