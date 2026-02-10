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

export function CloseGuard() {
  const [showDialog, setShowDialog] = useState(false);

  const destroyWindow = useCallback(async () => {
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
    let agentsRunning = false;
    try {
      agentsRunning = await invoke<boolean>("has_running_agents");
    } catch {
      // If we can't check, assume no agents and close
    }

    if (agentsRunning) {
      setShowDialog(true);
    } else {
      await destroyWindow();
    }
  }, [destroyWindow]);

  const handleStay = useCallback(() => {
    setShowDialog(false);
  }, []);

  const handleCloseAnyway = useCallback(async () => {
    await destroyWindow();
  }, [destroyWindow]);

  // Listen for close-requested event from Rust backend
  useEffect(() => {
    const unlisten = listen("close-requested", () => {
      handleCloseRequested();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleCloseRequested]);

  if (!showDialog) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleStay(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Agents Still Running</DialogTitle>
          <DialogDescription>
            One or more agents are still running. Closing now will stop them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={handleStay}>
            Stay
          </Button>
          <Button
            variant="destructive"
            onClick={handleCloseAnyway}
          >
            Close Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
