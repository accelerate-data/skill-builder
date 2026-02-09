import { useEffect, useState } from "react";
import {
  Loader2,
  Square,
  Pause,
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useAgentStore,
  formatModelName,
  formatTokenCount,
  getLatestContextTokens,
  getContextUtilization,
} from "@/stores/agent-store";
import { cancelAgent } from "@/lib/tauri";

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
  onPause?: () => void;
  onCancel?: () => void;
}

export function AgentStatusHeader({
  agentId,
  title = "Agent Output",
  onPause,
  onCancel,
}: AgentStatusHeaderProps) {
  const run = useAgentStore((s) => s.runs[agentId]);

  // Force re-render every second while running so elapsed time updates
  const [, setTick] = useState(0);
  useEffect(() => {
    if (run?.status !== "running") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [run?.status]);

  const handleCancel = async () => {
    if (onCancel) {
      onCancel();
      return;
    }
    try {
      await cancelAgent(agentId);
    } catch {
      // Agent may already be finished
    }
  };

  if (!run) return null;

  const elapsed = run.endTime
    ? run.endTime - run.startTime
    : Date.now() - run.startTime;

  const statusIcon = {
    running: <Loader2 className="size-3.5 animate-spin" />,
    completed: <CheckCircle2 className="size-3.5 text-green-500" />,
    error: <XCircle className="size-3.5 text-destructive" />,
    cancelled: <Square className="size-3.5 text-muted-foreground" />,
  }[run.status];

  const statusLabel = {
    running: "Running",
    completed: "Completed",
    error: "Error",
    cancelled: "Cancelled",
  }[run.status];

  const turnCount = run.messages.filter((m) => m.type === "assistant").length;

  return (
    <CardHeader className="shrink-0 flex-row items-center justify-between space-y-0 pb-3">
      <CardTitle className="flex items-center gap-2 text-sm font-medium">
        <Cpu className="size-4" />
        {title}
      </CardTitle>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="gap-1 text-xs">
          {statusIcon}
          {statusLabel}
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
        {run.status === "running" && onPause && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onPause}
          >
            <Pause className="size-3" />
            Pause
          </Button>
        )}
        {run.status === "running" && (
          <Button
            variant="destructive"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleCancel}
          >
            <Square className="size-3" />
            Cancel
          </Button>
        )}
      </div>
    </CardHeader>
  );
}
