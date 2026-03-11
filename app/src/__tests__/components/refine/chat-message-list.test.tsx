import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
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
});
