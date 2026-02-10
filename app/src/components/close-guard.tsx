import { useState, useEffect, useCallback, useRef } from "react";
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
import { cancelAllAgents } from "@/lib/tauri";

export function CloseGuard() {
  const [showDialog, setShowDialog] = useState(false);
  const [closing, setClosing] = useState(false);
  const deadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setClosing(true);

    // Hard deadline: close within 5 seconds no matter what
    deadlineRef.current = setTimeout(() => {
      destroyWindow();
    }, 5000);

    try {
      await cancelAllAgents();
    } catch {
      // Best effort — proceed to close regardless
    }

    // Brief pause to let agents wind down
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (deadlineRef.current) {
      clearTimeout(deadlineRef.current);
    }
    await destroyWindow();
  }, [destroyWindow]);

  // Clean up deadline timer on unmount
  useEffect(() => {
    return () => {
      if (deadlineRef.current) {
        clearTimeout(deadlineRef.current);
      }
    };
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

  if (!showDialog) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleStay(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Agents Still Running</DialogTitle>
          <DialogDescription>
            One or more agents are still running. Closing now will cancel them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={handleStay} disabled={closing}>
            Stay
          </Button>
          <Button
            variant="destructive"
            onClick={handleCloseAnyway}
            disabled={closing}
          >
            {closing ? "Closing..." : "Close Anyway"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
