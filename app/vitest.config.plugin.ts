import { defineConfig } from "vitest/config";
import path from "path";

// Separate Vitest config for plugin tests.
// Uses Node environment (not jsdom) — plugin tests check files and spawn
// Claude CLI subprocesses. They do not use DOM, React, or Tauri APIs.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["plugin-tests/**/*.test.ts"],
    reporters: ["default", "junit"],
    outputFile: {
      junit: "./test-results/vitest-plugin-results.xml",
    },
    // Individual LLM tests can take up to 3 minutes (API latency + rate limits).
    // Structural tests are fast; LLM tests use per-test timeouts via describe/it options.
    testTimeout: 180_000,
    hookTimeout: 10_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
