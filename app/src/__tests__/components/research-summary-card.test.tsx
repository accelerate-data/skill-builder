import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResearchSummaryCard } from "@/components/research-summary-card";
import type { ClarificationsFile } from "@/lib/clarifications-types";

vi.mock("@/components/clarifications-editor", () => ({
  ClarificationsEditor: () => <div data-testid="clarifications-editor" />,
}));

const clarificationsData: ClarificationsFile = {
  version: "1",
  metadata: {
    title: "Clarifications",
    question_count: 2,
    section_count: 1,
    refinement_count: 0,
    must_answer_count: 0,
    priority_questions: [],
    scope_recommendation: false,
    duplicates_removed: 0,
  },
  sections: [
    {
      id: "S1",
      title: "Section",
      questions: [
        {
          id: "Q1",
          title: "Q1",
          must_answer: false,
          text: "Question 1",
          choices: [],
          recommendation: null,
          answer_choice: null,
          answer_text: null,
          refinements: [],
        },
      ],
    },
  ],
  notes: [],
};

describe("ResearchSummaryCard", () => {
  it("infers selected dimensions from legacy table-only research-plan format", () => {
    const researchPlan = [
      "| Dimension | Score | Reasoning | Clarifications Needed |",
      "|-----------|-------|-----------|----------------------|",
      "| **Deal Structure & Typology** | 5 | Foundational | Clarify PS vs MS |",
      "| **PS-to-MRR Conversion Logic** | 5 | Core requirement | Clarify conversion method |",
      "| **Organizational Hierarchy & Attribution** | 5 | Needed for rollups | Clarify BU mapping |",
      "| **Sales Stage Definitions & Progression** | 4 | Needed for forecasting | Clarify probabilities |",
      "| **Revenue Recognition & Forecasting Methodology** | 4 | Needed for reporting | Clarify recognition windows |",
    ].join("\n");

    render(
      <ResearchSummaryCard
        researchPlan={researchPlan}
        clarificationsData={clarificationsData}
      />,
    );

    expect(screen.getByText("of 5 selected")).toBeInTheDocument();
    expect(screen.getByText("Deal Structure & Typology")).toBeInTheDocument();
    expect(screen.getByText("Revenue Recognition & Forecasting Methodology")).toBeInTheDocument();
  });
});
