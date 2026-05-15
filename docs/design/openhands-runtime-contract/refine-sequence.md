---
functional-specs: [custom-plugin-management]
---

# Refine Sequence

This page describes the runtime sequence for Refine after the OpenHands
runtime-contract refactor.

## Main Flow

```mermaid
sequenceDiagram
    participant U as User
    participant FE as React Refine UI
    participant CMD as Tauri Commands
    participant L3 as tracked_openhands
    participant L1 as openhands_server
    participant OHS as OpenHands Agent Server

    U->>FE: Open selected skill / workflow
    FE->>CMD: select_skill_openhands_session(skill_id)
    CMD->>L1: start_openhands_session(saved_conversation_id?)
    L1->>OHS: resume or create conversation
    OHS-->>L1: restored events + conversation_id
    L1-->>CMD: persistent session
    CMD-->>FE: hydrated session state

    U->>FE: Send first refine message
    FE->>CMD: send_refine_message(conversation_id, message)
    CMD->>L3: send_tracked_openhands_message(agent_id, conversation_id, prompt)
    L3->>L1: send_message_to_openhands_conversation(...)
    alt no live runner for conversation
        L3->>L1: run_openhands_conversation(..., PromptDelivery::AlreadySent)
        L1->>OHS: POST /events
        L1->>OHS: POST /run
        L3-->>CMD: run_started = true
        CMD-->>FE: agent_id, conversation_id, run_started=true
        FE->>FE: register run + add agent turn + set isRunning=true
    else live runner already active
        L3-->>CMD: run_started = false
        CMD-->>FE: same agent_id, conversation_id, run_started=false
        FE->>FE: append user bubble only
    end

    OHS-->>L1: WebSocket/runtime events
    L1-->>FE: normalized event stream

    alt terminal lifecycle state arrives
        FE->>FE: set isRunning=false
        FE->>FE: clear activeAgentId
    end

    U->>FE: Leave skill / workflow
    FE->>CMD: pause_openhands_session(...)
    CMD->>L3: pause_tracked_openhands_conversation(...)
    L3->>L1: pause_openhands_conversation(...)
    L1->>OHS: POST /pause
    CMD-->>FE: paused and lock released
```

## Key Rules

- Refine uses one persistent selected-skill conversation.
- The first user message for an idle conversation is `send` then `run`.
- A follow-up message during an active run is `send` only.
- Follow-up sends reuse the existing `agent_id`; they do not create a second
  local run.
- Leaving the selected skill pauses the conversation; it does not delete it.
