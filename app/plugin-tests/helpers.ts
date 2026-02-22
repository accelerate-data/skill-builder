import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export const PLUGIN_DIR = path.resolve(__dirname, "../..");
export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
// True when API access is available. Checks for an API key OR the
// FORCE_PLUGIN_TESTS flag (set in .claude/settings.json for OAuth sessions).
export const HAS_API_KEY =
  !!process.env.ANTHROPIC_API_KEY || !!process.env.FORCE_PLUGIN_TESTS;

/**
 * Resolve the spending cap for a test tier.
 * Checks each value in order; returns the first that is set.
 * Pass "none" (or set MAX_BUDGET_WORKFLOW=none) to run without a cap.
 */
export function parseBudget(
  ...candidates: (string | undefined)[]
): string | null {
  for (const v of candidates) {
    if (v === "none") return null;
    if (v != null && v !== "") return v;
  }
  return null;
}

export function hasClaude(): boolean {
  const result = spawnSync("which", [CLAUDE_BIN], { encoding: "utf8" });
  return result.status === 0;
}

/** Create a temp directory for a test fixture, cleaned up automatically via afterAll. */
export function makeTempDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `skill-builder-test-${label}-`));
}

/**
 * Run Claude CLI with a prompt and return the stdout output.
 * Returns null if the process times out or exits non-zero.
 * Pass budgetUsd as null to run without a spending cap.
 */
export function runClaude(
  prompt: string,
  budgetUsd: string | null,
  timeoutMs: number,
  cwd: string
): string {
  // Unset CLAUDECODE to bypass the "nested session" check in the Claude CLI.
  // These tests must be run from a regular terminal (not inside Claude Code).
  // For OAuth users without ANTHROPIC_API_KEY, set FORCE_PLUGIN_TESTS=1 first.
  const env = { ...process.env, CLAUDECODE: undefined };

  const budgetArgs =
    budgetUsd != null ? ["--max-budget-usd", budgetUsd] : [];

  const result = spawnSync(
    CLAUDE_BIN,
    [
      "-p",
      "--plugin-dir",
      PLUGIN_DIR,
      "--dangerously-skip-permissions",
      ...budgetArgs,
    ],
    {
      input: prompt,
      encoding: "utf8",
      cwd,
      env,
      timeout: timeoutMs,
    }
  );

  if (result.error) {
    throw new Error(
      `runClaude: process error: ${result.error.message}\nstderr: ${result.stderr ?? ""}`
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `runClaude: exited with status ${result.status}\nstdout: ${result.stdout ?? ""}\nstderr: ${result.stderr ?? ""}`
    );
  }
  return (result.stdout ?? "").trim();
}
