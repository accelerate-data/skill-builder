import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useState, useRef, type ReactNode } from "react";

// Polyfill scrollIntoView for jsdom
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// Mock Tauri commands — vi.hoisted ensures these are available during vi.mock hoisting
const {
  mockRunWorkflowStep,
  mockStartAgent,
  mockCaptureStepArtifacts,
  mockGetArtifactContent,
  mockSaveArtifactContent,
  mockReadFile,
} = vi.hoisted(() => ({
  mockRunWorkflowStep: vi.fn(() => Promise.resolve("agent-1")),
  mockStartAgent: vi.fn(() => Promise.resolve("agent-2")),
  mockCaptureStepArtifacts: vi.fn(() => Promise.resolve()),
  mockGetArtifactContent: vi.fn(() => Promise.resolve(null)),
  mockSaveArtifactContent: vi.fn(() => Promise.resolve()),
  mockReadFile: vi.fn(() => Promise.reject(new Error("not found"))),
}));

vi.mock("@/lib/tauri", () => ({
  runWorkflowStep: mockRunWorkflowStep,
  startAgent: mockStartAgent,
  captureStepArtifacts: mockCaptureStepArtifacts,
  getArtifactContent: mockGetArtifactContent,
  saveArtifactContent: mockSaveArtifactContent,
  readFile: mockReadFile,
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

// Mock agent-output-panel exports used in reasoning-chat
vi.mock("@/components/agent-output-panel", () => ({
  MessageItem: ({ message }: { message: { content?: string } }) => (
    <div data-testid="message-item">{message.content}</div>
  ),
  TurnMarker: ({ turn }: { turn: number }) => <div data-testid="turn-marker">Turn {turn}</div>,
  computeMessageGroups: (
    messages: Array<{ type: string }>,
    turnMap: Map<number, number>,
  ) => {
    // Realistic mock: first visible gets "none", turn markers get "group-start", rest "continuation"
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

import { ReasoningChat, type ReasoningChatHandle, type ReasoningPhase } from "@/components/reasoning-chat";

// --- Test wrapper ---
// Mimics workflow.tsx: renders "Complete Step" button in a header when phase is awaiting_feedback.

interface TestWrapperProps {
  skillName: string;
  domain: string;
  workspacePath: string;
  onPhaseChange?: (phase: ReasoningPhase) => void;
}

function TestWrapper(props: TestWrapperProps) {
  const ref = useRef<ReasoningChatHandle>(null);
  const [phase, setPhase] = useState<ReasoningPhase>("not_started");

  return (
    <>
      {phase === "awaiting_feedback" && (
        <button onClick={() => ref.current?.completeStep()}>Complete Step</button>
      )}
      <ReasoningChat
        ref={ref}
        skillName={props.skillName}
        domain={props.domain}
        workspacePath={props.workspacePath}
        onPhaseChange={(p) => {
          setPhase(p);
          props.onPhaseChange?.(p);
        }}
      />
    </>
  );
}

// --- Helpers ---

/** Simulate an agent completing with the given assistant text. */
function simulateAgentCompletion(agentId: string, text: string) {
  const store = useAgentStore.getState();
  // Add init message with session ID
  store.addMessage(agentId, {
    type: "system",
    content: undefined,
    raw: { subtype: "init", session_id: "session-123", model: "opus" },
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
    raw: { cost_usd: 0.05, usage: { input_tokens: 5000, output_tokens: 2000 } },
    timestamp: Date.now(),
  });
  // Mark completed
  store.completeRun(agentId, true);
}

const AGENT_SUMMARY_RESPONSE = `## What I concluded

Based on your answers, I've identified the key design implications for the SaaS Revenue Analytics skill.

## Assumptions I'm making

1. You want both monthly and annual recurring revenue tracked separately
2. Revenue recognition follows ASC 606 standards

## Conflicts or tensions

There is a significant conflict in your responses:
- In Q3, you stated that revenue should be recognized at the point of sale
- In Q7, you stated that revenue should be recognized over the contract period

I've written decisions.md with my analysis. Please review and provide feedback.`;

const REVISED_RESPONSE = `## What I concluded

Thank you for the clarifications. The conflicts are now resolved:
- Revenue will be recognized monthly over the contract period (periodic recognition)
- Churned customers will be included in all analyses for complete churn impact tracking

## Assumptions I'm making

1. Periodic recognition applies to all subscription tiers equally
2. Churn metrics include both voluntary and involuntary churn

I've updated decisions.md with the resolved conflicts.`;

const DECISIONS_MD = `## Decisions

### D1: Revenue Recognition Method
- **Decision**: Periodic (monthly) recognition over contract period
- **Rationale**: Standard for SaaS, resolves conflict between Q3 and Q7
- **Impact**: Revenue reporting, forecasting models

### D2: Churn Data Policy
- **Decision**: Include churned customers in all analyses
- **Rationale**: Required for churn impact analysis (Q9), resolves conflict with Q5
- **Impact**: Data model must retain churned customer records

### D3: Revenue Tracking Granularity
- **Decision**: Track MRR and ARR separately
- **Rationale**: Different use cases for monthly vs annual metrics
- **Impact**: Two parallel revenue calculation paths`;

// --- Tests ---

describe("ReasoningChat — simplified write-first flow", () => {
  const defaultProps = {
    skillName: "saas-revenue",
    domain: "SaaS Revenue Analytics",
    workspacePath: "/workspace",
  };

  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    useWorkflowStore.getState().reset();
    useWorkflowStore.getState().initWorkflow("saas-revenue", "SaaS Revenue Analytics", "domain");
    useWorkflowStore.getState().setCurrentStep(4); // Reasoning step

    // Set up settings store with workspace and skills paths
    useSettingsStore.getState().setSettings({
      workspacePath: "/workspace",
      skillsPath: "/skills",
    });

    mockRunWorkflowStep.mockReset().mockResolvedValue("agent-1");
    mockStartAgent.mockReset().mockResolvedValue("agent-2");
    mockCaptureStepArtifacts.mockReset().mockResolvedValue(undefined);
    mockGetArtifactContent.mockReset().mockResolvedValue(null);
    mockSaveArtifactContent.mockReset().mockResolvedValue(undefined);
    mockReadFile.mockReset().mockRejectedValue(new Error("not found"));
  });

  it("shows start button initially", () => {
    render(<TestWrapper {...defaultProps} />);
    expect(screen.getByText("Start Reasoning")).toBeInTheDocument();
  });

  it("starts agent via runWorkflowStep on start click", async () => {
    const user = userEvent.setup();
    render(<TestWrapper {...defaultProps} />);

    await user.click(screen.getByText("Start Reasoning"));

    expect(mockRunWorkflowStep).toHaveBeenCalledWith(
      "saas-revenue", 4, "SaaS Revenue Analytics", "/workspace"
    );
    // Agent run registered in store
    expect(useAgentStore.getState().runs["agent-1"]).toBeDefined();
  });

  it("calls onPhaseChange and shows Complete Step in header after agent completes", async () => {
    const user = userEvent.setup();
    const onPhaseChange = vi.fn();
    render(<TestWrapper {...defaultProps} onPhaseChange={onPhaseChange} />);

    // Start reasoning
    await user.click(screen.getByText("Start Reasoning"));

    // Simulate agent completion with summary response
    act(() => {
      simulateAgentCompletion("agent-1", AGENT_SUMMARY_RESPONSE);
    });

    // Should show the agent response in chat
    await waitFor(() => {
      expect(screen.getByText(/significant conflict in your responses/)).toBeInTheDocument();
    });

    // Should show the Complete Step button in the header (via phase callback)
    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // Phase callback should have been called with awaiting_feedback
    expect(onPhaseChange).toHaveBeenCalledWith("awaiting_feedback");
  });

  it("sends user feedback via free-form input and resumes agent with session and agent name", async () => {
    const user = userEvent.setup();
    render(<TestWrapper {...defaultProps} />);

    // Start reasoning
    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1", AGENT_SUMMARY_RESPONSE);
    });

    // Wait for awaiting_feedback phase
    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // Type feedback in the free-form input
    const freeFormInput = screen.getByPlaceholderText(/Provide feedback or request revisions/);
    await user.type(freeFormInput, "Use periodic recognition for revenue. Include churned customers.");
    await user.keyboard("{Enter}");

    // Should resume agent via startAgent with session ID and agent name
    expect(mockStartAgent).toHaveBeenCalledWith(
      expect.stringContaining("reasoning-"),
      expect.stringContaining("Use periodic recognition for revenue. Include churned customers."),
      "opus",
      "/workspace",
      ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"],
      100,
      "session-123",
      "saas-revenue",
      "step4-reasoning",
      "domain-reasoning",
    );
  });

  it("shows revised response after feedback cycle", async () => {
    const user = userEvent.setup();

    // Mock getArtifactContent to return decisions after second turn
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockGetArtifactContent as any).mockImplementation((_skill: string, path: string) => {
      if (path === "context/decisions.md") {
        return Promise.resolve({ content: DECISIONS_MD });
      }
      return Promise.resolve(null);
    });

    render(<TestWrapper {...defaultProps} />);

    // Start reasoning
    await user.click(screen.getByText("Start Reasoning"));

    // Turn 1: Agent presents initial analysis
    act(() => {
      simulateAgentCompletion("agent-1", AGENT_SUMMARY_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // User sends feedback
    const freeFormInput = screen.getByPlaceholderText(/Provide feedback or request revisions/);
    await user.type(freeFormInput, "Use periodic recognition");
    await user.keyboard("{Enter}");

    // Turn 2: Agent responds with revised analysis
    act(() => {
      useAgentStore.getState().registerRun("agent-2", "opus");
      simulateAgentCompletion("agent-2", REVISED_RESPONSE);
    });

    // Should show the revised conclusions in chat
    await waitFor(() => {
      expect(screen.getByText(/conflicts are now resolved/)).toBeInTheDocument();
    });

    // Should still show Complete Step button
    expect(screen.getByText("Complete Step")).toBeInTheDocument();
  });

  it("updates decisions panel after each agent turn", async () => {
    const user = userEvent.setup();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockGetArtifactContent as any).mockImplementation((_skill: string, path: string) => {
      if (path === "context/decisions.md") {
        return Promise.resolve({ content: DECISIONS_MD });
      }
      return Promise.resolve(null);
    });

    render(<TestWrapper {...defaultProps} />);

    // Start and complete first turn
    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1", AGENT_SUMMARY_RESPONSE);
    });

    // captureStepArtifacts should be called to capture decisions
    await waitFor(() => {
      expect(mockCaptureStepArtifacts).toHaveBeenCalledWith("saas-revenue", 4, "/workspace");
    });

    // Decisions panel should be available (collapsed by default)
    await waitFor(() => {
      expect(screen.getByText(/Current Decisions/)).toBeInTheDocument();
    });

    // Expand decisions panel
    await user.click(screen.getByText(/Current Decisions/));

    // Should show the decision entries
    await waitFor(() => {
      expect(screen.getByText(/Revenue Recognition Method/)).toBeInTheDocument();
      expect(screen.getByText(/Churn Data Policy/)).toBeInTheDocument();
    });
  });

  it("completes step on Complete Step click when decisions.md exists", async () => {
    const user = userEvent.setup();
    render(<TestWrapper {...defaultProps} />);

    // Start reasoning
    await user.click(screen.getByText("Start Reasoning"));

    // Agent completes
    act(() => {
      simulateAgentCompletion("agent-1", REVISED_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // Mock decisions file exists (required by VD-403 validation)
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes("decisions.md")) {
        return Promise.resolve(DECISIONS_MD);
      }
      return Promise.reject(new Error("not found"));
    });

    // Click Complete Step (now rendered by TestWrapper, calls ref.completeStep())
    await user.click(screen.getByText("Complete Step"));

    // Should capture artifacts
    expect(mockCaptureStepArtifacts).toHaveBeenCalledWith("saas-revenue", 4, "/workspace");

    // Should advance workflow step
    await waitFor(() => {
      const store = useWorkflowStore.getState();
      expect(store.steps[4].status).toBe("completed");
    });
  });

  it("allows free-form input to send any message at awaiting_feedback phase", async () => {
    const user = userEvent.setup();
    render(<TestWrapper {...defaultProps} />);

    // Start reasoning and get to awaiting_feedback phase
    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1", AGENT_SUMMARY_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // Use the free-form input
    const freeFormInput = screen.getByPlaceholderText(/Provide feedback or request revisions/);
    await user.type(freeFormInput, "Actually, let me reconsider the approach entirely.");
    await user.keyboard("{Enter}");

    // Should send via startAgent with session resume (includes context reminder prefix and agent name)
    expect(mockStartAgent).toHaveBeenCalledWith(
      expect.stringContaining("reasoning-"),
      expect.stringContaining("Actually, let me reconsider the approach entirely."),
      "opus",
      "/workspace",
      expect.any(Array),
      100,
      "session-123",
      "saas-revenue",
      "step4-reasoning",
      "domain-reasoning",
    );
  });

  // --- VD-403: Decisions file validation tests ---

  it("blocks complete step when decisions.md is missing everywhere", async () => {
    const user = userEvent.setup();
    const { toast } = await import("sonner");

    render(<TestWrapper {...defaultProps} />);

    // Start reasoning, agent completes
    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1", REVISED_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // readFile rejects (file not found) — default mock behavior
    // getArtifactContent returns null — default mock behavior

    // Click Complete Step
    await user.click(screen.getByText("Complete Step"));

    // Should show error toast and NOT mark step as completed
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Decisions file was not created"),
      );
    });

    // Step should NOT be completed
    const store = useWorkflowStore.getState();
    expect(store.steps[4].status).not.toBe("completed");

    // Should remain on awaiting_feedback phase (Complete Step still visible)
    expect(screen.getByText("Complete Step")).toBeInTheDocument();
  });

  it("allows complete step when decisions.md found in skills path", async () => {
    const user = userEvent.setup();

    render(<TestWrapper {...defaultProps} />);

    // Start reasoning, agent completes
    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1", REVISED_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // Mock readFile to succeed for skills path
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath === "/skills/saas-revenue/context/decisions.md") {
        return Promise.resolve(DECISIONS_MD);
      }
      return Promise.reject(new Error("not found"));
    });

    // Click Complete Step
    await user.click(screen.getByText("Complete Step"));

    // Step should be completed
    await waitFor(() => {
      const store = useWorkflowStore.getState();
      expect(store.steps[4].status).toBe("completed");
    });
  });

  it("allows complete step when decisions.md found in workspace path", async () => {
    const user = userEvent.setup();

    render(<TestWrapper {...defaultProps} />);

    // Start reasoning, agent completes
    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1", REVISED_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // Mock readFile to fail for skills path but succeed for workspace
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath === "/workspace/saas-revenue/context/decisions.md") {
        return Promise.resolve(DECISIONS_MD);
      }
      return Promise.reject(new Error("not found"));
    });

    // Click Complete Step
    await user.click(screen.getByText("Complete Step"));

    // Step should be completed
    await waitFor(() => {
      const store = useWorkflowStore.getState();
      expect(store.steps[4].status).toBe("completed");
    });
  });

  it("allows complete step when decisions.md found in SQLite artifact", async () => {
    const user = userEvent.setup();

    render(<TestWrapper {...defaultProps} />);

    // Start reasoning, agent completes
    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1", REVISED_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // readFile rejects everywhere, but SQLite has the artifact
    // Override getArtifactContent for the complete-step validation check
    mockGetArtifactContent.mockImplementation((_skill: string, path: string) => {
      if (path === "context/decisions.md") {
        return Promise.resolve({ content: DECISIONS_MD });
      }
      return Promise.resolve(null);
    });

    // Click Complete Step
    await user.click(screen.getByText("Complete Step"));

    // Step should be completed
    await waitFor(() => {
      const store = useWorkflowStore.getState();
      expect(store.steps[4].status).toBe("completed");
    });
  });

  it("blocks complete step when decisions.md exists but is empty", async () => {
    const user = userEvent.setup();
    const { toast } = await import("sonner");

    render(<TestWrapper {...defaultProps} />);

    // Start reasoning, agent completes
    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1", REVISED_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // Mock readFile to return empty content
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes("decisions.md")) {
        return Promise.resolve("   ");
      }
      return Promise.reject(new Error("not found"));
    });

    // Click Complete Step
    await user.click(screen.getByText("Complete Step"));

    // Should show error toast
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Decisions file was not created"),
      );
    });

    // Step should NOT be completed
    const store = useWorkflowStore.getState();
    expect(store.steps[4].status).not.toBe("completed");
  });

  // --- VD-403: Resume turn context tests ---

  it("includes decisions.md context reminder and agent name in resume turn prompts", async () => {
    const user = userEvent.setup();
    render(<TestWrapper {...defaultProps} />);

    // Start reasoning (establishes session)
    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1", AGENT_SUMMARY_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Complete Step")).toBeInTheDocument();
    });

    // Submit feedback via free-form input (triggers a resume turn)
    const freeFormInput = screen.getByPlaceholderText(/Provide feedback or request revisions/);
    await user.type(freeFormInput, "Use periodic recognition");
    await user.keyboard("{Enter}");

    // The startAgent call should include context about decisions.md and agent name
    expect(mockStartAgent).toHaveBeenCalledWith(
      expect.stringContaining("reasoning-"),
      expect.stringContaining("MUST write your decisions to saas-revenue/context/decisions.md"),
      "opus",
      "/workspace",
      expect.any(Array),
      100,
      "session-123",
      "saas-revenue",
      "step4-reasoning",
      "domain-reasoning",
    );
  });
});
