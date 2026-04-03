import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatMessageList } from "@/components/refine/chat-message-list";
import type { RefineMessage } from "@/stores/refine-store";

vi.mock("@/components/refine/agent-turn-inline", () => ({
  AgentTurnInline: ({ agentId }: { agentId: string }) => (
    <div data-testid={`agent-turn-${agentId}`}>agent turn</div>
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
});
