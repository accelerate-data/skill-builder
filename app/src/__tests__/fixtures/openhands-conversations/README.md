## OpenHands conversation projection fixtures

These fixtures were derived from real persisted OpenHands conversations under:

`~/Library/Application Support/com.vibedata.skill-builder/openhands/conversations`

They were reduced to the smallest slices that still preserve the real upstream
message shape needed by projection tests.

Fixture invariants:

- keep using real OpenHands envelope structure
- keep representative `MessageEvent`, `ActionEvent`, `ObservationEvent`,
  `ConversationStateUpdateEvent`, `SystemPromptEvent`, `PauseEvent`,
  `ConversationErrorEvent`, and `AgentErrorEvent`
- preserve the tool and state subtypes used by the semantic timeline:
  `terminal`, `file_editor`, `think`, `invoke_skill`, `task`, `finish`,
  `execution_status`, `stats`, and `last_user_message_id`
- update fixtures by deriving from real saved conversations again instead of
  inventing a synthetic alternate shape

Each JSON file includes a short note describing the semantic rows it is meant
to produce.
