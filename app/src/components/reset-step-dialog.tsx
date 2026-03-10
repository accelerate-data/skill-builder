import { useState, useEffect } from "react"
import { toast } from "@/lib/toast"
import { Loader2 } from "lucide-react"
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
import { previewStepReset, resetWorkflowStep, type StepResetPreview } from "@/lib/tauri"

interface ResetStepDialogProps {
  targetStep: number | null
  /** Step ID to start deleting from. Defaults to targetStep.
   *  Set to targetStep+1 when navigating back to a completed step that should
   *  keep its own output files (e.g. going back to step 2 should preserve
   *  decisions.json and only delete step 3+ artifacts). */
  deleteFromStep?: number | null
  workspacePath: string
  skillName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onReset: () => void
  /** Override the default resetWorkflowStep Tauri call. When provided, this is
   *  called instead of resetWorkflowStep(workspacePath, skillName, effectiveDeleteFrom).
   *  Use this for navigate-back flows that need a different DB command (e.g. navigate_back_to_step). */
  executeReset?: () => Promise<void>
}

export default function ResetStepDialog({
  targetStep,
  deleteFromStep,
  workspacePath,
  skillName,
  open,
  onOpenChange,
  onReset,
  executeReset,
}: ResetStepDialogProps) {
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<StepResetPreview[] | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  const effectiveDeleteFrom = deleteFromStep ?? targetStep

  useEffect(() => {
    if (!open || effectiveDeleteFrom === null) {
      setPreview(null)
      return
    }
    setLoadingPreview(true)
    previewStepReset(workspacePath, skillName, effectiveDeleteFrom)
      .then(setPreview)
      .catch((err) => {
        toast.error(
          `Failed to load preview: ${err instanceof Error ? err.message : String(err)}`,
          { duration: Infinity },
        )
        setPreview(null)
      })
      .finally(() => setLoadingPreview(false))
  }, [open, effectiveDeleteFrom, workspacePath, skillName])

  const handleReset = async () => {
    if (effectiveDeleteFrom === null) return
    setLoading(true)
    try {
      if (executeReset) {
        await executeReset()
      } else {
        await resetWorkflowStep(workspacePath, skillName, effectiveDeleteFrom)
      }
      toast.success("Workflow reset successfully")
      onOpenChange(false)
      onReset()
    } catch (err) {
      toast.error(
        `Failed to reset: ${err instanceof Error ? err.message : String(err)}`,
        { duration: Infinity },
      )
    } finally {
      setLoading(false)
    }
  }

  const totalFiles = preview?.reduce((sum, s) => sum + s.files.length, 0) ?? 0

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset to Earlier Step</AlertDialogTitle>
          <AlertDialogDescription>
            Going back will delete all artifacts from step {(effectiveDeleteFrom ?? 0) + 1} onward and reset their statuses.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {loadingPreview ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : preview && preview.length > 0 ? (
          <div className="max-h-60 overflow-y-auto space-y-3 text-sm">
            {preview.map((step) => (
              <div key={step.step_id}>
                <p className="font-medium text-foreground">
                  {step.step_name}
                </p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {step.files.map((file) => (
                    <li key={file} className="font-mono text-xs pl-3">
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : preview && preview.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No files to delete. Step statuses will be reset.
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleReset}
            disabled={loading || loadingPreview || preview === null}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {totalFiles > 0 ? `Delete ${totalFiles} file${totalFiles !== 1 ? "s" : ""} & Reset` : "Reset"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
