/**
 * 5-category message classifier for raw SDK messages.
 *
 * Categories:
 * - hardNoise: filtered out (init events, config, sdk_stderr, sdk_plugins_debug)
 * - compact:   compaction boundary markers
 * - system:    system messages that should be forwarded to Rust for init-progress routing
 * - user:      tool_result messages
 * - ai:        assistant messages, result messages, error messages
 *
 * @module message-classifier
 */

import type { MessageCategory } from "./display-types.js";

/** System subtypes that are noise — no display value. */
const HARD_NOISE_SUBTYPES = new Set([
  "sdk_stderr",
  "sdk_plugins_debug",
]);

/** System subtypes that Rust routes to agent-init-progress. */
const INIT_PROGRESS_SUBTYPES = new Set([
  "init_start",
  "sdk_ready",
]);

/**
 * Classify a raw SDK message into one of 5 categories.
 *
 * @param raw  The raw SDK message object
 * @returns    The message category
 */
export function classifyRawMessage(raw: Record<string, unknown>): MessageCategory {
  const type = raw.type as string | undefined;

  if (!type) return "hardNoise";

  // --- config messages: forward as system so agent-store can extract
  //     thinkingEnabled and agentName from config.thinking / config.agentName ---
  if (type === "config") return "system";

  // --- system messages: split into noise vs. init-progress ---
  if (type === "system") {
    const subtype = raw.subtype as string | undefined;
    if (!subtype) return "hardNoise";

    if (HARD_NOISE_SUBTYPES.has(subtype)) return "hardNoise";
    if (subtype === "compact_boundary") return "compact";
    if (INIT_PROGRESS_SUBTYPES.has(subtype)) return "system";

    // init subtype carries session_id and model — forward as system
    if (subtype === "init") return "system";

    // Unknown system subtypes — forward as system to be safe
    return "system";
  }

  // --- user messages (tool_result blocks) ---
  if (type === "user") return "user";

  // --- auth_status messages carry authentication error details ---
  if (type === "auth_status") return "ai";

  // --- assistant, result, error → ai category ---
  if (type === "assistant" || type === "result" || type === "error") return "ai";

  // --- turn_complete, session_exhausted, request_complete → noise ---
  if (type === "turn_complete" || type === "session_exhausted" || type === "request_complete") {
    return "hardNoise";
  }

  // Unknown — treat as noise
  return "hardNoise";
}
