import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { AGENTS_DIR, REPO_ROOT } from "./helpers";

const EXPECTED_AGENTS = [
  "answer-evaluator",
  "confirm-decisions",
  "detailed-research",
  "generate-skill",
  "refine-skill",
  "research-orchestrator",
  "validate-skill",
];

const EXPECTED_MODELS: Record<string, string> = {
  "answer-evaluator": "haiku",
  "confirm-decisions": "opus",
};
const DEFAULT_MODEL = "sonnet";

function frontmatter(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  if (lines[0] !== "---") return {};
  const end = lines.indexOf("---", 1);
  if (end === -1) return {};
  const fm: Record<string, string> = {};
  lines.slice(1, end).forEach((line) => {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) fm[key.trim()] = rest.join(":").trim();
  });
  return fm;
}

// ── Agent files ────────────────────────────────────────────────────────────

describe("agent files", () => {
  it(`exactly ${EXPECTED_AGENTS.length} agent files exist`, () => {
    const count = fs
      .readdirSync(AGENTS_DIR)
      .filter((f) => f.endsWith(".md")).length;
    expect(count).toBe(EXPECTED_AGENTS.length);
  });

  it.each(EXPECTED_AGENTS)("agent exists: %s.md", (agent) => {
    expect(fs.existsSync(path.join(AGENTS_DIR, `${agent}.md`))).toBe(true);
  });

  it("all agents have YAML frontmatter", () => {
    const missing = EXPECTED_AGENTS.filter((agent) => {
      const file = path.join(AGENTS_DIR, `${agent}.md`);
      if (!fs.existsSync(file)) return true;
      return fs.readFileSync(file, "utf8").split("\n")[0] !== "---";
    });
    expect(missing).toHaveLength(0);
  });

  it.each(EXPECTED_AGENTS)("model tier correct: %s", (agent) => {
    const fm = frontmatter(path.join(AGENTS_DIR, `${agent}.md`));
    const expected = EXPECTED_MODELS[agent] ?? DEFAULT_MODEL;
    expect(fm.model).toBe(expected);
  });
});

// ── Canonical format compliance ────────────────────────────────────────────

describe("canonical format compliance", () => {
  const antiPatterns: Array<[string, RegExp]> = [
    ["**Answer**: (colon outside bold)", /\*\*Answer\*\*:/],
    ["**Recommendation**: (colon outside bold)", /\*\*Recommendation\*\*:/],
    ["checkbox choices", /^\s*- \[[ x]\]/m],
    ["**Choices**: label", /\*\*Choices\*\*[:\*]/],
    ["**Question**: label", /\*\*Question\*\*[:\*]/],
  ];

  it.each(
    EXPECTED_AGENTS.flatMap((agent) =>
      antiPatterns.map(([label, pattern]) => [agent, label, pattern] as const)
    )
  )("%s: no %s", (agent, _label, pattern) => {
    const content = fs.readFileSync(
      path.join(AGENTS_DIR, `${agent}.md`),
      "utf8"
    );
    expect(content).not.toMatch(pattern);
  });
});

// ── Read-directive compliance ───────────────────────────────────────────────

describe("read directive compliance", () => {
  const TARGET_FILES = [
    path.join(AGENTS_DIR, "generate-skill.md"),
    path.join(
      REPO_ROOT,
      "agent-sources/workspace/skills/validate-skill/SKILL.md"
    ),
    path.join(
      REPO_ROOT,
      "agent-sources/workspace/skills/validate-skill/references/validate-quality-spec.md"
    ),
    path.join(
      REPO_ROOT,
      "agent-sources/workspace/skills/validate-skill/references/test-skill-spec.md"
    ),
    path.join(
      REPO_ROOT,
      "agent-sources/workspace/skills/validate-skill/references/companion-recommender-spec.md"
    ),
  ];

  const bannedPatterns: Array<[string, RegExp]> = [
    ["blanket 'Read all files' directive", /\bRead all files\b/i],
    [
      "blanket 'Read all provided files' directive",
      /\bRead all provided files\b/i,
    ],
    [
      "up-front all references ingestion",
      /\ball\s+`?references\/?`?\s+files\b/i,
    ],
  ];

  it.each(
    TARGET_FILES.flatMap((file) =>
      bannedPatterns.map(([label, pattern]) => [file, label, pattern] as const)
    )
  )("%s: avoids %s", (file, _label, pattern) => {
    const content = fs.readFileSync(file, "utf8");
    expect(content).not.toMatch(pattern);
  });

  it.each(TARGET_FILES)("%s: requires progressive discovery language", (file) => {
    const content = fs.readFileSync(file, "utf8");
    expect(content).toMatch(/progressive|staged|demand-driven/i);
  });

  it("validate specs preserve full clarifications behavior with revised guard", () => {
    const qualitySpec = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "agent-sources/workspace/skills/validate-skill/references/validate-quality-spec.md"
      ),
      "utf8"
    );
    const testSpec = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "agent-sources/workspace/skills/validate-skill/references/test-skill-spec.md"
      ),
      "utf8"
    );
    const companionSpec = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "agent-sources/workspace/skills/validate-skill/references/companion-recommender-spec.md"
      ),
      "utf8"
    );

    for (const content of [qualitySpec, testSpec, companionSpec]) {
      expect(content).toMatch(/contradictory_inputs:\s*revised/i);
      expect(content).toMatch(
        /\bread\b[^\n]{0,120}\bclarifications\.json\b[^\n]{0,120}\bin full\b/i
      );
      expect(content).not.toMatch(
        /\b(do not|don't|skip)\b[^\n]{0,120}\bclarifications\.json\b[^\n]{0,120}\bin full\b/i
      );
    }
  });
});

describe("VU-448 preflight scope guard prompts", () => {
  it("research orchestrator requires preflight before fan-out", () => {
    const content = fs.readFileSync(
      path.join(AGENTS_DIR, "research-orchestrator.md"),
      "utf8"
    );
    expect(content).toMatch(/Preflight scope guard requirements:/);
    expect(content).toMatch(/before any dimension scoring or sub-agent fan-out/i);
    expect(content).toMatch(/do NOT spawn any dimension research sub-agents/i);
  });

  it("research skill codifies throwaway phrases and fallback bypass", () => {
    const content = fs.readFileSync(
      path.join(REPO_ROOT, "agent-sources/workspace/skills/research/SKILL.md"),
      "utf8"
    );
    expect(content).toMatch(/## Step 2 — Preflight Scope Guard/);
    expect(content).toMatch(/`testing`/);
    expect(content).toMatch(/`throwaway`/);
    expect(content).toMatch(/`ui test`/);
    expect(content).toMatch(/`just testing`/);
    expect(content).toMatch(/`nothing really`/);
    expect(content).toMatch(/Do not apply fallback dimension selection when Step 2 preflight guard matched/);
  });

  it("scoring rubric enforces preflight precedence and early return contract", () => {
    const content = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "agent-sources/workspace/skills/research/references/scoring-rubric.md"
      ),
      "utf8"
    );
    expect(content).toMatch(/Throwaway\/Test Intent Preflight \(runs before relevance scoring\)/);
    expect(content).toMatch(/Stop immediately \(no dimension scoring, no fallback dimension selection, no fan-out\)/);
    expect(content).toMatch(/Set `metadata\.scope_recommendation: true`/);
    expect(content).toMatch(/Do not trigger solely because domain text is short/);
    expect(content).toMatch(/If uncertain, continue to normal relevance\/scoring/);
  });
});
