import { describe, expect, it } from "vitest";
import {
  summarizeCompletedRun,
  summarizeErrorRun,
  type ConversationStateForSummary,
} from "../../lib/openhands-result-summary";

function completed(
  partial: Partial<ConversationStateForSummary>,
): ConversationStateForSummary {
  return { status: "completed", ...partial };
}

describe("summarizeCompletedRun", () => {
  describe("Tier 1: research-complete", () => {
    it("renders dimensions and question count", () => {
      const result = summarizeCompletedRun(
        completed({
          resultText:
            '{"status":"research_complete","dimensions_selected":4,"question_count":10}',
        }),
      );
      expect(result.tier).toBe(1);
      expect(result.summary).toBe(
        "Research complete: 4 dimensions, 10 questions",
      );
    });

    it("renders zeros without falling through", () => {
      const result = summarizeCompletedRun(
        completed({
          resultText:
            '{"status":"research_complete","dimensions_selected":0,"question_count":0}',
        }),
      );
      expect(result.tier).toBe(1);
      expect(result.summary).toBe(
        "Research complete: 0 dimensions, 0 questions",
      );
    });

    it("falls through when status is scope_recommendation variant", () => {
      const result = summarizeCompletedRun(
        completed({
          resultText:
            '{"status":"scope_recommendation","dimensions_selected":4,"question_count":10}',
        }),
      );
      expect(result.tier).toBe(4);
      expect(result.summary).toBe(
        '{"status":"scope_recommendation","dimensions_selected":4,"question_count":10}',
      );
    });

    it("falls through to plain text when non-summary JSON is wrapped in prose", () => {
      const result = summarizeCompletedRun(
        completed({
          resultText: "Recommended scope follows.\n\nDetails.",
        }),
      );
      expect(result.tier).toBe(4);
      expect(result.summary).toBe("Recommended scope follows.");
    });
  });

  describe("Tier 2: answer-evaluator", () => {
    it("renders sufficient verdict", () => {
      const result = summarizeCompletedRun(
        completed({
          resultText:
            '{"verdict":"sufficient","answered_count":5,"total_count":5,"empty_count":0,"vague_count":0,"contradictory_count":0}',
        }),
      );
      expect(result.tier).toBe(2);
      expect(result.summary).toBe("Answers sufficient: 5/5");
    });

    it("renders insufficient verdict", () => {
      const result = summarizeCompletedRun(
        completed({
          resultText:
            '{"verdict":"insufficient","answered_count":5,"total_count":10}',
        }),
      );
      expect(result.tier).toBe(2);
      expect(result.summary).toBe("Answers insufficient: 5/10");
    });
  });

  describe("Tier 3: skill-generation success", () => {
    it("renders skill_generated", () => {
      const result = summarizeCompletedRun(
        completed({ resultText: '{"status":"skill_generated"}' }),
      );
      expect(result.tier).toBe(3);
      expect(result.summary).toBe("Skill generated");
    });

    it("renders skill_updated", () => {
      const result = summarizeCompletedRun(
        completed({ resultText: '{"status":"skill_updated"}' }),
      );
      expect(result.tier).toBe(3);
      expect(result.summary).toBe("Skill updated");
    });

    it("renders generation_complete as 'Skill generated'", () => {
      const result = summarizeCompletedRun(
        completed({ resultText: '{"status":"generation_complete"}' }),
      );
      expect(result.tier).toBe(3);
      expect(result.summary).toBe("Skill generated");
    });
  });

  describe("Tier 4: first non-empty line of result_text", () => {
    it("returns first line of plain markdown", () => {
      const result = summarizeCompletedRun(
        completed({
          resultText:
            "Updated the overview to clarify measurement criteria.\n\nDetails follow.",
        }),
      );
      expect(result.tier).toBe(4);
      expect(result.summary).toBe(
        "Updated the overview to clarify measurement criteria.",
      );
    });

    it("truncates long first lines to 77 chars + ellipsis", () => {
      const longLine = "A".repeat(200);
      const result = summarizeCompletedRun(
        completed({ resultText: longLine }),
      );
      expect(result.tier).toBe(4);
      expect(result.summary.length).toBe(80);
      expect(result.summary.endsWith("...")).toBe(true);
      expect(result.summary.slice(0, 77)).toBe("A".repeat(77));
    });

    it("falls through to tier 4 when parsed JSON does not match any earlier tier", () => {
      const result = summarizeCompletedRun(
        completed({
          resultText: "Some plain summary line.",
        }),
      );
      expect(result.tier).toBe(4);
      expect(result.summary).toBe("Some plain summary line.");
    });

    it("skips leading blank lines", () => {
      const result = summarizeCompletedRun(
        completed({ resultText: "\n\n  First real line.\nMore." }),
      );
      expect(result.tier).toBe(4);
      expect(result.summary).toBe("First real line.");
    });
  });

  describe("Tier 5: fallback", () => {
    it("returns 'Run completed' for empty state", () => {
      const result = summarizeCompletedRun(completed({}));
      expect(result.tier).toBe(5);
      expect(result.summary).toBe("Run completed");
    });

    it("returns 'Run completed' when result_text is whitespace only", () => {
      const result = summarizeCompletedRun(
        completed({ resultText: "   \n\n   " }),
      );
      expect(result.tier).toBe(5);
      expect(result.summary).toBe("Run completed");
    });
  });
});

describe("summarizeErrorRun", () => {
  it("renders error with detail", () => {
    const result = summarizeErrorRun({
      status: "error",
      errorDetail: "agent crashed",
    });
    expect(result.summary).toBe("OpenHands failed: agent crashed");
  });

  it("renders error without detail", () => {
    const result = summarizeErrorRun({ status: "error" });
    expect(result.summary).toBe("OpenHands failed");
  });

  it("renders cancelled", () => {
    const result = summarizeErrorRun({ status: "cancelled" });
    expect(result.summary).toBe("Cancelled by user");
  });

  it("returns defensive 'Run ended' for unknown terminal status", () => {
    const result = summarizeErrorRun({ status: "weird" });
    expect(result.summary).toBe("Run ended");
  });
});
