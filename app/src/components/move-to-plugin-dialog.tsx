import { useState, useCallback, useEffect } from "react"
import { toast } from "@/lib/toast"
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
import { listPlugins, moveSkillToPlugin } from "@/lib/tauri"
import type { LibraryPlugin } from "@/lib/types"

interface MoveToPluginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skillName: string
  skillKey: string
  currentPluginSlug: string
  onMoved: () => void
}

export function MoveToPluginDialog({
  open,
  onOpenChange,
  skillName,
  skillKey,
  currentPluginSlug,
  onMoved,
}: MoveToPluginDialogProps) {
  const [plugins, setPlugins] = useState<LibraryPlugin[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    listPlugins().then((all) => {
      const available = all.filter(
        (p) => !p.is_default && p.slug !== currentPluginSlug,
      )
      setPlugins(available)
      setSelected(available[0]?.slug ?? null)
    })
  }, [open, currentPluginSlug])

  const handleSubmit = useCallback(async () => {
    if (!selected) return
    setSubmitting(true)
    const toastId = toast.loading(`Moving "${skillName}"...`)
    try {
      await moveSkillToPlugin(skillKey, selected)
      toast.success(`Moved "${skillName}" to ${selected}`, { id: toastId })
      onOpenChange(false)
      onMoved()
    } catch (err) {
      toast.error(
        `Move failed: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId },
      )
    } finally {
      setSubmitting(false)
    }
  }, [selected, skillName, skillKey, onOpenChange, onMoved])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to Plugin</DialogTitle>
          <DialogDescription>
            Move &ldquo;{skillName}&rdquo; to a different plugin.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {plugins.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No other plugins available. Create a plugin first.
            </p>
          ) : (
            plugins.map((p) => (
              <label
                key={p.slug}
                className="flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
              >
                <input
                  type="radio"
                  name="plugin"
                  value={p.slug}
                  checked={selected === p.slug}
                  onChange={() => setSelected(p.slug)}
                  className="size-4"
                />
                <div>
                  <div className="text-sm font-medium">{p.display_name}</div>
                  <div className="text-xs text-muted-foreground">{p.slug}</div>
                </div>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selected || submitting || plugins.length === 0}
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
