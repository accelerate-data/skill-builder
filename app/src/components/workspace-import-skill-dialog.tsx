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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useImportedSkillsStore } from "@/stores/imported-skills-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { SkillFileMeta, WorkspaceSkill } from "@/lib/types"
import { PURPOSE_OPTIONS } from "@/lib/types"

const FALLBACK_MODEL_OPTIONS = [
  { id: "claude-haiku-4-5", displayName: "Haiku -- fastest, lowest cost" },
  { id: "claude-sonnet-4-6", displayName: "Sonnet -- balanced" },
  { id: "claude-opus-4-6", displayName: "Opus -- most capable" },
]

interface WorkspaceImportSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filePath: string
  meta: SkillFileMeta
  activeSkills: WorkspaceSkill[]
  onImported: () => void
}

export function WorkspaceImportSkillDialog({
  open,
  onOpenChange,
  filePath,
  meta,
  activeSkills,
  onImported,
}: WorkspaceImportSkillDialogProps) {
  const availableModels = useSettingsStore((s) => s.availableModels)
  const { uploadSkill } = useImportedSkillsStore()

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [version, setVersion] = useState("1.0.0")
  const [model, setModel] = useState("")
  const [argumentHint, setArgumentHint] = useState("")
  const [userInvocable, setUserInvocable] = useState(false)
  const [disableModelInvocation, setDisableModelInvocation] = useState(false)
  const [purpose, setPurpose] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false)

  useEffect(() => {
    if (open) {
      console.log("[workspace-import-skill-dialog] opening with file:", filePath)
      setName(meta.name ?? "")
      setDescription(meta.description ?? "")
      setVersion(meta.version ?? "1.0.0")
      setModel(meta.model ?? "")
      setArgumentHint(meta.argument_hint ?? "")
      setUserInvocable(meta.user_invocable ?? false)
      setDisableModelInvocation(meta.disable_model_invocation ?? false)
      setPurpose(null)
      setSubmitting(false)
      setShowOverwriteConfirm(false)
    }
  }, [open, filePath, meta])

  const purposeConflict = purpose
    ? activeSkills.find(
        (s) => s.purpose === purpose && s.skill_name !== name && s.is_active
      )
    : null

  const canSubmit =
    name.trim() !== "" &&
    description.trim() !== "" &&
    version.trim() !== "" &&
    !purposeConflict &&
    !submitting

  const doUpload = useCallback(
    async (forceOverwrite: boolean) => {
      setSubmitting(true)
      if (!forceOverwrite) setShowOverwriteConfirm(false)

      try {
        await uploadSkill({
          filePath,
          name: name.trim(),
          description: description.trim(),
          version: version.trim(),
          model: model || null,
          argumentHint: argumentHint || null,
          userInvocable,
          disableModelInvocation,
          purpose,
          forceOverwrite,
        })
        onOpenChange(false)
        toast.success(`Imported "${name.trim()}"`)
        onImported()
      } catch (err) {
        console.error("[workspace-import-skill-dialog] import failed:", err)
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.startsWith("conflict_overwrite_required:")) {
          setShowOverwriteConfirm(true)
        } else {
          toast.error(`Import failed: ${msg}`, { duration: Infinity })
        }
      } finally {
        setSubmitting(false)
      }
    },
    [
      filePath, name, description, version, model, argumentHint,
      userInvocable, disableModelInvocation, purpose,
      uploadSkill, onOpenChange, onImported,
    ]
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    doUpload(false)
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
                onClick={() => doUpload(true)}
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
              <Label htmlFor="ws-import-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ws-import-name"
                placeholder="kebab-case-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ws-import-description">
                Description <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ws-import-description"
                placeholder="Brief description of what this skill does"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ws-import-version">
                Version <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ws-import-version"
                placeholder="1.0.0"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ws-import-purpose">Purpose</Label>
              <Select
                value={purpose ?? ""}
                onValueChange={(val) => setPurpose(val || null)}
                disabled={submitting}
              >
                <SelectTrigger id="ws-import-purpose">
                  <SelectValue placeholder="Select a purpose (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {PURPOSE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {purposeConflict && (
                <p className="text-xs text-destructive">
                  &quot;{purposeConflict.skill_name}&quot; is already active for this purpose. Deactivate it first or choose a different purpose.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ws-import-model">Model</Label>
              <select
                id="ws-import-model"
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
              <Label htmlFor="ws-import-argument-hint">Argument Hint</Label>
              <Input
                id="ws-import-argument-hint"
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
