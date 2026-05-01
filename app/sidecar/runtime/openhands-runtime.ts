/**
 * OpenHands one-shot runtime adapter.
 *
 * Spawns the Python runner (`app/sidecar/openhands/runner.py`), writes a
 * serialized `OneShotRunRequest` to its stdin, and maps JSONL lines from its
 * stdout into the sidecar runtime sink via `OpenHandsEventProcessor`.
 *
 * @module openhands-runtime
 */

import * as child_process from "node:child_process";
import * as readline from "node:readline";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenHandsEventProcessor } from "../openhands-event-processor.js";
import {
  assertOneShotHasNoUserQuestions,
  type AgentRuntime,
  type OneShotRunRequest,
  type RuntimeSession,
  type RuntimeSink,
  type StreamingSessionRequest,
} from "./types.js";

// ---------------------------------------------------------------------------
// Runner path resolution
// ---------------------------------------------------------------------------

function resolveRunnerPath(): string {
  // The runner lives at app/sidecar/openhands/runner.py, one level up from
  // this file (app/sidecar/runtime/).
  try {
    const thisFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(thisFile), "../openhands/runner.py");
  } catch {
    // Fallback for non-ESM test environments
    return path.resolve(process.cwd(), "app/sidecar/openhands/runner.py");
  }
}

// ---------------------------------------------------------------------------
// Sanitised environment
// ---------------------------------------------------------------------------

const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "PYTHONPATH",
] as const;

function buildRunnerEnv(request: OneShotRunRequest): Record<string, string> {
  const env: Record<string, string> = {
    ANTHROPIC_API_KEY: request.apiKey,
  };
  for (const key of ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  return env;
}

function redactApiKey(text: string, apiKey: string): string {
  if (apiKey.length === 0) return text;
  return text.replaceAll(apiKey, "[REDACTED]");
}

function buildRunnerRequest(request: OneShotRunRequest): Record<string, unknown> {
  return {
    mode: request.mode,
    prompt: request.prompt,
    systemPrompt: request.systemPrompt,
    model: request.model,
    modelBaseUrl: request.modelBaseUrl,
    agentName: request.agentName,
    apiKey: request.apiKey,
    workspaceRootDir: request.workspaceRootDir,
    workspaceSkillDir: request.workspaceSkillDir,
    maxTurns: request.maxTurns ?? 50,
    outputFormat: request.outputFormat,
  };
}

// ---------------------------------------------------------------------------
// OpenHandsRuntime
// ---------------------------------------------------------------------------

export class OpenHandsRuntime implements AgentRuntime {
  async runOnce(
    request: OneShotRunRequest,
    sink: RuntimeSink,
    signal?: AbortSignal,
  ): Promise<void> {
    assertOneShotHasNoUserQuestions(request);

    const runnerPath = resolveRunnerPath();
    const env = buildRunnerEnv(request);

    process.stderr.write(
      `[openhands-runtime] event=spawn runner=${runnerPath}\n`,
    );

    const processor = new OpenHandsEventProcessor({
      skillName: request.context.skillName,
      stepId: request.context.stepId,
      workflowSessionId: request.context.workflowSessionId,
      usageSessionId: request.context.usageSessionId,
      runSource: request.context.runSource,
      workspaceSkillDir: request.context.workspaceSkillDir,
      pluginSlug: request.context.pluginSlug,
      hasOutputFormat: request.outputFormat != null,
    });

    return new Promise<void>((resolve) => {
      // "python3" is correct for macOS/Linux dev environments.
      // Production will use the PyInstaller binary path via resolve_openhands_runner_path.
      const child = child_process.spawn("python3", [runnerPath], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Wire abort signal to kill the child process
      const abortHandler = () => {
        process.stderr.write("[openhands-runtime] event=abort killing child process\n");
        child.kill("SIGTERM");
      };
      if (signal) {
        if (signal.aborted) {
          child.kill("SIGTERM");
        } else {
          signal.addEventListener("abort", abortHandler, { once: true });
        }
      }

      // Suppress EPIPE on stdin — spawn errors are handled by the child 'error' / 'close' events
      child.stdin.on("error", () => undefined);

      // Write the request to stdin then close stdin
      const requestJson = JSON.stringify(buildRunnerRequest(request));
      child.stdin.write(requestJson + "\n");
      child.stdin.end();

      // Collect stderr from the Python runner and forward as system events
      let stderrBuffer = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.length > 0) {
            const redactedLine = redactApiKey(line, request.apiKey);
            sink.emitRaw({
              type: "system",
              subtype: "sdk_stderr",
              data: redactedLine,
              timestamp: Date.now(),
            });
          }
        }
      });

      // Process stdout line by line through the event processor
      const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });

      rl.on("line", (line: string) => {
        try {
          processor.processLine(line, sink);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[openhands-runtime] error=line_processing message=${msg}\n`);
          sink.emitRaw({
            type: "system",
            subtype: "sdk_stderr",
            data: `openhands-runtime: line processing error: ${msg}`,
            timestamp: Date.now(),
          });
        }
      });

      child.on("close", (code: number | null) => {
        // Flush any remaining stderr
        if (stderrBuffer.length > 0) {
          sink.emitRaw({
            type: "system",
            subtype: "sdk_stderr",
            data: redactApiKey(stderrBuffer, request.apiKey),
            timestamp: Date.now(),
          });
          stderrBuffer = "";
        }

        // Remove abort handler
        if (signal) {
          signal.removeEventListener("abort", abortHandler);
        }

        // Close readline — this drains any buffered lines before emitting 'close'.
        // We wait for readline 'close' before resolving to avoid a double-emit race
        // where the fallback error result fires before the last 'line' event fires.
        rl.on("close", () => {
          process.stderr.write(
            `[openhands-runtime] event=child_exit exit_code=${code ?? "null"} result_emitted=${processor.hasEmittedResult()}\n`,
          );

          if (!processor.hasEmittedResult()) {
            if (signal?.aborted) {
              process.stderr.write("[openhands-runtime] event=aborted emitting shutdown result\n");
              const shutdownResult = processor.buildErrorResult("Run aborted by caller");
              sink.emitAgentEvent({
                ...shutdownResult,
                status: "shutdown",
              });
            } else {
              const message =
                code !== 0 && code !== null
                  ? `OpenHands runner exited with code ${code}`
                  : "OpenHands runner exited without producing a result";
              process.stderr.write(
                `[openhands-runtime] event=no_result emitting error: ${message}\n`,
              );
              const errorResult = processor.buildErrorResult(message);
              sink.emitAgentEvent(errorResult);
            }
          }

          resolve();
        });

        rl.close();
      });

      child.on("error", (err: Error) => {
        const redactedMessage = redactApiKey(err.message, request.apiKey);
        process.stderr.write(`[openhands-runtime] event=spawn_error message=${redactedMessage}\n`);
        sink.emitRaw({
          type: "system",
          subtype: "sdk_stderr",
          data: `openhands-runtime: spawn error: ${redactedMessage}`,
          timestamp: Date.now(),
        });
        if (!processor.hasEmittedResult()) {
          const errorResult = processor.buildErrorResult(`Failed to spawn OpenHands runner: ${redactedMessage}`);
          sink.emitAgentEvent(errorResult);
        }
        resolve();
      });
    });
  }

  startStreamingSession(
    _request: StreamingSessionRequest,
    _sink: RuntimeSink,
  ): RuntimeSession {
    throw new Error("OpenHands streaming sessions are not yet supported");
  }
}
