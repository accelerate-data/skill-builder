import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { PLUGIN_DIR, CLAUDE_BIN, hasClaude } from "./helpers";

const AGENTS_DIR = path.join(PLUGIN_DIR, "agents");
const COORDINATOR = path.join(PLUGIN_DIR, "skills", "building-skills", "SKILL.md");
const REFS_DIR = path.join(PLUGIN_DIR, "skills", "building-skills", "references");
const PLUGIN_JSON = path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json");

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

// ── plugin.json ────────────────────────────────────────────────────────────

describe("plugin.json", () => {
  let pj: Record<string, unknown>;

  it("plugin.json exists", () => {
    expect(fs.existsSync(PLUGIN_JSON)).toBe(true);
    pj = JSON.parse(fs.readFileSync(PLUGIN_JSON, "utf8"));
  });

  it.each(["name", "version", "description", "skills"])(
    "has required field: %s",
    (field) => {
      pj ??= JSON.parse(fs.readFileSync(PLUGIN_JSON, "utf8"));
      expect(pj).toHaveProperty(field);
    }
  );

  it("version is 0.2.0", () => {
    pj ??= JSON.parse(fs.readFileSync(PLUGIN_JSON, "utf8"));
    expect(pj.version).toBe("0.2.0");
  });
});

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

// ── Coordinator skill ──────────────────────────────────────────────────────

describe("coordinator skill", () => {
  it("skills/building-skills/SKILL.md exists", () => {
    expect(fs.existsSync(COORDINATOR)).toBe(true);
  });

  it("coordinator has YAML frontmatter", () => {
    const first = fs.readFileSync(COORDINATOR, "utf8").split("\n")[0];
    expect(first).toBe("---");
  });

  it.each([
    "CLAUDE_PLUGIN_ROOT",
    "references/workspace-context.md",
    "skill-builder:",
    "session.json",
    "guided",
    "express",
    "iterative",
  ])("coordinator references: %s", (keyword) => {
    const content = fs.readFileSync(COORDINATOR, "utf8");
    expect(content).toContain(keyword);
  });
});

// ── Reference files ────────────────────────────────────────────────────────

describe("reference files", () => {
  it("references/ directory exists", () => {
    expect(fs.existsSync(REFS_DIR)).toBe(true);
  });

  it("workspace-context.md exists and is non-empty", () => {
    const p = path.join(REFS_DIR, "workspace-context.md");
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.statSync(p).size).toBeGreaterThan(100);
  });

  it.each([
    "skill-builder-practices/SKILL.md",
    "skill-builder-practices/references/ba-patterns.md",
    "skill-builder-practices/references/de-patterns.md",
    "file-formats.md",
  ])("reference file exists: %s", (ref) => {
    const p = path.join(REFS_DIR, ref);
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.statSync(p).size).toBeGreaterThan(100);
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

// ── validate.sh ───────────────────────────────────────────────────────────

describe("validate.sh", () => {
  it("passes structural validation", () => {
    const result = spawnSync(
      path.join(PLUGIN_DIR, "scripts", "validate.sh"),
      [],
      { encoding: "utf8", cwd: PLUGIN_DIR }
    );
    expect(result.status).toBe(0);
  });
});

// ── claude plugin validate (skipped if Claude binary not found) ────────────

describe("claude plugin validate", () => {
  it.skipIf(!hasClaude())("claude plugin validate passes", () => {
    const result = spawnSync(
      CLAUDE_BIN,
      ["plugin", "validate", PLUGIN_DIR],
      { encoding: "utf8", cwd: PLUGIN_DIR, timeout: 30_000 }
    );
    expect(result.status).toBe(0);
  });
});
