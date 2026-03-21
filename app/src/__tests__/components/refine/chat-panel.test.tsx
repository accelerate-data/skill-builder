import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel } from "@/components/refine/chat-panel";
import { useRefineStore, type RefineMessage } from "@/stores/refine-store";

const messageListState = vi.hoisted(() => ({
  messages: [] as RefineMessage[],
}));

const inputBarState = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
}));

vi.mock("@/components/refine/chat-message-list", () => ({
  ChatMessageList: ({ messages }: { messages: RefineMessage[] }) => {
    messageListState.messages = messages;
    return <div data-testid="chat-message-list">{messages.length} messages</div>;
  },
}));

vi.mock("@/components/refine/chat-input-bar", () => ({
  ChatInputBar: (props: {
    onSend: (text: string) => void;
    onCancel?: () => void;
    isRunning: boolean;
    availableFiles: string[];
    prefilledValue?: string;
  }) => {
    inputBarState.props = props;
    return (
      <div data-testid="chat-input-bar">
        {props.isRunning ? "running" : "idle"}
      </div>
    );
  },
}));

const defaultProps = {
  onSend: vi.fn(),
  onCancel: vi.fn(),
  isRunning: false,
  hasSkill: true,
  availableFiles: ["SKILL.md", "references/glossary.md"],
};

function renderPanel(overrides?: Partial<typeof defaultProps> & { scopeBlocked?: boolean }) {
  return render(<ChatPanel {...defaultProps} {...overrides} />);
}

describe("ChatPanel", () => {
  beforeEach(() => {
    defaultProps.onSend.mockReset();
    defaultProps.onCancel.mockReset();
    messageListState.messages = [];
    inputBarState.props = null;
    useRefineStore.setState({
      messages: [],
      sessionExhausted: false,
      pendingInitialMessage: null,
      gitDiff: null,
    });
  });

  it("renders the empty state when no skill is selected", () => {
    renderPanel({ hasSkill: false });

    expect(screen.getByTestId("refine-no-skill")).toHaveTextContent(
      "Select a skill to start refining",
    );
    expect(screen.queryByTestId("chat-input-bar")).not.toBeInTheDocument();
  });

  it("passes store messages to the message list and input bar in the normal state", () => {
    useRefineStore.setState({
      messages: [
        {
          id: "m1",
          role: "user",
          userText: "Refine the intro",
          timestamp: 1,
        },
      ],
    });

    renderPanel();

    expect(screen.getByTestId("chat-message-list")).toHaveTextContent("1 messages");
    expect(messageListState.messages).toHaveLength(1);
    expect(inputBarState.props).toMatchObject({
      onSend: defaultProps.onSend,
      onCancel: defaultProps.onCancel,
      isRunning: false,
      availableFiles: defaultProps.availableFiles,
      prefilledValue: undefined,
    });
  });

  it("blocks input and shows the scope warning when scope is blocked", () => {
    renderPanel({ scopeBlocked: true });

    expect(
      screen.getByText(/Scope recommendation active/i),
    ).toBeInTheDocument();
    expect(inputBarState.props).toMatchObject({
      isRunning: true,
    });
  });

  it("shows the session limit banner and disables input when the session is exhausted", () => {
    useRefineStore.setState({
      sessionExhausted: true,
    });

    renderPanel();

    expect(
      screen.getByText(
        "This refine session has reached its limit. Select the skill again to start a new session.",
      ),
    ).toBeInTheDocument();
    expect(inputBarState.props).toMatchObject({
      isRunning: true,
    });
  });

  it("passes the pending initial message through as the prefilled value", () => {
    useRefineStore.setState({
      pendingInitialMessage: "Please tighten the glossary wording",
    });

    renderPanel();

    expect(inputBarState.props).toMatchObject({
      prefilledValue: "Please tighten the glossary wording",
    });
  });

  it("keeps input disabled while a refine request is already running", () => {
    renderPanel({ isRunning: true });

    expect(inputBarState.props).toMatchObject({
      onCancel: defaultProps.onCancel,
      isRunning: true,
    });
  });

  it("shows modified-file pills and opens the selected file", async () => {
    const user = userEvent.setup();
    useRefineStore.setState({
      gitDiff: {
        stat: "3 files changed",
        files: [
          { path: "test-skill/SKILL.md", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new\n" },
          { path: "test-skill/references/glossary.md", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new\n" },
          { path: "test-skill/context/debug.md", status: "modified", diff: "@@ -1 +1 @@\n-old\n+new\n" },
        ],
      },
    });

    renderPanel();

    expect(screen.getByTestId("refine-modified-files")).toBeInTheDocument();
    expect(screen.getByText("SKILL.md")).toBeInTheDocument();
    expect(screen.getByText("references/glossary.md")).toBeInTheDocument();
    expect(screen.queryByText("context/debug.md")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("refine-modified-file-pill-references/glossary.md"));

    expect(useRefineStore.getState().activeFileTab).toBe("references/glossary.md");
    expect(useRefineStore.getState().selectedModifiedFile).toBe("references/glossary.md");
  });
});
