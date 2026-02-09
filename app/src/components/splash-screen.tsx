import { useState } from "react";
import { Button } from "@/components/ui/button";

interface SplashScreenProps {
  onDismiss: () => void;
}

export function SplashScreen({ onDismiss }: SplashScreenProps) {
  const [fading, setFading] = useState(false);

  const handleDismiss = () => {
    setFading(true);
    setTimeout(onDismiss, 400);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm transition-opacity duration-400 ${fading ? "opacity-0" : "opacity-100"}`}
    >
      <div className="flex max-w-lg flex-col items-center gap-6 rounded-xl border bg-card p-10 text-center shadow-lg">
        <img
          src="/ad-favicon.svg"
          alt="Accelerated Data"
          className="h-20 w-auto"
        />

        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Skill Builder</h1>
          <p className="text-muted-foreground">
            Build Claude skills for Vibedata with AI-powered multi-agent
            workflows. Create domain knowledge packages that help data and
            analytics engineers build silver and gold layer models.
          </p>
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
          <p className="font-medium text-amber-600 dark:text-amber-400">
            Demo Software
          </p>
          <p className="mt-1">
            This software is provided as-is for demonstration and experimental
            purposes. It is not officially supported and may change or break
            without notice. Use at your own risk.
          </p>
        </div>

        <Button size="lg" onClick={handleDismiss} className="w-full">
          Get Started
        </Button>
      </div>
    </div>
  );
}
