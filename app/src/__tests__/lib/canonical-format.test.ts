import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Resolve paths relative to the app directory.
// __dirname is src/__tests__/lib, so go up 3 levels to reach app/.
const APP_ROOT = path.resolve(__dirname, "../../..");
const MOCK_ROOT = path.join(APP_ROOT, "sidecar/mock-templates/outputs");
const FIXTURE_ROOT = path.join(APP_ROOT, "e2e/fixtures/agent-responses");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect files matching an extension from a directory */
function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Collect all .md files from mock templates and fixtures */
function collectMarkdownFiles(): string[] {
  const files: string[] = [];
  files.push(...findFiles(MOCK_ROOT, ".md"));
  files.push(...findFiles(FIXTURE_ROOT, ".md"));
  return files;
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function relPath(filePath: string): string {
  return path.relative(APP_ROOT, filePath);
}

// ---------------------------------------------------------------------------
// Anti-pattern checks (shared across all .md artifacts)
// ---------------------------------------------------------------------------

describe("Canonical format: anti-pattern checks (all markdown files)", () => {
  const mdFiles = collectMarkdownFiles();

  it("finds markdown files to check", () => {
    expect(mdFiles.length).toBeGreaterThan(0);
  });

  for (const file of mdFiles) {
    const rel = relPath(file);

    it(`${rel}: no **Answer**: (colon must be inside bold)`, () => {
      const content = readFile(file);
      expect(content).not.toMatch(/\*\*Answer\*\*:/);
    });

    it(`${rel}: no **Recommendation**: (colon must be inside bold)`, () => {
      const content = readFile(file);
      expect(content).not.toMatch(/\*\*Recommendation\*\*:/);
    });

    it(`${rel}: no checkbox choices (- [ ] / - [x])`, () => {
      const content = readFile(file);
      expect(content).not.toMatch(/^[ \t]*- \[[ x]\]/m);
    });

    it(`${rel}: no **Choices**: label`, () => {
      const content = readFile(file);
      expect(content).not.toMatch(/\*\*Choices\*\*[:\*]/);
    });

    it(`${rel}: no **Question**: label`, () => {
      const content = readFile(file);
      expect(content).not.toMatch(/\*\*Question\*\*[:\*]/);
    });

    it(`${rel}: no [MUST ANSWER] inline tags`, () => {
      const content = readFile(file);
      expect(content).not.toMatch(/\[MUST ANSWER\]/);
    });
  }
});

// ---------------------------------------------------------------------------
// clarifications.md structural checks (step0 + step2 + review-content.md)
// ---------------------------------------------------------------------------

describe("Canonical format: clarifications.md structure", () => {
  const clarificationFiles = [
    path.join(MOCK_ROOT, "step0/context/clarifications.md"),
    path.join(MOCK_ROOT, "step2/context/clarifications.md"),
    path.join(FIXTURE_ROOT, "review-content.md"),
  ].filter((f) => fs.existsSync(f));

  it("finds clarification files to check", () => {
    expect(clarificationFiles.length).toBeGreaterThan(0);
  });

  for (const file of clarificationFiles) {
    const rel = relPath(file);

    describe(rel, () => {
      const content = readFile(file);

      it("has YAML frontmatter with question_count", () => {
        expect(content).toMatch(/^---\n[\s\S]*?question_count:/m);
      });

      it("has YAML frontmatter with sections", () => {
        expect(content).toMatch(/^---\n[\s\S]*?sections:/m);
      });

      it("has YAML frontmatter with refinement_count", () => {
        expect(content).toMatch(/^---\n[\s\S]*?refinement_count:/m);
      });

      it("has ## section headings", () => {
        expect(content).toMatch(/^## [A-Z]/m);
      });

      it("has ### Q question headings", () => {
        expect(content).toMatch(/^### Q\d+:/m);
      });

      it("has **Answer:** fields", () => {
        expect(content).toMatch(/^\*\*Answer:\*\*/m);
      });

      it("has **Recommendation:** fields", () => {
        expect(content).toMatch(/^\*\*Recommendation:\*\*/m);
      });

      it("has A. lettered choices", () => {
        expect(content).toMatch(/^[A-D]\. /m);
      });

      it("has ### Required or ### Optional sub-headings", () => {
        expect(content).toMatch(/^### (Required|Optional)$/m);
      });
    });
  }

  // Step2-specific refinement checks
  const step2 = path.join(MOCK_ROOT, "step2/context/clarifications.md");
  if (fs.existsSync(step2)) {
    describe("step2 refinements", () => {
      const content = readFile(step2);

      it("has #### Refinements heading", () => {
        expect(content).toMatch(/^#### Refinements/m);
      });

      it("has ##### R{n}.{m} refinement headings", () => {
        expect(content).toMatch(/^##### R\d+\.\d+/m);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// decisions.md structural checks (step4)
// ---------------------------------------------------------------------------

describe("Canonical format: decisions.md structure", () => {
  const decisionsFile = path.join(MOCK_ROOT, "step4/context/decisions.md");

  it("decisions.md exists", () => {
    expect(fs.existsSync(decisionsFile)).toBe(true);
  });

  if (fs.existsSync(decisionsFile)) {
    const content = readFile(decisionsFile);

    it("has YAML frontmatter with decision_count", () => {
      expect(content).toMatch(/^---\n[\s\S]*?decision_count:/m);
    });

    it("has YAML frontmatter with conflicts_resolved", () => {
      expect(content).toMatch(/^---\n[\s\S]*?conflicts_resolved:/m);
    });

    it("has YAML frontmatter with round", () => {
      expect(content).toMatch(/^---\n[\s\S]*?round:/m);
    });

    it("has ### D{N}: decision headings (H3)", () => {
      expect(content).toMatch(/^### D\d+:/m);
    });

    it("no ## D{N}: headings (H2 is old format)", () => {
      expect(content).not.toMatch(/^## D\d+:/m);
    });

    it("has **Original question:** fields", () => {
      expect(content).toMatch(/\*\*Original question:\*\*/);
    });

    it("has **Decision:** fields", () => {
      expect(content).toMatch(/\*\*Decision:\*\*/);
    });

    it("has **Implication:** fields", () => {
      expect(content).toMatch(/\*\*Implication:\*\*/);
    });

    it("has **Status:** fields", () => {
      expect(content).toMatch(/\*\*Status:\*\*/);
    });

    it("has resolved status value", () => {
      expect(content).toMatch(/\*\*Status:\*\* resolved/);
    });
  }
});

// ---------------------------------------------------------------------------
// research-plan.md structural checks (step0)
// ---------------------------------------------------------------------------

describe("Canonical format: research-plan.md structure", () => {
  const researchPlan = path.join(MOCK_ROOT, "step0/context/research-plan.md");

  it("research-plan.md exists", () => {
    expect(fs.existsSync(researchPlan)).toBe(true);
  });

  if (fs.existsSync(researchPlan)) {
    const content = readFile(researchPlan);

    it("has frontmatter with skill_type", () => {
      expect(content).toMatch(/^---\n[\s\S]*?skill_type:/m);
    });

    it("has frontmatter with domain", () => {
      expect(content).toMatch(/^---\n[\s\S]*?domain:/m);
    });

    it("has frontmatter with dimensions_evaluated", () => {
      expect(content).toMatch(/^---\n[\s\S]*?dimensions_evaluated:/m);
    });

    it("has frontmatter with dimensions_selected", () => {
      expect(content).toMatch(/^---\n[\s\S]*?dimensions_selected:/m);
    });

    it("has ## Dimension Scores section", () => {
      expect(content).toMatch(/^## Dimension Scores/m);
    });

    it("has ## Selected Dimensions section", () => {
      expect(content).toMatch(/^## Selected Dimensions/m);
    });
  }
});

// ---------------------------------------------------------------------------
// answer-evaluation.json structural checks (gate mock)
// ---------------------------------------------------------------------------

describe("Canonical format: answer-evaluation.json structure", () => {
  const evalFile = path.join(
    MOCK_ROOT,
    "gate-answer-evaluator/answer-evaluation.json",
  );

  it("answer-evaluation.json exists", () => {
    expect(fs.existsSync(evalFile)).toBe(true);
  });

  if (fs.existsSync(evalFile)) {
    const raw = readFile(evalFile);

    it("is valid JSON", () => {
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    const data = JSON.parse(raw);

    it("has verdict field with valid value", () => {
      expect(data.verdict).toBeDefined();
      expect(["sufficient", "mixed", "insufficient"]).toContain(data.verdict);
    });

    it("has answered_count as number", () => {
      expect(typeof data.answered_count).toBe("number");
    });

    it("has empty_count as number", () => {
      expect(typeof data.empty_count).toBe("number");
    });

    it("has vague_count as number", () => {
      expect(typeof data.vague_count).toBe("number");
    });

    it("has total_count as number", () => {
      expect(typeof data.total_count).toBe("number");
    });

    it("has reasoning as string", () => {
      expect(typeof data.reasoning).toBe("string");
    });

    it("counts add up: answered + empty + vague == total", () => {
      expect(data.answered_count + data.empty_count + data.vague_count).toBe(
        data.total_count,
      );
    });

    it("has per_question array", () => {
      expect(Array.isArray(data.per_question)).toBe(true);
    });

    it("per_question length matches total_count", () => {
      expect(data.per_question.length).toBe(data.total_count);
    });

    it("per_question entries have question_id and verdict", () => {
      for (const entry of data.per_question) {
        expect(entry.question_id).toMatch(/^(Q\d+|R\d+\.\d+[a-z]?)$/);
        expect(["clear", "needs_refinement", "not_answered", "vague"]).toContain(entry.verdict);
      }
    });

    it("per_question verdict counts match aggregates", () => {
      const clear = data.per_question.filter(
        (e: { verdict: string }) => e.verdict === "clear",
      ).length;
      const needsRefinement = data.per_question.filter(
        (e: { verdict: string }) => e.verdict === "needs_refinement",
      ).length;
      const notAnswered = data.per_question.filter(
        (e: { verdict: string }) => e.verdict === "not_answered",
      ).length;
      const vague = data.per_question.filter(
        (e: { verdict: string }) => e.verdict === "vague",
      ).length;
      expect(clear + needsRefinement).toBe(data.answered_count);
      expect(notAnswered).toBe(data.empty_count);
      expect(vague).toBe(data.vague_count);
    });
  }
});

// ---------------------------------------------------------------------------
// test-skill.md structural checks (step6)
// ---------------------------------------------------------------------------

describe("Canonical format: test-skill.md structure", () => {
  const testSkillFile = path.join(MOCK_ROOT, "step6/context/test-skill.md");

  it("test-skill.md exists", () => {
    expect(fs.existsSync(testSkillFile)).toBe(true);
  });

  if (fs.existsSync(testSkillFile)) {
    const content = readFile(testSkillFile);

    it("has frontmatter with total_tests", () => {
      expect(content).toMatch(/^---\n[\s\S]*?total_tests:/m);
    });

    it("has frontmatter with passed", () => {
      expect(content).toMatch(/^---\n[\s\S]*?passed:/m);
    });

    it("has frontmatter with failed", () => {
      expect(content).toMatch(/^---\n[\s\S]*?failed:/m);
    });

    it("has ### Test entries", () => {
      expect(content).toMatch(/^### Test \d+:/m);
    });

    it("has Result with PASS/PARTIAL/FAIL", () => {
      expect(content).toMatch(/\*\*Result\*\*.*: (PASS|PARTIAL|FAIL)/);
    });
  }
});

// ---------------------------------------------------------------------------
// agent-validation-log.md structural checks (step6)
// ---------------------------------------------------------------------------

describe("Canonical format: agent-validation-log.md structure", () => {
  const validationLog = path.join(
    MOCK_ROOT,
    "step6/context/agent-validation-log.md",
  );

  it("agent-validation-log.md exists", () => {
    expect(fs.existsSync(validationLog)).toBe(true);
  });

  if (fs.existsSync(validationLog)) {
    const content = readFile(validationLog);

    it("has ## Structural Checks section", () => {
      expect(content).toMatch(/^## Structural Checks/m);
    });

    it("has ## Decision Coverage section", () => {
      expect(content).toMatch(/^## Decision Coverage/m);
    });

    it("has [PASS] or [FAIL] markers", () => {
      expect(content).toMatch(/\[(PASS|FAIL)\]/);
    });
  }
});

// ---------------------------------------------------------------------------
// companion-skills.md structural checks (step6)
// ---------------------------------------------------------------------------

describe("Canonical format: companion-skills.md structure", () => {
  const companionFile = path.join(
    MOCK_ROOT,
    "step6/context/companion-skills.md",
  );

  it("companion-skills.md exists", () => {
    expect(fs.existsSync(companionFile)).toBe(true);
  });

  if (fs.existsSync(companionFile)) {
    const content = readFile(companionFile);

    it("has frontmatter with skill_name", () => {
      expect(content).toMatch(/^---\n[\s\S]*?skill_name:/m);
    });

    it("has frontmatter with skill_type", () => {
      expect(content).toMatch(/^---\n[\s\S]*?skill_type:/m);
    });

    it("has frontmatter with companions", () => {
      expect(content).toMatch(/^---\n[\s\S]*?companions:/m);
    });
  }
});

// ---------------------------------------------------------------------------
// user-context.md — generated at runtime by Rust (format_user_context)
// ---------------------------------------------------------------------------

// Note: user-context.md is generated at runtime by the Rust function
// `format_user_context` in workflow.rs. Its format is validated by Rust
// unit tests (`cargo test commands::workflow`). No mock template exists
// for this artifact.
