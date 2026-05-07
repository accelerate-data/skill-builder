import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentTurnInline } from "@/components/refine/agent-turn-inline";
import { useAgentStore } from "@/stores/agent-store";

describe("AgentTurnInline", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
  });

  it("does not render inline cost after a turn completes", () => {
    useAgentStore.getState().registerRun("refine-agent-1", "sonnet", "my-skill", "refine");
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "refine-agent-1": {
          ...state.runs["refine-agent-1"],
          status: "completed",
          totalCost: 0.1234,
        },
      },
    }));

    render(<AgentTurnInline agentId="refine-agent-1" />);

    expect(screen.queryByText(/Cost/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0\.1234/)).not.toBeInTheDocument();
  });

  it("shows thinking indicator while running with no output", () => {
    useAgentStore.getState().registerRun("refine-agent-2", "sonnet", "my-skill", "refine");
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "refine-agent-2": {
          ...state.runs["refine-agent-2"],
          status: "running",
          displayItems: [],
        },
      },
    }));

    render(<AgentTurnInline agentId="refine-agent-2" />);

    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("renders runtime setup and task sent as separate rows for a fresh refine turn", async () => {
    const user = userEvent.setup();
    useAgentStore.getState().registerRun("refine-agent-3", "sonnet", "my-skill", "refine");
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "refine-agent-3": {
          ...state.runs["refine-agent-3"],
          status: "running",
          displayItems: [
            {
              id: "setup-1",
              type: "tool_call",
              timestamp: 1,
              toolName: "system_prompt",
              toolSummary: "Runtime setup",
              toolStatus: "ok",
              toolResult: { content: "You are the skill creator.", isError: false },
            },
            {
              id: "task-1",
              type: "tool_call",
              timestamp: 2,
              toolName: "task_sent",
              toolSummary: "Task sent",
              toolStatus: "ok",
              toolResult: {
                content: "Current request: tighten the intro",
                isError: false,
              },
            },
          ],
        },
      },
    }));

    render(<AgentTurnInline agentId="refine-agent-3" />);

    await user.click(
      screen.getByRole("button", { name: /Tool Activity/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /task_sent — Task sent/i }),
    );

    expect(screen.getByText("Runtime setup")).toBeInTheDocument();
    expect(screen.getByText("Task sent")).toBeInTheDocument();
    expect(screen.getByText("Current request: tighten the intro")).toBeInTheDocument();
  });
});
