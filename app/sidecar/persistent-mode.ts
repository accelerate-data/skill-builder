import { createInterface, type Interface } from "node:readline";
import { type SidecarConfig, parseSidecarConfig } from "./config.js";
import { runMockAgent } from "./mock-agent.js";

/** Incoming request envelope: run an agent. */
interface AgentRequest {
  type: "agent_request";
  request_id: string;
  config: SidecarConfig;
}

/** Incoming shutdown envelope. */
interface ShutdownRequest {
  type: "shutdown";
}

/** Incoming ping envelope for heartbeat health checks. */
interface PingRequest {
  type: "ping";
}

/** Incoming cancel envelope: abort a specific in-flight request. */
interface CancelRequest {
  type: "cancel";
  request_id: string;
}

/** Union of all valid incoming messages. */
type IncomingMessage =
  | AgentRequest
  | ShutdownRequest
  | PingRequest
  | CancelRequest;

/**
 * Write a single JSON line to stdout.
 */
function writeLine(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

/**
 * Parse and validate an incoming JSON line.
 * Returns the parsed message or null if invalid.
 */
export function parseIncomingMessage(line: string): IncomingMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;

  if (obj.type === "shutdown") {
    return { type: "shutdown" };
  }

  if (obj.type === "ping") {
    return { type: "ping" };
  }

  if (obj.type === "cancel") {
    if (typeof obj.request_id !== "string" || !obj.request_id) return null;
    return { type: "cancel", request_id: obj.request_id };
  }

  if (obj.type === "agent_request") {
    if (typeof obj.request_id !== "string" || !obj.request_id) return null;
    if (typeof obj.config !== "object" || obj.config === null) return null;
    try {
      return {
        type: "agent_request",
        request_id: obj.request_id,
        config: parseSidecarConfig(obj.config),
      };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Wrap an SDK message with a request_id prefix.
 */
export function wrapWithRequestId(
  requestId: string,
  message: Record<string, unknown>,
): Record<string, unknown> {
  return { request_id: requestId, ...message };
}

const MOCK_ONLY_ERROR =
  "Claude Agent SDK has been removed. The Node sidecar only handles MOCK_AGENTS=true runs; all real agent requests must use the Rust-managed OpenHands Agent Server runtime.";

/**
 * Run the sidecar in persistent mode.
 *
 * - Emits `{"type":"sidecar_ready"}` on startup
 * - Reads stdin line-by-line for `agent_request` and `shutdown` messages
 * - Each `agent_request` with MOCK_AGENTS=true runs the mock agent and streams responses
 * - All non-mock requests return an error — real execution must use the OpenHands server
 * - `shutdown` causes a clean exit
 * - stdin close (pipe broken) causes a clean exit
 *
 * @param input   Readable stream (defaults to process.stdin)
 * @param exitFn  Exit function (defaults to process.exit)
 */
export async function runPersistent(
  input: NodeJS.ReadableStream = process.stdin,
  exitFn: (code: number) => void = (code) => process.exit(code),
): Promise<void> {
  // Signal readiness
  writeLine({ type: "sidecar_ready" });
  process.stderr.write("[sidecar] Persistent mode ready (mock-only)\n");

  const rl: Interface = createInterface({
    input,
    crlfDelay: Infinity,
  });

  // Track in-flight requests so we can wait for them before shutdown.
  const inFlight = new Set<Promise<void>>();
  let currentAbort: AbortController | null = null;
  let currentRequestId: string | null = null;

  for await (const line of rl) {
    const message = parseIncomingMessage(line);

    if (!message) {
      // Attempt to salvage a request_id from the raw JSON even though validation
      // failed, so Rust can associate the error with an in-flight request and
      // clean up pending state.
      let rawRequestId: string | undefined;
      try {
        const raw = JSON.parse(line.trim()) as Record<string, unknown>;
        if (typeof raw.request_id === "string") rawRequestId = raw.request_id;
      } catch {
        // Not valid JSON — nothing we can emit
      }
      if (rawRequestId) {
        writeLine({
          type: "error",
          request_id: rawRequestId,
          message: `Unrecognized input: ${line.trim().substring(0, 200)}`,
        });
      } else {
        process.stderr.write(
          `[persistent-mode] Unparseable line with no request_id (dropping): ${line.trim().substring(0, 100)}\n`,
        );
      }
      continue;
    }

    if (message.type === "ping") {
      writeLine({ type: "pong" });
      continue;
    }

    if (message.type === "shutdown") {
      process.stderr.write("[sidecar] Shutdown requested\n");
      // Wait for any in-flight one-shot requests to finish
      if (inFlight.size > 0) {
        await Promise.allSettled(inFlight);
      }
      rl.close();
      exitFn(0);
      return;
    }

    if (message.type === "cancel") {
      process.stderr.write(
        `[sidecar] Cancel request for ${message.request_id}\n`,
      );
      if (currentAbort && currentRequestId === message.request_id) {
        currentAbort.abort();
      }
      continue;
    }

    if (message.type === "agent_request") {
      // If a previous request is still in-flight, abort it before starting the new one.
      if (inFlight.size > 0 && currentAbort) {
        currentAbort.abort();
      }

      const { request_id, config } = message;
      process.stderr.write(`[sidecar] Agent request: ${request_id}\n`);

      const abortController = new AbortController();
      currentAbort = abortController;
      currentRequestId = request_id;

      const requestPromise = (async () => {
        try {
          if (process.env.MOCK_AGENTS !== "true") {
            // Non-mock requests cannot be handled by the sidecar after Claude SDK removal.
            throw new Error(MOCK_ONLY_ERROR);
          }
          process.stderr.write("[sidecar] Mock agent mode\n");
          await runMockAgent(
            config,
            (message) => writeLine(wrapWithRequestId(request_id, message)),
            abortController.signal,
          );
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          writeLine(
            wrapWithRequestId(request_id, {
              type: "error",
              message: errorMessage,
            }),
          );
        } finally {
          writeLine(
            wrapWithRequestId(request_id, { type: "request_complete" }),
          );
        }
      })();

      inFlight.add(requestPromise);
      requestPromise.finally(() => {
        inFlight.delete(requestPromise);
        if (currentAbort === abortController) {
          currentAbort = null;
          currentRequestId = null;
        }
      });
    }
  }

  // stdin closed (pipe broken) — exit gracefully
  if (inFlight.size > 0) {
    await Promise.allSettled(inFlight);
  }
  exitFn(0);
}
