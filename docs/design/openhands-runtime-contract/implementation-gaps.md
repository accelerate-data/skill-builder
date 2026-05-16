# OpenHands Conversation Model Implementation Status

The OpenHands conversation-model migration is complete.

## Final State

- `conversation-store` is the only transcript authority, keyed by `conversationId`.
- `session-runtime-store` owns live runtime lifecycle metadata for the selected session without transcript state.
- `use-session-runtime-stream.ts` bridges transport events into canonical conversation events plus typed runtime lifecycle state.
- Workspace and Workflow both render canonical conversation activity through `ConversationTimeline`.
- Legacy transcript authority seams and migration-era transcript helpers have been removed.

## Remaining Work

No known implementation gaps remain for the shared conversation/runtime contract described in [openhands-conversation-model.md](./openhands-conversation-model.md).
