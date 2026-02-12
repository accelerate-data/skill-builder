import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StartupDeps } from "@/lib/types";

interface UseStartupDepsReturn {
  deps: StartupDeps | null;
  isChecking: boolean;
  error: string | null;
  retry: () => void;
}

export function useNodeValidation(): UseStartupDepsReturn {
  const [deps, setDeps] = useState<StartupDeps | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(() => {
    setIsChecking(true);
    setError(null);
    setDeps(null);

    invoke<StartupDeps>("check_startup_deps")
      .then((result) => {
        setDeps(result);
        setIsChecking(false);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : String(err);
        setError(message || "Failed to check startup dependencies");
        setIsChecking(false);
      });
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return { deps, isChecking, error, retry: check };
}
