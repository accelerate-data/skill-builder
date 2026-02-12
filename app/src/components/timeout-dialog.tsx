import { useState, useEffect } from "react";
import { Clock, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TimeoutDialogProps {
  open: boolean;
  stepName: string;
  /** Timestamp (ms) when the step started running. */
  stepStartTime: number | null;
  onRetry: () => void;
  onCancel: () => void;
}

/** Format elapsed seconds into a human-readable string like "1m 30s". */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function TimeoutDialog({
  open,
  stepName,
  stepStartTime,
  onRetry,
  onCancel,
}: TimeoutDialogProps) {
  const [elapsed, setElapsed] = useState(0);

  // Update elapsed time every second while the dialog is open
  useEffect(() => {
    if (!open || stepStartTime === null) {
      setElapsed(0);
      return;
    }

    const update = () => {
      setElapsed(Math.floor((Date.now() - stepStartTime) / 1000));
    };
    update();

    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [open, stepStartTime]);

  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-5 text-amber-500" />
            Step Timed Out
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{stepName}</span>{" "}
            has been running for{" "}
            <span className="font-mono font-medium text-foreground">
              {formatElapsed(elapsed)}
            </span>{" "}
            with no completion signal. The agent may be stuck.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            <XCircle className="size-3.5" />
            Cancel Step
          </Button>
          <Button onClick={onRetry}>
            <RotateCcw className="size-3.5" />
            Retry Step
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { formatElapsed };
