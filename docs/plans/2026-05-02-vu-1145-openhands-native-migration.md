# VU-1145 OpenHands Native Migration Legacy Plan

This file is retained as a compatibility pointer for older references.

The active VU-1145 implementation plan for the clean-break Agent Server runtime
is `docs/plans/2026-05-03-openhands-agent-server-clean-break.md`.

Do not execute the older plan text that previously lived here. It predated the
current clean-break decisions:

- local OpenHands Agent Server process managed by Rust;
- REST/WebSocket transport instead of Node/stdout runner transport;
- Rust-owned workspace folders passed to Agent Server;
- one OpenHands agent, `skill-creator`;
- task-specific behavior from app-rendered prompt templates;
- workspace artifacts under `agent-sources/workspace/**`;
- app-owned prompts under `agent-sources/prompts/**`;
- OpenHands conversation events and terminal conversation state used end to
  end instead of Claude-compatible display/run-result mappings.
