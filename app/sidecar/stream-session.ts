import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AskUserQuestionInput, CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { SidecarConfig } from "./config.js";
import { buildQueryOptions } from "./options.js";
import { createAbortState, linkExternalSignal } from "./shutdown.js";
import { emitSystemEvent, discoverInstalledPlugins, selectPluginPaths } from "./run-agent.js";
import { MessageProcessor } from "./message-processor.js";
import { ResultGate } from "./result-gate.js";

/** Sentinel used to close the async generator cleanly. */
const CLOSE_SENTINEL = Symbol("close");

interface PendingQuestion {
  toolUseId: string;
  questions: AskUserQuestionInput["questions"];
  resolve: (result: PermissionResult) => void;
  reject: (error: Error) => void;
}

/**
 * A streaming session that wraps the SDK's streaming input mode.
 *
 * The SDK's `query()` receives an `AsyncGenerator` as its prompt.
 * The generator yields user messages on demand — the first from the config,
 * subsequent ones pushed via `pushMessage()`. The SDK maintains full
 * conversation state (tool_use, tool_result, assistant messages) across yields.
 *
 * Cancel (interrupt): `cancelTurn()` aborts the current AbortController,
 * stopping the active turn. The session stays alive. The next `pushMessage()`
 * restarts `query()` with `resume: sdkSessionId` to continue the conversation.
 */
export class StreamSession {
  private currentRequestId: string;
  private pendingResolve: ((value: string | typeof CLOSE_SENTINEL) => void) | null = null;
  private messageQueue: string[] = [];
  private closed = false;
  private cancelled = false;
  private sessionId: string;
  private config: SidecarConfig;
  private onMessage: (requestId: string, message: Record<string, unknown>) => void;
  private mockMode = false;
  private mockOnMessage:
    | ((requestId: string, message: Record<string, unknown>) => void)
    | null = null;
  /** Shared MessageProcessor for mock streaming — persists across turns. */
  private mockProcessor: MessageProcessor | null = null;
  private pendingQuestion: PendingQuestion | null = null;
  private abortState: ReturnType<typeof createAbortState> | null = null;
  /** SDK session ID captured from messages — used for resume after cancel. */
  private sdkSessionId: string | null = null;
  /** Active SDK Query object — stored so cancelTurn() can call interrupt()/close(). */
  private activeQuery: { interrupt(): Promise<void>; close(): void } | null = null;

  constructor(
    sessionId: string,
    firstRequestId: string,
    config: SidecarConfig,
    onMessage: (requestId: string, message: Record<string, unknown>) => void,
    externalSignal?: AbortSignal,
  ) {
    this.sessionId = sessionId;
    this.config = config;
    this.onMessage = onMessage;
    this.currentRequestId = firstRequestId;

    // Start the streaming query in background — don't await.
    // Expose the promise so callers (persistent-mode shutdown) can await it.
    this.queryDone = this.runQuery(config, onMessage, externalSignal);
  }

  /** Resolves when `runQuery` finishes (success, error, or abort). */
  queryDone: Promise<void>;

  /**
   * Push a follow-up user message into the streaming session.
   * Resolves the pending promise so the generator yields to the SDK.
   *
   * If the session was cancelled (turn interrupted via cancelTurn()),
   * restarts the SDK query with `resume` to continue the conversation.
   */
  pushMessage(requestId: string, userMessage: string): void {
    if (this.closed) {
      throw new Error(`StreamSession ${this.sessionId} is closed`);
    }
    this.currentRequestId = requestId;

    // After a cancel, the previous query() has ended.
    // Restart with resume to continue the conversation.
    if (this.cancelled) {
      this.cancelled = false;
      this.messageQueue = [];
      this.pendingResolve = null;
      process.stderr.write(
        `[stream-session] Resuming after cancel: session=${this.sessionId} sdkSession=${this.sdkSessionId ?? "none"}\n`,
      );
      this.queryDone = this.runQuery(
        { ...this.config, prompt: userMessage },
        this.onMessage,
        undefined,
        this.sdkSessionId ?? undefined,
      );
      return;
    }

    if (this.mockMode && this.mockOnMessage) {
      void this.emitMockTurn(userMessage, this.mockOnMessage);
      // Fall through to drain any messages that were queued before mock mode was confirmed.
    }
    if (this.pendingResolve) {
      this.pendingResolve(userMessage);
      this.pendingResolve = null;
    } else if (!this.mockMode) {
      // Generator hasn't reached its await yet — queue the message
      // so it's consumed on the next iteration instead of being dropped.
      this.messageQueue.push(userMessage);
    }
  }

  /**
   * Interrupt the current turn without closing the session.
   * Aborts the AbortController so the SDK stops the active turn.
   * The session stays alive — the next pushMessage() resumes via the SDK's
   * `resume` option to continue the conversation.
   */
  cancelTurn(): void {
    if (this.closed || this.cancelled) return;

    process.stderr.write(
      `[stream-session] cancelTurn: session=${this.sessionId} sdkSession=${this.sdkSessionId ?? "none"}\n`,
    );

    this.cancelled = true;

    // Reject any pending AskUserQuestion so the SDK doesn't hang.
    if (this.pendingQuestion) {
      this.pendingQuestion.reject(new Error("Turn cancelled by user"));
      this.pendingQuestion = null;
    }

    // Send interrupt to the SDK child process. interrupt() sends a
    // control_request to cli.js which will stop the current turn and
    // emit a terminal event. The for-await loop will then exit naturally,
    // emitting shutdown run_result which drives the frontend transition.
    if (this.activeQuery) {
      this.activeQuery.interrupt().catch((err) => {
        process.stderr.write(
          `[stream-session] interrupt() failed for session ${this.sessionId}: ${err}\n`,
        );
      });
    }

    // Also abort the controller as a secondary signal.
    if (this.abortState && !this.abortState.abortController.signal.aborted) {
      this.abortState.abortController.abort();
    }

    // If the generator is parked waiting for a message, unblock it
    // so runQuery() can exit cleanly.
    if (this.pendingResolve) {
      this.pendingResolve(CLOSE_SENTINEL);
      this.pendingResolve = null;
    }
  }

  answerQuestion(
    requestId: string,
    toolUseId: string,
    questions: AskUserQuestionInput["questions"],
    answers: Record<string, unknown>,
  ): void {
    if (this.closed) {
      throw new Error(`StreamSession ${this.sessionId} is closed`);
    }
    if (!this.pendingQuestion || this.pendingQuestion.toolUseId !== toolUseId) {
      throw new Error(`No pending user question found for tool ${toolUseId}`);
    }

    const pending = this.pendingQuestion;
    this.pendingQuestion = null;
    this.currentRequestId = requestId;
    pending.resolve({
      behavior: "allow",
      updatedInput: {
        questions,
        answers,
      },
    });
  }

  /**
   * Close the streaming session. The generator exits, query() finishes.
   * In mock mode, emits a shutdown run_result so Rust can persist the run.
   */
  close(): void {
    this.closed = true;
    // Forcefully kill the SDK child process.
    if (this.activeQuery) {
      this.activeQuery.close();
      this.activeQuery = null;
    }
    if (this.abortState && !this.abortState.abortController.signal.aborted) {
      this.abortState.abortController.abort();
    }
    if (this.pendingQuestion) {
      this.pendingQuestion.reject(new Error("Stream session closed while waiting for user input"));
      this.pendingQuestion = null;
    }
    if (this.mockMode && this.mockProcessor && !this.mockProcessor.hasEmittedResult() && this.mockOnMessage) {
      const [summary, orphaned] = this.mockProcessor.buildShutdownSummary();
      for (const item of orphaned) {
        this.mockOnMessage(this.currentRequestId, item as Record<string, unknown>);
      }
      this.mockOnMessage(this.currentRequestId, {
        type: "agent_event",
        event: summary,
        timestamp: Date.now(),
      } as Record<string, unknown>);
    }
    if (this.pendingResolve) {
      this.pendingResolve(CLOSE_SENTINEL);
      this.pendingResolve = null;
    }
  }

  private buildCanUseTool(
    onMessage: (requestId: string, message: Record<string, unknown>) => void,
  ): CanUseTool {
    return async (toolName, input, options) => {
      if (toolName !== "AskUserQuestion") {
        return { behavior: "allow" };
      }

      const rawQuestions = (input as AskUserQuestionInput).questions;
      if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
        return {
          behavior: "deny",
          message: "AskUserQuestion requires at least one question",
        };
      }

      if (this.pendingQuestion) {
        return {
          behavior: "deny",
          message: "Another user question is already pending",
        };
      }

      onMessage(this.currentRequestId, {
        type: "refine_question",
        tool_use_id: options.toolUseID,
        questions: rawQuestions,
        timestamp: Date.now(),
      });

      return await new Promise<PermissionResult>((resolve, reject) => {
        const onAbort = () => {
          if (this.pendingQuestion?.toolUseId === options.toolUseID) {
            this.pendingQuestion = null;
          }
          reject(new Error("AskUserQuestion aborted"));
        };

        options.signal.addEventListener("abort", onAbort, { once: true });
        this.pendingQuestion = {
          toolUseId: options.toolUseID,
          questions: rawQuestions,
          resolve: (result) => {
            options.signal.removeEventListener("abort", onAbort);
            resolve(result);
          },
          reject: (error) => {
            options.signal.removeEventListener("abort", onAbort);
            reject(error);
          },
        };
      });
    };
  }

  private async runQuery(
    config: SidecarConfig,
    onMessage: (requestId: string, message: Record<string, unknown>) => void,
    externalSignal?: AbortSignal,
    resumeSessionId?: string,
  ): Promise<void> {
    if (process.env.MOCK_AGENTS === "true") {
      this.mockMode = true;
      this.mockOnMessage = onMessage;
      this.mockProcessor = new MessageProcessor({
        skillName: config.skillName,
        stepId: config.stepId,
        workflowSessionId: config.workflowSessionId,
        usageSessionId: config.usageSessionId,
        runSource: config.runSource,
        streaming: true,
      });
      emitSystemEvent((msg) => onMessage(this.currentRequestId, msg), "init_start");
      emitSystemEvent((msg) => onMessage(this.currentRequestId, msg), "sdk_ready");
      try {
        await this.emitMockTurn(config.prompt, onMessage);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[stream-session] Mock turn error for session ${this.sessionId}: ${errorMessage}\n`);
        onMessage(this.currentRequestId, { type: "error", message: errorMessage });
      }
      return;
    }

    const state = createAbortState();
    this.abortState = state;
    if (externalSignal) {
      linkExternalSignal(state, externalSignal);
    }

    // Route SDK stderr through onMessage for JSONL transcripts
    const stderrHandler = (data: string) => {
      onMessage(this.currentRequestId, {
        type: "system",
        subtype: "sdk_stderr",
        data: data.trimEnd(),
        timestamp: Date.now(),
      });
    };

    // Ref for the Stop hook — assigned after processor creation.
    const processorRef: { current: MessageProcessor | null } = { current: null };

    // Hoist processor so the setup-error catch block can emit a run_result.
    const processor = new MessageProcessor({
      skillName: config.skillName,
      stepId: config.stepId,
      workflowSessionId: config.workflowSessionId,
      usageSessionId: config.usageSessionId,
      runSource: config.runSource,
      streaming: true,
    });
    processorRef.current = processor;

    let discoveredPluginPaths: string[];
    let pluginPaths: string[];
    try {
      discoveredPluginPaths = await discoverInstalledPlugins(config.cwd);
      pluginPaths = selectPluginPaths(discoveredPluginPaths, config.requiredPlugins);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[stream-session] Setup error for session ${this.sessionId}: ${errorMessage}\n`);
      onMessage(this.currentRequestId, { type: "error", message: errorMessage });
      const [errorSummary, orphanedSetup] = processor.buildExecutionErrorSummary(errorMessage);
      for (const item of orphanedSetup) {
        onMessage(this.currentRequestId, item as Record<string, unknown>);
      }
      onMessage(this.currentRequestId, { type: "agent_event", event: errorSummary, timestamp: Date.now() } as Record<string, unknown>);
      return;
    }

    const canUseTool = this.buildCanUseTool(onMessage);
    const baseOptions = buildQueryOptions(
      config,
      state.abortController,
      pluginPaths,
      stderrHandler,
      processorRef,
      canUseTool,
    );

    // Resume from a previous session (after cancelTurn interrupted a turn).
    const options = resumeSessionId
      ? { ...baseOptions, resume: resumeSessionId }
      : baseOptions;

    if (resumeSessionId) {
      process.stderr.write(
        `[stream-session] Resuming SDK session ${resumeSessionId} for session ${this.sessionId}\n`,
      );
    }

    // Gate run_result emission until all subagents/background tasks finish.
    const gate = new ResultGate(processor);

    // Build the async generator that feeds messages to the SDK
    const self = this;
    async function* messageGenerator() {
      // First message: the full prompt from config
      yield {
        type: "user" as const,
        message: {
          role: "user" as const,
          content: config.prompt,
        },
      };

      // Subsequent messages: wait for pushMessage() calls
      while (!self.closed && !self.cancelled) {
        // Check for queued messages that arrived before we could await
        if (self.messageQueue.length > 0) {
          const message = self.messageQueue.shift()!;
          yield {
            type: "user" as const,
            message: { role: "user" as const, content: message },
          };
          continue;
        }

        const nextMessage = await new Promise<string | typeof CLOSE_SENTINEL>(
          (resolve) => {
            // Before parking, drain any message that arrived during the yield
            if (self.messageQueue.length > 0) {
              const message = self.messageQueue.shift()!;
              resolve(message);
              return;
            }
            self.pendingResolve = resolve;
          },
        );

        if (nextMessage === CLOSE_SENTINEL || self.closed) {
          return;
        }

        yield {
          type: "user" as const,
          message: {
            role: "user" as const,
            content: nextMessage,
          },
        };
      }
    }

    emitSystemEvent(
      (msg) => onMessage(this.currentRequestId, msg),
      "init_start",
    );

    process.stderr.write(`[stream-session] Starting streaming query for session ${this.sessionId}\n`);

    const conversation = query({
      prompt: messageGenerator(),
      options,
    });

    // Store the Query object so cancelTurn() can call interrupt() and
    // close() can call close() — both communicate with the SDK child
    // process directly, bypassing the event loop.
    this.activeQuery = conversation as unknown as { interrupt(): Promise<void>; close(): void };

    try {
      let sdkReadyEmitted = false;
      for await (const message of conversation) {
        if (state.abortController.signal.aborted) break;

        // Emit sdk_ready on first actual message so "Connecting to API..."
        // reflects real connection state rather than firing before the
        // async generator yields its first value.
        if (!sdkReadyEmitted) {
          emitSystemEvent((msg) => onMessage(this.currentRequestId, msg), "sdk_ready");
          sdkReadyEmitted = true;
        }

        const msg = message as Record<string, unknown>;

        // Capture SDK session ID for resume after cancel.
        if (typeof msg.session_id === "string" && !this.sdkSessionId) {
          this.sdkSessionId = msg.session_id;
        }

        // Process into display items + pass-through messages
        // Task events (task_started/task_progress/task_notification) are routed
        // through the "task" classifier category → processTaskEvent.
        const items = processor.process(msg);
        for (const item of items) {
          gate.emit(
            item as Record<string, unknown>,
            (m) => onMessage(this.currentRequestId, m),
          );
        }
        gate.tryFlush((m) => onMessage(this.currentRequestId, m));

        // turn_complete is now emitted by MessageProcessor.processAssistantMessage
        // when stop_reason is set and not "tool_use". No raw SDK field inspection here.
      }

      // Safety net: emit any deferred run_result when the SDK loop exits.
      gate.flush((m) => onMessage(this.currentRequestId, m));

      // Emit a shutdown run_result for aborted streaming runs (guard in case
      // the SDK itself emitted a result before the abort was processed).
      if (state.abortController.signal.aborted && !processor.hasEmittedResult()) {
        process.stderr.write(`[stream-session] Session ${this.sessionId} aborted — emitting shutdown run_result\n`);
        const [shutdownSummary, orphanedAbort] = processor.buildShutdownSummary();
        for (const item of orphanedAbort) {
          onMessage(this.currentRequestId, item as Record<string, unknown>);
        }
        onMessage(this.currentRequestId, { type: "agent_event", event: shutdownSummary, timestamp: Date.now() } as Record<string, unknown>);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[stream-session] Query error: ${errorMessage}\n`);
      onMessage(this.currentRequestId, {
        type: "error",
        message: errorMessage,
      });
      // Emit error run_result for persistence — use execution-error path so
      // failures are distinguishable from user-initiated shutdowns.
      if (!processor.hasEmittedResult()) {
        process.stderr.write(`[stream-session] Emitting error run_result for session ${this.sessionId}\n`);
        const [errorSummary, orphanedErr] = processor.buildExecutionErrorSummary(errorMessage);
        for (const item of orphanedErr) {
          onMessage(this.currentRequestId, item as Record<string, unknown>);
        }
        onMessage(this.currentRequestId, { type: "agent_event", event: errorSummary, timestamp: Date.now() } as Record<string, unknown>);
      }
    }

    // Query finished — either all turns exhausted or generator closed.
    // Guard: if the SDK exhausted max turns without emitting a result message,
    // emit a shutdown run_result now so Rust can persist the run before
    // session_exhausted triggers frontend cleanup.
    if (!processor.hasEmittedResult()) {
      process.stderr.write(
        `[stream-session] Session ${this.sessionId} ended without run_result — emitting shutdown summary\n`,
      );
      const [exhaustionSummary, orphanedExhaust] = processor.buildShutdownSummary();
      for (const item of orphanedExhaust) {
        onMessage(this.currentRequestId, item as Record<string, unknown>);
      }
      onMessage(this.currentRequestId, {
        type: "agent_event",
        event: exhaustionSummary,
        timestamp: Date.now(),
      } as Record<string, unknown>);
    }

    if (!this.closed && !this.cancelled && !state.abortController.signal.aborted) {
      // Turns exhausted naturally (not user-initiated close, not cancelled, not externally aborted)
      process.stderr.write(
        `[stream-session] Session ${this.sessionId} exhausted (query completed without close)\n`,
      );
      onMessage(this.currentRequestId, {
        type: "agent_event",
        event: { type: "session_exhausted", sessionId: this.sessionId },
        timestamp: Date.now(),
      });
    }

    process.stderr.write(`[stream-session] Session ${this.sessionId} ended\n`);
    this.abortState = null;
    this.activeQuery = null;
  }

  private async emitMockTurn(
    userMessage: string,
    onMessage: (requestId: string, message: Record<string, unknown>) => void,
  ): Promise<void> {
    if (this.closed) return;
    const requestId = this.currentRequestId;
    const trimmed = userMessage.trim();
    const preview = trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
    const text = preview.length > 0
      ? `Mock streaming response received:\n\n${preview}`
      : "Mock streaming response received.";

    // Build a raw assistant message and process through MessageProcessor
    // so the frontend receives display_item envelopes (not legacy raw messages).
    const rawAssistant = {
      type: "assistant",
      message: {
        model: "mock-stream",
        id: `msg_mock_stream_${Date.now()}`,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    };

    // Reuse the session-scoped processor so context accumulates across turns
    const processor = this.mockProcessor!;
    const items = processor.process(rawAssistant);
    for (const item of items) {
      onMessage(requestId, item as Record<string, unknown>);
    }

    // turn_complete is emitted by MessageProcessor when it processes the
    // stop_reason in rawAssistant. No manual emission needed here.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
