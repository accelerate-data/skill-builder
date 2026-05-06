import { useEffect, useState } from "react";
import {
  useAgentStore,
  formatModelName,
  formatTokenCount,
} from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  type DisplayStatus,
  getAgentActivityCount,
  getDisplayStatus,
} from "@/components/agent-status-header";
import { RunStatusFooter } from "@/components/run-status-footer";

interface AgentRunFooterProps {
  agentId: string;
}

export function AgentRunFooter({ agentId }: AgentRunFooterProps) {
  const run = useAgentStore((s) => s.runs[agentId]);
  const workflowIsInitializing = useWorkflowStore((s) => s.isInitializing);
  const workflowInitStartTime = useWorkflowStore((s) => s.initStartTime);

  const displayStatus: DisplayStatus | null = run
    ? getDisplayStatus(run.status, getAgentActivityCount(run), workflowIsInitializing)
    : null;

  // Force re-render every second while running or initializing so elapsed time updates
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!displayStatus || displayStatus === "completed" || displayStatus === "error") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [displayStatus]);

  if (!run || !displayStatus) return null;

  // Elapsed time origin: during initialization, prefer initStartTime from workflow store
  const elapsedOrigin =
    displayStatus === "initializing" && workflowInitStartTime
      ? workflowInitStartTime
      : run.startTime;

  const elapsed = run.endTime ? run.endTime - elapsedOrigin : Date.now() - elapsedOrigin;

  const isFinished = displayStatus === "completed" || displayStatus === "error";
  const turnCount = run.contextHistory.length;

  return (
    <RunStatusFooter
      status={displayStatus}
      label={run.agentName ?? null}
      model={run.model && run.model !== "unknown" ? formatModelName(run.model) : null}
      elapsedMs={elapsed}
      turns={turnCount}
      tokenCount={
        run.tokenUsage && isFinished
          ? formatTokenCount(run.tokenUsage.input + run.tokenUsage.output)
          : null
      }
      cost={run.totalCost !== undefined && isFinished ? `$${run.totalCost.toFixed(4)}` : null}
      testId="agent-run-footer"
    />
  );
}
