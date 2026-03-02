import { defineConfig } from "vitest/config";
import path from "path";

// Separate Vitest config for agent tests.
// Uses Node environment (not jsdom) — agent tests check files and spawn
// Claude CLI subprocesses. They do not use DOM, React, or Tauri APIs.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["agent-tests/**/*.test.ts"],
    reporters: ["default", "junit"],
    outputFile: {
      junit: "./test-results/vitest-agent-results.xml",
    },
    // Individual LLM tests can take up to 3 minutes (API latency + rate limits).
    // Structural tests are fast; LLM tests use per-test timeouts via describe/it options.
    // hookTimeout must cover the longest beforeAll — confirm-decisions chains two runAgent
    // calls with a combined 270s window.
    testTimeout: 180_000,
    hookTimeout: 300_000,
    // forks pool gives each test file a real child process with proper stdio
    // inheritance — worker threads intercept output through Vitest's TUI.
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
