import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInputBar } from "@/components/refine/chat-input-bar";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  // Tiptap requires getComputedStyle for ProseMirror
  if (!window.getComputedStyle) {
    window.getComputedStyle = vi.fn().mockReturnValue({});
  }
});

const defaultProps = {
  onSend: vi.fn(),
  onCancel: vi.fn(),
  isRunning: false,
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
    defaultProps.onCancel.mockReset();
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

  it("replaces send with cancel while running", async () => {
    const user = userEvent.setup();
    renderBar({ isRunning: true });

    const button = screen.getByRole("button", { name: "Cancel current run" });
    await user.click(button);

    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSend).not.toHaveBeenCalled();
  });

  it("does not show command buttons", () => {
    renderBar();

    expect(screen.queryByTestId("refine-action-validate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("refine-action-benchmark")).not.toBeInTheDocument();
  });
});
