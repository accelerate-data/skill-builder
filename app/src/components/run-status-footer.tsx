import { formatElapsed } from "@/lib/utils";

export type FooterDisplayStatus =
  | "idle"
  | "initializing"
  | "running"
  | "stopping"
  | "completed"
  | "error";

type RunStatusFooterProps = {
  status: FooterDisplayStatus;
  label?: string | null;
  model?: string | null;
  elapsedMs?: number | null;
  turns?: number | null;
  tokenCount?: string | null;
  cost?: string | null;
  errorText?: string | null;
  testId?: string;
  className?: string;
};

const statusDot: Record<
  FooterDisplayStatus,
  { className: string; style?: React.CSSProperties }
> = {
  idle: { className: "bg-muted-foreground/40" },
  initializing: {
    className: "animate-pulse",
    style: { background: "var(--color-pacific)" },
  },
  running: {
    className: "animate-pulse",
    style: { background: "var(--color-pacific)" },
  },
  stopping: {
    className: "animate-pulse",
    style: { background: "var(--color-amber)" },
  },
  completed: {
    className: "",
    style: { background: "var(--color-seafoam)" },
  },
  error: { className: "bg-destructive" },
};

const statusLabels: Record<FooterDisplayStatus, string> = {
  idle: "ready",
  initializing: "initializing…",
  running: "running…",
  stopping: "stopping…",
  completed: "completed",
  error: "error",
};

function Dot() {
  return <span className="text-muted-foreground/20">&middot;</span>;
}

export function RunStatusFooter({
  status,
  label,
  model,
  elapsedMs,
  turns,
  tokenCount,
  cost,
  errorText,
  testId = "run-status-footer",
  className,
}: RunStatusFooterProps) {
  const dot = statusDot[status];
  const isFinished = status === "completed" || status === "error";

  return (
    <div
      className={[
        "flex h-6 shrink-0 items-center gap-2.5 border-t border-border bg-background/80 px-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
    >
      <div className="flex items-center gap-1.5">
        <div
          className={`size-[5px] rounded-full ${dot.className}`}
          style={dot.style}
        />
        <span className="text-xs text-muted-foreground/60">
          {statusLabels[status]}
        </span>
      </div>

      {label ? (
        <>
          <Dot />
          <span className="text-xs text-muted-foreground/60">{label}</span>
        </>
      ) : null}

      {model ? (
        <>
          <Dot />
          <span className="text-xs text-muted-foreground/60">{model}</span>
        </>
      ) : null}

      {typeof elapsedMs === "number" ? (
        <>
          <Dot />
          <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
            {formatElapsed(elapsedMs)}
          </span>
        </>
      ) : null}

      {turns && turns > 0 ? (
        <>
          <Dot />
          <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
            {turns} {turns === 1 ? "turn" : "turns"}
          </span>
        </>
      ) : null}

      {tokenCount && isFinished ? (
        <>
          <Dot />
          <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
            {tokenCount} tokens
          </span>
        </>
      ) : null}

      {cost && isFinished ? (
        <>
          <Dot />
          <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
            {cost}
          </span>
        </>
      ) : null}

      {status === "error" && errorText ? (
        <>
          <Dot />
          <span className="truncate text-xs text-destructive/90">{errorText}</span>
        </>
      ) : null}
    </div>
  );
}
