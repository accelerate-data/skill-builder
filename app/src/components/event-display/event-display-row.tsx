import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface EventDisplayRowProps {
  bg: string;
  labelColor: string;
  label: string;
  summary: string;
  icon?: ReactNode;
  italic?: boolean;
  tokenCount?: number;
  durationMs?: number;
  status?: "running" | "done" | "error";
  defaultExpanded?: boolean;
  children?: ReactNode;
}

export function EventDisplayRow({
  bg,
  labelColor,
  label,
  summary,
  icon,
  italic,
  tokenCount,
  durationMs,
  status,
  defaultExpanded = true,
  children,
}: EventDisplayRowProps) {
  const expandable =
    children !== undefined && children !== null && children !== false && children !== true;
  const [expanded, setExpanded] = useState(expandable ? defaultExpanded : false);

  return (
    <div className="rounded-md overflow-hidden text-xs">
      <div
        data-testid="row-header"
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 select-none",
          expandable && "cursor-pointer hover:brightness-95",
        )}
        style={{ background: bg }}
        onClick={expandable ? () => setExpanded((e) => !e) : undefined}
      >
        {icon && (
          <span
            data-testid="row-icon"
            className="shrink-0 flex items-center"
            style={{ color: labelColor }}
          >
            {icon}
          </span>
        )}

        <span
          className="font-semibold uppercase tracking-wide shrink-0"
          style={{ color: labelColor, fontSize: "11px" }}
        >
          {label}
        </span>

        <span
          data-testid="row-summary"
          className={cn(
            "min-w-0 flex-1 truncate text-muted-foreground",
            italic && "italic",
          )}
          style={{ fontSize: "11px" }}
        >
          {summary}
        </span>

        {tokenCount !== undefined && tokenCount > 0 && (
          <span
            className="shrink-0 font-mono text-muted-foreground"
            style={{ fontSize: "10px" }}
          >
            {tokenCount} tok
          </span>
        )}

        {durationMs !== undefined && durationMs > 0 && (
          <span
            data-testid="row-duration"
            className="shrink-0 font-mono text-muted-foreground"
            style={{ fontSize: "10px" }}
          >
            {formatDuration(durationMs)}
          </span>
        )}

        {status && (
          <span
            data-testid="status-dot"
            className={cn(
              "shrink-0 h-1.5 w-1.5 rounded-full",
              status === "done" && "bg-[var(--color-seafoam,theme(colors.emerald.400))]",
              status === "running" && "bg-[var(--color-pacific,theme(colors.sky.400))] animate-pulse",
              status === "error" && "bg-destructive",
            )}
          />
        )}

        {expandable && (
          <ChevronDown
            data-testid="row-chevron"
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform duration-150",
              !expanded && "-rotate-90",
            )}
          />
        )}
      </div>

      {expandable && expanded && (
        <div style={{ background: bg }} className="border-t border-border">
          {children}
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}
