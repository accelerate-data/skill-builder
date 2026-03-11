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
  it("shows decision count from metadata", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("total")).toBeInTheDocument();
  });

  it("shows conflicts reconciled count", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    expect(screen.getByText("reconciled")).toBeInTheDocument();
    expect(screen.getByText("No unresolvable contradictions")).toBeInTheDocument();
  });

  it("shows resolved and conflict-resolved breakdown", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Conflict-resolved")).toBeInTheDocument();
  });

  it("shows quality column header", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    expect(screen.getByText("Quality")).toBeInTheDocument();
  });

  it("shows duration and cost when provided", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} duration={125000} cost={0.5234} />);
    expect(screen.getByText("2m 5s")).toBeInTheDocument();
    expect(screen.getByText("$0.5234")).toBeInTheDocument();
  });

  it("does not show contradictory banner when flag is absent", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisions} />);
    expect(screen.queryByText(/Contradictory inputs detected/)).not.toBeInTheDocument();
  });
});

// ─── Contradictory Inputs ─────────────────────────────────────────────────────

describe("DecisionsSummaryCard — Contradictory Inputs", () => {
  it("shows contradictory warning banner", () => {
    render(<DecisionsSummaryCard decisionsContent={contradictoryDecisions} />);
    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();
  });

  it("shows needs-review count", () => {
    render(<DecisionsSummaryCard decisionsContent={contradictoryDecisions} />);
    expect(screen.getByText("Needs review")).toBeInTheDocument();
  });

  it("shows contradictions review required in quality column", () => {
    render(<DecisionsSummaryCard decisionsContent={contradictoryDecisions} />);
    expect(screen.getByText(/Contradictions — review required/)).toBeInTheDocument();
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
    expect(screen.getByText(/conflict-resolved/i)).toBeInTheDocument();
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
    expect(screen.getByText("needs-review")).toBeInTheDocument();
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
});

// ─── Serializer Round-trip ────────────────────────────────────────────────────

describe("serializeDecisions — round-trip", () => {
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

  it("does NOT upgrade contradictory_inputs when allReviewed is false", () => {
    const decisions = parseDecisions(contradictoryDecisions);
    const serialized = serializeDecisions(decisions, contradictoryDecisions);
    const parsed = JSON.parse(serialized);
    expect(parsed.metadata.contradictory_inputs).toBe(true);
  });

  it("upgrades contradictory_inputs: true → revised when allReviewed is true", () => {
    const decisions = parseDecisions(contradictoryDecisions);
    const serialized = serializeDecisions(decisions, contradictoryDecisions, true);
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
});

// ─── Inline Editing (allowEdit) ───────────────────────────────────────────────

describe("DecisionsSummaryCard — inline editing", () => {
  it("shows editing hint banner when allowEdit and needs-review cards exist", () => {
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );
    expect(screen.getByText(/need your review/)).toBeInTheDocument();
  });

  it("does not show editing hint when allowEdit=false", () => {
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisions}
        allowEdit={false}
      />
    );
    expect(screen.queryByText(/need your review/)).not.toBeInTheDocument();
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

  it("shows revised banner and hides contradictions banner after editing", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();
    expect(screen.queryByText(/Contradictions reviewed/)).not.toBeInTheDocument();

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const decisionTextarea = textareas.find((ta) => ta.value === "Track MRR");
    await user.clear(decisionTextarea!);
    await user.type(decisionTextarea!, "Track ARR instead.");

    expect(screen.queryByText(/Contradictory inputs detected/)).not.toBeInTheDocument();
    expect(screen.getByText(/Contradictions reviewed/)).toBeInTheDocument();
  });

  it("calls onDecisionsChange when editing decision text", async () => {
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

    await user.clear(decisionTextarea!);
    await user.type(decisionTextarea!, "Track ARR instead.");

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    const parsed = JSON.parse(lastCall);
    expect(parsed.decisions[0].decision).toBe("Track ARR instead.");
    expect(parsed.metadata.decision_count).toBe(2);
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe("DecisionsSummaryCard — Edge Cases", () => {
  it("handles empty content gracefully", () => {
    render(<DecisionsSummaryCard decisionsContent="" />);
    expect(screen.getByText("Decisions Complete")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);
  });

  it("handles malformed JSON gracefully", () => {
    render(<DecisionsSummaryCard decisionsContent="not json at all" />);
    expect(screen.getByText("Decisions Complete")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Multi-contradiction guard lifecycle ──────────────────────────────────────

describe("DecisionsSummaryCard — multi-contradiction guard", () => {
  it("keeps contradictions banner when only one of two needs-review decisions is edited", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={multiContradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();
    expect(screen.queryByText(/Contradictions reviewed/)).not.toBeInTheDocument();

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const d1Textarea = textareas.find((ta) => ta.value === "Track MRR");
    expect(d1Textarea).toBeDefined();
    await user.clear(d1Textarea!);
    await user.type(d1Textarea!, "Track ARR instead.");

    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();
    expect(screen.queryByText(/Contradictions reviewed/)).not.toBeInTheDocument();
  });

  it("shows revised banner only after ALL needs-review decisions are edited", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={multiContradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];

    const d1Textarea = textareas.find((ta) => ta.value === "Track MRR");
    await user.clear(d1Textarea!);
    await user.type(d1Textarea!, "Track ARR.");

    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();

    const d2Textarea = textareas.find((ta) => ta.value === "All stages");
    await user.clear(d2Textarea!);
    await user.type(d2Textarea!, "Top-of-funnel only.");

    expect(screen.queryByText(/Contradictory inputs detected/)).not.toBeInTheDocument();
    expect(screen.getByText(/Contradictions reviewed/)).toBeInTheDocument();
  });

  it("serializes contradictory_inputs correctly based on allReviewed flag", () => {
    const decisions = parseDecisions(multiContradictoryDecisions);

    const partial = serializeDecisions(decisions, multiContradictoryDecisions, false);
    expect(JSON.parse(partial).metadata.contradictory_inputs).toBe(true);

    const full = serializeDecisions(decisions, multiContradictoryDecisions, true);
    expect(JSON.parse(full).metadata.contradictory_inputs).toBe("revised");
  });

  it("flips needs-review → resolved in serialization when allReviewed is true", () => {
    const decisions = parseDecisions(multiContradictoryDecisions);

    // Without allReviewed: needs-review preserved
    const partial = serializeDecisions(decisions, multiContradictoryDecisions, false);
    const partialParsed = JSON.parse(partial);
    expect(partialParsed.decisions[0].status).toBe("needs-review");
    expect(partialParsed.decisions[1].status).toBe("needs-review");
    expect(partialParsed.decisions[2].status).toBe("resolved");

    // With allReviewed: needs-review flipped to resolved
    const full = serializeDecisions(decisions, multiContradictoryDecisions, true);
    const fullParsed = JSON.parse(full);
    expect(fullParsed.decisions[0].status).toBe("resolved");
    expect(fullParsed.decisions[1].status).toBe("resolved");
    expect(fullParsed.decisions[2].status).toBe("resolved");
    expect(fullParsed.metadata.contradictory_inputs).toBe("revised");
  });
});
