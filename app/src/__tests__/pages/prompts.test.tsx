import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, resetTauriMocks, mockInvokeCommands } from "@/test/mocks/tauri";

// Mock react-markdown as a simple pass-through
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({ default: {} }));
vi.mock("rehype-highlight", () => ({ default: {} }));

// Import after mocks
import PromptsPage from "@/pages/prompts";

describe("PromptsPage", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("renders skill type and phase dropdowns", () => {
    render(<PromptsPage />);

    expect(screen.getByLabelText("Skill Type")).toBeInTheDocument();
    expect(screen.getByLabelText("Phase")).toBeInTheDocument();
  });

  it("shows empty state when no selection", () => {
    render(<PromptsPage />);

    expect(
      screen.getByText("Select a skill type and phase to view the agent prompt.")
    ).toBeInTheDocument();
  });

  it("loads prompt when both type and phase selected", async () => {
    const user = userEvent.setup();
    const promptContent = "# Build Agent\n\nBuild instructions here.";
    mockInvokeCommands({ get_agent_prompt: promptContent });

    render(<PromptsPage />);

    await user.selectOptions(screen.getByLabelText("Skill Type"), "platform");
    await user.selectOptions(screen.getByLabelText("Phase"), "build");

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_agent_prompt", {
        skillType: "platform",
        phase: "build",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("markdown")).toHaveTextContent(
        "# Build Agent"
      );
    });
  });

  it("shows loading state while fetching", async () => {
    const user = userEvent.setup();
    // Make invoke hang forever to keep loading state
    mockInvoke.mockImplementation(() => new Promise(() => {}));

    render(<PromptsPage />);

    await user.selectOptions(screen.getByLabelText("Skill Type"), "platform");
    await user.selectOptions(screen.getByLabelText("Phase"), "build");

    expect(screen.getByText("Loading prompt...")).toBeInTheDocument();
  });

  it("clears old content when a dropdown value changes", async () => {
    const user = userEvent.setup();
    const firstPrompt = "# Build Agent\n\nBuild instructions here.";

    // First load: return build prompt
    mockInvokeCommands({ get_agent_prompt: firstPrompt });

    render(<PromptsPage />);

    await user.selectOptions(screen.getByLabelText("Skill Type"), "platform");
    await user.selectOptions(screen.getByLabelText("Phase"), "build");

    // Wait for first prompt to render
    await waitFor(() => {
      expect(screen.getByTestId("markdown")).toHaveTextContent("# Build Agent");
    });

    // Now make the next invoke hang so we can observe the loading state
    mockInvoke.mockImplementation(() => new Promise(() => {}));

    // Change the phase dropdown
    await user.selectOptions(screen.getByLabelText("Phase"), "validate");

    // Old content should be cleared and loading state shown
    expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();
    expect(screen.getByText("Loading prompt...")).toBeInTheDocument();
  });

  it("handles error when prompt not found", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation(() =>
      Promise.reject(new Error("Prompt file not found"))
    );

    render(<PromptsPage />);

    await user.selectOptions(screen.getByLabelText("Skill Type"), "domain");
    await user.selectOptions(screen.getByLabelText("Phase"), "validate");

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to load prompt:/)
      ).toBeInTheDocument();
    });
  });
});
