import { useEffect, useState } from "react";
import {
  useAgentStore,
  formatModelName,
  formatTokenCount,
} from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { formatElapsed } from "@/lib/utils";
import {
  type DisplayStatus,
  getDisplayStatus,
} from "@/components/agent-status-header";

interface AgentRunFooterProps {
  agentId: string;
}

const statusDot: Record<DisplayStatus, { className: string; style?: React.CSSProperties }> = {
  initializing: { className: "animate-pulse", style: { background: "var(--color-pacific)" } },
  running: { className: "animate-pulse", style: { background: "var(--color-pacific)" } },
  completed: { className: "", style: { background: "var(--color-seafoam)" } },
  error: { className: "bg-destructive" },
};

const statusLabels: Record<DisplayStatus, string> = {
  initializing: "initializing\u2026",
  running: "running\u2026",
  completed: "completed",
  error: "error",
};

function Dot() {
  return <span className="text-muted-foreground/20">&middot;</span>;
}

export function AgentRunFooter({ agentId }: AgentRunFooterProps) {
  const run = useAgentStore((s) => s.runs[agentId]);
  const workflowIsInitializing = useWorkflowStore((s) => s.isInitializing);
  const workflowInitStartTime = useWorkflowStore((s) => s.initStartTime);

  const displayStatus: DisplayStatus | null = run
    ? getDisplayStatus(run.status, run.displayItems.length, workflowIsInitializing)
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

  const dot = statusDot[displayStatus];
  const isFinished = displayStatus === "completed" || displayStatus === "error";
  const turnCount = run.contextHistory.length;

  return (
    <div
      className="flex h-6 shrink-0 items-center gap-2.5 border-t border-border bg-background/80 px-4"
      data-testid="agent-run-footer"
    >
      {/* Status dot + label */}
      <div className="flex items-center gap-1.5">
        <div
          className={`size-[5px] rounded-full ${dot.className}`}
          style={dot.style}
        />
        <span className="text-xs text-muted-foreground/60">{statusLabels[displayStatus]}</span>
      </div>

      {/* Agent name */}
      {run.agentName && (
        <>
          <Dot />
          <span className="text-xs text-muted-foreground/60">{run.agentName}</span>
        </>
      )}

      {/* Model */}
      {run.model && run.model !== "unknown" && (
        <>
          <Dot />
          <span className="text-xs text-muted-foreground/60">
            {formatModelName(run.model)}
          </span>
        </>
      )}

      {/* Elapsed time */}
      <>
        <Dot />
        <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
          {formatElapsed(elapsed)}
        </span>
      </>

      {/* Turn count */}
      {turnCount > 0 && (
        <>
          <Dot />
          <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
            {turnCount} {turnCount === 1 ? "turn" : "turns"}
          </span>
        </>
      )}

      {/* Token count -- only after completion */}
      {run.tokenUsage && isFinished && (
        <>
          <Dot />
          <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
            {formatTokenCount(run.tokenUsage.input + run.tokenUsage.output)} tokens
          </span>
        </>
      )}

      {/* Cost -- only after completion */}
      {run.totalCost !== undefined && isFinished && (
        <>
          <Dot />
          <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
            ${run.totalCost.toFixed(4)}
          </span>
        </>
      )}
    </div>
  );
}
