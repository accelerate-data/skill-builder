import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatMessageList } from "@/components/refine/chat-message-list";
import type { RefineMessage } from "@/stores/refine-store";

vi.mock("@/components/refine/agent-turn-inline", () => ({
  AgentTurnInline: ({
    agentId,
    fromIndex,
    toIndex,
  }: {
    agentId: string;
    fromIndex?: number;
    toIndex?: number;
  }) => (
    <div
      data-testid={`agent-turn-${agentId}`}
      data-from-index={fromIndex ?? ""}
      data-to-index={toIndex ?? ""}
    >
      agent turn
    </div>
  ),
}));

describe("ChatMessageList", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
  });

  it("scrolls to the bottom of the transcript", () => {
    const messages: RefineMessage[] = [
      { id: "m1", role: "user", userText: "first message", timestamp: 1 },
      { id: "m2", role: "agent", agentId: "agent-1", timestamp: 2 },
    ];

    render(<ChatMessageList messages={messages} isRunning={false} />);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "end",
      inline: "nearest",
    });
  });

  it("renders user messages with text and agent turn blocks", () => {
    const messages: RefineMessage[] = [
      { id: "m1", role: "user", userText: "tighten the intro", timestamp: 1 },
      { id: "m2", role: "agent", agentId: "agent-1", timestamp: 2 },
    ];

    render(<ChatMessageList messages={messages} isRunning={false} />);

    // Labels are removed — no "Request" or "Agent" headings
    expect(screen.queryByText("Request")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
    expect(screen.getByText("tighten the intro")).toBeInTheDocument();
    expect(screen.getByTestId("agent-turn-agent-1")).toBeInTheDocument();
    expect(screen.getByTestId("refine-agent-turn-block")).toBeInTheDocument();
  });

  it("renders pending refine questions inline and submits answers", async () => {
    const user = userEvent.setup();
    const onQuestionSubmit = vi.fn().mockResolvedValue(undefined);
    const messages: RefineMessage[] = [
      {
        id: "q1",
        role: "question",
        agentId: "agent-1",
        toolUseId: "toolu_1",
        pending: true,
        questions: [{
          header: "Next Step",
          question: "Should I launch validate instead?",
          options: [
            { label: "Launch validate", description: "Run the validation agent." },
            { label: "Clarify refine", description: "Explain what should be changed." },
          ],
        }],
        timestamp: 1,
      },
    ];

    render(<ChatMessageList messages={messages} isRunning={false} onQuestionSubmit={onQuestionSubmit} />);

    await user.click(screen.getByRole("button", { name: /launch validate/i }));
    await user.click(screen.getByTestId("refine-question-submit"));

    expect(onQuestionSubmit).toHaveBeenCalled();
  });

  it("submits multi-select question answers as a comma-separated string", async () => {
    const user = userEvent.setup();
    const onQuestionSubmit = vi.fn().mockResolvedValue(undefined);
    const messages: RefineMessage[] = [
      {
        id: "q1",
        role: "question",
        agentId: "agent-1",
        toolUseId: "toolu_1",
        pending: true,
        questions: [{
          header: "Deal Type",
          question: "Which deal types need more detail?",
          multiSelect: true,
          options: [
            { label: "Staffing", description: "Short-cycle services." },
            { label: "Transformation", description: "Long-cycle projects." },
            { label: "Managed Services", description: "Recurring services." },
          ],
        }],
        timestamp: 1,
      },
    ];

    render(<ChatMessageList messages={messages} isRunning={false} onQuestionSubmit={onQuestionSubmit} />);

    await user.click(screen.getByRole("button", { name: /staffing/i }));
    await user.click(screen.getByRole("button", { name: /managed services/i }));
    await user.click(screen.getByTestId("refine-question-submit"));

    expect(onQuestionSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "q1" }),
      expect.objectContaining({
        answers: {
          "Which deal types need more detail?": "Staffing, Managed Services",
        },
        selectedLabels: ["Staffing", "Managed Services"],
      }),
    );
  });

  it("renders multi-question as wizard with step-through navigation", async () => {
    const user = userEvent.setup();
    const onQuestionSubmit = vi.fn().mockResolvedValue(undefined);
    const messages: RefineMessage[] = [
      {
        id: "q1",
        role: "question",
        agentId: "agent-1",
        toolUseId: "toolu_1",
        pending: true,
        questions: [
          {
            header: "Baseline",
            question: "How would you like to benchmark?",
            options: [
              { label: "Prior version", description: "Compare against prior." },
              { label: "No skill", description: "Compare against no skill." },
            ],
          },
          {
            header: "Iterations",
            question: "How many iterations?",
            options: [
              { label: "1 iteration", description: "Quick run." },
              { label: "3 iterations", description: "Full run." },
            ],
          },
        ],
        timestamp: 1,
      },
    ];

    render(<ChatMessageList messages={messages} isRunning={false} onQuestionSubmit={onQuestionSubmit} />);

    // Step indicator shows "1 of 2"
    expect(screen.getByTestId("wizard-step-indicator")).toHaveTextContent("1 of 2");

    // Only first question visible, second is not
    expect(screen.getByText("How would you like to benchmark?")).toBeInTheDocument();
    expect(screen.queryByText("How many iterations?")).not.toBeInTheDocument();

    // Next is disabled until an answer is selected
    expect(screen.getByTestId("wizard-next")).toBeDisabled();

    // Select answer and advance
    await user.click(screen.getByRole("button", { name: /prior version/i }));
    expect(screen.getByTestId("wizard-next")).toBeEnabled();
    await user.click(screen.getByTestId("wizard-next"));

    // Now on step 2
    expect(screen.getByTestId("wizard-step-indicator")).toHaveTextContent("2 of 2");
    expect(screen.getByText("How many iterations?")).toBeInTheDocument();
    expect(screen.queryByText("How would you like to benchmark?")).not.toBeInTheDocument();

    // Back button works
    await user.click(screen.getByTestId("wizard-back"));
    expect(screen.getByTestId("wizard-step-indicator")).toHaveTextContent("1 of 2");
    await user.click(screen.getByTestId("wizard-next"));

    // Select answer on step 2 and submit
    await user.click(screen.getByRole("button", { name: /3 iterations/i }));
    await user.click(screen.getByTestId("refine-question-submit"));

    expect(onQuestionSubmit).toHaveBeenCalled();
  });

  it("preserves line breaks in user messages via whitespace-pre-wrap", () => {
    const messages: RefineMessage[] = [
      { id: "m1", role: "user", userText: "line one\nline two\nline three", timestamp: 1 },
    ];

    render(<ChatMessageList messages={messages} isRunning={false} />);

    const el = screen.getByText(/line one/);
    expect(el).toHaveClass("whitespace-pre-wrap");
    expect(el.textContent).toBe("line one\nline two\nline three");
  });

  it("shows helpful hints in the empty state", () => {
    render(<ChatMessageList messages={[]} isRunning={false} />);

    expect(screen.getByText(/Describe a change/)).toBeInTheDocument();
  });

  it("splits logical agent turns within the same agent run by display item boundary", () => {
    const messages: RefineMessage[] = [
      { id: "u1", role: "user", userText: "first request", timestamp: 1 },
      { id: "a1", role: "agent", agentId: "agent-1", timestamp: 2 },
      { id: "u2", role: "user", userText: "followup request", timestamp: 3 },
      {
        id: "a2",
        role: "agent",
        agentId: "agent-1",
        displayItemStartIndex: 4,
        timestamp: 4,
      },
    ];

    render(<ChatMessageList messages={messages} isRunning={false} />);

    const turns = screen.getAllByTestId("agent-turn-agent-1");
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveAttribute("data-from-index", "");
    expect(turns[0]).toHaveAttribute("data-to-index", "4");
    expect(turns[1]).toHaveAttribute("data-from-index", "4");
    expect(turns[1]).toHaveAttribute("data-to-index", "");
  });
});
