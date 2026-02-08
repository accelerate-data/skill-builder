import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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

// Use invoke directly to avoid circular import issues and get freshest data
interface AppSettings {
  workspace_path: string | null;
  github_token: string | null;
  anthropic_api_key: string | null;
  github_repo: string | null;
  auto_commit: boolean;
  auto_push: boolean;
}

interface GitFileStatusEntry {
  path: string;
  status: string;
}

type CloseDialogState =
  | { kind: "hidden" }
  | { kind: "agents-running" }
  | { kind: "dirty-worktree" }
  | { kind: "committing" };

export function CloseGuard() {
  const [dialogState, setDialogState] = useState<CloseDialogState>({
    kind: "hidden",
  });

  const performClose = useCallback(async () => {
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
    // Step 1: Check if agents are running
    try {
      const agentsRunning = await invoke<boolean>("has_running_agents");
      if (agentsRunning) {
        setDialogState({ kind: "agents-running" });
        return;
      }
    } catch {
      // If we can't check, assume no agents and proceed
    }

    // Step 2: Check if worktree is dirty
    try {
      const settings = await invoke<AppSettings>("get_settings");
      const workspacePath = settings.workspace_path;

      if (workspacePath) {
        const status = await invoke<GitFileStatusEntry[]>("git_file_status", {
          repoPath: workspacePath,
        });
        if (status.length > 0) {
          setDialogState({ kind: "dirty-worktree" });
          return;
        }
      }
    } catch {
      // If git check fails (no repo, etc.), just close
    }

    // Step 3: All clear, close immediately
    await performClose();
  }, [performClose]);

  const handleCommitAndClose = useCallback(async () => {
    setDialogState({ kind: "committing" });
    try {
      const settings = await invoke<AppSettings>("get_settings");
      const workspacePath = settings.workspace_path;
      const token = settings.github_token;

      if (!workspacePath || !token) {
        toast.error("Missing workspace path or GitHub token. Closing without saving.");
        await performClose();
        return;
      }

      await invoke<string>("commit_and_push", {
        repoPath: workspacePath,
        message: "skill-builder: auto-save on close",
        token,
      });
      toast.success("Changes committed and pushed");
      await performClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to commit: ${msg}`);
      setDialogState({ kind: "dirty-worktree" });
    }
  }, [performClose]);

  const handleCloseWithoutSaving = useCallback(async () => {
    setDialogState({ kind: "hidden" });
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

  if (dialogState.kind === "dirty-worktree" || dialogState.kind === "committing") {
    const isCommitting = dialogState.kind === "committing";
    return (
      <Dialog open onOpenChange={(open) => { if (!open && !isCommitting) handleCancel(); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Uncommitted Changes</DialogTitle>
            <DialogDescription>
              You have uncommitted changes in your workspace. Would you like to
              commit and push before closing?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel} disabled={isCommitting}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={handleCloseWithoutSaving} disabled={isCommitting}>
              Close Without Saving
            </Button>
            <Button onClick={handleCommitAndClose} disabled={isCommitting}>
              {isCommitting && <Loader2 className="size-4 animate-spin" />}
              Commit & Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}
