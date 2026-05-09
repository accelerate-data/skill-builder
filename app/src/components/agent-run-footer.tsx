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
import { RunStatusFooter, type FooterDisplayStatus } from "@/components/run-status-footer";

interface AgentRunFooterProps {
  agentId: string;
}

export function AgentRunFooter({ agentId }: AgentRunFooterProps) {
  const run = useAgentStore((s) => s.runs[agentId]);
  const workflowIsInitializing = useWorkflowStore((s) => s.isInitializing);
  const workflowIsStopping = useWorkflowStore((s) => s.isStopping);
  const workflowInitStartTime = useWorkflowStore((s) => s.initStartTime);

  const displayStatus: DisplayStatus | null = run
    ? getDisplayStatus(run.status, getAgentActivityCount(run), workflowIsInitializing)
    : null;

  // Map stopping state to footer status
  const footerStatus: FooterDisplayStatus = workflowIsStopping
    ? "stopping"
    : displayStatus === "initializing"
      ? "initializing"
      : displayStatus === "error"
        ? "error"
        : displayStatus === "completed"
          ? "completed"
          : run?.status === "running"
            ? "running"
            : "idle";

  // Force re-render every second while running or initializing so elapsed time updates
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!footerStatus || footerStatus === "completed" || footerStatus === "error") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [footerStatus]);

  if (!run || !footerStatus) return null;

  // Elapsed time origin: during initialization, prefer initStartTime from workflow store
  const elapsedOrigin =
    footerStatus === "initializing" && workflowInitStartTime
      ? workflowInitStartTime
      : run.startTime;

  const elapsed = run.endTime ? run.endTime - elapsedOrigin : Date.now() - elapsedOrigin;

  const isFinished = footerStatus === "completed" || footerStatus === "error";
  const turnCount = run.contextHistory.length;

  return (
    <RunStatusFooter
      status={footerStatus}
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
