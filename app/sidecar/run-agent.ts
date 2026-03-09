import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SidecarConfig } from "./config.js";
import { runMockAgent } from "./mock-agent.js";
import { buildQueryOptions } from "./options.js";
import { createAbortState, linkExternalSignal } from "./shutdown.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Discover all installed plugins under <cwd>/.claude/plugins/.
 * Returns an absolute path for each subdirectory found there.
 */
async function discoverInstalledPlugins(cwd: string): Promise<string[]> {
  const pluginsDir = path.join(cwd, ".claude", "plugins");
  try {
    const entries = await fs.readdir(pluginsDir);
    return entries.map((entry) => path.join(pluginsDir, entry));
  } catch {
    return [];
  }
}

function inferPluginFromAgentName(agentName: string | undefined): string | null {
  if (!agentName) return null;
  const idx = agentName.indexOf(":");
  if (idx <= 0) return null;
  return agentName.slice(0, idx);
}

async function assertPluginInstalled(cwd: string, pluginName: string): Promise<void> {
  const manifestPath = path.join(
    cwd,
    ".claude",
    "plugins",
    pluginName,
    ".claude-plugin",
    "plugin.json",
  );
  if (!(await fileExists(manifestPath))) {
    throw new Error(`Required plugin '${pluginName}' not installed (missing ${manifestPath})`);
  }

  let parsed: PluginManifest;
  try {
    parsed = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as PluginManifest;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Required plugin '${pluginName}' has invalid manifest JSON (${manifestPath}): ${msg}`);
  }

  if (parsed.name !== pluginName) {
    throw new Error(
      `Required plugin '${pluginName}' manifest name mismatch: expected '${pluginName}', got '${String(
        parsed.name,
      )}'`,
    );
  }
}

async function assertRequiredPlugins(config: SidecarConfig): Promise<void> {
  const required = (config.requiredPlugins ?? []).filter((p) => p && p.trim().length > 0);
  const inferred = inferPluginFromAgentName(config.agentName);
  const all = inferred ? [...required, inferred] : required;
  const unique = [...new Set(all)];
  for (const pluginName of unique) {
    await assertPluginInstalled(config.cwd, pluginName);
  }
}

/**
 * Emit a system-level progress event (not an SDK message).
 * These events let the UI show granular status during initialization.
 */
export function emitSystemEvent(
  onMessage: (message: Record<string, unknown>) => void,
  subtype: string,
): void {
  onMessage({ type: "system", subtype, timestamp: Date.now() });
}

/**
 * Run a single agent request using the SDK.
 *
 * Streams each SDK message to the provided `onMessage` callback.
 * The callback receives raw SDK message objects (the caller is responsible
 * for any wrapping, e.g., adding `request_id`).
 *
 * @param config          The sidecar config for this request
 * @param onMessage       Called for each message from the SDK conversation
 * @param externalSignal  Optional AbortSignal to cancel from outside (e.g., when persistent-mode
 *                        aborts a stuck request to start a new one)
 */
export async function runAgentRequest(
  config: SidecarConfig,
  onMessage: (message: Record<string, unknown>) => void,
  externalSignal?: AbortSignal,
): Promise<void> {
  if (process.env.MOCK_AGENTS === "true") {
    process.stderr.write("[sidecar] Mock agent mode\n");
    return runMockAgent(config, onMessage, externalSignal);
  }

  const state = createAbortState();
  if (externalSignal) {
    linkExternalSignal(state, externalSignal);
  }

  // Preflight: validate required plugins are installed in this project workspace.
  await assertRequiredPlugins(config);

  // Discover all installed plugins so every plugin agent is available to the SDK.
  const pluginPaths = await discoverInstalledPlugins(config.cwd);

  // Route SDK subprocess stderr through onMessage so it gets wrapped with
  // request_id and written to the JSONL transcript (not the app log).
  const stderrHandler = (data: string) => {
    onMessage({ type: "system", subtype: "sdk_stderr", data: data.trimEnd(), timestamp: Date.now() });
  };

  const options = buildQueryOptions(config, state.abortController, pluginPaths, stderrHandler);

  // Emit plugins passed to the SDK as a system event so it appears in the JSONL transcript.
  const pluginsToLog = (options as Record<string, unknown>).plugins as unknown[] | undefined;
  onMessage({
    type: "system",
    subtype: "sdk_plugins_debug",
    plugins: pluginsToLog ?? [],
    timestamp: Date.now(),
  });

  // Notify the UI that we're about to initialize the SDK
  emitSystemEvent(onMessage, "init_start");

  process.stderr.write("[sidecar] Starting SDK query\n");
  const conversation = query({
    prompt: config.prompt,
    options,
  });

  // SDK is loaded and connected — ready to stream messages
  emitSystemEvent(onMessage, "sdk_ready");

  for await (const message of conversation) {
    if (state.abortController.signal.aborted) break;
    onMessage(message as Record<string, unknown>);
  }
}
