import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./playwright-artifacts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["html"],
    ["junit", { outputFile: "./test-results/playwright-results.xml" }],
  ],
  use: {
    baseURL: "http://localhost:1420",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      // PR CI subset: fast functional checks for all main features
      name: "smoke",
      grep: /@workflow|@dashboard|@refine|@settings|@skill-tester|@setup/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Nightly / post-merge: real sidecar integration + full desktop smoke
      name: "nightly",
      grep: /@integration|@desktop-smoke/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev:test",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
