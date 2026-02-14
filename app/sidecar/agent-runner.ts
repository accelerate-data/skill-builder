import { createAbortState, handleShutdown } from "./shutdown.js";
import { runPersistent } from "./persistent-mode.js";

const state = createAbortState();

process.on("SIGTERM", () => handleShutdown(state));
process.on("SIGINT", () => handleShutdown(state));

process.on("uncaughtException", (err) => {
  process.stderr.write(`[sidecar] Uncaught exception: ${err.stack || err.message}\n`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  process.stderr.write(`[sidecar] Unhandled rejection: ${msg}\n`);
  process.exit(1);
});

// Enter persistent mode when executed (directly or via bootstrap.js).
// Skip when imported for testing — test files never pass --persistent.
if (process.argv.includes("--persistent")) {
  runPersistent();
}
