---
functional-specs: [custom-plugin-management]
---

# Selected-Skill Conversation Sequence

This page describes the shared persistent selected-skill conversation flow and the workflow-specific extensions that run on top of it.

## Session Bootstrap Flow

```mermaid
sequenceDiagram
    participant U as User
    participant FE as UI
    participant CMD as Skill Session Commands
    participant L2 as skill_creator
    participant L1 as openhands_server
    participant OHS as OpenHands Agent Server

    U->>FE: Open selected skill / workflow
    FE->>CMD: Select skill session
    CMD->>L2: Ensure persistent skill session
    L2->>L1: Start or resume OpenHands session
    L1->>OHS: resume or create conversation
    OHS-->>L1: restored events + conversation_id
    L1-->>CMD: persistent session
    CMD-->>FE: hydrated session state + restored transcript events
```

## Workflow Step Run Flow

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Workflow UI
    participant CMD as Workflow Commands
    participant L2 as skill_creator
    participant L3 as tracked_openhands
    participant L1 as openhands_server
    participant OHS as OpenHands Agent Server

    U->>FE: Run workflow step
    FE->>CMD: Run workflow step
    Note over CMD: Pause stale workflow runs if needed
    CMD->>L2: Build workflow runtime config
    CMD->>L3: Send tracked message to conversation
    L3->>L1: Append message to conversation
    Note over L3,L1: Start a run only when the conversation has no active local runner
    L3->>L1: Start conversation run when needed
    L1->>OHS: POST /events
    L1->>OHS: POST /run
    OHS-->>L1: runtime events + terminal state
    L1-->>FE: normalized event stream
    Note over CMD: Materialize typed workflow outputs and update DB
    CMD-->>FE: step completion state
```

## Workflow Reset Flow

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Workflow UI
    participant CMD as Workflow Commands
    participant DB as SQLite
    participant L1 as openhands_server
    participant OHS as OpenHands Agent Server

    U->>FE: Reset workflow from step N
    FE->>CMD: Reset workflow from selected step
    CMD->>DB: Checkpoint skill repo and collect conversation ids
    CMD->>L1: Pause active conversation
    L1->>OHS: POST /pause
    CMD->>DB: clear typed artifacts for the reset boundary
    CMD->>DB: reset workflow step statuses
    alt active conversation exists
        CMD->>L1: Fork active conversation
        L1->>OHS: POST /fork
        OHS-->>L1: fork_conversation_id + restored events
        CMD->>L1: Delete source conversation
        L1->>OHS: DELETE /conversation
        CMD->>DB: persist fork_conversation_id binding for the skill
    else no active conversation
        Note over CMD,DB: reset completes without a fork
    end
    CMD-->>FE: workflow reset complete
```

## Key Rules

- Selected-skill persistent sessions use one canonical `conversation_id`.
- Session bootstrap is shared across workspace and workflow surfaces.
- Workflow steps send into the existing conversation and only start a run when no live runner exists.
- The selected-skill conversation remains the transcript key while workflow-specific state lives separately in `session-runtime-store` and workflow DB rows.
- Workflow reset is product-command-owned: pause active conversations, clear typed artifacts and statuses, fork when a live conversation exists, delete the source conversation after a successful fork, and then rebind the skill to the forked conversation ID.
- Transcript rendering reads from the canonical `conversation-store` timeline keyed by `conversationId`; workflow-specific completion, gate, and artifact UI is layered around that shared conversation stream.
