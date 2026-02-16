import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { listTeamRepoSkills, importTeamRepoSkill } from "@/lib/tauri"
import type { TeamRepoSkill } from "@/lib/types"
import { SKILL_TYPE_COLORS } from "@/lib/types"
import { cn } from "@/lib/utils"

interface TeamRepoImportDialogProps {
  onImported: () => Promise<void>
  remoteConfigured: boolean
  isLoggedIn: boolean
}

type Step = "loading" | "select" | "empty" | "importing"

export default function TeamRepoImportDialog({
  onImported,
  remoteConfigured,
  isLoggedIn,
}: TeamRepoImportDialogProps) {
  const [open, onOpenChange] = useState(false)
  const [step, setStep] = useState<Step>("loading")
  const [skills, setSkills] = useState<TeamRepoSkill[]>([])
  const [selected, setSelected] = useState<TeamRepoSkill | null>(null)
  const [conflictSkill, setConflictSkill] = useState<TeamRepoSkill | null>(null)

  useEffect(() => {
    if (!open) return
    setStep("loading")
    setSelected(null)
    setConflictSkill(null)
    listTeamRepoSkills()
      .then(result => {
        setSkills(result)
        setStep(result.length === 0 ? "empty" : "select")
      })
      .catch(err => {
        toast.error(`Failed to load skills: ${err instanceof Error ? err.message : String(err)}`)
        onOpenChange(false)
      })
  }, [open])

  const handleImport = async () => {
    if (!selected) return
    setStep("importing")
    try {
      await importTeamRepoSkill(selected.path, selected.name)
      toast.success(`Skill "${selected.name}" imported successfully`)
      onOpenChange(false)
      await onImported()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("already exists")) {
        setConflictSkill(selected)
        setStep("select")
      } else {
        toast.error(`Import failed: ${message}`)
        setStep("select")
      }
    }
  }

  const handleForceImport = async () => {
    if (!conflictSkill) return
    setConflictSkill(null)
    setStep("importing")
    try {
      await importTeamRepoSkill(conflictSkill.path, conflictSkill.name, true)
      toast.success(`Skill "${conflictSkill.name}" imported successfully`)
      onOpenChange(false)
      await onImported()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`Import failed: ${message}`)
      setStep("select")
    }
  }

  const buttonTitle = !remoteConfigured
    ? "Configure remote repository in Settings"
    : !isLoggedIn
      ? "Sign in to GitHub in Settings"
      : "Import skills from team repository"

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          disabled={!remoteConfigured || !isLoggedIn}
          title={buttonTitle}
        >
          <Download className="size-4" />
          Import from Repo
        </Button>
      </DialogTrigger>
      <DialogContent>
        {step === "loading" && (
          <>
            <DialogHeader>
              <DialogTitle>Import from Team Repository</DialogTitle>
              <DialogDescription>Loading available skills...</DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          </>
        )}

        {step === "empty" && (
          <>
            <DialogHeader>
              <DialogTitle>Import from Team Repository</DialogTitle>
              <DialogDescription>No skills found in the team repository.</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </>
        )}

        {step === "select" && (
          <>
            <DialogHeader>
              <DialogTitle>Import from Team Repository</DialogTitle>
              <DialogDescription>Select a skill to import as an editable local copy.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[400px]">
              <div className="flex flex-col gap-2 p-1">
                {skills.map(skill => (
                  <button
                    key={skill.path}
                    type="button"
                    className={cn(
                      "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                      selected?.path === skill.path
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    )}
                    onClick={() => setSelected(skill)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{skill.name}</span>
                      {skill.domain && (
                        <Badge variant="secondary" className={cn("text-xs", SKILL_TYPE_COLORS[skill.domain as keyof typeof SKILL_TYPE_COLORS])}>
                          {skill.domain}
                        </Badge>
                      )}
                    </div>
                    {skill.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{skill.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {skill.creator && <span>by {skill.creator}</span>}
                      {skill.created_at && <span>{new Date(skill.created_at).toLocaleDateString()}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleImport} disabled={!selected}>
                Import
              </Button>
            </div>
          </>
        )}

        {step === "importing" && selected && (
          <>
            <DialogHeader>
              <DialogTitle>Importing Skill</DialogTitle>
              <DialogDescription>Importing &quot;{selected.name}&quot;...</DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
    <AlertDialog open={!!conflictSkill} onOpenChange={(open) => { if (!open) setConflictSkill(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Skill Already Exists</AlertDialogTitle>
          <AlertDialogDescription>
            A skill named &quot;{conflictSkill?.name}&quot; already exists locally. Overwriting will replace all local files and reset workflow progress.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleForceImport}>Overwrite</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
