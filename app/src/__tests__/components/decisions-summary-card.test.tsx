import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DecisionsSummaryCard, parseDecisions, serializeDecisions } from "@/components/decisions-summary-card";

// ─── Test Data ────────────────────────────────────────────────────────────────

const sampleDecisionsMd = `---
decision_count: 3
conflicts_resolved: 1
round: 1
---
### D1: Customer Hierarchy
- **Original question:** How many levels should the customer hierarchy support?
- **Decision:** Two levels — parent company and subsidiary
- **Implication:** Need a self-referencing FK in dim_customer
- **Status:** resolved

### D2: Revenue Recognition
- **Original question:** When should revenue be recognized?
- **Decision:** Track full lifecycle with invoice as primary event
- **Implication:** PM said "at invoicing" but also answered "track bookings" — both imply lifecycle tracking
- **Status:** conflict-resolved

### D3: Pipeline Entry
- **Original question:** Which stage marks pipeline entry?
- **Decision:** Any stage beyond Prospecting
- **Implication:** Straightforward filter on stage sequence
- **Status:** resolved
`;

const contradictoryDecisionsMd = `---
decision_count: 2
conflicts_resolved: 0
round: 1
contradictory_inputs: true
---
### D1: Revenue Model
- **Original question:** Should we track revenue?
- **Decision:** Track MRR
- **Implication:** Contradicts Q5 answer which said "don't track revenue"
- **Status:** needs-review

### D2: Pipeline Scope
- **Original question:** What's in scope?
- **Decision:** All deals
- **Implication:** Clear scope
- **Status:** resolved
`;

const decisionsMdWithH2Headings = `---
decision_count: 2
conflicts_resolved: 0
round: 1
---
## D1: Spread Period
- **Original question:** Q1
- **Decision:** Use 12 months
- **Implication:** Normalized MRR
- **Status:** resolved

## D2: Segmentation
- **Original question:** Q10
- **Decision:** Geography primary
- **Implication:** Use territory slices
- **Status:** resolved with note
`;

// ─── Summary Card Stats ───────────────────────────────────────────────────────

describe("DecisionsSummaryCard — Summary Stats", () => {
  it("shows decision count from frontmatter", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisionsMd} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("total")).toBeInTheDocument();
  });

  it("shows conflicts reconciled count", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisionsMd} />);
    expect(screen.getByText("reconciled")).toBeInTheDocument();
    // "1" appears in multiple contexts (round, conflict count) — check reconciled label exists
    expect(screen.getByText("No unresolvable contradictions")).toBeInTheDocument();
  });

  it("shows resolved and conflict-resolved breakdown", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisionsMd} />);
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Conflict-resolved")).toBeInTheDocument();
  });

  it("shows quality column header", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisionsMd} />);
    expect(screen.getByText("Quality")).toBeInTheDocument();
  });

  it("shows duration and cost when provided", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisionsMd} duration={125000} cost={0.5234} />);
    expect(screen.getByText("2m 5s")).toBeInTheDocument();
    expect(screen.getByText("$0.5234")).toBeInTheDocument();
  });

  it("does not show contradictory banner when flag is absent", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisionsMd} />);
    expect(screen.queryByText(/Contradictory inputs detected/)).not.toBeInTheDocument();
  });
});

// ─── Contradictory Inputs ─────────────────────────────────────────────────────

describe("DecisionsSummaryCard — Contradictory Inputs", () => {
  it("shows contradictory warning banner", () => {
    render(<DecisionsSummaryCard decisionsContent={contradictoryDecisionsMd} />);
    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();
  });

  it("shows needs-review count", () => {
    render(<DecisionsSummaryCard decisionsContent={contradictoryDecisionsMd} />);
    expect(screen.getByText("Needs review")).toBeInTheDocument();
  });

  it("shows contradictions review required in quality column", () => {
    render(<DecisionsSummaryCard decisionsContent={contradictoryDecisionsMd} />);
    expect(screen.getByText(/Contradictions — review required/)).toBeInTheDocument();
  });
});

// ─── Decision Cards ───────────────────────────────────────────────────────────

describe("DecisionsSummaryCard — Decision Cards", () => {
  it("renders a card for each decision", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisionsMd} />);
    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.getByText("D2")).toBeInTheDocument();
    expect(screen.getByText("D3")).toBeInTheDocument();
  });

  it("shows decision titles", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisionsMd} />);
    expect(screen.getByText("Customer Hierarchy")).toBeInTheDocument();
    expect(screen.getByText("Revenue Recognition")).toBeInTheDocument();
    expect(screen.getByText("Pipeline Entry")).toBeInTheDocument();
  });

  it("shows status badges", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisionsMd} />);
    const badges = screen.getAllByText("resolved");
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/conflict-resolved/i)).toBeInTheDocument();
  });

  it("shows decision preview text when collapsed", () => {
    render(<DecisionsSummaryCard decisionsContent={sampleDecisionsMd} />);
    expect(screen.getByText(/Two levels — parent company/)).toBeInTheDocument();
  });

  it("expands to show full details on click", async () => {
    const user = userEvent.setup();
    render(<DecisionsSummaryCard decisionsContent={sampleDecisionsMd} />);
    // Click D1 header
    await user.click(screen.getByRole("button", { name: /Customer Hierarchy/ }));
    // Should show original question and implication
    expect(screen.getByText(/How many levels should the customer hierarchy/)).toBeInTheDocument();
    expect(screen.getByText(/self-referencing FK/)).toBeInTheDocument();
  });

  it("shows needs-review badge for contradictory decisions", () => {
    render(<DecisionsSummaryCard decisionsContent={contradictoryDecisionsMd} />);
    expect(screen.getByText("needs-review")).toBeInTheDocument();
  });

  it("filters to only needs-review decisions when toggle is enabled", async () => {
    const user = userEvent.setup();
    render(<DecisionsSummaryCard decisionsContent={contradictoryDecisionsMd} />);

    // Initially both decisions are visible
    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.getByText("D2")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Needs Review"));

    // Filtered view keeps only needs-review card (D1)
    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.queryByText("D2")).not.toBeInTheDocument();
  });
});

// ─── Serializer Round-trip ────────────────────────────────────────────────────

describe("serializeDecisions — round-trip", () => {
  it("parse → serialize → re-parse produces identical decisions", () => {
    const decisions = parseDecisions(sampleDecisionsMd);
    const rawFm = sampleDecisionsMd.match(/^(---[\s\S]*?---)/)?.[1] ?? "";
    const serialized = serializeDecisions(decisions, rawFm);
    const reparsed = parseDecisions(serialized);

    expect(reparsed).toHaveLength(decisions.length);
    for (let i = 0; i < decisions.length; i++) {
      expect(reparsed[i]).toMatchObject({
        id: decisions[i].id,
        title: decisions[i].title,
        originalQuestion: decisions[i].originalQuestion,
        decision: decisions[i].decision,
        implication: decisions[i].implication,
        status: decisions[i].status,
      });
    }
  });

  it("preserves frontmatter verbatim", () => {
    const decisions = parseDecisions(sampleDecisionsMd);
    const rawFm = sampleDecisionsMd.match(/^(---[\s\S]*?---)/)?.[1] ?? "";
    const serialized = serializeDecisions(decisions, rawFm);
    expect(serialized).toContain("decision_count: 3");
    expect(serialized).toContain("conflicts_resolved: 1");
    expect(serialized).toContain("round: 1");
  });

  it("does NOT upgrade contradictory_inputs when allReviewed is false", () => {
    const decisions = parseDecisions(contradictoryDecisionsMd);
    const rawFm = contradictoryDecisionsMd.match(/^(---[\s\S]*?---)/)?.[1] ?? "";
    const serialized = serializeDecisions(decisions, rawFm); // allReviewed defaults to false
    expect(serialized).toContain("contradictory_inputs: true");
    expect(serialized).not.toContain("contradictory_inputs: revised");
  });

  it("upgrades contradictory_inputs: true → revised when allReviewed is true", () => {
    const decisions = parseDecisions(contradictoryDecisionsMd);
    const rawFm = contradictoryDecisionsMd.match(/^(---[\s\S]*?---)/)?.[1] ?? "";
    const serialized = serializeDecisions(decisions, rawFm, true);
    expect(serialized).toContain("contradictory_inputs: revised");
    expect(serialized).not.toContain("contradictory_inputs: true");
  });

  it("leaves contradictory_inputs: revised unchanged on re-serialize", () => {
    const revisedContent = contradictoryDecisionsMd.replace("contradictory_inputs: true", "contradictory_inputs: revised");
    const decisions = parseDecisions(revisedContent);
    const rawFm = revisedContent.match(/^(---[\s\S]*?---)/)?.[1] ?? "";
    const serialized = serializeDecisions(decisions, rawFm);
    expect(serialized).toContain("contradictory_inputs: revised");
    expect(serialized).not.toContain("contradictory_inputs: true");
  });

  it("parses decisions when headings use ## instead of ###", () => {
    const decisions = parseDecisions(decisionsMdWithH2Headings);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toMatchObject({ id: "D1", title: "Spread Period" });
    expect(decisions[1]).toMatchObject({ id: "D2", title: "Segmentation", status: "resolved" });
  });
});

// ─── Inline Editing (allowEdit) ───────────────────────────────────────────────

describe("DecisionsSummaryCard — inline editing", () => {
  it("shows editing hint banner when allowEdit and needs-review cards exist", () => {
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisionsMd}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );
    expect(screen.getByText(/need your review/)).toBeInTheDocument();
  });

  it("does not show editing hint when allowEdit=false", () => {
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisionsMd}
        allowEdit={false}
      />
    );
    expect(screen.queryByText(/need your review/)).not.toBeInTheDocument();
  });

  it("auto-expands needs-review cards and shows textareas for decision and implication", () => {
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisionsMd}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );
    // Needs-review card should be auto-expanded — textareas visible without clicking
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
        decisionsContent={sampleDecisionsMd}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    // Expand a resolved card
    await user.click(screen.getByRole("button", { name: /Customer Hierarchy/ }));

    // No textarea for a resolved card
    const textareas = screen.queryAllByRole("textbox") as HTMLTextAreaElement[];
    const resolvedText = "Two levels — parent company and subsidiary";
    expect(textareas.every((ta) => ta.value !== resolvedText)).toBe(true);
  });

  it("shows revised banner and hides contradictions banner after editing", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisionsMd}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    // Before edit: contradictions banner visible, revised banner not
    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();
    expect(screen.queryByText(/Contradictions reviewed/)).not.toBeInTheDocument();

    // Edit a needs-review textarea
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const decisionTextarea = textareas.find((ta) => ta.value === "Track MRR");
    await user.clear(decisionTextarea!);
    await user.type(decisionTextarea!, "Track ARR instead.");

    // After edit: revised banner visible, contradictions banner gone
    expect(screen.queryByText(/Contradictory inputs detected/)).not.toBeInTheDocument();
    expect(screen.getByText(/Contradictions reviewed/)).toBeInTheDocument();
  });

  it("calls onDecisionsChange when editing decision text", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DecisionsSummaryCard
        decisionsContent={contradictoryDecisionsMd}
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
    expect(lastCall).toContain("Track ARR instead.");
    expect(lastCall).toContain("decision_count: 2");
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe("DecisionsSummaryCard — Edge Cases", () => {
  it("handles empty content gracefully", () => {
    render(<DecisionsSummaryCard decisionsContent="" />);
    expect(screen.getByText("Decisions Complete")).toBeInTheDocument();
    // Multiple "0" elements (decision count + conflicts) — just check the header rendered
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);
  });

  it("handles content with no frontmatter", () => {
    const noFm = "### D1: Test\n- **Decision:** Something\n- **Status:** resolved";
    render(<DecisionsSummaryCard decisionsContent={noFm} />);
    expect(screen.getByText("D1")).toBeInTheDocument();
  });
});

// ─── Multi-contradiction guard lifecycle ──────────────────────────────────────

const multiContradictoryMd = `---
decision_count: 3
conflicts_resolved: 0
round: 1
contradictory_inputs: true
---
### D1: Revenue Model
- **Original question:** Should we track revenue?
- **Decision:** Track MRR
- **Implication:** Contradicts Q5
- **Status:** needs-review

### D2: Pipeline Scope
- **Original question:** What pipeline stages?
- **Decision:** All stages
- **Implication:** Contradicts Q3 which said top-of-funnel only
- **Status:** needs-review

### D3: Resolved Item
- **Original question:** Format?
- **Decision:** JSON
- **Implication:** Clear
- **Status:** resolved
`;

describe("DecisionsSummaryCard — multi-contradiction guard", () => {
  it("keeps contradictions banner when only one of two needs-review decisions is edited", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={multiContradictoryMd}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    // Before any edit: contradictions banner visible
    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();
    expect(screen.queryByText(/Contradictions reviewed/)).not.toBeInTheDocument();

    // Edit only D1 (first needs-review) — D2 is still unreviewed
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const d1Textarea = textareas.find((ta) => ta.value === "Track MRR");
    expect(d1Textarea).toBeDefined();
    await user.clear(d1Textarea!);
    await user.type(d1Textarea!, "Track ARR instead.");

    // Contradictions banner should STILL be visible (D2 not edited yet)
    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();
    expect(screen.queryByText(/Contradictions reviewed/)).not.toBeInTheDocument();
  });

  it("shows revised banner only after ALL needs-review decisions are edited", async () => {
    const user = userEvent.setup();
    render(
      <DecisionsSummaryCard
        decisionsContent={multiContradictoryMd}
        allowEdit={true}
        onDecisionsChange={vi.fn()}
      />
    );

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];

    // Edit D1
    const d1Textarea = textareas.find((ta) => ta.value === "Track MRR");
    await user.clear(d1Textarea!);
    await user.type(d1Textarea!, "Track ARR.");

    // Still shows contradictions (D2 unedited)
    expect(screen.getByText(/Contradictory inputs detected/)).toBeInTheDocument();

    // Edit D2
    const d2Textarea = textareas.find((ta) => ta.value === "All stages");
    await user.clear(d2Textarea!);
    await user.type(d2Textarea!, "Top-of-funnel only.");

    // NOW both needs-review decisions are edited → revised banner
    expect(screen.queryByText(/Contradictory inputs detected/)).not.toBeInTheDocument();
    expect(screen.getByText(/Contradictions reviewed/)).toBeInTheDocument();
  });

  it("serializes contradictory_inputs as true when not all reviewed, revised when all reviewed", () => {
    const decisions = parseDecisions(multiContradictoryMd);
    const rawFm = multiContradictoryMd.match(/^(---[\s\S]*?---)/)?.[1] ?? "";

    // Not all reviewed
    const partial = serializeDecisions(decisions, rawFm, false);
    expect(partial).toContain("contradictory_inputs: true");

    // All reviewed
    const full = serializeDecisions(decisions, rawFm, true);
    expect(full).toContain("contradictory_inputs: revised");
  });

  it("flips needs-review → resolved in markdown serialization when allReviewed is true", () => {
    const decisions = parseDecisions(multiContradictoryMd);
    const rawFm = multiContradictoryMd.match(/^(---[\s\S]*?---)/)?.[1] ?? "";

    // Without allReviewed: needs-review preserved
    const partial = serializeDecisions(decisions, rawFm, false);
    expect(partial).toContain("**Status:** needs-review");

    // With allReviewed: needs-review flipped to resolved
    const full = serializeDecisions(decisions, rawFm, true);
    expect(full).not.toContain("**Status:** needs-review");
    expect(full).toContain("**Status:** resolved");
  });

  it("flips needs-review → resolved in JSON serialization when allReviewed is true", () => {
    const jsonContent = JSON.stringify({
      version: "1",
      metadata: {
        decision_count: 2,
        conflicts_resolved: 0,
        round: 1,
        contradictory_inputs: true,
      },
      decisions: [
        { id: "D1", title: "Revenue", originalQuestion: "Q1", decision: "MRR", implication: "Contradicts Q5", status: "needs-review" },
        { id: "D2", title: "Scope", originalQuestion: "Q2", decision: "All", implication: "Clear", status: "resolved" },
      ],
    }, null, 2);

    const decisions = parseDecisions(jsonContent);

    // Without allReviewed
    const partial = serializeDecisions(decisions, jsonContent, false);
    const partialParsed = JSON.parse(partial);
    expect(partialParsed.metadata.contradictory_inputs).toBe(true);
    expect(partialParsed.decisions[0].status).toBe("needs-review");
    expect(partialParsed.decisions[1].status).toBe("resolved");

    // With allReviewed
    const full = serializeDecisions(decisions, jsonContent, true);
    const fullParsed = JSON.parse(full);
    expect(fullParsed.metadata.contradictory_inputs).toBe("revised");
    expect(fullParsed.decisions[0].status).toBe("resolved");
    expect(fullParsed.decisions[1].status).toBe("resolved");
  });
});
