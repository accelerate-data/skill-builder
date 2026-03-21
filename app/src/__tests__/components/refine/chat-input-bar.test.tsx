import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInputBar } from "@/components/refine/chat-input-bar";

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

  it("sends generic text as refine with no command", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "tighten the quick start");
    await user.keyboard("{Enter}");

    expect(defaultProps.onSend).toHaveBeenCalledWith(
      "tighten the quick start",
      undefined,
      undefined,
    );
  });

  it("keeps only validate and benchmark action buttons", () => {
    renderBar();

    expect(screen.queryByTestId("refine-action-rewrite")).not.toBeInTheDocument();
    expect(screen.getByTestId("refine-action-validate")).toHaveAccessibleName(
      "Validate skill",
    );
    expect(screen.getByTestId("refine-action-benchmark")).toHaveAccessibleName(
      "Benchmark skill",
    );
  });

  it("selects validate from the visible action button", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByTestId("refine-action-validate"));

    expect(screen.getByTestId("refine-command-badge")).toHaveTextContent("/validate");
  });

  it("sends with the active explicit command", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByTestId("refine-action-benchmark"));
    await user.type(screen.getByTestId("refine-chat-input"), "run the evals");
    await user.keyboard("{Enter}");

    expect(defaultProps.onSend).toHaveBeenCalledWith(
      "run the evals",
      undefined,
      "benchmark",
    );
  });

  it("parses typed /validate as an explicit command", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "/validate formatting");
    await user.keyboard("{Enter}");

    expect(defaultProps.onSend).toHaveBeenCalledWith(
      "formatting",
      undefined,
      "validate",
    );
  });

  it("parses /eval as benchmark", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "/eval current skill");
    await user.keyboard("{Enter}");

    expect(defaultProps.onSend).toHaveBeenCalledWith(
      "current skill",
      undefined,
      "benchmark",
    );
  });

  it("treats /rewrite as generic refine text with no command", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("refine-chat-input");
    await user.type(input, "/rewrite improve the intro");
    await user.keyboard("{Enter}");

    expect(defaultProps.onSend).toHaveBeenCalledWith(
      "improve the intro",
      undefined,
      undefined,
    );
  });

  it("shows only validate and benchmark in the slash command picker", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.type(screen.getByTestId("refine-chat-input"), "/");

    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: "Validate skill" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Benchmark skill" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("option", { name: "Rewrite skill" }),
    ).not.toBeInTheDocument();
  });

  it("supports selecting targeted files", async () => {
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
    const [text, targetFiles, command] = defaultProps.onSend.mock.calls[0]!;
    expect(text).toContain("@SKILL.md");
    expect(text).toContain("tighten this");
    expect(targetFiles).toEqual(["SKILL.md"]);
    expect(command).toBeUndefined();
  });
});
