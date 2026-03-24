import { useState, useCallback, useEffect, useMemo } from "react"
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
import { moveSkillToPlugin } from "@/lib/tauri"
import { usePluginStore } from "@/stores/plugin-store"

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
  const allPlugins = usePluginStore((s) => s.plugins)
  const fetchPlugins = usePluginStore((s) => s.fetchPlugins)
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const plugins = useMemo(
    () => allPlugins.filter(
      (p) => !p.is_default && p.slug !== currentPluginSlug && p.source_type !== "marketplace",
    ),
    [allPlugins, currentPluginSlug],
  )

  useEffect(() => {
    if (!open) return
    fetchPlugins()
  }, [open, fetchPlugins])

  useEffect(() => {
    if (open && plugins.length > 0) {
      setSelected(plugins[0]?.slug ?? null)
    }
  }, [open, plugins])

  const handleSubmit = useCallback(async () => {
    if (!selected) return
    setSubmitting(true)
    try {
      await moveSkillToPlugin(skillKey, selected)
      await usePluginStore.getState().fetchPlugins()
      onOpenChange(false)
      onMoved()
    } catch (err) {
      toast.error(`Move failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }, [selected, skillKey, onOpenChange, onMoved])

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
