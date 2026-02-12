import { AlertCircle, ExternalLink, Terminal, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Structured error payload from the Rust backend's `agent-init-error` event. */
export interface RuntimeError {
  error_type: string;
  message: string;
  fix_hint: string;
}

interface RuntimeErrorDialogProps {
  error: RuntimeError | null;
  onDismiss: () => void;
}

/** Map error types to human-readable dialog titles. */
function getErrorTitle(errorType: string): string {
  switch (errorType) {
    case "sidecar_missing":
      return "Agent Runtime Not Found";
    case "node_missing":
      return "Node.js Not Installed";
    case "node_incompatible":
      return "Incompatible Node.js Version";
    case "spawn_failed":
      return "Failed to Start Agent Runtime";
    case "ready_timeout":
      return "Agent Runtime Initialization Timeout";
    default:
      return "Agent Runtime Error";
  }
}

/** Map error types to appropriate icons. */
function getErrorIcon(errorType: string) {
  switch (errorType) {
    case "sidecar_missing":
    case "spawn_failed":
      return <Terminal className="size-5 text-destructive" />;
    case "node_missing":
    case "node_incompatible":
      return <XCircle className="size-5 text-destructive" />;
    default:
      return <AlertCircle className="size-5 text-destructive" />;
  }
}

/** Whether to show a link to nodejs.org for this error type. */
function showNodeLink(errorType: string): boolean {
  return errorType === "node_missing" || errorType === "node_incompatible";
}

export function RuntimeErrorDialog({ error, onDismiss }: RuntimeErrorDialogProps) {
  if (!error) return null;

  return (
    <Dialog open={!!error} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getErrorIcon(error.error_type)}
            {getErrorTitle(error.error_type)}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3">
              <p>{error.message}</p>
              <div className="rounded-md border border-border bg-muted/50 p-3">
                <p className="text-sm font-medium text-foreground">How to fix:</p>
                <p className="mt-1 text-sm font-mono">{error.fix_hint}</p>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row justify-end gap-2">
          {showNodeLink(error.error_type) && (
            <Button
              variant="outline"
              asChild
            >
              <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" />
                nodejs.org
              </a>
            </Button>
          )}
          <Button onClick={onDismiss}>
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
