export const openHandsMessageEventRecord = {
  type: "conversation_event",
  runtime: "openhands",
  conversation_id: "conv-fixture",
  event_class: "MessageEvent",
  timestamp: 1_778_000_001,
  event: {
    source: "assistant",
    llm_message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I will inspect the current workflow files.",
        },
      ],
    },
  },
};

export const openHandsActionEventRecord = {
  type: "conversation_event",
  runtime: "openhands",
  conversation_id: "conv-fixture",
  event_class: "ActionEvent",
  timestamp: 1_778_000_002,
  event: {
    source: "agent",
    llm_response_id: "resp-single",
    tool_call_id: "call-single",
    reasoning_content: "Need the helper source before editing.",
    thinking_blocks: [
      {
        type: "thinking",
        thinking: "Use a focused read before patching.",
      },
    ],
    tool_call: {
      id: "call-single",
      type: "function",
      function: {
        name: "read_file",
        arguments: {
          path: "app/src/lib/openhands-conversation-events.ts",
        },
      },
    },
  },
};

export const openHandsParallelActionEventRecords = [
  {
    type: "conversation_event",
    runtime: "openhands",
    conversation_id: "conv-fixture",
    event_class: "ActionEvent",
    timestamp: 1_778_000_003,
    event: {
      source: "agent",
      llm_response_id: "resp-parallel",
      tool_call_id: "call-list",
      reasoning_content: "Fetch the source and tests in parallel.",
      tool_call: {
        id: "call-list",
        type: "function",
        function: {
          name: "list_files",
          arguments: '{"path":"app/src/lib"}',
        },
      },
    },
  },
  {
    type: "conversation_event",
    runtime: "openhands",
    conversation_id: "conv-fixture",
    event_class: "ActionEvent",
    timestamp: 1_778_000_004,
    event: {
      source: "agent",
      llm_response_id: "resp-parallel",
      tool_call_id: "call-read-tests",
      tool_call: {
        id: "call-read-tests",
        type: "function",
        function: {
          name: "read_file",
          arguments: {
            path: "app/src/__tests__/components/event-display/event-display-timeline.test.tsx",
          },
        },
      },
    },
  },
];

export const openHandsObservationEventRecord = {
  type: "conversation_event",
  runtime: "openhands",
  conversation_id: "conv-fixture",
  event_class: "ObservationEvent",
  timestamp: 1_778_000_005,
  event: {
    source: "environment",
    tool_call_id: "call-single",
    observation: {
      content: "Read 140 lines from the helper.",
    },
  },
};

export const openHandsUserRejectObservationRecord = {
  type: "conversation_event",
  runtime: "openhands",
  conversation_id: "conv-fixture",
  event_class: "UserRejectObservation",
  timestamp: 1_778_000_006,
  event: {
    source: "user",
    tool_call_id: "call-edit",
    observation: {
      message: "User rejected the proposed file edit.",
    },
  },
};

export const openHandsAgentErrorEventRecord = {
  type: "conversation_event",
  runtime: "openhands",
  conversation_id: "conv-fixture",
  event_class: "AgentErrorEvent",
  timestamp: 1_778_000_007,
  event: {
    tool_call_id: "call-single",
    error: {
      message: "Tool execution failed.",
      detail: "File not found.",
    },
  },
};

export const openHandsConversationErrorEventRecord = {
  type: "conversation_event",
  runtime: "openhands",
  conversation_id: "conv-fixture",
  event_class: "ConversationErrorEvent",
  timestamp: 1_778_000_008,
  event: {
    error_detail: {
      message: "Conversation stopped after runtime error.",
    },
  },
};

export const openHandsSystemPromptEventRecord = {
  type: "conversation_event",
  runtime: "openhands",
  conversation_id: "conv-fixture",
  event_class: "SystemPromptEvent",
  timestamp: 1_778_000_009,
  event: {
    prompt: "You are a coding agent.",
  },
};

export const openHandsCondensationSummaryEventRecord = {
  type: "conversation_event",
  runtime: "openhands",
  conversation_id: "conv-fixture",
  event_class: "CondensationSummaryEvent",
  timestamp: 1_778_000_010,
  event: {
    summary: "The conversation was condensed after reading helper files.",
  },
};

export const openHandsCondensationStartEventRecord = {
  type: "conversation_event",
  runtime: "openhands",
  conversation_id: "conv-fixture",
  event_class: "CondensationStartEvent",
  timestamp: 1_778_000_014,
  event: {
    reason: "Token budget exceeded.",
  },
};

export const openHandsConversationStateUpdateEventRecord = {
  type: "conversation_event",
  runtime: "openhands",
  conversation_id: "conv-fixture",
  event_class: "ConversationStateUpdateEvent",
  timestamp: 1_778_000_011,
  event: {
    state: {
      phase: "running",
      iteration: 2,
    },
  },
};

export const openHandsPauseEventRecord = {
  type: "conversation_event",
  runtime: "openhands",
  conversation_id: "conv-fixture",
  event_class: "PauseEvent",
  timestamp: 1_778_000_012,
  event: {
    source: "user",
    reason: "Waiting for user input.",
  },
};

export const openHandsUnknownEventRecord = {
  type: "conversation_event",
  runtime: "openhands",
  conversation_id: "conv-fixture",
  event_class: "CustomSdkEvent",
  timestamp: 1_778_000_013,
  event: {
    nested: {
      value: "Preserve unknown payloads.",
    },
  },
};

export const openHandsRawPayloadEventRecord = {
  type: "conversation_event",
  runtime: "openhands",
  conversation_id: "conv-fixture",
  event_class: "RawFallbackEvent",
  timestamp: 1_778_000_015,
  event: "SDK event string fallback.",
};

export const openHandsConversationEventRecords = [
  openHandsMessageEventRecord,
  openHandsActionEventRecord,
  ...openHandsParallelActionEventRecords,
  openHandsObservationEventRecord,
  openHandsUserRejectObservationRecord,
  openHandsAgentErrorEventRecord,
  openHandsConversationErrorEventRecord,
  openHandsSystemPromptEventRecord,
  openHandsCondensationStartEventRecord,
  openHandsCondensationSummaryEventRecord,
  openHandsConversationStateUpdateEventRecord,
  openHandsPauseEventRecord,
  openHandsUnknownEventRecord,
  openHandsRawPayloadEventRecord,
];
