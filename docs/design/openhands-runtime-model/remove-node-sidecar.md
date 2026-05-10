# Remove Node Sidecar And Rename Runtime Surfaces

> **Status:** Proposed
> **Functional specs:** Not applicable; this is an internal runtime and packaging cleanup.

## Overview

Skill Builder no longer executes agents through the legacy Node sidecar package
under `app/sidecar/`. The real runtime path is the Rust-managed OpenHands Agent
Server plus frontend display/event consumers. Keeping `app/sidecar/` in the repo
now creates three kinds of confusion:

1. packaging and CI still imply a shipped Node runtime that no longer exists
2. TypeScript contract files appear to be sidecar-owned even when Rust already
   owns the event contract
3. Rust modules and comments still say `sidecar`, which obscures the actual
   OpenHands runtime boundary

This change removes the `app/sidecar/` package entirely and renames the
remaining runtime surfaces so the codebase describes the current architecture
accurately.

## Scope

**Covers**

- deleting `app/sidecar/` and all install, bundle, CI, release, and worktree
  references to it
- making frontend TypeScript contract ownership explicit without any dependency
  on `app/sidecar/`
- renaming Rust modules, types, functions, tests, docs, and repo metadata away
  from `sidecar` where they now represent the OpenHands runtime
- preserving product behavior while simplifying packaging and architecture
  language

**Does not cover**

- changing user-facing workflow/refine/eval behavior
- redesigning the OpenHands Agent Server protocol
- changing the persisted event payload schema beyond naming/documentation cleanup

## Key Decisions

| Decision | Rationale |
|---|---|
| Delete `app/sidecar/` completely. | The package is no longer the runtime, so keeping it preserves dead packaging and false architecture signals. |
| Keep `AgentEvent` Rust-owned and generated only to frontend paths. | `app/src-tauri/src/bin/codegen.rs` already exports the event contract; the sidecar copy is redundant. |
| Make `app/src/lib/display-types.ts` the canonical `DisplayItem` definition for now. | `DisplayItem` is a frontend rendering model, not a Node runtime boundary. It should live where it is consumed. |
| Rename Rust `sidecar` modules/types/functions to runtime-oriented names in the same PR. | Removing the folder without renaming leaves the central confusion in place. |
| Update docs, repo-map, TEST_MAP, AGENTS, scripts, and workflows in the same PR. | Structural cleanup is incomplete if build/test/docs metadata still tell the old story. |

## Ownership Model After Cleanup

```text
Rust contracts
  -> codegen
  -> app/src/generated/contracts.ts
  -> app/src/lib/agent-events.ts

Frontend-owned render types
  -> app/src/lib/display-types.ts

Rust OpenHands runtime
  -> app/src-tauri/src/agents/<runtime module>
  -> app/src-tauri/src/commands/<runtime callers>
```

## Rename Direction

The cleanup should favor names that describe the real role of the code:

- `app/src-tauri/src/agents/sidecar.rs`
  -> `app/src-tauri/src/agents/runtime_config.rs` or equivalent runtime-focused
     module name
- `SidecarConfig`
  -> `OpenHandsRuntimeConfig`
- `handle_sidecar_message`
  -> `handle_runtime_message`
- `handle_sidecar_exit_with_detail`
  -> `handle_runtime_exit_with_detail`
- `sidecar_lifecycle.rs`
  -> `runtime_lifecycle.rs` only if the file name still reflects runtime
     shutdown semantics after the cleanup

Names should be chosen for semantic accuracy, not for mechanical one-to-one
replacement of the word `sidecar`.

## Risks

1. build and release scripts currently assume `sidecar/dist` exists
2. sync tests currently compare frontend files against `app/sidecar/*`
3. Rust command modules and OpenHands server helpers import `crate::agents::sidecar`
4. docs and fixtures still embed historical `sidecar` strings that may need
   selective preservation versus cleanup

## Verification Strategy

- frontend unit and integration tests still pass after the canonical TS type
  ownership moves
- Rust tests still pass after module/type/function renames
- codegen still emits frontend contracts without any `app/sidecar` output path
- release-stage verification reflects the new packaged resources
- repo-map and TEST_MAP audits pass with no stale `app/sidecar` assumptions
