import { useState, useEffect } from "react"
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
import TagInput from "@/components/tag-input"
import { updateSkillTags } from "@/lib/tauri"
import type { SkillSummary } from "@/lib/types"

interface EditTagsDialogProps {
  skill: SkillSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  availableTags: string[]
}

export default function EditTagsDialog({
  skill,
  open,
  onOpenChange,
  onSaved,
  availableTags,
}: EditTagsDialogProps) {
  const [tags, setTags] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && skill) {
      setTags([...skill.tags])
    } else if (!open) {
      setTags([])
      setSaving(false)
    }
  }, [open, skill])

  const handleSave = async () => {
    if (!skill) return
    setSaving(true)
    try {
      await updateSkillTags(skill.name, tags)
      toast.success("Tags updated")
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(
        `Failed to update tags: ${err instanceof Error ? err.message : String(err)}`,
        { duration: Infinity },
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Tags</DialogTitle>
          <DialogDescription>
            Update tags for{" "}
            <span className="font-medium text-foreground">
              {skill?.name}
            </span>
          </DialogDescription>
        </DialogHeader>
        <TagInput
          tags={tags}
          onChange={setTags}
          suggestions={availableTags}
          disabled={saving}
        />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
