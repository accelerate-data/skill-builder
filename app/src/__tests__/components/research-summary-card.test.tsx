import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResearchSummaryCard } from "@/components/research-summary-card";
import type { ClarificationsFile } from "@/lib/clarifications-types";

vi.mock("@/components/clarifications-editor", () => ({
  ClarificationsEditor: () => <div data-testid="clarifications-editor" />,
}));

const baseMetadata: ClarificationsFile["metadata"] = {
  title: "Clarifications",
  question_count: 2,
  section_count: 1,
  refinement_count: 0,
  must_answer_count: 0,
  priority_questions: [],
  scope_recommendation: false,
  duplicates_removed: 0,
};

const baseSection: ClarificationsFile["sections"][0] = {
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
};

const clarificationsData: ClarificationsFile = {
  version: "1",
  metadata: baseMetadata,
  sections: [baseSection],
  notes: [],
};

const emptyResearchPlan = "";

const legacyResearchPlan = [
  "| Dimension | Score | Reasoning | Clarifications Needed |",
  "|-----------|-------|-----------|----------------------|",
  "| **Deal Structure & Typology** | 5 | Foundational | Clarify PS vs MS |",
  "| **PS-to-MRR Conversion Logic** | 5 | Core requirement | Clarify conversion method |",
  "| **Organizational Hierarchy & Attribution** | 5 | Needed for rollups | Clarify BU mapping |",
  "| **Sales Stage Definitions & Progression** | 4 | Needed for forecasting | Clarify probabilities |",
  "| **Revenue Recognition & Forecasting Methodology** | 4 | Needed for reporting | Clarify recognition windows |",
].join("\n");

describe("ResearchSummaryCard", () => {
  it("infers selected dimensions from legacy table-only research-plan format", () => {
    render(
      <ResearchSummaryCard
        researchPlan={legacyResearchPlan}
        clarificationsData={clarificationsData}
      />,
    );

    expect(screen.getByText("of 5 selected")).toBeInTheDocument();
    expect(screen.getAllByText("Deal Structure & Typology").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Revenue Recognition & Forecasting Methodology").length).toBeGreaterThan(0);
  });

  it("shows Research Complete header and stats grid on happy path", () => {
    render(
      <ResearchSummaryCard
        researchPlan={emptyResearchPlan}
        clarificationsData={clarificationsData}
      />,
    );

    expect(screen.getByText("Research Complete")).toBeInTheDocument();
    expect(screen.getByText("Clarifications")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByTestId("clarifications-editor")).toBeInTheDocument();
  });

  it("shows Research Failed header with destructive banner when error is present", () => {
    const data: ClarificationsFile = {
      version: "1",
      metadata: {
        ...baseMetadata,
        error: { code: "missing_user_context", message: "User context is missing." },
      },
      sections: [],
      notes: [],
    };

    const onReset = vi.fn();
    render(
      <ResearchSummaryCard
        researchPlan={emptyResearchPlan}
        clarificationsData={data}
        onReset={onReset}
      />,
    );

    expect(screen.getByText("Research Failed")).toBeInTheDocument();
    expect(screen.getByText("User context is missing.")).toBeInTheDocument();
    expect(screen.queryByText("Clarifications")).not.toBeInTheDocument();
    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
    expect(screen.queryByTestId("clarifications-editor")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
  });

  it("shows Scope Too Broad header with amber banner for scope_guard_triggered", () => {
    const data: ClarificationsFile = {
      version: "1",
      metadata: {
        ...baseMetadata,
        warning: { code: "scope_guard_triggered", message: "Scope is too broad to proceed." },
        scope_reason: "The topic covers too many domains.",
      },
      sections: [],
      notes: [],
    };

    render(
      <ResearchSummaryCard
        researchPlan={emptyResearchPlan}
        clarificationsData={data}
        onReset={() => {}}
      />,
    );

    expect(screen.getByText("Scope Too Broad")).toBeInTheDocument();
    expect(screen.getByText("Scope is too broad to proceed.")).toBeInTheDocument();
    expect(screen.getByText("The topic covers too many domains.")).toBeInTheDocument();
    expect(screen.queryByText("Clarifications")).not.toBeInTheDocument();
    expect(screen.queryByTestId("clarifications-editor")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
  });

  it("falls through to happy path when warning code is unrecognized", () => {
    const data: ClarificationsFile = {
      version: "1",
      metadata: {
        ...baseMetadata,
        // Cast required because TypeScript enforces the union — but agent output is unchecked JSON
        warning: { code: "unknown_future_code" as "scope_guard_triggered", message: "Unknown." },
      },
      sections: [],
      notes: [],
    };

    render(
      <ResearchSummaryCard
        researchPlan={emptyResearchPlan}
        clarificationsData={data}
      />,
    );

    // Unknown warning code silently falls through to "ok" — documents the known behavior
    expect(screen.getByText("Research Complete")).toBeInTheDocument();
  });

  it("shows No Dimensions Selected header and Dimensions column for all_dimensions_low_score", () => {
    const data: ClarificationsFile = {
      version: "1",
      metadata: {
        ...baseMetadata,
        warning: { code: "all_dimensions_low_score", message: "All dimensions scored below threshold." },
      },
      sections: [],
      notes: [],
    };

    render(
      <ResearchSummaryCard
        researchPlan={legacyResearchPlan}
        clarificationsData={data}
        onReset={() => {}}
      />,
    );

    expect(screen.getByText("No Dimensions Selected")).toBeInTheDocument();
    expect(screen.getByText("All dimensions scored below threshold.")).toBeInTheDocument();
    expect(screen.getByText("Dimensions")).toBeInTheDocument();
    expect(screen.queryByText("Clarifications")).not.toBeInTheDocument();
    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
    expect(screen.queryByTestId("clarifications-editor")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
  });
});
