import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentTurnInline } from "@/components/refine/agent-turn-inline";
import { useAgentStore } from "@/stores/agent-store";

describe("AgentTurnInline", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
  });

  it("shows cost after a turn completes", () => {
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

    expect(screen.getByText("Cost $0.1234")).toBeInTheDocument();
  });

  it("does not show cost while run is still running", () => {
    useAgentStore.getState().registerRun("refine-agent-2", "sonnet", "my-skill", "refine");
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "refine-agent-2": {
          ...state.runs["refine-agent-2"],
          status: "running",
          totalCost: 0.5678,
        },
      },
    }));

    render(<AgentTurnInline agentId="refine-agent-2" />);

    expect(screen.queryByText("Cost $0.5678")).not.toBeInTheDocument();
  });
});
