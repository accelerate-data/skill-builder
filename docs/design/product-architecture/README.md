---
functional-specs: [custom-plugin-management]
---

# Product Architecture

> **Status:** Draft
> **Functional specs:** [custom-plugin-management](../../functional/custom-plugin-management/README.md)
> This document is the product-level architecture entrypoint for that flow.

## Overview

Skill Builder is a Tauri desktop application for creating and refining
domain-specific coding-agent skills. At the product level, it is a
workspace-centered system with three persistent responsibilities:

1. The React UI collects user intent, shows workflow state, and renders live
   agent activity.
2. The Rust backend owns product state, filesystem layout, workflow
   orchestration, and runtime lifecycle.
3. The OpenHands runtime executes agent work inside skill-scoped workspaces
   that the product prepares and manages.

For the `custom-plugin-management` flow, the core architectural unit is not an
unscoped skill directory. It is a plugin namespace with a stable slug, where
each plugin groups related skills and maps to a directory in the configured
skills repository. The product architecture therefore has to support both
plugin-level operations such as publish and skill-level operations such as
workflow, refine, eval, and export.

This page replaces the old `docs/architecture.md` deep dive. That document
described a legacy Claude SDK runtime topology that is no longer the intended
product architecture.

## Design Scope

**Covers**

- The major product layers and the boundaries between them.
- The canonical product data flow from user action to generated skill output.
- Persistent product-owned state: SQLite, workspace folders, and shipped
  artifacts.
- How current design docs fit together.

**Does not cover**

- Detailed command-by-command backend implementation.
- Low-level OpenHands runtime transport or server lifecycle details.
- Step-specific prompt contracts or artifact schemas.
- End-user workflow behavior beyond what is needed to explain architecture.

## Key Decisions

| Decision | Rationale |
|---|---|
| Product architecture is workspace-centered. | The core product promise is to turn user intent into durable skill artifacts inside managed skill workspaces, not to expose raw agent sessions. |
| Plugin namespace is a first-class product boundary. | The `custom-plugin-management` flow defines a plugin as the namespace that groups related skills under a shared slug and acts as the publish unit. Product architecture has to preserve that boundary across storage, workspace layout, and distribution. |
| Rust is the system boundary owner. | The backend already owns persistence, filesystem policy, logging, lifecycle, and UI-facing commands; keeping those concerns in one place makes the runtime replaceable. |
| OpenHands is an execution dependency, not the product boundary. | Skill Builder should depend on OpenHands for agent execution while preserving product-owned contracts for workspace preparation, event semantics, and result handling. |
| Product docs should separate levels of detail. | This entrypoint stays at product-architecture altitude and routes readers to deeper subsystem docs instead of mixing overview, module inventory, and historical runtime details in one file. |

## System Model

```text
User
  -> React desktop UI
    -> Tauri command boundary
      -> Rust product backend
        -> SQLite state + filesystem/workspace management
        -> OpenHands runtime
          -> plugin-scoped and skill-scoped workspace execution
            -> generated skill artifacts
```

The UI does not talk to OpenHands directly. The runtime does not choose product
paths or own durable product state. Rust sits between them and enforces the
contracts that make the desktop app coherent across workflow, refine, eval, and
skill-management surfaces.

## Product Layers

### 1. Experience Layer

The React frontend is responsible for product interaction:

- plugin setup and plugin-level management surfaces;
- route-level screens such as dashboard, workflow, settings, and workspace
  surfaces;
- UI state, selections, and live event rendering;
- request/response data fetched through typed backend calls;
- guiding the user through research, decisions, generation, refine, and eval
  flows.

The frontend is not the source of truth for durable workflow state. If the app
restores a run, the reconstruction comes from backend-owned state and artifacts.

Related docs:

- [openhands-runtime-contract](../openhands-runtime-contract/README.md)
- [openhands-event-display-projection](../openhands-event-display-projection/README.md)

### 2. Product Backend Layer

The Rust backend is the control plane for the desktop app. It owns:

- Tauri command handlers as the only frontend-to-system boundary;
- SQLite persistence for workflow state, usage, imported skills, and settings;
- plugin and skill path resolution, plus `.agents/**` deployment;
- orchestration of workflow runs and longer-lived conversation flows;
- normalization of runtime events into app-facing progress and terminal result
  semantics.

This is the layer that preserves product invariants when internal runtime
mechanics change.

Related docs:

- [backend-design](../backend-design/README.md)
- [workflow-artifact-storage](../workflow-artifact-storage/README.md)
- [startup-recon](../startup-recon/README.md)
- [plugin-path-restructure](../plugin-path-restructure/README.md)

### 3. Runtime Execution Layer

OpenHands is the agent execution layer. Skill Builder prepares the workspace,
selects models and task prompts, and decides when to start or stop work. The
runtime then performs the requested agent task inside that prepared workspace
and streams progress back through the backend.

In `custom-plugin-management` terms, runtime work happens inside the
plugin-managed skills repository layout chosen by the product. OpenHands does
not decide plugin slugs, publish targets, or whether an operation is skill
scoped or whole-plugin scoped.

At product level, the important architectural point is not the exact transport.
It is that runtime execution is isolated behind backend-owned contracts so the
product can evolve from one runtime mechanism to another without redefining the
entire app.

Related docs:

- [openhands-runtime-contract](../openhands-runtime-contract/README.md)

## Canonical Data Flow

### Skill creation workflow

1. The user creates or resumes work inside a named plugin with a stable slug.
2. The frontend calls Rust commands to create or load plugin and skill state.
3. Rust resolves the plugin-owned skill directory and the corresponding working
   workspace, then deploys required `.agents/**` content.
4. Rust renders the app-owned prompt for the active task.
5. Rust starts the OpenHands task for that workspace and streams runtime events
   back to the UI.
6. Rust validates and persists step outputs in SQLite or writes generated skill
   artifacts into the plugin-managed skill directory, depending on the step.
7. The UI renders updated state from backend-owned records and artifacts.

### Refine and eval flows

Refine and eval reuse the same product boundaries:

- the frontend initiates a product action;
- Rust owns lifecycle, persistence, and workspace selection;
- the runtime performs agent work;
- results return through backend-owned event and artifact contracts.

This shared shape matters because it keeps the product understandable even as
individual surfaces grow.

## Persistent State Model

Skill Builder has three durable state domains:

| Domain | Owner | Purpose |
|---|---|---|
| SQLite | Rust | Canonical product state for workflow progress, settings, usage, imported skills, and related metadata |
| App data runtime roots | Rust | App-local OpenHands persistence roots, DB-adjacent runtime files, and throwaway runtime scratch space |
| Skills tree | Rust-managed filesystem | The durable plugin-managed skill outputs and canonical skill working directories that users keep, refine, publish, export, or evaluate |

The runtime may read and write inside a prepared workspace during execution, but
product ownership of path selection, deployment shape, and post-run persistence
stays in Rust.

## Document Map

Use this page as the entrypoint, then drop to the next level only when needed:

| Need | Doc |
|---|---|
| Runtime process boundary, session model, normalized event ingress, and storage roots | [openhands-runtime-contract](../openhands-runtime-contract/README.md) |
| Backend persistence, command surface, and storage | [backend-design](../backend-design/README.md) |
| Workflow step lifecycle and runtime routing | [openhands-runtime-contract](../openhands-runtime-contract/README.md) |
| Artifact ownership and storage rules | [workflow-artifact-storage](../workflow-artifact-storage/README.md) |
| Workspace preparation, main-agent suffix wiring, and conversation storage | [openhands-runtime-contract](../openhands-runtime-contract/README.md) |
| Frontend rendering of normalized runtime events | [openhands-event-display-projection](../openhands-event-display-projection/README.md) |

## Open Questions

1. `[docs]` Keep the deeper [backend-design](../backend-design/README.md) page in
   sync with the product-level OpenHands runtime contract so the implementation
   reference does not drift again.
