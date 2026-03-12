import { type ReactNode, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ToolStatus, SubagentStatus } from "@/lib/display-types";

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
  const isOrphaned = status === "orphaned";

  return (
    <span
      className={`size-1.5 shrink-0 rounded-full ${isPulsing ? "animate-pulse" : ""}`}
      style={{
        backgroundColor: color,
        opacity: isOrphaned ? 0.5 : 1,
      }}
      aria-label={`Status: ${status}`}
    />
  );
}

interface BaseItemProps {
  icon: ReactNode;
  label: string;
  summary?: string;
  tokenCount?: number;
  status?: StatusType;
  durationMs?: number;
  borderColor: string;
  headerBg?: string;
  defaultExpanded?: boolean;
  labelMono?: boolean;
  children?: ReactNode;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function BaseItem({
  icon,
  label,
  summary,
  tokenCount,
  status,
  durationMs,
  borderColor,
  headerBg,
  defaultExpanded = false,
  labelMono = false,
  children,
}: BaseItemProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasContent = children !== undefined && children !== null;

  const header = (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors duration-150 hover:bg-muted/50"
      style={headerBg ? { backgroundColor: headerBg } : undefined}
    >
      <span className="shrink-0" style={{ color: borderColor }}>
        {icon}
      </span>
      <span className={`text-xs font-semibold shrink-0 ${labelMono ? "font-mono" : ""}`}>
        {label}
      </span>
      {summary && (
        <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
          {summary.length > 60 ? summary.slice(0, 60) + "..." : summary}
        </span>
      )}
      {!summary && <span className="flex-1" />}
      {tokenCount !== undefined && tokenCount > 0 && (
        <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-4 shrink-0">
          {tokenCount >= 1000 ? `${Math.round(tokenCount / 1000)}K` : tokenCount}
        </Badge>
      )}
      {durationMs !== undefined && durationMs > 0 && (
        <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
          {formatDuration(durationMs)}
        </span>
      )}
      <StatusDot status={status} />
      {hasContent && (
        expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150" aria-hidden="true" />
        )
      )}
    </div>
  );

  if (!hasContent) {
    return <div data-testid="base-item" className="min-w-0 w-full">{header}</div>;
  }

  return (
    <div data-testid="base-item" className="min-w-0 w-full">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${label}${summary ? ` — ${summary}` : ""} — ${expanded ? "collapse" : "expand"}`}
        className="flex w-full cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-md"
      >
        {header}
      </button>
      <div
        className={`overflow-hidden transition-all duration-150 ease-out ${
          expanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div
          className="ml-[7px] min-w-0 overflow-x-hidden pl-3 pr-2 pt-1 pb-1"
          style={{ borderLeft: `3px solid ${borderColor}` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
