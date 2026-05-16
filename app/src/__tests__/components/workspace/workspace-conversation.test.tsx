import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceConversation } from "@/components/workspace/workspace-conversation";
import { useSkillStore } from "@/stores/skill-store";

const mockConversationTimeline = vi.fn(({ conversationId }: { conversationId: string }) => (
  <div data-testid="conversation-timeline">timeline:{conversationId}</div>
));

vi.mock("@/components/conversation/conversation-timeline", () => ({
  ConversationTimeline: (props: { conversationId: string }) => mockConversationTimeline(props),
}));

describe("WorkspaceConversation", () => {
  beforeEach(() => {
    useSkillStore.getState().clearSelectedSkillSession();
    mockConversationTimeline.mockClear();
  });

  it("renders the selected session timeline when a conversation is active", () => {
    useSkillStore.setState({ conversationId: "conv-session-123" });

    render(<WorkspaceConversation skillName="sales-pipeline" />);

    expect(screen.getByText("Conversation")).toBeInTheDocument();
    expect(screen.getByText("Session-backed timeline for sales-pipeline.")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-timeline")).toHaveTextContent("timeline:conv-session-123");
    expect(mockConversationTimeline).toHaveBeenCalledWith({ conversationId: "conv-session-123" });
  });

  it("shows an empty session state until the selected skill session is restored", () => {
    render(<WorkspaceConversation skillName="sales-pipeline" />);

    expect(screen.getByTestId("workspace-conversation-empty")).toBeInTheDocument();
    expect(screen.getByText("Conversation session not ready")).toBeInTheDocument();
    expect(screen.getByText(/restore the sales-pipeline session/i)).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-timeline")).not.toBeInTheDocument();
  });
});
