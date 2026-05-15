import { useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStartupValidation } from "@/hooks/use-node-validation";
import type { BootstrapCheck, StartupResult } from "@/lib/types";

interface SplashScreenProps {
  canDismiss?: boolean;
  onDismiss: () => void;
  onReady: () => void;
  runtimeStatus?: {
    kind: "pending" | "error";
    message: string;
  } | null;
}

function CheckRow({ check }: { check: BootstrapCheck }) {
  return (
    <div className="flex items-start gap-2 text-left text-sm">
      {check.ok ? (
        <CheckCircle2
          className="mt-0.5 size-4 shrink-0"
          style={{ color: "var(--color-seafoam)" }}
        />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{check.name}</p>
        {!check.ok && (
          <p className="text-muted-foreground break-all text-xs">{check.detail}</p>
        )}
      </div>
    </div>
  );
}

export function SplashScreen({
  canDismiss = true,
  onDismiss,
  onReady,
  runtimeStatus = null,
}: SplashScreenProps) {
  const [fading, setFading] = useState(false);
  const { deps, isChecking, error, retry } = useStartupValidation();
  const readySignalledRef = useRef(false);

  const onReadyRef = useRef(onReady);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

  useEffect(() => {
    if (isChecking) return;
    const result = deps as StartupResult | null;
    if (result?.status && result.status.status === "Ready") {
      if (!readySignalledRef.current) {
        readySignalledRef.current = true;
        onReadyRef.current();
      }
    }
    if (result?.status && result.status.status === "Ready" && canDismiss) {
      const timer = setTimeout(() => {
        setFading(true);
        setTimeout(() => onDismissRef.current(), 500);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [canDismiss, isChecking, deps]);

  const result = deps as StartupResult | null;
  const hasFailed = !isChecking && (error !== null || (result !== null && result.status.status === "Failed"));
  const failedChecks = result?.checks.filter((c) => !c.ok) ?? [];

  return (
    <div
      data-testid="splash-screen"
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden transition-all duration-500 ${fading ? "opacity-0 scale-[0.98]" : "opacity-100 scale-100"}`}
    >
      {/* Gradient backdrop — diagonal wash */}
      <div className="absolute inset-0 bg-background">
        <div
          className="absolute inset-0 opacity-60 dark:opacity-40"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in oklch, var(--color-pacific), transparent 82%) 0%, transparent 48%, color-mix(in oklch, var(--color-seafoam), transparent 88%) 100%)",
          }}
        />
      </div>
      {/* Card */}
      <div className="relative z-10 flex max-w-lg flex-col items-center gap-6 rounded-xl border bg-card p-10 text-center shadow-lg">
        <img
          src="/icon-dark-256.png"
          alt="Skill Builder"
          className="size-20 animate-splash-logo block dark:hidden"
        />
        <img
          src="/icon-light-256.png"
          alt="Skill Builder"
          className="size-20 animate-splash-logo hidden dark:block"
        />

        <h1 className="text-3xl font-bold tracking-tight animate-splash-title">Skill Builder</h1>

        {/* Bootstrap checklist */}
        <div className="w-full rounded-lg border bg-muted/30 px-4 py-3">
          <p className="mb-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {isChecking ? "Checking runtime..." : "Runtime checks"}
          </p>
          <div className="flex flex-col gap-1.5">
            {isChecking && !deps && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground animate-splash-row" style={{ animationDelay: '300ms' }}>
                <Loader2 className="size-4 animate-spin" />
                <span>Checking runtime...</span>
              </div>
            )}
            {result?.checks.map((check, i) => (
              <div key={check.name} className="animate-splash-row" style={{ animationDelay: `${300 + i * 120}ms` }}>
                <CheckRow check={check} />
              </div>
            ))}
          </div>
        </div>

        {!isChecking && failedChecks.length > 0 && (
          <div className="w-full rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-left text-sm">
            <p className="font-medium text-destructive">Startup blocked — runtime not ready</p>
            <p className="mt-1 text-muted-foreground">
              {result?.status.status === "Failed" && result.status.detail
                ? result.status.detail
                : "Resolve the issues listed above, then retry startup."}
            </p>
          </div>
        )}

        {runtimeStatus && (
          <div className={`w-full rounded-lg border px-4 py-3 text-left text-sm ${
            runtimeStatus.kind === "error"
              ? "border-destructive/30 bg-destructive/5"
              : "border-border bg-muted/30"
          }`}>
            <p className={`font-medium ${
              runtimeStatus.kind === "error" ? "text-destructive" : ""
            }`}>
              {runtimeStatus.kind === "error"
                ? "Startup blocked — OpenHands runtime failed to start"
                : "Starting OpenHands runtime…"}
            </p>
            <p className="mt-1 text-muted-foreground">
              {runtimeStatus.message}
            </p>
          </div>
        )}

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
