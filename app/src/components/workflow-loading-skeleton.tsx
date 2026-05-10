import { Loader2 } from "lucide-react";

export function WorkflowLoadingSkeleton() {
  return (
    <div
      data-testid="workflow-loading-skeleton"
      className="flex h-full animate-in fade-in duration-150"
    >
      <div className="flex w-60 shrink-0 flex-col gap-3 border-r p-4">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="flex items-center gap-3">
            <div className="size-6 rounded-full bg-muted animate-pulse" />
            <div className="h-3 flex-1 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" style={{ color: "var(--color-pacific)" }} />
        Loading skill…
      </div>
    </div>
  );
}
