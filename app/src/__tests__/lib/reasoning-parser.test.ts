import { describe, it, expect } from "vitest";
import {
  parseAgentResponseType,
  extractFollowUpSection,
  extractRoundNumber,
  countDecisions,
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

describe("extractFollowUpSection", () => {
  it("extracts questions after heading", () => {
    const text = [
      "## Reasoning Summary",
      "Some analysis here.",
      "## Follow-up Questions",
      "### Q1: What about edge cases?",
      "**Question**: How should we handle...",
      "### Q2: Data format?",
      "**Question**: What format...",
    ].join("\n");

    const result = extractFollowUpSection(text);
    expect(result).toContain("Q1: What about edge cases?");
    expect(result).toContain("Q2: Data format?");
  });

  it("extracts until next top-level heading", () => {
    const text = [
      "## Follow-up Questions — Round 2",
      "### Q1: Something?",
      "## Next Steps",
      "Proceed after answering.",
    ].join("\n");

    const result = extractFollowUpSection(text);
    expect(result).toContain("Q1: Something?");
    expect(result).not.toContain("Next Steps");
  });

  it("returns null when no follow-up section", () => {
    expect(extractFollowUpSection("Just some regular text.")).toBeNull();
  });

  it("handles h3 follow-up heading", () => {
    const text = "### Follow-up questions\n- Question 1?\n- Question 2?";
    const result = extractFollowUpSection(text);
    expect(result).toContain("Question 1?");
  });
});

describe("extractRoundNumber", () => {
  it("extracts round from heading", () => {
    expect(
      extractRoundNumber("## Follow-up Questions — Round 2"),
    ).toBe(2);
  });

  it("extracts round from body text", () => {
    expect(
      extractRoundNumber("This is round 3 of the analysis."),
    ).toBe(3);
  });

  it("returns null when no round mentioned", () => {
    expect(extractRoundNumber("Some text without round info.")).toBeNull();
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
