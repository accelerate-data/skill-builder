import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  id: 1,
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
  it("does not render legacy research dimension details", async () => {
    const user = userEvent.setup();
    render(
      <ResearchSummaryCard
        researchPlan={legacyResearchPlan}
        clarificationsData={clarificationsData}
      />,
    );

    await user.click(screen.getByText("Research Complete"));

    expect(screen.queryByText("Dimensions")).not.toBeInTheDocument();
    expect(screen.queryByText("of 5 selected")).not.toBeInTheDocument();
    expect(screen.queryByText("Deal Structure & Typology")).not.toBeInTheDocument();
    expect(screen.getByText("2 questions")).toBeInTheDocument();
  });

  it("shows Research Complete header and clarifications editor on happy path", () => {
    render(
      <ResearchSummaryCard
        researchPlan={emptyResearchPlan}
        clarificationsData={clarificationsData}
      />,
    );

    expect(screen.getByText("Research Complete")).toBeInTheDocument();
    expect(screen.getByTestId("clarifications-editor")).toBeInTheDocument();
  });

  it("shows Research Failed header with destructive banner when error is present", async () => {
    const user = userEvent.setup();
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
    expect(screen.queryByTestId("clarifications-editor")).not.toBeInTheDocument();

    // Expand the collapsible panel to reveal banner and reset button
    await user.click(screen.getByText("Research Failed"));

    expect(screen.getByText("User context is missing.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
  });

  it("shows Scope Too Broad header with amber banner for scope_guard_triggered", async () => {
    const user = userEvent.setup();
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
    expect(screen.queryByTestId("clarifications-editor")).not.toBeInTheDocument();

    // Expand the collapsible panel to reveal banner and reset button
    await user.click(screen.getByText("Scope Too Broad"));

    expect(screen.getByText("Scope is too broad to proceed.")).toBeInTheDocument();
    expect(screen.getByText("The topic covers too many domains.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
  });

  it("shows generic warning handling when warning code is unrecognized", async () => {
    const user = userEvent.setup();
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

    expect(screen.getByText("Research Warning")).toBeInTheDocument();
    await user.click(screen.getByText("Research Warning"));
    expect(screen.getByText("Unknown.")).toBeInTheDocument();
  });

  it("shows generic warning handling without dimension-specific display", async () => {
    const user = userEvent.setup();
    const data: ClarificationsFile = {
      version: "1",
      metadata: {
        ...baseMetadata,
        warning: { code: "research_warning" as "scope_guard_triggered", message: "Research produced a warning." },
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

    expect(screen.getByText("Research Warning")).toBeInTheDocument();
    expect(screen.queryByTestId("clarifications-editor")).not.toBeInTheDocument();

    await user.click(screen.getByText("Research Warning"));

    expect(screen.getByText("Research produced a warning.")).toBeInTheDocument();
    expect(screen.queryByText("Dimensions")).not.toBeInTheDocument();
    expect(screen.queryByText("of 5 selected")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
  });
});
