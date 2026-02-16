import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { SkillSummary } from "@/lib/types"

interface DeleteSkillDialogProps {
  skill: SkillSummary | null
  workspacePath: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}

export default function DeleteSkillDialog({
  skill,
  workspacePath,
  open,
  onOpenChange,
  onDeleted,
}: DeleteSkillDialogProps) {
  const [loading, setLoading] = useState(false)

  const handleDelete = async () => {
    if (!skill) return
    setLoading(true)
    try {
      await invoke("delete_skill", {
        workspacePath,
        name: skill.name,
      })
      console.log(`[skill] Deleted skill "${skill.name}"`)
      toast.success(`Skill "${skill.name}" deleted`)
      onOpenChange(false)
      onDeleted()
    } catch (err) {
      toast.error(
        `Failed to delete skill: ${err instanceof Error ? err.message : String(err)}`,
        { duration: Infinity },
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Skill</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete{" "}
            <span className="font-medium text-foreground">
              {skill?.name}
            </span>
            ? This will permanently remove all files for this skill.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={loading}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
