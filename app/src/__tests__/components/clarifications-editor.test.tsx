import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClarificationsEditor } from "@/components/clarifications-editor";
import type { ClarificationsFile, Question } from "@/lib/clarifications-types";

// ─── Test Data Builders ───────────────────────────────────────────────────────

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "Q1",
    title: "Test Question",
    must_answer: false,
    text: "What is the answer?",
    choices: [
      { id: "A", text: "Choice A", is_other: false },
      { id: "B", text: "Choice B", is_other: false },
      { id: "D", text: "Other (please specify)", is_other: true },
    ],
    answer_choice: null,
    answer_text: null,
    refinements: [],
    ...overrides,
  };
}

function makeRefinement(overrides: Partial<Question> = {}): Question {
  return {
    id: "R1.1",
    title: "Refinement Question",
    must_answer: false,
    text: "Follow-up detail needed.",
    choices: [
      { id: "A", text: "Option Alpha", is_other: false },
      { id: "B", text: "Option Beta", is_other: false },
      { id: "D", text: "Other (please specify)", is_other: true },
    ],
    answer_choice: null,
    answer_text: null,
    refinements: [],
    ...overrides,
  };
}

function makeClarifications(questions: Question[]): ClarificationsFile {
  return {
    version: "1",
    metadata: {
      title: "Test Clarifications",
      question_count: questions.length,
      section_count: 1,
      refinement_count: questions.reduce((n, q) => n + q.refinements.length, 0),
      must_answer_count: questions.filter((q) => q.must_answer).length,
      priority_questions: questions.filter((q) => q.must_answer).map((q) => q.id),
    },
    sections: [{ id: "S1", title: "Test Section", questions }],
    notes: [],
    answer_evaluator_notes: [],
  };
}

function makeClarificationsWithSections(): ClarificationsFile {
  return {
    version: "1",
    metadata: {
      title: "Test Clarifications",
      question_count: 2,
      section_count: 2,
      refinement_count: 0,
      must_answer_count: 0,
      priority_questions: [],
    },
    sections: [
      {
        id: "S1",
        title: "Section One",
        questions: [makeQuestion({ id: "Q1", title: "Question One" })],
      },
      {
        id: "S2",
        title: "Section Two",
        questions: [makeQuestion({ id: "Q2", title: "Question Two" })],
      },
    ],
    notes: [],
    answer_evaluator_notes: [],
  };
}

/** Expand a question card by clicking its header button */
async function expandCard(user: ReturnType<typeof userEvent.setup>, titleText: string) {
  const button = screen.getByRole("button", { name: new RegExp(titleText) });
  await user.click(button);
}

// ─── Scenario A: Edit existing answered question ──────────────────────────────

describe("Scenario A: Edit existing answered question", () => {
  it("shows answer field when a choice is already selected", async () => {
    const user = userEvent.setup();
    const data = makeClarifications([
      makeQuestion({ id: "Q1", answer_choice: "A", answer_text: "Choice A" }),
    ]);
    render(<ClarificationsEditor data={data} onChange={vi.fn()} />);
    await expandCard(user, "Test Question");
    expect(screen.getByDisplayValue("Choice A")).toBeInTheDocument();
  });

  it("allows changing the selected choice", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const data = makeClarifications([
      makeQuestion({ id: "Q1", answer_choice: "A", answer_text: "Choice A" }),
    ]);
    render(<ClarificationsEditor data={data} onChange={onChange} />);
    await expandCard(user, "Test Question");
    await user.click(screen.getByRole("button", { name: /B\.\s*Choice B/i }));
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0] as ClarificationsFile;
    expect(updated.sections[0].questions[0].answer_choice).toBe("B");
  });
});

// ─── Scenario B: New refinement with choices, unanswered ──────────────────────

describe("Scenario B: Refinement with choices, answer_choice=null", () => {
  const dataWithRefinement = () => makeClarifications([
    makeQuestion({
      id: "Q1",
      answer_choice: "A",
      answer_text: "Choice A",
      refinements: [makeRefinement({ id: "R1.1" })],
    }),
  ]);

  it("shows refinement choices so user can select one", async () => {
    const user = userEvent.setup();
    render(<ClarificationsEditor data={dataWithRefinement()} onChange={vi.fn()} />);
    await expandCard(user, "Test Question");
    expect(screen.getByText("Option Alpha")).toBeInTheDocument();
    expect(screen.getByText("Option Beta")).toBeInTheDocument();
  });

  it("hides refinement answer field until a choice is selected", async () => {
    const user = userEvent.setup();
    render(<ClarificationsEditor data={dataWithRefinement()} onChange={vi.fn()} />);
    await expandCard(user, "Test Question");
    // Only the main question's answer textarea should exist (not the refinement's)
    const textareas = screen.getAllByRole("textbox");
    expect(textareas).toHaveLength(1);
    expect(textareas[0]).toHaveValue("Choice A");
  });

  it("selecting a refinement choice triggers onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ClarificationsEditor data={dataWithRefinement()} onChange={onChange} />);
    await expandCard(user, "Test Question");
    await user.click(screen.getByRole("button", { name: /A\.\s*Option Alpha/i }));
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0] as ClarificationsFile;
    const ref = updated.sections[0].questions[0].refinements[0];
    expect(ref.answer_choice).toBe("A");
    expect(ref.answer_text).toBe("Option Alpha");
  });
});

// ─── Scenario C: Refinement with NO choices (freeform only) ───────────────────

describe("Scenario C: Refinement with no choices", () => {
  const dataFreeform = () => makeClarifications([
    makeQuestion({
      id: "Q1",
      answer_choice: "A",
      answer_text: "Choice A",
      refinements: [makeRefinement({ id: "R1.1", choices: [] })],
    }),
  ]);

  it("shows answer field immediately (no choices to gate on)", async () => {
    const user = userEvent.setup();
    render(<ClarificationsEditor data={dataFreeform()} onChange={vi.fn()} />);
    await expandCard(user, "Test Question");
    // Main question textarea + refinement textarea
    const textareas = screen.getAllByRole("textbox");
    expect(textareas).toHaveLength(2);
  });

  it("allows typing freeform answer directly", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ClarificationsEditor data={dataFreeform()} onChange={onChange} />);
    await expandCard(user, "Test Question");
    const textareas = screen.getAllByRole("textbox");
    await user.type(textareas[1], "Free answer");
    expect(onChange).toHaveBeenCalled();
  });
});

// ─── Scenario D: Previously answered refinement ───────────────────────────────

describe("Scenario D: Previously answered refinement", () => {
  const dataAnswered = () => makeClarifications([
    makeQuestion({
      id: "Q1",
      answer_choice: "A",
      answer_text: "Choice A",
      refinements: [makeRefinement({ id: "R1.1", answer_choice: "B", answer_text: "Option Beta" })],
    }),
  ]);

  it("shows existing answer in the refinement textarea", async () => {
    const user = userEvent.setup();
    render(<ClarificationsEditor data={dataAnswered()} onChange={vi.fn()} />);
    await expandCard(user, "Test Question");
    expect(screen.getByDisplayValue("Option Beta")).toBeInTheDocument();
  });

  it("allows changing refinement choice", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ClarificationsEditor data={dataAnswered()} onChange={onChange} />);
    await expandCard(user, "Test Question");
    await user.click(screen.getByRole("button", { name: /A\.\s*Option Alpha/i }));
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0] as ClarificationsFile;
    const ref = updated.sections[0].questions[0].refinements[0];
    expect(ref.answer_choice).toBe("A");
    expect(ref.answer_text).toBe("Option Alpha");
  });
});

// ─── Scenario E: Recommendation badge ────────────────────────────────────────

describe("Scenario E: Recommendation badge", () => {
  it("shows 'recommended' badge on the recommended choice", async () => {
    const user = userEvent.setup();
    const data = makeClarifications([makeQuestion({ recommendation: "B" })]);
    render(<ClarificationsEditor data={data} onChange={vi.fn()} />);
    await expandCard(user, "Test Question");
    expect(screen.getByText("recommended")).toBeInTheDocument();
    // Badge is next to choice B, not A or D
    const choiceBBtn = screen.getByRole("button", { name: /B\.\s*Choice B/i });
    expect(choiceBBtn).toHaveTextContent("recommended");
    expect(screen.getByRole("button", { name: /A\.\s*Choice A/i })).not.toHaveTextContent("recommended");
  });

  it("stores the original choice text when the recommended choice is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const data = makeClarifications([makeQuestion({ recommendation: "B" })]);
    render(<ClarificationsEditor data={data} onChange={onChange} />);
    await expandCard(user, "Test Question");
    await user.click(screen.getByRole("button", { name: /B\.\s*Choice B/i }));
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[0][0] as ClarificationsFile;
    const q = updated.sections[0].questions[0];
    expect(q.answer_choice).toBe("B");
    expect(q.answer_text).toBe("Choice B"); // not "Choice B recommended"
  });

  it("handles legacy recommendation format 'B — rationale text'", async () => {
    const user = userEvent.setup();
    const data = makeClarifications([makeQuestion({ recommendation: "B — This is the best option." })]);
    render(<ClarificationsEditor data={data} onChange={vi.fn()} />);
    await expandCard(user, "Test Question");
    const choiceBBtn = screen.getByRole("button", { name: /B\.\s*Choice B/i });
    expect(choiceBBtn).toHaveTextContent("recommended");
  });
});

// ─── Main question answer field gating ────────────────────────────────────────

describe("Main question answer field visibility", () => {
  it("hides answer field when no choice selected and choices exist", async () => {
    const user = userEvent.setup();
    const data = makeClarifications([makeQuestion()]);
    render(<ClarificationsEditor data={data} onChange={vi.fn()} />);
    await expandCard(user, "Test Question");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows answer field for question with no choices", async () => {
    const user = userEvent.setup();
    const data = makeClarifications([makeQuestion({ choices: [] })]);
    render(<ClarificationsEditor data={data} onChange={vi.fn()} />);
    await expandCard(user, "Test Question");
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows answer field when question has answer_choice set", async () => {
    const user = userEvent.setup();
    // Render directly with answer_choice already set (as if choice was selected)
    const data = makeClarifications([makeQuestion({ answer_choice: "A", answer_text: "Choice A" })]);
    render(<ClarificationsEditor data={data} onChange={vi.fn()} />);
    await expandCard(user, "Test Question");
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Choice A")).toBeInTheDocument();
  });
});

describe("Need Review filter toggle", () => {
  it("shows only questions marked by evaluator feedback when enabled", async () => {
    const user = userEvent.setup();
    const data = makeClarifications([
      makeQuestion({ id: "Q1", title: "Answered Question", answer_choice: "A", answer_text: "Choice A" }),
      makeQuestion({ id: "Q2", title: "Unanswered Question", answer_choice: null, answer_text: null }),
    ]);
    data.answer_evaluator_notes = [
      {
        type: "answer_feedback",
        title: "Not answered: Q2",
        body: "This question is still unanswered.",
      },
    ];

    render(<ClarificationsEditor data={data} onChange={vi.fn()} />);
    expect(screen.getByText("Answered Question")).toBeInTheDocument();
    expect(screen.getByText("Unanswered Question")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Need Review" }));

    expect(screen.queryByText("Answered Question")).not.toBeInTheDocument();
    expect(screen.getByText("Unanswered Question")).toBeInTheDocument();
  });
});

describe("Inline evaluator feedback", () => {
  it("shows reason inline with the flagged question in context", async () => {
    const user = userEvent.setup();
    const data = makeClarifications([makeQuestion({ id: "Q1", title: "Flagged Question" })]);
    data.answer_evaluator_notes = [
      {
        type: "answer_feedback",
        title: "Vague answer: Q1",
        body: "Missing concrete thresholds.",
      },
    ];

    render(<ClarificationsEditor data={data} onChange={vi.fn()} />);
    await expandCard(user, "Flagged Question");

    expect(screen.getByText("Need Review: Vague")).toBeInTheDocument();
    expect(screen.getByText("Why flagged: Missing concrete thresholds.")).toBeInTheDocument();
  });
});

describe("Collapsible research notes", () => {
  it("toggles research notes visibility", async () => {
    const user = userEvent.setup();
    const data = makeClarifications([makeQuestion()]);
    data.notes = [{ type: "general", title: "Context", body: "Helpful implementation context." }];

    render(<ClarificationsEditor data={data} onChange={vi.fn()} />);

    const notesToggle = screen.getByRole("button", { name: /Research Notes/i });
    expect(notesToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Helpful implementation context.")).toBeInTheDocument();

    await user.click(notesToggle);
    expect(notesToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Helpful implementation context.")).not.toBeInTheDocument();

    await user.click(notesToggle);
    expect(notesToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Helpful implementation context.")).toBeInTheDocument();
  });
});

describe("Collapsible sections", () => {
  it("collapses sections independently", async () => {
    const user = userEvent.setup();
    const data = makeClarificationsWithSections();

    render(<ClarificationsEditor data={data} onChange={vi.fn()} />);

    expect(screen.getByText("Question One")).toBeInTheDocument();
    expect(screen.getByText("Question Two")).toBeInTheDocument();

    const sectionOneToggle = screen.getByRole("button", { name: /Section One/i });
    const sectionTwoToggle = screen.getByRole("button", { name: /Section Two/i });

    await user.click(sectionOneToggle);
    expect(sectionOneToggle).toHaveAttribute("aria-expanded", "false");
    expect(sectionTwoToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("Question One")).not.toBeInTheDocument();
    expect(screen.getByText("Question Two")).toBeInTheDocument();
  });

  it("supports keyboard toggle on section headers", async () => {
    const user = userEvent.setup();
    const data = makeClarificationsWithSections();

    render(<ClarificationsEditor data={data} onChange={vi.fn()} />);

    const sectionOneToggle = screen.getByRole("button", { name: /Section One/i });
    sectionOneToggle.focus();
    await user.keyboard("{Enter}");

    expect(sectionOneToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Question One")).not.toBeInTheDocument();
  });
});
