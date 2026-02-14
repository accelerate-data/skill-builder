import { useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNodeValidation } from "@/hooks/use-node-validation";
import type { DepStatus } from "@/lib/types";

interface SplashScreenProps {
  onDismiss: () => void;
  onReady: () => void;
}

function DepRow({ dep }: { dep: DepStatus }) {
  return (
    <div className="flex items-start gap-2 text-left text-sm">
      {dep.ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{dep.name}</p>
        {!dep.ok && (
          <p className="text-muted-foreground break-all">{dep.detail}</p>
        )}
      </div>
    </div>
  );
}

export function SplashScreen({ onDismiss, onReady }: SplashScreenProps) {
  const [fading, setFading] = useState(false);
  const { deps, isChecking, error, retry } = useNodeValidation();

  const onReadyRef = useRef(onReady);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

  useEffect(() => {
    if (isChecking) return;
    if (deps?.all_ok) {
      // Keep splash visible for 5s so startup checks are readable
      const timer = setTimeout(() => {
        onReadyRef.current();
        setFading(true);
        setTimeout(() => onDismissRef.current(), 400);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isChecking, deps]);

  const hasFailed = !isChecking && (error !== null || (deps !== null && !deps.all_ok));

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm transition-opacity duration-400 ${fading ? "opacity-0" : "opacity-100"}`}
    >
      <div className="flex max-w-lg flex-col items-center gap-6 rounded-xl border bg-card p-10 text-center shadow-lg">
        <img
          src="/icon-256.png"
          alt="Skill Builder"
          className="size-20"
        />

        <h1 className="text-3xl font-bold tracking-tight">Skill Builder</h1>

        {/* Dependency checklist */}
        <div className="w-full rounded-lg border bg-muted/30 px-4 py-3">
          <p className="mb-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Startup checks
          </p>
          <div className="flex flex-col gap-1.5">
            {isChecking && !deps && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>Checking dependencies...</span>
              </div>
            )}
            {deps?.checks.map((dep) => (
              <DepRow key={dep.name} dep={dep} />
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground/50">
          Experimental software — not for production use
        </p>

        {/* Invoke-level error */}
        {error && (
          <div className="flex w-full items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-left text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-destructive">{error}</p>
          </div>
        )}

        {/* Retry button when any check fails */}
        {hasFailed && (
          <Button
            variant="outline"
            size="sm"
            onClick={retry}
            disabled={isChecking}
          >
            <RefreshCw className="size-4" />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
