import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { HAS_API_KEY, PLUGIN_DIR, makeTempDir, runClaude, parseBudget } from "./helpers";

const SKILL_NAME = "pet-store-analytics";
// Cap for the full workflow run. Set MAX_BUDGET_WORKFLOW=none for no cap.
const BUDGET = parseBudget(process.env.MAX_BUDGET_WORKFLOW, "5.00");
// 45 minutes — matches the bash harness timeout
const TIMEOUT_MS = 45 * 60 * 1000;

describe.skipIf(!HAS_API_KEY)("plugin::workflow", () => {
  let workspace: string;
  let skillDir: string;
  let contextDir: string;
  let workspaceDir: string;

  beforeAll(
    () => {
      workspace = makeTempDir("workflow-e2e");
      skillDir = path.join(workspace, SKILL_NAME);
      contextDir = path.join(skillDir, "context");
      workspaceDir = path.join(workspace, ".vibedata", SKILL_NAME);

      const prompt = `Run the generate-skill workflow (the skill-builder plugin's main skill).

Domain: pet store analytics
Skill name: ${SKILL_NAME}

IMPORTANT — AUTOMATED TEST RUN:
This is an automated test. At every confirmation gate or human review point,
treat the user as having confirmed and proceed immediately. Do not wait for input.
For any unanswered clarification questions, use the **Recommendation:** value as
the answer. Auto-advance through all phases.

Work in this directory: ${workspace}
The plugin root is: ${PLUGIN_DIR}

Complete all phases in order:
  Scoping → Research → Clarification → Decisions → Generation → Validation

If you hit a budget limit that's OK — go as far as you can.

When you finish (or are forced to stop), write the name of the last completed
phase to: ${workspace}/test-status.txt
(e.g., 'scoping', 'research', 'clarification', 'decisions', 'generation', or 'validation')`;

      runClaude(prompt, BUDGET, TIMEOUT_MS, workspace);
    },
    TIMEOUT_MS + 60_000
  );

  // ── Scoping ──────────────────────────────────────────────────────────────

  it("scoping: session.json created", () => {
    const p = path.join(workspaceDir, "session.json");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("scoping: session.json has required fields", () => {
    const p = path.join(workspaceDir, "session.json");
    expect(fs.existsSync(p)).toBe(true);
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const required = ["skill_name", "skill_type", "domain", "skill_dir", "current_phase", "mode"];
    for (const field of required) {
      expect(data).toHaveProperty(field);
    }
  });

  // ── Research ─────────────────────────────────────────────────────────────

  it("research: clarifications.md created", () => {
    const p = path.join(contextDir, "clarifications.md");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("research: clarifications.md has at least 5 questions", () => {
    const p = path.join(contextDir, "clarifications.md");
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, "utf8");
    const count = (content.match(/^### Q\d/gm) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(5);
  });

  // ── Decisions ────────────────────────────────────────────────────────────

  it("decisions: decisions.md created", () => {
    const p = path.join(contextDir, "decisions.md");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("decisions: decisions.md has at least 3 decisions", () => {
    const p = path.join(contextDir, "decisions.md");
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, "utf8");
    const count = (content.match(/^### D\d/gm) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  // ── Generation ───────────────────────────────────────────────────────────

  it("generation: SKILL.md created", () => {
    const p = path.join(skillDir, "SKILL.md");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("generation: references/ has at least 1 .md file", () => {
    const refsDir = path.join(skillDir, "references");
    expect(fs.existsSync(refsDir)).toBe(true);
    const count = fs.readdirSync(refsDir).filter((f) => f.endsWith(".md")).length;
    expect(count).toBeGreaterThan(0);
  });

  // ── Validation ───────────────────────────────────────────────────────────

  it("validation: agent-validation-log.md created", () => {
    const p = path.join(contextDir, "agent-validation-log.md");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("validation: test-skill.md created", () => {
    const p = path.join(contextDir, "test-skill.md");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("validation: companion-skills.md created", () => {
    const p = path.join(contextDir, "companion-skills.md");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("validation: companion-skills.md has required frontmatter fields", () => {
    const p = path.join(contextDir, "companion-skills.md");
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, "utf8");
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    expect(m).not.toBeNull();
    const fm = m![1];
    expect(fm).toMatch(/skill_name:/);
    expect(fm).toMatch(/skill_type:/);
    expect(fm).toMatch(/companions:/);
  });

  it("validation: companion-skills.md companions is a list", () => {
    const p = path.join(contextDir, "companion-skills.md");
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, "utf8");
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    expect(m).not.toBeNull();
    // companions: followed by at least one list item (- name:)
    expect(m![1]).toMatch(/companions:\s*\n\s+-\s/);
  });

  // ── Overall ──────────────────────────────────────────────────────────────

  it("reports a valid last completed phase", () => {
    const statusFile = path.join(workspace, "test-status.txt");
    expect(fs.existsSync(statusFile)).toBe(true);
    const phase = fs.readFileSync(statusFile, "utf8").trim();
    const validPhases = [
      "scoping",
      "research",
      "clarification",
      "clarification_interactive_pending",
      "refinement_pending",
      "refinement",
      "decisions",
      "generation",
      "validation",
    ];
    expect(validPhases).toContain(phase);
  });
});
