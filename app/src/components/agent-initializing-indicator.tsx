import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useWorkflowStore } from "@/stores/workflow-store";

/** Format milliseconds as a human-readable elapsed string (e.g. "5s", "1m 23s"). */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export function AgentInitializingIndicator() {
  const initStartTime = useWorkflowStore((s) => s.initStartTime);
  const initProgressMessage = useWorkflowStore((s) => s.initProgressMessage);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (initStartTime === null) {
      setElapsed(0);
      return;
    }

    // Set initial elapsed immediately
    setElapsed(Date.now() - initStartTime);

    const id = setInterval(() => {
      setElapsed(Date.now() - initStartTime);
    }, 1000);

    return () => clearInterval(id);
  }, [initStartTime]);

  const displayMessage = initProgressMessage ?? "Initializing agent...";

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"
      data-testid="agent-initializing-indicator"
    >
      <Loader2 className="size-8 animate-spin" />
      <p className="text-sm font-medium" data-testid="init-progress-message">
        {displayMessage}
      </p>
      {elapsed > 0 && (
        <p className="text-xs tabular-nums" data-testid="elapsed-time">
          {formatElapsed(elapsed)}
        </p>
      )}
    </div>
  );
}
