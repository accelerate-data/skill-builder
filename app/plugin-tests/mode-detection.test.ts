import { describe, it, expect, beforeAll } from "vitest";
import { HAS_API_KEY, makeTempDir, runClaude, parseBudget } from "./helpers";
import {
  createFixtureFresh,
  createFixtureScoping,
  createFixtureResearch,
  createFixtureClarification,
  createFixtureRefinementPending,
  createFixtureRefinement,
  createFixtureDecisions,
  createFixtureGeneration,
  createFixtureValidation,
} from "./fixtures";

const SKILL_NAME = "pet-store-analytics";
// Per-test cap. Override precedence: MAX_BUDGET_MODES > MAX_BUDGET_WORKFLOW > 0.25
const BUDGET = parseBudget(
  process.env.MAX_BUDGET_MODES,
  process.env.MAX_BUDGET_WORKFLOW,
  "0.25"
);

function phasePattern(phase: string): RegExp {
  switch (phase) {
    case "fresh":
      return /fresh|no.session|no.active|haven.t.started|empty.workspace|no.skill.session/i;
    case "scoping":
      return /scoping|scope|initial|setting.up|getting.started|skill.type/i;
    case "generation":
      return /generation|generat|skill\.md|skill.has.been|skill.file.exist/i;
    case "refinement_pending":
      return /refinement.pending|refinement|unanswered.refinement|pending.refinement/i;
    default:
      return new RegExp(phase, "i");
  }
}

// ── State detection ─────────────────────────────────────────────────────────

describe.skipIf(!HAS_API_KEY)(
  "state detection",
  { sequential: true },
  () => {
    const STATE_PROMPT =
      "What is the current phase of this skill session? Answer with just the phase name.";

    it("detects: fresh", { timeout: 75_000 }, () => {
      const dir = makeTempDir("modes-fresh");
      createFixtureFresh(dir);
      const output = runClaude(STATE_PROMPT, BUDGET, 60_000, dir);
      expect(output).toMatch(phasePattern("fresh"));
    });

    it("detects: scoping", { timeout: 75_000 }, () => {
      const dir = makeTempDir("modes-scoping");
      createFixtureScoping(dir, SKILL_NAME);
      const output = runClaude(STATE_PROMPT, BUDGET, 60_000, dir);
      expect(output).toMatch(phasePattern("scoping"));
    });

    it("detects: research", { timeout: 75_000 }, () => {
      const dir = makeTempDir("modes-research");
      createFixtureResearch(dir, SKILL_NAME);
      const output = runClaude(STATE_PROMPT, BUDGET, 60_000, dir);
      expect(output).toMatch(phasePattern("research"));
    });

    it("detects: clarification", { timeout: 75_000 }, () => {
      const dir = makeTempDir("modes-clarification");
      createFixtureClarification(dir, SKILL_NAME);
      const output = runClaude(STATE_PROMPT, BUDGET, 60_000, dir);
      expect(output).toMatch(phasePattern("clarification"));
    });

    it("detects: refinement_pending", { timeout: 75_000 }, () => {
      const dir = makeTempDir("modes-refinement-pending");
      createFixtureRefinementPending(dir, SKILL_NAME);
      const output = runClaude(STATE_PROMPT, BUDGET, 60_000, dir);
      expect(output).toMatch(phasePattern("refinement_pending"));
    });

    it("detects: refinement", { timeout: 75_000 }, () => {
      const dir = makeTempDir("modes-refinement");
      createFixtureRefinement(dir, SKILL_NAME);
      const output = runClaude(STATE_PROMPT, BUDGET, 60_000, dir);
      expect(output).toMatch(phasePattern("refinement"));
    });

    it("detects: decisions", { timeout: 75_000 }, () => {
      const dir = makeTempDir("modes-decisions");
      createFixtureDecisions(dir, SKILL_NAME);
      const output = runClaude(STATE_PROMPT, BUDGET, 60_000, dir);
      expect(output).toMatch(phasePattern("decisions"));
    });

    it("detects: generation", { timeout: 75_000 }, () => {
      const dir = makeTempDir("modes-generation");
      createFixtureGeneration(dir, SKILL_NAME);
      const output = runClaude(STATE_PROMPT, BUDGET, 60_000, dir);
      expect(output).toMatch(phasePattern("generation"));
    });

    it("detects: validation", { timeout: 75_000 }, () => {
      const dir = makeTempDir("modes-validation");
      createFixtureValidation(dir, SKILL_NAME);
      const output = runClaude(STATE_PROMPT, BUDGET, 60_000, dir);
      expect(output).toMatch(phasePattern("validation"));
    });
  }
);

// ── Intent dispatch ──────────────────────────────────────────────────────────
// Runs after a pause to allow rate-limit recovery from the 9 state-detection calls above.

describe.skipIf(!HAS_API_KEY)(
  "intent dispatch",
  { sequential: true },
  () => {
    beforeAll(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }, 20_000);

    it("new_skill intent enters scoping", { timeout: 135_000 }, () => {
      const dir = makeTempDir("modes-new-skill");
      createFixtureFresh(dir);
      const output = runClaude(
        "I want to build a domain skill for pet store analytics.",
        BUDGET,
        120_000,
        dir
      );
      expect(output).toMatch(
        /skill.type|domain|confirm|scoping|great|pet.store|analytics/i
      );
    });

    it("start_fresh intent offers reset", { timeout: 135_000 }, () => {
      const dir = makeTempDir("modes-start-fresh");
      createFixtureClarification(dir, SKILL_NAME);
      const output = runClaude("start over", BUDGET, 120_000, dir);
      expect(output).toMatch(
        /start.fresh|reset|start.over|fresh.start|scratch|new.session|clear|scoping|confirm/i
      );
    });

    it("targeted_edit intent enters iterative targeted path", { timeout: 135_000 }, () => {
      const dir = makeTempDir("modes-targeted-edit");
      createFixtureGeneration(dir, SKILL_NAME);
      // Higher budget: coordinator spawns refine-skill + validate-skill agents
      const output = runClaude(
        "Improve the metrics section of my skill.",
        parseBudget(process.env.MAX_BUDGET_MODES, process.env.MAX_BUDGET_WORKFLOW, "1.50"),
        120_000,
        dir
      );
      expect(output).toMatch(/refin|iterative|targeted|section|metrics|edit/i);
    });

    it("full_rewrite intent triggers rewrite", { timeout: 135_000 }, () => {
      const dir = makeTempDir("modes-full-rewrite");
      createFixtureGeneration(dir, SKILL_NAME);
      // Higher budget: coordinator spawns refine-skill (which runs generate-skill + validate-skill)
      const output = runClaude(
        "Regenerate the entire skill from scratch.",
        parseBudget(process.env.MAX_BUDGET_MODES, process.env.MAX_BUDGET_WORKFLOW, "1.50"),
        120_000,
        dir
      );
      expect(output).toMatch(/rewrite|regenerat|entire|whole|from.scratch/i);
    });

    it("process_question describes workflow modes", { timeout: 255_000 }, async () => {
      // Pause to allow rate-limit recovery after the preceding agent-spawning tests
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      const dir = makeTempDir("modes-express");
      createFixtureFresh(dir);
      const output = runClaude(
        "What workflow modes does this skill builder support? List them briefly.",
        "0.50",
        180_000,
        dir
      );
      expect(output).toMatch(
        /express|skip|research|decision|default|recommend/i
      );
    });
  }
);
