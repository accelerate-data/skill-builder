import { memo, useMemo, useRef, useState } from "react";
import { Wrench, ChevronRight, ChevronDown } from "lucide-react";
import type { DisplayItem, ToolStatus, SubagentStatus } from "@/lib/display-types";
import { summarizeToolActivity } from "@/lib/group-display-items";
import { ThinkingItem } from "./thinking-item";
import { ToolItem } from "./tool-item";

type StatusType = ToolStatus | SubagentStatus | undefined;

function StatusDot({ status }: { status: StatusType }) {
  if (!status) return null;

  const colorMap: Record<string, string> = {
    ok: "var(--color-seafoam)",
    complete: "var(--color-seafoam)",
    pending: "var(--color-pacific)",
    running: "var(--color-pacific)",
    error: "var(--destructive)",
    orphaned: "var(--muted-foreground)",
  };

  const color = colorMap[status] ?? "var(--muted-foreground)";
  const isPulsing = status === "pending" || status === "running";

  return (
    <span
      className={`size-1.5 shrink-0 rounded-full ${isPulsing ? "animate-pulse" : ""}`}
      style={{ backgroundColor: color, opacity: 1 }}
      aria-label={`Status: ${status}`}
    />
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface ToolActivityGroupProps {
  items: DisplayItem[];
}

export const ToolActivityGroupView = memo(function ToolActivityGroupView({
  items,
}: ToolActivityGroupProps) {
  const hasError = items.some((item) => item.toolStatus === "error");
  const [expanded, setExpanded] = useState(hasError);
  const hasBeenExpanded = useRef(false);

  const summary = useMemo(() => summarizeToolActivity(items), [items]);
  const label =
    summary.totalTools > 0
      ? `${summary.totalTools} tool${summary.totalTools === 1 ? "" : "s"} (${summary.breakdown})`
      : summary.breakdown;

  return (
    <div data-testid="tool-activity-group" className="min-w-0 w-full">
      <button
        type="button"
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          if (next) hasBeenExpanded.current = true;
        }}
        aria-expanded={expanded}
        aria-label={`Tool Activity — ${label} — ${expanded ? "collapse" : "expand"}`}
        className="flex w-full cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-md"
      >
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors duration-150 hover:bg-muted/50"
          style={{ backgroundColor: "var(--chat-tool-bg)" }}
        >
          <span className="shrink-0" style={{ color: "var(--chat-tool-border)" }}>
            <Wrench className="size-3.5" />
          </span>
          <span className="text-xs font-semibold shrink-0">Tool Activity</span>
          <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
            {label}
          </span>
          {summary.totalDurationMs > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
              {formatDuration(summary.totalDurationMs)}
            </span>
          )}
          <StatusDot status={summary.aggregateStatus} />
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150" aria-hidden="true" />
          )}
        </div>
      </button>
      <div
        className={`overflow-hidden transition-all duration-150 ease-out ${
          expanded ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        {hasBeenExpanded.current && (
          <div
            className="ml-[7px] min-w-0 overflow-x-hidden pl-4 pr-2 pt-1 pb-1 flex flex-col gap-0.5"
            style={{ borderLeft: "3px solid var(--chat-tool-border)" }}
          >
            {items.map((item) => (
              <div key={item.id} className="min-w-0 w-full">
                {item.type === "thinking" ? (
                  <ThinkingItem item={item} />
                ) : (
                  <ToolItem item={item} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
