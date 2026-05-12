# Backend Design

Target architecture reference for the Tauri/Rust backend in `app/src-tauri/`.

## Overview

The backend is the product control plane for Skill Builder. It owns:

- the Tauri IPC surface exposed to the React frontend
- durable product state in SQLite
- skill lifecycle operations on disk
- selected-skill session ownership and conversation persistence
- OpenHands Agent Server orchestration for workflow and refine
- LiteLLM proxy orchestration for provider routing, budgets, and virtual keys

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
- LiteLLM provider/profile configuration

The LiteLLM proxy also owns its own separate SQLite database for spend logs and
virtual-key state. The app does not co-mingle that schema with `skill-builder.db`.

### Runtime orchestration

`app/src-tauri/src/agents/` owns runtime process management and protocol
translation:

- `agents/openhands_server/` manages the OpenHands Agent Server lifecycle and
  session primitives
- `agents/skill_creator.rs` builds OpenHands runtime config for skill-creator
  work
- `agents/litellm_proxy/` manages the LiteLLM proxy lifecycle, config
  generation, health checks, and virtual-key provisioning
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

The canonical product-level runtime contract lives in
[../openhands-runtime-model/README.md](../openhands-runtime-model/README.md).

### LiteLLM

LiteLLM is the target model-routing layer for all OpenHands traffic. The target
architecture is:

- provider credentials live in app-owned `llm_providers`
- profile selection, fallback order, budgets, and rate limits live in
  `llm_profiles` and `llm_profile_models`
- Rust generates LiteLLM `config.yaml` from those app tables
- Rust provisions one virtual key per profile through the LiteLLM admin API
- OpenHands uses the proxy URL plus a profile virtual key rather than a direct
  provider API key
- spend tracking and budget enforcement come from LiteLLM rather than the
  app-owned `agent_runs` table

The canonical LiteLLM target design lives in
[../litellm-integration/README.md](../litellm-integration/README.md) and
[../litellm-integration/budgets.md](../litellm-integration/budgets.md).

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

### Model routing

1. The backend starts and health-checks the LiteLLM proxy.
2. LiteLLM provider/profile config is loaded from app SQLite.
3. The proxy config and virtual keys are generated from that app-owned state.
4. OpenHands runtime config points at the local LiteLLM proxy.

## Documents In This Folder

- [database.md](database.md): target database topology and ownership boundaries
- [api.md](api.md): target Tauri command surface
- [agent-event-contracts.md](agent-event-contracts.md): target frontend event
  contract emitted by the backend
- [skill-metadata-ownership.md](skill-metadata-ownership.md): ownership model
  for skill metadata versus runtime/config state
- [implementation-gaps.md](implementation-gaps.md): differences between latest
  `main` and the target architecture described here
