@AGENTS.md

## Adapter Role

`AGENTS.md` is canonical for repository-wide guidance. This file is an adapter for Claude-specific routing and should stay lightweight.

## Plan Mode Rule                                                                                                                                                                       
NEVER make edits, run non-readonly tools, or create files while in plan mode. Only read files, search code, and edit the plan file.

## Delegation Policy

### Model tiers

| Tier | Model | When |

|---|---|---|
| Reasoning | sonnet | Planning, architecture, requirements drafting |
| Implementation | default | Coding, exploration, review, merge |
| Lightweight | haiku | Linear API calls, AC checkoffs, status updates |
