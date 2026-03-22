import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInputBar } from "@/components/refine/chat-input-bar";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
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

  it("sends text as-is with no command parsing", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "tighten the quick start");
    await user.keyboard("{Enter}");

    expect(defaultProps.onSend).toHaveBeenCalledWith(
      "tighten the quick start",
      undefined,
    );
  });

  it("sends slash commands as plain text for Claude to interpret", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "/validate this skill");
    await user.keyboard("{Enter}");

    expect(defaultProps.onSend).toHaveBeenCalledWith(
      "/validate this skill",
      undefined,
    );
  });

  it("supports selecting targeted files via @ picker", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "@");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "SKILL.md" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("option", { name: "SKILL.md" }));
    await user.type(input, " tighten this");
    await user.keyboard("{Enter}");

    expect(defaultProps.onSend).toHaveBeenCalledTimes(1);
    const [text, targetFiles] = defaultProps.onSend.mock.calls[0]!;
    expect(text).toContain("@SKILL.md");
    expect(text).toContain("tighten this");
    expect(targetFiles).toEqual(["SKILL.md"]);
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
