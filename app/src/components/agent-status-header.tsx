import { useEffect, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
  Brain,
} from "lucide-react";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useAgentStore,
  formatModelName,
  formatTokenCount,
  getLatestContextTokens,
  getContextUtilization,
} from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";

export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function ContextMeter({ agentId }: { agentId: string }) {
  const run = useAgentStore((s) => s.runs[agentId]);
  if (!run || run.contextHistory.length === 0) return null;

  const tokens = getLatestContextTokens(run);
  const utilization = getContextUtilization(run);
  const color =
    utilization >= 80
      ? "bg-red-500"
      : utilization >= 50
        ? "bg-yellow-500"
        : "bg-green-500";

  return (
    <div className="flex items-center gap-1.5" title={`Context: ${tokens.toLocaleString()} / ${run.contextWindow.toLocaleString()} tokens`}>
      <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${color}`}
          style={{ width: `${Math.max(1, utilization)}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {formatTokenCount(tokens)} / {formatTokenCount(run.contextWindow)}
      </span>
    </div>
  );
}

interface AgentStatusHeaderProps {
  agentId: string;
  title?: string;
}

/** Determine the display status for the agent header.
 *  - "initializing": run exists, status is "running", but no messages yet
 *                     (or workflow store's isInitializing flag is true)
 *  - "running" / "completed" / "error": pass through from run status
 */
export type DisplayStatus = "initializing" | "running" | "completed" | "error";

export function getDisplayStatus(
  runStatus: "running" | "completed" | "error",
  messageCount: number,
  workflowIsInitializing?: boolean,
): DisplayStatus {
  if (runStatus !== "running") return runStatus;
  // If workflow store says we're initializing, trust that
  if (workflowIsInitializing) return "initializing";
  // If running but no messages have arrived yet, we're still initializing
  if (messageCount === 0) return "initializing";
  return "running";
}

export function AgentStatusHeader({
  agentId,
  title = "Agent Output",
}: AgentStatusHeaderProps) {
  const run = useAgentStore((s) => s.runs[agentId]);

  // Read initializing state from workflow store
  const workflowIsInitializing = useWorkflowStore((s) => s.isInitializing);
  const workflowInitStartTime = useWorkflowStore((s) => s.initStartTime);

  const displayStatus = run
    ? getDisplayStatus(run.status, run.messages.length, workflowIsInitializing)
    : null;

  // Force re-render every second while running or initializing so elapsed time updates
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!displayStatus || displayStatus === "completed" || displayStatus === "error") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [displayStatus]);

  if (!run) return null;

  // For elapsed time: during initialization, prefer initStartTime from workflow store
  // (tracks when the step was kicked off, before the run object even exists).
  // Fall back to the run's startTime.
  const elapsedOrigin = displayStatus === "initializing" && workflowInitStartTime
    ? workflowInitStartTime
    : run.startTime;

  const elapsed = run.endTime
    ? run.endTime - elapsedOrigin
    : Date.now() - elapsedOrigin;

  const statusIcon: Record<DisplayStatus, React.ReactNode> = {
    initializing: <Loader2 className="size-3.5 animate-spin text-yellow-500" />,
    running: <Loader2 className="size-3.5 animate-spin" />,
    completed: <CheckCircle2 className="size-3.5 text-green-500" />,
    error: <XCircle className="size-3.5 text-destructive" />,
  };

  const statusLabel: Record<DisplayStatus, string> = {
    initializing: "Initializing\u2026",
    running: "Running",
    completed: "Completed",
    error: "Error",
  };

  const currentStatus = displayStatus ?? "running";
  const turnCount = run.messages.filter((m) => m.type === "assistant").length;

  return (
    <CardHeader className="shrink-0 flex-row items-center justify-between space-y-0 pb-3">
      <CardTitle className="flex items-center gap-2 text-sm font-medium">
        <Cpu className="size-4" />
        {title}
      </CardTitle>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="gap-1 text-xs transition-colors">
          {statusIcon[currentStatus]}
          {statusLabel[currentStatus]}
        </Badge>
        <Badge variant="secondary" className="text-xs">
          {formatModelName(run.model)}
        </Badge>
        <Badge variant="secondary" className="gap-1 text-xs">
          <Clock className="size-3" />
          {formatElapsed(elapsed)}
        </Badge>
        {turnCount > 0 && (
          <Badge variant="secondary" className="text-xs">
            Turn {turnCount}
          </Badge>
        )}
        {run.thinkingEnabled && (
          <Badge variant="secondary" className="gap-1 text-xs">
            <Brain className="size-3" />
            Thinking
          </Badge>
        )}
        {run.tokenUsage && (
          <Badge variant="secondary" className="text-xs">
            {(run.tokenUsage.input + run.tokenUsage.output).toLocaleString()} tokens
          </Badge>
        )}
        {run.totalCost !== undefined && (
          <Badge variant="secondary" className="text-xs">
            ${run.totalCost.toFixed(4)}
          </Badge>
        )}
        <ContextMeter agentId={agentId} />
      </div>
    </CardHeader>
  );
}
