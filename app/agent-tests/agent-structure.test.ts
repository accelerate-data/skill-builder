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
  const lines = content.split("\n").map(line => line.replace(/\r$/, ""));
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
      const firstLine = fs.readFileSync(file, "utf8").split("\n")[0].replace(/\r$/, "");
      return firstLine !== "---";
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
  // validate-skill/SKILL.md is excluded: it is a pure orchestrator that
  // spawns sub-agents for all file reads. Progressive discovery is enforced
  // by the spec files below, not by the orchestrator itself.
  const TARGET_FILES = [
    path.join(AGENTS_DIR, "generate-skill.md"),
    path.join(
      REPO_ROOT,
      "agent-sources/skills/validate-skill/references/validate-quality-spec.md"
    ),
    path.join(
      REPO_ROOT,
      "agent-sources/skills/validate-skill/references/test-skill-spec.md"
    ),
    path.join(
      REPO_ROOT,
      "agent-sources/skills/validate-skill/references/companion-recommender-spec.md"
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
        "agent-sources/skills/validate-skill/references/validate-quality-spec.md"
      ),
      "utf8"
    );
    const testSpec = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "agent-sources/skills/validate-skill/references/test-skill-spec.md"
      ),
      "utf8"
    );
    const companionSpec = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "agent-sources/skills/validate-skill/references/companion-recommender-spec.md"
      ),
      "utf8"
    );

    for (const content of [qualitySpec, testSpec, companionSpec]) {
      expect(content).toMatch(/metadata\.contradictory_inputs\s*==\s*"revised"/i);
      expect(content).toMatch(
        /\bread\b[^\n]{0,120}\bclarifications\.json\b[^\n]{0,120}\bin full\b/i
      );
      expect(content).not.toMatch(
        /\b(do not|don't|skip)\b[^\n]{0,120}\bclarifications\.json\b[^\n]{0,120}\bin full\b/i
      );
    }
  });
});

describe("Research scope guard contract prompts", () => {
  it("research orchestrator is thin and calls plugin research agent", () => {
    const content = fs.readFileSync(
      path.join(AGENTS_DIR, "research-orchestrator.md"),
      "utf8"
    );
    expect(content).toMatch(/thin wrapper around the plugin research agent/i);
    expect(content).toMatch(/subagent_type:\s*"skill-content-researcher:research-agent"/i);
    expect(content).not.toMatch(/Preflight scope guard requirements:/i);
  });

  it("research skill does not run preflight and emits low-score scope recommendation", () => {
    const content = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "agent-sources/plugins/skill-content-researcher/skills/research/SKILL.md",
      ),
      "utf8"
    );
    expect(content).not.toMatch(/Preflight Scope Guard/i);
    expect(content).toMatch(/topic_relevance[^\n]{0,80}not_relevant/i);
    expect(content).toMatch(/scope-recommendation clarifications output/i);
    expect(content).toMatch(/all_dimensions_low_score/);
  });

  it("scoring rubric stays scoring-only and delegates selection policy", () => {
    const content = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "agent-sources/plugins/skill-content-researcher/skills/research/references/scoring-rubric.md",
      ),
      "utf8"
    );
    expect(content).toMatch(/Do not perform selection or branching in this rubric output/i);
    expect(content).not.toMatch(/If all scores are <=2, trigger scope recommendation output/i);
  });

  it("detailed-research includes scope recommendation short-circuit contract", () => {
    const content = fs.readFileSync(
      path.join(AGENTS_DIR, "detailed-research.md"),
      "utf8"
    );
    expect(content).toMatch(/Scope (Recommendation )?[Gg]uard|scope_recommendation/);
    expect(content).toMatch(/status": "detailed_research_complete"/);
    expect(content).toMatch(/refinement_count": 0/);
    expect(content).toMatch(/section_count": 0/);
    expect(content).toMatch(/canonical clarifications object \(unchanged\)/i);
  });
});

// ── Agent output contracts (backend protocol alignment) ──────────────────────
//
// Each test checks that an agent's markdown contains the exact output keys
// the Rust backend expects. These are the contracts enforced by:
//   - workflow_output_format_for_agent() → structured output schema
//   - materialize_workflow_step_output_value() → materialization logic
//   - materialize_answer_evaluation_output_value() → answer-evaluator path

describe("Agent output contracts (backend protocol alignment)", () => {
  it("research-orchestrator returns research_complete envelope", () => {
    const content = fs.readFileSync(
      path.join(AGENTS_DIR, "research-orchestrator.md"),
      "utf8"
    );
    expect(content).toMatch(/status.*research_complete/);
    expect(content).toMatch(/dimensions_selected/);
    expect(content).toMatch(/question_count/);
    expect(content).toMatch(/research_output/);
  });

  it("confirm-decisions returns version/metadata/decisions shape", () => {
    const content = fs.readFileSync(
      path.join(AGENTS_DIR, "confirm-decisions.md"),
      "utf8"
    );
    // Backend uses additionalProperties: false — only version, metadata, decisions allowed at top level
    expect(content).toMatch(/"version"/);
    expect(content).toMatch(/"metadata"/);
    expect(content).toMatch(/"decisions"/);
    // Agent must document the three-key constraint explicitly
    expect(content).toMatch(/Top-level keys|version.*metadata.*decisions/i);
  });

  it("generate-skill returns generated status with evaluations_markdown", () => {
    const content = fs.readFileSync(
      path.join(AGENTS_DIR, "generate-skill.md"),
      "utf8"
    );
    expect(content).toMatch(/status.*generated/);
    expect(content).toMatch(/evaluations_markdown/);
  });

  it("answer-evaluator returns verdict enum and per_question array", () => {
    const content = fs.readFileSync(
      path.join(AGENTS_DIR, "answer-evaluator.md"),
      "utf8"
    );
    expect(content).toMatch(/"verdict"/);
    expect(content).toMatch(/sufficient|mixed|insufficient/);
    expect(content).toMatch(/"per_question"/);
    expect(content).toMatch(/"answered_count"/);
  });

  it("validate-skill agent returns validation_complete envelope with all four output keys", () => {
    const content = fs.readFileSync(
      path.join(AGENTS_DIR, "validate-skill.md"),
      "utf8"
    );
    expect(content).toMatch(/status.*validation_complete/);
    expect(content).toMatch(/validation_log_markdown/);
    expect(content).toMatch(/test_results_markdown/);
    expect(content).toMatch(/companion_skills_markdown/);
  });
});

// ── Plugin structure sanity checks ───────────────────────────────────────────

describe("skill-content-researcher plugin structure", () => {
  const pluginRoot = path.join(
    REPO_ROOT,
    "agent-sources",
    "plugins",
    "skill-content-researcher",
  );

  it("plugin manifest has required fields", () => {
    const manifestPath = path.join(pluginRoot, ".claude-plugin", "plugin.json");
    const raw = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw);

    expect(manifest.name).toBe("skill-content-researcher");
    expect(manifest.version).toBeDefined();
    expect(manifest.description).toBeDefined();
  });

  it("wrapper skill is user-invocable and delegates to plugin agent", () => {
    const wrapperPath = path.join(
      pluginRoot,
      "skills",
      "skill-content-researcher",
      "SKILL.md",
    );
    const content = fs.readFileSync(wrapperPath, "utf8");

    const fm = frontmatter(wrapperPath);
    expect(fm.name).toBe("skill-content-researcher");
    expect(fm.user_invocable).toBe("true");

    expect(content).toMatch(/AskUserQuestion/);
    expect(content).toMatch(/skill-content-researcher:research-agent/);
  });

  it("embedded research skill is internal-only (not user-invocable)", () => {
    const researchPath = path.join(
      pluginRoot,
      "skills",
      "research",
      "SKILL.md",
    );
    const fm = frontmatter(researchPath);
    expect(fm.user_invocable).toBe("false");
  });

  it("python normalizer tool is referenced from research-agent instructions", () => {
    const agentPath = path.join(
      pluginRoot,
      "agents",
      "research-agent.md",
    );
    const content = fs.readFileSync(agentPath, "utf8");
    expect(content).toMatch(/python3 ".claude\/plugins\/skill-content-researcher\/skills\/research\/tools\/normalize_research_output\.py"/);
  });
});

describe("skill-creator plugin structure", () => {
  const pluginRoot = path.join(
    REPO_ROOT,
    "agent-sources",
    "plugins",
    "skill-creator",
  );

  it("plugin manifest has required fields", () => {
    const manifestPath = path.join(pluginRoot, ".claude-plugin", "plugin.json");
    const raw = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw);

    expect(manifest.name).toBe("skill-creator");
    expect(manifest.version).toBeDefined();
    expect(manifest.description).toBeDefined();
  });

  it("skill-creator SKILL.md references bundled scripts and eval viewer via relative paths", () => {
    const skillPath = path.join(
      pluginRoot,
      "skills",
      "skill-creator",
      "SKILL.md",
    );
    const content = fs.readFileSync(skillPath, "utf8");

    // Aggregation + optimization scripts via python -m under scripts/
    expect(content).toMatch(/python -m scripts\.aggregate_benchmark/);
    expect(content).toMatch(/python -m scripts\.run_loop/);
    expect(content).toMatch(/python -m scripts\.package_skill/);

    // Eval viewer launched via relative eval-viewer/generate_review.py, no placeholder path
    expect(content).toMatch(/python eval-viewer\/generate_review\.py/);
    expect(content).not.toMatch(/<skill-creator-path>/);
  });

  it("detailed-research includes scope recommendation short-circuit contract", () => {
    const content = fs.readFileSync(
      path.join(AGENTS_DIR, "detailed-research.md"),
      "utf8"
    );
    expect(content).toMatch(/Scope (Recommendation )?[Gg]uard|scope_recommendation/);
    expect(content).toMatch(/status": "detailed_research_complete"/);
    expect(content).toMatch(/refinement_count": 0/);
    expect(content).toMatch(/section_count": 0/);
    expect(content).toMatch(/canonical clarifications object \(unchanged\)/i);
  });
});
