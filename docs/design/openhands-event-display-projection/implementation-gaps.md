# OpenHands Conversation Timeline Implementation Gaps

This document tracks the delta between the target state in [README.md](./README.md)
and the current implementation.

## Summary

The event-contract refactor is implemented.

Current code now:

- normalizes live websocket payloads in Rust into canonical OpenHands TypeScript-client-shaped events
- normalizes `/api/v1/conversation/{conversationId}/events/search` restore history in Rust into the same canonical event kinds
- sends one canonical event stream to the frontend for both live and restore paths
- renders transcript-visible versus internal event families through explicit `kind`-based handling
- pairs `ActionEvent` outcomes with `ObservationEvent` or `AgentErrorEvent`
- groups parallel tool calls by `llm_response_id`
- renders `ThinkEvent` as the canonical reasoning path
- routes `PauseEvent`, `ConversationStateUpdateEvent`, and `FinishEvent` into status-bar handling without resetting the active step on pause
- routes `ConversationErrorEvent` to runtime error handling instead of transcript rendering

## Current Gaps

No known implementation gaps remain relative to the target state in
[README.md](./README.md).

If future work changes the OpenHands TypeScript client event contract or adds
new conversation event kinds, reopen this document with the specific delta
instead of carrying forward stale completed items.
