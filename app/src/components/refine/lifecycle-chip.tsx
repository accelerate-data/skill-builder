import { useRefineStore } from "@/stores/refine-store";
import { useAgentStore } from "@/stores/agent-store";

/** Status values the chip can render. The agent-store currently emits
 *  `running | completed | error | shutdown`; `starting` and `cancelled` are
 *  accepted defensively for forward-compat with lifecycle events. */
export type LifecycleStatus =
  | "starting"
  | "running"
  | "completed"
  | "error"
  | "cancelled"
  | "shutdown"
  | undefined;

interface ChipStyle {
  label: string;
  color: string;
  pulse: boolean;
}

function styleFor(status: LifecycleStatus): ChipStyle | null {
  switch (status) {
    case "starting":
      return { label: "Starting", color: "var(--muted-foreground)", pulse: false };
    case "running":
      return { label: "Running", color: "var(--color-pacific)", pulse: true };
    case "completed":
      return { label: "Completed", color: "var(--color-seafoam)", pulse: false };
    case "error":
      return { label: "Error", color: "var(--destructive)", pulse: false };
    case "cancelled":
    case "shutdown":
      return { label: "Cancelled", color: "var(--muted-foreground)", pulse: false };
    default:
      return null;
  }
}

interface LifecycleChipViewProps {
  status: LifecycleStatus;
}

/** Pure view — exported for tests. */
export function LifecycleChipView({ status }: LifecycleChipViewProps) {
  const style = styleFor(status);
  if (!style) return null;

  return (
    <span
      data-testid="refine-lifecycle-chip"
      data-status={status}
      className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: `color-mix(in oklch, ${style.color}, transparent 85%)`,
        color: style.color,
      }}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${style.pulse ? "animate-pulse" : ""}`}
        style={{ backgroundColor: style.color }}
        aria-hidden
      />
      {style.label}
    </span>
  );
}

/** Store-bound chip used in the refine chat header. Renders nothing when
 *  there is no active agent. */
export function LifecycleChip() {
  const activeAgentId = useRefineStore((s) => s.activeAgentId);
  const status = useAgentStore((s) =>
    activeAgentId ? s.runs[activeAgentId]?.status : undefined,
  );
  return <LifecycleChipView status={status as LifecycleStatus} />;
}
