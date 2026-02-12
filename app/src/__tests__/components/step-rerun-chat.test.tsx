import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { createRef } from "react";
import userEvent from "@testing-library/user-event";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { ReactNode } from "react";

// Polyfill scrollIntoView for jsdom
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// Mock Tauri commands -- vi.hoisted ensures these are available during vi.mock hoisting
const {
  mockRunWorkflowStep,
  mockStartAgent,
  mockCaptureStepArtifacts,
  mockLoadChatSession,
  mockSaveChatSession,
} = vi.hoisted(() => ({
  mockRunWorkflowStep: vi.fn((..._args: unknown[]) => Promise.resolve("agent-1")),
  mockStartAgent: vi.fn((..._args: unknown[]) => Promise.resolve("agent-2")),
  mockCaptureStepArtifacts: vi.fn((..._args: unknown[]) => Promise.resolve()),
  mockLoadChatSession: vi.fn((..._args: unknown[]): Promise<Record<string, unknown> | null> => Promise.resolve(null)),
  mockSaveChatSession: vi.fn((..._args: unknown[]) => Promise.resolve()),
}));

vi.mock("@/lib/tauri", () => ({
  runWorkflowStep: mockRunWorkflowStep,
  startAgent: mockStartAgent,
  captureStepArtifacts: mockCaptureStepArtifacts,
}));

vi.mock("@/lib/chat-storage", () => ({
  loadChatSession: mockLoadChatSession,
  saveChatSession: mockSaveChatSession,
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
    turnMap: Map<number, number>,
  ) => {
    return messages.map((msg, i) => {
      if (msg.type === "system") return "none";
      if (i === 0) return "none";
      if ((turnMap.get(i) ?? 0) > 0) return "group-start";
      return "continuation";
    });
  },
  spacingClasses: { none: "", "group-start": "mt-3", continuation: "mt-0.5" },
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { StepRerunChat, type StepRerunChatHandle } from "@/components/step-rerun-chat";

// --- Helpers ---

/** Simulate an agent completing with the given assistant text. */
function simulateAgentCompletion(agentId: string, text: string) {
  const store = useAgentStore.getState();
  // Add init message with session ID
  store.addMessage(agentId, {
    type: "system",
    content: undefined,
    raw: { subtype: "init", session_id: "session-456", model: "sonnet" },
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
    raw: { total_cost_usd: 0.02, usage: { input_tokens: 3000, output_tokens: 1000 } },
    timestamp: Date.now(),
  });
  // Mark completed
  store.completeRun(agentId, true);
}

const AGENT_RERUN_SUMMARY = `## Reviewing existing output

I've reviewed the current output from the research-concepts step. Here's what I found:

### Current state
- 15 clarification questions generated
- Covers 3 major concept areas

### Suggestions for improvement
- Some questions overlap in scope
- Missing coverage on edge cases for subscription billing

What would you like me to focus on?`;

const AGENT_REVISED_OUTPUT = `## Updated output

I've revised the clarification questions based on your feedback:

1. Added 3 new questions about subscription billing edge cases
2. Removed 2 duplicate questions
3. Restructured for better flow

The updated file has been written to context/clarifications-concepts.md.`;

// --- Tests ---

describe("StepRerunChat", () => {
  const defaultProps = {
    skillName: "saas-revenue",
    domain: "SaaS Revenue Analytics",
    workspacePath: "/workspace",
    skillType: "domain",
    stepId: 0,
    stepLabel: "research-concepts",
    onComplete: vi.fn(),
  };

  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    useWorkflowStore.getState().reset();
    useWorkflowStore.getState().initWorkflow("saas-revenue", "SaaS Revenue Analytics", "domain");

    useSettingsStore.getState().setSettings({
      workspacePath: "/workspace",
      skillsPath: "/skills",
    });

    mockRunWorkflowStep.mockReset().mockResolvedValue("agent-1");
    mockStartAgent.mockReset().mockResolvedValue("agent-2");
    mockCaptureStepArtifacts.mockReset().mockResolvedValue(undefined);
    mockLoadChatSession.mockReset().mockResolvedValue(null);
    mockSaveChatSession.mockReset().mockResolvedValue(undefined);
    defaultProps.onComplete.mockReset();
  });

  it("auto-launches rerun agent on mount when no existing session", async () => {
    render(<StepRerunChat {...defaultProps} />);

    // Should call runWorkflowStep with rerun: true and default agentTimeout
    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalledWith(
        "saas-revenue",
        0,
        "SaaS Revenue Analytics",
        "/workspace",
        false, // resume
        true,  // rerun
        90,    // agentTimeout (default)
      );
    });

    // Agent run should be registered in store
    expect(useAgentStore.getState().runs["agent-1"]).toBeDefined();
  });

  it("restores existing session and does not auto-launch", async () => {
    const savedSession = {
      sessionId: "session-existing",
      stepId: 0,
      messages: [
        { role: "assistant", content: "Previous summary", timestamp: new Date().toISOString() },
        { role: "user", content: "Focus on billing", timestamp: new Date().toISOString() },
      ],
    };

    mockLoadChatSession.mockResolvedValue(savedSession);

    render(<StepRerunChat {...defaultProps} />);

    // Should display restored messages (disk "assistant" mapped to internal "agent")
    await waitFor(() => {
      expect(screen.getByText("Previous summary")).toBeInTheDocument();
      expect(screen.getByText("Focus on billing")).toBeInTheDocument();
    });

    // Should NOT auto-launch a new agent
    expect(mockRunWorkflowStep).not.toHaveBeenCalled();
  });

  it("displays agent response after initial rerun completes", async () => {
    render(<StepRerunChat {...defaultProps} />);

    // Wait for auto-launch
    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    // Simulate agent completion
    act(() => {
      simulateAgentCompletion("agent-1", AGENT_RERUN_SUMMARY);
    });

    // Should show the agent's summary
    await waitFor(() => {
      expect(screen.getByText(/Reviewing existing output/)).toBeInTheDocument();
    });
  });

  it("sends user message and resumes agent with session ID", async () => {
    render(<StepRerunChat {...defaultProps} />);

    // Wait for auto-launch and completion
    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    act(() => {
      simulateAgentCompletion("agent-1", AGENT_RERUN_SUMMARY);
    });

    await waitFor(() => {
      expect(screen.getByText(/Reviewing existing output/)).toBeInTheDocument();
    });

    // Type and send a message
    const user = userEvent.setup();
    const textarea = screen.getByPlaceholderText(/Guide the agent/);
    await user.type(textarea, "Focus on subscription billing edge cases");
    await user.keyboard("{Enter}");

    // Should call startAgent with session ID
    expect(mockStartAgent).toHaveBeenCalledWith(
      expect.stringContaining("rerun-research-concepts-"),
      expect.stringContaining("Focus on subscription billing edge cases"),
      "sonnet",
      "/workspace",
      ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"],
      50,
      "session-456",
      "saas-revenue",
      "rerun-step0-research-concepts",
      "domain-research-concepts",
    );
  });

  it("shows revised agent output after feedback cycle", async () => {
    const user = userEvent.setup();
    render(<StepRerunChat {...defaultProps} />);

    // Initial launch and completion
    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    act(() => {
      simulateAgentCompletion("agent-1", AGENT_RERUN_SUMMARY);
    });

    await waitFor(() => {
      expect(screen.getByText(/Reviewing existing output/)).toBeInTheDocument();
    });

    // Send feedback
    const textarea = screen.getByPlaceholderText(/Guide the agent/);
    await user.type(textarea, "Add billing edge cases");
    await user.keyboard("{Enter}");

    // Simulate second agent completion
    act(() => {
      useAgentStore.getState().registerRun("agent-2", "sonnet");
      simulateAgentCompletion("agent-2", AGENT_REVISED_OUTPUT);
    });

    // Should show the revised output
    await waitFor(() => {
      expect(screen.getByText(/Updated output/)).toBeInTheDocument();
    });
  });

  it("captures artifacts after each agent turn", async () => {
    render(<StepRerunChat {...defaultProps} />);

    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    act(() => {
      simulateAgentCompletion("agent-1", AGENT_RERUN_SUMMARY);
    });

    // Should capture artifacts after completion
    await waitFor(() => {
      expect(mockCaptureStepArtifacts).toHaveBeenCalledWith(
        "saas-revenue",
        0,
        "/workspace",
      );
    });
  });

  it("saves session after each agent turn", async () => {
    render(<StepRerunChat {...defaultProps} />);

    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    act(() => {
      simulateAgentCompletion("agent-1", AGENT_RERUN_SUMMARY);
    });

    // Should save session to disk-based storage
    await waitFor(() => {
      expect(mockSaveChatSession).toHaveBeenCalledWith(
        "/workspace",
        "saas-revenue",
        "rerun-step-0",
        expect.objectContaining({
          sessionId: "session-456",
          stepId: 0,
          messages: expect.any(Array),
        }),
      );
    });

    // Verify saved content includes messages with disk format (role: "assistant")
    const savedSession = mockSaveChatSession.mock.calls[0][3] as Record<string, unknown>;
    const savedMessages = savedSession.messages as Array<Record<string, unknown>>;
    expect(savedMessages).toHaveLength(1);
    expect(savedMessages[0].role).toBe("assistant");
    expect(savedSession.sessionId).toBe("session-456");
  });

  it("exposes completeStep via ref that captures artifacts and calls onComplete", async () => {
    const ref = createRef<StepRerunChatHandle>();
    render(<StepRerunChat {...defaultProps} ref={ref} />);

    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    act(() => {
      simulateAgentCompletion("agent-1", AGENT_RERUN_SUMMARY);
    });

    await waitFor(() => {
      expect(screen.getByText(/Reviewing existing output/)).toBeInTheDocument();
    });

    // Reset mock to check the final capture call
    mockCaptureStepArtifacts.mockReset().mockResolvedValue(undefined);

    // Call completeStep via ref (as parent workflow.tsx would)
    await act(async () => {
      await ref.current?.completeStep();
    });

    // Should capture artifacts one final time
    expect(mockCaptureStepArtifacts).toHaveBeenCalledWith(
      "saas-revenue",
      0,
      "/workspace",
    );

    // Should call onComplete callback
    expect(defaultProps.onComplete).toHaveBeenCalled();
  });

  it("shows error toast when rerun agent fails to start", async () => {
    const { toast } = await import("sonner");
    mockRunWorkflowStep.mockRejectedValueOnce(new Error("Backend error"));

    render(<StepRerunChat {...defaultProps} />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to start rerun agent"),
        { duration: Infinity },
      );
    });
  });

  it("shows error toast when agent encounters an error during execution", async () => {
    const { toast } = await import("sonner");
    render(<StepRerunChat {...defaultProps} />);

    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    // Simulate agent error
    act(() => {
      const store = useAgentStore.getState();
      store.addMessage("agent-1", {
        type: "error",
        content: "Model returned an error",
        raw: {},
        timestamp: Date.now(),
      });
      store.completeRun("agent-1", false);
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Rerun agent encountered an error"),
        { duration: Infinity },
      );
    });
  });

  it("disables input while agent is running", async () => {
    render(<StepRerunChat {...defaultProps} />);

    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    // While agent is running, textarea should show waiting message
    const textarea = screen.getByPlaceholderText("Waiting for agent response...");
    expect(textarea).toBeDisabled();
  });

  it("works correctly for build step (step 5)", async () => {
    const buildProps = {
      ...defaultProps,
      stepId: 5,
      stepLabel: "build",
    };

    render(<StepRerunChat {...buildProps} />);

    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalledWith(
        "saas-revenue",
        5,
        "SaaS Revenue Analytics",
        "/workspace",
        false,
        true,
        90,
      );
    });
  });
});
