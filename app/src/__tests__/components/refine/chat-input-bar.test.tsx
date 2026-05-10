import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInputBar } from "@/components/refine/chat-input-bar";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  if (!window.getComputedStyle) {
    window.getComputedStyle = vi.fn().mockReturnValue({});
  }
});

const defaultProps = {
  onSend: vi.fn(),
  waitingForQuestion: false,
  availableFiles: ["SKILL.md", "references/glossary.md"],
  availableAgents: ["skill-creator:rewrite-skill", "skill-creator:generate-skill"],
};

function renderBar(overrides?: Partial<typeof defaultProps>) {
  const props = { ...defaultProps, ...overrides };
  return render(<ChatInputBar {...props} />);
}

describe("ChatInputBar", () => {
  beforeEach(() => {
    defaultProps.onSend.mockReset();
  });

  it("renders the editor with a placeholder", async () => {
    renderBar();

    await waitFor(() => {
      expect(screen.getByTestId("refine-chat-input")).toBeInTheDocument();
    });
  });

  it("renders the send button", () => {
    renderBar();

    expect(screen.getByTestId("refine-send-button")).toBeInTheDocument();
  });

  it("does not render a cancel button", () => {
    renderBar();

    expect(screen.queryByRole("button", { name: "Cancel current run" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop generation" })).toBeNull();
  });

  it("always renders a send button even when disabled", () => {
    renderBar({ disabled: true });

    expect(screen.getByRole("button", { name: "Send refine message" })).toBeInTheDocument();
  });

  it("shows pending question status while the agent is waiting for an answer", () => {
    renderBar({ waitingForQuestion: true });

    expect(screen.getByText("Answer the pending question above to continue.")).toBeInTheDocument();
  });

  it("does not show command buttons", () => {
    renderBar();

    expect(screen.queryByTestId("refine-action-validate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("refine-action-benchmark")).not.toBeInTheDocument();
  });
});
