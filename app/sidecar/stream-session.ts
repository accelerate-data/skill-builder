import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AskUserQuestionInput, CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { SidecarConfig } from "./config.js";
import { buildQueryOptions } from "./options.js";
import { createAbortState, linkExternalSignal } from "./shutdown.js";
import { emitSystemEvent, discoverInstalledPlugins, selectPluginPaths } from "./run-agent.js";
import { writeMockOutputFiles, buildStructuredMockResult } from "./mock-agent.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MessageProcessor } from "./message-processor.js";
import { ResultGate } from "./result-gate.js";
import type { RuntimeSession } from "./runtime/types.js";

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
export class StreamSession implements RuntimeSession {
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
  /** Reference to the active SDK async iterator — used for force-return on cancel timeout. */
  private activeConversation: AsyncGenerator<unknown, unknown, unknown> | null = null;

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

  sendUserMessage(requestId: string, message: string): void {
    this.pushMessage(requestId, message);
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

    // Abort the AbortController — this is the primary cancel mechanism.
    // The SDK's query() receives this controller and propagates the abort
    // signal to the cli.js child process. The for-await loop will throw
    // AbortError or the iterator will end, emitting a shutdown run_result
    // that drives the frontend transition.
    // See: https://github.com/anthropics/claude-code/issues/7181
    if (this.abortState && !this.abortState.abortController.signal.aborted) {
      this.abortState.abortController.abort();
    }

    // If the generator is parked waiting for a message, unblock it
    // so runQuery() can exit cleanly.
    if (this.pendingResolve) {
      this.pendingResolve(CLOSE_SENTINEL);
      this.pendingResolve = null;
    }

    // Fallback: if the SDK doesn't respond to abort within 5s (e.g. stuck
    // waiting for subagent HTTP responses), force-return the async iterator.
    // This terminates the for-await loop in runQuery() so the session can
    // emit a shutdown result and transition the frontend out of "running".
    //
    // Trade-off: conversation.return() kills the iterator so SDK conversation
    // state is lost — the next pushMessage() will start a fresh query instead
    // of resuming. This is acceptable because the alternative is the user
    // being stuck with no way to recover without restarting the session.
    const conv = this.activeConversation;
    if (conv) {
      setTimeout(() => {
        if (this.activeConversation === conv) {
          process.stderr.write(
            `[stream-session] cancelTurn force-return: session=${this.sessionId} (abort timed out after 5s)\n`,
          );
          conv.return(undefined).catch(() => {});
        }
      }, 5000);
    }
  }

  cancel(): void {
    this.cancelTurn();
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
      try {
        if (toolName !== "AskUserQuestion") {
          // Always include updatedInput in the allow response. The SDK's Zod schema
          // for the can_use_tool IPC response requires `updatedInput: Record<string,
          // unknown>` (not optional). Returning a bare `{ behavior: "allow" }` causes
          // a ZodError ("expected record, received undefined") that silently converts
          // the allow into a deny — so Edit/Write tools fail without user feedback.
          return {
            behavior: "allow",
            updatedInput: (input ?? {}) as Record<string, unknown>,
          };
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
      } catch (err) {
        // Surface permission callback errors as a visible, structured denial so
        // the agent logs show a clear cause rather than silently falling back to
        // read-only behavior.
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[stream-session] event=canUseTool_error tool=${toolName} session=${this.sessionId} error=${message}\n`,
        );
        return {
          behavior: "deny",
          message: `Permission check failed for tool ${toolName}: ${message}`,
        };
      }
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
        // Workflow steps need proper mock output — use the step-template system.
        if (config.runSource === "workflow" && typeof config.stepId === "number" && config.stepId >= 0) {
          await this.emitMockWorkflowStep(config, onMessage);
        } else {
          await this.emitMockTurn(config.prompt, onMessage);
        }
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
      hasOutputFormat: config.outputFormat != null,
    });
    processorRef.current = processor;

    let discoveredPluginPaths: string[];
    let pluginPaths: string[];
    try {
      discoveredPluginPaths = await discoverInstalledPlugins(config.workspaceRootDir);
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

    let conversation: AsyncGenerator<unknown, unknown, unknown>;
    try {
      conversation = query({
        prompt: messageGenerator(),
        options,
      }) as AsyncGenerator<unknown, unknown, unknown>;
      this.activeConversation = conversation;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[stream-session] query() threw synchronously for session ${this.sessionId}: ${errorMessage}\n`);
      onMessage(this.currentRequestId, { type: "error", message: errorMessage });
      const [errorSummary, orphanedSetup] = processor.buildExecutionErrorSummary(errorMessage);
      for (const item of orphanedSetup) {
        onMessage(this.currentRequestId, item as Record<string, unknown>);
      }
      onMessage(this.currentRequestId, { type: "agent_event", event: errorSummary, timestamp: Date.now() } as Record<string, unknown>);
      return;
    }

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

        // Forward prompt suggestions directly — they arrive after result
        // and are not display items. Emit as an agent_event so Rust routes
        // them to the frontend agent store.
        if (msg.type === "prompt_suggestion" && typeof msg.suggestion === "string") {
          onMessage(this.currentRequestId, {
            type: "agent_event",
            event: {
              type: "prompt_suggestion",
              suggestion: msg.suggestion,
            },
            timestamp: Date.now(),
          });
          continue;
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
      const isUserAbort =
        state.abortController.signal.aborted ||
        this.cancelled ||
        errorMessage.includes("aborted by user");

      if (isUserAbort) {
        // User-initiated cancel threw instead of breaking the loop cleanly.
        // Treat as a shutdown, not an error.
        process.stderr.write(`[stream-session] Session ${this.sessionId} aborted (caught) — emitting shutdown run_result\n`);
        if (!processor.hasEmittedResult()) {
          const [shutdownSummary, orphanedAbort] = processor.buildShutdownSummary();
          for (const item of orphanedAbort) {
            onMessage(this.currentRequestId, item as Record<string, unknown>);
          }
          onMessage(this.currentRequestId, { type: "agent_event", event: shutdownSummary, timestamp: Date.now() } as Record<string, unknown>);
        }
      } else {
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
    this.activeConversation = null;
    this.abortState = null;
  }

  /**
   * Handle a mock workflow step (stepId 0-3) by writing the bundled output files
   * to the skill workspace and emitting a structured result so the Rust backend
   * can advance the workflow. Called instead of emitMockTurn for workflow steps.
   */
  private async emitMockWorkflowStep(
    config: SidecarConfig,
    onMessage: (requestId: string, message: Record<string, unknown>) => void,
  ): Promise<void> {
    const stepTemplates: Record<number, string> = {
      0: "step0-research",
      1: "step1-detailed-research",
      2: "step2-confirm-decisions",
      3: "step3-generate-skill",
    };
    const stepTemplate = typeof config.stepId === "number" ? stepTemplates[config.stepId] : undefined;
    if (!stepTemplate) {
      // Unknown stepId — fall back to generic echo
      await this.emitMockTurn(config.prompt ?? "", onMessage);
      return;
    }

    // Write bundled output files to the skill workspace so verify_step_output finds them.
    await writeMockOutputFiles(stepTemplate, config);

    // For the final generation step, also pre-populate evals so the Eval tab has
    // test cases ready when the user clicks "Eval" after skill creation.
    if (stepTemplate === "step3-generate-skill") {
      const evalsDir = path.join(config.workspaceSkillDir, "evals");
      await fs.mkdir(evalsDir, { recursive: true });
      const mockEvalsFile = {
        skill_name: config.skillName ?? "skill",
        evals: [
          {
            id: 1,
            eval_name: "Core task completion",
            slug: "core-task-completion",
            prompt: "Walk me through the standard workflow for this skill from start to finish.",
            files: [],
            expectations: [
              "Response provides a clear, step-by-step explanation",
              "All required components of the workflow are covered",
              "Response uses domain-appropriate terminology",
            ],
          },
          {
            id: 2,
            eval_name: "Edge case handling",
            slug: "edge-case-handling",
            prompt: "What happens when the input data is incomplete or missing required fields?",
            files: [],
            expectations: [
              "Response identifies which fields are required vs optional",
              "Response describes how to handle missing data gracefully",
              "Response suggests a validation or fallback approach",
            ],
          },
          {
            id: 3,
            eval_name: "Best practices guidance",
            slug: "best-practices-guidance",
            prompt: "What are the most common mistakes to avoid when using this skill?",
            files: [],
            expectations: [
              "Response lists at least 3 specific anti-patterns or pitfalls",
              "Each pitfall includes a recommended alternative",
              "Guidance is actionable and specific to this domain",
            ],
          },
        ],
      };
      await fs.writeFile(
        path.join(evalsDir, "evals.json"),
        JSON.stringify(mockEvalsFile, null, 2),
        "utf-8",
      );
    }

    // Build the structured output that the Rust backend expects.
    const structuredOutput = await buildStructuredMockResult(stepTemplate, config);

    const resultMsg: Record<string, unknown> = {
      type: "result",
      subtype: "success",
      result: `Mock: ${stepTemplate} completed`,
      is_error: false,
      duration_ms: 500,
      duration_api_ms: 500,
      num_turns: 1,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    if (structuredOutput !== null) {
      resultMsg.structured_output = structuredOutput;
    }

    if (this.mockProcessor) {
      const items = this.mockProcessor.process(resultMsg);
      for (const item of items) {
        onMessage(this.currentRequestId, item as Record<string, unknown>);
      }
    }
  }

  private async emitMockTurn(
    userMessage: string,
    onMessage: (requestId: string, message: Record<string, unknown>) => void,
  ): Promise<void> {
    if (this.closed) return;
    const requestId = this.currentRequestId;

    // Detect eval failure triage pattern: lines like "eval_name: /path/to/grading.json"
    const evalFailureLines = userMessage.trim().split(/\r?\n/).filter(
      (line) => line.includes("grading.json"),
    );

    // Delay mock responses so the agent stays in "running" state long enough
    // for guard tests (tab-switch, close-requested) to trigger.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (this.closed) return;

    if (evalFailureLines.length > 0) {
      // Mock the eval failure triage flow — emit assistant analysis then AskUserQuestion
      const evalNames = evalFailureLines.map((line) => {
        const colonIdx = line.indexOf(":");
        return colonIdx > 0 ? line.slice(0, colonIdx).trim() : line.trim();
      });

      const analysisText = `I've reviewed the grading results for ${evalNames.length} failing eval(s):\n\n` +
        evalNames.map((name, i) => `${i + 1}. **${name}** — assertion failures detected in grading results`).join("\n") +
        "\n\nLet me triage these failures and identify genuine skill gaps.";

      this.emitMockAssistantMessage(analysisText, onMessage);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Emit a refine_question event for the user to select which evals to fix
      const options = evalNames.map((name) => ({
        label: name,
        description: `Fix failing assertions for ${name}`,
      }));
      if (evalNames.length > 1) {
        options.push({
          label: "Address all skill gaps",
          description: "Fix all failing evals in one refine pass",
        });
      }

      onMessage(requestId, {
        type: "refine_question",
        tool_use_id: `toolu_mock_eval_triage_${Date.now()}`,
        questions: [{
          question: "Which eval failures should I address?",
          header: "Skill Gaps",
          options,
          multiSelect: true,
        }],
        timestamp: Date.now(),
      });
      return;
    }

    // Default mock response for non-eval messages
    const trimmed = userMessage.trim();
    const preview = trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
    const text = preview.length > 0
      ? `Mock streaming response received:\n\n${preview}`
      : "Mock streaming response received.";

    this.emitMockAssistantMessage(text, onMessage);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  private emitMockAssistantMessage(
    text: string,
    onMessage: (requestId: string, message: Record<string, unknown>) => void,
  ): void {
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

    const processor = this.mockProcessor!;
    const items = processor.process(rawAssistant);
    for (const item of items) {
      onMessage(this.currentRequestId, item as Record<string, unknown>);
    }
  }
}
