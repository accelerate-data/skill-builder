import { describe, expect, it } from "vitest";

import {
  mergeClarificationsAndRefinements,
  parseClarifications,
} from "@/lib/clarifications-types";

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

  it("reattaches refinements under their original parent question ids", () => {
    const clarifications = {
      version: "1",
      metadata: {
        title: "Clarifications",
        question_count: 1,
        section_count: 1,
        refinement_count: 0,
        must_answer_count: 0,
        priority_questions: [],
      },
      sections: [
        {
          id: 1,
          title: "Section",
          questions: [
            {
              id: "Q3",
              title: "Parent question",
              must_answer: false,
              text: "Base question",
              choices: [],
              answer_choice: null,
              answer_text: null,
              refinements: [],
            },
          ],
        },
      ],
      notes: [],
      answer_evaluator_notes: [],
    };
    const refinements = {
      skill_id: "42",
      version: "1",
      refinement_count: 1,
      must_answer_count: 0,
      question_count: 1,
      section_count: 1,
      title: "Refinements",
      created_at: 0,
      updated_at: 0,
      sections: [{ section_id: 3, ordinal: 0, title: "Parent section" }],
      questions: [
        {
          question_id: "R3.1",
          section_id: 3,
          ordinal: 0,
          title: "Child refinement",
          text: "Follow-up",
          must_answer: false,
          answer_choice: null,
          answer_text: null,
          recommendation: null,
          choices: [],
        },
      ],
      notes: [],
    };

    const merged = mergeClarificationsAndRefinements(
      clarifications,
      refinements,
    );

    expect(merged?.sections).toHaveLength(1);
    expect(merged?.sections[0]?.questions[0]?.refinements).toHaveLength(1);
    expect(merged?.sections[0]?.questions[0]?.refinements?.[0]?.id).toBe("R3.1");
  });

  it("orders merged sections by top-level question id instead of incoming section order", () => {
    const clarifications = {
      version: "1",
      metadata: {
        title: "Clarifications",
        question_count: 2,
        section_count: 2,
        refinement_count: 0,
        must_answer_count: 0,
        priority_questions: [],
      },
      sections: [
        {
          id: 6,
          title: "Pipeline Segmentation and Grain",
          questions: [
            {
              id: "Q6",
              title: "Pipeline Segmentation",
              must_answer: false,
              text: "Late-added question",
              choices: [],
              answer_choice: null,
              answer_text: null,
              refinements: [],
            },
          ],
        },
        {
          id: 2,
          title: "Probability Model",
          questions: [
            {
              id: "Q2",
              title: "Probability Model",
              must_answer: false,
              text: "Existing earlier question",
              choices: [],
              answer_choice: null,
              answer_text: null,
              refinements: [],
            },
          ],
        },
      ],
      notes: [],
      answer_evaluator_notes: [],
    };

    const merged = mergeClarificationsAndRefinements(clarifications, null);

    expect(merged?.sections.map((section) => section.title)).toEqual([
      "Probability Model",
      "Pipeline Segmentation and Grain",
    ]);
  });

});
