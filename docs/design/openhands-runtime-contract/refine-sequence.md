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
    participant UI as React Refine UI
    participant CMDQ as UI Command Lane
    participant EVTQ as UI Event Lane
    participant CMD as Tauri Commands
    participant L3 as tracked_openhands
    participant L1 as openhands_server
    participant OHS as OpenHands Agent Server

    U->>UI: Open selected skill / workflow
    UI->>CMD: select_skill_openhands_session(skill_id)
    CMD->>L1: start_openhands_session(saved_conversation_id?)
    L1->>OHS: resume or create conversation
    OHS-->>L1: restored events + conversation_id
    L1-->>CMD: persistent session
    CMD-->>UI: hydrated session state

    U->>CMDQ: Send refine message
    CMDQ->>UI: append user bubble + open logical turn
    CMDQ->>CMD: send_refine_message(conversation_id, message)
    CMD->>L3: send_tracked_openhands_message(agent_id, conversation_id, prompt)
    L3->>L1: send_message_to_openhands_conversation(...)
    alt no live runner for conversation
        L3->>L1: run_openhands_conversation(..., PromptDelivery::AlreadySent)
        L1->>OHS: POST /events
        L1->>OHS: POST /run
        L3-->>CMD: send accepted + run_started = true
        CMD-->>CMDQ: agent_id, conversation_id, run_started=true
        CMDQ->>UI: mark turn accepted + register run + set isRunning=true
    else live runner already active
        L3-->>CMD: send accepted + run_started = false
        CMD-->>CMDQ: same agent_id, conversation_id, run_started=false
        CMDQ->>UI: mark turn accepted on same live run
    end

    OHS-->>L1: WebSocket/runtime events
    L1-->>EVTQ: normalized event stream
    EVTQ->>UI: attach tool/output events to active logical turn

    alt terminal lifecycle state arrives
        EVTQ->>UI: set isRunning=false + clear activeAgentId
    end

    U->>CMDQ: Leave skill / workflow
    CMDQ->>CMD: pause_openhands_session(...)
    CMD->>L3: pause_tracked_openhands_conversation(...)
    L3->>L1: pause_openhands_conversation(...)
    L1->>OHS: POST /pause
    CMD-->>UI: paused and lock released
```

## Key Rules

- Refine uses one persistent selected-skill conversation.
- The first user message for an idle conversation is `send` then `run`.
- A follow-up message during an active run is `send` only.
- Follow-up sends reuse the existing `agent_id`; they do not create a second local run.
- Refine still creates a new logical turn for every user send, even when the same OpenHands run stays active. Later tool calls and outputs are rendered under that turn until the next user send starts the next turn boundary.
- The UI command lane owns turn creation and send acceptance state; the UI event lane owns inbound runtime events and attaches them to the current turn.
- The live event stream must not be the only source of truth for whether a user turn exists. A send that is locally accepted by the backend still belongs to a turn even if the next tool or agent event arrives later.
- Leaving the selected skill pauses the conversation; it does not delete it.
