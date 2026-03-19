import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("scrolls to the bottom without changing horizontal alignment", () => {
    const messages: RefineMessage[] = [
      {
        id: "m1",
        role: "user",
        userText: "first message",
        timestamp: 1,
      },
      {
        id: "m2",
        role: "agent",
        agentId: "agent-1",
        timestamp: 2,
      },
    ];

    render(<ChatMessageList messages={messages} />);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "smooth",
      block: "end",
      inline: "nearest",
    });
  });

  it("does not render a user text bubble when userText is empty", () => {
    const messages: RefineMessage[] = [
      {
        id: "m1",
        role: "user",
        userText: "",
        command: "benchmark",
        timestamp: 1,
      },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);

    // Command badge should render
    expect(screen.getByText("/benchmark")).toBeInTheDocument();
    // No text bubble (the rounded-2xl chat bubble div)
    expect(container.querySelector(".rounded-2xl.bg-primary")).toBeNull();
  });

  it("renders benchmark-prompt messages", () => {
    const onConfirm = vi.fn();
    const onSkip = vi.fn();
    const messages: RefineMessage[] = [
      {
        id: "m1",
        role: "benchmark-prompt",
        timestamp: 1,
      },
    ];

    render(
      <ChatMessageList
        messages={messages}
        onBenchmarkConfirm={onConfirm}
        onBenchmarkSkip={onSkip}
      />,
    );

    expect(screen.getByTestId("benchmark-prompt")).toBeInTheDocument();
  });

  it("shows /benchmark hint in empty state", () => {
    render(<ChatMessageList messages={[]} />);

    expect(screen.getByText("/benchmark")).toBeInTheDocument();
  });
});
