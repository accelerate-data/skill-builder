import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
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
  mockReadFile,
} = vi.hoisted(() => ({
  mockRunWorkflowStep: vi.fn(() => Promise.resolve("agent-1")),
  mockReadFile: vi.fn<(...args: unknown[]) => Promise<string>>(() => Promise.reject(new Error("not found"))),
}));

vi.mock("@/lib/tauri", () => ({
  runWorkflowStep: mockRunWorkflowStep,
  readFile: mockReadFile,
  persistAgentRun: vi.fn().mockResolvedValue(undefined),
  createWorkflowSession: vi.fn(() => Promise.resolve()),
  endWorkflowSession: vi.fn(() => Promise.resolve()),
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

// Mock agent-output-panel exports used in reasoning-review
vi.mock("@/components/agent-output-panel", () => ({
  MessageItem: ({ message }: { message: { content?: string } }) => (
    <div data-testid="message-item">{message.content}</div>
  ),
  TurnMarker: ({ turn }: { turn: number }) => <div data-testid="turn-marker">Turn {turn}</div>,
  ToolCallGroup: ({ messages }: { messages: Array<{ content?: string }> }) => (
    <div data-testid="tool-call-group">{messages.length} tool calls</div>
  ),
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
  computeToolCallGroups: () => ({
    groups: new Map(),
    memberOf: new Map(),
  }),
  spacingClasses: { none: "", "group-start": "mt-3", continuation: "mt-0.5" },
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { ReasoningReview } from "@/components/reasoning-review";

// --- Helpers ---

/** Simulate an agent completing with the given assistant text. */
function simulateAgentCompletion(agentId: string, text: string) {
  const store = useAgentStore.getState();
  store.addMessage(agentId, {
    type: "system",
    content: undefined,
    raw: { subtype: "init", session_id: "session-123", model: "opus" },
    timestamp: Date.now(),
  });
  store.addMessage(agentId, {
    type: "assistant",
    content: text,
    raw: { message: { content: [{ type: "text", text }] } },
    timestamp: Date.now(),
  });
  store.addMessage(agentId, {
    type: "result",
    content: "Success",
    raw: { total_cost_usd: 0.05, usage: { input_tokens: 5000, output_tokens: 2000 } },
    timestamp: Date.now(),
  });
  store.completeRun(agentId, true);
}

/** Simulate an agent erroring out. */
function simulateAgentError(agentId: string) {
  const store = useAgentStore.getState();
  store.addMessage(agentId, {
    type: "error",
    content: "Model returned an error",
    raw: {},
    timestamp: Date.now(),
  });
  store.completeRun(agentId, false);
}

const AGENT_RESPONSE = `## Reasoning Analysis

Based on your answers, I've identified the key design implications for this skill.

### Key findings
1. Revenue should be tracked monthly
2. Churn data should be retained`;

const DECISIONS_MD = `## Decisions

### D1: Revenue Recognition Method
- **Decision**: Periodic (monthly) recognition over contract period
- **Rationale**: Standard for SaaS
- **Impact**: Revenue reporting, forecasting models

### D2: Churn Data Policy
- **Decision**: Include churned customers in all analyses
- **Rationale**: Required for churn impact analysis
- **Impact**: Data model must retain churned customer records

### D3: Revenue Tracking Granularity
- **Decision**: Track MRR and ARR separately
- **Rationale**: Different use cases for monthly vs annual metrics
- **Impact**: Two parallel revenue calculation paths`;

// --- Tests ---

describe("ReasoningReview", () => {
  const defaultProps = {
    skillName: "saas-revenue",
    domain: "SaaS Revenue Analytics",
    workspacePath: "/workspace",
    onStepComplete: vi.fn(),
  };

  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    useWorkflowStore.getState().reset();
    useWorkflowStore.getState().initWorkflow("saas-revenue", "SaaS Revenue Analytics", "domain");
    useWorkflowStore.getState().setCurrentStep(4);

    useSettingsStore.getState().setSettings({
      workspacePath: "/workspace",
      skillsPath: "/skills",
      debugMode: false,
    });

    mockRunWorkflowStep.mockReset().mockResolvedValue("agent-1");
    mockReadFile.mockReset().mockRejectedValue(new Error("not found"));
    defaultProps.onStepComplete.mockReset();
  });

  it("auto-starts agent on mount via runWorkflowStep", async () => {
    render(<ReasoningReview {...defaultProps} />);

    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalledWith(
        "saas-revenue", 4, "SaaS Revenue Analytics", "/workspace", false, false,
      );
    });

    // Agent run should be registered in store
    expect(useAgentStore.getState().runs["agent-1"]).toBeDefined();
  });

  it("shows agent status header and message items while agent is running", async () => {
    render(<ReasoningReview {...defaultProps} />);

    // Wait for the agent run to be registered in the store (launchAgent resolves and calls registerRun)
    await waitFor(() => {
      expect(useAgentStore.getState().runs["agent-1"]).toBeDefined();
    });

    // Agent status header should be visible once currentAgentId is set
    expect(screen.getByTestId("agent-status-header")).toBeInTheDocument();

    // Add a message while still running (don't complete)
    act(() => {
      const store = useAgentStore.getState();
      store.addMessage("agent-1", {
        type: "assistant",
        content: "Analyzing your answers...",
        raw: { message: { content: [{ type: "text", text: "Analyzing your answers..." }] } },
        timestamp: Date.now(),
      });
    });

    // Message items should be rendered
    expect(screen.getByTestId("message-item")).toBeInTheDocument();
    expect(screen.getByText("Analyzing your answers...")).toBeInTheDocument();
  });

  it("loads decisions.md when agent completes", async () => {
    // Mock readFile to return decisions from skills path
    mockReadFile.mockImplementation((...args: unknown[]) => {
      const filePath = args[0] as string;
      if (filePath === "/skills/saas-revenue/context/decisions.md") {
        return Promise.resolve(DECISIONS_MD);
      }
      return Promise.reject(new Error("not found"));
    });

    render(<ReasoningReview {...defaultProps} />);

    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    // Simulate agent completion
    act(() => {
      simulateAgentCompletion("agent-1", AGENT_RESPONSE);
    });

    // Should render the decisions content
    await waitFor(() => {
      expect(screen.getByText(/Revenue Recognition Method/)).toBeInTheDocument();
      expect(screen.getByText(/Churn Data Policy/)).toBeInTheDocument();
    });

    // Should show decision count badge (3 decisions with ### D pattern)
    expect(screen.getByText("3 decisions")).toBeInTheDocument();
  });

  it("Complete Step button captures artifacts, validates, marks completed, and calls onStepComplete", async () => {
    const user = userEvent.setup();

    // Mock readFile to return decisions
    mockReadFile.mockImplementation((...args: unknown[]) => {
      const filePath = args[0] as string;
      if (filePath.includes("decisions.md")) {
        return Promise.resolve(DECISIONS_MD);
      }
      return Promise.reject(new Error("not found"));
    });

    render(<ReasoningReview {...defaultProps} />);

    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    act(() => {
      simulateAgentCompletion("agent-1", AGENT_RESPONSE);
    });

    // Wait for decisions to load and the completed view to render
    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // Click Complete Step
    await user.click(screen.getByText("Complete Step"));

    // Should mark step as completed
    await waitFor(() => {
      const store = useWorkflowStore.getState();
      expect(store.steps[4].status).toBe("completed");
    });

    // Should call onStepComplete
    expect(defaultProps.onStepComplete).toHaveBeenCalled();
  });

  it("blocks Complete Step when decisions.md is missing everywhere", async () => {
    const user = userEvent.setup();
    const { toast } = await import("sonner");

    render(<ReasoningReview {...defaultProps} />);

    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    act(() => {
      simulateAgentCompletion("agent-1", AGENT_RESPONSE);
    });

    // Wait for the completed view (decisions won't load since readFile rejects)
    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // readFile rejects for all paths (default mock behavior)

    // Click Complete Step
    await user.click(screen.getByText("Complete Step"));

    // Should show error toast
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Decisions file was not created"),
        { duration: Infinity },
      );
    });

    // Step should NOT be completed
    const store = useWorkflowStore.getState();
    expect(store.steps[4].status).not.toBe("completed");

    // onStepComplete should NOT have been called
    expect(defaultProps.onStepComplete).not.toHaveBeenCalled();
  });

  it("allows Complete Step when decisions.md found in workspace path (fallback)", async () => {
    const user = userEvent.setup();

    render(<ReasoningReview {...defaultProps} />);

    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    act(() => {
      simulateAgentCompletion("agent-1", AGENT_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // Mock readFile: skills path fails, workspace path succeeds
    mockReadFile.mockImplementation((...args: unknown[]) => {
      const filePath = args[0] as string;
      if (filePath === "/workspace/saas-revenue/context/decisions.md") {
        return Promise.resolve(DECISIONS_MD);
      }
      return Promise.reject(new Error("not found"));
    });

    await user.click(screen.getByText("Complete Step"));

    await waitFor(() => {
      const store = useWorkflowStore.getState();
      expect(store.steps[4].status).toBe("completed");
    });

    expect(defaultProps.onStepComplete).toHaveBeenCalled();
  });

  it("debug mode auto-completes after agent finishes, skipping decisions validation", async () => {
    // Enable debug mode
    useSettingsStore.getState().setSettings({ debugMode: true });

    // No decisions.md exists anywhere -- would normally block completion
    mockReadFile.mockRejectedValue(new Error("not found"));

    render(<ReasoningReview {...defaultProps} />);

    // Wait for auto-start
    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    // Simulate agent completion -- loadDecisions will find nothing, but that's ok for debug
    // We need decisionsContent to be set for the debug auto-complete effect to fire.
    // The component checks: if (!debugMode || debugAutoCompletedRef.current) return;
    //                       if (!agentCompleted || !decisionsContent) return;
    // So for debug auto-complete, decisionsContent must be truthy.
    // Let's provide decisions so it triggers.
    mockReadFile.mockReset().mockImplementation((...args: unknown[]) => {
      const filePath = args[0] as string;
      if (filePath.includes("decisions.md")) {
        return Promise.resolve(DECISIONS_MD);
      }
      return Promise.reject(new Error("not found"));
    });

    act(() => {
      simulateAgentCompletion("agent-1", AGENT_RESPONSE);
    });

    // In debug mode, should auto-complete after agent finishes + decisions loaded
    await waitFor(() => {
      const store = useWorkflowStore.getState();
      expect(store.steps[4].status).toBe("completed");
    }, { timeout: 1000 });

    // Should call onStepComplete
    expect(defaultProps.onStepComplete).toHaveBeenCalled();
  });

  it("shows error guidance when agent fails", async () => {
    render(<ReasoningReview {...defaultProps} />);

    await waitFor(() => {
      expect(mockRunWorkflowStep).toHaveBeenCalled();
    });

    // Simulate agent error
    act(() => {
      simulateAgentError("agent-1");
    });

    // Should show error badge
    await waitFor(() => {
      expect(screen.getByText("Agent Error")).toBeInTheDocument();
    });

    // Should show error guidance text
    expect(screen.getByText(/reasoning agent encountered an error/)).toBeInTheDocument();

    // Should still show Complete Step button
    expect(screen.getByText("Complete Step")).toBeInTheDocument();
  });

  it("shows error toast on agent launch failure", async () => {
    const { toast } = await import("sonner");
    mockRunWorkflowStep.mockRejectedValueOnce(new Error("Backend error"));

    render(<ReasoningReview {...defaultProps} />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to start reasoning agent"),
        { duration: Infinity },
      );
    });
  });
});
