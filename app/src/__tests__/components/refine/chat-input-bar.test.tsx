import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInputBar } from "@/components/refine/chat-input-bar";

// cmdk uses scrollIntoView which jsdom doesn't implement
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const defaultProps = {
  onSend: vi.fn(),
  isRunning: false,
  availableFiles: ["SKILL.md", "references/glossary.md"],
};

function renderBar(overrides?: Partial<typeof defaultProps>) {
  const props = { ...defaultProps, ...overrides };
  return render(<ChatInputBar {...props} />);
}

describe("ChatInputBar", () => {
  beforeEach(() => {
    defaultProps.onSend.mockReset();
  });

  // --- Send behavior ---

  it("calls onSend with trimmed text on Enter", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "improve the intro");
    await user.keyboard("{Enter}");

    expect(defaultProps.onSend).toHaveBeenCalledWith(
      "improve the intro",
      undefined,
      undefined,
    );
  });

  it("clears input after sending", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "some text");
    await user.keyboard("{Enter}");

    expect(input).toHaveValue("");
  });

  it("does not send empty text", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.click(input);
    await user.keyboard("{Enter}");

    expect(defaultProps.onSend).not.toHaveBeenCalled();
  });

  it("inserts a newline on Shift+Enter instead of sending", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "line one");
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(defaultProps.onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one\n");
  });

  // --- Disabled state ---

  it("disables textarea and send button while agent is running", () => {
    renderBar({ isRunning: true });

    const input = screen.getByTestId("refine-chat-input");
    const sendBtn = screen.getByTestId("refine-send-button");

    expect(input).toBeDisabled();
    expect(sendBtn).toBeDisabled();
  });

  it("disables send button when input is empty", () => {
    renderBar();

    const sendBtn = screen.getByTestId("refine-send-button");
    expect(sendBtn).toBeDisabled();
  });

  it("enables send button when input has text", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "hello");

    const sendBtn = screen.getByTestId("refine-send-button");
    expect(sendBtn).toBeEnabled();
  });

  // --- Slash command picker ---

  it("shows command picker when / is typed", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "/");

    await waitFor(() => {
      expect(screen.getByText("Rewrite skill")).toBeInTheDocument();
      expect(screen.getByText("Validate skill")).toBeInTheDocument();
    });
  });

  it("selects a command and shows it as a badge", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "/");

    await waitFor(() => {
      expect(screen.getByText("Rewrite skill")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Rewrite skill"));

    await waitFor(() => {
      expect(screen.getByTestId("refine-command-badge")).toHaveTextContent("/rewrite");
    });
  });

  it("sends with the active command", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "/");

    await waitFor(() => {
      expect(screen.getByText("Validate skill")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Validate skill"));

    await waitFor(() => {
      expect(screen.getByTestId("refine-command-badge")).toBeInTheDocument();
    });

    await user.type(input, "check quality");
    await user.keyboard("{Enter}");

    expect(defaultProps.onSend).toHaveBeenCalledWith(
      "check quality",
      undefined,
      "validate",
    );
  });

  it("removes command badge when X is clicked", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "/");

    await waitFor(() => {
      expect(screen.getByText("Rewrite skill")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Rewrite skill"));

    await waitFor(() => {
      expect(screen.getByTestId("refine-command-badge")).toBeInTheDocument();
    });

    const badge = screen.getByTestId("refine-command-badge");
    const removeBtn = badge.querySelector("button")!;
    await user.click(removeBtn);

    expect(screen.queryByTestId("refine-command-badge")).not.toBeInTheDocument();
  });

  // --- @file autocomplete ---

  it("shows file picker when @ is typed", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "@");

    await waitFor(() => {
      expect(screen.getByText("SKILL.md")).toBeInTheDocument();
      expect(screen.getByText("references/glossary.md")).toBeInTheDocument();
    });
  });

  it("adds file as badge when selected from picker", async () => {
    const user = userEvent.setup();
    const { container } = renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "@");

    await waitFor(() => {
      expect(screen.getByText("SKILL.md")).toBeInTheDocument();
    });

    await user.click(screen.getByText("SKILL.md"));

    await waitFor(() => {
      // Badge element contains "@SKILL.md" — target the badge specifically
      const badge = container.querySelector("[data-slot='badge'][data-variant='secondary']");
      expect(badge).toBeTruthy();
      expect(badge!.textContent).toContain("@SKILL.md");
    });
  });

  it("sends with targeted files", async () => {
    const user = userEvent.setup();
    const { container } = renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "@");

    await waitFor(() => {
      expect(screen.getByText("SKILL.md")).toBeInTheDocument();
    });
    await user.click(screen.getByText("SKILL.md"));

    await waitFor(() => {
      const badge = container.querySelector("[data-slot='badge'][data-variant='secondary']");
      expect(badge).toBeTruthy();
    });

    await user.type(input, "fix this section");
    await user.keyboard("{Enter}");

    expect(defaultProps.onSend).toHaveBeenCalledWith(
      expect.stringContaining("fix this section"),
      ["SKILL.md"],
      undefined,
    );
  });

  it("removes file badge when X is clicked", async () => {
    const user = userEvent.setup();
    const { container } = renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "@");

    await waitFor(() => {
      expect(screen.getByText("SKILL.md")).toBeInTheDocument();
    });
    await user.click(screen.getByText("SKILL.md"));

    await waitFor(() => {
      const badge = container.querySelector("[data-slot='badge'][data-variant='secondary']");
      expect(badge).toBeTruthy();
    });

    // Find and click the remove button inside the badge
    const badge = container.querySelector("[data-slot='badge'][data-variant='secondary']")!;
    const removeBtn = badge.querySelector("button")!;
    await user.click(removeBtn);

    // Badge should be gone
    expect(container.querySelector("[data-slot='badge'][data-variant='secondary']")).toBeNull();
  });

  it("does not show file picker when no files are available", async () => {
    const user = userEvent.setup();
    renderBar({ availableFiles: [] });

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "@");

    // Picker heading should not appear
    expect(screen.queryByText("Files")).not.toBeInTheDocument();
  });

  // --- Keyboard navigation in pickers ---

  it("selects a command via ArrowDown + Enter keyboard navigation", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "/");

    // Wait for picker to be rendered before sending navigation keys
    await waitFor(() => {
      expect(screen.getByText("Rewrite skill")).toBeInTheDocument();
    });

    // Fire navigation directly on the textarea to bypass Radix focus guards
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      const badge = screen.getByTestId("refine-command-badge");
      expect(badge).toHaveTextContent("/validate");
    });
  });

  it("selects a file via ArrowDown + Enter keyboard navigation", async () => {
    const user = userEvent.setup();
    const { container } = renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "@");

    // Wait for picker to be rendered
    await waitFor(() => {
      expect(screen.getByText("SKILL.md")).toBeInTheDocument();
    });

    // Fire navigation directly on the textarea
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      const badge = container.querySelector("[data-slot='badge'][data-variant='secondary']");
      expect(badge).toBeTruthy();
      expect(badge!.textContent).toContain("@references/glossary.md");
    });
  });

  it("closes picker on Escape without sending", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "/");

    await waitFor(() => {
      expect(screen.getByText("Rewrite skill")).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Rewrite skill")).not.toBeInTheDocument();
    });
    // Should not have sent anything
    expect(defaultProps.onSend).not.toHaveBeenCalled();
  });

  it("wraps around when navigating past the last picker item", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "/");

    await waitFor(() => {
      expect(screen.getByText("Rewrite skill")).toBeInTheDocument();
    });

    // Two commands: rewrite (0), validate (1). Start at rewrite (0).
    // ArrowDown → validate (1), ArrowDown → wraps to rewrite (0), Enter selects rewrite
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      const badge = screen.getByTestId("refine-command-badge");
      expect(badge).toHaveTextContent("/rewrite");
    });
  });

  // --- Placeholder ---

  it("shows default placeholder when no command is active", () => {
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    expect(input).toHaveAttribute("placeholder", "Describe what to change...");
  });
});
