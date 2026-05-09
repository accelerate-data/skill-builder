import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentRunFooter } from "@/components/agent-run-footer";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";

beforeEach(() => {
  useAgentStore.getState().clearRuns();
  useWorkflowStore.getState().reset();
});

describe("AgentRunFooter", () => {
  it("shows 'stopping…' when workflow isStopping is true", () => {
    useAgentStore.getState().registerRun("wf-agent-1", "test-model", "my-skill", "workflow", "parent-1");
    useWorkflowStore.getState().setRunning(true);
    useWorkflowStore.getState().setStopping(true);

    render(<AgentRunFooter agentId="wf-agent-1" />);

    const footer = screen.getByTestId("agent-run-footer");
    expect(footer).toHaveTextContent("stopping…");
  });

  it("shows 'running…' when workflow isRunning but not isStopping", () => {
    useAgentStore.getState().registerRun("wf-agent-2", "test-model", "my-skill", "workflow", "parent-1");
    useWorkflowStore.getState().setRunning(true);
    useWorkflowStore.getState().setStopping(false);

    render(<AgentRunFooter agentId="wf-agent-2" />);

    const footer = screen.getByTestId("agent-run-footer");
    expect(footer).toHaveTextContent("running…");
  });

  it("shows 'idle' when workflow is not running", () => {
    useAgentStore.getState().registerRun("wf-agent-3", "test-model", "my-skill", "workflow", "parent-1");
    useWorkflowStore.getState().setRunning(false);

    render(<AgentRunFooter agentId="wf-agent-3" />);

    const footer = screen.getByTestId("agent-run-footer");
    expect(footer).toHaveTextContent("ready");
  });
});
