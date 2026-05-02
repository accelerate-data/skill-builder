/**
 * OpenHands one-shot runtime adapter.
 *
 * Spawns the Python runner (`app/sidecar/openhands/runner.py`), writes a
 * serialized `OneShotRunRequest` to its stdin, and forwards app-framed
 * conversation JSONL lines from stdout into the sidecar runtime sink.
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

function buildRunnerCommand(request: OneShotRunRequest): {
  command: string;
  args: string[];
} {
  if (request.pathToOpenHandsRunner) {
    return { command: request.pathToOpenHandsRunner, args: [] };
  }

  return { command: "python3", args: [resolveRunnerPath()] };
}

// ---------------------------------------------------------------------------
// Sanitised environment
// ---------------------------------------------------------------------------

const ENV_ALLOWLIST = ["PATH", "HOME", "PYTHONPATH"] as const;

function buildRunnerEnv(request: OneShotRunRequest): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  return env;
}

function redactSecrets(text: string, secrets: string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret.length > 0) {
      redacted = redacted.replaceAll(secret, "[REDACTED]");
    }
  }
  return redacted;
}

function llmSecrets(request: OneShotRunRequest): string[] {
  return [
    request.llm?.apiKey,
    ...Object.values(request.llm?.extraHeaders ?? {}),
  ].filter((value): value is string => typeof value === "string");
}

function buildRunnerRequest(
  request: OneShotRunRequest,
): Record<string, unknown> {
  if (!request.llm) {
    throw new Error("OpenHands runtime requests require llm config");
  }

  return {
    mode: request.mode,
    prompt: request.prompt,
    systemPrompt: request.systemPrompt,
    taskKind: request.taskKind,
    userMessageSuffix: request.userMessageSuffix,
    agentName: request.agentName,
    llm: request.llm,
    workspaceRootDir: request.workspaceRootDir,
    workspaceSkillDir: request.workspaceSkillDir,
    allowedTools: request.allowedTools,
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
    if (!request.llm) {
      throw new Error("OpenHands runtime requests require llm config");
    }

    const runner = buildRunnerCommand(request);
    const env = buildRunnerEnv(request);
    const secrets = llmSecrets(request);

    process.stderr.write(
      `[openhands-runtime] event=spawn runner=${runner.command}${runner.args.length > 0 ? ` ${runner.args.join(" ")}` : ""}\n`,
    );

    const processor = new OpenHandsEventProcessor();

    return new Promise<void>((resolve) => {
      const child = child_process.spawn(runner.command, runner.args, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Wire abort signal to kill the child process
      const abortHandler = () => {
        process.stderr.write(
          "[openhands-runtime] event=abort killing child process\n",
        );
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

      let childProcessFailed = false;

      // Collect stderr from the Python runner and forward only to process stderr.
      let stderrBuffer = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.length > 0) {
            process.stderr.write(`${redactSecrets(line, secrets)}\n`);
          }
        }
      });

      // Process stdout line by line through the event processor
      const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });
      let childClosed = false;
      let readlineClosed = false;
      let childExitCode: number | null = null;
      let finished = false;

      rl.on("line", (line: string) => {
        try {
          processor.processLine(line, sink);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            `[openhands-runtime] error=line_processing message=${msg}\n`,
          );
        }
      });

      const finishWhenDrained = () => {
        if (finished) return;
        if (childProcessFailed) return;
        if (!childClosed || !readlineClosed) return;
        finished = true;

        process.stderr.write(
          `[openhands-runtime] event=child_exit exit_code=${childExitCode ?? "null"} terminal_state=${processor.hasTerminalState()}\n`,
        );

        if (!processor.hasTerminalState()) {
          if (signal?.aborted) {
            process.stderr.write(
              "[openhands-runtime] event=aborted emitting cancelled state\n",
            );
            sink.emitRaw(processor.buildCancelledState("Run aborted by caller"));
          } else {
            const message =
              childExitCode !== 0 && childExitCode !== null
                ? `OpenHands runner exited with code ${childExitCode}`
                : "OpenHands runner exited without producing a terminal conversation_state";
            process.stderr.write(
              `[openhands-runtime] event=no_terminal_state emitting error: ${message}\n`,
            );
            sink.emitRaw(processor.buildErrorState(message));
          }
        }

        resolve();
      };

      rl.on("close", () => {
        readlineClosed = true;
        finishWhenDrained();
      });

      child.on("close", (code: number | null) => {
        childClosed = true;
        childExitCode = code;

        // Flush any remaining stderr
        if (stderrBuffer.length > 0) {
          process.stderr.write(redactSecrets(stderrBuffer, secrets));
          stderrBuffer = "";
        }

        // Remove abort handler
        if (signal) {
          signal.removeEventListener("abort", abortHandler);
        }

        if (!readlineClosed) {
          rl.close();
        }
        finishWhenDrained();
      });

      child.on("error", (err: Error) => {
        childProcessFailed = true;
        const redactedMessage = redactSecrets(err.message, secrets);
        process.stderr.write(
          `[openhands-runtime] event=spawn_error message=${redactedMessage}\n`,
        );
        if (!processor.hasTerminalState()) {
          sink.emitRaw(
            processor.buildErrorState(
              `Failed to spawn OpenHands runner: ${redactedMessage}`,
            ),
          );
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
