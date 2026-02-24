import { useState } from "react"
import { toast } from "sonner"
import { Trash2, RotateCcw, Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { resolveOrphan } from "@/lib/tauri"
import type { OrphanSkill } from "@/lib/types"
import { PURPOSE_LABELS, type Purpose } from "@/lib/types"

interface OrphanResolutionDialogProps {
  orphans: OrphanSkill[]
  open: boolean
  onResolved: () => void
}

export default function OrphanResolutionDialog({
  orphans,
  open,
  onResolved,
}: OrphanResolutionDialogProps) {
  const [resolving, setResolving] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<OrphanSkill[]>(orphans)

  const handleResolve = async (
    skillName: string,
    action: "delete" | "keep"
  ) => {
    setResolving(skillName)
    try {
      await resolveOrphan(skillName, action)
      const label = action === "delete" ? "deleted" : "kept and reset"
      toast.success(`Orphaned skill "${skillName}" ${label}`)
      const updated = remaining.filter((o) => o.skill_name !== skillName)
      setRemaining(updated)
      if (updated.length === 0) {
        onResolved()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Failed to resolve "${skillName}": ${msg}`, { duration: Infinity })
    } finally {
      setResolving(null)
    }
  }

  const displayPurpose = (p: string): string => {
    return (
      PURPOSE_LABELS[p as Purpose] ?? p
    )
  }

  return (
    <Dialog open={open && remaining.length > 0}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            Orphaned Skills Found
          </DialogTitle>
          <DialogDescription>
            The following skills exist in the database but their workspace files
            are missing. Choose to delete them or keep them (resets to step 0).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {remaining.map((orphan) => (
            <div
              key={orphan.skill_name}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{orphan.skill_name}</span>
                <span className="text-xs text-muted-foreground">
                  {displayPurpose(orphan.purpose)}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resolving !== null}
                  onClick={() => handleResolve(orphan.skill_name, "keep")}
                >
                  {resolving === orphan.skill_name ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                  Keep
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={resolving !== null}
                  onClick={() => handleResolve(orphan.skill_name, "delete")}
                >
                  {resolving === orphan.skill_name ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <p className="text-xs text-muted-foreground">
            {remaining.length} orphan{remaining.length !== 1 ? "s" : ""} remaining
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
