import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getSkillHistory, restoreSkillVersion } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import type { SkillCommit } from "@/lib/types";

interface RestoreVersionDialogProps {
  skillName: string;
  workspacePath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored?: () => void;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatCommitMessage(message: string): string {
  const colonIdx = message.indexOf(": ");
  return colonIdx > 0 ? message.slice(colonIdx + 2) : message;
}

export default function RestoreVersionDialog({
  skillName,
  workspacePath,
  open,
  onOpenChange,
  onRestored,
}: RestoreVersionDialogProps) {
  const [commits, setCommits] = useState<SkillCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getSkillHistory(workspacePath, skillName, 50)
      .then((history) => {
        // Only show tagged commits (versions)
        setCommits(history.filter((c) => c.version));
      })
      .catch((err) => {
        console.error("event=restore_dialog_fetch_failed skill=%s error=%s", skillName, err);
        toast.error("Failed to load version history", { duration: Infinity });
      })
      .finally(() => setLoading(false));
  }, [open, workspacePath, skillName]);

  const handleRestore = async (commit: SkillCommit) => {
    setRestoring(commit.sha);
    try {
      const newVersion = await restoreSkillVersion(workspacePath, skillName, commit.sha);
      toast.success(`Restored — tagged as v${newVersion}`);
      onOpenChange(false);
      onRestored?.();
    } catch (err) {
      console.error("event=restore_version_failed skill=%s sha=%s error=%s", skillName, commit.sha, err);
      toast.error("Failed to restore version", { duration: Infinity });
    } finally {
      setRestoring(null);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Restore Version</AlertDialogTitle>
          <AlertDialogDescription>
            Select a version to restore for <span className="font-medium">{skillName}</span>.
            This will replace the current skill files with the selected version.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            Loading versions…
          </div>
        ) : commits.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No tagged versions found
          </div>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <div className="flex flex-col gap-2">
              {commits.map((commit) => (
                <div
                  key={commit.sha}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="shrink-0 rounded-full text-xs font-medium px-2 py-0.5"
                      style={{
                        color: "var(--color-seafoam)",
                        background: "color-mix(in oklch, var(--color-seafoam), transparent 85%)",
                      }}
                    >
                      v{commit.version}
                    </span>
                    <span className="text-sm line-clamp-2">{formatCommitMessage(commit.message)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeDate(commit.timestamp)}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={restoring !== null}
                    onClick={() => handleRestore(commit)}
                  >
                    {restoring === commit.sha ? "Restoring…" : "Restore"}
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={restoring !== null}>Cancel</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
