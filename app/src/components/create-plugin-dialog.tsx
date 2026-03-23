import { useState, useCallback } from "react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createPluginFromSkills } from "@/lib/tauri"

interface CreatePluginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function CreatePluginDialog({
  open,
  onOpenChange,
  onCreated,
}: CreatePluginDialogProps) {
  const [name, setName] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const isValidName = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)

  const handleSubmit = useCallback(async () => {
    if (!isValidName) return
    setSubmitting(true)
    const toastId = toast.loading(`Creating plugin "${name}"...`)
    try {
      await createPluginFromSkills(name, [])
      toast.success(`Created plugin "${name}"`, { id: toastId })
      setName("")
      onOpenChange(false)
      onCreated()
    } catch (err) {
      toast.error(
        `Failed to create plugin: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId },
      )
    } finally {
      setSubmitting(false)
    }
  }, [name, isValidName, onOpenChange, onCreated])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Plugin</DialogTitle>
          <DialogDescription>
            Create a new empty plugin. You can add skills to it later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="plugin-name">Plugin name</Label>
            <Input
              id="plugin-name"
              placeholder="my-plugin"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isValidName && !submitting) handleSubmit()
              }}
              autoFocus
            />
            {name && !isValidName && (
              <p className="text-xs text-destructive">
                Use lowercase letters, numbers, and hyphens (e.g. my-plugin)
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValidName || submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
