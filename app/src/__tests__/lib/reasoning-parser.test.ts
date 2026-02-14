import { describe, it, expect } from "vitest";
import {
  parseAgentResponseType,
  countDecisions,
  parseFrontmatter,
} from "@/lib/reasoning-parser";

describe("parseAgentResponseType", () => {
  it("detects gate check", () => {
    expect(
      parseAgentResponseType(
        "All clarifications are resolved and decisions are logged. Ready to proceed to skill creation?",
      ),
    ).toBe("gate_check");
  });

  it("detects gate check with 'proceed to build'", () => {
    expect(
      parseAgentResponseType("Everything looks good. Ready to proceed to the build step."),
    ).toBe("gate_check");
  });

  it("detects follow-up questions via heading", () => {
    expect(
      parseAgentResponseType(
        "## What I concluded\nSome analysis\n## Follow-up Questions\n### Q1: ...",
      ),
    ).toBe("follow_up");
  });

  it("detects follow-up questions via inline mention", () => {
    expect(
      parseAgentResponseType(
        "I have a few follow-up questions based on your responses.",
      ),
    ).toBe("follow_up");
  });

  it("follow-up takes priority over gate check when both present", () => {
    expect(
      parseAgentResponseType(
        "## Follow-up Questions\nQ1: Something\n\nOnce answered, we'll be ready to proceed to skill creation.",
      ),
    ).toBe("follow_up");
  });

  it("detects summary", () => {
    expect(
      parseAgentResponseType(
        "## What I concluded\nKey findings...\n## Assumptions I'm making\n...",
      ),
    ).toBe("summary");
  });

  it("detects summary with conflicts heading", () => {
    expect(
      parseAgentResponseType(
        "Here is my analysis:\n## Conflicts or tensions\nThere is a conflict between...",
      ),
    ).toBe("summary");
  });

  it("returns unknown for unrecognized text", () => {
    expect(parseAgentResponseType("Hello, I am reading the files now.")).toBe(
      "unknown",
    );
  });

  it("returns unknown for empty text", () => {
    expect(parseAgentResponseType("")).toBe("unknown");
  });
});

describe("countDecisions", () => {
  it("counts decision headings", () => {
    const content = [
      "## Decisions",
      "### D1: Use REST API",
      "- **Decision**: REST over GraphQL",
      "### D2: PostgreSQL for storage",
      "- **Decision**: PostgreSQL",
      "### D3: JWT authentication",
      "- **Decision**: JWT tokens",
    ].join("\n");

    expect(countDecisions(content)).toBe(3);
  });

  it("returns 0 for empty content", () => {
    expect(countDecisions("")).toBe(0);
  });

  it("returns 0 for content without decision headings", () => {
    expect(countDecisions("# Some other file\nNo decisions here.")).toBe(0);
  });
});

describe("parseFrontmatter", () => {
  it("parses numeric values", () => {
    const content = "---\ndecision_count: 5\nround: 2\n---\n\n## Decisions";
    const result = parseFrontmatter(content);
    expect(result).toEqual({ decision_count: 5, round: 2 });
  });

  it("parses string values", () => {
    const content = '---\ntitle: "My Skill"\n---\n\nContent';
    const result = parseFrontmatter(content);
    expect(result).toEqual({ title: "My Skill" });
  });

  it("parses array values", () => {
    const content = '---\nquestion_count: 8\nsections:\n  - "Entity Model"\n  - "Metrics"\n---\n\nContent';
    const result = parseFrontmatter(content);
    expect(result).toEqual({
      question_count: 8,
      sections: ["Entity Model", "Metrics"],
    });
  });

  it("returns null for content without frontmatter", () => {
    const content = "## Decisions\n\n### D1: Something";
    expect(parseFrontmatter(content)).toBeNull();
  });

  it("returns null for malformed frontmatter (no closing ---)", () => {
    const content = "---\ndecision_count: 5\n\n## Decisions";
    expect(parseFrontmatter(content)).toBeNull();
  });

  it("handles Windows-style line endings", () => {
    const content = "---\r\ndecision_count: 3\r\nround: 1\r\n---\r\n\r\n## Decisions";
    const result = parseFrontmatter(content);
    expect(result).toEqual({ decision_count: 3, round: 1 });
  });

  it("handles horizontal rules in body content", () => {
    const content = "---\ndecision_count: 2\n---\n\n## Section\n\nDivider:\n\n---\n\n### D1: First";
    const result = parseFrontmatter(content);
    expect(result).toEqual({ decision_count: 2 });
  });

  it("returns null for empty frontmatter block", () => {
    const content = "---\n\n---\n\n## Content";
    expect(parseFrontmatter(content)).toBeNull();
  });
});

describe("countDecisions with frontmatter", () => {
  it("uses frontmatter decision_count when available", () => {
    const content = "---\ndecision_count: 3\nround: 1\n---\n\n## Decisions\n\n### D1: First\n### D2: Second\n### D3: Third";
    expect(countDecisions(content)).toBe(3);
  });

  it("falls back to regex when no frontmatter", () => {
    const content = "## Decisions\n\n### D1: First\n### D2: Second";
    expect(countDecisions(content)).toBe(2);
  });

  it("falls back to regex when frontmatter has no decision_count", () => {
    const content = "---\nround: 1\n---\n\n## Decisions\n\n### D1: First";
    expect(countDecisions(content)).toBe(1);
  });
});
