import { describe, expect, it } from "vitest";

import { parseClarifications } from "@/lib/clarifications-types";

describe("parseClarifications", () => {
  it("parses canonical clarifications schema with numeric section id", () => {
    const input = JSON.stringify({
      version: "1",
      metadata: {
        title: "Clarifications: Demo",
        question_count: 1,
        section_count: 1,
        refinement_count: 0,
        must_answer_count: 1,
        priority_questions: ["Q1"],
      },
      sections: [
        {
          id: 1,
          title: "Section",
          questions: [
            {
              id: "Q1",
              title: "Question",
              must_answer: true,
              text: "Question text",
              choices: [],
              answer_choice: null,
              answer_text: null,
              refinements: [],
            },
          ],
        },
      ],
      notes: [],
    });

    const parsed = parseClarifications(input);
    expect(parsed).not.toBeNull();
    expect(parsed?.sections[0]?.id).toBe(1);
    expect(parsed?.sections[0]?.questions).toHaveLength(1);
  });

  it("parses canonical clarifications schema", () => {
    const input = JSON.stringify({
      version: "1",
      metadata: {
        title: "Clarifications: Demo",
        question_count: 1,
        section_count: 1,
        refinement_count: 0,
        must_answer_count: 1,
        priority_questions: ["Q1"],
      },
      sections: [
        {
          id: 1,
          title: "Section",
          questions: [
            {
              id: "Q1",
              title: "Question",
              must_answer: true,
              text: "Question text",
              choices: [],
              answer_choice: null,
              answer_text: null,
              refinements: [],
            },
          ],
        },
      ],
      notes: [],
    });

    const parsed = parseClarifications(input);
    expect(parsed).not.toBeNull();
    expect(parsed?.sections[0]?.id).toBe(1);
    expect(parsed?.sections[0]?.questions).toHaveLength(1);
  });

  it("preserves scope recommendation reason metadata fields", () => {
    const input = JSON.stringify({
      version: "1",
      metadata: {
        title: "Clarifications: Test Scope",
        question_count: 0,
        section_count: 0,
        refinement_count: 0,
        must_answer_count: 0,
        priority_questions: [],
        scope_recommendation: true,
        scope_reason: "Explicit throwaway intent detected in user context.",
        scope_next_action: "Provide a concrete production domain and rerun research.",
      },
      sections: [],
      notes: [],
    });

    const parsed = parseClarifications(input);
    expect(parsed).not.toBeNull();
    expect(parsed?.metadata.scope_recommendation).toBe(true);
    expect(parsed?.metadata.scope_reason).toContain("throwaway");
    expect(parsed?.metadata.scope_next_action).toContain("production domain");
  });

  it("passes through warning field from raw clarifications JSON", () => {
    const input = JSON.stringify({
      version: "1",
      metadata: {
        title: "Scope Guard",
        question_count: 0,
        section_count: 0,
        refinement_count: 0,
        must_answer_count: 0,
        priority_questions: [],
        scope_reason: "Topic spans multiple unrelated domains.",
        warning: {
          code: "scope_guard_triggered",
          message: "The requested skill scope is too broad.",
        },
      },
      sections: [],
      notes: [],
    });

    const parsed = parseClarifications(input);
    expect(parsed).not.toBeNull();
    expect(parsed?.metadata.warning?.code).toBe("scope_guard_triggered");
    expect(parsed?.metadata.warning?.message).toContain("too broad");
    expect(parsed?.metadata.scope_reason).toContain("unrelated domains");
  });

  it("passes through error field from raw clarifications JSON", () => {
    const input = JSON.stringify({
      version: "1",
      metadata: {
        title: "Error",
        question_count: 0,
        section_count: 0,
        refinement_count: 0,
        must_answer_count: 0,
        priority_questions: [],
        error: {
          code: "missing_user_context",
          message: "No user context file was found.",
        },
      },
      sections: [],
      notes: [],
    });

    const parsed = parseClarifications(input);
    expect(parsed).not.toBeNull();
    expect(parsed?.metadata.error?.code).toBe("missing_user_context");
    expect(parsed?.metadata.error?.message).toContain("user context");
  });

});
