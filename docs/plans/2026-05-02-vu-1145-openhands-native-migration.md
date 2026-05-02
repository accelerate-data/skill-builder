# VU-1145 OpenHands Native Migration Legacy Plan

This file is retained as a compatibility pointer for older references.

The active VU-1145 implementation plan is
`docs/plans/2026-05-02-openhands-native-migration.md`.

Do not execute the older plan text that previously lived here. It predated the
current clean-break decisions:

- one OpenHands agent, `skill-creator`;
- task-specific behavior from app-rendered prompt templates;
- workspace artifacts under `agent-sources/workspace/**`;
- app-owned prompts under `agent-sources/prompts/**`;
- OpenHands conversation events and terminal conversation state used end to
  end instead of Claude-compatible display/run-result mappings.
