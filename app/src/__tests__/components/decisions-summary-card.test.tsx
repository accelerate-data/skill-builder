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

  it("shows revised banner and hides contradictions banner after blur on single-contradiction", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const decisionTextarea = textareas.find((ta) => ta.value === "Track MRR");
    await user.clear(decisionTextarea!);
    await user.type(decisionTextarea!, "Track ARR instead.");
    await user.tab(); // blur

    expect(screen.queryByText(/Contradictory inputs detected/)).not.toBeInTheDocument();
    expect(screen.getByText(/Contradictions reviewed/)).toBeInTheDocument();
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

    // After blur: Revised row visible
    expect(screen.getByText("Revised")).toBeInTheDocument();
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
  it("keeps contradictions banner when only one of two needs-review decisions is blurred", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={multiContradictoryDecisions}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();

    // Edit + blur only D1 — D2 still needs review
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const d1Textarea = textareas.find((ta) => ta.value === "Track MRR");
    expect(d1Textarea).toBeDefined();
    await user.clear(d1Textarea!);
    await user.type(d1Textarea!, "Track ARR instead.");
    await user.tab(); // blur D1

    // Contradictions banner should STILL be visible (D2 not addressed)
    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();
    expect(screen.queryByText(/Contradictions reviewed/)).not.toBeInTheDocument();
  });

  it("shows revised banner only after ALL needs-review decisions are blurred", async () => {
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

    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();

    // Edit + blur D2
    const d2Textarea = screen.getAllByRole("textbox").find(
      (ta) => (ta as HTMLTextAreaElement).value === "All stages",
    ) as HTMLTextAreaElement;
    await user.clear(d2Textarea!);
    await user.type(d2Textarea!, "Top-of-funnel only.");
    await user.tab();

    // NOW both are revised → banner switches
    expect(screen.queryByText(/Contradictory inputs detected/)).not.toBeInTheDocument();
    expect(screen.getByText(/Contradictions reviewed/)).toBeInTheDocument();
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

    // Should show 1 revised and 1 needs-review in the stats
    expect(screen.getByText("Revised")).toBeInTheDocument();
    expect(screen.getByText("Needs review")).toBeInTheDocument();
  });
});
