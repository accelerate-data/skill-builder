import { describe, expect, it } from "vitest";

import { parseClarifications } from "@/lib/clarifications-types";

describe("parseClarifications", () => {
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
          id: "S1",
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
    expect(parsed?.sections).toHaveLength(1);
    expect(parsed?.sections[0]?.questions).toHaveLength(1);
    expect(parsed?.metadata.priority_questions).toEqual(["Q1"]);
  });

  it("converts legacy dimensions schema into canonical sections/questions", () => {
    const input = JSON.stringify({
      metadata: {
        skill_name: "sales-pipeline",
        domain: "Sales Pipeline Analysis",
        scope_recommendation: false,
      },
      dimensions: [
        {
          id: "D1",
          name: "Deal Lifecycle",
          description: "Stage definitions",
          questions: [
            "What are the pipeline stages?",
            "How long does each stage take?",
          ],
        },
      ],
    });

    const parsed = parseClarifications(input);
    expect(parsed).not.toBeNull();
    expect(parsed?.metadata.title).toBe("Sales Pipeline Analysis");
    expect(parsed?.metadata.question_count).toBe(2);
    expect(parsed?.metadata.section_count).toBe(1);
    expect(parsed?.sections).toHaveLength(1);
    expect(parsed?.sections[0]?.id).toBe("D1");
    expect(parsed?.sections[0]?.questions).toHaveLength(2);
    expect(parsed?.sections[0]?.questions[0]?.id).toBe("D1.Q1");
    expect(parsed?.sections[0]?.questions[0]?.text).toBe("What are the pipeline stages?");
    expect(parsed?.sections[0]?.questions[0]?.must_answer).toBe(false);
  });
});
