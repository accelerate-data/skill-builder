export type ConversationEventStatus =
  | "sending"
  | "accepted"
  | "failed"
  | "observed";

export type ConversationEventOrigin = "frontend" | "backend";

export type ConversationDisplayKind =
  | "user_message"
  | "agent_message"
  | "tool_call"
  | "tool_result"
  | "subagent"
  | "state"
  | "error"
  | "system";

export type EventID = string;
export type EventSource = "agent" | "user" | "environment" | "system" | "hook";

export interface Message {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

export type MessageContent = unknown;

export interface BaseOpenHandsEvent {
  id: EventID;
  kind: string;
  timestamp: string;
  source?: EventSource;
}

export interface MessageEvent extends BaseOpenHandsEvent {
  kind: "MessageEvent";
  llm_message: Message;
  activated_skills?: string[];
  sender?: string;
}

export interface ActionEvent extends BaseOpenHandsEvent {
  kind: "ActionEvent";
  tool_name: string;
  tool_call_id: string;
  action: Record<string, unknown>;
  thought?: string;
  llm_response_id?: string;
}

export interface ObservationEvent extends BaseOpenHandsEvent {
  kind: "ObservationEvent";
  tool_name: string;
  tool_call_id: string;
  observation: unknown;
  action_id: string;
}

export interface AgentErrorEvent extends BaseOpenHandsEvent {
  kind: "AgentErrorEvent";
  tool_name: string;
  tool_call_id: string;
  error: string;
}

export interface SystemPromptEvent extends BaseOpenHandsEvent {
  kind: "SystemPromptEvent";
  system_prompt: MessageContent;
  tools: unknown[];
}

export interface PauseEvent extends BaseOpenHandsEvent {
  kind: "PauseEvent";
  reason?: string;
}

export interface CondensationRequestEvent extends BaseOpenHandsEvent {
  kind: "CondensationRequest";
}

export interface CondensationSummaryEvent extends BaseOpenHandsEvent {
  kind: "CondensationSummaryEvent";
  summary: string;
}

export interface CondensationEvent extends BaseOpenHandsEvent {
  kind: "Condensation";
  forgotten_event_ids: string[];
  summary?: string | null;
  summary_offset?: number | null;
  llm_response_id: string;
}

export interface ConversationStateUpdateEvent extends BaseOpenHandsEvent {
  kind: "ConversationStateUpdateEvent";
  key: string;
  value: unknown;
  previous_value?: unknown;
}

export interface ConversationErrorEvent extends BaseOpenHandsEvent {
  kind: "ConversationErrorEvent";
  code: string;
  detail: string;
}

export interface LLMCompletionLogEvent extends BaseOpenHandsEvent {
  kind: "LLMCompletionLogEvent";
  filename: string;
  log_data: string;
  model_name?: string;
  usage_id?: string;
}

export interface UserRejectObservation extends BaseOpenHandsEvent {
  kind: "UserRejectObservation";
  tool_name: string;
  tool_call_id: string;
  action_id: string;
  rejection_reason: string;
  rejection_source: "user" | "system";
}

export interface ConfirmationRequestEvent extends BaseOpenHandsEvent {
  kind: "ConfirmationRequestEvent";
  action_id: string;
  action: ActionEvent;
  risk_level?: "low" | "medium" | "high" | "unknown";
  risk_assessment?: string;
}

export interface ConfirmationResponseEvent extends BaseOpenHandsEvent {
  kind: "ConfirmationResponseEvent";
  action_id: string;
  accepted: boolean;
  reason?: string;
}

export interface TokenEvent extends BaseOpenHandsEvent {
  kind: "TokenEvent";
  prompt_token_ids: number[];
  response_token_ids: number[];
}

export interface StuckDetectionEvent extends BaseOpenHandsEvent {
  kind: "StuckDetectionEvent";
  pattern:
    | "action_observation_loop"
    | "action_error_loop"
    | "monologue"
    | "alternating_pattern"
    | "context_window_error";
  repetitions: number;
  description: string;
}

export interface FinishEvent extends BaseOpenHandsEvent {
  kind: "FinishEvent";
  message: string;
  success?: boolean;
}

export interface ThinkEvent extends BaseOpenHandsEvent {
  kind: "ThinkEvent";
  thought: string;
}

export type HookExecutionEventType =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "Stop";

export interface HookExecutionEvent extends BaseOpenHandsEvent {
  kind: "HookExecutionEvent";
  source: "hook";
  hook_event_type: HookExecutionEventType;
  hook_command: string;
  tool_name?: string | null;
  success: boolean;
  blocked: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  reason?: string | null;
  additional_context?: string | null;
  error?: string | null;
  action_id?: string | null;
  message_id?: string | null;
  hook_input?: Record<string, unknown> | null;
}

export type OpenHandsConversationEvent =
  | MessageEvent
  | ActionEvent
  | ObservationEvent
  | AgentErrorEvent
  | SystemPromptEvent
  | PauseEvent
  | CondensationRequestEvent
  | CondensationSummaryEvent
  | CondensationEvent
  | ConversationStateUpdateEvent
  | ConversationErrorEvent
  | LLMCompletionLogEvent
  | UserRejectObservation
  | ConfirmationRequestEvent
  | ConfirmationResponseEvent
  | TokenEvent
  | StuckDetectionEvent
  | FinishEvent
  | ThinkEvent
  | HookExecutionEvent;

export interface OpenHandsEventDiagnostics {
  conversationId?: string | null;
  toolCallId?: string | null;
  parentToolCallId?: string | null;
  rawEvent?: unknown;
}

export interface FrontendConversationCommand {
  type: "send_message";
  text: string;
  targetFiles?: string[];
}

export interface ConversationBackendError {
  message: string;
  code?: string;
}

export interface ConversationEventEnvelope {
  eventId: string;
  conversationId: string;
  origin: ConversationEventOrigin;
  status: ConversationEventStatus;
  createdAtMs: number;
  acceptedAtMs?: number | null;
  failedAtMs?: number | null;
  display: {
    kind: ConversationDisplayKind;
    label?: string;
    collapsedByDefault?: boolean;
  };
  payload: {
    openHandsEvent?: OpenHandsConversationEvent;
    openHandsDiagnostics?: OpenHandsEventDiagnostics;
    rawOpenHandsEvent?: unknown;
    frontendCommand?: FrontendConversationCommand;
    backendError?: ConversationBackendError;
  };
}
