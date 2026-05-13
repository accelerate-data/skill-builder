import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Info } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"

interface ReconciliationAckDialogProps {
  notifications: string[]
  open: boolean
  requireApply: boolean
  applying?: boolean
  onApply: () => void
  onCancel: () => void
}

export default function ReconciliationAckDialog({
  notifications,
  open,
  requireApply,
  applying = false,
  onApply,
  onCancel,
}: ReconciliationAckDialogProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent size="lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Info className="size-5" style={{ color: "var(--color-pacific)" }} />
            Startup Reconciliation
          </AlertDialogTitle>
          <AlertDialogDescription>
            The following changes were made to keep the database in sync with files on disk.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ScrollArea className="max-h-[400px]">
          <div className="w-full min-w-0">
          {notifications.length > 0 && (
            <ul className="flex flex-col gap-2 py-2">
              {notifications.map((notification, i) => (
                <li
                  key={i}
                  className="break-words rounded-md border px-3 py-2 text-sm text-foreground"
                >
                  {notification}
                </li>
              ))}
            </ul>
          )}
          </div>
        </ScrollArea>

        <AlertDialogFooter>
          {requireApply ? (
            <>
              <AlertDialogAction onClick={onCancel}>
                Continue Without Applying
              </AlertDialogAction>
              <AlertDialogAction
                onClick={onApply}
                disabled={applying}
              >
                {applying ? "Applying..." : "Apply Reconciliation"}
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction onClick={onApply}>
              Acknowledge
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
