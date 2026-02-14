#!/usr/bin/env node
/**
 * Thin bootstrap wrapper for the sidecar entry point.
 *
 * This file is NOT bundled by esbuild — it's copied as-is to dist/.
 * Its sole purpose is to catch module-load errors from agent-runner.js
 * (e.g., missing WASM files, native binary issues, SDK import failures)
 * and write them to stderr so the Rust side can surface them in the UI.
 *
 * Without this wrapper, if agent-runner.js fails during module evaluation,
 * Node.js exits with no stderr output — making the crash impossible to diagnose.
 */

import("./agent-runner.js").catch((err) => {
  const message = err instanceof Error ? (err.stack || err.message) : String(err);
  process.stderr.write(`[sidecar] Failed to load agent-runner.js: ${message}\n`);
  process.exit(1);
});
