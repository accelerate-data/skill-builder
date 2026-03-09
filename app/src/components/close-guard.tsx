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
import { gracefulShutdown } from "@/lib/tauri";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useRefineStore } from "@/stores/refine-store";
import { useTestStore } from "@/stores/test-store";
import { Loader2 } from "lucide-react";

export function CloseGuard() {
  const [showDialog, setShowDialog] = useState(false);
  const [closing, setClosing] = useState(false);

  const destroyWindow = useCallback(async () => {
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
    const workflow = useWorkflowStore.getState();
    const agentsRunning =
      workflow.isRunning ||
      workflow.gateLoading ||
      useRefineStore.getState().isRunning ||
      useTestStore.getState().isRunning;

    if (agentsRunning) {
      setShowDialog(true);
    } else {
      try {
        await gracefulShutdown();
      } catch {
        // Best-effort
      }
      await destroyWindow();
    }
  }, [destroyWindow]);

  const handleStay = useCallback(() => {
    setShowDialog(false);
  }, []);

  const handleCloseAnyway = useCallback(async () => {
    setClosing(true);
    try {
      await gracefulShutdown();
    } catch {
      // Best-effort — proceed to close even if shutdown fails
    }
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
    <Dialog open onOpenChange={(open) => { if (!open && !closing) handleStay(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Agents Still Running</DialogTitle>
          <DialogDescription>
            One or more agents are still running. Closing now will stop them.
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
            {closing ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Closing…
              </>
            ) : (
              "Close Anyway"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
