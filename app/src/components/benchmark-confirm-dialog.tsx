import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

interface BenchmarkConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onSkip: () => void;
}

export function BenchmarkConfirmDialog({ open, onConfirm, onSkip }: BenchmarkConfirmDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <p className="text-xs font-medium text-muted-foreground">Step 4</p>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0" style={{ color: "var(--color-seafoam)" }} />
            Skill written successfully
          </DialogTitle>
          <DialogDescription>
            Run benchmarks to evaluate the skill against test cases?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="transition-colors duration-150" onClick={onSkip}>
            Skip
          </Button>
          <Button className="transition-colors duration-150" onClick={onConfirm}>
            Run Benchmarks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
