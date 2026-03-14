/**
 * Sidecar bridge for integration tests.
 *
 * Spawns the real Node.js sidecar with MOCK_AGENTS=true and bridges its
 * JSONL stdout into Tauri events on the Playwright page, mirroring the
 * routing logic in app/src-tauri/src/agents/events.rs.
 *
 * Usage:
 *   const bridge = await createSidecarBridge();
 *   // navigate to page, wait for agent-initializing-indicator...
 *   await bridge.runAgent(page, "research-orchestrator", "agent-001");
 *   bridge.cleanup(); // in afterEach
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { emitTauriEvent } from "./agent-simulator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR_PATH = path.join(__dirname, "../../sidecar/dist/agent-runner.js");

export interface SidecarBridge {
  /** Temporary workspace directory the mock sidecar writes files into. */
  workspaceDir: string;
  /**
   * Run an agent through the real sidecar (MOCK_AGENTS=true), bridging every
   * event it emits into the browser page via window.__TAURI_EVENT_HANDLERS__.
   * Resolves once agent-exit has been emitted.
   */
  runAgent(
    page: Page,
    agentName: string,
    agentId: string,
    opts?: RunAgentOptions,
  ): Promise<void>;
  /**
   * Read a file written by the sidecar into the temp workspace.
   * Use for post-run assertions (e.g. verifying clarifications.json was written).
   */
  readWorkspaceFile(relativePath: string): string;
  /** Kill the sidecar process and delete the temp workspace. Call in afterEach. */
  cleanup(): void;
}

export interface RunAgentOptions {
  skillName?: string;
  stepId?: number;
  runSource?: string;
}

/**
 * Spawn the sidecar and wait for it to signal readiness.
 * Returns a SidecarBridge. Call cleanup() in afterEach.
 */
export async function createSidecarBridge(): Promise<SidecarBridge> {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-int-"));

  const proc = spawn("node", [SIDECAR_PATH, "--persistent"], {
    env: { ...process.env, MOCK_AGENTS: "true" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Forward sidecar stderr so failures are visible in test output.
  proc.stderr?.on("data", (d: Buffer) => {
    process.stderr.write(`[sidecar] ${d.toString()}`);
  });

  await waitForReady(proc);

  return {
    workspaceDir,
    runAgent: (page, agentName, agentId, opts) =>
      sendAgentRequest(proc, page, workspaceDir, agentName, agentId, opts ?? {}),
    readWorkspaceFile: (relativePath) =>
      fs.readFileSync(path.join(workspaceDir, relativePath), "utf-8"),
    cleanup() {
      try {
        proc.stdin?.end();
      } catch { /* ignore */ }
      try {
        proc.kill();
      } catch { /* ignore */ }
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function waitForReady(proc: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Sidecar startup timeout (10 s)")),
      10_000,
    );

    let buf = "";
    const onData = (data: Buffer) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          if ((JSON.parse(line) as { type: string }).type === "sidecar_ready") {
            clearTimeout(timer);
            proc.stdout!.off("data", onData);
            resolve();
            return;
          }
        } catch { /* non-JSON startup noise — ignore */ }
      }
    };

    proc.stdout!.on("data", onData);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Sidecar exited before ready (code ${String(code)})`));
    });
  });
}

async function sendAgentRequest(
  proc: ChildProcess,
  page: Page,
  workspaceDir: string,
  agentName: string,
  agentId: string,
  opts: RunAgentOptions,
): Promise<void> {
  const { skillName = "test-skill", stepId = 0, runSource = "workflow" } = opts;

  // mock-agent's parsePromptPaths extracts workspace/output dirs from these exact strings.
  const skillDir = path.join(workspaceDir, skillName);
  fs.mkdirSync(skillDir, { recursive: true });

  const prompt = [
    `The workspace directory is: ${skillDir}. `,
    `The skill output directory (SKILL.md and references/) is: ${skillDir}. `,
    `Task: ${agentName} for skill "${skillName}".`,
  ].join("\n");

  const request = {
    type: "agent_request",
    request_id: agentId,
    config: {
      prompt,
      apiKey: "mock-key-integration-test",
      cwd: skillDir,
      agentName,
      skillName,
      stepId,
      workflowSessionId: `int-wf-${agentId}`,
      usageSessionId: `int-usage-${agentId}`,
      runSource,
    },
  };

  proc.stdin!.write(JSON.stringify(request) + "\n");

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Agent run timed out: ${agentName} (${agentId})`)),
      30_000,
    );

    let buf = "";
    const onData = async (data: Buffer) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (msg.request_id !== agentId) continue;

        if (msg.type === "request_complete") {
          clearTimeout(timer);
          proc.stdout!.off("data", onData);
          // Mirror sidecar_pool.rs: emit agent-exit after request_complete.
          await emitTauriEvent(page, "agent-exit", { agent_id: agentId, success: true });
          resolve();
          return;
        }

        await routeToPage(page, agentId, msg);
      }
    };

    proc.stdout!.on("data", onData);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * Mirror events.rs#route_sidecar_message.
 *
 * agent_event subtypes → named frontend Tauri events
 * run_result           → skipped (Rust-only; written to SQLite)
 * everything else      → agent-message (ForwardAgentMessage path)
 */
async function routeToPage(
  page: Page,
  agentId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  // Strip the transport-level request_id before forwarding.
  const { request_id: _rid, ...msgBody } = msg;

  if (msg.type === "agent_event") {
    const event = msg.event as Record<string, unknown> | undefined;
    const eventType = event?.type as string | undefined;

    if (eventType === "run_result") return; // persist-only; no frontend event in E2E

    const nameMap: Record<string, string> = {
      run_config: "agent-run-config",
      run_init: "agent-run-init",
      turn_usage: "agent-turn-usage",
      compaction: "agent-compaction",
      context_window: "agent-context-window",
      session_exhausted: "agent-session-exhausted",
      init_progress: "agent-init-progress",
      turn_complete: "agent-turn-complete",
    };

    const tauriEvent = eventType ? nameMap[eventType] : undefined;
    if (tauriEvent && event) {
      const timestamp = (msg.timestamp as number) ?? Date.now();
      await emitTauriEvent(page, tauriEvent, { agent_id: agentId, timestamp, ...event });
    }
    return;
  }

  // display_item, result, system → forwarded as agent-message.
  await emitTauriEvent(page, "agent-message", { agent_id: agentId, message: msgBody });
}
