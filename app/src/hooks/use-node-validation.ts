import { useCallback, useEffect, useState } from "react";
import { checkStartupDeps } from "@/lib/tauri";
import type { StartupResult } from "@/lib/types";

interface UseStartupBootstrapReturn {
  deps: StartupResult | null;
  isChecking: boolean;
  error: string | null;
  retry: () => void;
}

export function useStartupValidation(): UseStartupBootstrapReturn {
  const [deps, setDeps] = useState<StartupResult | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(() => {
    setIsChecking(true);
    setError(null);
    setDeps(null);

    checkStartupDeps()
      .then((result) => {
        setDeps(result);
        setIsChecking(false);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : String(err);
        setError(message || "Failed to check startup bootstrap");
        setIsChecking(false);
      });
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return { deps, isChecking, error, retry: check };
}
