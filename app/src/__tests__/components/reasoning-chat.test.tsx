import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { ReactNode } from "react";

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
} = vi.hoisted(() => ({
  mockRunWorkflowStep: vi.fn(() => Promise.resolve("agent-1")),
  mockStartAgent: vi.fn(() => Promise.resolve("agent-2")),
  mockCaptureStepArtifacts: vi.fn(() => Promise.resolve()),
  mockGetArtifactContent: vi.fn(() => Promise.resolve(null)),
  mockSaveArtifactContent: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/tauri", () => ({
  runWorkflowStep: mockRunWorkflowStep,
  startAgent: mockStartAgent,
  captureStepArtifacts: mockCaptureStepArtifacts,
  getArtifactContent: mockGetArtifactContent,
  saveArtifactContent: mockSaveArtifactContent,
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

import { ReasoningChat } from "@/components/reasoning-chat";

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

const CONFLICT_RESPONSE = `## What I concluded

Based on your answers, I've identified the key design implications for the SaaS Revenue Analytics skill.

## Assumptions I'm making

1. You want both monthly and annual recurring revenue tracked separately
2. Revenue recognition follows ASC 606 standards

## Conflicts or tensions

There is a significant conflict in your responses:
- In Q3, you stated that revenue should be recognized at the point of sale
- In Q7, you stated that revenue should be recognized over the contract period
- These are contradictory approaches — point-of-sale recognition is incompatible with periodic recognition for subscription models

Additionally:
- Q5 says "ignore churned customers" but Q9 asks for "churn impact analysis" — you cannot analyze churn impact if churned customers are excluded

## Follow-up Questions — Round 1

### Q1: Revenue Recognition Timing
**Question**: Given the conflict between point-of-sale and periodic recognition, which approach should the skill use for subscription revenue?

**Choices**:
- A) Recognize full contract value at signing (point-of-sale)
- B) Recognize revenue monthly over the contract period (periodic)
- C) Support both methods with a configuration option

**Recommendation**: B — periodic recognition is standard for SaaS

### Q2: Churn Data Inclusion
**Question**: You mentioned ignoring churned customers but also want churn impact analysis. Should the skill include churned customer data?

**Choices**:
- A) Include churned customers in all analyses
- B) Exclude churned customers but track churn metrics separately

**Recommendation**: A — churn analysis requires the underlying data`;

const FOLLOW_UP_ANSWERS_RESPONSE = `## What I concluded

Thank you for the clarifications. The conflicts are now resolved:
- Revenue will be recognized monthly over the contract period (periodic recognition)
- Churned customers will be included in all analyses for complete churn impact tracking

## Assumptions I'm making

1. Periodic recognition applies to all subscription tiers equally
2. Churn metrics include both voluntary and involuntary churn

I've updated decisions.md with the resolved conflicts. All clarifications are resolved and decisions are logged. Ready to proceed to skill creation?`;

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

describe("ReasoningChat — conflict detection and resolution flow", () => {
  const defaultProps = {
    skillName: "saas-revenue",
    domain: "SaaS Revenue Analytics",
    workspacePath: "/workspace",
  };

  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    useWorkflowStore.getState().reset();
    useWorkflowStore.getState().initWorkflow("saas-revenue", "SaaS Revenue Analytics");
    useWorkflowStore.getState().setCurrentStep(4); // Reasoning step

    mockRunWorkflowStep.mockReset().mockResolvedValue("agent-1");
    mockStartAgent.mockReset().mockResolvedValue("agent-2");
    mockCaptureStepArtifacts.mockReset().mockResolvedValue(undefined);
    mockGetArtifactContent.mockReset().mockResolvedValue(null);
    mockSaveArtifactContent.mockReset().mockResolvedValue(undefined);
  });

  it("shows start button initially", () => {
    render(<ReasoningChat {...defaultProps} />);
    expect(screen.getByText("Start Reasoning")).toBeInTheDocument();
  });

  it("starts agent via runWorkflowStep on start click", async () => {
    const user = userEvent.setup();
    render(<ReasoningChat {...defaultProps} />);

    await user.click(screen.getByText("Start Reasoning"));

    expect(mockRunWorkflowStep).toHaveBeenCalledWith(
      "saas-revenue", 4, "SaaS Revenue Analytics", "/workspace"
    );
    // Agent run registered in store
    expect(useAgentStore.getState().runs["agent-1"]).toBeDefined();
  });

  it("detects conflicts and shows follow-up panel when agent finds contradictions", async () => {
    const user = userEvent.setup();
    render(<ReasoningChat {...defaultProps} />);

    // Start reasoning
    await user.click(screen.getByText("Start Reasoning"));

    // Simulate agent completion with conflict response
    act(() => {
      simulateAgentCompletion("agent-1", CONFLICT_RESPONSE);
    });

    // Should show the conflict analysis in chat
    await waitFor(() => {
      expect(screen.getByText(/significant conflict in your responses/)).toBeInTheDocument();
    });

    // Should detect follow-up questions and show the follow-up action panel with Submit button
    await waitFor(() => {
      expect(screen.getByText("Submit Answers")).toBeInTheDocument();
    });
  });

  it("pre-fills follow-up textarea with extracted questions", async () => {
    const user = userEvent.setup();
    render(<ReasoningChat {...defaultProps} />);

    await user.click(screen.getByText("Start Reasoning"));

    act(() => {
      simulateAgentCompletion("agent-1", CONFLICT_RESPONSE);
    });

    // The textarea should be pre-filled with the extracted follow-up section
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Add your answers/);
      expect(textarea).toBeInTheDocument();
      expect((textarea as HTMLTextAreaElement).value).toContain("Revenue Recognition Timing");
      expect((textarea as HTMLTextAreaElement).value).toContain("Churn Data Inclusion");
    });
  });

  it("submits follow-up answers and resumes agent with session", async () => {
    const user = userEvent.setup();
    render(<ReasoningChat {...defaultProps} />);

    // Start reasoning
    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1", CONFLICT_RESPONSE);
    });

    // Wait for follow-up panel
    await waitFor(() => {
      expect(screen.getByText("Submit Answers")).toBeInTheDocument();
    });

    // Edit the follow-up text with answers
    const textarea = screen.getByPlaceholderText(/Add your answers/);
    await user.clear(textarea);
    await user.type(textarea, "Q1: Use periodic recognition. Q2: Include churned customers.");

    // Submit
    await user.click(screen.getByText("Submit Answers"));

    // Should resume agent via startAgent with session ID
    expect(mockStartAgent).toHaveBeenCalledWith(
      expect.stringContaining("reasoning-"),
      expect.stringContaining("Here are my answers"),
      "opus",
      "/workspace",
      ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"],
      100,
      "session-123",
      "saas-revenue",
      "step4-reasoning",
    );
  });

  it("shows gate check after conflicts resolved and decisions updated", async () => {
    const user = userEvent.setup();

    // Mock getArtifactContent to return decisions after second turn
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockGetArtifactContent as any).mockImplementation((_skill: string, path: string) => {
      if (path === "context/decisions.md") {
        return Promise.resolve({ content: DECISIONS_MD });
      }
      return Promise.resolve(null);
    });

    render(<ReasoningChat {...defaultProps} />);

    // Start reasoning
    await user.click(screen.getByText("Start Reasoning"));

    // Turn 1: Agent finds conflicts → follow-up
    act(() => {
      simulateAgentCompletion("agent-1", CONFLICT_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Submit Answers")).toBeInTheDocument();
    });

    // User answers follow-ups
    const textarea = screen.getByPlaceholderText(/Add your answers/);
    await user.clear(textarea);
    await user.type(textarea, "B for both");
    await user.click(screen.getByText("Submit Answers"));

    // Turn 2: Agent resolves conflicts → gate check
    act(() => {
      useAgentStore.getState().startRun("agent-2", "opus");
      simulateAgentCompletion("agent-2", FOLLOW_UP_ANSWERS_RESPONSE);
    });

    // Should show gate check panel with Proceed button
    await waitFor(() => {
      expect(screen.getByText("Proceed to Build")).toBeInTheDocument();
    });

    // Should show the resolved conclusions in chat
    expect(screen.getByText(/conflicts are now resolved/)).toBeInTheDocument();
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

    render(<ReasoningChat {...defaultProps} />);

    // Start and complete first turn
    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1", CONFLICT_RESPONSE);
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

  it("proceeds to build step on gate check confirmation", async () => {
    const user = userEvent.setup();
    render(<ReasoningChat {...defaultProps} />);

    // Start reasoning
    await user.click(screen.getByText("Start Reasoning"));

    // Agent immediately reaches gate check (no conflicts)
    act(() => {
      simulateAgentCompletion("agent-1", FOLLOW_UP_ANSWERS_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Proceed to Build")).toBeInTheDocument();
    });

    // Click proceed
    await user.click(screen.getByText("Proceed to Build"));

    // Should capture artifacts
    expect(mockCaptureStepArtifacts).toHaveBeenCalledWith("saas-revenue", 4, "/workspace");

    // Should advance workflow step
    const store = useWorkflowStore.getState();
    expect(store.steps[4].status).toBe("completed");
  });

  it("allows free-form input as escape hatch at any phase", async () => {
    const user = userEvent.setup();
    render(<ReasoningChat {...defaultProps} />);

    // Start reasoning and get to follow-up phase
    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1", CONFLICT_RESPONSE);
    });

    await waitFor(() => {
      expect(screen.getByText("Submit Answers")).toBeInTheDocument();
    });

    // Instead of using the follow-up form, use the free-form input
    const freeFormInput = screen.getByPlaceholderText(/Type a message/);
    await user.type(freeFormInput, "Actually, let me reconsider — use point-of-sale recognition instead.");
    await user.keyboard("{Enter}");

    // Should send via startAgent with session resume
    expect(mockStartAgent).toHaveBeenCalledWith(
      expect.stringContaining("reasoning-"),
      "Actually, let me reconsider — use point-of-sale recognition instead.",
      "opus",
      "/workspace",
      expect.any(Array),
      100,
      "session-123",
      "saas-revenue",
      "step4-reasoning",
    );
  });

  it("shows summary panel and allows confirm or correct", async () => {
    const user = userEvent.setup();
    render(<ReasoningChat {...defaultProps} />);

    // Agent responds with summary (no follow-ups, no gate check)
    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1",
        "## What I concluded\nKey findings from analysis.\n## Assumptions I'm making\nSome assumptions.");
    });

    // Should show summary action panel
    await waitFor(() => {
      expect(screen.getByText("Confirm Reasoning")).toBeInTheDocument();
      expect(screen.getByText("Add Corrections")).toBeInTheDocument();
    });

    // Click confirm → sends confirmation message
    await user.click(screen.getByText("Confirm Reasoning"));

    expect(mockStartAgent).toHaveBeenCalledWith(
      expect.stringContaining("reasoning-"),
      expect.stringContaining("Confirmed"),
      "opus",
      "/workspace",
      expect.any(Array),
      100,
      "session-123",
      "saas-revenue",
      "step4-reasoning",
    );
  });

  it("handles corrections flow — user provides corrections to reasoning", async () => {
    const user = userEvent.setup();
    render(<ReasoningChat {...defaultProps} />);

    await user.click(screen.getByText("Start Reasoning"));
    act(() => {
      simulateAgentCompletion("agent-1",
        "## What I concluded\nKey findings.\n## Assumptions I'm making\nAssumptions here.");
    });

    await waitFor(() => {
      expect(screen.getByText("Add Corrections")).toBeInTheDocument();
    });

    // Click Add Corrections to show the corrections textarea
    await user.click(screen.getByText("Add Corrections"));

    // Type correction
    const correctionTextarea = screen.getByPlaceholderText(/Describe your corrections/);
    await user.type(correctionTextarea, "Revenue should NOT include one-time setup fees");

    // Submit corrections
    await user.click(screen.getByText("Send Corrections"));

    expect(mockStartAgent).toHaveBeenCalledWith(
      expect.stringContaining("reasoning-"),
      expect.stringContaining("Revenue should NOT include one-time setup fees"),
      "opus",
      "/workspace",
      expect.any(Array),
      100,
      "session-123",
      "saas-revenue",
      "step4-reasoning",
    );
  });
});
