import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BenchmarkPromptInlineProps {
  onConfirm: () => void;
  onSkip: () => void;
}

export function BenchmarkPromptInline({ onConfirm, onSkip }: BenchmarkPromptInlineProps) {
  const [resolved, setResolved] = useState<"confirmed" | "skipped" | null>(null);

  const handleConfirm = () => {
    setResolved("confirmed");
    onConfirm();
  };

  const handleSkip = () => {
    setResolved("skipped");
    onSkip();
  };

  return (
    <div className="my-1 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md"
          style={{ background: "color-mix(in oklch, var(--color-pacific), transparent 85%)" }}
        >
          <FlaskConical className="size-3.5" style={{ color: "var(--color-pacific)" }} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">Run benchmarks?</p>
            <p className="text-sm text-muted-foreground">
              Evaluate the updated skill against test cases to measure quality.
            </p>
          </div>
          {resolved === null ? (
            <div className="flex gap-2">
              <Button size="sm" onClick={handleConfirm}>
                Run Benchmarks
              </Button>
              <Button size="sm" variant="outline" onClick={handleSkip}>
                Skip
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/70">
              {resolved === "confirmed" ? "Benchmarks started." : "Benchmarks skipped."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
