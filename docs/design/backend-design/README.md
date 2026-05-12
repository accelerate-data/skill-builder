# Backend Design

Target architecture reference for the Tauri/Rust backend in `app/src-tauri/`.

## Overview

The backend is the product control plane for Skill Builder. It owns:

- the Tauri IPC surface exposed to the React frontend
- durable product state in SQLite
- skill lifecycle operations on disk
- selected-skill session ownership and conversation persistence
- OpenHands Agent Server orchestration for workflow and refine
- model catalog caching and filtering for provider/model selection

This directory describes the intended backend architecture. Any places where
latest `main` is still transitional are tracked in
[implementation-gaps.md](implementation-gaps.md).

## Architecture Layers

### Product commands

`app/src-tauri/src/commands/` is the application boundary. Commands validate
frontend input, load product state, enforce leases, orchestrate storage and
runtime calls, and translate backend results into typed IPC responses.

### Persistent state

`app/src-tauri/src/db/` owns the app database and migration sequence. The app
database is the source of truth for:

- skills, plugins, tags, locks, and conversation bindings
- workflow execution state and workflow artifacts
- documents and reconciliation events
- eval scenarios and assertions
- model catalog cache and selected model settings

### Runtime orchestration

`app/src-tauri/src/agents/` owns runtime process management and protocol
translation:

- `agents/openhands_server/` manages the OpenHands Agent Server lifecycle and
  session primitives
- `agents/skill_creator.rs` builds OpenHands runtime config for skill-creator
  work
- `agents/event_router.rs` translates runtime messages into Tauri events and
  persistence writes

## Target Runtime Model

### OpenHands

OpenHands is the execution runtime for workflow steps and selected-skill refine
turns. The backend owns:

- server startup, reuse, health checks, and shutdown
- conversation bootstrap and restore
- session pause/cancel behavior
- transcript event forwarding and run-summary persistence

Persistent selected-skill sessions are skill-owned, lease-guarded, and resume
from `skill_conversations`. Throwaway workflow/eval runs use the same runtime
but do not depend on a saved persistent conversation.

The canonical runtime contract lives in
[../openhands-runtime-model/README.md](../openhands-runtime-model/README.md).

### Model Catalog

The backend owns a cached model-catalog subsystem that resolves the final
provider/model pair used for OpenHands traffic. The target architecture is:

- provider and model metadata are ingested from `models.dev`
- provider defaults are cached in `provider_catalog`
- filterable model rows are cached in `model_catalog`
- the Settings UI filters those cached rows to choose one final model
- OpenHands runtime config is built directly from the selected provider/model
  plus app-owned credentials/base-URL overrides

The canonical model-catalog design lives in
[../model-catalog/README.md](../model-catalog/README.md) and
[../model-catalog/schema.md](../model-catalog/schema.md).

## Key Data Flows

### Skill creation and workflow execution

1. The frontend creates or selects a skill through Tauri commands.
2. The backend resolves the canonical `skills.id` row and plugin ownership.
3. Workflow commands load runtime context, render prompts, and dispatch through
   OpenHands.
4. On completion, the backend persists workflow state, artifacts, and run
   telemetry.

### Selected-skill refine

1. The frontend selects a skill by canonical `skill_id`.
2. The backend acquires or verifies the skill lease.
3. The backend restores or creates the persistent OpenHands conversation bound
   to that skill.
4. Refine turns dispatch against that persistent conversation until the user
   pauses, switches, or exits.

### Model selection

1. The backend refreshes and caches provider/model metadata from `models.dev`.
2. The Settings UI reads the cached catalog and applies filters.
3. The user selects one provider/model pair.
4. OpenHands runtime config is built from that selected provider/model plus
   app-owned credentials and any base-URL override.

## Documents In This Folder

- [database.md](database.md): target database topology and ownership boundaries
- [api.md](api.md): target Tauri command surface
- [agent-event-contracts.md](agent-event-contracts.md): target frontend event
  contract emitted by the backend
- [skill-metadata-ownership.md](skill-metadata-ownership.md): ownership model
  for skill metadata versus runtime/config state
- [implementation-gaps.md](implementation-gaps.md): differences between latest
  `main` and the target architecture described here
