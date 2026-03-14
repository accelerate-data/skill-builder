import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SidecarConfig } from "./config.js";
import { buildQueryOptions } from "./options.js";
import { createAbortState, linkExternalSignal } from "./shutdown.js";
import { emitSystemEvent, discoverInstalledPlugins, selectPluginPaths } from "./run-agent.js";
import { MessageProcessor } from "./message-processor.js";

/** Sentinel used to close the async generator cleanly. */
const CLOSE_SENTINEL = Symbol("close");

/**
 * A streaming session that wraps the SDK's streaming input mode.
 *
 * The SDK's `query()` receives an `AsyncGenerator` as its prompt.
 * The generator yields user messages on demand — the first from the config,
 * subsequent ones pushed via `pushMessage()`. The SDK maintains full
 * conversation state (tool_use, tool_result, assistant messages) across yields.
 */
export class StreamSession {
  private currentRequestId: string;
  private pendingResolve: ((value: string | typeof CLOSE_SENTINEL) => void) | null = null;
  private messageQueue: string[] = [];
  private closed = false;
  private sessionId: string;
  private config: SidecarConfig;
  private mockMode = false;
  private mockOnMessage:
    | ((requestId: string, message: Record<string, unknown>) => void)
    | null = null;
  /** Shared MessageProcessor for mock streaming — persists across turns. */
  private mockProcessor: MessageProcessor | null = null;

  constructor(
    sessionId: string,
    firstRequestId: string,
    config: SidecarConfig,
    onMessage: (requestId: string, message: Record<string, unknown>) => void,
    externalSignal?: AbortSignal,
  ) {
    this.sessionId = sessionId;
    this.config = config;
    this.currentRequestId = firstRequestId;

    // Start the streaming query in background — don't await.
    // Expose the promise so callers (persistent-mode shutdown) can await it.
    this.queryDone = this.runQuery(config, onMessage, externalSignal);
  }

  /** Resolves when `runQuery` finishes (success, error, or abort). */
  readonly queryDone: Promise<void>;

  /**
   * Push a follow-up user message into the streaming session.
   * Resolves the pending promise so the generator yields to the SDK.
   */
  pushMessage(requestId: string, userMessage: string): void {
    if (this.closed) {
      throw new Error(`StreamSession ${this.sessionId} is closed`);
    }
    this.currentRequestId = requestId;
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
   * Close the streaming session. The generator exits, query() finishes.
   * In mock mode, emits a shutdown run_result so Rust can persist the run.
   */
  close(): void {
    this.closed = true;
    if (this.mockMode && this.mockProcessor && !this.mockProcessor.hasEmittedResult() && this.mockOnMessage) {
      const summary = this.mockProcessor.buildShutdownSummary();
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

  private async runQuery(
    config: SidecarConfig,
    onMessage: (requestId: string, message: Record<string, unknown>) => void,
    externalSignal?: AbortSignal,
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

    // Hoist processor so the setup-error catch block can emit a run_result.
    const processor = new MessageProcessor({
      skillName: config.skillName,
      stepId: config.stepId,
      workflowSessionId: config.workflowSessionId,
      usageSessionId: config.usageSessionId,
      runSource: config.runSource,
      streaming: true,
    });

    let discoveredPluginPaths: string[];
    let pluginPaths: string[];
    try {
      discoveredPluginPaths = await discoverInstalledPlugins(config.cwd);
      pluginPaths = selectPluginPaths(discoveredPluginPaths, config.requiredPlugins);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[stream-session] Setup error for session ${this.sessionId}: ${errorMessage}\n`);
      onMessage(this.currentRequestId, { type: "error", message: errorMessage });
      const errorSummary = processor.buildExecutionErrorSummary(errorMessage);
      onMessage(this.currentRequestId, { type: "agent_event", event: errorSummary, timestamp: Date.now() } as Record<string, unknown>);
      return;
    }

    const options = buildQueryOptions(config, state.abortController, pluginPaths, stderrHandler);

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
      while (!self.closed) {
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

        // Process into display items + pass-through messages
        const items = processor.process(msg);
        for (const item of items) {
          onMessage(this.currentRequestId, item as Record<string, unknown>);
        }

        // turn_complete is now emitted by MessageProcessor.processAssistantMessage
        // when stop_reason is set and not "tool_use". No raw SDK field inspection here.
      }

      // Emit a shutdown run_result for aborted streaming runs (guard in case
      // the SDK itself emitted a result before the abort was processed).
      if (state.abortController.signal.aborted && !processor.hasEmittedResult()) {
        process.stderr.write(`[stream-session] Session ${this.sessionId} aborted — emitting shutdown run_result\n`);
        const shutdownSummary = processor.buildShutdownSummary();
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
        const errorSummary = processor.buildExecutionErrorSummary(errorMessage);
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
      const exhaustionSummary = processor.buildShutdownSummary();
      onMessage(this.currentRequestId, {
        type: "agent_event",
        event: exhaustionSummary,
        timestamp: Date.now(),
      } as Record<string, unknown>);
    }

    if (!this.closed && !state.abortController.signal.aborted) {
      // Turns exhausted naturally (not user-initiated close, not externally aborted)
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
