import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { ReactNode } from "react";

// Polyfill scrollIntoView for jsdom
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// Mock Tauri commands
const {
  mockStartAgent,
  mockGetArtifactContent,
  mockSaveChatSession,
  mockLoadChatSession,
} = vi.hoisted(() => ({
  mockStartAgent: vi.fn<(...args: unknown[]) => Promise<string>>(() => Promise.resolve("agent-1")),
  mockGetArtifactContent: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown> | null>>(() => Promise.resolve(null)),
  mockSaveChatSession: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
  mockLoadChatSession: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown> | null>>(() => Promise.resolve(null)),
}));

vi.mock("@/lib/tauri", () => ({
  startAgent: mockStartAgent,
  getArtifactContent: mockGetArtifactContent,
}));

vi.mock("@/lib/chat-storage", () => ({
  saveChatSession: mockSaveChatSession,
  loadChatSession: mockLoadChatSession,
}));

// Mock react-markdown to avoid ESM issues
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({
  default: () => {},
}));

// Mock ScrollArea to avoid Radix infinite update loops in jsdom
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div data-testid="scroll-area">{children}</div>,
}));

// Mock AgentStatusHeader to avoid timer/store complexity
vi.mock("@/components/agent-status-header", () => ({
  AgentStatusHeader: () => <div data-testid="agent-status-header">Agent Header</div>,
}));

// Mock agent-output-panel exports
vi.mock("@/components/agent-output-panel", () => ({
  MessageItem: ({ message }: { message: { content?: string } }) => (
    <div data-testid="message-item">{message.content}</div>
  ),
  TurnMarker: ({ turn }: { turn: number }) => <div data-testid="turn-marker">Turn {turn}</div>,
  computeMessageGroups: (
    messages: Array<{ type: string }>,
    _turnMap: Map<number, number>,
  ) => {
    // Simple mock: first gets "none", rest "continuation"
    return messages.map((msg, i) => {
      if (msg.type === "system") return "none";
      if (i === 0) return "none";
      return "continuation";
    });
  },
  spacingClasses: { none: "", "group-start": "mt-3", continuation: "mt-0.5" },
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { RefinementChat } from "@/components/refinement-chat";

// --- Helpers ---

/** Simulate an agent completing with the given assistant text. */
function simulateAgentCompletion(agentId: string, text: string) {
  const store = useAgentStore.getState();
  // Add init message with session ID
  store.addMessage(agentId, {
    type: "system",
    content: undefined,
    raw: { subtype: "init", session_id: "session-123", model: "sonnet" },
    timestamp: Date.now(),
  });
  // Add assistant message
  store.addMessage(agentId, {
    type: "assistant",
    content: text,
    raw: { message: { content: [{ type: "text", text }] } },
    timestamp: Date.now(),
  });
  // Add result message
  store.addMessage(agentId, {
    type: "result",
    content: "Success",
    raw: { cost_usd: 0.02, usage: { input_tokens: 3000, output_tokens: 1000 } },
    timestamp: Date.now(),
  });
  // Mark completed
  store.completeRun(agentId, true);
}

// --- Tests ---

describe("RefinementChat", () => {
  const defaultProps = {
    skillName: "test-skill",
    domain: "Test Domain",
    workspacePath: "/workspace",
  };

  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    useSettingsStore.getState().setSettings({ skillsPath: "/skills" });

    mockStartAgent.mockReset().mockResolvedValue("agent-1");
    mockGetArtifactContent.mockReset().mockResolvedValue(null);
    mockSaveChatSession.mockReset().mockResolvedValue(undefined);
    mockLoadChatSession.mockReset().mockResolvedValue(null);
  });

  it("renders empty state with input when no persisted messages", async () => {
    render(<RefinementChat {...defaultProps} />);

    // Should show input
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ask a question or request a change/)).toBeInTheDocument();
    });

    // Should not show any messages
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("restores messages from disk on mount", async () => {
    const savedSession = {
      sessionId: "session-456",
      stepId: 8,
      messages: [
        { role: "user", content: "Can you improve the skill description?", timestamp: "2025-01-01T00:00:00.000Z" },
        { role: "assistant", content: "I've updated the description with more clarity.", timestamp: "2025-01-01T00:00:01.000Z", agentId: "agent-1" },
      ],
      lastUpdated: "2025-01-01T00:00:00.000Z",
    };

    mockLoadChatSession.mockResolvedValueOnce(savedSession);

    render(<RefinementChat {...defaultProps} />);

    // Should restore messages (assistant mapped back to agent role internally)
    await waitFor(() => {
      expect(screen.getByText("Can you improve the skill description?")).toBeInTheDocument();
      expect(screen.getByText("I've updated the description with more clarity.")).toBeInTheDocument();
    });

    // Should call loadChatSession
    expect(mockLoadChatSession).toHaveBeenCalledWith("/workspace", "test-skill", "refinement");
  });

  it("falls back to SQLite artifact when disk file not found", async () => {
    const savedSession = {
      messages: [
        { role: "user", content: "Can you improve the skill description?" },
        { role: "agent", content: "I've updated the description with more clarity." },
      ],
      sessionId: "session-456",
      lastUpdated: "2025-01-01T00:00:00.000Z",
    };

    // Disk returns null
    mockLoadChatSession.mockResolvedValueOnce(null);
    // SQLite has the session
    mockGetArtifactContent.mockResolvedValueOnce({
      content: JSON.stringify(savedSession),
      skill_name: "test-skill",
      step_id: 8,
      relative_path: "context/refinement-chat.json",
      size_bytes: 100,
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:00:00.000Z",
    });

    render(<RefinementChat {...defaultProps} />);

    // Should restore messages from SQLite fallback
    await waitFor(() => {
      expect(screen.getByText("Can you improve the skill description?")).toBeInTheDocument();
      expect(screen.getByText("I've updated the description with more clarity.")).toBeInTheDocument();
    });

    // Should call getArtifactContent as fallback
    expect(mockGetArtifactContent).toHaveBeenCalledWith("test-skill", "context/refinement-chat.json");
  });

  it("shows user message after sending", async () => {
    const user = userEvent.setup();
    render(<RefinementChat {...defaultProps} />);

    const input = await screen.findByPlaceholderText(/Ask a question or request a change/);
    await user.type(input, "Add more examples");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /send message/i }));
    });

    // Should show user message
    await waitFor(() => {
      expect(screen.getByText("Add more examples")).toBeInTheDocument();
    });
  });

  it("disables input while agent running", async () => {
    const user = userEvent.setup();
    render(<RefinementChat {...defaultProps} />);

    const input = await screen.findByPlaceholderText(/Ask a question or request a change/);
    await user.type(input, "Test message");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /send message/i }));
    });

    // Start agent run (but don't complete)
    act(() => {
      useAgentStore.getState().startRun("agent-1", "sonnet");
    });

    // Input should be disabled
    await waitFor(() => {
      expect(input).toBeDisabled();
      expect(screen.getByPlaceholderText("Waiting for agent response...")).toBeInTheDocument();
    });
  });

  it("includes system prompt on first turn", async () => {
    const user = userEvent.setup();
    render(<RefinementChat {...defaultProps} />);

    const input = await screen.findByPlaceholderText(/Ask a question or request a change/);
    await user.type(input, "First message");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /send message/i }));
    });

    // Should call startAgent with system prompt
    await waitFor(() => {
      expect(mockStartAgent).toHaveBeenCalledWith(
        expect.stringContaining("refinement-"),
        expect.stringContaining("You are a skill refinement assistant"),
        "sonnet",
        "/workspace",
        ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"],
        50,
        undefined, // No session ID yet
        "test-skill",
        "chat",
      );
    });

    // Prompt should include context
    const [, prompt] = mockStartAgent.mock.calls[0];
    expect(prompt).toContain("Skill Name**: test-skill");
    expect(prompt).toContain("Domain**: Test Domain");
    expect(prompt).toContain("Workspace Path**: /workspace");
    expect(prompt).toContain("Output Directory**: /skills/test-skill");
    expect(prompt).toContain("First message");
  });

  it("resumes with sessionId on subsequent turns", async () => {
    const user = userEvent.setup();
    render(<RefinementChat {...defaultProps} />);

    // First turn
    const input = await screen.findByPlaceholderText(/Ask a question or request a change/);
    await user.type(input, "First message");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /send message/i }));
    });

    // Complete first agent run
    act(() => {
      simulateAgentCompletion("agent-1", "I've made the changes you requested.");
    });

    // Wait for completion
    await waitFor(() => {
      expect(screen.getByText("I've made the changes you requested.")).toBeInTheDocument();
    });

    // Second turn
    mockStartAgent.mockResolvedValueOnce("agent-2");
    await user.type(input, "Another request");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /send message/i }));
    });

    // Should resume with session ID and no system prompt
    await waitFor(() => {
      expect(mockStartAgent).toHaveBeenCalledWith(
        expect.stringContaining("refinement-"),
        "Another request", // Just the user message, no system prompt
        "sonnet",
        "/workspace",
        ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"],
        50,
        "session-123", // Session ID from first turn
        "test-skill",
        "chat",
      );
    });
  });

  it("saves session to disk after agent completion", async () => {
    const user = userEvent.setup();
    render(<RefinementChat {...defaultProps} />);

    const input = await screen.findByPlaceholderText(/Ask a question or request a change/);
    await user.type(input, "Test message");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /send message/i }));
    });

    // Complete agent run
    act(() => {
      simulateAgentCompletion("agent-1", "Done!");
    });

    // Should save session via saveChatSession
    await waitFor(() => {
      expect(mockSaveChatSession).toHaveBeenCalledWith(
        "/workspace",
        "test-skill",
        "refinement",
        expect.objectContaining({
          sessionId: "session-123",
          stepId: 8,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "Test message" }),
            expect.objectContaining({ role: "assistant", content: "Done!", agentId: "agent-1" }),
          ]),
        }),
      );
    });

    // Check saved content structure
    const savedSession = mockSaveChatSession.mock.calls[0][3] as Record<string, unknown>;
    const savedMessages = savedSession.messages as Array<Record<string, unknown>>;
    expect(savedMessages).toHaveLength(2);
    expect(savedMessages[0].role).toBe("user");
    expect(savedMessages[0].content).toBe("Test message");
    expect(savedMessages[1].role).toBe("assistant");
    expect(savedMessages[1].content).toBe("Done!");
    expect(savedMessages[1].agentId).toBe("agent-1");
    expect(savedSession.sessionId).toBe("session-123");
  });

  it("supports Enter to send message", async () => {
    const user = userEvent.setup();
    render(<RefinementChat {...defaultProps} />);

    const input = await screen.findByPlaceholderText(/Ask a question or request a change/);
    await user.type(input, "Quick message");
    await user.keyboard("{Enter}");

    // Should start agent
    await waitFor(() => {
      expect(mockStartAgent).toHaveBeenCalled();
    });

    // Should clear input
    expect(input).toHaveValue("");
  });

  it("supports Shift+Enter for multi-line input without sending", async () => {
    const user = userEvent.setup();
    render(<RefinementChat {...defaultProps} />);

    const input = await screen.findByPlaceholderText(/Ask a question or request a change/);
    await user.type(input, "Line 1{Shift>}{Enter}{/Shift}Line 2");

    // Should not start agent
    expect(mockStartAgent).not.toHaveBeenCalled();

    // Should have multi-line content
    expect(input).toHaveValue("Line 1\nLine 2");
  });

  it("handles agent errors gracefully", async () => {
    const user = userEvent.setup();
    render(<RefinementChat {...defaultProps} />);

    const input = await screen.findByPlaceholderText(/Ask a question or request a change/);
    await user.type(input, "Test");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /send message/i }));
    });

    // Simulate agent error
    act(() => {
      const store = useAgentStore.getState();
      store.addMessage("agent-1", {
        type: "error",
        content: "Something went wrong",
        raw: {},
        timestamp: Date.now(),
      });
      store.completeRun("agent-1", false);
    });

    // Should show error message
    await waitFor(() => {
      expect(screen.getByText(/Error: Something went wrong/)).toBeInTheDocument();
    });

    // Input should be re-enabled
    await waitFor(() => {
      expect(input).not.toBeDisabled();
    });
  });
});
