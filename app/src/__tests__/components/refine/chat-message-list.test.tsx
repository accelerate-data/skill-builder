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

vi.mock("@/components/refine/benchmark-prompt-inline", () => ({
  BenchmarkPromptInline: ({ onConfirm }: { onConfirm: () => void; onSkip: () => void }) => (
    <div data-testid="benchmark-prompt">
      <button data-testid="benchmark-confirm" onClick={onConfirm}>Run Benchmarks</button>
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

  it("renders benchmark-prompt messages", () => {
    const onConfirm = vi.fn();
    const onSkip = vi.fn();

    render(
      <ChatMessageList
        messages={[{ id: "m1", role: "benchmark-prompt", timestamp: 1 }]}
        isRunning={false}
        onBenchmarkConfirm={onConfirm}
        onBenchmarkSkip={onSkip}
      />,
    );

    expect(screen.getByTestId("benchmark-prompt")).toBeInTheDocument();
  });

  it("shows helpful hints in the empty state", () => {
    render(<ChatMessageList messages={[]} isRunning={false} />);

    expect(screen.getByText(/Describe a change/)).toBeInTheDocument();
  });
});
