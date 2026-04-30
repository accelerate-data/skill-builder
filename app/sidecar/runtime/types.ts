import type { AgentEvent } from "../agent-events.js";
import type { DisplayItem } from "../display-types.js";

export type RuntimeMode = "one-shot" | "streaming";

export interface RunPersistenceContext {
  skillName?: string;
  stepId?: number;
  workflowSessionId?: string;
  usageSessionId?: string;
  runSource?: "workflow" | "refine" | "test" | "gate-eval";
  workspaceSkillDir?: string;
  pluginSlug: string;
}

export interface RuntimeRequestBase {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  agentName?: string;
  apiKey: string;
  workspaceRootDir: string;
  workspaceSkillDir: string;
  requiredPlugins?: string[];
  allowedTools?: string[];
  settingSources?: ("user" | "project")[];
  maxTurns?: number;
  outputFormat?: {
    type: "json_schema";
    schema: Record<string, unknown>;
  };
  promptSuggestions?: boolean;
  context: RunPersistenceContext;
}

export interface OneShotRunRequest extends RuntimeRequestBase {
  mode: "one-shot";
  allowUserQuestions: false;
}

export interface StreamingSessionRequest extends RuntimeRequestBase {
  mode: "streaming";
  allowUserQuestions: true;
}

export type RuntimeRequest = OneShotRunRequest | StreamingSessionRequest;

export interface RefineQuestion {
  tool_use_id: string;
  questions: unknown[];
  timestamp: number;
}

export interface RuntimeSink {
  emit(message: Record<string, unknown>): void;
  emitDisplayItem(item: DisplayItem): void;
  emitAgentEvent(event: AgentEvent, timestamp?: number): void;
  emitRefineQuestion(question: RefineQuestion): void;
  emitRaw(message: Record<string, unknown>): void;
}

export interface RuntimeSession {
  readonly queryDone: Promise<void>;
  sendUserMessage(requestId: string, message: string): Promise<void> | void;
  answerQuestion(
    requestId: string,
    toolUseId: string,
    questions: unknown[],
    answers: Record<string, unknown>,
  ): Promise<void> | void;
  cancel(): Promise<void> | void;
  close(): Promise<void> | void;
}

export interface AgentRuntime {
  runOnce(
    request: OneShotRunRequest,
    sink: RuntimeSink,
    signal?: AbortSignal,
  ): Promise<void>;

  startStreamingSession(
    request: StreamingSessionRequest,
    sink: RuntimeSink,
  ): RuntimeSession;
}

const USER_QUESTION_TOOL_NAMES = new Set([
  "AskUserQuestion",
  "ask_user_question",
]);

export function isUserQuestionToolName(toolName: string): boolean {
  return USER_QUESTION_TOOL_NAMES.has(toolName);
}

export function assertOneShotHasNoUserQuestions(request: OneShotRunRequest): void {
  const forbiddenTools = (request.allowedTools ?? []).filter(isUserQuestionToolName);
  if (forbiddenTools.length > 0) {
    throw new Error(
      `one-shot runtime requests cannot include user-question tools: ${forbiddenTools.join(", ")}`,
    );
  }
}
