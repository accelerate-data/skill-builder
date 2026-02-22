import { describe, it, expect } from "vitest";
import { HAS_API_KEY, makeTempDir, runClaude, parseBudget } from "./helpers";

// Per-test cap. Override precedence: MAX_BUDGET_LOADING > MAX_BUDGET_WORKFLOW > 0.25
// Set any to "none" to run without a cap.
const BUDGET = parseBudget(
  process.env.MAX_BUDGET_LOADING,
  process.env.MAX_BUDGET_WORKFLOW,
  "0.25"
);

describe.skipIf(!HAS_API_KEY)("plugin loading", () => {
  it(
    "response acknowledges plugin capabilities",
    { timeout: 60_000 },
    () => {
      const dir = makeTempDir("loading-capabilities");
      const output = runClaude(
        "What can the skill-builder plugin help me with? What types of skills can it build?",
        BUDGET,
        45_000,
        dir
      );
      expect(output).toMatch(/plugin|skill|build|domain|platform|source|analytics|engineer/i);
    }
  );

  it(
    "skill can be triggered from natural language",
    { timeout: 75_000 },
    () => {
      const dir = makeTempDir("loading-natural-language");
      const output = runClaude(
        "I want to build a domain skill for pet-store analytics. What are the first steps? Be brief.",
        BUDGET,
        60_000,
        dir
      );
      expect(output).toMatch(/domain|skill|research|question|knowledge|analytics|pet/i);
    }
  );
});
