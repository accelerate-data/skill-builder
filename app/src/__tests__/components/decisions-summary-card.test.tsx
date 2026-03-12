import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DecisionsSummaryCard, parseDecisions, serializeDecisions } from "@/components/decisions-summary-card";

// ─── Test Data (JSON format — matches production decisions.json) ─────────────

const sampleDecisions = JSON.stringify({
  version: "1",
  metadata: {
    decision_count: 3,
    conflicts_resolved: 1,
    round: 1,
  },
  decisions: [
    { id: "D1", title: "Customer Hierarchy", original_question: "How many levels should the customer hierarchy support?", decision: "Two levels — parent company and subsidiary", implication: "Need a self-referencing FK in dim_customer", status: "resolved" },
    { id: "D2", title: "Revenue Recognition", original_question: "When should revenue be recognized?", decision: "Track full lifecycle with invoice as primary event", implication: "PM said \"at invoicing\" but also answered \"track bookings\" — both imply lifecycle tracking", status: "conflict-resolved" },
    { id: "D3", title: "Pipeline Entry", original_question: "Which stage marks pipeline entry?", decision: "Any stage beyond Prospecting", implication: "Straightforward filter on stage sequence", status: "resolved" },
  ],
}, null, 2);

const contradictoryDecisions = JSON.stringify({
  version: "1",
  metadata: {
    decision_count: 2,
    conflicts_resolved: 0,
    round: 1,
    contradictory_inputs: true,
  },
  decisions: [
    { id: "D1", title: "Revenue Model", original_question: "Should we track revenue?", decision: "Track MRR", implication: "Contradicts Q5 answer which said \"don't track revenue\"", status: "needs-review" },
    { id: "D2", title: "Pipeline Scope", original_question: "What's in scope?", decision: "All deals", implication: "Clear scope", status: "resolved" },
  ],
}, null, 2);

const multiContradictoryDecisions = JSON.stringify({
  version: "1",
  metadata: {
    decision_count: 3,
    conflicts_resolved: 0,
    round: 1,
    contradictory_inputs: true,
  },
  decisions: [
    { id: "D1", title: "Revenue Model", original_question: "Should we track revenue?", decision: "Track MRR", implication: "Contradicts Q5", status: "needs-review" },
    { id: "D2", title: "Pipeline Scope", original_question: "What pipeline stages?", decision: "All stages", implication: "Contradicts Q3 which said top-of-funnel only", status: "needs-review" },
    { id: "D3", title: "Resolved Item", original_question: "Format?", decision: "JSON", implication: "Clear", status: "resolved" },
  ],
}, null, 2);

// ─── Summary Card Stats ───────────────────────────────────────────────────────

describe("DecisionsSummaryCard — Summary Stats", () => {
  it("shows ready-to-proceed action header for clean decisions", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    expect(screen.getByText("Decisions confirmed")).toBeInTheDocument();
    expect(screen.getByText("No contradictions were found. You can proceed to Generate Skill.")).toBeInTheDocument();
  });

  it("shows summary chips instead of quality columns", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    expect(screen.getByText("3 total")).toBeInTheDocument();
    expect(screen.getByText("2 resolved")).toBeInTheDocument();
    expect(screen.getByText("1 conflict resolved")).toBeInTheDocument();
  });

  it("shows the action message in the main header", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    expect(screen.getByText("Decisions confirmed")).toBeInTheDocument();
  });

  it("shows duration and cost when provided", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} duration={125000} cost={0.5234} />);
    expect(screen.getAllByText("2m 5s").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("$0.5234").length).toBeGreaterThanOrEqual(1);
  });

  it("does not show review-required copy when flag is absent", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    expect(screen.queryByText(/need your review/)).not.toBeInTheDocument();
  });
});

// ─── Contradictory Inputs ─────────────────────────────────────────────────────

describe("DecisionsSummaryCard — Contradictory Inputs", () => {
  it("shows review-required action header", () => {
    render(<DecisionsSummaryCard decisionsContent={contradictoryDecisions} />);
    expect(screen.getByText("1 decision needs your review")).toBeInTheDocument();
    expect(screen.getByText(/Review the highlighted decisions below/)).toBeInTheDocument();
  });

  it("shows needs-review count", () => {
    render(<DecisionsSummaryCard decisionsContent={contradictoryDecisions} />);
    expect(screen.getByText("1 needs review")).toBeInTheDocument();
  });

  it("shows needs review toggle inside the summary panel", () => {
    render(<DecisionsSummaryCard decisionsContent={contradictoryDecisions} />);
    expect(screen.getByLabelText("Needs Review")).toBeInTheDocument();
  });
});

// ─── Decision Cards ───────────────────────────────────────────────────────────

describe("DecisionsSummaryCard — Decision Cards", () => {
  it("renders a card for each decision", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.getByText("D2")).toBeInTheDocument();
    expect(screen.getByText("D3")).toBeInTheDocument();
  });

  it("shows decision titles", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    expect(screen.getByText("Customer Hierarchy")).toBeInTheDocument();
    expect(screen.getByText("Revenue Recognition")).toBeInTheDocument();
    expect(screen.getByText("Pipeline Entry")).toBeInTheDocument();
  });

  it("shows status badges", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    const badges = screen.getAllByText("resolved");
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/conflict resolved/i).length).toBeGreaterThanOrEqual(1);
  });

  it("shows decision preview text when collapsed", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    expect(screen.getByText(/Two levels — parent company/)).toBeInTheDocument();
  });

  it("expands to show full details on click", async () => {
    const user = userEvent.setup();
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    await user.click(screen.getByRole("button", { name: /Customer Hierarchy/ }));
    expect(screen.getByText(/How many levels should the customer hierarchy/)).toBeInTheDocument();
    expect(screen.getByText(/self-referencing FK/)).toBeInTheDocument();
  });

  it("shows needs-review badge for contradictory decisions", () => {
    render(<DecisionsSummaryCard decisionsContent={contradictoryDecisions} />);
    expect(screen.getAllByText("needs review").length).toBeGreaterThanOrEqual(1);
  });

  it("filters to only needs-review decisions when toggle is enabled", async () => {
    const user = userEvent.setup();
    render(<DecisionsSummaryCard decisionsContent={contradictoryDecisions} />);

    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.getByText("D2")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Needs Review"));

    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.queryByText("D2")).not.toBeInTheDocument();
  });

  it("keeps the Needs Review toggle visible even when only revised decisions remain", async () => {
    const revisedOnlyContent = JSON.stringify({
      version: "1",
      metadata: {
        decision_count: 2,
        conflicts_resolved: 0,
        round: 1,
        contradictory_inputs: "revised",
      },
      decisions: [
        { id: "D1", title: "Revenue Model", original_question: "Should we track revenue?", decision: "Track ARR", implication: "Reviewed and updated", status: "revised" },
        { id: "D2", title: "Resolved Item", original_question: "Format?", decision: "JSON", implication: "Clear", status: "resolved" },
      ],
    }, null, 2);

    render(<DecisionsSummaryCard decisionsContent={revisedOnlyContent} />);

    expect(screen.getByLabelText("Needs Review")).toBeInTheDocument();
  });
});

// ─── Serializer ─────────────────────────────────────────────────────────────

describe("serializeDecisions", () => {
  it("parse → serialize → re-parse produces identical decisions", () => {
    const decisions = parseDecisions(sampleDecisions);
    const serialized = serializeDecisions(decisions, sampleDecisions);
    const reparsed = parseDecisions(serialized);

    expect(reparsed).toHaveLength(decisions.length);
    for (let i = 0; i < decisions.length; i++) {
      expect(reparsed[i]).toMatchObject({
        id: decisions[i].id,
        title: decisions[i].title,
        original_question: decisions[i].original_question,
        decision: decisions[i].decision,
        implication: decisions[i].implication,
        status: decisions[i].status,
      });
    }
  });

  it("preserves metadata fields", () => {
    const decisions = parseDecisions(sampleDecisions);
    const serialized = serializeDecisions(decisions, sampleDecisions);
    const parsed = JSON.parse(serialized);
    expect(parsed.metadata.decision_count).toBe(3);
    expect(parsed.metadata.conflicts_resolved).toBe(1);
    expect(parsed.metadata.round).toBe(1);
  });

  it("does NOT upgrade contradictory_inputs when needs-review decisions remain", () => {
    const decisions = parseDecisions(contradictoryDecisions);
    const serialized = serializeDecisions(decisions, contradictoryDecisions);
    const parsed = JSON.parse(serialized);
    expect(parsed.metadata.contradictory_inputs).toBe(true);
  });

  it("upgrades contradictory_inputs when all needs-review are revised", () => {
    const decisions = parseDecisions(contradictoryDecisions).map((d) =>
      d.status === "needs-review" ? { ...d, status: "revised" as const } : d,
    );
    const serialized = serializeDecisions(decisions, contradictoryDecisions);
    const parsed = JSON.parse(serialized);
    expect(parsed.metadata.contradictory_inputs).toBe("revised");
  });

  it("leaves contradictory_inputs: revised unchanged on re-serialize", () => {
    const revisedContent = contradictoryDecisions.replace('"contradictory_inputs": true', '"contradictory_inputs": "revised"');
    const decisions = parseDecisions(revisedContent);
    const serialized = serializeDecisions(decisions, revisedContent);
    const parsed = JSON.parse(serialized);
    expect(parsed.metadata.contradictory_inputs).toBe("revised");
  });

  it("preserves revised status in serialized output", () => {
    const decisions = parseDecisions(multiContradictoryDecisions).map((d) =>
      d.status === "needs-review" ? { ...d, status: "revised" as const } : d,
    );
    const serialized = serializeDecisions(decisions, multiContradictoryDecisions);
    const parsed = JSON.parse(serialized);
    expect(parsed.decisions[0].status).toBe("revised");
    expect(parsed.decisions[1].status).toBe("revised");
    expect(parsed.decisions[2].status).toBe("resolved");
    expect(parsed.metadata.contradictory_inputs).toBe("revised");
  });

  it("does NOT upgrade when some are revised but others still need review", () => {
    const decisions = parseDecisions(multiContradictoryDecisions);
    // Only revise D1, leave D2 as needs-review
    const partial = decisions.map((d) =>
      d.id === "D1" ? { ...d, status: "revised" as const } : d,
    );
    const serialized = serializeDecisions(partial, multiContradictoryDecisions);
    const parsed = JSON.parse(serialized);
    expect(parsed.metadata.contradictory_inputs).toBe(true);
    expect(parsed.decisions[0].status).toBe("revised");
    expect(parsed.decisions[1].status).toBe("needs-review");
  });
});

// ─── Inline Editing (allowEdit + blur) ───────────────────────────────────────

describe("DecisionsSummaryCard — inline editing", () => {
  it("shows review-required action copy when allowEdit and needs-review cards exist", () => {
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );
    expect(screen.getByText("1 decision needs your review")).toBeInTheDocument();
  });

  it("still shows review-required action copy when allowEdit=false", () => {
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisions}
        allowEdit={false}
      />
    );
    expect(screen.getByText("1 decision needs your review")).toBeInTheDocument();
  });

  it("auto-expands needs-review cards and shows textareas for decision and implication", () => {
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    expect(textareas.length).toBeGreaterThanOrEqual(2);
    const values = textareas.map((ta) => ta.value);
    expect(values).toContain("Track MRR");
    expect(values).toContain("Contradicts Q5 answer which said \"don't track revenue\"");
  });

  it("does not show textareas for resolved decisions even when allowEdit=true", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={sampleDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Customer Hierarchy/ }));

    const textareas = screen.queryAllByRole("textbox") as HTMLTextAreaElement[];
    const resolvedText = "Two levels — parent company and subsidiary";
    expect(textareas.every((ta) => ta.value !== resolvedText)).toBe(true);
  });

  it("does NOT call onDecisionsChange on keystroke — only on blur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={onChange}
      />
    );

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const decisionTextarea = textareas.find((ta) => ta.value === "Track MRR");
    expect(decisionTextarea).toBeDefined();

    // Type without blurring — no change event
    await user.clear(decisionTextarea!);
    await user.type(decisionTextarea!, "Track ARR");
    expect(onChange).not.toHaveBeenCalled();

    // Blur triggers the change
    await user.tab();
    expect(onChange).toHaveBeenCalled();
  });

  it("shows ready-with-edits action copy after blur on single-contradiction", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    expect(screen.getByText("1 decision needs your review")).toBeInTheDocument();

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const decisionTextarea = textareas.find((ta) => ta.value === "Track MRR");
    await user.clear(decisionTextarea!);
    await user.type(decisionTextarea!, "Track ARR instead.");
    await user.tab(); // blur

    expect(screen.queryByText(/need(?:s)? your review/)).not.toBeInTheDocument();
    expect(screen.getByText("All decisions reviewed")).toBeInTheDocument();
    expect(screen.getByText("No blocking contradictions remain. You can generate the skill with your edits.")).toBeInTheDocument();
  });

  it("keeps the Needs Review toggle visible after the last needs-review decision is revised", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    await user.click(screen.getByLabelText("Needs Review"));

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const decisionTextarea = textareas.find((ta) => ta.value === "Track MRR");
    await user.clear(decisionTextarea!);
    await user.type(decisionTextarea!, "Track ARR instead.");
    await user.tab();

    expect(screen.getByLabelText("Needs Review")).toBeInTheDocument();
    expect(screen.getByText("No decisions need review.")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Needs Review"));

    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.getByText("D2")).toBeInTheDocument();
  });

  it("serializes with revised status on blur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={onChange}
      />
    );

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const decisionTextarea = textareas.find((ta) => ta.value === "Track MRR");
    await user.clear(decisionTextarea!);
    await user.type(decisionTextarea!, "Track ARR instead.");
    await user.tab();

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    const parsed = JSON.parse(lastCall);
    expect(parsed.decisions[0].status).toBe("revised");
    expect(parsed.decisions[0].decision).toBe("Track ARR instead.");
    expect(parsed.metadata.contradictory_inputs).toBe("revised");
  });

  it("shows Revised count row after blur", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    // Before blur: no Revised row
    expect(screen.queryByText("Revised")).not.toBeInTheDocument();

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const decisionTextarea = textareas.find((ta) => ta.value === "Track MRR");
    await user.clear(decisionTextarea!);
    await user.type(decisionTextarea!, "ARR");
    await user.tab();

    // After blur: revised chip visible
    expect(screen.getByText("1 revised")).toBeInTheDocument();
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe("DecisionsSummaryCard — Edge Cases", () => {
  it("handles empty content gracefully", () => {
    render(<DecisionsSummaryCard decisionsContent="" />);
    expect(screen.getByText("Decisions confirmed")).toBeInTheDocument();
    expect(screen.getByText("0 total")).toBeInTheDocument();
  });

  it("handles malformed JSON gracefully", () => {
    render(<DecisionsSummaryCard decisionsContent="not json at all" />);
    expect(screen.getByText("Decisions confirmed")).toBeInTheDocument();
    expect(screen.getByText("0 total")).toBeInTheDocument();
  });
});

// ─── Multi-contradiction guard lifecycle ──────────────────────────────────────

describe("DecisionsSummaryCard — multi-contradiction guard", () => {
  it("keeps review-required action copy when only one of two needs-review decisions is blurred", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={multiContradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    expect(screen.getByText("2 decisions need your review")).toBeInTheDocument();

    // Edit + blur only D1 — D2 still needs review
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const d1Textarea = textareas.find((ta) => ta.value === "Track MRR");
    expect(d1Textarea).toBeDefined();
    await user.clear(d1Textarea!);
    await user.type(d1Textarea!, "Track ARR instead.");
    await user.tab(); // blur D1

    // Contradictions banner should STILL be visible (D2 not addressed)
    expect(screen.getByText("1 decision needs your review")).toBeInTheDocument();
    expect(screen.queryByText("All decisions reviewed")).not.toBeInTheDocument();
  });

  it("shows ready-with-edits action copy only after ALL needs-review decisions are blurred", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={multiContradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];

    // Edit + blur D1
    const d1Textarea = textareas.find((ta) => ta.value === "Track MRR");
    await user.clear(d1Textarea!);
    await user.type(d1Textarea!, "Track ARR.");
    await user.tab();

    expect(screen.getByText("1 decision needs your review")).toBeInTheDocument();

    // Edit + blur D2
    const d2Textarea = screen.getAllByRole("textbox").find(
      (ta) => (ta as HTMLTextAreaElement).value === "All stages",
    ) as HTMLTextAreaElement;
    await user.clear(d2Textarea!);
    await user.type(d2Textarea!, "Top-of-funnel only.");
    await user.tab();

    // NOW both are revised → banner switches
    expect(screen.queryByText(/need(?:s)? your review/)).not.toBeInTheDocument();
    expect(screen.getByText("All decisions reviewed")).toBeInTheDocument();
  });

  it("shows correct counts: 1 revised, 1 needs-review after partial blur", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={multiContradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    // Edit + blur only D1
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const d1Textarea = textareas.find((ta) => ta.value === "Track MRR");
    await user.clear(d1Textarea!);
    await user.type(d1Textarea!, "ARR");
    await user.tab();

    // Should show 1 revised and 1 needs-review in the summary chips
    expect(screen.getByText("1 revised")).toBeInTheDocument();
    expect(screen.getByText("1 needs review")).toBeInTheDocument();
  });
});
