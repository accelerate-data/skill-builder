import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { invoke } from "@tauri-apps/api/core";
import { markShuttingDown } from "@/hooks/use-agent-stream";

type CloseDialogState =
  | { kind: "hidden" }
  | { kind: "agents-running" };

export function CloseGuard() {
  const [dialogState, setDialogState] = useState<CloseDialogState>({
    kind: "hidden",
  });

  const performClose = useCallback(async () => {
    // Suppress late agent-exit events so killed sidecars don't trigger error UI
    markShuttingDown();
    try {
      await getCurrentWindow().destroy();
    } catch {
      try {
        await getCurrentWindow().close();
      } catch {
        // Nothing we can do
      }
    }
  }, []);

  const handleCloseRequested = useCallback(async () => {
    try {
      const agentsRunning = await invoke<boolean>("has_running_agents");
      if (agentsRunning) {
        setDialogState({ kind: "agents-running" });
        return;
      }
    } catch {
      // If we can't check, assume no agents and proceed
    }

    await performClose();
  }, [performClose]);

  const handleCancel = useCallback(() => {
    setDialogState({ kind: "hidden" });
  }, []);

  // Listen for close-requested event from Rust backend
  useEffect(() => {
    const unlisten = listen("close-requested", () => {
      handleCloseRequested();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleCloseRequested]);

  if (dialogState.kind === "agents-running") {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) handleCancel(); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Agents Still Running</DialogTitle>
            <DialogDescription>
              One or more agents are still running. Please wait for them to
              finish or cancel them before closing the app.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              Go Back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}
