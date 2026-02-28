import { useState, useEffect, useCallback } from "react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { importSkillFromFile } from "@/lib/tauri"
import type { SkillFileMeta } from "@/lib/types"
import { useSettingsStore } from "@/stores/settings-store"

const FALLBACK_MODEL_OPTIONS = [
  { id: "claude-haiku-4-5", displayName: "Haiku -- fastest, lowest cost" },
  { id: "claude-sonnet-4-6", displayName: "Sonnet -- balanced" },
  { id: "claude-opus-4-6", displayName: "Opus -- most capable" },
]

interface ImportSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filePath: string
  meta: SkillFileMeta
  onImported: () => void
}

export function ImportSkillDialog({
  open,
  onOpenChange,
  filePath,
  meta,
  onImported,
}: ImportSkillDialogProps) {
  const availableModels = useSettingsStore((s) => s.availableModels)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [version, setVersion] = useState("1.0.0")
  const [model, setModel] = useState("")
  const [argumentHint, setArgumentHint] = useState("")
  const [userInvocable, setUserInvocable] = useState(false)
  const [disableModelInvocation, setDisableModelInvocation] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [nameConflictError, setNameConflictError] = useState<string | null>(null)
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false)

  // Reset form fields from meta when dialog opens
  useEffect(() => {
    if (open) {
      console.log("[import-skill-dialog] opening with file:", filePath)
      setName(meta.name ?? "")
      setDescription(meta.description ?? "")
      setVersion(meta.version ?? "1.0.0")
      setModel(meta.model ?? "")
      setArgumentHint(meta.argument_hint ?? "")
      setUserInvocable(meta.user_invocable ?? false)
      setDisableModelInvocation(meta.disable_model_invocation ?? false)
      setSubmitting(false)
      setNameConflictError(null)
      setShowOverwriteConfirm(false)
    }
  }, [open, filePath, meta])

  const canSubmit =
    name.trim() !== "" &&
    description.trim() !== "" &&
    version.trim() !== "" &&
    !submitting

  const doImport = useCallback(
    async (forceOverwrite: boolean) => {
      setSubmitting(true)
      if (!forceOverwrite) {
        setNameConflictError(null)
      }

      try {
        await importSkillFromFile({
          filePath,
          name: name.trim(),
          description: description.trim(),
          version: version.trim(),
          model: model || null,
          argumentHint: argumentHint || null,
          userInvocable,
          disableModelInvocation,
          forceOverwrite,
        })
        onOpenChange(false)
        toast.success(`Imported "${name.trim()}"`)
        onImported()
      } catch (err) {
        console.error("[import-skill-dialog] import failed:", err)
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.startsWith("conflict_no_overwrite:")) {
          setNameConflictError(
            `A skill named '${name.trim()}' already exists. Rename it before importing.`
          )
        } else if (msg.startsWith("conflict_overwrite_required:")) {
          setShowOverwriteConfirm(true)
        } else {
          toast.error(`Import failed: ${msg}`, { duration: Infinity })
        }
      } finally {
        setSubmitting(false)
      }
    },
    [
      filePath,
      name,
      description,
      version,
      model,
      argumentHint,
      userInvocable,
      disableModelInvocation,
      onOpenChange,
      onImported,
    ]
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    doImport(false)
  }

  const handleOverwrite = () => {
    doImport(true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Skill</DialogTitle>
          <DialogDescription>
            Review and confirm the skill details before importing.
          </DialogDescription>
        </DialogHeader>

        {showOverwriteConfirm ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              A skill named <strong>&quot;{name.trim()}&quot;</strong> is already imported. Overwrite it?
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowOverwriteConfirm(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleOverwrite}
                disabled={submitting}
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {submitting ? "Overwriting..." : "Overwrite"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="import-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="import-name"
                placeholder="kebab-case-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameConflictError(null)
                }}
                disabled={submitting}
                autoFocus
              />
              {nameConflictError && (
                <p className="text-xs text-destructive">{nameConflictError}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="import-description">
                Description <span className="text-destructive">*</span>
              </Label>
              <Input
                id="import-description"
                placeholder="Brief description of what this skill does"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="import-version">
                Version <span className="text-destructive">*</span>
              </Label>
              <Input
                id="import-version"
                placeholder="1.0.0"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="import-model">Model</Label>
              <select
                id="import-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={submitting}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">App default</option>
                {(availableModels.length > 0 ? availableModels : FALLBACK_MODEL_OPTIONS).map((m) => (
                  <option key={m.id} value={m.id}>{m.displayName}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="import-argument-hint">Argument Hint</Label>
              <Input
                id="import-argument-hint"
                placeholder="e.g., [salesforce-org-url]"
                value={argumentHint}
                onChange={(e) => setArgumentHint(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">User Invocable</span>
                <span className="text-xs text-muted-foreground">
                  Allow users to invoke this skill directly
                </span>
              </div>
              <Switch
                checked={userInvocable}
                onCheckedChange={setUserInvocable}
                disabled={submitting}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Disable Model Invocation</span>
                <span className="text-xs text-muted-foreground">
                  Prevent Claude from automatically invoking this skill
                </span>
              </div>
              <Switch
                checked={disableModelInvocation}
                onCheckedChange={setDisableModelInvocation}
                disabled={submitting}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {submitting ? "Importing..." : "Confirm Import"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
