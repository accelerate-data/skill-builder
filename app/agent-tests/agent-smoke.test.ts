import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { HAS_API_KEY, REPO_ROOT, AGENTS_DIR, makeTempDir, runAgent, parseBudget } from "./helpers";
import {
  createFixtureScoping,
  createFixtureClarification,
  createFixtureT4Workspace,
  createFixtureRefinableSkill,
} from "./fixtures";

const SKILL_NAME = "pet-store-analytics";
// Per-test cap. Override precedence: MAX_BUDGET_AGENTS > MAX_BUDGET_WORKFLOW > 0.50
const BUDGET = parseBudget(
  process.env.MAX_BUDGET_AGENTS,
  process.env.MAX_BUDGET_WORKFLOW,
  "2.00"
);

let WORKSPACE_CONTEXT: string;
let REFINE_SKILL_INSTRUCTIONS: string;

beforeAll(() => {
  WORKSPACE_CONTEXT = fs.readFileSync(
    path.join(REPO_ROOT, "agent-sources", "workspace", "CLAUDE.md"),
    "utf8"
  );
  REFINE_SKILL_INSTRUCTIONS = fs
    .readFileSync(path.join(AGENTS_DIR, "refine-skill.md"), "utf8")
    .replace(/^---[\s\S]*?---\n/, ""); // strip YAML frontmatter
});

// ── research-orchestrator ────────────────────────────────────────────────────

describe.skipIf(!HAS_API_KEY)("research-orchestrator", () => {
  let researchDir: string;

  beforeAll(() => {
    researchDir = makeTempDir("agents-research");
    createFixtureScoping(researchDir, SKILL_NAME);

    const prompt = `You are the research-orchestrator agent for the skill-builder plugin.

Skill type: domain
Domain: Pet Store Analytics
Skill name: ${SKILL_NAME}
Context directory: ${researchDir}/${SKILL_NAME}/context
Workspace directory: ${researchDir}/.vibedata/skill-builder/${SKILL_NAME}

<agent-instructions>
${WORKSPACE_CONTEXT}
</agent-instructions>

Run the full research-orchestrator flow and write canonical outputs to:
- ${researchDir}/${SKILL_NAME}/context/research-plan.md
- ${researchDir}/${SKILL_NAME}/context/clarifications.json

The clarifications JSON MUST use the canonical schema (not legacy dimension/clarifications arrays):
{
  "version": "1",
  "metadata": {
    "title": "<string>",
    "question_count": <number>,
    "section_count": <number>,
    "refinement_count": <number>,
    "must_answer_count": <number>,
    "priority_questions": ["Q1"]
  },
  "sections": [
    {
      "id": "S1",
      "title": "<string>",
      "questions": [
        {
          "id": "Q1",
          "title": "<string>",
          "must_answer": <boolean>,
          "text": "<string>",
          "choices": [{"id":"A","text":"<string>","is_other":false}],
          "recommendation": "A",
          "answer_choice": null,
          "answer_text": null,
          "refinements": []
        }
      ]
    }
  ],
  "notes": []
}

Return JSON only:
{
  "status": "research_complete",
  "dimensions_selected": <number>,
  "question_count": <number>
}`;

    runAgent(prompt, BUDGET, 260_000, researchDir);
  }, 290_000);

  it("creates clarifications.json", { timeout: 260_000 }, () => {
    const p = path.join(researchDir, SKILL_NAME, "context", "clarifications.json");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("creates research-plan.md", { timeout: 260_000 }, () => {
    const p = path.join(researchDir, SKILL_NAME, "context", "research-plan.md");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("clarifications.json has canonical shape", { timeout: 260_000 }, () => {
    const p = path.join(researchDir, SKILL_NAME, "context", "clarifications.json");
    expect(fs.existsSync(p)).toBe(true);
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(data.version).toBe("1");
    expect(data.metadata).toBeTruthy();
    expect(typeof data.metadata.question_count).toBe("number");
    expect(Array.isArray(data.sections)).toBe(true);
  });
});

// ── answer-evaluator ─────────────────────────────────────────────────────────

describe.skipIf(!HAS_API_KEY)("answer-evaluator", () => {
  let evalDir: string;

  beforeAll(() => {
    evalDir = makeTempDir("agents-answer-eval");
    createFixtureClarification(evalDir, SKILL_NAME);

    const prompt = `You are the answer-evaluator agent for the skill-builder plugin.

Context directory: ${evalDir}/${SKILL_NAME}/context
Workspace directory: ${evalDir}/.vibedata/skill-builder/${SKILL_NAME}

<agent-instructions>
${WORKSPACE_CONTEXT}
</agent-instructions>

Read the clarification file at: ${evalDir}/${SKILL_NAME}/context/clarifications.json

Write your evaluation to: ${evalDir}/.vibedata/skill-builder/${SKILL_NAME}/answer-evaluation.json

The JSON must contain exactly these fields:
{
  "total_count": <number>,
  "answered_count": <number>,
  "empty_count": <number>,
  "vague_count": <number>,
  "contradictory_count": <number>,
  "verdict": "sufficient" | "mixed" | "insufficient",
  "per_question": [ ... ],
  "reasoning": "<brief explanation>"
}

Return: the evaluation JSON contents.`;

    runAgent(prompt, BUDGET, 120_000, evalDir);
  }, 135_000);

  it("creates answer-evaluation.json", { timeout: 135_000 }, () => {
    const p = path.join(evalDir, ".vibedata", "skill-builder", SKILL_NAME, "answer-evaluation.json");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("answer-evaluation.json has required fields and valid verdict", { timeout: 135_000 }, () => {
    const p = path.join(evalDir, ".vibedata", "skill-builder", SKILL_NAME, "answer-evaluation.json");
    expect(fs.existsSync(p)).toBe(true);
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(data).toHaveProperty("total_count");
    expect(data).toHaveProperty("answered_count");
    expect(data).toHaveProperty("empty_count");
    expect(data).toHaveProperty("vague_count");
    expect(data).toHaveProperty("contradictory_count");
    expect(data).toHaveProperty("per_question");
    expect(data).toHaveProperty("verdict");
    expect(data).toHaveProperty("reasoning");
    expect(["sufficient", "mixed", "insufficient"]).toContain(data.verdict);
    expect(Array.isArray(data.per_question)).toBe(true);
  });
});

// ── confirm-decisions ────────────────────────────────────────────────────────

describe.skipIf(!HAS_API_KEY)("confirm-decisions", () => {
  let decisionsDir: string;

  beforeAll(() => {
    decisionsDir = makeTempDir("agents-decisions");
    createFixtureT4Workspace(decisionsDir, SKILL_NAME);

    const prompt = `You are the confirm-decisions agent for the skill-builder plugin.

Skill type: domain
Domain: Pet Store Analytics
Skill name: ${SKILL_NAME}
Context directory: ${decisionsDir}/${SKILL_NAME}/context
Skill directory: ${decisionsDir}/${SKILL_NAME}
Workspace directory: ${decisionsDir}/.vibedata/skill-builder/${SKILL_NAME}

<agent-instructions>
${WORKSPACE_CONTEXT}
</agent-instructions>

Read the answered clarifications at: ${decisionsDir}/${SKILL_NAME}/context/clarifications.json

Synthesize the answers into concrete design decisions for the skill.
Write your decisions to: ${decisionsDir}/${SKILL_NAME}/context/decisions.md

Use canonical decisions format with YAML frontmatter and D-numbered headings (for example: ### D1:) containing:
- **Original question:**
- **Decision:**
- **Implication:**
- **Status:** resolved|conflict-resolved|needs-review

Return: path to decisions.md and a one-line summary of key decisions.`;

    runAgent(prompt, BUDGET, 120_000, decisionsDir);
  }, 270_000);

  it("creates decisions.md", { timeout: 260_000 }, () => {
    const p = path.join(decisionsDir, SKILL_NAME, "context", "decisions.md");
    expect(fs.existsSync(p)).toBe(true);
  });

  it("decisions.md has canonical decision structure", { timeout: 260_000 }, () => {
    const p = path.join(decisionsDir, SKILL_NAME, "context", "decisions.md");
    if (!fs.existsSync(p)) return;
    const content = fs.readFileSync(p, "utf8");
    expect(content).toMatch(/^---\n[\s\S]*?decision_count:/m);
    expect(content).toMatch(/^### D\d+:/m);
    expect(content).toMatch(/\*\*Original question:\*\*/);
    expect(content).toMatch(/\*\*Decision:\*\*/);
    expect(content).toMatch(/\*\*Implication:\*\*/);
    expect(content).toMatch(/\*\*Status:\*\*/);
  });
});

// ── refine-skill ─────────────────────────────────────────────────────────────

describe.skipIf(!HAS_API_KEY)("refine-skill: frontmatter description edits", () => {
  let refineDir: string;
  let skillMdPath: string;

  beforeAll(() => {
    refineDir = makeTempDir("agents-refine");
    createFixtureRefinableSkill(refineDir, SKILL_NAME);
    skillMdPath = path.join(refineDir, SKILL_NAME, "SKILL.md");

    const skillDir = path.join(refineDir, SKILL_NAME);
    const contextDir = path.join(refineDir, SKILL_NAME, "context");
    const workspaceDir = path.join(refineDir, ".vibedata", "skill-builder", SKILL_NAME);

    const prompt = `You are the refine-skill agent for the skill-builder plugin.

Skill directory: ${skillDir}
Context directory: ${contextDir}
Workspace directory: ${workspaceDir}
Skill type: domain
Command: refine

<agent-instructions>
${REFINE_SKILL_INSTRUCTIONS}
${WORKSPACE_CONTEXT}
</agent-instructions>

Current user message: Add to the description that this skill works well with dbt-testing when running test suites`;

    runAgent(prompt, BUDGET, 120_000, refineDir);
  }, 135_000);

  it("description field is updated with companion trigger", { timeout: 135_000 }, () => {
    if (!fs.existsSync(skillMdPath)) return;
    const fm = extractFrontmatter(skillMdPath);
    expect(fm).toMatch(/dbt.testing/i);
  });

  it("original description content is preserved", { timeout: 135_000 }, () => {
    if (!fs.existsSync(skillMdPath)) return;
    const fm = extractFrontmatter(skillMdPath);
    expect(fm).toContain("Guides data engineers");
  });

  it("modified date is updated after description edit", { timeout: 135_000 }, () => {
    if (!fs.existsSync(skillMdPath)) return;
    const fm = extractFrontmatter(skillMdPath);
    const modifiedMatch = fm.match(/^modified:\s*(.+)$/m);
    expect(modifiedMatch).not.toBeNull();
    expect(modifiedMatch![1].trim()).not.toBe("2026-01-15");
  });
});

function extractFrontmatter(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : "";
}
